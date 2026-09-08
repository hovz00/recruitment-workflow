import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ExcelJS from 'exceljs';
import { getLedgerColumns, buildLedger } from './create-role-ledger.mjs';
import { readPipeline, stageLabels } from './pipeline-config.mjs';
import { createReviewDashboard } from './create-review-dashboard.mjs';
import { syncDashboard } from './sync-dashboard-data.mjs';
import { safeSegment, boundedPath, withRootLock } from './workspace-safety.mjs';

export async function migrateRoleWorkspace({ rootPath, roleName }) {
  return withRootLock(rootPath, async () => {
    const role = safeSegment(roleName, '岗位名称');
    const rolePath = await boundedPath(rootPath, 'workflow', 'roles', role);
    const pipeline = await readPipeline(await boundedPath(rootPath, 'workflow', 'roles', role, 'PIPELINE.json'));
    const names = ['candidate-ledger.xlsx', '招聘数据复盘.html', '招聘数据复盘.html.bak', '招聘数据复盘.html.tmp', 'index.html', 'ACTION_LOG.md', 'CONTEXT.md', 'ROLE_STANDARD.md', 'SOURCING_STRATEGY.md', 'KEYWORD_ITERATIONS.md', 'FEEDBACK_ITERATIONS.md'];
    const backupPath = await boundedPath(rootPath, '.recruitment-agent', 'backups', `migration-${crypto.randomUUID()}`);
    await fs.mkdir(backupPath, { recursive: true });
    const manifest = [];
    for (const name of names) {
      const target = await boundedPath(rootPath, 'workflow', 'roles', role, name);
      const existed = await fs.access(target).then(()=>true).catch(()=>false);
      const backup = path.join(backupPath, name);
      if (existed) await fs.copyFile(target, backup);
      manifest.push({target,backup,existed});
    }
    try {
      const ledgerPath = path.join(rolePath, 'candidate-ledger.xlsx');
      const workbook = new ExcelJS.Workbook();await workbook.xlsx.readFile(ledgerPath);
      const sheet = workbook.getWorksheet('候选人台账');
      if (!sheet || sheet.getCell('A3').value !== '候选人ID') throw new Error('不支持的旧台账表头，请先核对候选人台账第 3 行。');
      const headers = sheet.getRow(3).values.slice(1);
      const addedFields = getLedgerColumns(pipeline).filter(name => !headers.includes(name));
      for (const name of addedFields) {
        const index = headers.push(name);const cell = sheet.getCell(3, index);cell.value = name;cell.style = {...sheet.getCell('A3').style};
        sheet.getColumn(index).width=18;if(name.endsWith('日期'))sheet.getColumn(index).numFmt='yyyy-mm-dd';
      }
      let config = workbook.getWorksheet('选项配置');
      if (!config) {
        config=workbook.addWorksheet('选项配置');
        const fresh=(await buildLedger(role,pipeline,{capacity:1})).getWorksheet('选项配置');
        fresh.eachRow((row,n)=>{config.getRow(n).values=row.values;});
      } else {
        const existing=[];for(let n=2;config.getCell(n,2).value;n++)existing.push(String(config.getCell(n,2).value));
        if(existing.join('|')!==stageLabels(pipeline).join('|'))throw new Error('台账与 PIPELINE.json 阶段不一致，请先人工核对流程映射。');
      }
      config.getCell(1,5).value='SLA天数';pipeline.stages.forEach((stage,i)=>{if(stage.slaDays!==undefined)config.getCell(i+2,5).value=stage.slaDays;});
      sheet.autoFilter={from:{row:3,column:1},to:{row:3,column:headers.length}};
      await workbook.xlsx.writeFile(ledgerPath);
      const templates=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../templates');
      for(const name of ['CONTEXT.md','ROLE_STANDARD.md','SOURCING_STRATEGY.md','KEYWORD_ITERATIONS.md','FEEDBACK_ITERATIONS.md']) {
        if(!manifest.find(item=>item.target===path.join(rolePath,name)).existed)await fs.writeFile(path.join(rolePath,name),'> 草稿：旧岗位缺少此文档，请补充确认。\n\n'+(await fs.readFile(path.join(templates,name),'utf8')).replaceAll('{{岗位名称}}',role));
      }
      if(!manifest.find(item=>item.target===path.join(rolePath,'ACTION_LOG.md')).existed)await fs.writeFile(path.join(rolePath,'ACTION_LOG.md'),`# ${role}｜操作日志\n\n- 旧版岗位迁移，原有候选人记录保留。\n`);
      await fs.mkdir(await boundedPath(rootPath,'workflow','roles',role,'candidates'),{recursive:true});
      const dashboardPath=path.join(rolePath,'招聘数据复盘.html');
      if(!await fs.access(dashboardPath).then(()=>true).catch(()=>false))await createReviewDashboard(dashboardPath);
      await syncDashboard({ledgerPath,dashboardPath,role});
      return {role,rolePath,addedFields,backupPath};
    } catch(error) {
      for(const item of manifest)if(item.existed)await fs.copyFile(item.backup,item.target);else await fs.rm(item.target,{force:true});
      throw error;
    }
  });
}
function argument(name){const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const usage='node workflow/scripts/migrate-role-workspace.mjs --root <项目根目录> --role <旧岗位名称>';
  if(process.argv.includes('--help')||process.argv.includes('-h'))console.log(usage);
  else{const rootPath=argument('--root'),roleName=argument('--role');if(!rootPath||!roleName)throw new Error(usage);console.log(await migrateRoleWorkspace({rootPath,roleName}));}
}
