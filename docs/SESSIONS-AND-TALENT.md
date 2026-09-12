# 多对话与跨岗位人才管理

## 对话独立选择岗位

AI 在每个新对话开始时创建一次会话，可先不选岗位：

```bash
node workflow/scripts/create-session.mjs --root .
```

如已知道岗位，添加 `--role "岗位名称"`。保存返回的 `sessionId`，同一对话后续沿用。编号使用小写字母、数字、连字符和下划线；优先使用脚本生成的 UUID，不把姓名或联系方式放进编号。

```bash
node workflow/scripts/set-current-role.mjs --root . --session "返回的会话编号" --role "岗位名称"
node workflow/scripts/get-role-snapshot.mjs --root . --session "返回的会话编号"
node workflow/scripts/create-pending-action.mjs --root . --session "返回的会话编号" --input "候选人提案.json"
node workflow/scripts/apply-confirmed-action.mjs --root . --session "返回的会话编号" --proposal "返回的提案编号"
```

上面的中文占位文本须替换为实际返回值。`initialize-role-workspace.mjs` 和 `confirm-role-standard.mjs` 也支持相同的 `--session`。新建岗位只选择为本会话当前岗位，其他会话的选择不变。同步/导出使用显式台账路径，AI 应从本会话快照对应的岗位目录取得路径。

会话信息保存在 `.recruitment-agent/sessions/<编号>/`。重新打开工具时，让 AI 使用原编号恢复；不明确原编号时建立新会话并明确选择岗位，不猜测其他对话的状态。旧脚本不传 `--session` 时维持全局模式，可继续单对话使用；命名会话不会借用全局岗位。更换会话后不要拿旧会话提案直接执行。

两个会话分别管理不同岗位时可同时发起命令；本地写锁会让写入串行完成，最多等待 5 秒。两者操作同一个岗位时，先完成的写入会使另一份旧预览失效，需要根据新事实重新预览。锁超时不会丢数据，也不会自动清除锁；确认原进程退出后再处理残留锁。该机制不提供多账号权限隔离。

## 查找重复申请与关联身份

候选人台账继续保存岗位申请事实。`talent-registry.json` 只保存统一人才编号、申请引用和确认事件，不复制简历原文、联系方式或岗位评分。

```bash
node workflow/scripts/query-talent.mjs --root . --name "待核实的姓名"
node workflow/scripts/query-talent.mjs --root . --role "岗位名称" --candidate "候选人ID"
```

姓名查询结果只作为核对线索。使用岗位和候选人 ID 可以查看该申请已经关联的各岗位状态，以及尚未关联的同名申请。历史台账无需自动批量迁移；按需核实后建立关联。缺失 ID 或姓名的记录会显示问题提示，暂不计入查询人数。索引已有引用找不到对应申请时，查询会报错，需要先核对或恢复数据。

确认同一人投递多个岗位后，把下列结构保存为本地 JSON，填入实际对象与确认依据：

```json
{
  "action": "link",
  "source": {"role": "源岗位", "candidateId": "源候选人ID"},
  "target": {"role": "目标岗位", "candidateId": "目标候选人ID"},
  "confirmedSamePerson": true,
  "relationship": "parallel",
  "confirmedBy": "实际确认人",
  "evidence": "实际身份核实依据"
}
```

目标岗位须为本会话当前岗位，源与目标申请均已存在。同名不同人无需关联；已经分别关联成组时，预览会列出合并涉及的全部申请。一个组不能包含同岗位的两个候选人 ID，发现这种冲突应先核对原始身份。

```bash
node workflow/scripts/create-identity-proposal.mjs --root . --session "返回的会话编号" --input "身份提案.json"
node workflow/scripts/apply-identity-proposal.mjs --root . --session "返回的会话编号" --proposal "返回的身份提案编号"
```

AI 应先展示源岗位、目标岗位、全部受影响申请、关联依据和前后身份关系；招聘者明确确认后才运行执行命令。普通的候选人变更确认不等于身份关联确认。命令只保存确认结果，不替招聘者进行身份核实。

## 跨岗推荐与误关联纠正

跨岗推荐先确认候选人意愿，按目标岗位的标准独立评估，创建目标岗位申请，再用 `relationship: "referral"` 关联。两步分别预览确认：目标申请建立成功、身份关联失败时，目标申请仍保留为独立申请，核实后可重做关联。源岗位继续保留自己的历史和当前状态；确需退出原岗位时另行确认更新。

发现误关联时，用下面的请求重新预览并确认：

```json
{
  "action": "unlink",
  "target": {"role": "需要分离的岗位", "candidateId": "需要分离的候选人ID"},
  "confirmedBy": "实际确认人",
  "evidence": "重新核实后解除关联的具体原因"
}
```

目标申请获得独立人才编号，组内其余申请保持关联。解除不删除任何申请、简历或历史事件。再次确认属于同一人时，可以重新关联。所有受影响岗位的日志和候选人档案会追加操作依据；写入异常会恢复此次操作前的文件，并保留预览供核实后重试。

## 统计与当前边界

- `applicationCount` 是具有有效 ID 和姓名的岗位申请记录数。
- `personCount` 仅按已确认关联去重；未核实的跨岗重复申请仍暂按不同人计算。查询返回 `issues` 时，应先说明记录缺口。
- 复盘看板和标准 XLSX/CSV 继续按岗位申请记录统计，不使用统一人才编号改变漏斗分母，也不导出人才关联索引。
- 当前最新预览按会话和岗位保存，不提供同会话的批量确认队列。台账满额仍需维护容量；已打开的看板仍需刷新。
- 身份索引、提案、备份以及真实招聘资料全部留在本地，不提交公开仓库。身份关系变更后保存整个工作区的备份，避免只恢复单个岗位导致引用不一致。
