import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("role standard makes age and experience rules explicit", async () => {
  const text = await readFile("workflow/templates/ROLE_STANDARD.md", "utf8");
  for (const term of ["不使用", "评分参考", "硬性标准", "总工作年限", "对口岗位年限", "对口项目年限", "待人工确认"]) {
    assert.match(text, new RegExp(term));
  }
});

test("sourcing strategy covers companies titles projects and skills", async () => {
  const text = await readFile("workflow/templates/SOURCING_STRATEGY.md", "utf8");
  for (const term of ["对标公司", "岗位 Title", "项目线索", "技能关键词", "检索式"]) {
    assert.match(text, new RegExp(term));
  }
});

test("candidate record and feedback templates preserve evidence and approval", async () => {
  const record = await readFile("workflow/templates/CANDIDATE_RECORD.md", "utf8");
  const feedback = await readFile("workflow/templates/FEEDBACK_ITERATIONS.md", "utf8");
  assert.match(record, /原文摘录/);
  assert.match(record, /来源位置/);
  assert.match(feedback, /人工确认/);
  assert.match(feedback, /版本/);
});
