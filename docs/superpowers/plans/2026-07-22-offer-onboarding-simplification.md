# Offer 与入职统一追踪 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Offer 与入职信息完全纳入既有的主阶段、阶段状态、终止原因、备注和下一步动作，移除台账中的专用 Offer 字段。

**Architecture:** Excel 台账继续是候选人流程事实源，流程阶段由岗位 `PIPELINE.json` 定义，状态始终只能为“进行中、通过、终止”。Offer 或入职的细节不再新增字段，而是由招聘者确认后写入备注、下一步动作或终止原因；路由文件与自动化测试同步约束此规则。

**Tech Stack:** Node.js ESM、ExcelJS、node:test、Markdown。

---

### Task 1: 先锁定统一字段规则

**Files:**
- Modify: `workflow/tests/workflow-hardening.test.mjs:58-66`
- Modify: `workflow/tests/workflow-consistency.test.mjs:14-29`

- [ ] **Step 1: 写入会失败的字段断言**

在 `ledger reserves a configurable capacity...` 测试的日期字段断言之后加入：

```js
assert.equal(ledgerColumns.includes("Offer情况"), false);
```

在 `new role and feedback routes...` 测试末尾加入：

```js
assert.match(agents, /主阶段、阶段状态、终止原因、备注和下一步动作/);
assert.doesNotMatch(agents, /更新 Offer、入职字段/);
```

- [ ] **Step 2: 运行定向测试确认失败**

Run: `npm.cmd test -- --test-name-pattern="configurable capacity|new role and feedback"`

Expected: FAIL；台账仍包含 `Offer情况`，且 Offer/入职路由仍提到专用字段。

### Task 2: 移除专用字段并修正路由说明

**Files:**
- Modify: `workflow/scripts/create-role-ledger.mjs:9-14`
- Modify: `workflow/AGENTS.md:22`

- [ ] **Step 1: 修改台账表头**

从 `ledgerColumns` 数组中删除：

```js
"Offer情况",
```

不增加替代字段。既有 `备注`、`下一步动作`、`终止原因` 保持原有列名和顺序关系。

- [ ] **Step 2: 修改 Offer/入职意图行**

将该行的交付物和写回范围替换为：

```markdown
| “这是 Offer / 入职进展” | 岗位标准、`PIPELINE.json`、候选人档案、台账、`templates/Offer与入职提示词.md` | 主阶段、阶段状态、终止原因、备注和下一步动作草稿 | 人工确认后更新台账中的主阶段、阶段状态、终止原因、备注和下一步动作 |
```

- [ ] **Step 3: 运行定向测试确认通过**

Run: `npm.cmd test -- --test-name-pattern="configurable capacity|new role and feedback"`

Expected: PASS；两项匹配测试均通过。

### Task 3: 全量验证并提交

**Files:**
- Verify: `workflow/tests/*.test.mjs`
- Create: `docs/superpowers/specs/2026-07-22-offer-onboarding-simplification-design.md`
- Create: `docs/superpowers/plans/2026-07-22-offer-onboarding-simplification.md`

- [ ] **Step 1: 运行完整测试集**

Run: `npm.cmd test`

Expected: PASS；创建台账、候选人更新、流程配置、正式复盘看板和文档一致性测试全部通过。

- [ ] **Step 2: 检查提交范围**

Run: `git diff --check; git status --short`

Expected: 只有设计说明、实施计划、台账脚本、路由文档和对应测试发生变化，且无空白错误。

- [ ] **Step 3: 提交并推送**

```powershell
git add docs/superpowers/specs/2026-07-22-offer-onboarding-simplification-design.md docs/superpowers/plans/2026-07-22-offer-onboarding-simplification.md workflow/scripts/create-role-ledger.mjs workflow/AGENTS.md workflow/tests/workflow-hardening.test.mjs workflow/tests/workflow-consistency.test.mjs
git commit -m "Simplify offer and onboarding tracking"
git push origin main
```

