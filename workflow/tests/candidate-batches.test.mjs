import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import ExcelJS from 'exceljs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {initializeRoleWorkspace} from '../scripts/initialize-role-workspace.mjs';
import {createSession,setCurrentRole} from '../scripts/agent-state.mjs';
import {createPendingAction,applyConfirmedAction} from '../scripts/apply-confirmed-action.mjs';
const api=()=>import('../scripts/candidate-batches.mjs');
const proposal=(id,name=id)=>({role:'测试岗位',intent:'candidate_create',candidate:{id,name},changes:Object.entries({'简历来源':'员工推荐','简历收取时间':'2020-01-01','主阶段':'0-初筛','阶段状态':'进行中'}).map(([field,after])=>({field,after})),evidence:['测试确认新增']});
async function fixture(t){
  const rootPath=await fs.mkdtemp(path.join(os.tmpdir(),'candidate-batches-'));t.after(()=>fs.rm(rootPath,{recursive:true,force:true}));
  const {sessionId}=await createSession({rootPath});const {rolePath}=await initializeRoleWorkspace({rootPath,sessionId,roleName:'测试岗位',capacity:8,pipeline:{stages:[{id:0,name:'初筛'},{id:1,name:'一面'}]},documents:{'ROLE_STANDARD.md':'# 标准\n核对交付证据。','CONTEXT.md':'# 上下文\n当前标准版本：v1'},confirmation:{version:'v1',confirmedBy:'测试确认人',evidence:'确认岗位标准'}});
  return {rootPath,sessionId,rolePath};
}
async function rows(f){const book=new ExcelJS.Workbook();await book.xlsx.readFile(path.join(f.rolePath,'candidate-ledger.xlsx'));const sheet=book.getWorksheet('候选人台账');return Array.from({length:sheet.rowCount-3},(_,i)=>sheet.getRow(i+4).values.slice(1)).filter(row=>row[0]);}

test('one immutable batch previews multiple people without writes and applies them without self-invalidating',async t=>{
  const f=await fixture(t),a=await api();const batch=await a.createCandidateBatch({...f,proposals:[proposal('C-1'),proposal('C-2'),proposal('C-3')]});assert.equal(batch.items.length,3);assert.equal((await rows(f)).length,0);
  const result=await a.applyCandidateBatch({...f,batchId:batch.id});assert.equal(result.counts.applied,3);assert.equal((await rows(f)).length,3);
  const before=await fs.readFile(path.join(f.rolePath,'ACTION_LOG.md'));await a.applyCandidateBatch({...f,batchId:batch.id});assert.deepEqual(await fs.readFile(path.join(f.rolePath,'ACTION_LOG.md')),before);
});
test('subset confirmation, chunked resume and cancellation retain independent item status',async t=>{
  const f=await fixture(t),a=await api();const batch=await a.createCandidateBatch({...f,proposals:[proposal('C-1'),proposal('C-2'),proposal('C-3'),proposal('C-4')]});
  await a.applyCandidateBatch({...f,batchId:batch.id,itemIds:[batch.items[1].id]});assert.deepEqual((await rows(f)).map(row=>row[0]),['C-2']);
  await a.cancelCandidateBatchItems({...f,batchId:batch.id,itemIds:[batch.items[2].id],reason:'招聘者确认暂不写入'});
  let result=await a.applyCandidateBatch({...f,batchId:batch.id,limit:1});assert.deepEqual(result.counts,{pending:1,applied:2,failed:0,cancelled:1});
  result=await a.applyCandidateBatch({...f,batchId:batch.id});assert.deepEqual(result.counts,{pending:0,applied:3,failed:0,cancelled:1});
});
test('wrong session, wrong role, duplicate candidate IDs and bad item selections are rejected before writes',async t=>{
  const f=await fixture(t),a=await api();await assert.rejects(()=>a.createCandidateBatch({...f,proposals:[proposal('C-1'),proposal('c-1')]}),/重复/);
  const batch=await a.createCandidateBatch({...f,proposals:[proposal('C-1'),proposal('C-2')]});
  await assert.rejects(()=>a.applyCandidateBatch({...f,sessionId:undefined,batchId:batch.id}),/会话/);
  await assert.rejects(()=>a.applyCandidateBatch({...f,batchId:batch.id,itemIds:[batch.items[0].id,'unknown']}),/条目/);
  await setCurrentRole({...f,role:'其他岗位'});await assert.rejects(()=>a.applyCandidateBatch({...f,batchId:batch.id}),/岗位/);assert.equal((await rows(f)).length,0);
});
test('outside ledger changes invalidate the remaining batch instead of silently rebasing it',async t=>{
  const f=await fixture(t),a=await api();const batch=await a.createCandidateBatch({...f,proposals:[proposal('C-1'),proposal('C-2')]});await a.applyCandidateBatch({...f,batchId:batch.id,limit:1});
  const p=await createPendingAction({...f,proposal:proposal('C-3')});await applyConfirmedAction({...f,proposalId:p.id});
  await assert.rejects(()=>a.applyCandidateBatch({...f,batchId:batch.id}),/事实源.*变化/);assert.deepEqual((await rows(f)).map(row=>row[0]),['C-1','C-3']);
});
test('standard changes and tampered batch payloads are rejected',async t=>{
  const f=await fixture(t),a=await api();const batch=await a.createCandidateBatch({...f,proposals:[proposal('C-1')]});
  const standard=path.join(f.rolePath,'ROLE_STANDARD.md'),before=await fs.readFile(standard);await fs.appendFile(standard,'\n新标准');await assert.rejects(()=>a.applyCandidateBatch({...f,batchId:batch.id}),/标准|确认/);await fs.writeFile(standard,before);
  const file=path.join(f.rootPath,'.recruitment-agent','batches',batch.id,'preview.json');const payload=JSON.parse(await fs.readFile(file));payload.items[0].candidate.name='修改后的名字';await fs.writeFile(file,JSON.stringify(payload));
  await assert.rejects(()=>a.applyCandidateBatch({...f,batchId:batch.id}),/变化|篡改/);assert.equal((await rows(f)).length,0);
});
test('partial failure rolls back only the failing item and explicit retry resumes without duplicating successes',async t=>{
  const f=await fixture(t),a=await api();const batch=await a.createCandidateBatch({...f,proposals:[proposal('C-1'),proposal('C-2'),proposal('C-3')]});
  const write=fs.writeFile;let injected=false;const mock=t.mock.method(fs,'writeFile',async(file,...args)=>{if(!injected&&String(file).endsWith(`${path.sep}C-2.md`)){injected=true;throw new Error('INJECTED_ARCHIVE_FAILURE');}return write(file,...args);});
  let result=await a.applyCandidateBatch({...f,batchId:batch.id});mock.mock.restore();assert.equal(result.counts.applied,1);assert.equal(result.counts.failed,1);assert.equal(result.counts.pending,1);assert.deepEqual((await rows(f)).map(row=>row[0]),['C-1']);
  result=await a.applyCandidateBatch({...f,batchId:batch.id,retryFailed:true});assert.equal(result.counts.applied,3);assert.deepEqual((await rows(f)).map(row=>row[0]),['C-1','C-2','C-3']);
});
test('progress checkpoint failure rolls business writes back before an explicit retry',async t=>{
  const f=await fixture(t),a=await api();const batch=await a.createCandidateBatch({...f,proposals:[proposal('C-1')]});
  const write=fs.writeFile;let injected=false;const mock=t.mock.method(fs,'writeFile',async(file,content,...args)=>{if(!injected&&String(file).endsWith('progress.json.tmp')&&String(content).includes('"status": "applied"')){injected=true;throw new Error('CHECKPOINT_FAILURE');}return write(file,content,...args);});
  const result=await a.applyCandidateBatch({...f,batchId:batch.id});mock.mock.restore();assert.equal(result.counts.failed,1);assert.equal((await rows(f)).length,0);
  assert.equal((await a.applyCandidateBatch({...f,batchId:batch.id,retryFailed:true})).counts.applied,1);
});

test('pause signal finishes the current item and safely resumes the remaining queue',async t=>{
  const f=await fixture(t),a=await api(),controller=new AbortController();const batch=await a.createCandidateBatch({...f,proposals:[proposal('C-1'),proposal('C-2')]});
  const write=fs.writeFile;const mock=t.mock.method(fs,'writeFile',async(file,...args)=>{const result=await write(file,...args);if(String(file).endsWith(`${path.sep}C-1.md`))controller.abort();return result;});
  let result=await a.applyCandidateBatch({...f,batchId:batch.id,signal:controller.signal});mock.mock.restore();assert.equal(result.counts.applied,1);assert.equal(result.counts.pending,1);assert.equal(result.recoveryRequired,false);
  result=await a.applyCandidateBatch({...f,batchId:batch.id});assert.equal(result.counts.applied,2);
});
test('concurrent executions of the same batch do not apply any item twice',async t=>{
  const f=await fixture(t),a=await api();const batch=await a.createCandidateBatch({...f,proposals:[proposal('C-1'),proposal('C-2'),proposal('C-3')]});
  await Promise.all([a.applyCandidateBatch({...f,batchId:batch.id}),a.applyCandidateBatch({...f,batchId:batch.id})]);
  const result=await a.getCandidateBatch({...f,batchId:batch.id});assert.equal(result.counts.applied,3);assert.ok(result.items.every(item=>item.attempts===1));assert.equal((await rows(f)).length,3);
});
test('invalid before values, ranges and same-name conflicts fail batch preflight without writes',async t=>{
  const f=await fixture(t),a=await api();const invalid=proposal('C-2');invalid.changes.push({field:'能力证据得分',after:80});
  await assert.rejects(()=>a.createCandidateBatch({...f,proposals:[proposal('C-1'),invalid]}),/得分/);
  await assert.rejects(()=>a.createCandidateBatch({...f,proposals:[proposal('C-1','同名'),proposal('C-2','同名')]}),/同名/);assert.equal((await rows(f)).length,0);
});
test('hard process exit leaves an explicit recovery barrier instead of blindly replaying a possibly written item',async t=>{
  const f=await fixture(t),a=await api();const batch=await a.createCandidateBatch({...f,proposals:[proposal('C-1'),proposal('C-2')]});
  const child=path.join(f.rootPath,'crash-test.mjs');
  await fs.writeFile(child,`import fs from 'node:fs/promises';import path from 'node:path';import {applyCandidateBatch} from ${JSON.stringify(new URL('../scripts/candidate-batches.mjs',import.meta.url).href)};const original=fs.writeFile;fs.writeFile=async(file,...args)=>{const result=await original(file,...args);if(String(file).endsWith(path.sep+'C-1.md'))process.exit(77);return result;};await applyCandidateBatch(${JSON.stringify({...f,batchId:batch.id})});`);
  await assert.rejects(()=>promisify(execFile)(process.execPath,[child]),error=>error.code===77);
  // The process has exited; only this fixture's stale lock is removed to inspect recovery.
  await fs.rm(path.join(f.rootPath,'.recruitment-agent','writer.lock'));
  const state=await a.getCandidateBatch({...f,batchId:batch.id});assert.equal(state.recoveryRequired,true);assert.ok(state.inFlight.backupId);
  await assert.rejects(()=>a.applyCandidateBatch({...f,batchId:batch.id}),/未完成.*事务|重放/);
  await fs.access(path.join(f.rootPath,'.recruitment-agent','backups',state.inFlight.backupId,'manifest.json'));
});
test('CLI creates and resumes batches with the same session identifier',async t=>{
  const f=await fixture(t),run=promisify(execFile),script=fileURLToPath(new URL('../scripts/candidate-batch.mjs',import.meta.url)),input=path.join(f.rootPath,'input.json');await fs.writeFile(input,JSON.stringify({proposals:[proposal('C-1'),proposal('C-2')]}));
  const args=['--root',f.rootPath,'--session',f.sessionId];const created=JSON.parse((await run(process.execPath,[script,'create',...args,'--input',input])).stdout);
  let result=JSON.parse((await run(process.execPath,[script,'apply',...args,'--batch',created.id,'--limit','1'])).stdout);assert.equal(result.counts.applied,1);
  result=JSON.parse((await run(process.execPath,[script,'apply',...args,'--batch',created.id])).stdout);assert.equal(result.counts.applied,2);
});
