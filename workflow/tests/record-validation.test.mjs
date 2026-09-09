import test from "node:test";
import assert from "node:assert/strict";
import { validateCandidateRecord } from "../scripts/validate-candidate-record.mjs";

const stages = ["0-简历初筛", "1-电话沟通", "2-业务一面", "3-Offer", "4-入职"];
const options = { stages, now: new Date("2026-09-09T12:00:00Z") };
const base = () => ({ "简历来源": "招聘平台", "简历收取时间": "2026-08-01", "主阶段": "2-业务一面", "阶段状态": "进行中", "终止原因": "" });
const validate = patch => validateCandidateRecord({ ...base(), ...patch }, options);

test("requires the same core fields for complete candidate records", () => {
  for (const field of ["简历来源", "简历收取时间", "主阶段", "阶段状态"]) {
    for (const value of [undefined, null, "", "   "]) assert.throws(() => validate({ [field]: value }), new RegExp(field));
  }
});
test("validates configured stages, including object definitions and unknown stages", () => {
  assert.doesNotThrow(() => validateCandidateRecord(base(), { ...options, stages: stages.map(label => ({ id: Number(label.split("-")[0]), name: label.slice(2) })) }));
  assert.throws(() => validate({ "主阶段": "8-不存在" }), /主阶段/);
  assert.throws(() => validate({ "阶段状态": "已沟通" }), /阶段状态/);
});
test("termination reasons must match current status", () => {
  assert.throws(() => validate({ "阶段状态": "终止" }), /终止原因/);
  assert.throws(() => validate({ "终止原因": "候选人撤回" }), /终止原因/);
  assert.doesNotThrow(() => validate({ "阶段状态": "终止", "终止原因": "候选人撤回" }));
});
test("accepts empty, zero and decimal numeric scores at their inclusive boundaries", () => {
  for (const value of [undefined, null, "", " ", 0, 10, "0", "10", " 7.5 "]) assert.doesNotThrow(() => validate({ "能力证据得分": value }));
  for (const value of [0, 100, "0", "100", "82.5"]) assert.doesNotThrow(() => validate({ "证据覆盖率": value }));
});
test("rejects out-of-range, boolean, nonfinite and partially numeric scores", () => {
  for (const value of [-1, 10.1, 80, true, false, NaN, Infinity, "NaN", "Infinity", "8分", "0x8", {}, []]) assert.throws(() => validate({ "能力证据得分": value }), /能力证据得分/);
  for (const value of [-1, 100.1, 120, true, false, "90%", Infinity]) assert.throws(() => validate({ "证据覆盖率": value }), /证据覆盖率/);
});
test("accepts valid Excel dates and exact calendar text without mutating the record", () => {
  const record = { ...base(), "简历收取时间": new Date("2026-08-01T00:00:00Z"), "2-业务一面日期": "2026-08-10", "2-业务一面通过日期": new Date("2026-08-10T00:00:00Z") };
  const before = structuredClone(record);
  assert.equal(validateCandidateRecord(record, options), record);
  assert.deepEqual(record, before);
  assert.doesNotThrow(() => validate({ "简历收取时间": "2024-02-29" }));
});
test("rejects calendar overflow, unstructured strings and invalid dates on every date field", () => {
  for (const field of ["简历收取时间", "一面日期", "预计入职日期", "下次跟进日期", "状态更新时间", "最后更新时间", "2-业务一面日期", "Offer接受日期"]) {
    for (const value of ["2026-02-30", "2026-13-01", "2026-2-01", "09/01/2026", "2026-08-01T00:00:00Z", new Date(NaN), 123, true]) assert.throws(() => validate({ [field]: value }), new RegExp(field));
  }
});
test("all actual history must be on or after receipt and no later than the UTC current date", () => {
  for (const field of ["0-简历初筛日期", "1-电话沟通通过日期", "Offer接受日期"]) {
    assert.throws(() => validate({ [field]: "2026-07-31" }), new RegExp(field));
    assert.throws(() => validate({ [field]: "2026-09-10" }), new RegExp(field));
    assert.doesNotThrow(() => validate({ [field]: "2026-09-09" }));
  }
  assert.throws(() => validate({ "简历收取时间": "2026-09-10" }), /简历收取时间/);
});
test("a stage cannot pass before it starts", () => {
  assert.throws(() => validate({ "2-业务一面日期": "2026-08-12", "2-业务一面通过日期": "2026-08-11" }), /2-业务一面通过日期/);
});
test("later actual history cannot precede earlier known stage history even when stages are missing", () => {
  assert.throws(() => validate({ "0-简历初筛通过日期": "2026-08-12", "2-业务一面日期": "2026-08-11" }), /2-业务一面日期/);
  assert.throws(() => validate({ "0-简历初筛日期": "2026-08-12", "2-业务一面通过日期": "2026-08-11" }), /2-业务一面通过日期/);
  assert.doesNotThrow(() => validate({ "0-简历初筛通过日期": "2026-08-12", "2-业务一面日期": "2026-08-12" }));
});
test("unknown history dates remain optional", () => {
  assert.doesNotThrow(() => validate({ "主阶段": "4-入职", "阶段状态": "通过", "0-简历初筛日期": "", "4-入职通过日期": "2026-09-01" }));
});
test("scheduled interviews and reminders can be future dates and are not actual stage chronology", () => {
  assert.doesNotThrow(() => validate({ "一面日期": "2026-10-01", "二面日期": "2026-08-02", "预计入职日期": "2026-11-01", "下次跟进日期": "2026-10-01", "2-业务一面日期": "2026-09-01" }));
  assert.doesNotThrow(() => validate({ '2-业务一面预约日期':'2026-10-01', '2-业务一面日期':'2026-09-01', '3-Offer日期':'2026-09-02' }));
});
test("offer acceptance participates in known stage chronology and planned entry cannot precede acceptance", () => {
  assert.throws(() => validate({ "2-业务一面通过日期": "2026-08-20", "Offer接受日期": "2026-08-19" }), /Offer接受日期/);
  assert.throws(() => validate({ "Offer接受日期": "2026-08-20", "4-入职日期": "2026-08-19" }), /4-入职日期/);
  assert.throws(() => validate({ "Offer接受日期": "2026-08-20", "预计入职日期": "2026-08-19" }), /预计入职日期/);
  assert.doesNotThrow(() => validate({ "Offer接受日期": "2026-08-20", "预计入职日期": "2026-08-20" }));
});
test("correcting bad historical dates produces a valid record", () => {
  const record = { ...base(), "1-电话沟通日期": "2026-01-01", "1-电话沟通通过日期": "2026-08-07", "2-业务一面日期": "2026-08-08" };
  assert.throws(() => validateCandidateRecord(record, options), /1-电话沟通日期/);
  record["1-电话沟通日期"] = "2026-08-06";
  assert.doesNotThrow(() => validateCandidateRecord(record, options));
});
