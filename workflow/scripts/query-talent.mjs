import {getTalentOverview} from './talent-identity.mjs';
const argument=name=>{const index=process.argv.indexOf(name);return index<0?undefined:process.argv[index+1];};
const usage='node workflow/scripts/query-talent.mjs --root <根目录> [--name <姓名> | --role <岗位> --candidate <候选人ID>]';
if(process.argv.includes('--help')||process.argv.includes('-h'))console.log(usage);
else{
  const rootPath=argument('--root'),role=argument('--role'),candidateId=argument('--candidate'),name=argument('--name');
  if(!rootPath||Boolean(role)!==Boolean(candidateId)||(name&&role))throw new Error(usage);
  console.log(JSON.stringify(await getTalentOverview({rootPath,name,...(role?{candidate:{role,candidateId}}:{})}),null,2));
}
