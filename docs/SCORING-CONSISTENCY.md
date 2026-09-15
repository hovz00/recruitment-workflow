# 岗位评分规则与证据复核

评分分为两步：AI 按岗位规则摘录证据、选择档位；本地脚本校验证据并计算总分、覆盖率和复核建议。规则与输入一致时，计算结果一致。证据属于哪个维度、是否充分以及应选哪个档位，仍需要模型解释和招聘者核实；本项目不承诺不同模型或不同轮次的语义判断完全一致。

## 招聘者如何参与

岗位澄清保持一次只问一个问题。AI 先从 JD 中拟出 3–5 个能力维度、权重和可观察的评分档位，再逐项解释，请招聘者选择、纠正或补充业务事实。招聘者无需编写 JSON。可以用 A / B / C 或自己的话回复；是否有可点击选项取决于 AI 客户端。

AI 可提供明确标记为虚构的短证据片段供校准。每次只讨论一个判断，招聘者可接受、修改或跳过；也可跳过全部样例，保存 `examples: []`。样例为 `pending` 时不参与评分口径，只有确认的样例才可作为校准参照。跳过样例不会阻止确认完整规则。

最终展示完整规则、岗位标准和流程供招聘者确认。样例确认不替代整套规则确认；修改权重、档位或模型配置后，必须重新展示相关差异并确认。

## 岗位规则文件

每个使用评分的岗位保存 `SCORING_RULES.json`，与 `ROLE_STANDARD.md`、`PIPELINE.json` 一起绑定到 `ROLE_CONFIRMATION.json`。

| 字段 | 约束与含义 |
| --- | --- |
| `schemaVersion` | 固定为 `1` |
| `version` | 非空规则版本 |
| `evaluationProfile` | `model`、`promptVersion` 均须明确；评估输入必须一致 |
| `dimensions` | 3–5 项，每项具有唯一 `id`、`name`、`requirement`、正整数 `weight` 和 `anchors`；权重合计 100 |
| `anchors` | 至少三个档位，每项含 `score` 和非空 `description`；必须有 0 档及至少两个不重复的 1–10 整数档位；AI 只能选择规则中已有的准确分值 |
| `recommendation` | `minScore` 为 0–10，`minCoverage` 为 0–100；`requiredDimensions` 为 `{id, minScore}` 数组，引用已有维度 |
| `examples` | 可省略或为空；每项为 `{id, dimensionId, text, grade, score, status}`，`grade` 使用下述三级证据，`status` 为 `pending` 或 `confirmed` |

档位描述应写明行动、本人责任、范围、结果等可观察依据。不要把“经验丰富”“优秀”作为独立评分依据，也不要将姓名、年龄或学历隐含进能力评分。资格信息按岗位标准另列人工核实提示。

`evaluationProfile` 固定评估使用的模型标识与提示词版本。模型别名可能指向变化的后端；仅记录同一别名不能证明模型实现不变。可用明确版本标识时优先记录明确版本。

## 证据与计算

| 等级 | 含义 | 覆盖率计数 |
| --- | --- | --- |
| 直接证据 | 行动、本人责任与结果明确 | 1 |
| 间接证据 | 经历相关，范围、责任或结果尚不完整 | 1 |
| 暂无证据 | 材料没有体现，需要补充核验 | 0 |

全部维度都必须提交。`暂无证据` 的 `score` 为 0、`quote` 为空。其他维度须提供简历原文摘录、档位分值和理由；脚本验证摘录存在于 `resumeText` 并定位来源行，AI 不自行编造行号。0 分表示当前材料尚无证据，不表示候选人没有能力。

```text
能力证据得分 = Σ(各维度档位分值 × 权重) / 100
证据覆盖率 = (直接证据维度数 + 间接证据维度数) / 全部维度数 × 100
```

两项结果保留一位小数。缺失维度仍在总分分母中，不能只对有证据的维度重新归一化；阅读总分时必须同时看覆盖率与缺口。间接证据在覆盖率中计 1，证据是否完整由档位和理由表达。

建议结合总分、覆盖率和必要维度阈值，供人工复核或补充证据使用；阈值比较使用未舍入值，展示值的四舍五入不会改变判断。`reviewReasons` 非空时要求人工核实。任何建议都不能自动推进、拒绝或联系候选人。

## 命令与确认写回

下列文件由 AI 根据对话生成，招聘者只需核对自然语言预览。命令均在项目根目录执行，路径按实际文件替换：

```bash
node workflow/scripts/initialize-role-workspace.mjs --root . --role "岗位名称" --pipeline "PIPELINE.json" --documents "documents.json" --scoring-rules "SCORING_RULES.json" --confirmation "confirmation.json" --session "会话编号"
node workflow/scripts/evaluate-resume.mjs --root . --input "assessment.json" --session "会话编号"
```

`documents.json` 是已确认 Markdown 文件名到全文的映射；`confirmation.json` 包含真实确认的 `version`、`confirmedBy`、`evidence`。已有岗位在核对并确认完整规则后，使用 `confirm-role-standard.mjs` 记录确认，具体命令见[岗位确认与数据校验](WORKFLOW-GUARDS.md)。

`assessment.json` 输入字段：

| 字段 | 内容 |
| --- | --- |
| `candidate` | `{id, name}`，与候选人提案一致 |
| `resumeText` | 获授权使用的完整评估文本 |
| `model`、`promptVersion` | 与岗位 `evaluationProfile` 一致 |
| `dimensions` | `{id, grade, score, quote, rationale}` 数组，逐一覆盖岗位维度 |
| `reviewReasons` | 可选的非空核实理由数组 |
| `reevaluationReason` | 同一输入需要重新评估并覆盖已有确认结果时，明确说明原因 |

评估命令只向标准输出返回 JSON，不写候选人档案或台账。返回对象含 `input`、`result`、`reused`；`result` 包含 `rulesDigest`、`evaluationKey`、`score`、`coverage`、`recommendation` 和各维度的 `sourceLine`。这是证据校验和计算入口，不负责调用模型或提取 PDF。

AI 使用返回的完整 `input`，补上 `rulesDigest: result.rulesDigest`，作为候选人提案的 `assessment`。评分提案必须同时包含 `能力证据得分` 和 `证据覆盖率`，两值分别等于 `result.score` 和 `result.coverage`；不能只提交一个自填总分或仅附摘要。

```bash
node workflow/scripts/create-pending-action.mjs --root . --input "proposal.json" --session "会话编号"
```

展示返回的提案预览，收到招聘者人工确认后，使用该提案编号执行：

```bash
node workflow/scripts/apply-confirmed-action.mjs --root . --proposal "提案编号" --session "会话编号"
```

招聘者确认预览后，写回脚本再次验证规则、原文和计算结果，并将 `candidates/<ID>.assessment.json` 与台账、候选人档案及日志一同事务写入；失败时一同回滚。该文件保存当前确认记录及 `history` 中的先前完整确认记录，重评原因随输入保留。评估记录含简历文本，只在受控本地保存。

## 复用、变更与旧岗位

同一候选人的简历文本、规则及模型/提示词配置一致时，只读评估命令复用已确认的评估记录，并返回 `reused: true`；未确认的临时评估不成为历史事实。未声明重评时，新提交的维度判断或 `reviewReasons` 不会替换已有记录。需要调整判断或新增核实理由时填写 `reevaluationReason`，展示差异与理由，经人工确认后才覆盖记录。不要通过无理由反复重跑挑选更高得分。

规则文件新增、修改或删除都会使原岗位确认与旧预览失效。重新确认只确立后续使用的口径，不会自动重算已有候选人。历史分数保留原依据；需要重评时逐人或按已确认批次执行，不能宣称不同规则版本的历史得分天然可比。

复用先查当前确认记录，再查历史中的最近匹配记录。例如材料从 A 改为 B，后来恢复为完全相同的 A 时，会复用先前确认的 A 评估；只有明确提供 `reevaluationReason` 才对同一输入重新评估。

旧岗位可以继续不涉及评分的流程跟踪。新增或变更任何分数、覆盖率之前，必须补齐并确认规则，再生成完整评估。规则尚未确认时只整理材料和待核实项，不临时采用通用档位。

规则模板与公式说明可以纳入代码仓库；真实候选人材料、评估记录，以及模拟数据集和模拟报告不上传到 GitHub。虚构校准片段只用于讨论规则，不作为实际评估结果或效果证明。
