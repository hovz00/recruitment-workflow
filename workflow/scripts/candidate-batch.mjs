import fs from 'node:fs/promises';
import {sessionArgument} from './agent-state.mjs';
import {createCandidateBatch,getCandidateBatch,applyCandidateBatch,cancelCandidateBatchItems} from './candidate-batches.mjs';
const argument=name=>{const index=process.argv.indexOf(name);if(index<0)return undefined;const value=process.argv[index+1];if(!value||value.startsWith('--'))throw new Error(`${name} 必须提供参数。`);return value;};
const usage=`node workflow/scripts/candidate-batch.mjs <create|show|apply|cancel> --root <根目录> [--session <会话ID>]
create --input <包含 proposals 数组的JSON>
show --batch <批次ID>
apply --batch <批次ID> [--items <条目ID,条目ID>] [--limit <1-200>] [--retry-failed]
cancel --batch <批次ID> --items <条目ID,条目ID> --reason <取消原因>
执行前展示完整批次或所选条目的字段变化，由招聘者确认。Ctrl+C 会完成当前条目的写回/回滚后暂停。`;
if(process.argv.includes('--help')||process.argv.includes('-h'))console.log(usage);
else{
  const action=process.argv[2],rootPath=argument('--root'),sessionId=sessionArgument();
  if(!rootPath||!['create','show','apply','cancel'].includes(action))throw new Error(usage);
  let result;
  if(action==='create'){
    const input=argument('--input');if(!input)throw new Error(usage);const parsed=JSON.parse(await fs.readFile(input,'utf8'));
    result=await createCandidateBatch({rootPath,sessionId,proposals:Array.isArray(parsed)?parsed:parsed.proposals});
  }else{
    const batchId=argument('--batch');if(!batchId)throw new Error(usage);
    const options={rootPath,sessionId,batchId},itemIds=argument('--items')?.split(',').map(value=>value.trim());
    if(action==='show')result=await getCandidateBatch(options);
    if(action==='cancel')result=await cancelCandidateBatchItems({...options,itemIds,reason:argument('--reason')});
    if(action==='apply'){
      const controller=new AbortController(),pause=()=>controller.abort();process.on('SIGINT',pause);process.on('SIGTERM',pause);
      try{result=await applyCandidateBatch({...options,itemIds,limit:argument('--limit')===undefined?undefined:Number(argument('--limit')),retryFailed:process.argv.includes('--retry-failed'),signal:controller.signal});}
      finally{process.removeListener('SIGINT',pause);process.removeListener('SIGTERM',pause);}
      if(result.counts.failed)process.exitCode=2;
    }
  }
  console.log(JSON.stringify(result,null,2));
}
