import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {boundedPath,safeSegment} from './workspace-safety.mjs';

export const scoringDigest=value=>crypto.createHash('sha256').update(value).digest('hex');
const grades=['直接证据','间接证据','暂无证据'];
const round=value=>Math.round((value+Number.EPSILON)*10)/10;
function text(value,label){if(typeof value!=='string'||!value.trim()||/\{\{/.test(value))throw new Error(`${label} 必须为非空文本，不能使用占位符。`);}
function number(value,min,max,label){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new Error(`${label} 必须在 ${min}–${max} 范围内。`);}
function evidenceGrade(item,dimension){
  if(!grades.includes(item.grade))throw new Error(`维度 ${dimension.id} 证据等级无效。`);
  if(!dimension.anchors.some(a=>a.score===item.score))throw new Error(`维度 ${dimension.id} 得分必须选择已确认的分档。`);
  if((item.grade==='暂无证据')!==(item.score===0))throw new Error(`维度 ${dimension.id} 暂无证据必须为零分，有证据必须选择正分档。`);
}
export function validateScoringRules(rules){
  if(rules?.schemaVersion!==1)throw new Error('SCORING_RULES schemaVersion 必须为 1。');
  text(rules.version,'评分规则版本');text(rules.evaluationProfile?.model,'固定模型');text(rules.evaluationProfile?.promptVersion,'提示词版本');
  if(!Array.isArray(rules.dimensions)||rules.dimensions.length<3||rules.dimensions.length>5)throw new Error('评分规则需要 3–5 个维度。');
  const ids=new Set();let weight=0;
  for(const d of rules.dimensions){
    safeSegment(d?.id,'维度 ID');if(ids.has(d.id))throw new Error('评分维度 ID 重复。');ids.add(d.id);
    text(d.name,'维度名称');text(d.requirement,'能力要求');number(d.weight,1,100,'维度权重');
    if(!Number.isInteger(d.weight))throw new Error('维度权重必须为整数百分比。');weight+=d.weight;
    if(!Array.isArray(d.anchors)||d.anchors.length<3)throw new Error('每个维度需要零分档和至少两个正分档。');
    const scores=new Set();
    for(const a of d.anchors){number(a?.score,0,10,'分档');if(!Number.isInteger(a.score)||scores.has(a.score))throw new Error('分档必须是唯一的 0–10 整数。');scores.add(a.score);text(a.description,'分档证据条件');}
    if(!scores.has(0))throw new Error('每个维度必须定义零分档（暂无证据）。');
  }
  if(weight!==100)throw new Error('维度权重之和必须为 100。');
  const rec=rules.recommendation;
  number(rec?.minScore,0,10,'复核提示分数');number(rec?.minCoverage,0,100,'复核提示覆盖率');
  if(!Array.isArray(rec.requiredDimensions))throw new Error('requiredDimensions 必须是数组，可为空。');
  const requiredIds=new Set();
  for(const d of rec.requiredDimensions){if(!ids.has(d?.id)||requiredIds.has(d.id))throw new Error('复核条件维度无效或重复。');requiredIds.add(d.id);number(d.minScore,0,10,'关键维度最低分');}
  if(rules.examples!==undefined&&!Array.isArray(rules.examples))throw new Error('examples 必须是数组。');
  const examples=new Set();
  for(const e of rules.examples??[]){
    text(e?.id,'示例编号');if(examples.has(e.id))throw new Error('示例编号重复。');examples.add(e.id);
    if(!ids.has(e.dimensionId)||!['pending','confirmed'].includes(e.status))throw new Error('示例维度或确认状态无效。');
    text(e.text,'示例内容');
    // Unconfirmed draft judgments never participate in the active rubric.
    if(e.status==='confirmed')evidenceGrade(e,rules.dimensions.find(d=>d.id===e.dimensionId));
  }
  return rules;
}
export async function readScoringRules(rolePath,{required=false}={}){
  const file=await boundedPath(rolePath,'SCORING_RULES.json');
  let content;
  try{content=await fs.readFile(file,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;if(required)throw new Error('能力证据得分 / 证据覆盖率需要先通过问答形成并确认 SCORING_RULES.json 评分规则。');return null;}
  return {rules:validateScoringRules(JSON.parse(content)),digest:scoringDigest(content)};
}
export function assessmentIdentity(rules,input,{role='',rulesDigest=scoringDigest(JSON.stringify(rules))}={}){
  text(input?.resumeText,'简历文本');safeSegment(input?.candidate?.id,'候选人 ID');text(input.candidate.name,'候选人姓名');
  if(input.model!==rules.evaluationProfile.model||input.promptVersion!==rules.evaluationProfile.promptVersion)throw new Error('评估模型或提示词版本与已确认评分规则不一致，请先确认新版本。');
  const resumeDigest=scoringDigest(input.resumeText);
  const candidate={id:input.candidate.id,name:input.candidate.name};
  const evaluationKey=scoringDigest(JSON.stringify({role,candidate,resumeDigest,rulesDigest,model:input.model,promptVersion:input.promptVersion}));
  return {evaluationKey,resumeDigest,rulesDigest,model:input.model,promptVersion:input.promptVersion};
}
export function evaluateEvidence(rules,input,context={}){
  validateScoringRules(rules);
  const identity=assessmentIdentity(rules,input,context);
  if(!Array.isArray(input.dimensions)||input.dimensions.length!==rules.dimensions.length||new Set(input.dimensions.map(d=>d?.id)).size!==rules.dimensions.length)throw new Error('评估必须完整且不重复地包含所有评分维度。');
  if(input.reviewReasons!==undefined&&(!Array.isArray(input.reviewReasons)||input.reviewReasons.some(v=>typeof v!=='string'||!v.trim())))throw new Error('reviewReasons 必须是非空文本组成的数组。');
  const normalizedSource=input.resumeText.replace(/\r\n?/g,'\n');
  const dimensions=rules.dimensions.map(d=>{
    const item=input.dimensions.find(i=>i.id===d.id);if(!item)throw new Error(`缺少维度 ${d.id}。`);
    evidenceGrade(item,d);text(item.rationale,`维度 ${d.id} 判分依据`);
    if(typeof item.quote!=='string')throw new Error(`维度 ${d.id} quote 必须为文本。`);
    let sourceLine=null;
    if(item.grade==='暂无证据'){if(item.quote!=='')throw new Error('暂无证据的 quote 必须为空，缺失不代表负面证据。');}
    else{
      text(item.quote,'简历逐字引用');const quote=item.quote.replace(/\r\n?/g,'\n');
      const start=normalizedSource.indexOf(quote);if(start<0)throw new Error(`维度 ${d.id} 引用未在简历原文中找到，不能改写原文。`);
      sourceLine=normalizedSource.slice(0,start).split('\n').length;
    }
    return {id:d.id,name:d.name,weight:d.weight,grade:item.grade,score:item.score,quote:item.quote,sourceLine,rationale:item.rationale,anchor:d.anchors.find(a=>a.score===item.score).description};
  });
  const rawScore=dimensions.reduce((sum,d)=>sum+d.score*d.weight,0)/100;
  const rawCoverage=dimensions.filter(d=>d.grade!=='暂无证据').length/dimensions.length*100;
  const reviewReasons=input.reviewReasons??[];
  const meets=rawScore>=rules.recommendation.minScore&&rawCoverage>=rules.recommendation.minCoverage&&rules.recommendation.requiredDimensions.every(d=>dimensions.find(i=>i.id===d.id).score>=d.minScore);
  return {schemaVersion:1,...identity,rulesVersion:rules.version,score:round(rawScore),coverage:round(rawCoverage),recommendation:reviewReasons.length?'待人工核实':meets?'建议进入人工复核':'建议补充证据后复核',reviewReasons,dimensions,confirmedExampleIds:(rules.examples??[]).filter(e=>e.status==='confirmed').map(e=>e.id)};
}
