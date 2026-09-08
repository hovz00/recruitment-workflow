# Recruitment Workflow

[![Tests](https://github.com/hovz00/recruitment-workflow/actions/workflows/test.yml/badge.svg)](https://github.com/hovz00/recruitment-workflow/actions/workflows/test.yml)

一套由招聘者确认、AI 工具协助执行的本地招聘工作流。从 JD 和初步画像开始，连接需求澄清、寻源、简历证据评估、电话沟通、面试安排与反馈、Offer / 入职跟进和数据复盘。

适用于 Codex、Claude Code、Cursor 等能读取本地文件、执行命令的工具。岗位规则用 Markdown 保存，候选人流程以 Excel 为唯一事实源；无需模型 API、数据库或部署服务器。

## 开始使用

```bash
git clone https://github.com/hovz00/recruitment-workflow.git
cd recruitment-workflow
npm ci
npm test
```

需要 Node.js 20+。在 AI 工具中打开仓库后，可以直接说：

```text
新建 AI 产品经理岗位。这是 JD 和初步画像：……
先帮我澄清业务目标、核心能力、可协商条件和面试流程。

评估这份简历；来源是员工推荐，收取日期是 2026-09-01。

候选人 C-001 一面通过，待安排二面。先展示更新预览。

同步当前岗位复盘看板，并导出可上传到 recruitment-review 的文件。
```

工具通过 [统一运行协议](workflow/AGENT_PROTOCOL.md) 恢复当前岗位、调用相关 Skill、展示变更预览，再按你的确认更新文件。候选人变更会校验岗位、ID、流程和修改前值，同时写入档案、操作日志与看板；失败时恢复备份。

## 招聘全流程

| 环节 | 主要产物 | 招聘者需要确认 |
| --- | --- | --- |
| JD 与画像澄清 | 岗位标准、证据口径、待核实项、流程配置 | 业务目标、核心要求、可协商项、阶段顺序 |
| 寻源准备 | 公司 / Title / 项目线索、检索式、关键词迭代 | 寻源范围和筛选依据 |
| 简历评估 | 直接 / 间接证据、缺口、电话验证问题 | 来源、收取日期、重复候选人、评估结论 |
| 电话沟通 | 动机、Base、期望、到岗时间、沟通纪要 | 哪些是事实、哪些仍需验证 |
| 约面与面试反馈 | 约面草稿、约定日期、本轮反馈、下一步 | 面试安排与阶段通过 / 终止结论 |
| Offer 与入职 | 接受日期、预计入职日期、跟进待办 | 接受事实、入职事实和流程状态 |
| 招聘复盘 | 即时预览 HTML、标准 XLSX / CSV | 数据质量、反馈适用范围、是否修改策略 |

“一面通过，待安排二面”保留为“一面｜通过”，下一步写“安排二面”，仍计入待跟进。二面时间已确认后进入“二面｜进行中”。约定面试日期与实际进入 / 通过阶段的日期分别记录；未知历史日期留空。最后一个阶段通过才表示流程完成。

[完整虚构业务演练](docs/RECRUITING-WALKTHROUGH.md) · [复盘数据字段与导入说明](docs/REVIEW-DATA.md)

## 即时预览与手动上传

每次确认候选人变更后，会从台账重建岗位目录内的 `招聘数据复盘.html`，用浏览器打开即可预览，也可手动上传其他数据做临时分析。上传不会反向覆盖台账。

导出到独立的 [recruitment-review](https://github.com/hovz00/recruitment-review) 看板：

```bash
node workflow/scripts/export-review-data.mjs --ledger "workflow/roles/岗位名称/candidate-ledger.xlsx" --role "岗位名称" --out "workflow/roles/岗位名称/exports"
```

产物为 `recruitment-review-data.xlsx`、同内容 CSV 和 `导入说明.md`。按照说明配置阶段与 SLA 后，上传其中一个数据文件。导出包含第一行标准表头、动态阶段日期及 Offer 日期，避免原始台账的说明行、配置表被误读。

默认导出和预览移除姓名、候选人 ID、公司、自由文本，姓名替换为本次导出的序号。**仍含候选人级流程明细，并非纯聚合或完全匿名。** 明确需要内部明细时，可给同步 / 导出命令添加 `--privacy internal`；该模式包含个人信息。

## 长期事实源

```text
workflow/roles/<岗位名称>/
├── CONTEXT.md              # 已确认事实、待确认问题与下一步
├── ROLE_STANDARD.md        # 版本化岗位标准
├── SOURCING_STRATEGY.md    # 寻源策略
├── KEYWORD_ITERATIONS.md   # 关键词与命中反馈
├── FEEDBACK_ITERATIONS.md  # 反馈校准记录
├── PIPELINE.json           # 阶段顺序、状态、可选 SLA
├── candidate-ledger.xlsx   # 候选人流程事实源
├── candidates/             # 逐人证据与更新档案
├── ACTION_LOG.md           # 确认写回日志
└── 招聘数据复盘.html        # 本地预览
```

真实岗位、候选人、提案、备份及默认导出目录被 `.gitignore` 排除。`.recruitment-agent/` 和 `AGENT_PROTOCOL.md` 的文件名保留，以兼容此前版本的本地状态；项目对外名称统一为 Recruitment Workflow。

## 旧版本迁移

仓库更名不会自动修正已有 clone 的远程地址。先运行 `git remote -v`，确认 `origin` 指向本页仓库；旧 workflow 的 clone 可能仍指向改名后的存档仓库，不能直接混用。

把需要保留的岗位目录复制到本项目 `workflow/roles/` 后运行：

```bash
node workflow/scripts/migrate-role-workspace.mjs --root . --role "岗位名称"
```

迁移先备份，再保留原有文档和候选人行，补齐日期列、档案目录、日志与新版看板。流程配置和台账不一致时会停止，要求核对映射。旧 `index.html` 会在缺少新文件时迁移为 `招聘数据复盘.html`。不要重新初始化已有岗位。

[本次修复记录](docs/REPAIR-NOTES.md)包含更名处理和兼容性变化。

## 能力边界与验证

AI 整理证据、生成草稿和提出建议；招聘者决定标准、例外及流程结论。项目不抓取招聘平台，不自动发送消息或日历邀请，不自动淘汰、录用或联系候选人。材料缺失标为“待核实”。

自动化测试覆盖岗位恢复、确认写回、回滚、迁移和复盘字段；浏览器测试验证即时预览与 XLSX / CSV 导入：

```bash
npx playwright install chromium
npm run test:browser
```
