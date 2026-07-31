import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildLedger, ledgerColumns } from "../scripts/create-role-ledger.mjs";
import { createReviewDashboard } from "../scripts/create-review-dashboard.mjs";
import { readPipeline } from "../scripts/pipeline-config.mjs";
import { syncDashboard } from "../scripts/sync-dashboard-data.mjs";
import { upsertCandidates } from "../scripts/update-candidate-ledger.mjs";

const pipeline = { stages: [{ id: 0, name: "简历初筛" }, { id: 1, name: "电话沟通" }], statuses: ["进行中", "通过", "终止"] };

test("ledger creation requires a confirmed pipeline instead of falling back to fixed stages", async () => {
  await assert.rejects(buildLedger("测试岗位"), /PIPELINE\.json|流程配置/);
});

test("pipeline reader names the file when JSON is invalid", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "invalid-pipeline-"));
  const filePath = path.join(directory, "PIPELINE.json");
  await fs.writeFile(filePath, "{invalid json", "utf8");
  await assert.rejects(readPipeline(filePath), /流程配置文件解析失败.*PIPELINE\.json/s);
  await fs.rm(directory, { recursive: true, force: true });
});

test("pipeline reader distinguishes invalid JSON from an invalid pipeline rule", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "invalid-pipeline-rule-"));
  const filePath = path.join(directory, "PIPELINE.json");
  await fs.writeFile(filePath, JSON.stringify({ stages: [] }), "utf8");
  await assert.rejects(readPipeline(filePath), /流程配置不合法.*PIPELINE\.json/s);
  await fs.rm(directory, { recursive: true, force: true });
});

test("dashboard creator names a missing formal template", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "missing-dashboard-template-"));
  await assert.rejects(
    createReviewDashboard(path.join(directory, "index.html"), { templatePath: path.join(directory, "missing.html") }),
    /正式招聘复盘看板模板不存在/,
  );
  await fs.rm(directory, { recursive: true, force: true });
});

test("dashboard sync preserves the previous dashboard as a backup", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dashboard-backup-"));
  const ledgerPath = path.join(directory, "candidate-ledger.xlsx");
  const dashboardPath = path.join(directory, "index.html");
  const workbook = await buildLedger("测试岗位", pipeline);
  workbook.getWorksheet("候选人台账").getCell("B4").value = "候选人A";
  await workbook.xlsx.writeFile(ledgerPath);
  await createReviewDashboard(dashboardPath);
  const before = await fs.readFile(dashboardPath, "utf8");
  await syncDashboard({ ledgerPath, dashboardPath, role: "测试岗位" });
  assert.equal(await fs.readFile(`${dashboardPath}.bak`, "utf8"), before);
  await fs.rm(directory, { recursive: true, force: true });
});

test("ledger reserves a configurable capacity without special offer or onboarding date fields", async () => {
  assert.equal(ledgerColumns.includes("Offer情况"), false);
  assert.equal(ledgerColumns.includes("Offer发出日期"), false);
  assert.equal(ledgerColumns.includes("Offer接受日期"), false);
  assert.equal(ledgerColumns.includes("预计入职日期"), false);
  assert.equal(ledgerColumns.includes("实际入职日期"), false);
  const workbook = await buildLedger("测试岗位", pipeline, { capacity: 401 });
  assert.equal(workbook.getWorksheet("候选人台账").rowCount, 404);
});

test("candidate updates use the configured capacity instead of stopping at row 303", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ledger-capacity-"));
  const ledgerPath = path.join(directory, "candidate-ledger.xlsx");
  const workbook = await buildLedger("测试岗位", pipeline, { capacity: 301 });
  const ledger = workbook.getWorksheet("候选人台账");
  for (let row = 4; row <= 303; row += 1) ledger.getCell(`A${row}`).value = `C-${row}`;
  await workbook.xlsx.writeFile(ledgerPath);
  await upsertCandidates({ ledgerPath, candidates: [{ candidateId: "C-304", name: "候选人A", decision: "terminate", stage: "0-简历初筛" }] });
  const result = new (await import("exceljs")).default.Workbook();
  await result.xlsx.readFile(ledgerPath);
  assert.equal(result.getWorksheet("候选人台账").getCell("A304").value, "C-304");
  await fs.rm(directory, { recursive: true, force: true });
});
