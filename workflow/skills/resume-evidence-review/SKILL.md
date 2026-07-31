---
name: resume-evidence-review
description: Convert an authorized resume into a structured profile, evidence card, verification questions, and a human-confirmed candidate-ledger draft.
---

# 简历证据评估

读取 `AGENTS.md`、当前岗位的 `CONTEXT.md`、`ROLE_STANDARD.md`、`PIPELINE.json`、`candidate-ledger.xlsx` 和 `templates/简历评估提示词.md`。先用姓名、联系方式或简历唯一信息去重；只有获得使用授权的简历可以处理。

第一行固定输出：`姓名｜建议｜能力证据得分｜证据覆盖率`。随后先写不超过三条整体判断，再给出结构化信息、逐维度证据卡、风险、**待核实**项和电话沟通问题。

一名候选人只生成一张证据卡，覆盖岗位标准中 3–5 个核心能力维度。每个维度记录岗位要求、原文摘录与来源位置、证据等级、0–10 证据强度、已具备信息、信息缺口和电话核验问题。证据等级仅使用直接证据、间接证据、暂无证据；已具备信息优先写清行动、范围、结果和本人责任。材料未出现的信息是待验证，不是负面证据。年龄、学历和工作年限只按该岗位的已确认规则呈现；不可自行推断。

拟写候选人档案和台账新增/更新草稿。招聘者人工确认前，不改变阶段、阶段状态、终止原因或约面安排，不向任何平台发送操作。
