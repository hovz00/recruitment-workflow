import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {boundedPath,safeSegment,withRootLock} from './workspace-safety.mjs';
import {resolveCurrentRole,validateSessionId,sessionLockOptions} from './agent-state.mjs';
import {readConfirmedStandard} from './role-standard-state.mjs';
import {prepareCandidatePreview,planCandidateWrite,applyCandidatePlanInMemory,commitCandidateWriteUnderLock} from './apply-confirmed-action.mjs';

const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const statuses=['pending','applied','failed','cancelled'];
const session=value=>validateSessionId(value)??null;
const now=()=>new Date().toISOString();
async function paths(rootPath,batchId){
  const directory=await boundedPath(rootPath,'.recruitment-agent','batches',safeSegment(batchId,'批次编号'));
  const files=Object.fromEntries(['preview.json','receipt.json','progress.json','progress.json.tmp'].map(name=>[name,path.join(directory,name)]));
  for(const file of Object.values(files))await boundedPath(rootPath,path.relative(rootPath,file));
  return {directory,preview:files['preview.json'],receipt:files['receipt.json'],progress:files['progress.json'],temporary:files['progress.json.tmp']};
}
async function saveProgress(files,payload){
  await fs.writeFile(files.temporary,json({payload,digest:hash(JSON.stringify(payload))}));
  await fs.rename(files.temporary,files.progress);
}
function summary(preview,progress){
  const counts=Object.fromEntries(statuses.map(status=>[status,progress.items.filter(item=>item.status===status).length]));
  return {id:preview.id,role:preview.role,sessionId:preview.sessionId,standardVersion:preview.standardVersion,createdAt:preview.createdAt,updatedAt:progress.updatedAt,
    counts,recoveryRequired:Boolean(progress.inFlight),inFlight:progress.inFlight,items:preview.items.map((item,i)=>({...item,...progress.items[i]}))};
}
async function loadBatch({rootPath,sessionId,batchId}){
  const files=await paths(rootPath,batchId),content=await fs.readFile(files.preview,'utf8'),preview=JSON.parse(content),receipt=JSON.parse(await fs.readFile(files.receipt,'utf8'));
  if(preview.id!==batchId||hash(content)!==receipt.digest)throw new Error('批次预览内容已变化或被篡改，请重新生成批次。');
  if(preview.sessionId!==session(sessionId))throw new Error('批次属于其他会话，请使用创建批次的会话。');
  if(await resolveCurrentRole({rootPath,sessionId})!==preview.role)throw new Error('批次岗位与当前岗位不一致。');
  const envelope=JSON.parse(await fs.readFile(files.progress,'utf8')),progress=envelope.payload;
  if(!progress||envelope.digest!==hash(JSON.stringify(progress))||progress.previewDigest!==receipt.digest||progress.batchId!==batchId||!Array.isArray(progress.items)||progress.items.length!==preview.items.length||progress.items.some((item,i)=>item.id!==preview.items[i].id||!statuses.includes(item.status)))throw new Error('批次执行进度不完整或已变化，不能安全重放；请核实备份。');
  return {files,preview,progress};
}
function assertRecoverable(progress){
  if(progress.inFlight)throw new Error(`批次存在未完成写回事务，禁止盲目重放。请确认原进程已退出并核实备份 ${progress.inFlight.backupId}，恢复一致状态后重新预览。`);
}
async function verifyFacts(rootPath,preview,progress){
  const rolePath=await boundedPath(rootPath,'workflow','roles',preview.role);
  const standard=await readConfirmedStandard(rolePath);
  if(standard.confirmationDigest!==preview.standardConfirmationDigest)throw new Error('岗位标准确认已变化，请重新生成剩余条目的批次预览。');
  const ledgerPath=await boundedPath(rootPath,'workflow','roles',preview.role,'candidate-ledger.xlsx');
  if(hash(await fs.readFile(ledgerPath))!==progress.expectedLedgerDigest)throw new Error('批次之外的事实源已变化，请读取当前台账并重新预览剩余条目。');
  return ledgerPath;
}
function selectedIds(preview,itemIds){
  if(itemIds===undefined)return preview.items.map(item=>item.id);
  if(!Array.isArray(itemIds)||!itemIds.length||new Set(itemIds).size!==itemIds.length||itemIds.some(id=>!preview.items.some(item=>item.id===id)))throw new Error('条目编号必须为当前批次中不重复的有效条目。');
  return preview.items.filter(item=>itemIds.includes(item.id)).map(item=>item.id);
}

export async function createCandidateBatch({rootPath,sessionId,proposals}){
  session(sessionId);
  if(!Array.isArray(proposals)||!proposals.length||proposals.length>200)throw new Error('一个批次需要 1–200 条候选人提案。');
  const ids=proposals.map(item=>safeSegment(item?.candidate?.id,'候选人编号').toLowerCase());
  if(new Set(ids).size!==ids.length)throw new Error('同批候选人ID不能重复；同一候选人的修改请合并为一条预览。');
  return withRootLock(rootPath,async()=>{
    const role=await resolveCurrentRole({rootPath,sessionId});
    if(proposals.some(item=>item.role!==role))throw new Error('一个批次只能包含当前岗位的候选人。');
    const rolePath=await boundedPath(rootPath,'workflow','roles',role),ledgerPath=await boundedPath(rootPath,'workflow','roles',role,'candidate-ledger.xlsx');
    const standard=await readConfirmedStandard(rolePath),ledgerDigest=hash(await fs.readFile(ledgerPath));
    const id=`B-${crypto.randomUUID()}`,items=[];let ledger;
    for(const raw of proposals){
      const item=await prepareCandidatePreview({rootPath,sessionId,proposal:{...raw,id:`P-${crypto.randomUUID()}`,batchId:id}});
      const planned=await planCandidateWrite({rootPath,proposal:item,ledger});applyCandidatePlanInMemory(planned);ledger=planned;items.push(item);
    }
    const preview={id,schemaVersion:1,role,sessionId:session(sessionId),standardVersion:standard.version,standardConfirmationDigest:standard.confirmationDigest,createdAt:now(),items};
    const content=json(preview),previewDigest=hash(content),files=await paths(rootPath,id);await fs.mkdir(files.directory,{recursive:true});
    await fs.writeFile(files.preview,content,{flag:'wx'});await fs.writeFile(files.receipt,json({digest:previewDigest}),{flag:'wx'});
    const progress={batchId:id,previewDigest,expectedLedgerDigest:ledgerDigest,updatedAt:now(),inFlight:null,items:items.map(item=>({id:item.id,status:'pending',attempts:0}))};
    await saveProgress(files,progress);return summary(preview,progress);
  },sessionLockOptions(sessionId));
}

export async function getCandidateBatch(options){
  session(options.sessionId);
  return withRootLock(options.rootPath,async()=>{const {preview,progress}=await loadBatch(options);return summary(preview,progress);},sessionLockOptions(options.sessionId));
}

/** A call authorizes only the displayed immutable items. Limits/signals pause between items. */
export async function applyCandidateBatch({rootPath,sessionId,batchId,itemIds,limit=200,retryFailed=false,signal}){
  session(sessionId);
  if(!Number.isInteger(limit)||limit<1||limit>200||typeof retryFailed!=='boolean')throw new Error('limit 必须为 1–200 的整数，retryFailed 必须为布尔值。');
  const options={rootPath,sessionId,batchId};
  const selection=await withRootLock(rootPath,async()=>{
    const {preview,progress}=await loadBatch(options);assertRecoverable(progress);const ids=selectedIds(preview,itemIds);
    if(itemIds&&ids.some(id=>progress.items.find(item=>item.id===id).status==='failed')&&!retryFailed)throw new Error('重试失败条目需明确指定 retryFailed。');
    return ids;
  },sessionLockOptions(sessionId));
  let attempted=0;
  for(const itemId of selection){
    if(signal?.aborted||attempted>=limit)break;
    const outcome=await withRootLock(rootPath,async()=>{
      const {files,preview,progress}=await loadBatch(options);assertRecoverable(progress);
      const index=progress.items.findIndex(item=>item.id===itemId),itemState=progress.items[index];
      if(['applied','cancelled'].includes(itemState.status)||(itemState.status==='failed'&&!retryFailed))return 'skip';
      const ledgerPath=await verifyFacts(rootPath,preview,progress);
      const proposal=preview.items[index],attemptId=`${proposal.id}-${crypto.randomUUID()}`;
      const running={...progress,updatedAt:now(),inFlight:{itemId,backupId:attemptId,startedAt:now()}};
      await saveProgress(files,running);
      try{
        await commitCandidateWriteUnderLock({rootPath,sessionId,proposal:{...proposal,id:attemptId},extraTargets:[files.progress,files.temporary],afterWrite:async result=>{
          const completed=structuredClone(running);completed.inFlight=null;completed.updatedAt=now();completed.expectedLedgerDigest=hash(await fs.readFile(ledgerPath));
          completed.items[index]={id:itemId,status:'applied',attempts:itemState.attempts+1,appliedAt:now(),result};
          await saveProgress(files,completed);
        }});
        return 'applied';
      }catch(error){
        if(error.rollbackFailed)throw error;
        const failed=structuredClone(running);failed.inFlight=null;failed.updatedAt=now();failed.items[index]={id:itemId,status:'failed',attempts:itemState.attempts+1,error:error.message,failedAt:now()};
        await saveProgress(files,failed);return 'failed';
      }
    },sessionLockOptions(sessionId));
    if(outcome!=='skip')attempted++;
    if(outcome==='failed')break;
    // Allow other roles and live readers to acquire the lock between candidates.
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  return getCandidateBatch(options);
}

export async function cancelCandidateBatchItems({rootPath,sessionId,batchId,itemIds,reason}){
  session(sessionId);
  if(typeof reason!=='string'||!reason.trim()||/[\r\n]/.test(reason))throw new Error('取消条目必须提供非空单行原因。');
  if(itemIds===undefined)throw new Error('取消必须明确指定条目编号。');
  return withRootLock(rootPath,async()=>{
    const {files,preview,progress}=await loadBatch({rootPath,sessionId,batchId});assertRecoverable(progress);const ids=selectedIds(preview,itemIds);
    if(ids.some(id=>progress.items.find(item=>item.id===id).status==='applied'))throw new Error('已完成条目不能通过取消撤销；请生成候选人变更预览。');
    const next=structuredClone(progress);next.updatedAt=now();for(const item of next.items)if(ids.includes(item.id)){item.status='cancelled';item.cancelReason=reason.trim();item.cancelledAt=now();}
    await saveProgress(files,next);return summary(preview,next);
  },sessionLockOptions(sessionId));
}
