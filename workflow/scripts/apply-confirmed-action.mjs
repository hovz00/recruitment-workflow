import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { ledgerColumns } from "./create-role-ledger.mjs";
import { readPipeline } from "./pipeline-config.mjs";
import { normalizeStage } from "./update-candidate-ledger.mjs";
import { syncDashboard } from "./sync-dashboard-data.mjs";
import { stateDirectory, resolveCurrentRole, sessionStateDirectory, validateSessionId, sessionLockOptions, sessionArgument } from "./agent-state.mjs";
import { safeSegment, boundedPath, withRootLock } from "./workspace-safety.mjs";
import {readConfirmedStandard} from './role-standard-state.mjs';
import {validateCandidateRecord} from './validate-candidate-record.mjs';
import {findCrossRoleMatches} from './application-catalog.mjs';

const dateFields = new Set(["简历收取时间", "状态更新时间", "下次跟进日期", "一面日期", "二面日期", "三面日期", "HRBP日期", "决策会日期", "最后更新时间"]);
const protectedFields = new Set(["候选人ID", "姓名"]);
const allowedFields = new Set([...ledgerColumns.filter((field) => !protectedFields.has(field)), "Offer接受日期", "预计入职日期"]);
const pendingDirectory = (rootPath) => path.join(stateDirectory(rootPath), "pending-actions");
const proposalPath = (rootPath, proposalId) => path.join(pendingDirectory(rootPath), `${safeSegment(proposalId, "提案编号")}.json`);

function normalizedText(value) { return String(value ?? "").trim(); }
const safeRoleName = (role) => safeSegment(role, "岗位名称");
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const receiptPath = (root, id) => path.join(stateDirectory(root), "proposal-receipts", `${safeSegment(id)}.json`);
const latestPath = (root, role, sessionId) => path.join(sessionStateDirectory(root, sessionId), "latest-proposals", `${safeSegment(role)}.json`);
function comparable(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  return normalizedText(value);
}
function writeValue(field, value) {
  if ((dateFields.has(field) || field.endsWith("日期")) && /^\d{4}-\d{2}-\d{2}$/.test(normalizedText(value))) return new Date(`${value}T00:00:00Z`);
  return value ?? "";
}
function actionTitle(intent) { return intent === "candidate_create" ? "新增候选人" : "候选人状态更新"; }

function validateProposal(proposal, pipeline) {
  const candidate = proposal?.candidate ?? {};
  if (!safeRoleName(proposal?.role)) throw new Error("提案必须指定岗位。");
  if (!["candidate_create", "candidate_update"].includes(proposal?.intent)) throw new Error("提案 intent 必须为 candidate_create 或 candidate_update。");
  if (!normalizedText(candidate.id) || !normalizedText(candidate.name)) throw new Error("提案必须包含候选人 ID 和姓名。");
  safeSegment(candidate.id, "候选人编号");
  if (proposal.id !== undefined) safeSegment(proposal.id, "提案编号");
  if (proposal.evidence !== undefined && !Array.isArray(proposal.evidence)) throw new Error("evidence 必须是数组。");
  if (!Array.isArray(proposal.changes) || proposal.changes.length === 0) throw new Error("提案至少需要一项字段变更。");
  const dynamicFields = new Set((pipeline?.stages ?? []).flatMap(({id,name,appointmentField}) => [`${id}-${name}日期`, `${id}-${name}通过日期`,appointmentField].filter(Boolean)));
  if(proposal.identityResolution!==undefined){
    const r=proposal.identityResolution;
    if(proposal.intent!=='candidate_create'||r?.confirmedDistinct!==true||!Array.isArray(r.matchedCandidateIds)||!r.matchedCandidateIds.length||typeof r.reason!=='string'||!r.reason.trim()||new Set(r.matchedCandidateIds).size!==r.matchedCandidateIds.length)throw new Error('同名核实必须明确确认不同人、列出匹配ID并提供核实依据。');
    r.matchedCandidateIds.forEach(id=>safeSegment(id,'同名核实编号'));
  }
  if (new Set(proposal.changes.map(c => c?.field)).size !== proposal.changes.length) throw new Error("提案字段重复。");
  if (proposal.intent === "candidate_create") for (const field of ["简历来源", "简历收取时间", "主阶段", "阶段状态"]) {
    if (!proposal.changes.some(c => c?.field === field && normalizedText(c.after))) throw new Error(`新增候选人必须提供${field}。`);
  }
  for (const change of proposal.changes) {
    if (!allowedFields.has(change?.field) && !dynamicFields.has(change?.field)) throw new Error(`不允许写入字段：${change?.field ?? ""}`);
    if (proposal.intent === "candidate_update" && !("before" in change)) throw new Error(`字段 ${change.field} 缺少 before。`);
    if (!("after" in change)) throw new Error(`字段 ${change.field} 缺少 after。`);
    if (change.after !== null && !["string", "number", "boolean"].includes(typeof change.after)) throw new Error(`字段 ${change.field} 只能写入文本、数字或空值。`);
    if ((dateFields.has(change.field) || change.field.endsWith("日期")) && normalizedText(change.after)) {
      const value = normalizedText(change.after);
      const date = new Date(`${value}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new Error(`字段 ${change.field} 必须为有效的 YYYY-MM-DD 日期。`);
    }
  }
}

export async function createPendingAction({ rootPath, proposal, sessionId }) {
  validateSessionId(sessionId);
  return withRootLock(rootPath, async () => {
    const role = safeRoleName(proposal?.role);
    if (sessionId !== undefined && await resolveCurrentRole({ rootPath, sessionId }) !== role) throw new Error("提案岗位与当前岗位不一致，请重新选择岗位并生成预览。");
    const pipelinePath = await boundedPath(rootPath, "workflow", "roles", role, "PIPELINE.json");
    const ledgerPath = await boundedPath(rootPath, "workflow", "roles", role, "candidate-ledger.xlsx");
    validateProposal(proposal, await readPipeline(pipelinePath));
    const standard=await readConfirmedStandard(path.dirname(pipelinePath));
    const id = proposal.id ?? `P-${crypto.randomUUID()}`;
    const identityEvidence=proposal.identityResolution?[`同名核实：${proposal.identityResolution.matchedCandidateIds.join('、')}；确认不同人；${proposal.identityResolution.reason.trim()}`]:[];
    const crossRole = proposal.intent === 'candidate_create'
      ? await findCrossRoleMatches({ rootPath, role, name: proposal.candidate.name }).catch(error => ({ matches: [], issues: [{ message: `跨岗位候选人查询未完成：${error.message}` }] }))
      : { matches: [], issues: [] };
    const stored = { ...proposal, sessionId, id, crossRoleMatches: crossRole.matches, crossRoleMatchIssues: crossRole.issues, evidence: [...(proposal.evidence??[]),...identityEvidence], standardVersion:standard.version, status: "pending", createdAt: new Date().toISOString() };
    const content = `${JSON.stringify(stored, null, 2)}\n`;
    const pending = await boundedPath(rootPath, path.relative(rootPath, proposalPath(rootPath, id)));
    const receipt = await boundedPath(rootPath, path.relative(rootPath, receiptPath(rootPath, id)));
    const latest = await boundedPath(rootPath, path.relative(rootPath, latestPath(rootPath, role, sessionId)));
    for (const target of [pending, receipt, latest]) await fs.mkdir(path.dirname(target), {recursive:true});
    const record = { id, role, sessionId, digest: digest(content), ledgerDigest: digest(await fs.readFile(ledgerPath)), pipelineDigest: digest(await fs.readFile(pipelinePath)),standardConfirmationDigest:standard.confirmationDigest };
    try { await fs.writeFile(receipt, JSON.stringify(record), {flag:"wx"}); }
    catch(error) { if(error.code === "EEXIST") throw new Error("提案编号已存在，不能重复使用。"); throw error; }
    await fs.writeFile(pending, content, {flag:"wx"});
    await fs.writeFile(latest, JSON.stringify(record));
    return stored;
  }, sessionLockOptions(sessionId));
}

async function loadProposal(rootPath, proposalId, sessionId) {
  const target = await boundedPath(rootPath, path.relative(rootPath, proposalPath(rootPath, proposalId)));
  let content;
  try { content = await fs.readFile(target, "utf8"); }
  catch (error) { if (error?.code === "ENOENT") throw new Error("待确认提案不存在或已执行。请重新生成变更预览。"); throw error; }
  const proposal = JSON.parse(content);
  if (proposal.sessionId !== sessionId) throw new Error("提案与当前会话不一致，请在生成预览的会话中确认执行。");
  safeRoleName(proposal?.role);
  if (await resolveCurrentRole({rootPath, sessionId}) !== proposal.role) throw new Error("提案岗位与当前岗位不一致，请重新选择岗位并生成预览。");
  const latest = await boundedPath(rootPath, path.relative(rootPath, latestPath(rootPath, proposal.role, sessionId)));
  const receipt = await boundedPath(rootPath, path.relative(rootPath, receiptPath(rootPath, proposalId)));
  let record, current;
  try { [record, current] = await Promise.all([fs.readFile(receipt,"utf8").then(JSON.parse),fs.readFile(latest,"utf8").then(JSON.parse)]); }
  catch { throw new Error("提案缺少确认预览记录，请重新生成预览。"); }
  if (record.sessionId !== sessionId || current.sessionId !== sessionId) throw new Error("提案确认记录与当前会话不一致，请重新生成预览。");
  if (proposal.id !== proposalId || proposal.status !== "pending" || record.digest !== digest(content)) throw new Error("提案内容已变化，请重新生成预览。");
  if (current.id !== proposalId || current.digest !== record.digest) throw new Error("提案已失效，请确认最新预览。");
  const ledger = await boundedPath(rootPath,"workflow","roles",proposal.role,"candidate-ledger.xlsx");
  const pipeline = await boundedPath(rootPath,"workflow","roles",proposal.role,"PIPELINE.json");
  if (digest(await fs.readFile(ledger)) !== record.ledgerDigest || digest(await fs.readFile(pipeline)) !== record.pipelineDigest) throw new Error("事实源已变化，请重新生成预览。");
  const standard=await readConfirmedStandard(path.dirname(pipeline));
  if(standard.confirmationDigest!==record.standardConfirmationDigest)throw new Error('岗位标准确认版本已变化，请重新生成预览。');
  validateProposal(proposal, await readPipeline(pipeline));
  return proposal;
}

async function backupFiles(rootPath, proposalId, files) {
  const backupDirectory = await boundedPath(rootPath, ".recruitment-agent", "backups", safeSegment(proposalId));
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
    if (normalizedText(row.getCell(idColumn).value).toLowerCase() === candidate.id.toLowerCase()) {
      if (match) throw new Error("候选人 ID 在台账中重复，已停止写入。");
      match = row;
    }
  }
  if (!match) return null;
  if (normalizedText(match.getCell(idColumn).value) !== candidate.id) throw new Error("候选人 ID 的大小写与已有记录冲突，请使用台账中的原始 ID。");
  if (normalizedText(match.getCell(nameColumn).value) !== candidate.name) throw new Error("候选人 ID 与姓名不一致，已停止写入。");
  return match;
}

function firstEmptyRow(sheet, index) {
  for (let rowNumber = 4; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    if (![...index.values()].some(column => normalizedText(row.getCell(column).value))) return row;
  }
  throw new Error("候选人台账没有空行，请先扩容台账。");
}

function validateChanges({ proposal, row, index, pipeline }) {
  if (!row) throw new Error("候选人不存在，请核对候选人 ID 后重新生成预览。");
  for (const change of proposal.changes) if (!index.has(change.field)) throw new Error(`台账缺少字段${change.field}，请先迁移岗位。`);
  const changeMap = new Map(proposal.changes.map((change) => [change.field, change.after]));
  for (const change of proposal.changes) {
    if (proposal.intent === "candidate_update" && comparable(row.getCell(index.get(change.field)).value) !== comparable(change.before)) {
      throw new Error(`事实源已变化：字段“${change.field}”当前值与提案中的 before 不一致。请重新生成预览。`);
    }
  }
  const nextStage = changeMap.has("主阶段") ? changeMap.get("主阶段") : row.getCell(index.get("主阶段")).value;
  const nextStatus = changeMap.has("阶段状态") ? normalizedText(changeMap.get("阶段状态")) : normalizedText(row.getCell(index.get("阶段状态")).value);
  if (!nextStage) throw new Error("主阶段不能为空。");
  changeMap.set("主阶段", normalizeStage(normalizedText(nextStage), pipeline));
  if (!pipeline.statuses.includes(nextStatus)) throw new Error("阶段状态只能为：进行中、通过、终止。");
  const terminationReason = changeMap.has("终止原因") ? normalizedText(changeMap.get("终止原因")) : normalizedText(row.getCell(index.get("终止原因")).value);
  if (nextStatus === "终止" && !terminationReason) throw new Error("阶段状态为终止时必须提供终止原因。");
  if (nextStatus !== "终止" && terminationReason) throw new Error("重新开启候选人时必须在预览中明确清空终止原因。");
  const finalRecord=Object.fromEntries([...index].map(([field,column])=>[field,row.getCell(column).value]));
  for(const [field,value] of changeMap)finalRecord[field]=value;
  validateCandidateRecord(finalRecord,{stages:pipeline.stages,statuses:pipeline.statuses});
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

export async function applyConfirmedAction({ rootPath, proposalId, sessionId }) {
  return withRootLock(rootPath, () => applyUnderLock({rootPath, proposalId, sessionId}), sessionLockOptions(sessionId));
}

async function applyUnderLock({rootPath, proposalId, sessionId}) {
  const proposal = await loadProposal(rootPath, proposalId, sessionId);
  const rolePath = path.join(rootPath, "workflow", "roles", safeRoleName(proposal.role));
  const ledgerPath = path.join(rolePath, "candidate-ledger.xlsx");
  const contextPath = path.join(rolePath, "CONTEXT.md");
  const actionLogPath = path.join(rolePath, "ACTION_LOG.md");
  const dashboardPath = path.join(rolePath, "招聘数据复盘.html");
  const candidatePath = path.join(rolePath, "candidates", `${proposal.candidate.id}.md`);
  const targets = [ledgerPath, contextPath, actionLogPath, dashboardPath, candidatePath, `${dashboardPath}.bak`, `${dashboardPath}.tmp`];
  for (const target of targets) await boundedPath(rootPath, path.relative(rootPath, target));
  const { workbook, sheet, index } = await readLedger(ledgerPath);
  let row = findCandidateRow(sheet, index, proposal.candidate);
  if (proposal.intent === "candidate_create") {
    if (row) throw new Error("候选人 ID 已存在，不能重复新增。");
    if (await fs.access(candidatePath).then(() => true).catch(() => false)) throw new Error("候选人档案已存在但台账未匹配，请先核对档案，不能复用此 ID。");
    const matchedIds=[];
    sheet.eachRow((current,rowNumber)=>{if(rowNumber>=4&&normalizedText(current.getCell(index.get('姓名')).value)===proposal.candidate.name)matchedIds.push(normalizedText(current.getCell(index.get('候选人ID')).value));});
    if(matchedIds.length||proposal.identityResolution){
      const resolution=proposal.identityResolution;
      if(matchedIds.some(id=>!id)||!resolution||matchedIds.length!==resolution.matchedCandidateIds.length||matchedIds.some(id=>!resolution.matchedCandidateIds.includes(id)))throw new Error(`候选人姓名已存在或同名核实范围不一致，请核实匹配ID（${matchedIds.join('、')||'无'}）后重新预览；不同人需明确同名核实依据。`);
    }
    row = firstEmptyRow(sheet, index);
    row.getCell(index.get("候选人ID")).value = proposal.candidate.id;
    row.getCell(index.get("姓名")).value = proposal.candidate.name;
  }
  const pipeline = await readPipeline(path.join(rolePath, "PIPELINE.json"));
  const changes = validateChanges({ proposal, row, index, pipeline });
  const automatic = { "状态更新时间": new Date(), "最后更新时间": new Date(), "更新人": "招聘者" };
  const manifest = await backupFiles(rootPath, proposal.id, targets);
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
    return { proposalId: proposal.id, sessionId, role: proposal.role, candidate: proposal.candidate, updatedFields: [...changes.keys()] };
  } catch (error) {
    await restoreFiles(manifest);
    throw error;
  }
}

function argument(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("用途：执行已确认的候选人变更提案。\n用法：node workflow/scripts/apply-confirmed-action.mjs --root <项目根目录> --proposal <提案编号> [--session <会话编号>]");
  process.exit(0);
}
if (process.argv[1]?.endsWith("apply-confirmed-action.mjs")) {
  const rootPath = argument("--root");
  const proposalId = argument("--proposal");
  if (!rootPath || !proposalId) throw new Error("用法：--root <项目根目录> --proposal <提案编号>");
  console.log(JSON.stringify(await applyConfirmedAction({ rootPath, proposalId, sessionId: sessionArgument() }), null, 2));
}
