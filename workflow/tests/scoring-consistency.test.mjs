import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {validateScoringRules, evaluateEvidence} from '../scripts/scoring-rules.mjs';
import {evaluateResume} from '../scripts/evaluate-resume.mjs';
import {initializeRoleWorkspace} from '../scripts/initialize-role-workspace.mjs';
import {readConfirmedStandard,writeRoleConfirmation} from '../scripts/role-standard-state.mjs';
import {createPendingAction,applyConfirmedAction,commitCandidateWriteUnderLock} from '../scripts/apply-confirmed-action.mjs';
import {withRootLock} from '../scripts/workspace-safety.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createCandidateBatch,applyCandidateBatch} from '../scripts/candidate-batches.mjs';

// Small mechanical fixtures, not recruitment simulation resumes or business data.
const rules=()=>({schemaVersion:1,version:'v1',evaluationProfile:{model:'test-model',promptVersion:'p1'},dimensions:[40,35,25].map((weight,i)=>({id:`D${i}`,name:`Dimension ${i}`,requirement:'Verify source evidence',weight,anchors:[{score:0,description:'Not present'},{score:4,description:'Partial evidence'},{score:8,description:'Detailed evidence'}]})),recommendation:{minScore:5,minCoverage:60,requiredDimensions:[]},examples:[]});
const assessment=()=>({candidate:{id:'C1',name:'Fixture'},resumeText:'alpha\r\nbeta\r\n',model:'test-model',promptVersion:'p1',dimensions:[{id:'D0',grade:'直接证据',score:8,quote:'alpha',rationale:'Detailed evidence'},{id:'D1',grade:'间接证据',score:4,quote:'beta',rationale:'Partial evidence'},{id:'D2',grade:'暂无证据',score:0,quote:'',rationale:'Not present'}]});
const confirmation={version:'v1',confirmedBy:'Test',evidence:'Explicit test confirmation'};
async function fixture(t,scoringRules=rules()){
  const rootPath=await fs.mkdtemp(path.join(os.tmpdir(),'scoring-'));
  t.after(()=>fs.rm(rootPath,{recursive:true,force:true}));
  const {rolePath}=await initializeRoleWorkspace({rootPath,roleName:'Role',capacity:3,pipeline:{stages:[{id:0,name:'初筛'}]},documents:{'ROLE_STANDARD.md':'# Standard\nEvidence review','CONTEXT.md':'# Context\n当前标准版本：v1'},confirmation,scoringRules});
  return {rootPath,rolePath};
}
async function scoredProposal(f){
  const evaluated=await evaluateResume({...f,input:assessment()});
  return {role:'Role',intent:'candidate_create',candidate:assessment().candidate,assessment:{...evaluated.input,rulesDigest:evaluated.result.rulesDigest},changes:Object.entries({'简历来源':'员工推荐','简历收取时间':'2020-01-01','主阶段':'0-初筛','阶段状态':'进行中','能力证据得分':4.6,'证据覆盖率':66.7}).map(([field,after])=>({field,after})),evidence:['Test confirmation']};
}
test('fixed weighted score, material coverage and exact quote locations',()=>{
  const r=evaluateEvidence(rules(),assessment());
  assert.equal(r.score,4.6);assert.equal(r.coverage,66.7);
  assert.deepEqual(r.dimensions.map(d=>d.sourceLine),[1,2,null]);
  assert.equal(r.recommendation,'建议补充证据后复核');
  for(let i=0;i<10;i++)assert.deepEqual(evaluateEvidence(rules(),assessment()),r);
  const reordered=assessment();reordered.candidate={name:'Fixture',note:'irrelevant',id:'C1'};
  assert.equal(evaluateEvidence(rules(),reordered).evaluationKey,r.evaluationKey);
});
test('contradictory grades, unapproved scores, incomplete dimensions and fabricated quotes fail',()=>{
  for(const mutate of [a=>a.dimensions[2].score=4,a=>a.dimensions[0].score=7,a=>a.dimensions[0].quote='not in source',a=>a.dimensions.pop(),a=>a.dimensions[1].id='D0',a=>a.model='other']){
    const a=assessment();mutate(a);assert.throws(()=>evaluateEvidence(rules(),a));
  }
});
test('rules reject invalid weights, anchors and recommendation dimensions; pending examples are not active',()=>{
  for(const mutate of [r=>r.dimensions[0].weight=30,r=>r.dimensions[0].anchors.pop(),r=>r.recommendation.requiredDimensions=[{id:'unknown',minScore:6}]]){
    const r=rules();mutate(r);assert.throws(()=>validateScoringRules(r));
  }
  const r=rules();r.examples=[{id:'E1',dimensionId:'D0',text:'draft',grade:'暂无证据',score:8,status:'pending'}];
  assert.deepEqual(evaluateEvidence(r,assessment()).confirmedExampleIds,[]);
  r.examples[0].status='confirmed';assert.throws(()=>validateScoringRules(r));
});
test('review reasons and critical dimension rules force review without changing workflow stage',()=>{
  const r=rules();r.recommendation.minScore=4;r.recommendation.requiredDimensions=[{id:'D2',minScore:4}];
  assert.equal(evaluateEvidence(r,assessment()).recommendation,'建议补充证据后复核');
  const a=assessment();a.reviewReasons=['Business qualification needs confirmation'];
  assert.equal(evaluateEvidence(r,a).recommendation,'待人工核实');
});
test('rule addition, change and removal invalidate confirmation',async t=>{
  const f=await fixture(t);await readConfirmedStandard(f.rolePath);
  const target=path.join(f.rolePath,'SCORING_RULES.json');
  const changed=rules();changed.version='v2';await fs.writeFile(target,JSON.stringify(changed));
  await assert.rejects(()=>readConfirmedStandard(f.rolePath),/变化/);
  await writeRoleConfirmation({rolePath:f.rolePath,confirmation});await fs.rm(target);
  await assert.rejects(()=>readConfirmedStandard(f.rolePath),/变化/);
  await writeRoleConfirmation({rolePath:f.rolePath,confirmation});await fs.writeFile(target,JSON.stringify(rules()));
  await assert.rejects(()=>readConfirmedStandard(f.rolePath),/变化/);
});
test('read-only evaluation, confirmed write and reuse preserve provenance',async t=>{
  const f=await fixture(t);const before=await fs.readFile(path.join(f.rolePath,'candidate-ledger.xlsx'));
  const p=await scoredProposal(f);assert.deepEqual(await fs.readFile(path.join(f.rolePath,'candidate-ledger.xlsx')),before);
  const pending=await createPendingAction({...f,proposal:p});assert.equal(pending.scoringSummary.score,4.6);
  await applyConfirmedAction({...f,proposalId:pending.id});
  const saved=JSON.parse(await fs.readFile(path.join(f.rolePath,'candidates','C1.assessment.json'),'utf8'));
  assert.equal(saved.result.score,4.6);assert.equal(saved.input.model,'test-model');
  const input=assessment();delete input.dimensions;
  const cached=await evaluateResume({...f,input});assert.equal(cached.reused,true);assert.deepEqual(cached.result,saved.result);
});
test('single and batch block hand-filled scores, mismatched identity and formula tampering',async t=>{
  const f=await fixture(t);const valid=await scoredProposal(f);
  for(const mutate of [p=>delete p.assessment,p=>p.changes.at(-1).after=100,p=>p.assessment.candidate.id='OTHER',p=>p.assessment.rulesDigest='stale']){
    const p=structuredClone(valid);mutate(p);
    await assert.rejects(()=>createPendingAction({...f,proposal:p}));
    await assert.rejects(()=>createCandidateBatch({...f,proposals:[p]}));
  }
  const batch=await createCandidateBatch({...f,proposals:[valid]});
  const result=await applyCandidateBatch({...f,batchId:batch.id});assert.equal(result.counts.applied,1);
});
test('score previews expire after rules change and old roles cannot silently use unguarded scoring',async t=>{
  const f=await fixture(t);const p=await createPendingAction({...f,proposal:await scoredProposal(f)});
  await fs.appendFile(path.join(f.rolePath,'SCORING_RULES.json'),'\n');
  await assert.rejects(()=>applyConfirmedAction({...f,proposalId:p.id}),/变化/);
  const old=await fixture(t,null);const proposal={...(await scoredProposal(await fixture(t))),assessment:undefined};
  await assert.rejects(()=>createPendingAction({...old,proposal}),/SCORING_RULES|评分规则/);
});
test('all missing evidence produces zero material coverage without automatic rejection',()=>{
  const a=assessment();a.dimensions=a.dimensions.map(d=>({...d,grade:'暂无证据',score:0,quote:''}));
  const result=evaluateEvidence(rules(),a);assert.equal(result.score,0);assert.equal(result.coverage,0);assert.equal(result.recommendation,'建议补充证据后复核');
});
test('same-input reassessment needs reason, and failure rolls back assessment and ledger together',async t=>{
  const f=await fixture(t);const original=await scoredProposal(f);
  const p=await createPendingAction({...f,proposal:original});await applyConfirmedAction({...f,proposalId:p.id});
  const updated=structuredClone(original);updated.intent='candidate_update';updated.assessment.dimensions[0].score=4;
  updated.changes=[{field:'能力证据得分',before:4.6,after:3},{field:'证据覆盖率',before:66.7,after:66.7}];
  await assert.rejects(()=>createPendingAction({...f,proposal:updated}),/重评/);
  updated.assessment.candidate={name:'Fixture',extra:'does not change identity',id:'C1'};
  await assert.rejects(()=>createPendingAction({...f,proposal:updated}),/重评/);
  updated.assessment.reevaluationReason='Recruiter corrected the evidence interpretation';
  const next=await createPendingAction({...f,proposal:updated});
  const files=['candidate-ledger.xlsx','candidates/C1.md','candidates/C1.assessment.json','ACTION_LOG.md','CONTEXT.md','招聘数据复盘.html'];
  const before=await Promise.all(files.map(n=>fs.readFile(path.join(f.rolePath,n))));
  await assert.rejects(()=>withRootLock(f.rootPath,()=>commitCandidateWriteUnderLock({...f,proposal:next,afterWrite:()=>{throw new Error('test downstream failure');}})),/downstream failure/);
  assert.deepEqual(await Promise.all(files.map(n=>fs.readFile(path.join(f.rolePath,n)))),before);
  await applyConfirmedAction({...f,proposalId:next.id});
  const saved=JSON.parse(await fs.readFile(path.join(f.rolePath,'candidates/C1.assessment.json'),'utf8'));
  assert.equal(saved.result.score,3);assert.match(saved.input.reevaluationReason,/Recruiter/);
});
test('evaluation CLI emits computed JSON without assessment writes or help interception',async t=>{
  const f=await fixture(t);const inputFile=path.join(f.rootPath,'input.json');await fs.writeFile(inputFile,JSON.stringify(assessment()));
  const script=fileURLToPath(new URL('../scripts/evaluate-resume.mjs',import.meta.url));
  const run=promisify(execFile);
  const help=await run(process.execPath,[script,'--help']);assert.match(help.stdout,/校验简历证据/);
  const output=await run(process.execPath,[script,'--root',f.rootPath,'--input',inputFile]);
  assert.equal(JSON.parse(output.stdout).result.score,4.6);
  assert.deepEqual(await fs.readdir(path.join(f.rolePath,'candidates')),[]);
});
test('returning to an earlier resume reuses its confirmed history and cannot silently reassess',async t=>{
  const f=await fixture(t);const original=await scoredProposal(f);
  const p=await createPendingAction({...f,proposal:original});await applyConfirmedAction({...f,proposalId:p.id});
  const next=structuredClone(original);next.intent='candidate_update';next.assessment.resumeText+='new material';next.assessment.dimensions[0].score=4;
  next.changes=[{field:'能力证据得分',before:4.6,after:3},{field:'证据覆盖率',before:66.7,after:66.7}];
  const p2=await createPendingAction({...f,proposal:next});await applyConfirmedAction({...f,proposalId:p2.id});
  const input=assessment();delete input.dimensions;
  const earlier=await evaluateResume({...f,input});assert.equal(earlier.reused,true);assert.equal(earlier.result.score,4.6);
  next.assessment.resumeText=assessment().resumeText;next.changes[0].before=3;
  await assert.rejects(()=>createPendingAction({...f,proposal:next}),/重评/);
  const saved=JSON.parse(await fs.readFile(path.join(f.rolePath,'candidates/C1.assessment.json'),'utf8'));assert.equal(saved.history.length,1);assert.equal(saved.history[0].result.score,4.6);
});
