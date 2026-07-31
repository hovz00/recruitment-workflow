# 工作流与招聘复盘看板可靠性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让岗位工作流基于已确认阶段自动生成并同步完整的 `招聘数据复盘.html`，并消除阶段配置覆盖、阶段格式不一致和更新语义含混的问题。

**Architecture:** `PIPELINE.json` 保持唯一阶段来源；台账更新层负责校验和规范化阶段值；同步层负责把台账数据、岗位标题、只读界面状态和待补反馈注入正式模板。模板仍可独立手动使用，但岗位同步产物始终处于只读复盘模式。

**Tech Stack:** Node.js ESM、ExcelJS、node:test、单文件 HTML/CSS/JavaScript、Markdown。

---

### Task 1: 接入新版正式模板并固定岗位看板文件名

**Files:**
- Modify: `workflow/templates/recruitment-review-dashboard.html`
- Modify: `workflow/scripts/create-review-dashboard.mjs`
- Modify: `workflow/tests/auto-dashboard.test.mjs`
- Modify: `README.md`
- Modify: `workflow/README.md`

- [ ] **Step 1: 写入会失败的生成物测试**

在 `workflow/tests/auto-dashboard.test.mjs` 增加测试，调用 `createReviewDashboard` 后断言：

```js
const dashboardPath = path.join(directory, "招聘数据复盘.html");
await createReviewDashboard(dashboardPath);
assert.equal(await fs.stat(dashboardPath).then(() => true), true);
await assert.rejects(createReviewDashboard(dashboardPath), /已存在/);
```

增加 `force` 测试：先写入旧内容，再调用 `createReviewDashboard(dashboardPath, { force: true })`，断言 `.bak` 保存旧内容且目标文件包含正式模板标记。

- [ ] **Step 2: 运行定向测试确认失败**

Run: `npm.cmd test -- --test-name-pattern="force|岗位看板"`

Expected: FAIL；当前创建器没有 `force` 参数，也没有规范生成物测试。

- [ ] **Step 3: 用用户提供的模板替换正式模板**

将 `E:\codex\Recruitment data\index.html` 复制为 `workflow/templates/recruitment-review-dashboard.html`。保留模板可独立使用的手动上传和阶段配置能力；不向模板写入岗位数据。

- [ ] **Step 4: 实现安全重建**

将创建器签名改为：

```js
export async function createReviewDashboard(outputPath, { templatePath = formalDashboardTemplate, force = false } = {})
```

目标存在且 `force` 为 `false` 时抛出已有错误；`force` 为 `true` 时先执行：

```js
await fs.copyFile(outputPath, `${outputPath}.bak`);
await fs.copyFile(templatePath, outputPath);
```

CLI 解析 `--force`，并在 `--out` 缺失时输出用法。

- [ ] **Step 5: 更新用户可见命令**

将 README 和 workflow README 中的岗位看板文件名统一为 `招聘数据复盘.html`；重建示例使用：

```powershell
node workflow/scripts/create-review-dashboard.mjs --out "岗位/岗位名称/招聘数据复盘.html" --force
```

- [ ] **Step 6: 运行定向测试确认通过**

Run: `npm.cmd test -- --test-name-pattern="force|岗位看板"`

Expected: PASS。

### Task 2: 规范候选人阶段与直接状态更新

**Files:**
- Modify: `workflow/scripts/update-candidate-ledger.mjs`
- Modify: `workflow/scripts/pipeline-config.mjs`
- Modify: `workflow/AGENTS.md`
- Modify: `workflow/templates/CONTEXT.md`
- Modify: `workflow/00-招聘规则.md`
- Modify: `workflow/tests/candidate-ledger-update.test.mjs`
- Modify: `workflow/tests/workflow-consistency.test.mjs`

- [ ] **Step 1: 写入会失败的阶段规范化测试**

在候选人更新测试中建立阶段 `0-简历初筛`、`1-电话沟通` 的台账。新增两个断言：

```js
const patch = stageStatusToLedgerPatch({ candidateId: "C-001", name: "候选人A", stage: "电话沟通", status: "进行中" }, pipeline);
assert.equal(patch["主阶段"], "1-电话沟通");

assert.throws(
  () => stageStatusToLedgerPatch({ candidateId: "C-001", name: "候选人A", stage: "不存在阶段", status: "进行中" }, pipeline),
  /PIPELINE\.json|主阶段/,
);
```

再覆盖终止状态无原因时报错、非终止状态清空终止原因，以及旧 `decisionToLedgerPatch` 继续可用。

- [ ] **Step 2: 运行定向测试确认失败**

Run: `npm.cmd test -- --test-name-pattern="规范化|直接状态|终止原因"`

Expected: FAIL；当前脚本没有 `stageStatusToLedgerPatch`。

- [ ] **Step 3: 实现阶段解析与首选更新接口**

在 `update-candidate-ledger.mjs` 增加：

```js
export function normalizeStage(stage, pipeline) {
  const matches = pipeline.stages.filter(({ id, name }) => stage === `${id}-${name}` || stage === name);
  if (matches.length !== 1) throw new Error("主阶段必须匹配 PIPELINE.json 中唯一的编号-名称或名称。");
  return `${matches[0].id}-${matches[0].name}`;
}

export function stageStatusToLedgerPatch({ candidateId, name, stage, status, reason = "", note = "" }, pipeline) {
  const mainStage = normalizeStage(stage, pipeline);
  if (!["进行中", "通过", "终止"].includes(status)) throw new Error("阶段状态只能为：进行中、通过、终止。");
  if (status === "终止" && !reason.trim()) throw new Error("阶段状态为终止时必须提供终止原因。");
  return { "候选人ID": candidateId, "姓名": name, "主阶段": mainStage, "阶段状态": status, "终止原因": status === "终止" ? reason : "", "备注": note };
}
```

`upsertCandidates` 接收 `pipeline`，有 `status` 的候选人调用新接口；只有 `decision` 时调用兼容接口。CLI 新增 `--pipeline`，直接状态更新时要求传入该文件。

- [ ] **Step 4: 写清规则与上下文**

在 `workflow/00-招聘规则.md`、`workflow/AGENTS.md` 与 `workflow/templates/CONTEXT.md` 明确写入：台账主阶段保存格式必须是 `编号-名称`；输入裸名称时脚本根据该岗位 `PIPELINE.json` 规范化；不得手写未知阶段。文档示例采用直接 `stage` + `status` 更新，不再推荐 `decision`。

- [ ] **Step 5: 运行定向测试确认通过**

Run: `npm.cmd test -- --test-name-pattern="规范化|直接状态|终止原因"`

Expected: PASS。

### Task 3: 同步为只读招聘复盘页并写入岗位上下文

**Files:**
- Modify: `workflow/scripts/sync-dashboard-data.mjs`
- Modify: `workflow/tests/auto-dashboard.test.mjs`
- Modify: `workflow/templates/CONTEXT.md`
- Modify: `README.md`
- Modify: `workflow/README.md`

- [ ] **Step 1: 写入会失败的同步模式测试**

调用：

```js
const result = injectAutoLedgerData(source, rows, ["0-简历初筛"], { role: "AI 产品经理" });
```

断言注入代码包含：

```js
document.getElementById('stageConfigModal').classList.remove('active');
document.getElementById('fileInput').disabled = true;
document.querySelectorAll('[data-upload-entry]').forEach((element) => element.hidden = true);
document.title = 'AI 产品经理｜招聘数据复盘';
```

另建一条含一面日期、空面试反馈摘要的台账记录，断言注入数据含 `待补面试反馈: true`；创建 `CONTEXT.md` 后调用 `syncDashboard`，断言其中出现“最近同步时间”和“最近同步记录数”。

- [ ] **Step 2: 运行定向测试确认失败**

Run: `npm.cmd test -- --test-name-pattern="只读|待补|最近同步|岗位标题"`

Expected: FAIL；当前同步不会隐藏上传入口、更新标题或写上下文。

- [ ] **Step 3: 实现同步运行时块**

将 `injectAutoLedgerData` 改为接收一个选项对象：

```js
injectAutoLedgerData(html, rows, stageOrder, { role, syncedAt, feedbackPending = [] })
```

在 `applyAutoLedgerData` 成功转换非空数据后：关闭阶段弹窗，保持 `fileInput.disabled = true`，给 `document.body` 添加 `data-workflow-synced="true"`，隐藏所有 `data-upload-entry`，更新 `document.title` 和页面主标题，渲染只读数据来源提示与待补反馈提示。将该逻辑置于 `rawData.length === 0` 判断之后，保证空台账不切换模式。

- [ ] **Step 4: 将新版模板标记为可控入口**

在正式模板的上传按钮、空态上传操作和文件输入附近添加 `data-upload-entry`；在主标题增加稳定属性 `data-dashboard-title`；在标题下增加 `data-workflow-sync-notice` 与 `data-feedback-pending-notice` 的隐藏容器。为 `body[data-workflow-synced="true"]` 添加样式，确保这些提示可见、上传入口不可见。漏斗标题附近增加明确的累计口径说明。

- [ ] **Step 5: 写入同步上下文**

增加 `updateSyncContext(contextPath, { dashboardName, records, syncedAt })`：替换或追加三行：

```markdown
- 最近同步时间：YYYY-MM-DD HH:mm
- 最近同步记录数：N
- 招聘复盘看板：招聘数据复盘.html
```

CLI 支持 `--context`；未传时只同步看板，不推断或修改其他文件。

- [ ] **Step 6: 更新命令示例**

同步命令使用：

```powershell
node workflow/scripts/sync-dashboard-data.mjs --ledger "岗位/岗位名称/candidate-ledger.xlsx" --dashboard "岗位/岗位名称/招聘数据复盘.html" --role "岗位名称" --context "岗位/岗位名称/CONTEXT.md"
```

- [ ] **Step 7: 运行定向测试确认通过**

Run: `npm.cmd test -- --test-name-pattern="只读|待补|最近同步|岗位标题"`

Expected: PASS。

### Task 4: 为全部脚本加入帮助入口并完成回归

**Files:**
- Modify: `workflow/scripts/create-role-ledger.mjs`
- Modify: `workflow/scripts/create-review-dashboard.mjs`
- Modify: `workflow/scripts/sync-dashboard-data.mjs`
- Modify: `workflow/scripts/update-candidate-ledger.mjs`
- Modify: `workflow/tests/auto-dashboard.test.mjs`
- Modify: `workflow/tests/ledger-schema.test.mjs`
- Modify: `README.md`
- Modify: `workflow/README.md`

- [ ] **Step 1: 写入会失败的帮助命令测试**

为四个脚本运行 `node <script> --help`，断言退出码为 0，输出同时包含 `用法` 与各脚本的主参数。例如：

```js
const { stdout } = await execFileAsync(process.execPath, ["workflow/scripts/sync-dashboard-data.mjs", "--help"]);
assert.match(stdout, /--ledger/);
assert.match(stdout, /--dashboard/);
assert.match(stdout, /--role/);
```

- [ ] **Step 2: 运行定向测试确认失败**

Run: `npm.cmd test -- --test-name-pattern="help"`

Expected: FAIL；当前脚本将 `--help` 当作缺少参数处理。

- [ ] **Step 3: 实现统一帮助判定**

在每个 CLI 入口最先加入：

```js
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(helpText);
  return;
}
```

`helpText` 必须包括用途、必填参数、可选参数与一条实际命令示例；`create-review-dashboard` 包含 `--force`，`sync-dashboard-data` 包含 `--context`，`update-candidate-ledger` 包含 `--pipeline`。

- [ ] **Step 4: 运行全量测试与静态检查**

Run: `npm.cmd test; git diff --check; git status --short`

Expected: 所有测试通过；无空白错误；仅模板、四个脚本、文档与测试发生变化。

- [ ] **Step 5: 提交并推送**

```powershell
git add workflow/templates/recruitment-review-dashboard.html workflow/scripts/create-role-ledger.mjs workflow/scripts/create-review-dashboard.mjs workflow/scripts/sync-dashboard-data.mjs workflow/scripts/update-candidate-ledger.mjs workflow/tests/auto-dashboard.test.mjs workflow/tests/candidate-ledger-update.test.mjs workflow/tests/ledger-schema.test.mjs workflow/tests/workflow-consistency.test.mjs workflow/AGENTS.md workflow/00-招聘规则.md workflow/templates/CONTEXT.md README.md workflow/README.md docs/superpowers/plans/2026-07-23-workflow-dashboard-reliability.md
git commit -m "Harden workflow dashboard sync"
git push origin main
```
