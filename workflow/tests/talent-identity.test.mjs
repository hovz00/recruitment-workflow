import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {initializeRoleWorkspace} from '../scripts/initialize-role-workspace.mjs';
import {setCurrentRole,createSession} from '../scripts/agent-state.mjs';
import {createPendingAction,applyConfirmedAction} from '../scripts/apply-confirmed-action.mjs';

const load = () => import('../scripts/talent-identity.mjs');
const reference = (role,candidateId='C-1') => ({role,candidateId});
const pipeline = {stages:[{id:0,name:'初筛'},{id:1,name:'面试'},{id:2,name:'入职'}]};
async function fixture(t){
  const rootPath=await fs.mkdtemp(path.join(os.tmpdir(),'talent-identity-'));
  t.after(()=>fs.rm(rootPath,{recursive:true,force:true}));
  for(const roleName of ['岗位甲','岗位乙','岗位丙']){
    await initializeRoleWorkspace({rootPath,roleName,pipeline,capacity:4,documents:{'ROLE_STANDARD.md':'# 标准\n按交付证据核验。','CONTEXT.md':'# 上下文\n当前标准版本：v1'},confirmation:{version:'v1',confirmedBy:'测试确认人',evidence:'确认目标与流程'}});
    const proposal={role:roleName,intent:'candidate_create',candidate:{id:'C-1',name:'测试同名'},changes:Object.entries({'简历来源':'内推','简历收取时间':'2020-01-01','主阶段':'0-初筛','阶段状态':'进行中'}).map(([field,after])=>({field,after}))};
    const p=await createPendingAction({rootPath,proposal});await applyConfirmedAction({rootPath,proposalId:p.id});
  }
  await setCurrentRole({rootPath,role:'岗位乙'});return {rootPath};
}
const request = (source='岗位甲',target='岗位乙') => ({action:'link',source:reference(source),target:reference(target),confirmedSamePerson:true,confirmedBy:'测试确认人',evidence:'已核对双方申请的原始身份材料及本人确认',relationship:'parallel'});
async function link(f,req=request()){
  const api=await load();const preview=await api.createIdentityProposal({...f,request:req});
  return api.applyIdentityProposal({...f,proposalId:preview.id});
}

test('same names only suggest matches; confirmed identity changes people count but never application facts',async t=>{
  const f=await fixture(t),api=await load();
  let overview=await api.getTalentOverview({...f,name:'测试同名'});
  assert.equal(overview.applicationCount,3);assert.equal(overview.personCount,3);
  const ledgers=await Promise.all(['岗位甲','岗位乙','岗位丙'].map(r=>fs.readFile(path.join(f.rootPath,'workflow','roles',r,'candidate-ledger.xlsx'))));
  const result=await link(f);assert.ok(result.personId);
  overview=await api.getTalentOverview({...f,candidate:reference('岗位甲')});
  assert.equal(overview.applicationCount,3);assert.equal(overview.personCount,2);
  assert.equal(overview.linkedApplications.length,2);assert.equal(overview.matches.length,1);
  for(const [i,r] of ['岗位甲','岗位乙','岗位丙'].entries())assert.deepEqual(await fs.readFile(path.join(f.rootPath,'workflow','roles',r,'candidate-ledger.xlsx')),ledgers[i]);
  assert.match(await fs.readFile(path.join(f.rootPath,'workflow','roles','岗位甲','candidates','C-1.md'),'utf8'),/跨岗位身份关联/);
});

test('link requires explicit same-person confirmation and meaningful evidence',async t=>{
  const f=await fixture(t),api=await load();
  for(const changes of [{confirmedSamePerson:false},{confirmedSamePerson:'true'},{evidence:''},{confirmedBy:''},{source:reference('岗位乙')}])await assert.rejects(()=>api.createIdentityProposal({...f,request:{...request(),...changes}}));
  assert.equal((await api.getTalentOverview(f)).personCount,3);
});

test('unlink corrects an identity mistake with audit history while keeping original applications',async t=>{
  const f=await fixture(t),api=await load();await link(f);
  const preview=await api.createIdentityProposal({...f,request:{action:'unlink',target:reference('岗位乙'),confirmedBy:'测试确认人',evidence:'重新核对后确认先前关联有误'}});
  assert.equal(preview.affectedApplications.length,2);
  await api.applyIdentityProposal({...f,proposalId:preview.id});
  const result=await api.getTalentOverview({...f,candidate:reference('岗位乙')});
  assert.equal(result.personCount,3);assert.equal(result.linkedApplications.length,1);
  const registry=JSON.parse(await fs.readFile(path.join(f.rootPath,'.recruitment-agent','talent-registry.json'),'utf8'));
  assert.deepEqual(registry.events.map(e=>e.action),['link','unlink']);
});

test('changed application facts or registry invalidate old identity previews',async t=>{
  const f=await fixture(t),api=await load();
  const p=await api.createIdentityProposal({...f,request:request()});
  await fs.appendFile(path.join(f.rootPath,'workflow','roles','岗位甲','candidates','C-1.md'),'\n补充事实\n');
  await assert.rejects(()=>api.applyIdentityProposal({...f,proposalId:p.id}),/变化|失效/);
  const fresh=await api.createIdentityProposal({...f,request:request()});
  await setCurrentRole({rootPath:f.rootPath,role:'岗位丙'});await link(f,request('岗位甲','岗位丙'));
  await setCurrentRole({rootPath:f.rootPath,role:'岗位乙'});
  await assert.rejects(()=>api.applyIdentityProposal({...f,proposalId:fresh.id}),/变化|失效/);
});

test('candidate identifiers are role-scoped and stale, missing or case-conflicting references are rejected',async t=>{
  const f=await fixture(t),api=await load();
  for(const source of [reference('不存在'),reference('岗位甲','MISSING'),reference('岗位甲','c-1'),reference('../escape')])await assert.rejects(()=>api.createIdentityProposal({...f,request:{...request(),source}}));
  await assert.rejects(()=>api.createIdentityProposal({...f,request:{...request(),target:reference('岗位丙')}}),/当前岗位/);
});

test('identity execution refuses replaced files before mutation',async t=>{
  const f=await fixture(t),api=await load();
  const p=await api.createIdentityProposal({...f,request:request()});
  const target=path.join(f.rootPath,'workflow','roles','岗位乙','ACTION_LOG.md');
  const original=await fs.readFile(target);const firstArchive=await fs.readFile(path.join(f.rootPath,'workflow','roles','岗位甲','candidates','C-1.md'));
  // A directory replacing a file must be rejected before mutation; originals remain recoverable.
  await fs.rename(target,target+'.saved');await fs.mkdir(target);
  await assert.rejects(()=>api.applyIdentityProposal({...f,proposalId:p.id}));
  assert.deepEqual(await fs.readFile(path.join(f.rootPath,'workflow','roles','岗位甲','candidates','C-1.md')),firstArchive);
  await assert.rejects(()=>fs.access(path.join(f.rootPath,'.recruitment-agent','talent-registry.json')));
  await fs.rmdir(target);await fs.rename(target+'.saved',target);assert.deepEqual(await fs.readFile(target),original);
});

test('mid-transaction append failure restores registry and archives and leaves a retryable preview',async t=>{
  const f=await fixture(t),api=await load();
  const p=await api.createIdentityProposal({...f,request:request()});
  const files=['岗位甲','岗位乙'].flatMap(role=>['ACTION_LOG.md','candidates/C-1.md'].map(file=>path.join(f.rootPath,'workflow','roles',role,file)));
  const originals=await Promise.all(files.map(file=>fs.readFile(file)));
  const append=fs.appendFile;let calls=0;
  const mock=t.mock.method(fs,'appendFile',async(...args)=>{if(++calls===2)throw new Error('injected append failure');return append(...args);});
  await assert.rejects(()=>api.applyIdentityProposal({...f,proposalId:p.id}),/injected/);mock.mock.restore();
  for(const [index,file]of files.entries())assert.deepEqual(await fs.readFile(file),originals[index]);
  await assert.rejects(()=>fs.access(path.join(f.rootPath,'.recruitment-agent','talent-registry.json')));
  await api.applyIdentityProposal({...f,proposalId:p.id});
  assert.equal((await api.getTalentOverview(f)).personCount,2);
});

test('merging identity groups cannot put two candidate IDs from the same role into one person',async t=>{
  const f=await fixture(t),api=await load();await link(f);
  await setCurrentRole({rootPath:f.rootPath,role:'岗位甲'});
  const proposal={role:'岗位甲',intent:'candidate_create',candidate:{id:'C-2',name:'另一姓名'},changes:Object.entries({'简历来源':'内推','简历收取时间':'2020-01-01','主阶段':'0-初筛','阶段状态':'进行中'}).map(([field,after])=>({field,after}))};
  const candidatePreview=await createPendingAction({...f,proposal});await applyConfirmedAction({...f,proposalId:candidatePreview.id});
  await setCurrentRole({rootPath:f.rootPath,role:'岗位丙'});
  await link(f,{...request('岗位甲','岗位丙'),source:reference('岗位甲','C-2')});
  await setCurrentRole({rootPath:f.rootPath,role:'岗位乙'});
  await assert.rejects(()=>api.createIdentityProposal({...f,request:request('岗位丙','岗位乙')}),/冲突/);
  assert.equal((await api.getTalentOverview(f)).personCount,2);
});

test('identity previews are bound to the calling session and cannot be executed from another or legacy session',async t=>{
  const f=await fixture(t),api=await load();
  const a=await createSession({...f,roleName:'岗位乙'}),b=await createSession({...f,roleName:'岗位乙'});
  const p=await api.createIdentityProposal({...f,sessionId:a.sessionId,request:request()});
  await assert.rejects(()=>api.applyIdentityProposal({...f,sessionId:b.sessionId,proposalId:p.id}),/会话/);
  await assert.rejects(()=>api.applyIdentityProposal({...f,proposalId:p.id}),/会话/);
  await setCurrentRole({...f,sessionId:b.sessionId,role:'岗位甲'});
  await api.applyIdentityProposal({...f,sessionId:a.sessionId,proposalId:p.id});
  assert.equal((await api.getTalentOverview(f)).personCount,2);
});

test('unknown named sessions do not borrow a legacy role for identity operations',async t=>{
  const f=await fixture(t),api=await load();
  await assert.rejects(()=>api.createIdentityProposal({...f,sessionId:'unknown',request:request()}),/没有已选择/);
  for(const sessionId of ['',null,'../escape'])await assert.rejects(()=>api.createIdentityProposal({...f,sessionId,request:request()}),/会话/);
});

test('three-application unlink audit identifies the detached application and every before/after identity',async t=>{
  const f=await fixture(t),api=await load();const first=await link(f);
  await setCurrentRole({...f,role:'岗位丙'});await link(f,request('岗位甲','岗位丙'));
  await setCurrentRole({...f,role:'岗位乙'});
  const p=await api.createIdentityProposal({...f,request:{action:'unlink',target:reference('岗位乙'),confirmedBy:'测试确认人',evidence:'经重新核实解除错误关联'}});
  const result=await api.applyIdentityProposal({...f,proposalId:p.id});
  const registry=JSON.parse(await fs.readFile(path.join(f.rootPath,'.recruitment-agent','talent-registry.json'),'utf8'));
  const event=registry.events.at(-1);
  assert.equal(event.identityChanges?.length,3);
  for(const role of ['岗位甲','岗位乙','岗位丙']){
    const identity=event.identityChanges.find(item=>item.role===role);
    assert.equal(identity.beforePersonId,first.personId);
    assert.equal(identity.afterPersonId,role==='岗位乙'?result.personId:first.personId);
    const archive=await fs.readFile(path.join(f.rootPath,'workflow','roles',role,'candidates','C-1.md'),'utf8');
    const latest=archive.slice(archive.lastIndexOf('\n## '));
    assert.match(latest,/操作对象：岗位乙\/C-1/);
    assert.ok(latest.includes(`岗位甲/C-1：${first.personId} → ${first.personId}`));
    assert.ok(latest.includes(`岗位乙/C-1：${first.personId} → ${result.personId}`));
    assert.ok(latest.includes(`岗位丙/C-1：${first.personId} → ${first.personId}`));
  }
});
