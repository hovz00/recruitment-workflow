import {isDeepStrictEqual} from 'node:util';
import {readScoringRules,evaluateEvidence} from './scoring-rules.mjs';
import {readConfirmedStandard} from './role-standard-state.mjs';
import {readSavedAssessment} from './evaluate-resume.mjs';

const scoreFields=['能力证据得分','证据覆盖率'];
export async function validateScoredProposal(rolePath,proposal){
  const scoringChanges=proposal.changes.filter(c=>scoreFields.includes(c.field));
  if(!scoringChanges.length&&proposal.assessment===undefined)return null;
  const {rules,digest}=await readScoringRules(rolePath,{required:true});
  await readConfirmedStandard(rolePath);
  const input=proposal.assessment;
  if(!input||input.candidate?.id!==proposal.candidate.id||input.candidate?.name!==proposal.candidate.name)throw new Error('能力证据得分 / 证据覆盖率必须附上当前候选人的完整 assessment。');
  if(input.rulesDigest!==digest)throw new Error('评估评分规则摘要已变化，请重新评估并预览。');
  const result=evaluateEvidence(rules,input,{role:proposal.role,rulesDigest:digest});
  for(const [i,field]of scoreFields.entries()){
    const change=scoringChanges.find(c=>c.field===field);
    if(!change||typeof change.after!=='number'||change.after!==[result.score,result.coverage][i])throw new Error(`${field} 必须与程序计算一致，并同时提交得分与覆盖率。`);
  }
  const prior=await readSavedAssessment(rolePath,proposal.candidate.id,result.evaluationKey);
  if(prior&&(prior.status!=='confirmed'||!isDeepStrictEqual(evaluateEvidence(rules,prior.input,{role:proposal.role,rulesDigest:digest}),prior.result)))throw new Error('已有评估记录校验失败，请核对档案。');
  if(input.reevaluationReason!==undefined&&(typeof input.reevaluationReason!=='string'||!input.reevaluationReason.trim()))throw new Error('主动重评需要非空 reevaluationReason。');
  if(prior?.result?.evaluationKey===result.evaluationKey&&!isDeepStrictEqual(prior.result,result)&&!input.reevaluationReason)throw new Error('相同简历、标准和模型已有确认评估；请复用，主动重评须提供 reevaluationReason 并重新确认。');
  return {input,result};
}
