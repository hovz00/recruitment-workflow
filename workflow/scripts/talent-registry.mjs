import crypto from 'node:crypto';
import {applicationKey,applicationReference,requireApplication} from './application-catalog.mjs';
import {safeSegment} from './workspace-safety.mjs';

export const emptyRegistry=()=>({schemaVersion:1,people:[],events:[]});
export function validateRegistry(registry,applications){
  if(registry?.schemaVersion!==1||!Array.isArray(registry.people)||!Array.isArray(registry.events))throw new Error('人才关联索引格式不正确，请先恢复或核实本地索引。');
  const personIds=new Set(),applicationIds=new Set();
  for(const person of registry.people){
    safeSegment(person?.personId,'人才编号');
    if(personIds.has(person.personId)||!Array.isArray(person.applications)||!person.applications.length)throw new Error('人才编号重复或关联列表为空。');
    personIds.add(person.personId);const roles=new Set();
    for(const raw of person.applications){
      const ref=applicationReference(raw),key=applicationKey(ref);
      if(applicationIds.has(key)||roles.has(ref.role))throw new Error('身份关联冲突：一条申请只能属于一个人，同一人每个岗位只能有一个候选人ID。');
      requireApplication(applications,ref);applicationIds.add(key);roles.add(ref.role);
    }
  }
  return registry;
}
export const personFor=(registry,ref)=>registry.people.find(person=>person.applications.some(item=>applicationKey(item)===applicationKey(ref)));
function confirmationText(value,label){
  if(typeof value!=='string'||!value.trim()||/[\r\n\x00-\x1f]/.test(value))throw new Error(`${label}必须为非空单行文本。`);
  return value.trim();
}

export function planIdentityChange({registry,applications,request}){
  if(!['link','unlink'].includes(request?.action))throw new Error('身份操作只能为 link 或 unlink。');
  const confirmedBy=confirmationText(request.confirmedBy,'确认人'),evidence=confirmationText(request.evidence,'确认依据');
  const target=applicationReference(request.target);requireApplication(applications,target);
  const nextPeople=structuredClone(registry.people),targetPerson=personFor(registry,target);
  const newId=()=>`T-${crypto.randomUUID()}`;
  let affected,personId,source,relationship;
  if(request.action==='link'){
    if(request.confirmedSamePerson!==true)throw new Error('关联必须明确 confirmedSamePerson=true，不能仅凭同名判断。');
    source=applicationReference(request.source);requireApplication(applications,source);
    if(source.role===target.role)throw new Error('跨岗位关联要求不同岗位；同岗位请核对原ID。');
    relationship=request.relationship??'parallel';
    if(!['parallel','referral'].includes(relationship))throw new Error('关联类型只能为 parallel 或 referral。');
    const sourcePerson=personFor(registry,source);
    if(sourcePerson&&sourcePerson.personId===targetPerson?.personId)throw new Error('两条申请已经关联到同一个人，无需重复关联。');
    affected=[...(sourcePerson?.applications??[source]),...(targetPerson?.applications??[target])];
    if(new Set(affected.map(ref=>ref.role)).size!==affected.length)throw new Error('身份关联冲突：合并后同一岗位会包含两个候选人ID，请先核实并解除错误关联。');
    personId=sourcePerson?.personId??targetPerson?.personId??newId();
    const replaced=new Set([sourcePerson?.personId,targetPerson?.personId].filter(Boolean));
    for(let i=nextPeople.length-1;i>=0;i--)if(replaced.has(nextPeople[i].personId))nextPeople.splice(i,1);
    nextPeople.push({personId,applications:affected});
  }else{
    if(!targetPerson||targetPerson.applications.length<2)throw new Error('该申请没有可解除的跨岗位关联。');
    affected=targetPerson.applications;
    nextPeople.find(person=>person.personId===targetPerson.personId).applications=affected.filter(ref=>applicationKey(ref)!==applicationKey(target));
    personId=newId();nextPeople.push({personId,applications:[target]});
  }
  return {action:request.action,target,...(source?{source,relationship,confirmedSamePerson:true}:{}),confirmedBy,evidence,personId,nextPeople,
    affectedApplications:affected.map(ref=>({...requireApplication(applications,ref),previousPersonId:personFor(registry,ref)?.personId??null}))};
}
