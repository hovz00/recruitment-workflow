import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ExcelJS from "exceljs";
import { normalizePipeline, readPipeline } from "./pipeline-config.mjs";

export const DEFAULT_CANDIDATE_CAPACITY = 1000;
export const ledgerColumns = [
  "候选人ID", "姓名", "年龄", "学历", "总工作年限", "对口岗位年限", "对口项目年限", "当前公司", "当前岗位", "当前Base", "目标Base", "简历收取时间", "简历来源", "推荐人/渠道", "简历/档案链接", "年龄/年限资格提示", "能力证据得分", "证据覆盖率", "核心证据缺口", "主阶段", "阶段状态", "状态更新时间", "下一步动作", "下次跟进日期", "责任人", "是否看机会", "求职动机", "当前薪资", "期望薪资", "期望职级", "电话纪要", "一面日期", "二面日期", "三面日期", "HRBP日期", "决策会日期", "面试反馈摘要", "业务判断", "终止原因", "备注", "策略反馈标签", "更新人", "最后更新时间",
];
export const statusValues = ["进行中", "通过", "终止"];
export const terminationReasons = ["不看机会/无意向", "Base 不符", "联系不上", "薪资不符", "简历不匹配", "面试/评审不通过", "横向比较", "候选人自行退出", "岗位暂停", "其他待说明"];
const sourceValues = ["内部人才库", "员工推荐", "招聘平台", "猎头", "官网投递", "活动/社群", "其他"];
const border = { style: "thin", color: { argb: "FFD6DEE6" } };
const headerFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF143D59" } };

function setHeader(row) { row.eachCell((cell) => { cell.font = { bold: true, color: { argb: "FFFFFFFF" } }; cell.fill = headerFill; cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; cell.border = { top: border, left: border, bottom: border, right: border }; }); }
function listFormula(column, count) { return `'选项配置'!$${column}$2:$${column}$${count + 1}`; }
function columnNumber(name) { return ledgerColumns.indexOf(name) + 1; }
function requiredCapacity(capacity) { const value = Number(capacity); if (!Number.isInteger(value) || value < 1) throw new Error("台账容量必须是大于 0 的整数。"); return value; }

export async function buildLedger(roleName, pipeline, { capacity = DEFAULT_CANDIDATE_CAPACITY } = {}) {
  if (!pipeline) throw new Error("创建台账前必须提供已确认的 PIPELINE.json 流程配置。");
  const normalizedPipeline = normalizePipeline(pipeline);
  const candidateCapacity = requiredCapacity(capacity);
  const stages = normalizedPipeline.stages.map(({ id, name }) => `${id}-${name}`);
  const workbook = new ExcelJS.Workbook();
  const ledger = workbook.addWorksheet("候选人台账", { views: [{ showGridLines: false, state: "frozen", ySplit: 3, xSplit: 2 }] });
  const dictionary = workbook.addWorksheet("状态字典", { views: [{ showGridLines: false }] });
  const review = workbook.addWorksheet("复盘口径", { views: [{ showGridLines: false, state: "frozen", ySplit: 3 }] });
  const config = workbook.addWorksheet("选项配置", { views: [{ showGridLines: false }] });
  const lastColumn = ledger.getColumn(ledgerColumns.length).letter;
  const lastRow = candidateCapacity + 3;
  ledger.mergeCells(`A1:${lastColumn}1`); ledger.getCell("A1").value = `${roleName}｜候选人台账`; ledger.getCell("A1").font = { bold: true, color: { argb: "FFFFFFFF" }, size: 16 }; ledger.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B2239" } };
  ledger.mergeCells(`A2:${lastColumn}2`); ledger.getCell("A2").value = "使用说明：主阶段记录实际停留节点；阶段状态仅使用进行中、通过或终止。约面、暂缓等细节写入下一步动作或备注。所有流程变更需招聘者人工确认。"; ledger.getCell("A2").alignment = { wrapText: true, vertical: "middle" };
  ledger.addRow(ledgerColumns); setHeader(ledger.getRow(3)); ledger.autoFilter = `A3:${lastColumn}3`;
  ledger.columns.forEach((column, index) => { column.width = ["电话纪要", "面试反馈摘要", "备注"].includes(ledgerColumns[index]) ? 28 : 14; });
  for (let row = 4; row <= lastRow; row += 1) { const current = ledger.getRow(row); current.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; current.eachCell({ includeEmpty: true }, (cell) => { cell.border = { top: border, left: border, bottom: border, right: border }; }); }
  ["简历收取时间", "状态更新时间", "下次跟进日期", "一面日期", "二面日期", "三面日期", "HRBP日期", "决策会日期", "最后更新时间"].forEach((name) => { ledger.getColumn(columnNumber(name)).numFmt = "yyyy-mm-dd"; });
  const configColumns = [["简历来源", sourceValues], ["主阶段", stages], ["阶段状态", normalizedPipeline.statuses], ["终止原因", terminationReasons]];
  configColumns.forEach(([title, values], index) => { const column = index + 1; config.getCell(1, column).value = title; values.forEach((value, row) => { config.getCell(row + 2, column).value = value; }); config.getColumn(column).width = 20; }); setHeader(config.getRow(1));
  const validationColumns = [["主阶段", "B", stages.length], ["阶段状态", "C", normalizedPipeline.statuses.length], ["简历来源", "A", sourceValues.length], ["终止原因", "D", terminationReasons.length]];
  validationColumns.forEach(([name, configColumn, count]) => ledger.getColumn(columnNumber(name)).eachCell({ includeEmpty: true }, (cell, row) => { if (row >= 4) cell.dataValidation = { type: "list", allowBlank: true, formulae: [listFormula(configColumn, count)] }; }));
  dictionary.addRow(["类别", "值", "使用说明"]); setHeader(dictionary.getRow(1)); [...stages.map((value) => ["主阶段", value, "流程节点"]), ...normalizedPipeline.statuses.map((value) => ["阶段状态", value, "跟进状态"]), ...terminationReasons.map((value) => ["终止原因", value, "阶段状态为终止时填写"])].forEach((row) => dictionary.addRow(row));
  review.mergeCells("A1:K1"); review.getCell("A1").value = `${roleName}｜招聘复盘（脱敏聚合）`; review.addRow([]); review.addRow(["主阶段", "候选人数量", "口径"]); setHeader(review.getRow(3)); stages.forEach((stage, index) => { const row = review.addRow([stage, { formula: `COUNTIF('候选人台账'!$${ledger.getColumn(columnNumber("主阶段")).letter}$4:$${ledger.getColumn(columnNumber("主阶段")).letter}$${lastRow},A${index + 4})` }, "按当前主阶段统计"]); row.eachCell((cell) => { cell.border = { top: border, left: border, bottom: border, right: border }; }); });
  return workbook;
}

export async function writeLedger({ roleName, outputPath, pipeline, capacity }) { const workbook = await buildLedger(roleName, pipeline, { capacity }); await fs.mkdir(path.dirname(outputPath), { recursive: true }); await workbook.xlsx.writeFile(outputPath); return outputPath; }
function argument(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(currentFile).href) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("用途：按岗位流程创建候选人台账。\n用法：node workflow/scripts/create-role-ledger.mjs --role <岗位名称> --pipeline <PIPELINE.json> --out <candidate-ledger.xlsx> [--capacity <人数>]");
    process.exit(0);
  }
  const roleName = argument("--role"); const outputPath = argument("--out"); const pipelinePath = argument("--pipeline"); const capacity = argument("--capacity") ?? DEFAULT_CANDIDATE_CAPACITY; if (!roleName || !outputPath || !pipelinePath) throw new Error("用法：--role <岗位名称> --pipeline <PIPELINE.json> --out <candidate-ledger.xlsx> [--capacity <人数>]"); await writeLedger({ roleName, outputPath, pipeline: await readPipeline(pipelinePath), capacity }); console.log(`已生成：${outputPath}`);
}
