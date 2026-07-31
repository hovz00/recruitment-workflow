import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const templates = [
  "岗位澄清提示词.md",
  "简历评估提示词.md",
  "电话沟通提示词.md",
  "面试反馈提示词.md",
  "Offer与入职提示词.md",
];

test("all interactive prompt templates exist", async () => {
  for (const file of templates) {
    const text = await readFile(`workflow/templates/${file}`, "utf8");
    assert.ok(text.length > 200, `${file} should be a usable template`);
  }
});

test("role clarification asks age and work-year rule questions", async () => {
  const text = await readFile("workflow/templates/岗位澄清提示词.md", "utf8");
  for (const term of ["年龄", "硬性标准", "总工作年限", "对口岗位年限", "对口项目年限", "一次只问一个问题"]) {
    assert.match(text, new RegExp(term));
  }
});

test("resume assessment requires evidence and ledger updates", async () => {
  const text = await readFile("workflow/templates/简历评估提示词.md", "utf8");
  for (const term of ["原文摘录", "来源位置", "待验证", "候选人台账", "电话沟通问题"]) {
    assert.match(text, new RegExp(term));
  }
});

test("resume intake asks for source and received date before ledger writeback", async () => {
  const text = await readFile("workflow/templates/简历评估提示词.md", "utf8");
  for (const term of ["简历来源", "简历收取时间", "YYYY-MM-DD", "先只问一个问题"]) {
    assert.match(text, new RegExp(term));
  }
});

test("resume template puts conclusion and score before the evidence details", async () => {
  const text = await readFile("workflow/templates/简历评估提示词.md", "utf8");
  for (const term of ["结论先行", "能力证据得分", "证据覆盖率", "姓名｜建议", "**待核实**", "直接证据", "间接证据", "暂无证据", "0–10", "本人责任", "信息缺口"]) {
    assert.match(text, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("candidate evidence record uses one 0–10 card with traceable evidence fields", async () => {
  const text = await readFile("workflow/templates/CANDIDATE_RECORD.md", "utf8");
  for (const term of ["能力证据得分：{{x/10}}", "直接证据", "间接证据", "暂无证据", "证据强度（0–10）", "简历原文与来源位置", "信息缺口", "电话核验问题"]) {
    assert.match(text, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("role memory templates preserve confirmed rules, unresolved questions and next actions", async () => {
  const text = await readFile("workflow/templates/CONTEXT.md", "utf8");
  for (const term of ["已确认标准", "待确认问题", "下一步", "不是候选人流程事实源"]) {
    assert.match(text, new RegExp(term));
  }
});

test("keyword iteration template records evidence instead of self-adjusting search", async () => {
  const text = await readFile("workflow/templates/KEYWORD_ITERATIONS.md", "utf8");
  for (const term of ["命中证据", "人工确认", "不得自动", "岗位标准版本", "5 条同类"]) {
    assert.match(text, new RegExp(term));
  }
});

test("offer and onboarding template preserves confirmed pipeline stages", async () => {
  const text = await readFile("workflow/templates/Offer与入职提示词.md", "utf8");
  for (const term of ["进行中", "通过", "终止", "终止原因", "备注", "PIPELINE.json", "人工确认"]) {
    assert.match(text, new RegExp(term));
  }
});

test("interview feedback separates facts, ability and role-level improvements", async () => {
  const text = await readFile("workflow/templates/面试反馈提示词.md", "utf8");
  for (const term of ["流程事实", "能力反馈", "岗位匹配判断", "岗位级改进建议", "待澄清问题"]) {
    assert.match(text, new RegExp(term));
  }
});

test("ambiguous feedback blocks strategy changes until clarified", async () => {
  const text = await readFile("workflow/AGENTS.md", "utf8");
  for (const term of ["未澄清前", "不得修改岗位标准、评分或搜寻策略", "具体适用于哪个岗位或招聘环节"]) {
    assert.match(text, new RegExp(term));
  }
});
