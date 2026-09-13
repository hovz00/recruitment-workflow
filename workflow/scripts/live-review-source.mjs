import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import ExcelJS from 'exceljs';
import { cellValue, normalizeReviewRow, reviewHeaders } from './sync-dashboard-data.mjs';
import { normalizePipeline, stageLabels } from './pipeline-config.mjs';
import { validateCandidateRecord } from './validate-candidate-record.mjs';
import { boundedPath } from './workspace-safety.mjs';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const fail = message => { throw new Error(message); };

// RFC 4180 quoting, including embedded newlines; reject truncated and ambiguous input.
export function parseCanonicalCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], field = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
    } else if (char === '"') {
      if (field || closed) fail('CSV 引号位置不合法。');
      quoted = true;
    } else if (char === ',' || char === '\n' || char === '\r') {
      row.push(field); field = ''; closed = false;
      if (char !== ',') {
        rows.push(row); row = [];
        if (char === '\r' && text[i + 1] === '\n') i++;
      }
    } else {
      if (closed) fail('CSV 引号后含有多余内容。');
      field += char;
    }
  }
  if (quoted) fail('CSV 尚未写入完整。');
  if (row.length || field || closed) rows.push([...row, field]);
  return rows;
}

function recordsFromValues(values, required, { exactHeaders } = {}) {
  const headers = values[0]?.map(value => String(cellValue(value)));
  if (!headers?.length || new Set(headers).size !== headers.length || headers.some(h => !h) || required.some(h => !headers.includes(h))) fail('表头缺失或重复，请重新生成标准导出文件。');
  if (exactHeaders && (headers.length !== exactHeaders.length || headers.some(h => !exactHeaders.includes(h)))) fail('只接受标准导出的完整表头。');
  return values.slice(1).filter(row => row.some(value => String(cellValue(value)).trim())).map(row => {
    if (exactHeaders && row.length !== headers.length) fail('数据行列数不完整。');
    return Object.fromEntries(headers.map((header, i) => [header, cellValue(row[i])]));
  });
}

async function assertUnlocked(rootPath) {
  const lockPath = await boundedPath(rootPath, '.recruitment-agent', 'writer.lock');
  try { await fs.lstat(lockPath); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const error = new Error('写入进行中，请等待完成。'); error.code = 'LIVE_WAITING'; throw error;
}

export async function readLiveSource({ rootPath, rolePath, role, sourcePath, privacy }) {
  await assertUnlocked(rootPath);
  const pipelinePath = await boundedPath(rootPath, path.relative(rootPath, path.join(rolePath, 'PIPELINE.json')));
  const filePath = sourcePath || await boundedPath(rootPath, path.relative(rootPath, path.join(rolePath, 'candidate-ledger.xlsx')));
  const read = () => Promise.all([fs.readFile(filePath), fs.readFile(pipelinePath)]);
  const first = await read();
  await wait(40);
  const buffers = await read();
  if (first.some((buffer, i) => hash(buffer) !== hash(buffers[i]))) { const error = new Error('文件仍在写入，请稍候。'); error.code = 'LIVE_WAITING'; throw error; }
  await assertUnlocked(rootPath);
  const pipeline = normalizePipeline(JSON.parse(buffers[1].toString('utf8')));
  const stages = stageLabels(pipeline), slaDays = pipeline.stages.map(stage => stage.slaDays || null);
  const headers = [...reviewHeaders, ...stages.flatMap(stage => [`${stage}日期`, `${stage}通过日期`])];
  let records;
  if (sourcePath && path.extname(sourcePath).toLowerCase() === '.csv') {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    records = recordsFromValues(parseCanonicalCsv(decoder.decode(buffers[0])), headers, { exactHeaders: headers });
  } else {
    const book = new ExcelJS.Workbook(); await book.xlsx.load(buffers[0]);
    if (sourcePath) {
      if (book.worksheets.length !== 1 || book.worksheets[0].name !== '招聘数据') fail('请使用 export-review-data.mjs 生成的标准文件，不可使用操作台账。');
      const sheet = book.worksheets[0], values = [];
      for (let i = 1; i <= sheet.rowCount; i++) {
        const row = [];
        for (let column = 1; column <= sheet.columnCount; column++) {
          const value = sheet.getCell(i, column).value;
          if (value && typeof value === 'object' && !(value instanceof Date)) fail('标准文件不能包含公式或复杂单元格。');
          row.push(cellValue(value));
        }
        values.push(row);
      }
      records = recordsFromValues(values, headers, { exactHeaders: headers });
    } else {
      const sheet = book.getWorksheet('候选人台账'), config = book.getWorksheet('选项配置');
      if (!sheet || !config) fail('台账缺少必要工作表。');
      const configured = [];
      for (let i = 2; config.getCell(i, 2).value; i++) configured.push(String(config.getCell(i, 2).value));
      if (JSON.stringify(configured) !== JSON.stringify(stages)) fail('台账阶段与岗位流程不同，请先迁移台账。');
      const values = [];
      for (let i = 3; i <= sheet.rowCount; i++) values.push(sheet.getRow(i).values.slice(1));
      records = recordsFromValues(values, ['候选人ID', '姓名', '主阶段', '阶段状态', '简历收取时间', '简历来源']);
    }
  }
  const seen = new Set();
  const rows = records.map((record, index) => {
    validateCandidateRecord(record, { stages });
    if (sourcePath && record['岗位名称'] !== role) fail('标准文件岗位与启动岗位不一致。');
    const identity = sourcePath ? JSON.stringify(record) : String(record['候选人ID'] || '').trim();
    if (identity && seen.has(identity)) fail('文件存在重复记录或候选人 ID。');
    if (identity) seen.add(identity);
    const row = normalizeReviewRow(sourcePath ? { ...record, '姓名': record['候选人姓名'], '备注': record['备注信息'] } : record, role, { privacy, index });
    return Object.fromEntries(headers.map(header => [header, row[header] ?? '']));
  });
  // Reject a writer that began during parsing, even if its workbook is valid so far.
  await assertUnlocked(rootPath);
  const after = await read();
  if (after.some((buffer, i) => hash(buffer) !== hash(buffers[i]))) { const error = new Error('文件仍在写入，请稍候。'); error.code = 'LIVE_WAITING'; throw error; }
  return { rows, stages, slaDays, role, privacy };
}

export const liveVersion = data => hash(JSON.stringify(data));
