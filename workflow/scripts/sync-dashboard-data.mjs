import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ExcelJS from "exceljs";

const DATA_START = "/* AUTO_LEDGER_DATA:START */";
const DATA_END = "/* AUTO_LEDGER_DATA:END */";

const valueOf = (row, key) => row[key] ?? "";

/** Convert a role ledger row into the fixed header names understood by the formal review dashboard. */
export function normalizeReviewRow(row, role) {
  return {
    "主阶段": valueOf(row, "主阶段"),
    "阶段状态": valueOf(row, "阶段状态"),
    "终止原因": valueOf(row, "终止原因"),
    "备注信息": valueOf(row, "备注"),
    "简历收取时间": valueOf(row, "简历收取时间"),
    "岗位名称": role,
    "候选人姓名": valueOf(row, "姓名"),
    "简历来源": valueOf(row, "简历来源"),
    "当前公司": valueOf(row, "当前公司"),
  };
}

export function rowsFromLedgerValues(values, role) {
  const [headers = [], ...rows] = values;
  return rows
    .filter((row) => row.some((value) => String(value ?? "").trim()))
    .map((row) => Object.fromEntries(headers.map((key, index) => [key, row[index] ?? ""])))
    .map((row) => normalizeReviewRow(row, role));
}

function reviewRuntimeBlock(rows, stageOrder, { role = "" } = {}) {
  const safeRows = JSON.stringify(rows).replaceAll("<", "\\u003c");
  const safeStages = JSON.stringify(stageOrder).replaceAll("<", "\\u003c");
  const safeRole = JSON.stringify(role).replaceAll("<", "\\u003c");
  return `${DATA_START}
const AUTO_DASHBOARD_DATA = ${safeRows};
const AUTO_DASHBOARD_STAGE_ORDER = ${safeStages};
const AUTO_DASHBOARD_ROLE = ${safeRole};

function loadAutoLedgerData() {
  return { rows: AUTO_DASHBOARD_DATA, stageOrder: AUTO_DASHBOARD_STAGE_ORDER };
}

function applyAutoLedgerData() {
  if (!Array.isArray(AUTO_DASHBOARD_DATA) || AUTO_DASHBOARD_DATA.length === 0) return;
  STAGES_CONFIG = AUTO_DASHBOARD_STAGE_ORDER.map((stage, code) => {
    const match = String(stage).match(/^(\\d+)-(.*)$/);
    return {
      code: match ? Number(match[1]) : code,
      key: DEFAULT_STAGES_CONFIG[code]?.key || 'custom_' + code,
      label: (match ? match[2] : String(stage)).trim(),
      color: getStageColor(code)
    };
  });
  rawData = transformData(AUTO_DASHBOARD_DATA);
  if (rawData.length === 0) return;
  document.getElementById('stageConfigModal')?.classList.remove('active');
  const fileInput = document.getElementById('fileInput');
  if (fileInput) fileInput.disabled = true;
  document.body.dataset.workflowSynced = 'true';
  document.querySelectorAll('[data-upload-entry]').forEach((element) => { element.hidden = true; });
  const title = AUTO_DASHBOARD_ROLE ? AUTO_DASHBOARD_ROLE + '｜招聘数据复盘' : '招聘数据复盘';
  document.title = title;
  const heading = document.querySelector('[data-dashboard-title]');
  if (heading) heading.textContent = title;
  document.getElementById('emptyState')?.classList.add('hidden');
  document.getElementById('mainContent')?.classList.add('active');
  initTimeSelectors();
  refreshData();
  showPageMessage('已从候选人台账加载 ' + rawData.length + ' 条招聘记录。', 'success');
}

applyAutoLedgerData();
${DATA_END}`;
}

/** Insert or replace the role-local data block without changing the formal dashboard UI. */
export function injectAutoLedgerData(html, rows, stageOrder = [], options = {}) {
  const block = reviewRuntimeBlock(rows, stageOrder, options);
  const start = html.indexOf(DATA_START);
  const end = html.indexOf(DATA_END);
  if (start >= 0 && end >= start) return `${html.slice(0, start)}${block}${html.slice(end + DATA_END.length)}`;
  if (!html.includes("</body>")) throw new Error("正式复盘看板缺少 </body>，无法写入台账数据。");
  return html.replace("</body>", `<script>\n${block}\n</script>\n</body>`);
}

async function readLedger(ledgerPath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(ledgerPath);
  const ledger = workbook.getWorksheet("候选人台账");
  const config = workbook.getWorksheet("选项配置");
  if (!ledger || !config) throw new Error("未找到“候选人台账”或“选项配置”工作表。");
  const values = [];
  for (let index = 3; index <= ledger.rowCount; index += 1) values.push(ledger.getRow(index).values.slice(1));
  const stages = [];
  for (let index = 2; config.getCell(index, 2).value; index += 1) stages.push(String(config.getCell(index, 2).value));
  if (!stages.length) throw new Error("选项配置中没有主阶段，无法生成正确顺序的漏斗。");
  return { values, stages };
}

export async function syncDashboard({ ledgerPath, dashboardPath, role, contextPath }) {
  const { values, stages } = await readLedger(ledgerPath);
  const html = await fs.readFile(dashboardPath, "utf8");
  const updated = injectAutoLedgerData(html, rowsFromLedgerValues(values, role), stages, { role });
  const temporaryPath = `${dashboardPath}.tmp`;
  await fs.writeFile(temporaryPath, updated, "utf8");
  await fs.copyFile(dashboardPath, `${dashboardPath}.bak`);
  await fs.rename(temporaryPath, dashboardPath);
  if (contextPath) {
    const timestamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    let context = await fs.readFile(contextPath, "utf8");
    const lines = [`- 最近同步时间：${timestamp}`, `- 最近同步记录数：${rowsFromLedgerValues(values, role).length}`, `- 招聘复盘看板：${path.basename(dashboardPath)}`];
    context = `${context.replace(/\n?- 最近同步时间：.*\n?- 最近同步记录数：.*\n?- 招聘复盘看板：.*/s, "").trim()}\n\n${lines.join("\n")}\n`;
    await fs.writeFile(contextPath, context, "utf8");
  }
  return { dashboardPath, records: rowsFromLedgerValues(values, role).length, stages };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

export async function runCli() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("用途：将候选人台账同步到招聘数据复盘.html。\n用法：node workflow/scripts/sync-dashboard-data.mjs --ledger <candidate-ledger.xlsx> --dashboard <招聘数据复盘.html> --role <岗位名称>");
    return;
  }
  const ledgerPath = argument("--ledger");
  const dashboardPath = argument("--dashboard");
  const role = argument("--role");
  const contextPath = argument("--context");
  if (!ledgerPath || !dashboardPath || !role) {
    throw new Error("用法：node workflow/scripts/sync-dashboard-data.mjs --ledger <candidate-ledger.xlsx> --dashboard <index.html> --role <岗位名称>");
  }
  const result = await syncDashboard({ ledgerPath, dashboardPath, role, contextPath });
  console.log(`已同步 ${result.records} 条记录到正式复盘看板：${result.dashboardPath}`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(currentFile).href) {
  await runCli();
}
