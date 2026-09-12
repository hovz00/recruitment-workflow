import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {resolveCurrentRole,validateSessionId,sessionLockOptions} from './agent-state.mjs';
import {boundedPath,safeSegment,withRootLock} from './workspace-safety.mjs';
import {applicationKey,applicationReference,readApplicationCatalog,requireApplication} from './application-catalog.mjs';
import {emptyRegistry,validateRegistry,personFor,planIdentityChange} from './talent-registry.mjs';

const digest=buffer=>buffer===null?null:crypto.createHash('sha256').update(buffer).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const sessionValue=value=>validateSessionId(value)??null;
async function optionalFile(file){return fs.readFile(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});}
async function registryState(rootPath){
  const file=await boundedPath(rootPath,'.recruitment-agent','talent-registry.json');
  const content=await optionalFile(file);
  return {file,content,registry:content===null?emptyRegistry():JSON.parse(content)};
}
async function pendingPaths(rootPath,id,role,sessionId){
  safeSegment(id,'提案编号');safeSegment(role,'岗位名称');
  const session=sessionValue(sessionId);
  const base=session===null?['.recruitment-agent']:['.recruitment-agent','sessions',session];
  return {
    pending:await boundedPath(rootPath,'.recruitment-agent','identity-proposals',`${id}.json`),
    receipt:await boundedPath(rootPath,'.recruitment-agent','identity-receipts',`${id}.json`),
    latest:await boundedPath(rootPath,...base,'latest-identity-proposals',`${role}.json`)
  };
}
async function affectedFiles(rootPath,applications){
  const files=new Set();
  for(const application of applications){
    const ref=applicationReference(application);
    for(const name of ['candidate-ledger.xlsx','ACTION_LOG.md',path.join('candidates',`${ref.candidateId}.md`)])files.add(await boundedPath(rootPath,'workflow','roles',ref.role,name));
  }
  return [...files];
}

export async function getTalentOverview({rootPath,candidate,name}){
  return withRootLock(rootPath,async()=>{
    const {applications,issues}=await readApplicationCatalog(rootPath),{registry}=await registryState(rootPath);
    validateRegistry(registry,applications);
    const selected=candidate?requireApplication(applications,candidate):null;
    const selectedPerson=selected?personFor(registry,selected):null;
    const linked=selected?(selectedPerson?.applications??[applicationReference(selected)]):[];
    const linkedKeys=new Set(linked.map(applicationKey));
    const linkedCount=registry.people.reduce((n,person)=>n+person.applications.length,0);
    const queryName=selected?.name??String(name??'').trim();
    return {applicationCount:applications.length,personCount:applications.length-linkedCount+registry.people.length,
      countBasis:'按已确认关联去重；尚未核实的不同岗位申请暂计为不同人。',issues,
      personId:selectedPerson?.personId??null,linkedApplications:linked.map(ref=>requireApplication(applications,ref)),
      matches:queryName?applications.filter(row=>row.name===queryName&&!linkedKeys.has(applicationKey(row))):[],
      people:registry.people.map(person=>({personId:person.personId,applications:person.applications.map(ref=>requireApplication(applications,ref))}))};
  },{timeoutMs:5000});
}

export async function createIdentityProposal({rootPath,sessionId,request}){
  sessionValue(sessionId);
  return withRootLock(rootPath,async()=>{
    const currentRole=await resolveCurrentRole({rootPath,sessionId});
    if(request?.target?.role!==currentRole)throw new Error('身份提案的目标岗位与当前岗位不一致，请先在当前会话切换岗位。');
    const {applications,issues}=await readApplicationCatalog(rootPath),state=await registryState(rootPath);
    validateRegistry(state.registry,applications);
    const plan=planIdentityChange({registry:state.registry,applications,request});
    const id=`I-${crypto.randomUUID()}`,createdAt=new Date().toISOString();
    const stored={id,status:'pending',sessionId:sessionValue(sessionId),createdAt,...plan,issues};
    const content=json(stored),paths=await pendingPaths(rootPath,id,plan.target.role,sessionId);
    const files=await affectedFiles(rootPath,plan.affectedApplications);
    const record={id,digest:digest(content),registryDigest:digest(state.content),files:[]};
    for(const file of files)record.files.push({relative:path.relative(rootPath,file),digest:digest(await optionalFile(file))});
    for(const file of Object.values(paths))await fs.mkdir(path.dirname(file),{recursive:true});
    await fs.writeFile(paths.receipt,json(record),{flag:'wx'});
    await fs.writeFile(paths.pending,content,{flag:'wx'});
    await fs.writeFile(paths.latest,json({id,digest:record.digest}));
    return stored;
  },sessionLockOptions(sessionId));
}

/** Only call after the recruiter confirms the displayed identity proposal. */
export async function applyIdentityProposal({rootPath,sessionId,proposalId}){
  sessionValue(sessionId);safeSegment(proposalId,'提案编号');
  return withRootLock(rootPath,async()=>{
    const pending=await boundedPath(rootPath,'.recruitment-agent','identity-proposals',`${proposalId}.json`);
    const content=await fs.readFile(pending),proposal=JSON.parse(content);
    if(proposal.sessionId!==sessionValue(sessionId))throw new Error('身份提案属于其他会话，请回到原会话确认或重新预览。');
    const paths=await pendingPaths(rootPath,proposalId,proposal.target?.role,sessionId);
    const receipt=JSON.parse(await fs.readFile(paths.receipt)),latest=JSON.parse(await fs.readFile(paths.latest));
    if(proposal.id!==proposalId||proposal.status!=='pending'||receipt.digest!==digest(content)||latest.id!==proposalId||latest.digest!==receipt.digest)throw new Error('身份提案已变化或失效，请重新预览。');
    if(await resolveCurrentRole({rootPath,sessionId})!==proposal.target.role)throw new Error('身份提案目标与当前岗位不一致。');
    const state=await registryState(rootPath);
    if(digest(state.content)!==receipt.registryDigest)throw new Error('人才关联索引已变化，请重新预览。');
    for(const item of receipt.files){
      const file=await boundedPath(rootPath,item.relative);
      if(digest(await optionalFile(file))!==item.digest)throw new Error('关联申请事实或档案已变化，请重新预览。');
    }
    const {applications}=await readApplicationCatalog(rootPath);validateRegistry(state.registry,applications);
    const identityChanges=proposal.affectedApplications.map(application=>{
      const ref=applicationReference(application);
      return {...ref,beforePersonId:personFor(state.registry,ref)?.personId??null,afterPersonId:personFor({people:proposal.nextPeople},ref)?.personId??null};
    });
    const next={...state.registry,people:proposal.nextPeople,events:[...state.registry.events,{id:proposal.id,action:proposal.action,
      source:proposal.source??null,target:proposal.target,relationship:proposal.relationship??null,personId:proposal.personId,
      affectedApplications:proposal.affectedApplications.map(applicationReference),identityChanges,confirmedBy:proposal.confirmedBy,evidence:proposal.evidence,at:new Date().toISOString()}]};
    validateRegistry(next,applications);
    const archiveFiles=(await affectedFiles(rootPath,proposal.affectedApplications)).filter(file=>!file.endsWith('candidate-ledger.xlsx'));
    const targets=[state.file,...archiveFiles];
    const backupDir=await boundedPath(rootPath,'.recruitment-agent','backups',proposalId);await fs.mkdir(backupDir,{recursive:true});
    const originals=[];
    for(const [index,file]of targets.entries()){
      const before=await optionalFile(file);originals.push({file,before});
      if(before!==null)await fs.writeFile(path.join(backupDir,`${index}-${path.basename(file)}`),before);
    }
    await fs.writeFile(path.join(backupDir,'manifest.json'),json(originals.map(({file,before},index)=>({target:path.relative(rootPath,file),existed:before!==null,backup:before===null?null:`${index}-${path.basename(file)}`}))));
    const title=proposal.action==='link'?'跨岗位身份关联':'解除跨岗位身份关联';
    const event=next.events.at(-1);
    const transitions=identityChanges.map(change=>`  - ${change.role}/${change.candidateId}：${change.beforePersonId??'未关联'} → ${change.afterPersonId}`).join('\n');
    const note=`\n## ${event.at}｜${title}\n\n- 提案：${proposalId}\n- 操作对象：${proposal.target.role}/${proposal.target.candidateId}\n${proposal.source?`- 来源申请：${proposal.source.role}/${proposal.source.candidateId}\n- 类型：${proposal.relationship}\n`:''}- 人才编号前后变化：\n${transitions}\n- 确认人：${proposal.confirmedBy}\n- 依据：${proposal.evidence}\n- 岗位阶段、评分与评估材料继续分别管理。\n`;
    try{
      await fs.writeFile(state.file,json(next));
      for(const file of archiveFiles){await fs.mkdir(path.dirname(file),{recursive:true});await fs.appendFile(file,note);}
      await fs.rm(pending);
    }catch(error){
      const failures=[];
      for(const {file,before}of originals)try{if(before===null)await fs.rm(file,{force:true});else await fs.writeFile(file,before);}catch(restoreError){failures.push(restoreError);}
      if(failures.length)throw new AggregateError([error,...failures],`身份写入失败且回滚不完整，请用 ${backupDir} 的备份恢复。`);
      throw error;
    }
    return {proposalId,action:proposal.action,personId:proposal.personId,affectedApplications:proposal.affectedApplications.map(applicationReference)};
  },sessionLockOptions(sessionId));
}
