# Workflow 包说明

`workflow/` 是 Recruitment Workflow 的长期事实源和可复用招聘能力包。完整的项目介绍、安装、命令和使用流程见仓库根目录的 [README](../README.md)；统一启动与确认规则见 [AGENT_PROTOCOL.md](AGENT_PROTOCOL.md)。

## 开始方式

在本项目中，入口工具会先读取 `AGENT_PROTOCOL.md`。新岗位从 `templates/岗位澄清提示词.md` 开始；候选人处理前先确认岗位标准与 `PIPELINE.json`。

## Markdown 文件职责

| 文件或目录 | 用途 | 何时读取或更新 |
| --- | --- | --- |
| `AGENTS.md` | AI 的总入口：路由、事实源和人工确认边界 | 每次开始工作时 |
| `00-招聘规则.md` | 年龄、年限、隐私与状态的全局规则 | 新建岗位和评估候选人前 |
| `templates/` | 岗位澄清、简历评估、电话沟通、Offer/入职、面试反馈等模板 | 对应环节开始时 |
| `roles/<岗位>/CONTEXT.md` | 已确认规则、待澄清事项和下一步 | 每轮工作结束后 |
| `roles/<岗位>/ROLE_STANDARD.md` | 岗位标准、评分口径和版本记录 | 岗位澄清确认后 |
| `roles/<岗位>/SOURCING_STRATEGY.md` | 公司、Title、项目、技能和搜索词策略 | 岗位标准确认后或复盘时 |
| `roles/<岗位>/PIPELINE.json` | 本岗位主阶段的名称、顺序和阶段状态 | 创建台账和同步看板前 |
| `roles/<岗位>/candidate-ledger.xlsx` | 候选人流程的唯一事实来源；默认预留 1000 条记录，可在创建时调整容量 | 每次人工确认候选人进展后 |
| `roles/<岗位>/招聘数据复盘.html` | 正式招聘复盘看板；同步前会保留同目录 `.bak` 备份 | 每次台账更新后同步 |

候选人简历证据、电话纪要和面试档案使用 Markdown 单独保存；候选人流程状态以 Excel 为准。正式看板只读取同步后的台账数据，不反向修改台账。
