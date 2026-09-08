import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { buildLedger } from '../scripts/create-role-ledger.mjs';
import { createReviewDashboard, formalDashboardTemplate } from '../scripts/create-review-dashboard.mjs';
import { syncDashboard } from '../scripts/sync-dashboard-data.mjs';
import { exportReviewData } from '../scripts/export-review-data.mjs';

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE || import.meta.url);
const { chromium } = require('playwright');
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-browser-'));
const pipeline = { stages: [{ id: 0, name: '初筛', slaDays: 2 }, { id: 1, name: '面试', slaDays: 4 }, { id: 2, name: 'Offer', slaDays: 7 }, { id: 3, name: '入职', slaDays: 14 }] };
const ledgerPath = path.join(directory, 'candidate-ledger.xlsx'), dashboardPath = path.join(directory, '招聘数据复盘.html');
const book = await buildLedger('虚构验证岗位', pipeline, { capacity: 5 });
const sheet = book.getWorksheet('候选人台账');
const headers = sheet.getRow(3).values.slice(1);
for (const [i, [stage, status]] of [['1-面试', '通过'], ['2-Offer', '通过'], ['3-入职', '通过'], ['1-面试', '终止']].entries()) {
  const row = { '候选人ID': `SYN-${i}`, '姓名': `虚构人员${i}`, '主阶段': stage, '阶段状态': status, '简历收取时间': '2026-09-01', '简历来源': '员工推荐', '终止原因': status === '终止' ? '薪资不符' : '', '0-初筛日期': '2026-09-01', '0-初筛通过日期': '2026-09-02', '1-面试日期': '2026-09-03' };
  for (const [key, value] of Object.entries(row)) sheet.getCell(i + 4, headers.indexOf(key) + 1).value = value;
}
await book.xlsx.writeFile(ledgerPath);await createReviewDashboard(dashboardPath);await syncDashboard({ ledgerPath, dashboardPath, role: '虚构验证岗位' });
const exported = await exportReviewData({ ledgerPath, role: '虚构验证岗位', outputDir: path.join(directory, 'exports') });
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const page = await browser.newPage();page.on('pageerror', error => errors.push(error.message));
  await page.goto(pathToFileURL(dashboardPath).href);
  assert.equal(await page.title(), '虚构验证岗位｜招聘数据复盘');
  assert.equal(await page.locator('#fileInput').isEnabled(), true);
  const expected = await page.evaluate(() => ({ total: rawData.length, stages: STAGES_CONFIG.map(s => ({ label: s.label, slaDays: s.slaDays })), summary: currentAnalysisResult.summary }));
  assert.equal(expected.total, 4);
  assert.equal(expected.summary.inFlightCount, 2);assert.equal(expected.summary.completedCount, 1);assert.equal(expected.summary.realLossCount, 1);
  assert.equal(expected.stages[0].slaDays, 2);
  await page.evaluate(() => { rawData = []; importedSourceRows = []; });
  await page.locator('#fileInput').setInputFiles(exported.xlsxPath);
  await page.waitForFunction(() => rawData.length === 4 && importedSourceRows.length === 4);
  assert.deepEqual(await page.evaluate(() => currentAnalysisResult.summary), expected.summary);
  const standalone = process.env.REVIEW_HTML || formalDashboardTemplate;
  await page.goto(pathToFileURL(path.resolve(standalone)).href);
  await page.locator('#topUploadAction').click();
  while (await page.locator('[data-stage-label]').count() > 4) await page.getByRole('button', { name: '删除最后阶段' }).click();
  for (const [i, stage] of pipeline.stages.entries()) await page.locator('[data-stage-label]').nth(i).fill(stage.name);
  const chooser = page.waitForEvent('filechooser');await page.locator('#confirmStageConfigButton').click();await (await chooser).setFiles(exported.xlsxPath);
  await page.waitForFunction(() => rawData.length === 4);
  assert.equal(await page.evaluate(() => currentAnalysisResult.summary.inFlightCount), 2);
  assert.equal(await page.evaluate(() => currentAnalysisResult.summary.completedCount), 1);
  await page.evaluate(() => { rawData = []; importedSourceRows = []; });
  await page.locator('#fileInput').setInputFiles(exported.csvPath);
  await page.waitForFunction(() => rawData.length === 4);
  assert.equal(await page.evaluate(() => currentAnalysisResult.summary.realLossCount), 1);
  assert.deepEqual(errors, []);
  console.log('Browser verified: preview + XLSX + CSV import; 4 records, 2 active, 1 completed, 1 terminated.');
} finally {
  await browser.close();await fs.rm(directory, { recursive: true, force: true });
}
