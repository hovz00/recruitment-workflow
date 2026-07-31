---
name: recruit-grill
description: Turn an ambiguous hiring request into a confirmed role standard, sourcing strategy, and durable local role context through one-question-at-a-time clarification.
---

# 岗位需求澄清

读取 `00-招聘规则.md` 与 `templates/岗位澄清提示词.md`。一次只问一个最影响筛选的问题，不要把模糊的“资深”“懂 AI”“年轻”等词直接转换为规则。

依次确认：岗位目标与业务场景、核心能力和证据口径、硬性标准与可协商项、学历、年龄是否作为评分参考、工作年限是总年限还是对口岗位/项目年限、误判画像、对标公司、岗位 Title、项目线索、技能关键词，以及电话验证问题。

把已确认内容写入：

1. `ROLE_STANDARD.md`：版本化标准、资格规则、能力维度和验证问题；
2. `SOURCING_STRATEGY.md`：检索式、公司、Title、项目与技能线索；
3. `CONTEXT.md`：已确认标准、待确认问题、材料边界和下一步；
4. `KEYWORD_ITERATIONS.md`：初始假设标记为待验证，而非已生效经验。
5. `PIPELINE.json`：招聘者确认的主阶段名称、连续顺序与阶段状态。

未确认的内容只放进“待确认问题”。年龄或年限即使被业务方要求，也要明确其是硬性标准、评分参考还是仅供沟通核实；所有规则生效都需要人工确认。
