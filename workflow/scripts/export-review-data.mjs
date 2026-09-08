import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ExcelJS from "exceljs";
import { readReviewData } from "./sync-dashboard-data.mjs";

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export async function exportReviewData({ ledgerPath, role, outputDir, privacy = "redacted" }) {
  const data = await readReviewData({ ledgerPath, role, privacy });
  for (const [index, row] of data.rows.entries()) {
    const missing = ["主阶段", "阶段状态", "简历收取时间", "简历来源"].filter(key => !String(row[key]).trim());
    if (missing.length) throw new Error(`候选人台账第 ${index + 4} 条数据缺少：${missing.join("、")}。请补齐后导出。`);
    if (!data.stages.includes(row["主阶段"]) || !["进行中", "通过", "终止"].includes(row["阶段状态"])) throw new Error(`第 ${index + 1} 条记录的阶段或状态不在已确认流程内。`);
    if (row["阶段状态"] === "终止" && !row["终止原因"]) throw new Error(`第 ${index + 1} 条终止记录缺少终止原因。`);
  }
  await fs.mkdir(outputDir, { recursive: true });
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("招聘数据", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.addRow(data.headers);
  data.rows.forEach(row => sheet.addRow(data.headers.map(key => row[key])));
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach(column => { column.width = 20; });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: data.headers.length } };
  const xlsxPath = path.join(outputDir, "recruitment-review-data.xlsx");
  const csvPath = path.join(outputDir, "recruitment-review-data.csv");
  await workbook.xlsx.writeFile(xlsxPath);
  await fs.writeFile(csvPath, "\uFEFF" + [data.headers, ...data.rows.map(row => data.headers.map(key => row[key]))].map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n", "utf8");
  await fs.writeFile(path.join(outputDir, "导入说明.md"), `# 招聘复盘数据\n\n岗位：${role}\n记录数：${data.rows.length}\n隐私模式：${privacy}\n\n在 recruitment-review 看板中依次配置以下阶段，再上传同目录 XLSX 或 CSV（两者内容相同，不要重复导入）。\n\n${data.stages.map((stage, i) => `- ${stage}（SLA：${data.slaDays[i] || "使用看板默认值"}）`).join("\n")}\n\n默认文件移除姓名、公司和自由文本，但仍包含候选人级流程明细，并非完全匿名或纯聚合数据。internal 模式包含身份和备注，仅限授权内部使用。上传不会写回原始台账。日期缺失表示未知；固定的一面日期等为约面信息，不作为实际阶段历史。请勿直接上传带说明行和配置表的 candidate-ledger.xlsx。\n`, "utf8");
  return { xlsxPath, csvPath, records: data.rows.length, privacy };
}
function argument(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const usage = "node workflow/scripts/export-review-data.mjs --ledger <candidate-ledger.xlsx> --role <岗位名称> --out <导出目录> [--privacy redacted|internal]";
  if (process.argv.includes("--help") || process.argv.includes("-h")) console.log(usage);
  else {
    const ledgerPath = argument("--ledger"), role = argument("--role"), outputDir = argument("--out");
    if (!ledgerPath || !role || !outputDir) throw new Error(usage);
    console.log(await exportReviewData({ ledgerPath, role, outputDir, privacy: argument("--privacy") }));
  }
}
