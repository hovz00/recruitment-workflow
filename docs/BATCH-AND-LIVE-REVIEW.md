# 批次确认与实时复盘

可以直接对 AI 说：“把当前岗位这批候选人的更新整理成批次，展示差异，按我确认的范围执行；同时打开实时复盘看板。”AI 按运行协议管理会话、调用命令和打开页面。下面的命令用于工具接入与排查，普通使用者无需逐条输入。

## 建立和确认批次

使用当前对话的会话编号。输入 JSON 为 `{"proposals": [...]}`，数组条目与单人提案一致：`role`、`intent`（`candidate_create` 或 `candidate_update`）、`candidate: {id, name}`、`changes: [{field, before, after}]`、`evidence`。更新必须给出真实 `before`；新增必须包含来源、收取日期、阶段和状态。岗位标准须先确认，同名核实与跨岗核对仍适用。

```bash
node workflow/scripts/candidate-batch.mjs create --root . --session <会话编号> --input <提案文件.json>
node workflow/scripts/candidate-batch.mjs show --root . --session <会话编号> --batch <返回的批次ID>
```

每批 1–200 条，同一岗位、每名候选人一条。预览不写业务文件；它记录不可直接修改的条目 ID、差异、依据、标准摘要和事实摘要。多个批次可以并存，但同岗一个批次执行后，其他批次的旧事实摘要会失效。

向招聘者展示完整差异，获得确认后选择执行方式：

```bash
# 只执行已确认的条目；ID 来自 create/show 的 items
node workflow/scripts/candidate-batch.mjs apply --root . --session <会话编号> --batch <批次ID> --items <条目ID1,条目ID2>

# 整批已获确认时，可以分段执行；之后用相同批次续跑
node workflow/scripts/candidate-batch.mjs apply --root . --session <会话编号> --batch <批次ID> --limit 20
node workflow/scripts/candidate-batch.mjs apply --root . --session <会话编号> --batch <批次ID>

# 修复失败原因、确认原提案仍适用后明确重试
node workflow/scripts/candidate-batch.mjs apply --root . --session <会话编号> --batch <批次ID> --items <失败条目ID> --retry-failed

# 取消尚未完成的条目
node workflow/scripts/candidate-batch.mjs cancel --root . --session <会话编号> --batch <批次ID> --items <条目ID> --reason "招聘者确认暂不推进"
```

`show` 返回 pending、applied、failed、cancelled 的数量，以及每条的结果、尝试次数和错误。`--limit` 限制本次尝试数量，不能代替 `--items` 表达部分确认。再次执行跳过成功/取消条目，普通续跑也跳过失败条目；失败需要显式重试。任何一条失败，本轮停在该条，之前成功记录保留，后续条目仍待处理。已成功条目不能用取消撤销，需按当前事实生成新变更。

每条写回同时更新台账、档案、日志、离线看板与进度。条目之间释放写锁，其他岗位可继续工作。批次自身成功不会使剩余条目失效；其他操作改变同岗台账或标准后，停止旧批次，按当前事实重新预览剩余条目。单人预览仍独立使用“同会话同岗位最新一份”规则。

## 中断与恢复

Ctrl+C 会在当前条目完成或回滚后暂停，可以用 `show` 查看，再执行剩余条目。普通异常会回滚当前条目；不会为了整批失败撤销已成功的招聘记录。

强制结束进程、断电或回滚失败时，可能留下 `inFlight` 未完成事务和写锁。系统会阻止盲目续跑。先确认原写入进程已经退出，再检查 `.recruitment-agent/backups/<backupId>/manifest.json`、对应备份和业务文件；核实并恢复一致状态后，对剩余工作生成新预览。不能仅删除锁就重放原条目。此版本不提供跨断电的自动事务恢复，也不是多账号权限系统。

## 打开实时看板

```bash
# 持续读取启动时选中的岗位台账
node workflow/scripts/serve-review-dashboard.mjs --root . --session <会话编号>

# 或持续读取该岗位的一个标准导出文件
node workflow/scripts/serve-review-dashboard.mjs --root . --session <会话编号> --source "workflow/roles/岗位名称/exports/recruitment-review-data.xlsx"
```

打开返回的 `http://127.0.0.1:<端口>/<随机路径>`。本地服务默认约每 2 秒检查源，浏览器约每 2 秒获取最新结果；正常更新通常数秒可见，写入繁忙时等待。页面无需刷新。启动岗位固定，不随其他对话或当前会话切岗而改变；需要看另一岗位时另开服务。

`--source` 支持标准导出的 CSV / XLSX，必须与启动岗位及其 `PIPELINE.json` 一致。XLSX 只接受 `export-review-data.mjs` 生成的单表“招聘数据”文件，不接受操作台账。指定源文件被重新导出覆盖后，页面自动读取有效的新内容。服务不生成新的导出文件，也不回写任何业务数据。

| 情况 | 页面行为 |
| --- | --- |
| 源数据有效变化 | 自动更新数据与图表 |
| 写锁占用、文件尚未写完 | 保留有效视图，等待后重试 |
| 表头错误、数据无效、文件缺失 | 显示读取状态，保留有效视图；修复后自动恢复 |
| 服务停止或断开 | 显示连接失败，保留当前视图 |
| 手动上传或打开阶段配置 | 暂停实时覆盖，允许手动预览 |
| 点击“恢复指定源” | 放弃当前手动预览，恢复启动时的数据源和阶段 |

手动选择上传的文件不会被持续跟踪。需要持续读取它，应先生成标准导出，再用 `--source` 启动。关闭服务用 Ctrl+C；普通离线 HTML 仍为快照，需重新同步后刷新。本地服务默认去标识化，仅监听本机回环地址；明确需要内部明细时才使用 `--privacy internal`。两种模式仍是候选人级流程记录，口径见 [复盘数据约定](REVIEW-DATA.md)。
