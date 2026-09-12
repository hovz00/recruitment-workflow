import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {safeSegment,boundedPath,withRootLock} from './workspace-safety.mjs';
import {resolveCurrentRole,sessionLockOptions,sessionArgument} from './agent-state.mjs';
import {writeRoleConfirmation} from './role-standard-state.mjs';

export async function confirmRoleStandard({rootPath,roleName,sessionId,version,confirmedBy,evidence}){
  return withRootLock(rootPath,async()=>{
    const role=safeSegment(roleName,'岗位名称');
    if(await resolveCurrentRole({rootPath,sessionId})!==role)throw new Error('确认岗位与当前岗位不一致，请先选择岗位。');
    const rolePath=await boundedPath(rootPath,'workflow','roles',role);
    for(const name of ['ROLE_STANDARD.md','PIPELINE.json','CONTEXT.md','ACTION_LOG.md','ROLE_CONFIRMATION.json'])await boundedPath(rootPath,'workflow','roles',role,name);
    return writeRoleConfirmation({rolePath,confirmation:{version,confirmedBy,evidence}});
  },sessionLockOptions(sessionId));
}
const argument=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const usage='node workflow/scripts/confirm-role-standard.mjs --root <根目录> --role <岗位> --version <版本> --confirmed-by <确认人> --evidence <确认依据> [--session <会话编号>]';
  if(process.argv.includes('--help')||process.argv.includes('-h'))console.log(usage);
  else console.log(await confirmRoleStandard({rootPath:argument('--root'),roleName:argument('--role'),sessionId:sessionArgument(),version:argument('--version'),confirmedBy:argument('--confirmed-by'),evidence:argument('--evidence')}));
}
