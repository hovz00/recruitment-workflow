import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import {boundedPath,safeSegment} from './workspace-safety.mjs';

const text=value=>String(value??'').trim();
export const applicationKey=ref=>JSON.stringify([ref.role,ref.candidateId]);
export function applicationReference(value){
  return {role:safeSegment(value?.role,'岗位名称'),candidateId:safeSegment(value?.candidateId,'候选人编号')};
}

/** Read identity and current progress only. Resume text and contact details are never copied. */
export async function readApplicationCatalog(rootPath){
  const rolesPath=await boundedPath(rootPath,'workflow','roles');
  const entries=await fs.readdir(rolesPath,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
  const applications=[],issues=[];
  for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){
    if(entry.isSymbolicLink())throw new Error(`岗位目录不允许符号链接：${entry.name}`);
    if(!entry.isDirectory())continue;
    const role=safeSegment(entry.name,'岗位名称');
    const ledgerPath=await boundedPath(rootPath,'workflow','roles',role,'candidate-ledger.xlsx');
    const workbook=new ExcelJS.Workbook();await workbook.xlsx.readFile(ledgerPath);
    const sheet=workbook.getWorksheet('候选人台账');
    if(!sheet)throw new Error(`${role}：缺少候选人台账工作表。`);
    const headers=sheet.getRow(3).values.slice(1).map(text);
    for(const field of ['候选人ID','姓名','主阶段','阶段状态'])if(!headers.includes(field))throw new Error(`${role}：台账缺少${field}。`);
    const ids=new Set();
    for(let n=4;n<=sheet.rowCount;n++){
      const row=sheet.getRow(n),values=row.values.slice(1);
      if(!values.some(value=>text(value)))continue;
      const get=field=>text(row.getCell(headers.indexOf(field)+1).value);
      const candidateId=get('候选人ID'),name=get('姓名');
      if(!candidateId||!name){issues.push({role,row:n,message:'缺少候选人ID或姓名，暂未计入身份查询；请核实修复。'});continue;}
      safeSegment(candidateId,'候选人编号');
      if(ids.has(candidateId.toLowerCase()))throw new Error(`${role}：候选人ID重复或大小写冲突，不能确定身份。`);
      ids.add(candidateId.toLowerCase());
      applications.push({role,candidateId,name,stage:get('主阶段'),status:get('阶段状态')});
    }
  }
  return {applications,issues};
}

export function requireApplication(applications,reference){
  const ref=applicationReference(reference);
  const found=applications.find(row=>applicationKey(row)===applicationKey(ref));
  if(!found)throw new Error(`候选人引用不存在或ID大小写不一致：${ref.role}/${ref.candidateId}。`);
  return found;
}

export async function findCrossRoleMatches({rootPath,role,name}){
  const {applications,issues}=await readApplicationCatalog(rootPath);
  return {matches:applications.filter(row=>row.role!==role&&row.name===text(name)),issues};
}
