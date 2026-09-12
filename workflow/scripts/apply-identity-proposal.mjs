import {applyIdentityProposal} from './talent-identity.mjs';
import {sessionArgument} from './agent-state.mjs';
const argument=name=>{const index=process.argv.indexOf(name);return index<0?undefined:process.argv[index+1];};
const usage='node workflow/scripts/apply-identity-proposal.mjs --root <根目录> --proposal <提案ID> [--session <会话ID>]';
if(process.argv.includes('--help')||process.argv.includes('-h'))console.log(usage);
else{
  const rootPath=argument('--root'),proposalId=argument('--proposal');if(!rootPath||!proposalId)throw new Error(usage);
  console.log(JSON.stringify(await applyIdentityProposal({rootPath,sessionId:sessionArgument(),proposalId}),null,2));
}
