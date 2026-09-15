---
name: resume-evidence-review
description: Use when reviewing an authorized resume, explaining inconsistent candidate scores, or preparing a candidate evidence assessment or score change for confirmation.
---

# 简历证据评估

读取 `AGENTS.md`、当前岗位的 `CONTEXT.md`、`ROLE_STANDARD.md`、`PIPELINE.json`、`SCORING_RULES.json`、`ROLE_CONFIRMATION.json`、`candidate-ledger.xlsx`、已有评估记录及 `templates/简历评估提示词.md`。完整字段和命令见项目根目录的 `docs/SCORING-CONSISTENCY.md`。只处理获授权简历；先核对身份、来源与收取日期，缺信息一次只问一个问题。

## 评分步骤

1. 校验岗位标准、流程和评分规则的确认有效。旧岗位缺评分规则时只整理证据和继续不涉及评分的跟踪；先补齐并确认规则才能新增或改分，不临时采用通用分段。
2. AI 生成完整评估输入：`candidate: {id, name}`、`resumeText`、匹配 `evaluationProfile` 的 `model` / `promptVersion`、全部维度 `{id, grade, score, quote, rationale}`，以及可选 `reviewReasons`。覆盖全部 3–5 个维度，原文不得编造。
3. 等级仅用直接证据、间接证据、暂无证据。逐维只能选已确认规则中已有的准确整数档位；暂无证据必须 `score: 0`、`quote: ""`。0 表示材料未体现，不表示能力差。只有 `confirmed` 样例可作参照，`pending` 不生效。
4. 执行 `evaluate-resume.mjs --root <根目录> --input <assessment.json> --session <会话编号>`。脚本校验摘录并自动定位来源行，以返回结果为准。该命令只输出 JSON，不写台账或评估档案。
5. 同候选人、简历、规则和模型/提示词配置已有确认评估时复用它；不能仅靠重新填写维度或 `reviewReasons` 覆盖记录。确需改变判断或新增核实理由时填写 `reevaluationReason`，说明同输入重评的原因，展示差异并重新人工确认。

| 计算项 | 规则 |
| --- | --- |
| 能力证据得分 | Σ(档位分值 × 权重) / 100；缺失证据不改变分母 |
| 证据覆盖率 | (直接证据维度数 + 间接证据维度数) / 全部维度数 × 100 |
| 展示 | 两项保留一位小数；复核阈值比较使用未舍入值 |

## 输出与写回

第一行固定输出：`姓名｜建议｜能力证据得分｜证据覆盖率`，使用脚本的人工复核或补充证据建议。缺规则时标明“待确认评分规则”，不造分。随后写最多三条整体判断，再给出结构化信息、一张逐维证据卡、原文与来源行、缺口、**待核实**项和电话问题。年龄、学历、工作年限按已确认资格口径另列提示，不自行推断。

提案的 `assessment` 为返回的完整 `input` 加 `rulesDigest: result.rulesDigest`；台账修改必须同时包含 `能力证据得分` 与 `证据覆盖率`，分别等于脚本结果。招聘者人工确认后，通过确认脚本将台账、档案和 `candidates/<ID>.assessment.json` 一同事务写入，失败回滚。规则变化使旧确认与预览失效，不自动重算历史。

## 常见误用

- 只改总分、只附摘要、直接编辑台账：必须附完整评估并走确认写回。
- 反复重跑挑高分：优先复用确认记录，重评需要明确原因。
- 把缺失证据当能力否定，或只平均有证据的维度：保留全部维度，同时呈现覆盖率。
- 分数过线就推进、低分就淘汰：建议只供人复核；`reviewReasons` 非空须人工核实。不得自动推进、拒绝、约面或联系候选人。

公式的一致性不保证模型解释完全一致。真实材料、评估记录及模拟数据集或报告不上传 GitHub。
