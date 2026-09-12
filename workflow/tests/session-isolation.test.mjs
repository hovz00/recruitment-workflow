import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import * as state from '../scripts/agent-state.mjs';
import {initializeRoleWorkspace} from '../scripts/initialize-role-workspace.mjs';
import {confirmRoleStandard} from '../scripts/confirm-role-standard.mjs';
import {createPendingAction,applyConfirmedAction} from '../scripts/apply-confirmed-action.mjs';
import {getRoleSnapshot} from '../scripts/get-role-snapshot.mjs';
import {withRootLock} from '../scripts/workspace-safety.mjs';

const pipeline={stages:[{id:0,name:'简历初筛'},{id:1,name:'业务一面'}]};
const documents=Object.fromEntries(['CONTEXT.md','ROLE_STANDARD.md','SOURCING_STRATEGY.md','KEYWORD_ITERATIONS.md','FEEDBACK_ITERATIONS.md'].map(name=>[name,'# 已确认\n当前标准版本：v1\n']));
const confirmation={version:'v1',confirmedBy:'测试确认人',evidence:'隔离测试标准确认'};
async function root(t){const rootPath=await fs.mkdtemp(path.join(os.tmpdir(),'session-isolation-'));t.after(()=>fs.rm(rootPath,{recursive:true,force:true}));return rootPath;}
async function init(rootPath,roleName,sessionId){return initializeRoleWorkspace({rootPath,roleName,sessionId,pipeline,documents,confirmation,capacity:4});}
const proposal=(role='甲岗位',id='C-001',name='候选人甲')=>({role,intent:'candidate_create',candidate:{id,name},changes:[{field:'简历来源',after:'员工推荐'},{field:'简历收取时间',after:'2020-01-01'},{field:'主阶段',after:'0-简历初筛'},{field:'阶段状态',after:'进行中'}]});
async function sameRole(t){const rootPath=await root(t);await init(rootPath,'甲岗位');for(const sessionId of ['dialog-a','dialog-b'])await state.setCurrentRole({rootPath,role:'甲岗位',sessionId});return rootPath;}

test('dialogs switch roles independently and preserve legacy selection',async t=>{
  const rootPath=await root(t);await init(rootPath,'甲岗位');await init(rootPath,'乙岗位');
  await state.setCurrentRole({rootPath,role:'甲岗位',sessionId:'dialog-a'});
  await state.setCurrentRole({rootPath,role:'乙岗位',sessionId:'dialog-b'});
  assert.equal(await state.resolveCurrentRole({rootPath,sessionId:'dialog-a'}),'甲岗位');
  assert.equal(await state.resolveCurrentRole({rootPath}),'乙岗位');
  assert.equal((await state.getSelectedRole({rootPath,sessionId:'dialog-a'})).role,'甲岗位');
  await state.setCurrentRole({rootPath,role:'甲岗位',sessionId:'dialog-b'});
  assert.equal(await state.resolveCurrentRole({rootPath,sessionId:'dialog-a'}),'甲岗位');
});
test('initialization only selects a role in the calling dialog',async t=>{
  const rootPath=await root(t);await init(rootPath,'旧岗位');await init(rootPath,'甲岗位','dialog-a');await init(rootPath,'乙岗位','dialog-b');
  assert.equal(await state.resolveCurrentRole({rootPath}),'旧岗位');
  assert.equal(await state.resolveCurrentRole({rootPath,sessionId:'dialog-a'}),'甲岗位');
});
test('missing named selection never falls back to the legacy role',async t=>{
  const rootPath=await root(t);await init(rootPath,'甲岗位');
  await assert.rejects(state.resolveCurrentRole({rootPath,sessionId:'unknown'}),/当前.*岗位|会话/);
  await assert.rejects(createPendingAction({rootPath,sessionId:'unknown',proposal:proposal()}),/当前.*岗位|会话/);
});
test('session IDs reject empty values, traversal and reserved names',async t=>{
  const rootPath=await root(t);await state.setCurrentRole({rootPath,role:'甲岗位'});
  for(const sessionId of ['',null,123,true,'Dialog-A','../escape','..\\escape','CON','bad:stream','a/../../b','trailing.',' space']){
    await assert.rejects(state.resolveCurrentRole({rootPath,sessionId}),/不合法/);
    await assert.rejects(state.setCurrentRole({rootPath,role:'乙岗位',sessionId}),/不合法/);
  }
  assert.equal(await state.resolveCurrentRole({rootPath}),'甲岗位');
});
test('session creation returns a recoverable UUID, with or without an existing role',async t=>{
  const rootPath=await root(t);assert.equal(typeof state.createSession,'function');
  const created=await state.createSession({rootPath});assert.match(created.sessionId,/^[0-9a-f-]{36}$/);
  const saved=JSON.parse(await fs.readFile(path.join(rootPath,'.recruitment-agent','sessions',created.sessionId,'session.json'),'utf8'));
  assert.equal(saved.sessionId,created.sessionId);assert.ok(saved.createdAt);
  await assert.rejects(state.resolveCurrentRole({rootPath,sessionId:created.sessionId}),/当前.*岗位|会话/);
  await init(rootPath,'甲岗位',created.sessionId);
  const selected=await state.createSession({rootPath,roleName:'甲岗位'});
  assert.notEqual(selected.sessionId,created.sessionId);
  assert.equal(await state.resolveCurrentRole({rootPath,sessionId:selected.sessionId}),'甲岗位');
});
test('preview and standard confirmation require the caller dialog current role',async t=>{
  const rootPath=await root(t);await init(rootPath,'甲岗位','dialog-a');await init(rootPath,'乙岗位','dialog-b');
  await assert.rejects(createPendingAction({rootPath,sessionId:'dialog-b',proposal:proposal()}),/当前岗位/);
  await assert.rejects(confirmRoleStandard({rootPath,roleName:'甲岗位',sessionId:'dialog-b',...confirmation}),/当前岗位/);
  await confirmRoleStandard({rootPath,roleName:'甲岗位',sessionId:'dialog-a',...confirmation});
});
test('caller session binding overrides payload and rejects wrong or missing executor session',async t=>{
  const rootPath=await sameRole(t);
  const p=await createPendingAction({rootPath,sessionId:'dialog-a',proposal:{...proposal(),sessionId:'dialog-b'}});
  assert.equal(p.sessionId,'dialog-a');
  const receipt=JSON.parse(await fs.readFile(path.join(rootPath,'.recruitment-agent','proposal-receipts',`${p.id}.json`),'utf8'));
  assert.equal(receipt.sessionId,'dialog-a');
  await assert.rejects(applyConfirmedAction({rootPath,proposalId:p.id,sessionId:'dialog-b'}),/会话/);
  await assert.rejects(applyConfirmedAction({rootPath,proposalId:p.id}),/会话/);
  await applyConfirmedAction({rootPath,proposalId:p.id,sessionId:'dialog-a'});
  const legacy=await createPendingAction({rootPath,proposal:{...proposal('甲岗位','C-002','候选人乙'),sessionId:'dialog-a'}});
  assert.equal(legacy.sessionId,undefined);
  await assert.rejects(applyConfirmedAction({rootPath,proposalId:legacy.id,sessionId:'dialog-a'}),/会话/);
});
test('latest previews are scoped per dialog and role but shared ledger changes invalidate stale previews',async t=>{
  const rootPath=await sameRole(t);
  const a=await createPendingAction({rootPath,sessionId:'dialog-a',proposal:proposal()});
  const b=await createPendingAction({rootPath,sessionId:'dialog-b',proposal:proposal('甲岗位','C-002','候选人乙')});
  await applyConfirmedAction({rootPath,proposalId:a.id,sessionId:'dialog-a'});
  await assert.rejects(applyConfirmedAction({rootPath,proposalId:b.id,sessionId:'dialog-b'}),/事实源已变化/);
});
test('parallel independent-role dialog writes both finish after waiting for the root lock',async t=>{
  const rootPath=await root(t);
  await Promise.all([init(rootPath,'甲岗位','dialog-a'),init(rootPath,'乙岗位','dialog-b')]);
  const [a,b]=await Promise.all([createPendingAction({rootPath,sessionId:'dialog-a',proposal:proposal()}),createPendingAction({rootPath,sessionId:'dialog-b',proposal:proposal('乙岗位','C-002','候选人乙')})]);
  await Promise.all([applyConfirmedAction({rootPath,sessionId:'dialog-a',proposalId:a.id}),applyConfirmedAction({rootPath,sessionId:'dialog-b',proposalId:b.id})]);
  for(const [sessionId,roleName] of [['dialog-a','甲岗位'],['dialog-b','乙岗位']])assert.equal((await getRoleSnapshot({rootPath,sessionId})).candidateTotal,1);
});
test('same-role simultaneous updates reject the stale proposal without a lost write',async t=>{
  const rootPath=await sameRole(t);const seed=await createPendingAction({rootPath,sessionId:'dialog-a',proposal:proposal()});await applyConfirmedAction({rootPath,sessionId:'dialog-a',proposalId:seed.id});
  const update=after=>({...proposal(),intent:'candidate_update',changes:[{field:'备注',before:'',after}]});
  const [a,b]=await Promise.all(['dialog-a','dialog-b'].map(sessionId=>createPendingAction({rootPath,sessionId,proposal:update(sessionId)})));
  const results=await Promise.allSettled([applyConfirmedAction({rootPath,sessionId:'dialog-a',proposalId:a.id}),applyConfirmedAction({rootPath,sessionId:'dialog-b',proposalId:b.id})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.match(results.find(r=>r.status==='rejected').reason.message,/事实源已变化/);
});
test('lock waiting is bounded and never removes another writer lock',async t=>{
  const rootPath=await root(t);await fs.mkdir(path.join(rootPath,'.recruitment-agent'));const lock=path.join(rootPath,'.recruitment-agent','writer.lock');await fs.writeFile(lock,'other writer');
  const start=Date.now();await assert.rejects(withRootLock(rootPath,()=>assert.fail('must not run'),{timeoutMs:100}),/writer.lock/);
  assert.ok(Date.now()-start>=90);assert.ok(Date.now()-start<2000);assert.equal(await fs.readFile(lock,'utf8'),'other writer');
});
test('snapshot CLI resolves the named session and rejects a dangling session argument',async t=>{
  const rootPath=await root(t);await init(rootPath,'甲岗位','dialog-a');await init(rootPath,'乙岗位','dialog-b');
  const run=promisify(execFile);const script=new URL('../scripts/get-role-snapshot.mjs',import.meta.url);
  const {stdout}=await run(process.execPath,[script.pathname.replace(/^\/([A-Za-z]:)/,'$1'),'--root',rootPath,'--session','dialog-a']);
  assert.equal(JSON.parse(stdout).roleName,'甲岗位');
  await assert.rejects(run(process.execPath,[script.pathname.replace(/^\/([A-Za-z]:)/,'$1'),'--root',rootPath,'--session']),/会话|session/);
});
test('candidate creation preview includes cross-role matches from local facts instead of caller payload',async t=>{
  const rootPath=await root(t);await init(rootPath,'甲岗位','dialog-a');await init(rootPath,'乙岗位','dialog-b');
  const seed=await createPendingAction({rootPath,sessionId:'dialog-a',proposal:proposal()});await applyConfirmedAction({rootPath,sessionId:'dialog-a',proposalId:seed.id});
  const p=await createPendingAction({rootPath,sessionId:'dialog-b',proposal:{...proposal('乙岗位','C-002'),crossRoleMatches:[{role:'虚构岗位'}]}});
  assert.deepEqual(p.crossRoleMatches.map(row=>[row.role,row.candidateId]),[['甲岗位','C-001']]);
  assert.deepEqual(p.crossRoleMatchIssues,[]);
});
test('unreadable unrelated role is explicit in the preview and does not block intake',async t=>{
  const rootPath=await root(t);await init(rootPath,'甲岗位','dialog-a');await fs.mkdir(path.join(rootPath,'workflow','roles','损坏岗位'));
  const p=await createPendingAction({rootPath,sessionId:'dialog-a',proposal:proposal()});
  assert.ok(p.crossRoleMatchIssues?.length);assert.match(JSON.stringify(p.crossRoleMatchIssues),/查询|读取|损坏岗位|ENOENT/);
  await applyConfirmedAction({rootPath,sessionId:'dialog-a',proposalId:p.id});
});
