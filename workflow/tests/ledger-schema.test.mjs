import assert from "node:assert/strict";
import test from "node:test";
import { ledgerColumns, statusValues, terminationReasons, buildLedger } from "../scripts/create-role-ledger.mjs";

const pipeline = { stages: [{ id: 0, name: "简历初筛" }, { id: 1, name: "电话沟通" }], statuses: statusValues };

test("ledger distinguishes age and all three experience definitions", () => {
  assert.deepEqual(ledgerColumns.slice(0, 7), [
    "候选人ID", "姓名", "年龄", "学历", "总工作年限", "对口岗位年限", "对口项目年限",
  ]);
  assert.ok(ledgerColumns.includes("年龄/年限资格提示"));
  assert.deepEqual(statusValues, ["进行中", "通过", "终止"]);
  assert.ok(terminationReasons.includes("Base 不符"));
});

test("ledger builder creates four role-specific sheets and avoids automatic rejection", async () => {
  const workbook = await buildLedger("目标岗位", pipeline);
  const names = workbook.worksheets.map((sheet) => sheet.name).join(" ");
  assert.match(names, /候选人台账/);
  assert.match(names, /状态字典/);
  assert.match(names, /复盘口径/);
  assert.match(names, /选项配置/);
});
