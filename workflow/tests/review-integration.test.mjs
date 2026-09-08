import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildLedger } from '../scripts/create-role-ledger.mjs';
import { createReviewDashboard } from '../scripts/create-review-dashboard.mjs';
import { syncDashboard, normalizeReviewRow } from '../scripts/sync-dashboard-data.mjs';
import { normalizePipeline } from '../scripts/pipeline-config.mjs';
import ExcelJS from 'exceljs';
import { exportReviewData } from '../scripts/export-review-data.mjs';

const pipeline={stages:[{id:0,name:'简历初筛',slaDays:2},{id:1,name:'一面',slaDays:4},{id:2,name:'Offer'},{id:3,name:'入职'}],statuses:['进行中','通过','终止']};
async function fixture(){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'review-regression-'));const book=await buildLedger('虚构岗位',pipeline,{capacity:3});const sheet=book.getWorksheet('候选人台账');const headers=sheet.getRow(3).values.slice(1);const put=(key,value)=>{let n=headers.indexOf(key);if(n<0){n=headers.push(key)-1;sheet.getCell(3,n+1).value=key;}sheet.getCell(4,n+1).value=value;};Object.entries({'候选人ID':'SECRET-ID','姓名':'PRIVATE-NAME','当前公司':'PRIVATE-COMPANY','备注':'PRIVATE-NOTE','主阶段':'1-一面','阶段状态':'进行中','简历收取时间':'2026-09-01','简历来源':'员工推荐','0-简历初筛日期':'2026-09-01','0-简历初筛通过日期':'2026-09-02','1-一面日期':'2026-09-03','一面日期':'2026-09-20'}).forEach(([k,v])=>put(k,v));const ledgerPath=path.join(dir,'candidate-ledger.xlsx');const dashboardPath=path.join(dir,'招聘数据复盘.html');const contextPath=path.join(dir,'CONTEXT.md');await book.xlsx.writeFile(ledgerPath);await fs.writeFile(path.join(dir,'PIPELINE.json'),JSON.stringify(pipeline));await fs.writeFile(contextPath,'# Keep context\n');await createReviewDashboard(dashboardPath);return {dir,ledgerPath,dashboardPath,contextPath,role:'虚构岗位'};}
test('repeated sync preserves facts after previous metadata',async()=>{const f=await fixture();await syncDashboard(f);await fs.appendFile(f.contextPath,'\n## Confirmed\nKEEP-BUSINESS-FACT\n');await syncDashboard(f);assert.match(await fs.readFile(f.contextPath,'utf8'),/KEEP-BUSINESS-FACT/);});
test('default preview removes identifiers and free text, keeps real stage dates',async()=>{const f=await fixture();await syncDashboard(f);const html=await fs.readFile(f.dashboardPath,'utf8');assert.doesNotMatch(html,/PRIVATE-NAME|PRIVATE-COMPANY|PRIVATE-NOTE|SECRET-ID/);assert.match(html,/"1-一面日期":"2026-09-03"/);assert.doesNotMatch(html,/2026-09-20/);});
test('normalization preserves explicit stage and offer dates',()=>{const row=normalizeReviewRow({'姓名':'PRIVATE','主阶段':'1-一面','1-一面日期':'2026-09-03','1-一面通过日期':'2026-09-04','Offer接受日期':'2026-09-06','预计入职日期':'2026-09-20'},'role');assert.equal(row['1-一面日期'],'2026-09-03');assert.equal(row['Offer接受日期'],'2026-09-06');assert.equal(row['预计入职日期'],'2026-09-20');assert.notEqual(row['候选人姓名'],'PRIVATE');});
test('role ledger and pipeline persist dynamic dates and SLA',async()=>{assert.equal(normalizePipeline(pipeline).stages[0].slaDays,2);const book=await buildLedger('role',pipeline,{capacity:2});const headers=book.getWorksheet('候选人台账').getRow(3).values.slice(1);for(const h of ['0-简历初筛日期','1-一面通过日期','Offer接受日期','预计入职日期'])assert.ok(headers.includes(h),h);});
test('generated runtime uses dashboard import and enables manual upload',async()=>{const f=await fixture();await syncDashboard(f);const html=await fs.readFile(f.dashboardPath,'utf8');const runtime=html.split('/* AUTO_LEDGER_DATA:START */')[1];assert.match(runtime,/commitImportedRows/);assert.match(runtime,/disabled = false/);});
test('canonical workbook has one first-row-header data sheet and matches preview data',async()=>{
  const f=await fixture();await syncDashboard(f);
  const result=await exportReviewData({...f,outputDir:path.join(f.dir,'export')});
  const book=new ExcelJS.Workbook();await book.xlsx.readFile(result.xlsxPath);
  assert.equal(book.worksheets.length,1);assert.equal(book.worksheets[0].getCell('A1').value,'主阶段');
  const html=await fs.readFile(f.dashboardPath,'utf8');
  const rows=JSON.parse(html.match(/const AUTO_DASHBOARD_DATA = (.*);/)[1]);
  const sheet=book.worksheets[0],headers=sheet.getRow(1).values.slice(1);
  assert.deepEqual(Object.fromEntries(headers.map((h,i)=>[h,sheet.getCell(2,i+1).value??''])),rows[0]);
  assert.doesNotMatch(await fs.readFile(result.csvPath,'utf8'),/PRIVATE|SECRET/);
  const internal=await exportReviewData({...f,outputDir:path.join(f.dir,'internal'),privacy:'internal'});
  assert.match(await fs.readFile(internal.csvPath,'utf8'),/PRIVATE-NAME/);
});
test('canonical export refuses incomplete intake rows',async()=>{
  const f=await fixture();const book=new ExcelJS.Workbook();await book.xlsx.readFile(f.ledgerPath);book.getWorksheet('候选人台账').getCell('L4').value=null;await book.xlsx.writeFile(f.ledgerPath);
  await assert.rejects(exportReviewData({...f,outputDir:path.join(f.dir,'export')}),/简历收取时间/);
});
