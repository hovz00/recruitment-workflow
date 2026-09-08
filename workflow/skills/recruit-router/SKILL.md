---
name: recruit-router
description: Route a local recruitment-workflow request to role clarification, resume evidence review, communication follow-up, feedback calibration, or dashboard review.
---

# 招聘工作流总入口

先定位招聘工作区根目录并读取 `AGENT_PROTOCOL.md`、`AGENTS.md` 与 `00-招聘规则.md`。处理已有岗位时，再按协议读取当前岗位的 `CONTEXT.md`、`ROLE_STANDARD.md`、`PIPELINE.json` 与 `candidate-ledger.xlsx`；缺少岗位标准或流程配置时，只能澄清需求，不能给候选人评分或分配阶段。

按用户意图路由：

- 新岗位或 JD 澄清：使用 `recruit-grill`。
- 简历、内推材料或邮箱附件：使用 `resume-evidence-review`。
- 电话纪要：读取候选人档案与 `templates/电话沟通提示词.md`，整理事实与下一步，等待人工确认再更新台账。
- 面试官反馈、决策会结论、策略复盘：使用 `feedback-calibration`。
- Offer / 入职进展：读取 `templates/Offer与入职提示词.md`，输出状态更新草稿，等待人工确认。
- 人才盘点或搜寻词调整：读取 `SOURCING_STRATEGY.md` 与 `KEYWORD_ITERATIONS.md`，只输出有证据的观察。
- 招聘数据复盘：以 Excel 台账和 `PIPELINE.json` 为事实源，同步到由正式模板创建的 `招聘数据复盘.html`；看板不能反向覆盖台账。

遇到适用岗位或招聘环节不明的反馈，先只问：**这条反馈具体适用于哪个岗位或招聘环节？** 未澄清前不得修改岗位标准、评分或搜寻策略。

始终结论先行，所有缺失信息标记为 **待核实**。联系候选人、约面、淘汰、录用、变更台账状态和版本规则都需要人工确认；不要执行招聘平台抓取或自动化对外操作。
