import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildLedger } from "../scripts/create-role-ledger.mjs";
import { createReviewDashboard } from "../scripts/create-review-dashboard.mjs";
import { injectAutoLedgerData, normalizeReviewRow, rowsFromLedgerValues, syncDashboard } from "../scripts/sync-dashboard-data.mjs";

const execFileAsync = promisify(execFile);

test("ledger rows are converted to the formal dashboard's stable headers", () => {
  const [row] = rowsFromLedgerValues([
    ["姓名", "主阶段", "阶段状态", "终止原因", "备注", "简历收取时间", "简历来源", "当前公司"],
    ["候选人A", "2-业务一面", "进行中", "", "已约面，等待面试", "2026-07-22", "员工推荐", "公司A"],
  ], "AI 产品经理");

  assert.deepEqual(row, {
    "主阶段": "2-业务一面",
    "阶段状态": "进行中",
    "终止原因": "",
    "备注信息": "已约面，等待面试",
    "简历收取时间": "2026-07-22",
    "岗位名称": "AI 产品经理",
    "候选人姓名": "候选人A",
    "简历来源": "员工推荐",
    "当前公司": "公司A",
  });
});

test("sync data keeps the actual main stage and writes terminal state only to stage status", () => {
  const row = normalizeReviewRow({
    "姓名": "候选人B", "主阶段": "3-业务二面", "阶段状态": "终止", "终止原因": "面试/评审不通过",
  }, "AI 产品经理");

  assert.equal(row["主阶段"], "3-业务二面");
  assert.equal(row["阶段状态"], "终止");
});

test("formal dashboard injection configures its real stage order and initialises the review data", () => {
  const source = "<body><script>let STAGES_CONFIG; let rawData; function transformData(v){return v} function initTimeSelectors(){} function refreshData(){} function showPageMessage(){} const DEFAULT_STAGES_CONFIG=[]; function getStageColor(){return '#000'};</script></body>";
  const result = injectAutoLedgerData(source, [{ "候选人姓名": "候选人A" }], ["0-简历待评估", "1-电话沟通", "2-业务一面"]);

  assert.match(result, /AUTO_LEDGER_DATA:START/);
  assert.match(result, /AUTO_DASHBOARD_STAGE_ORDER/);
  assert.match(result, /STAGES_CONFIG = AUTO_DASHBOARD_STAGE_ORDER/);
  assert.match(result, /applyAutoLedgerData\(\);/);
  assert.match(result, /"候选人姓名":"候选人A"/);
});

test("formal dashboard injection exits the default stage configuration modal", () => {
  const source = "<body><script>let STAGES_CONFIG; let rawData; function transformData(v){return v} function initTimeSelectors(){} function refreshData(){} function showPageMessage(){} const DEFAULT_STAGES_CONFIG=[]; function getStageColor(){return '#000'};</script></body>";
  const result = injectAutoLedgerData(source, [{ "候选人姓名": "候选人A" }], ["0-简历待评估"]);

  assert.match(result, /stageConfigModal'\)\?\.classList\.remove\('active'\)/);
  assert.match(result, /fileInput\.disabled = true/);
});

test("workflow-synced dashboard is labelled with its role and hides upload controls", () => {
  const source = "<body><h1 data-dashboard-title>招聘数据分析</h1><button data-upload-entry>上传</button><script>let STAGES_CONFIG; let rawData; function transformData(v){return v} function initTimeSelectors(){} function refreshData(){} function showPageMessage(){} const DEFAULT_STAGES_CONFIG=[]; function getStageColor(){return '#000'};</script></body>";
  const result = injectAutoLedgerData(source, [{ "候选人姓名": "候选人A" }], ["0-简历待评估"], { role: "AI 产品经理" });

  assert.match(result, /AUTO_DASHBOARD_ROLE = "AI 产品经理"/);
  assert.match(result, /AUTO_DASHBOARD_ROLE \+ '｜招聘数据复盘'/);
  assert.match(result, /workflowSynced = 'true'/);
  assert.match(result, /\[data-upload-entry\]/);
});

test("sync CLI gives a usable command when required arguments are absent", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, ["workflow/scripts/sync-dashboard-data.mjs"], { cwd: process.cwd() }),
    (error) => /--ledger/.test(error.stderr),
  );
});

test("a role can create the formal template and synchronise a configured ledger into it", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "recruitment-workflow-"));
  const ledgerPath = path.join(directory, "candidate-ledger.xlsx");
  const dashboardPath = path.join(directory, "index.html");
  const workbook = await buildLedger("测试岗位", {
    stages: [{ id: 0, name: "简历初筛" }, { id: 1, name: "业务沟通" }],
    statuses: ["进行中", "通过", "终止"],
  });
  const ledger = workbook.getWorksheet("候选人台账");
  ledger.getCell("B4").value = "候选人A";
  ledger.getCell("T4").value = "1-业务沟通";
  ledger.getCell("U4").value = "进行中";
  ledger.getCell("M4").value = "员工推荐";
  await workbook.xlsx.writeFile(ledgerPath);
  await createReviewDashboard(dashboardPath);
  await syncDashboard({ ledgerPath, dashboardPath, role: "测试岗位" });
  const result = await fs.readFile(dashboardPath, "utf8");

  assert.match(result, /招聘数据分析/);
  assert.match(result, /"1-业务沟通"/);
  assert.match(result, /"候选人姓名":"候选人A"/);
  await fs.rm(directory, { recursive: true, force: true });
});

test("creating the named dashboard migrates a legacy index.html without losing synced content", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "legacy-dashboard-"));
  const legacyPath = path.join(directory, "index.html");
  const dashboardPath = path.join(directory, "招聘数据复盘.html");
  await fs.writeFile(legacyPath, "<html>已同步候选人数据</html>", "utf8");

  await createReviewDashboard(dashboardPath);

  assert.equal(await fs.readFile(dashboardPath, "utf8"), "<html>已同步候选人数据</html>");
  await assert.rejects(fs.access(legacyPath));
  await fs.rm(directory, { recursive: true, force: true });
});
