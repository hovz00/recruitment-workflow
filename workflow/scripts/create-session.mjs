import { createSession } from './agent-state.mjs';

const argument = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const usage = '用途：为当前对话创建独立招聘会话，保存返回的 sessionId 供后续命令使用。\n用法：node workflow/scripts/create-session.mjs --root <项目根目录> [--role <已有岗位名称>]';
if (process.argv.includes('--help') || process.argv.includes('-h')) console.log(usage);
else {
  const rootPath = argument('--root');
  if (!rootPath) throw new Error(usage);
  if (process.argv.includes('--role') && !argument('--role')) throw new Error('--role 必须提供岗位名称。');
  console.log(JSON.stringify(await createSession({ rootPath, roleName: argument('--role') }), null, 2));
}
