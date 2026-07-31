import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { ledgerColumns } from "./create-role-ledger.mjs";
import { readPipeline } from "./pipeline-config.mjs";
import { normalizeStage } from "./update-candidate-ledger.mjs";
import { syncDashboard } from "./sync-dashboard-data.mjs";
import { stateDirectory } from "./agent-state.mjs";

const dateFields = new Set(["简历收取时间", "状态更新时间", "下次跟进日期", "一面日期", "二面日期", "三面日期", "HRBP日期", "决策会日期", "最后更新时间"]);
const protectedFields = new Set(["候选人ID", "姓名"]);
const allowedFields = new Set(ledgerColumns.filter((field) => !protectedFields.has(field)));
const pendingDirectory = (rootPath) => path.join(stateDirectory(rootPath), "pending-actions");
const proposalPath = (rootPath, proposalId) => path.join(pendingDirectory(rootPath), `${proposalId}.json`);

function normalizedText(value) { return String(value ?? "").trim(); }
function safeRoleName(role) {
  const value = normalizedText(role);
  if (!value || value !== path.basename(value) || value.includes("..")) throw new Error("岗位名称不合法。");
  return value;
}
function comparable(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  return normalizedText(value);
}
function writeValue(field, value) {
  if (dateFields.has(field) && /^\d{4}-\d{2}-\d{2}$/.test(normalizedText(value))) return new Date(`${value}T00:00:00`);
  return value ?? "";
}
function actionTitle(intent) { return intent === "candidate_create" ? "新增候选人" : "候选人状态更新"; }

function validateProposal(proposal) {
  const candidate = proposal?.candidate ?? {};
  if (!safeRoleName(proposal?.role)) throw new Error("提案必须指定岗位。");
  if (!["candidate_create", "candidate_update"].includes(proposal?.intent)) throw new Error("提案 intent 必须为 candidate_create 或 candidate_update。");
  if (!normalizedText(candidate.id) || !normalizedText(candidate.name)) throw new Error("提案必须包含候选人 ID 和姓名。");
  if (!Array.isArray(proposal.changes) || proposal.changes.length === 0) throw new Error("提案至少需要一项字段变更。");
  for (const change of proposal.changes) {
    if (!allowedFields.has(change?.field)) throw new Error(`不允许写入字段：${change?.field ?? ""}`);
    if (!("after" in change)) throw new Error(`字段 ${change.field} 缺少 after。`);
  }
}

export async function createPendingAction({ rootPath, proposal }) {
  validateProposal(proposal);
  const id = proposal.id ?? `P-${crypto.randomUUID()}`;
  const stored = {
    ...proposal,
    id,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  await fs.mkdir(pendingDirectory(rootPath), { recursive: true });
  await fs.writeFile(proposalPath(rootPath, id), `${JSON.stringify(stored, null, 2)}\n`, "utf8");
  return stored;
}

async function loadProposal(rootPath, proposalId) {
  if (!normalizedText(proposalId)) throw new Error("确认执行需要待确认提案编号。");
  let proposal;
  try { proposal = JSON.parse(await fs.readFile(proposalPath(rootPath, proposalId), "utf8")); }
  catch (error) { if (error?.code === "ENOENT") throw new Error("待确认提案不存在或已执行。请重新生成变更预览。"); throw error; }
  validateProposal(proposal);
  return proposal;
}

async function backupFiles(rootPath, proposalId, files) {
  const backupDirectory = path.join(stateDirectory(rootPath), "backups", proposalId);
  await fs.mkdir(backupDirectory, { recursive: true });
  const manifest = [];
  for (const target of files) {
    const existed = await fs.access(target).then(() => true).catch(() => false);
    const backup = path.join(backupDirectory, `${manifest.length}-${path.basename(target)}`);
    if (existed) await fs.copyFile(target, backup);
    manifest.push({ target, backup, existed });
  }
  return manifest;
}
async function restoreFiles(manifest) {
  for (const item of manifest) {
    if (item.existed) await fs.copyFile(item.backup, item.target);
    else await fs.rm(item.target, { force: true });
  }
}

async function readLedger(ledgerPath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(ledgerPath);
  const sheet = workbook.getWorksheet("候选人台账");
  if (!sheet) throw new Error("未找到“候选人台账”工作表。");
  const headers = sheet.getRow(3).values.slice(1).map(normalizedText);
  const index = new Map(headers.map((header, position) => [header, position + 1]));
  return { workbook, sheet, index };
}

function findCandidateRow(sheet, index, candidate) {
  let match = null;
  const idColumn = index.get("候选人ID");
  const nameColumn = index.get("姓名");
  for (let rowNumber = 4; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    if (normalizedText(row.getCell(idColumn).value) === candidate.id) {
      if (match) throw new Error("候选人 ID 在台账中重复，已停止写入。");
      match = row;
    }
  }
  if (!match) return null;
  if (normalizedText(match.getCell(nameColumn).value) !== candidate.name) throw new Error("候选人 ID 与姓名不一致，已停止写入。");
  return match;
}

function firstEmptyRow(sheet, index) {
  const idColumn = index.get("候选人ID");
  for (let rowNumber = 4; rowNumber <= sheet.rowCount; rowNumber += 1) if (!normalizedText(sheet.getRow(rowNumber).getCell(idColumn).value)) return sheet.getRow(rowNumber);
  throw new Error("候选人台账没有空行，请先扩容台账。");
}

function validateChanges({ proposal, row, index, pipeline }) {
  const changeMap = new Map(proposal.changes.map((change) => [change.field, change.after]));
  for (const change of proposal.changes) {
    if (proposal.intent === "candidate_update" && comparable(row.getCell(index.get(change.field)).value) !== comparable(change.before)) {
      throw new Error(`事实源已变化：字段“${change.field}”当前值与提案中的 before 不一致。请重新生成预览。`);
    }
  }
  const nextStage = changeMap.has("主阶段") ? changeMap.get("主阶段") : row.getCell(index.get("主阶段")).value;
  const nextStatus = changeMap.has("阶段状态") ? normalizedText(changeMap.get("阶段状态")) : normalizedText(row.getCell(index.get("阶段状态")).value);
  if (nextStage) changeMap.set("主阶段", normalizeStage(normalizedText(nextStage), pipeline));
  if (nextStatus && !pipeline.statuses.includes(nextStatus)) throw new Error("阶段状态只能为：进行中、通过、终止。");
  const terminationReason = changeMap.has("终止原因") ? normalizedText(changeMap.get("终止原因")) : normalizedText(row.getCell(index.get("终止原因")).value);
  if (nextStatus === "终止" && !terminationReason) throw new Error("阶段状态为终止时必须提供终止原因。");
  return changeMap;
}

async function appendCandidateArchive(filePath, proposal) {
  const existed = await fs.access(filePath).then(() => true).catch(() => false);
  const baseline = existed ? await fs.readFile(filePath, "utf8") : `# ${proposal.candidate.id}｜候选人证据档案\n\n`;
  const lines = proposal.changes.map((change) => `- ${change.field}：${comparable(change.before) || "空"} → ${comparable(change.after) || "空"}`);
  const entry = `\n## ${new Date().toISOString().slice(0, 10)}｜${actionTitle(proposal.intent)}\n\n${lines.join("\n")}\n\n依据：${proposal.evidence.map(normalizedText).filter(Boolean).join("；") || "招聘者确认"}\n`;
  await fs.writeFile(filePath, `${baseline.trimEnd()}\n${entry}`, "utf8");
}
async function appendContext(filePath, proposal) {
  const current = await fs.readFile(filePath, "utf8");
  const summary = proposal.changes.map((change) => `${change.field}：${comparable(change.after) || "空"}`).join("；");
  await fs.writeFile(filePath, `${current.trimEnd()}\n\n## Agent 更新记录\n\n- ${new Date().toISOString().slice(0, 10)}｜${proposal.candidate.name}｜${summary}\n`, "utf8");
}
async function appendActionLog(filePath, proposal) {
  const current = await fs.readFile(filePath, "utf8");
  const before = proposal.changes.map((change) => `- ${change.field}：${comparable(change.before) || "空"}`).join("\n");
  const after = proposal.changes.map((change) => `- ${change.field}：${comparable(change.after) || "空"}`).join("\n");
  const entry = `\n## ${new Date().toISOString().slice(0, 16).replace("T", " ")}｜${actionTitle(proposal.intent)}\n\n- 岗位：${proposal.role}\n- 候选人：${proposal.candidate.name}（${proposal.candidate.id}）\n- 用户确认：是\n\n### 修改前\n\n${before}\n\n### 修改后\n\n${after}\n\n### 依据\n\n- ${proposal.evidence.map(normalizedText).filter(Boolean).join("；") || "招聘者确认"}\n`;
  await fs.writeFile(filePath, `${current.trimEnd()}\n${entry}`, "utf8");
}

export async function applyConfirmedAction({ rootPath, proposalId }) {
  const proposal = await loadProposal(rootPath, proposalId);
  const rolePath = path.join(rootPath, "workflow", "roles", safeRoleName(proposal.role));
  const ledgerPath = path.join(rolePath, "candidate-ledger.xlsx");
  const contextPath = path.join(rolePath, "CONTEXT.md");
  const actionLogPath = path.join(rolePath, "ACTION_LOG.md");
  const dashboardPath = path.join(rolePath, "招聘数据复盘.html");
  const candidatePath = path.join(rolePath, "candidates", `${proposal.candidate.id}.md`);
  const { workbook, sheet, index } = await readLedger(ledgerPath);
  let row = findCandidateRow(sheet, index, proposal.candidate);
  if (proposal.intent === "candidate_create") {
    if (row) throw new Error("候选人 ID 已存在，不能重复新增。");
    sheet.eachRow((current, rowNumber) => {
      if (rowNumber >= 4 && normalizedText(current.getCell(index.get("姓名")).value) === proposal.candidate.name) throw new Error("候选人姓名已存在，请先确认是否为同一人。");
    });
    row = firstEmptyRow(sheet, index);
    row.getCell(index.get("候选人ID")).value = proposal.candidate.id;
    row.getCell(index.get("姓名")).value = proposal.candidate.name;
  }
  const pipeline = await readPipeline(path.join(rolePath, "PIPELINE.json"));
  const changes = validateChanges({ proposal, row, index, pipeline });
  const automatic = { "状态更新时间": new Date(), "最后更新时间": new Date(), "更新人": "招聘者" };
  const manifest = await backupFiles(rootPath, proposal.id, [ledgerPath, contextPath, actionLogPath, dashboardPath, candidatePath]);
  try {
    for (const [field, value] of changes) row.getCell(index.get(field)).value = writeValue(field, value);
    Object.entries(automatic).forEach(([field, value]) => row.getCell(index.get(field)).value = value);
    await workbook.xlsx.writeFile(ledgerPath);
    await fs.mkdir(path.dirname(candidatePath), { recursive: true });
    await appendCandidateArchive(candidatePath, proposal);
    await appendContext(contextPath, proposal);
    await appendActionLog(actionLogPath, proposal);
    await syncDashboard({ ledgerPath, dashboardPath, role: proposal.role, contextPath });
    await fs.rm(proposalPath(rootPath, proposal.id), { force: true });
    return { proposalId: proposal.id, role: proposal.role, candidate: proposal.candidate, updatedFields: [...changes.keys()] };
  } catch (error) {
    await restoreFiles(manifest);
    throw error;
  }
}

function argument(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("用途：执行已确认的候选人变更提案。\n用法：node workflow/scripts/apply-confirmed-action.mjs --root <项目根目录> --proposal <提案编号>");
  process.exit(0);
}
if (process.argv[1]?.endsWith("apply-confirmed-action.mjs")) {
  const rootPath = argument("--root");
  const proposalId = argument("--proposal");
  if (!rootPath || !proposalId) throw new Error("用法：--root <项目根目录> --proposal <提案编号>");
  console.log(JSON.stringify(await applyConfirmedAction({ rootPath, proposalId }), null, 2));
}
