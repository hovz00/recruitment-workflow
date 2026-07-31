# 工作流兼容入口

本项目的统一 Agent 行为以 `AGENT_PROTOCOL.md` 为准。开始招聘任务时先读取该文件与 `00-招聘规则.md`，再按协议选择当前岗位、路由到对应 Skill，并在获得招聘者**人工确认**后调用本地确定性脚本。

处理候选人前，当前岗位必须具备并读取 `CONTEXT.md`、`ROLE_STANDARD.md`、`PIPELINE.json` 与 `candidate-ledger.xlsx`；缺少岗位标准或流程配置时，只澄清需求，不给候选人评分或分配阶段。

反馈适用岗位或招聘环节不明确时，先询问“这条反馈具体适用于哪个岗位或招聘环节？”。未澄清前不得修改岗位标准、评分或搜寻策略。

新建岗位的持久化交付物为 `ROLE_STANDARD.md`、`SOURCING_STRATEGY.md`、`PIPELINE.json`、`CONTEXT.md` 与 `KEYWORD_ITERATIONS.md`；反馈校准同时读取并更新 `FEEDBACK_ITERATIONS.md`。

Offer、入职及其他候选人进展只在人工确认后写入主阶段、阶段状态、终止原因、备注和下一步动作。
