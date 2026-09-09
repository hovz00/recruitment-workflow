import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ExcelJS from "exceljs";
import { terminationReasons } from "./create-role-ledger.mjs";
import { formalDashboardTemplate } from "./create-review-dashboard.mjs";
import { boundedPath } from "./workspace-safety.mjs";
import {validateCandidateRecord} from './validate-candidate-record.mjs';

const DATA_START = "/* AUTO_LEDGER_DATA:START */";
const DATA_END = "/* AUTO_LEDGER_DATA:END */";
export const reviewHeaders = ["主阶段", "阶段状态", "终止原因", "备注信息", "简历收取时间", "岗位名称", "候选人姓名", "简历来源", "当前公司", "Offer接受日期", "预计入职日期"];
export function cellValue(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value && typeof value === "object") {
    if ("result" in value) return cellValue(value.result);
    if (Array.isArray(value.richText)) return value.richText.map(part => part.text).join("");
    return value.text ?? "";
  }
  return value ?? "";
}
export function normalizeReviewRow(row, role, { privacy = "redacted", index = 0 } = {}) {
  if (!["redacted", "internal"].includes(privacy)) throw new Error("privacy 必须为 redacted 或 internal。");
  const internal = privacy === "internal";
  const value = key => cellValue(row[key]);
  const result = {
    "主阶段": value("主阶段"), "阶段状态": value("阶段状态"),
    "终止原因": internal || terminationReasons.includes(value("终止原因")) ? value("终止原因") : value("终止原因") ? "其他待说明" : "",
    "备注信息": internal ? value("备注") : "", "简历收取时间": value("简历收取时间"), "岗位名称": role,
    "候选人姓名": internal ? value("姓名") : `候选人${index + 1}`, "简历来源": internal || ["内部人才库", "员工推荐", "招聘平台", "猎头", "官网投递", "活动/社群", "其他", ""].includes(value("简历来源")) ? value("简历来源") : "其他",
    "当前公司": internal ? value("当前公司") : "", "Offer接受日期": value("Offer接受日期"), "预计入职日期": value("预计入职日期"),
  };
  for (const key of Object.keys(row)) if (/^\d+-.+(?:通过)?日期$/.test(key) && !key.endsWith('预约日期')) result[key] = value(key);
  return result;
}
export function rowsFromLedgerValues(values, role, options = {}) {
  const [headers = [], ...rows] = values;
  return rows.filter(row => row.some(value => String(cellValue(value)).trim()))
    .map(row => Object.fromEntries(headers.map((key, index) => [key, cellValue(row[index])])))
    .map((row, index) => normalizeReviewRow(row, role, { ...options, index }));
}
const safeJSON = value => JSON.stringify(value).replaceAll("<", "\\u003c");
function reviewRuntimeBlock(rows, stageOrder, { role = "", slaDays = [], privacy = "redacted" } = {}) {
  return `${DATA_START}
const AUTO_DASHBOARD_DATA = ${safeJSON(rows)};
const AUTO_DASHBOARD_STAGE_ORDER = ${safeJSON(stageOrder)};
const AUTO_DASHBOARD_ROLE = ${safeJSON(role)};
const AUTO_DASHBOARD_SLA = ${safeJSON(slaDays)};
function loadAutoLedgerData() { return { rows: AUTO_DASHBOARD_DATA, stageOrder: AUTO_DASHBOARD_STAGE_ORDER }; }
function applyAutoLedgerData() {
  const stages = AUTO_DASHBOARD_STAGE_ORDER.map((stage, code) => {
    const label = String(stage).replace(/^\\d+-/, '');
    return { code, label, key: getStableSemanticKey(label) || 'custom_' + code, color: getStageColor(code), slaDays: AUTO_DASHBOARD_SLA[code] || getDefaultSlaDays({ label, key: getStableSemanticKey(label) }) };
  });
  applyStageConfiguration(stages);
  document.getElementById('stageConfigModal')?.classList.remove('active');
  const fileInput = document.getElementById('fileInput');
  if (fileInput) fileInput.disabled = false;
  document.body.dataset.workflowSynced = 'true';
  document.querySelectorAll('[data-upload-entry]').forEach(element => { element.hidden = false; });
  const title = AUTO_DASHBOARD_ROLE ? AUTO_DASHBOARD_ROLE + '｜招聘数据复盘' : '招聘数据复盘';
  document.title = title;
  const heading = document.querySelector('[data-dashboard-title], .app-brand span:last-child');
  if (heading) heading.textContent = title;
  if (AUTO_DASHBOARD_DATA.length && !commitImportedRows(AUTO_DASHBOARD_DATA)) {
    showPageMessage('台账数据未能导入，请核对阶段、状态和简历收取日期。');
    return;
  }
  showPageMessage('已加载 ' + AUTO_DASHBOARD_DATA.length + ' 条${privacy === "internal" ? "内部明细" : "去标识化明细"}。手动上传仅影响本次预览，不会写回台账。', 'success');
}
applyAutoLedgerData();
${DATA_END}`;
}
export function injectAutoLedgerData(html, rows, stageOrder = [], options = {}) {
  const block = reviewRuntimeBlock(rows, stageOrder, options);
  const start = html.indexOf(DATA_START), end = html.indexOf(DATA_END);
  if (start >= 0 && end >= start) return `${html.slice(0, start)}${block}${html.slice(end + DATA_END.length)}`;
  if (!html.includes("</body>")) throw new Error("正式复盘看板缺少 </body>，无法写入台账数据。");
  return html.replace("</body>", `<script>\n${block}\n</script>\n</body>`);
}
export async function readReviewData({ ledgerPath, role, privacy = "redacted" }) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(ledgerPath);
  const ledger = workbook.getWorksheet("候选人台账"), config = workbook.getWorksheet("选项配置");
  if (!ledger || !config) throw new Error("未找到“候选人台账”或“选项配置”工作表。");
  const values = [];
  for (let index = 3; index <= ledger.rowCount; index++) values.push(ledger.getRow(index).values.slice(1));
  const stages = [], slaDays = [];
  for (let index = 2; config.getCell(index, 2).value; index++) {
    stages.push(String(config.getCell(index, 2).value));
    slaDays.push(Number(config.getCell(index, 5).value) || null);
  }
  if (!stages.length) throw new Error("选项配置中没有主阶段，无法生成正确顺序的漏斗。");
  for(let index=1;index<values.length;index++){
    const cells=values[index];
    if(!cells.some(value=>String(cellValue(value)).trim()))continue;
    const record=Object.fromEntries(values[0].map((key,column)=>[key,cellValue(cells[column])]));
    try{validateCandidateRecord(record,{stages});}catch(error){throw new Error(`候选人台账第 ${index+3} 行：${error.message}`);}
  }
  const rows = rowsFromLedgerValues(values, role, { privacy });
  const headers = [...reviewHeaders, ...stages.flatMap(stage => [`${stage}日期`, `${stage}通过日期`])];
  return { rows: rows.map(row => Object.fromEntries(headers.map(header => [header, row[header] ?? ""]))), headers, stages, slaDays };
}
export async function syncDashboard({ ledgerPath, dashboardPath, role, contextPath, privacy = "redacted" }) {
  const { rows, stages, slaDays } = await readReviewData({ ledgerPath, role, privacy });
  // Rebuild from the pinned template so existing role pages receive compatibility fixes.
  const html = await fs.readFile(formalDashboardTemplate, "utf8");
  const updated = injectAutoLedgerData(html, rows, stages, { role, slaDays, privacy });
  const temporaryPath = `${dashboardPath}.tmp`;
  for (const target of [dashboardPath, temporaryPath, `${dashboardPath}.bak`]) await boundedPath(path.dirname(path.resolve(dashboardPath)), path.basename(target));
  await fs.copyFile(dashboardPath, `${dashboardPath}.bak`);
  await fs.writeFile(temporaryPath, updated, "utf8");
  await fs.rename(temporaryPath, dashboardPath);
  if (contextPath) {
    let context = await fs.readFile(contextPath, "utf8");
    const metadata = [["最近同步时间", new Date().toISOString()], ["最近同步记录数", rows.length], ["招聘复盘看板", path.basename(dashboardPath)]];
    for (const [label, value] of metadata) {
      const line = `- ${label}：${value}`;
      const pattern = new RegExp(`^- ${label}：[^\\r\\n]*`, "m");
      context = pattern.test(context) ? context.replace(pattern, () => line) : `${context.trimEnd()}\n${line}\n`;
    }
    await fs.writeFile(contextPath, context, "utf8");
  }
  return { dashboardPath, records: rows.length, stages, privacy };
}
function argument(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
export async function runCli() {
  const usage = "node workflow/scripts/sync-dashboard-data.mjs --ledger <candidate-ledger.xlsx> --dashboard <招聘数据复盘.html> --role <岗位名称> [--context <CONTEXT.md>] [--privacy redacted|internal]";
  if (process.argv.includes("--help") || process.argv.includes("-h")) return console.log(usage);
  const ledgerPath = argument("--ledger"), dashboardPath = argument("--dashboard"), role = argument("--role");
  if (!ledgerPath || !dashboardPath || !role) throw new Error(usage);
  console.log(await syncDashboard({ ledgerPath, dashboardPath, role, contextPath: argument("--context"), privacy: argument("--privacy") }));
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await runCli();
