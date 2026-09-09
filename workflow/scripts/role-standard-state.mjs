import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {readPipeline} from './pipeline-config.mjs';
import {boundedPath} from './workspace-safety.mjs';

const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const stateName='ROLE_CONFIRMATION.json';
function assertDocument(text,name){
  if(!text.trim()||/\{\{[^}]+\}\}|^>\s*草稿[：:]|^当前标准版本：[ \t]*(?:待确认|草稿)/m.test(text))throw new Error(`岗位标准尚未确认：${name} 仍为空或草稿，请先补齐文档。`);
}
async function sources(rolePath){
  for(const name of ['ROLE_STANDARD.md','PIPELINE.json'])await boundedPath(rolePath,name);
  const [standard,pipeline]=await Promise.all(['ROLE_STANDARD.md','PIPELINE.json'].map(n=>fs.readFile(path.join(rolePath,n),'utf8')));
  assertDocument(standard,'ROLE_STANDARD.md');await readPipeline(path.join(rolePath,'PIPELINE.json'));
  return{standardDigest:hash(standard),pipelineDigest:hash(pipeline)};
}
export function validateConfirmation(confirmation){
  for(const field of ['version','confirmedBy','evidence'])if(typeof confirmation?.[field]!=='string'||!confirmation[field].trim()||/[\r\n]/.test(confirmation[field]))throw new Error(`岗位标准确认必须提供非空单行 ${field}。`);
  if(/待确认|草稿|\{\{/.test(confirmation.version))throw new Error('岗位标准确认版本不能是草稿或占位符。');
}
// Caller holds the workspace writer lock (initialization or confirmation CLI).
export async function writeRoleConfirmation({rolePath,confirmation}){
  validateConfirmation(confirmation);
  for(const name of [stateName,'CONTEXT.md','ACTION_LOG.md'])await boundedPath(rolePath,name);
  const digests=await sources(rolePath);
  assertDocument(await fs.readFile(path.join(rolePath,'CONTEXT.md'),'utf8'),'CONTEXT.md');
  const record={schemaVersion:1,status:'confirmed',version:confirmation.version.trim(),confirmedBy:confirmation.confirmedBy.trim(),evidence:confirmation.evidence.trim(),confirmedAt:new Date().toISOString(),...digests};
  const statePath=path.join(rolePath,stateName),logPath=path.join(rolePath,'ACTION_LOG.md');
  const priorState=await fs.readFile(statePath).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  const priorLog=await fs.readFile(logPath,'utf8');
  try{
    await fs.writeFile(statePath,JSON.stringify(record,null,2)+'\n');
    await fs.appendFile(logPath,`\n## ${record.confirmedAt}｜岗位标准确认\n\n- 版本：${record.version}\n- 确认人：${record.confirmedBy}\n- 依据：${record.evidence}\n- 标准摘要：${record.standardDigest}\n- 流程摘要：${record.pipelineDigest}\n`);
  }catch(error){if(priorState===null)await fs.rm(statePath,{force:true});else await fs.writeFile(statePath,priorState);await fs.writeFile(logPath,priorLog);throw error;}
  return record;
}
export async function readConfirmedStandard(rolePath){
  let content,record;
  await boundedPath(rolePath,stateName);
  try{content=await fs.readFile(path.join(rolePath,stateName),'utf8');record=JSON.parse(content);}
  catch(error){throw new Error(`岗位标准尚未确认或确认记录不可读，请先执行 confirm-role-standard.mjs。${error.code==='ENOENT'?'':error.message}`);}
  if(record.status!=='confirmed'||record.schemaVersion!==1)throw new Error('岗位标准尚未确认，请先确认当前标准。');
  validateConfirmation(record);
  const current=await sources(rolePath);
  if(current.standardDigest!==record.standardDigest||current.pipelineDigest!==record.pipelineDigest)throw new Error('岗位标准或流程已变化，请核对并重新确认标准，再生成新预览。');
  return{...record,confirmationDigest:hash(content)};
}
