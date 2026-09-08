import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ExcelJS from "exceljs";

import { createPendingAction, applyConfirmedAction } from "../scripts/apply-confirmed-action.mjs";
import { setCurrentRole } from "../scripts/agent-state.mjs";
import { buildLedger } from "../scripts/create-role-ledger.mjs";
import { createReviewDashboard } from "../scripts/create-review-dashboard.mjs";

async function setupRole() {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "confirmed-action-"));
  const rolePath = path.join(rootPath, "workflow", "roles", "测试岗位");
  await fs.mkdir(path.join(rolePath, "candidates"), { recursive: true });
  await fs.writeFile(path.join(rolePath, "PIPELINE.json"), JSON.stringify({ stages: [{ id: 0, name: "简历初筛" }, { id: 1, name: "业务一面" }, { id: 2, name: "业务二面" }], statuses: ["进行中", "通过", "终止"] }), "utf8");
  await fs.writeFile(path.join(rolePath, "CONTEXT.md"), "# 测试岗位｜岗位上下文\n", "utf8");
  await fs.writeFile(path.join(rolePath, "ACTION_LOG.md"), "# 操作日志\n", "utf8");
  const workbook = await buildLedger("测试岗位", JSON.parse(await fs.readFile(path.join(rolePath, "PIPELINE.json"), "utf8")), { capacity: 3 });
  const ledger = workbook.getWorksheet("候选人台账");
  ledger.getCell("A4").value = "C-001";
  ledger.getCell("B4").value = "张某";
  ledger.getCell("T4").value = "1-业务一面";
  ledger.getCell("U4").value = "进行中";
  await workbook.xlsx.writeFile(path.join(rolePath, "candidate-ledger.xlsx"));
  await createReviewDashboard(path.join(rolePath, "招聘数据复盘.html"));
  await setCurrentRole({ rootPath, role: "测试岗位" });
  return { rootPath, rolePath };
}

test("pending action does not modify the ledger before confirmation", async () => {
  const { rootPath, rolePath } = await setupRole();
  const proposal = await createPendingAction({ rootPath, proposal: {
    role: "测试岗位", intent: "candidate_update", candidate: { id: "C-001", name: "张某" },
    changes: [{ field: "阶段状态", before: "进行中", after: "通过" }], evidence: ["用户明确说明一面通过"],
  } });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.join(rolePath, "candidate-ledger.xlsx"));
  assert.equal(workbook.getWorksheet("候选人台账").getCell("U4").value, "进行中");
  assert.ok(proposal.id);
  await fs.rm(rootPath, { recursive: true, force: true });
});

test("confirmed action updates the ledger, archive, log and dashboard", async () => {
  const { rootPath, rolePath } = await setupRole();
  const proposal = await createPendingAction({ rootPath, proposal: {
    role: "测试岗位", intent: "candidate_update", candidate: { id: "C-001", name: "张某" },
    changes: [
      { field: "阶段状态", before: "进行中", after: "通过" },
      { field: "下一步动作", before: "", after: "安排二面" },
      { field: "下次跟进日期", before: "", after: "2026-08-03" },
    ], evidence: ["用户明确说明一面通过，待安排二面"],
  } });

  await applyConfirmedAction({ rootPath, proposalId: proposal.id });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.join(rolePath, "candidate-ledger.xlsx"));
  const row = workbook.getWorksheet("候选人台账").getRow(4);
  assert.equal(row.getCell("T").value, "1-业务一面");
  assert.equal(row.getCell("U").value, "通过");
  assert.equal(row.getCell("W").value, "安排二面");
  assert.match(await fs.readFile(path.join(rolePath, "candidates", "C-001.md"), "utf8"), /安排二面/);
  assert.match(await fs.readFile(path.join(rolePath, "ACTION_LOG.md"), "utf8"), /候选人状态更新/);
  assert.match(await fs.readFile(path.join(rolePath, "招聘数据复盘.html"), "utf8"), /"阶段状态":"通过"/);
  await fs.rm(rootPath, { recursive: true, force: true });
});

test("confirmed action stops when its before value conflicts with the current ledger", async () => {
  const { rootPath, rolePath } = await setupRole();
  const proposal = await createPendingAction({ rootPath, proposal: {
    role: "测试岗位", intent: "candidate_update", candidate: { id: "C-001", name: "张某" },
    changes: [{ field: "阶段状态", before: "通过", after: "终止" }, { field: "终止原因", before: "", after: "横向比较" }], evidence: ["测试冲突"],
  } });

  await assert.rejects(() => applyConfirmedAction({ rootPath, proposalId: proposal.id }), /事实源已变化/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.join(rolePath, "candidate-ledger.xlsx"));
  assert.equal(workbook.getWorksheet("候选人台账").getCell("U4").value, "进行中");
  await fs.rm(rootPath, { recursive: true, force: true });
});

test("confirmed create action adds a candidate only after confirmation", async () => {
  const { rootPath, rolePath } = await setupRole();
  const proposal = await createPendingAction({ rootPath, proposal: {
    role: "测试岗位", intent: "candidate_create", candidate: { id: "C-002", name: "李某" },
    changes: [
      { field: "主阶段", before: "", after: "0-简历初筛" },
      { field: "阶段状态", before: "", after: "进行中" },
      { field: "简历来源", before: "", after: "员工推荐" },
      { field: "简历收取时间", before: "", after: "2026-08-01" },
    ], evidence: ["招聘者确认新增候选人"],
  } });
  await applyConfirmedAction({ rootPath, proposalId: proposal.id });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.join(rolePath, "candidate-ledger.xlsx"));
  const row = workbook.getWorksheet("候选人台账").getRow(5);
  assert.equal(row.getCell("A").value, "C-002");
  assert.equal(row.getCell("B").value, "李某");
  assert.equal(row.getCell("T").value, "0-简历初筛");
  await fs.rm(rootPath, { recursive: true, force: true });
});

test("sync failure restores the ledger before reporting the error", async () => {
  const { rootPath, rolePath } = await setupRole();
  await fs.rm(path.join(rolePath, "招聘数据复盘.html"));
  const proposal = await createPendingAction({ rootPath, proposal: {
    role: "测试岗位", intent: "candidate_update", candidate: { id: "C-001", name: "张某" },
    changes: [{ field: "阶段状态", before: "进行中", after: "通过" }], evidence: ["测试看板失败回滚"],
  } });
  await assert.rejects(() => applyConfirmedAction({ rootPath, proposalId: proposal.id }));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.join(rolePath, "candidate-ledger.xlsx"));
  assert.equal(workbook.getWorksheet("候选人台账").getCell("U4").value, "进行中");
  await fs.rm(rootPath, { recursive: true, force: true });
});
