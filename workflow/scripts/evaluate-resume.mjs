import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {resolveCurrentRole,sessionArgument} from './agent-state.mjs';
import {boundedPath,withRootLock} from './workspace-safety.mjs';
import {sessionLockOptions} from './agent-state.mjs';
import {readConfirmedStandard} from './role-standard-state.mjs';
import {readScoringRules,evaluateEvidence,assessmentIdentity} from './scoring-rules.mjs';

export async function readSavedAssessment(rolePath,candidateId,evaluationKey){
  const file=await boundedPath(rolePath,'candidates',`${candidateId}.assessment.json`);
  try{
    const record=JSON.parse(await fs.readFile(file,'utf8'));
    if(!record||record.status!=='confirmed'||!record.input||!record.result||(record.history!==undefined&&!Array.isArray(record.history)))throw new Error('评估存档结构无效');
    if(evaluationKey===undefined)return record;
    return [record,...(record.history??[]).slice().reverse()].find(r=>r?.result?.evaluationKey===evaluationKey)??null;
  }catch(error){if(error.code==='ENOENT')return null;throw new Error(`已有评估记录不可读，请先核对：${error.message}`);}
}
// Short writer lock ensures the read spans one consistent role/confirmation snapshot.
// This command writes no assessment, ledger, preview or recruiting business state.
export async function evaluateResume({rootPath,sessionId,input}){
  return withRootLock(rootPath,async()=>{
    const role=await resolveCurrentRole({rootPath,sessionId});
    const rolePath=await boundedPath(rootPath,'workflow','roles',role);
    await readConfirmedStandard(rolePath);
    const {rules,digest}=await readScoringRules(rolePath,{required:true});
    const context={role,rulesDigest:digest};
    const identity=assessmentIdentity(rules,input,context);
    const saved=await readSavedAssessment(rolePath,input.candidate.id,identity.evaluationKey);
    if(saved?.result?.evaluationKey===identity.evaluationKey&&!input.reevaluationReason){
      if(saved.status!=='confirmed'||!isDeepStrictEqual(evaluateEvidence(rules,saved.input,context),saved.result))throw new Error('已有评估记录校验失败，请核对档案。');
      return {input:saved.input,result:saved.result,reused:true};
    }
    if(input.reevaluationReason!==undefined&&(typeof input.reevaluationReason!=='string'||!input.reevaluationReason.trim()))throw new Error('主动重评需要非空 reevaluationReason。');
    return {input,result:evaluateEvidence(rules,input,context),reused:false};
  },sessionLockOptions(sessionId));
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const arg=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
  if(process.argv.includes('--help'))console.log('用途：校验简历证据并确定性计算评分（只读，结果输出 JSON）。\n用法：node workflow/scripts/evaluate-resume.mjs --root <项目根目录> --input <评估输入.json> [--session <会话编号>]');
  else{
    if(!arg('--root')||!arg('--input'))throw new Error('需要 --root 和 --input。');
    console.log(JSON.stringify(await evaluateResume({rootPath:arg('--root'),sessionId:sessionArgument(),input:JSON.parse(await fs.readFile(arg('--input'),'utf8'))}),null,2));
  }
}
