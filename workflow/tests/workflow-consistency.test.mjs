import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("workflow documentation uses the named review dashboard and leaves stage names to PIPELINE.json", async () => {
  const rules = await readFile("workflow/00-招聘规则.md", "utf8");
  assert.match(rules, /招聘数据复盘\.html/);
  assert.match(rules, /PIPELINE\.json/);
  assert.doesNotMatch(rules, /0-简历待评估.*1-电话沟通.*业务一面/s);
});

test("new role and feedback routes name every required durable file", async () => {
  const agents = await readFile("workflow/AGENTS.md", "utf8");
  const grill = await readFile("workflow/skills/recruit-grill/SKILL.md", "utf8");
  const router = await readFile("workflow/skills/recruit-router/SKILL.md", "utf8");
  const feedback = await readFile("workflow/skills/feedback-calibration/SKILL.md", "utf8");
  for (const text of [agents, grill]) assert.match(text, /PIPELINE\.json/);
  assert.match(agents, /KEYWORD_ITERATIONS\.md/);
  assert.match(router, /电话沟通提示词\.md/);
  assert.match(router, /00-招聘规则\.md/);
  assert.match(router, /PIPELINE\.json/);
  assert.match(feedback, /面试反馈提示词\.md/);
  assert.match(feedback, /PIPELINE\.json/);
  assert.match(agents, /主阶段、阶段状态、终止原因、备注和下一步动作/);
  assert.doesNotMatch(agents, /更新 Offer、入职字段/);
});

test("global rules make the five feedback layers authoritative", async () => {
  const rules = await readFile("workflow/00-招聘规则.md", "utf8");
  for (const term of ["流程事实", "能力反馈", "岗位匹配判断", "岗位级改进建议", "待澄清问题"]) assert.match(rules, new RegExp(term));
});
