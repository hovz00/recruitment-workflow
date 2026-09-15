---
name: recruit-grill
description: Use when a hiring request or JD needs clarification, or when a role's evidence dimensions, scoring rules, sourcing criteria, or interview stages are not yet confirmed.
---

# 岗位需求澄清

读取 `00-招聘规则.md`、`templates/岗位澄清提示词.md` 与 `docs/SCORING-CONSISTENCY.md`（后者相对项目根目录）。一次只问一个最影响判断的问题；AI 负责拟规则，招聘者选择、纠正和确认，无需填写 JSON。

## 对话与规则

1. 从 JD 提炼业务目标与待澄清事实，先确认最关键的问题。不要把“资深”“懂 AI”等模糊词直接变成规则。依次明确必须项、可协商项、资格规则、误判画像、寻源线索和验证问题。
2. AI 主动拟出 3–5 个能力维度及正整数权重（合计 100），为每维起草至少三个可观察的分值档位：0 为暂无证据，另有至少两个互不重复的 1–10 整数档位。每次解释一个需要选择或纠正的判断；招聘者可回复 A / B / C 或自己的话，不承诺客户端提供按钮。
3. AI 可生成明确标注“虚构”的短证据片段，供招聘者接受、纠正或跳过。未确认样例保持 `pending`，不能作为评分参照；确认后才为 `confirmed`。允许跳过全部样例，保存 `examples: []`，继续完整规则确认。
4. AI 将业务口径转为 `SCORING_RULES.json`，包括版本、维度、档位、复核阈值及 `evaluationProfile.model` / `promptVersion`。模型标识与提示词版本须明确；别名并不保证后端永远不变。
5. 单独逐次确认年龄是否使用及其依据、工作年限是哪种口径，以及实际招聘阶段名称和顺序。面试阶段设置 `kind: "interview"` 与预约字段。资格条件只生成供人核实的提示，不自动拒绝。
6. 展示完整岗位标准、评分规则和流程，请招聘者人工确认版本、确认人及依据。个别选项或样例的确认不能代替完整确认。

## 持久化

| 文件 | 内容 |
| --- | --- |
| `ROLE_STANDARD.md` | 岗位目标、资格规则、能力定义、规则版本和验证问题 |
| `SCORING_RULES.json` | 已确认的可执行评分口径 |
| `SOURCING_STRATEGY.md` | 公司、Title、项目、技能与检索式 |
| `PIPELINE.json` | 已确认的阶段顺序、状态和预约字段 |
| `CONTEXT.md` | 已确认事实、待确认问题和下一步 |
| `KEYWORD_ITERATIONS.md` | 初始寻源假设，标为待验证 |

初始化通过 `--documents`、`--scoring-rules`、`--confirmation` 传入已确认内容；已有岗位使用 `confirm-role-standard.mjs` 记录 `ROLE_CONFIRMATION.json`。标准、流程或规则文件新增、修改、删除后重新确认，旧预览失效。未经确认的内容保留为草稿；旧岗位可继续不涉及评分的跟踪，新增或改分前必须补齐规则和完整评估，不自动重算历史。

## 常见误用

- HR 说“你定吧”：可以代拟完整草案，不能补造确认人或确认依据。
- 为了快而沿用通用档位：必须以该岗位已确认的档位为准。
- 样例跳过就停止建岗：样例可选，完整规则确认仍须完成。
- 把校准讨论当成效果证明：虚构片段用于澄清判断；不上传模拟数据集、报告或真实候选人材料。
