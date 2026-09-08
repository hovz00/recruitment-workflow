import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getSelectedRole, resolveCurrentRole, resolveRoleDirectory, setCurrentRole } from "../scripts/agent-state.mjs";
import { buildLedger } from "../scripts/create-role-ledger.mjs";
import { getRoleSnapshot } from "../scripts/get-role-snapshot.mjs";
import { initializeRoleWorkspace } from "../scripts/initialize-role-workspace.mjs";

test("resolves the current role from local agent state", async () => {
  const role = await resolveCurrentRole({ rootPath: "/tmp/recruitment-agent", readJson: async () => ({ role: "AI 支付产品经理" }) });
  assert.equal(role, "AI 支付产品经理");
});

test("stops when a role reference matches more than one local role", async () => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "role-match-"));
  await fs.mkdir(path.join(rootPath, "workflow", "roles", "AI 支付产品经理"), { recursive: true });
  await fs.mkdir(path.join(rootPath, "workflow", "roles", "AI 平台产品经理"), { recursive: true });
  await assert.rejects(() => resolveRoleDirectory({ rootPath, roleReference: "AI" }), /不唯一/);
  await fs.rm(rootPath, { recursive: true, force: true });
});

test("stops when a requested role does not exist", async () => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "role-missing-"));
  await fs.mkdir(path.join(rootPath, "workflow", "roles"), { recursive: true });
  await assert.rejects(() => resolveRoleDirectory({ rootPath, roleReference: "不存在" }), /不存在/);
  await fs.rm(rootPath, { recursive: true, force: true });
});

test("stops when the saved current role has been removed", async () => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "current-role-missing-"));
  await setCurrentRole({ rootPath, role: "已删除岗位" });
  await fs.mkdir(path.join(rootPath, "workflow", "roles"), { recursive: true });
  await assert.rejects(() => getSelectedRole({ rootPath }), /不存在/);
  await fs.rm(rootPath, { recursive: true, force: true });
});

test("summarises candidate progress and pending follow-up from a role ledger", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "role-snapshot-"));
  const ledgerPath = path.join(directory, "candidate-ledger.xlsx");
  const workbook = await buildLedger("测试岗位", {
    stages: [{ id: 0, name: "简历初筛" }, { id: 1, name: "业务一面" }],
    statuses: ["进行中", "通过", "终止"],
  }, { capacity: 3 });
  const sheet = workbook.getWorksheet("候选人台账");
  sheet.getCell("A4").value = "C-001";
  sheet.getCell("B4").value = "候选人甲";
  sheet.getCell("T4").value = "1-业务一面";
  sheet.getCell("U4").value = "进行中";
  sheet.getCell("X4").value = new Date("2026-07-30T00:00:00");
  sheet.getCell("AF4").value = new Date("2026-07-30T00:00:00");
  sheet.getCell("AJ4").value = "";
  sheet.getCell("A5").value = "C-002";
  sheet.getCell("B5").value = "候选人乙";
  sheet.getCell("T5").value = "0-简历初筛";
  sheet.getCell("U5").value = "通过";
  await workbook.xlsx.writeFile(ledgerPath);
  await fs.writeFile(path.join(directory, "PIPELINE.json"), JSON.stringify({ stages: [{id:0,name:"简历初筛"},{id:1,name:"业务一面"}] }));
  await fs.writeFile(path.join(directory, "ACTION_LOG.md"), "## 2026-07-29 10:00｜候选人状态更新\n", "utf8");

  const snapshot = await getRoleSnapshot({ roleName: "测试岗位", rolePath: directory, now: new Date("2026-07-31T09:00:00") });

  assert.equal(snapshot.candidateTotal, 2);
  assert.equal(snapshot.inProgress, 2);
  assert.equal(snapshot.dueFollowUps, 1);
  assert.equal(snapshot.missingNextActions, 2);
  assert.equal(snapshot.pendingFeedback, 1);
  assert.match(snapshot.lastAction, /候选人状态更新/);
  await fs.rm(directory, { recursive: true, force: true });
});

test("initialises a confirmed role with durable files and makes it current", async () => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "role-init-"));
  await initializeRoleWorkspace({
    rootPath,
    roleName: "AI 产品经理",
    pipeline: { stages: [{ id: 0, name: "简历初筛" }, { id: 1, name: "一面" }], statuses: ["进行中", "通过", "终止"] },
    capacity: 5,
  });
  const rolePath = path.join(rootPath, "workflow", "roles", "AI 产品经理");
  for (const file of ["CONTEXT.md", "ROLE_STANDARD.md", "SOURCING_STRATEGY.md", "PIPELINE.json", "KEYWORD_ITERATIONS.md", "FEEDBACK_ITERATIONS.md", "candidate-ledger.xlsx", "招聘数据复盘.html", "ACTION_LOG.md"]) {
    await fs.access(path.join(rolePath, file));
  }
  await fs.access(path.join(rolePath, "candidates"));
  assert.equal(await resolveCurrentRole({ rootPath }), "AI 产品经理");
  await fs.rm(rootPath, { recursive: true, force: true });
});
