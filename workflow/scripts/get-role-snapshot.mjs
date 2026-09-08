import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { readPipeline } from "./pipeline-config.mjs";

const interviewDateFields = ["一面日期", "二面日期", "三面日期", "HRBP日期", "决策会日期"];

const text = (value) => String(value ?? "").trim();
const hasValue = (value) => text(value) !== "";

function asDate(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) return parsed;
  }
  return null;
}

async function readCandidateRows(ledgerPath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(ledgerPath);
  const sheet = workbook.getWorksheet("候选人台账");
  if (!sheet) throw new Error("未找到“候选人台账”工作表。");
  const headers = sheet.getRow(3).values.slice(1).map(text);
  const rows = [];
  for (let rowNumber = 4; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const values = sheet.getRow(rowNumber).values.slice(1);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    if (hasValue(row["候选人ID"]) || hasValue(row["姓名"])) rows.push(row);
  }
  return rows;
}

async function optionalText(filePath) {
  try { return await fs.readFile(filePath, "utf8"); } catch (error) { if (error?.code === "ENOENT") return ""; throw error; }
}

export async function getRoleSnapshot({ roleName, rolePath, now = new Date() }) {
  const ledgerPath = path.join(rolePath, "candidate-ledger.xlsx");
  const [rows, context, actionLog] = await Promise.all([
    readCandidateRows(ledgerPath),
    optionalText(path.join(rolePath, "CONTEXT.md")),
    optionalText(path.join(rolePath, "ACTION_LOG.md")),
  ]);
  const pipeline = await readPipeline(path.join(rolePath, "PIPELINE.json"));
  const lastStage = pipeline.stages.at(-1);
  const finalLabel = `${lastStage.id}-${lastStage.name}`;
  const inProgressRows = rows.filter(row => text(row["阶段状态"]) === "进行中" || (text(row["阶段状态"]) === "通过" && text(row["主阶段"]) !== finalLabel));
  const dueFollowUps = inProgressRows.filter((row) => {
    const due = asDate(row["下次跟进日期"]);
    return due && due <= now;
  }).length;
  const missingNextActions = inProgressRows.filter((row) => !hasValue(row["下一步动作"])).length;
  const pendingFeedback = inProgressRows.filter((row) => {
    if (text(row["阶段状态"]) !== "进行中") return false;
    const stage = text(row["主阶段"]).replace(/^\d+-/, "");
    const feedback = text(row["面试反馈摘要"]);
    if (feedback.includes(`[${text(row["主阶段"])}]`)) return false;
    const matchingFields = interviewDateFields.filter(field => stage.includes(field.replace(/日期$/, "")));
    return matchingFields.some((field) => {
      const date = asDate(row[field]);
      return date && date <= now;
    });
  }).length;
  const lastAction = [...actionLog.matchAll(/^##\s+(.+)$/gm)].at(-1)?.[1] ?? "无";
  const rawVersion = context.match(/当前标准版本：[ \t]*([^\n]+)/)?.[1]?.trim() ?? "待确认";
  const standardVersion = /\{\{|草稿|待确认/.test(rawVersion) || context.includes("尚未完成需求确认") ? "待确认" : rawVersion;
  const lastDashboardSync = context.match(/最近同步时间：\s*([^\n]+)/)?.[1]?.trim() ?? "未同步";
  const nextActions = [];
  if (dueFollowUps) nextActions.push(`处理 ${dueFollowUps} 名到期未跟进候选人`);
  if (pendingFeedback) nextActions.push(`补充 ${pendingFeedback} 条待处理面试反馈`);
  if (missingNextActions) nextActions.push(`为 ${missingNextActions} 名流程中候选人补充下一步动作`);
  if (!nextActions.length) nextActions.push("当前没有由台账自动识别的待处理事项");

  return {
    roleName,
    standardVersion,
    pipelineConfigured: await fs.access(path.join(rolePath, "PIPELINE.json")).then(() => true).catch(() => false),
    candidateTotal: rows.length,
    inProgress: inProgressRows.length,
    dueFollowUps,
    missingNextActions,
    pendingFeedback,
    lastAction,
    lastDashboardSync,
    nextActions,
  };
}

function argument(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("用途：读取岗位的可恢复工作状态。\n用法：node workflow/scripts/get-role-snapshot.mjs --role <岗位名称> --role-path <岗位目录>");
  process.exit(0);
}
if (process.argv[1]?.endsWith("get-role-snapshot.mjs")) {
  const roleName = argument("--role");
  const rolePath = argument("--role-path");
  if (!roleName || !rolePath) throw new Error("用法：--role <岗位名称> --role-path <岗位目录>");
  console.log(JSON.stringify(await getRoleSnapshot({ roleName, rolePath }), null, 2));
}
