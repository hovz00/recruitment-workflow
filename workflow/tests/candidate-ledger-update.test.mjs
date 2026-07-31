import assert from "node:assert/strict";
import test from "node:test";
import { decisionToLedgerPatch, mergeCandidate, stageStatusToLedgerPatch } from "../scripts/update-candidate-ledger.mjs";

test("direct stage and status updates normalise a bare stage name", () => {
  const pipeline = { stages: [{ id: 0, name: "简历初筛" }, { id: 1, name: "电话沟通" }], statuses: ["进行中", "通过", "终止"] };
  const patch = stageStatusToLedgerPatch({ candidateId: "C-001", name: "A", stage: "电话沟通", status: "进行中" }, pipeline);
  assert.equal(patch.主阶段, "1-电话沟通");
  assert.equal(patch.阶段状态, "进行中");
  assert.equal(patch.终止原因, "");
});

test("direct termination requires a reason", () => {
  const pipeline = { stages: [{ id: 0, name: "简历初筛" }], statuses: ["进行中", "通过", "终止"] };
  assert.throws(() => stageStatusToLedgerPatch({ candidateId: "C-001", name: "A", stage: "简历初筛", status: "终止" }, pipeline), /终止原因/);
});

test("termination is a stage status and preserves the reached main stage and reason", () => {
  const patch = decisionToLedgerPatch({
    candidateId: "AI-PAY-001",
    name: "A",
    decision: "terminate",
    stage: "0-简历初筛",
    reason: "简历不匹配",
  });
  assert.equal(patch.主阶段, "0-简历初筛");
  assert.equal(patch.阶段状态, "终止");
  assert.equal(patch.终止原因, "简历不匹配");
  assert.match(patch.备注, /招聘者确认/);
});

test("candidate updates require the confirmed pipeline stage", () => {
  assert.throws(
    () => decisionToLedgerPatch({ candidateId: "C-001", name: "A", decision: "terminate" }),
    /主阶段/,
  );
});

test("termination keeps the last reached main stage", () => {
  const patch = decisionToLedgerPatch({
    candidateId: "AI-PAY-002",
    name: "A",
    decision: "terminate",
    stage: "6-决策会",
    reason: "其他待说明",
  });

  assert.equal(patch.主阶段, "6-决策会");
  assert.equal(patch.阶段状态, "终止");
});

test("deferral is a stage status and keeps where the candidate was paused", () => {
  const patch = decisionToLedgerPatch({
    candidateId: "C-003",
    name: "A",
    decision: "defer",
    stage: "3-业务二面",
  });
  assert.equal(patch.主阶段, "3-业务二面");
  assert.equal(patch.阶段状态, "进行中");
});

test("interview-ready decision moves a candidate to the first-interview stage without scheduling", () => {
  const patch = decisionToLedgerPatch({
    candidateId: "AI-PAY-002",
    name: "A",
    decision: "ready_for_interview",
    stage: "2-业务一面",
  });
  assert.equal(patch.主阶段, "2-业务一面");
  assert.equal(patch.阶段状态, "进行中");
  assert.equal(patch.终止原因, "");
});

test("confirmed interview details override the default pending-reply status", () => {
  const patch = mergeCandidate({
    candidateId: "AI-PAY-002",
    name: "A",
    decision: "ready_for_interview",
    stage: "2-业务一面",
    fields: { 阶段状态: "进行中", 一面日期: "2026-07-21" },
  });
  assert.equal(patch.阶段状态, "进行中");
  assert.ok(patch.一面日期 instanceof Date);
});
