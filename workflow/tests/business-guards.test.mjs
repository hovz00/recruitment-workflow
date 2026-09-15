import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ExcelJS from 'exceljs';
import {initializeRoleWorkspace} from '../scripts/initialize-role-workspace.mjs';
import {createPendingAction,applyConfirmedAction} from '../scripts/apply-confirmed-action.mjs';
import {getRoleSnapshot} from '../scripts/get-role-snapshot.mjs';
import {readPipeline,normalizePipeline} from '../scripts/pipeline-config.mjs';
import {confirmRoleStandard} from '../scripts/confirm-role-standard.mjs';
import {exportReviewData} from '../scripts/export-review-data.mjs';
import {syncDashboard} from '../scripts/sync-dashboard-data.mjs';

const pipeline={stages:[{id:0,name:'简历初筛'},{id:1,name:'案例答辩',kind:'interview',appointmentField:'1-案例答辩预约日期'},{id:2,name:'入职'}]};
const documents={'ROLE_STANDARD.md':'# 岗位标准\n以独立项目交付证据核验能力。','CONTEXT.md':'# 岗位上下文\n当前标准版本：v1\n业务事实保留。'};
const confirmation={version:'v1',confirmedBy:'模拟招聘者',evidence:'已核对岗位目标、评价维度和流程，明确确认。'};
test('custom and legacy interviews cannot share an appointment field',()=>{
  assert.throws(()=>normalizePipeline({stages:[{id:0,name:'业务一面'},{id:1,name:'案例答辩',kind:'interview',appointmentField:'一面日期'}]}),/预约字段.*共用/);
});
async function fixture(t,confirmed=true){const rootPath=await fs.mkdtemp(path.join(os.tmpdir(),'business-guards-'));t.after(()=>fs.rm(rootPath,{recursive:true,force:true}));const {rolePath}=await initializeRoleWorkspace({rootPath,roleName:'测试岗位',pipeline,capacity:5,documents:confirmed?documents:{},...(confirmed?{confirmation}:{})});return{rootPath,rolePath};}
function intake(id='C-001',name='同名样本'){return{role:'测试岗位',intent:'candidate_create',candidate:{id,name},changes:Object.entries({'主阶段':'0-简历初筛','阶段状态':'进行中','简历来源':'员工推荐','简历收取时间':'2020-08-01'}).map(([field,after])=>({field,after})),evidence:['模拟招聘者确认新增']};}
async function apply(f,proposal){const p=await createPendingAction({rootPath:f.rootPath,proposal});return applyConfirmedAction({rootPath:f.rootPath,proposalId:p.id});}
test('draft standards block intake without changing ledger or making a pending proposal',async t=>{const f=await fixture(t,false);const before=await fs.readFile(path.join(f.rolePath,'candidate-ledger.xlsx'));await assert.rejects(()=>apply(f,intake()),/岗位标准.*确认|草稿/);assert.deepEqual(await fs.readFile(path.join(f.rolePath,'candidate-ledger.xlsx')),before);});
test('explicitly confirmed distinct people may share a name and retain identity evidence',async t=>{const f=await fixture(t);await apply(f,intake());const p=intake('C-002');p.identityResolution={confirmedDistinct:true,matchedCandidateIds:['C-001'],reason:'已核对各自简历与联系信息，明确为两人。'};await apply(f,p);const book=new ExcelJS.Workbook();await book.xlsx.readFile(path.join(f.rolePath,'candidate-ledger.xlsx'));assert.equal(book.getWorksheet('候选人台账').getCell('A5').value,'C-002');assert.equal(book.getWorksheet('候选人台账').getCell('B5').value,'同名样本');assert.match(await fs.readFile(path.join(f.rolePath,'ACTION_LOG.md'),'utf8'),/同名核实.*C-001.*已核对/s);});
test('same-name bypass requires exact matched IDs and a reason',async t=>{const f=await fixture(t);await apply(f,intake());for(const identityResolution of [{confirmedDistinct:true,matchedCandidateIds:['WRONG'],reason:'different'},{confirmedDistinct:true,matchedCandidateIds:['C-001'],reason:''},{confirmedDistinct:'true',matchedCandidateIds:['C-001'],reason:'different'}])await assert.rejects(()=>apply(f,{...intake('C-002'),identityResolution}),/同名|核实/);});
test('standard edits invalidate pending decisions before any write',async t=>{const f=await fixture(t);await apply(f,intake());const p=await createPendingAction({rootPath:f.rootPath,proposal:{...intake(),intent:'candidate_update',changes:[{field:'下一步动作',before:'',after:'核对项目证据'}]}});const before=await fs.readFile(path.join(f.rolePath,'candidate-ledger.xlsx'));await fs.appendFile(path.join(f.rolePath,'ROLE_STANDARD.md'),'\n业务目标已调整。');await assert.rejects(()=>applyConfirmedAction({rootPath:f.rootPath,proposalId:p.id}),/标准.*变化|标准.*确认/);assert.deepEqual(await fs.readFile(path.join(f.rolePath,'candidate-ledger.xlsx')),before);});
test('custom interview metadata survives normalization and identifies pending feedback',async t=>{const f=await fixture(t);const normalized=await readPipeline(path.join(f.rolePath,'PIPELINE.json'));assert.equal(normalized.stages[1].kind,'interview');await apply(f,intake());await apply(f,{...intake(),intent:'candidate_update',changes:[{field:'主阶段',before:'0-简历初筛',after:'1-案例答辩'},{field:'1-案例答辩预约日期',before:'',after:'2020-08-04'}]});assert.equal((await getRoleSnapshot({roleName:'测试岗位',rolePath:f.rolePath,now:new Date('2020-08-05')})).pendingFeedback,1);await apply(f,{...intake(),intent:'candidate_update',changes:[{field:'面试反馈摘要',before:'',after:'[1-案例答辩] 模拟反馈已收齐'}]});assert.equal((await getRoleSnapshot({roleName:'测试岗位',rolePath:f.rolePath,now:new Date('2020-08-05')})).pendingFeedback,0);});
test('legacy role documents require explicit confirmation and preserve business text',async t=>{
  const f=await fixture(t,false);for(const [file,text]of Object.entries(documents))await fs.writeFile(path.join(f.rolePath,file),text);
  await assert.rejects(()=>apply(f,intake()),/岗位标准.*确认/);
  await confirmRoleStandard({rootPath:f.rootPath,roleName:'测试岗位',...confirmation});await apply(f,intake());
  assert.equal((await getRoleSnapshot({roleName:'测试岗位',rolePath:f.rolePath})).standardVersion,'v1');
  assert.match(await fs.readFile(path.join(f.rolePath,'CONTEXT.md'),'utf8'),/业务事实保留/);
});
test('reconfirmation requires a new preview and the new standard version is recorded',async t=>{
  const f=await fixture(t);const old=await createPendingAction({rootPath:f.rootPath,proposal:intake()});
  await fs.appendFile(path.join(f.rolePath,'ROLE_STANDARD.md'),'\n明确项目验收证据要求。');
  await confirmRoleStandard({rootPath:f.rootPath,roleName:'测试岗位',...confirmation,version:'v2'});
  await assert.rejects(()=>applyConfirmedAction({rootPath:f.rootPath,proposalId:old.id}),/标准.*变化/);
  const next=await createPendingAction({rootPath:f.rootPath,proposal:intake()});assert.equal(next.standardVersion,'v2');
  await applyConfirmedAction({rootPath:f.rootPath,proposalId:next.id});
});
test('invalid merged fields cannot change ledger, archive or dashboard',async t=>{
  const f=await fixture(t);await apply(f,intake());
  const files=['candidate-ledger.xlsx','CONTEXT.md','ACTION_LOG.md','candidates/C-001.md','招聘数据复盘.html'];
  const before=await Promise.all(files.map(n=>fs.readFile(path.join(f.rolePath,n),'base64')));
  for(const [field,value,prior]of [['简历来源','','员工推荐'],['能力证据得分',80,''],['证据覆盖率',120,''],['1-案例答辩通过日期','2019-01-01',''],['1-案例答辩日期','2999-01-01','']]){
    await assert.rejects(()=>apply(f,{...intake(),intent:'candidate_update',changes:[{field,before:prior,after:value}]}),new RegExp(field));
    assert.deepEqual(await Promise.all(files.map(n=>fs.readFile(path.join(f.rolePath,n),'base64'))),before);
  }
  await apply(f,{...intake(),intent:'candidate_update',changes:[{field:'1-案例答辩预约日期',before:'',after:'2999-01-01'}]});
  const result=await exportReviewData({ledgerPath:path.join(f.rolePath,'candidate-ledger.xlsx'),role:'测试岗位',outputDir:path.join(f.rolePath,'exports')});assert.equal(result.records,1);
  assert.doesNotMatch(await fs.readFile(path.join(f.rolePath,'招聘数据复盘.html'),'utf8'),/2999-01-01/);
});
test('sync and export reject incomplete existing rows before replacing a valid preview',async t=>{
  const f=await fixture(t);await apply(f,intake());const ledgerPath=path.join(f.rolePath,'candidate-ledger.xlsx'),dashboardPath=path.join(f.rolePath,'招聘数据复盘.html');const before=await fs.readFile(dashboardPath);
  const book=new ExcelJS.Workbook();await book.xlsx.readFile(ledgerPath);book.getWorksheet('候选人台账').getCell('M4').value='';await book.xlsx.writeFile(ledgerPath);
  await assert.rejects(()=>syncDashboard({ledgerPath,dashboardPath,role:'测试岗位'}),/简历来源/);
  await assert.rejects(()=>exportReviewData({ledgerPath,role:'测试岗位',outputDir:path.join(f.rolePath,'exports')}),/简历来源/);
  assert.deepEqual(await fs.readFile(dashboardPath),before);
});
