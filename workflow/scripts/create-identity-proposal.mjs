import fs from 'node:fs/promises';
import {createIdentityProposal} from './talent-identity.mjs';
import {sessionArgument} from './agent-state.mjs';
const argument=name=>{const index=process.argv.indexOf(name);return index<0?undefined:process.argv[index+1];};
const usage='node workflow/scripts/create-identity-proposal.mjs --root <根目录> --input <身份提案.json> [--session <会话ID>]';
if(process.argv.includes('--help')||process.argv.includes('-h'))console.log(usage);
else{
  const rootPath=argument('--root'),input=argument('--input');if(!rootPath||!input)throw new Error(usage);
  console.log(JSON.stringify(await createIdentityProposal({rootPath,sessionId:sessionArgument(),request:JSON.parse(await fs.readFile(input,'utf8'))}),null,2));
}
