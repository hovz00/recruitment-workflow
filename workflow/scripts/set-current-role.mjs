import { resolveRoleDirectory, setCurrentRole, sessionArgument } from "./agent-state.mjs";

function argument(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("用途：切换当前招聘岗位。\n用法：node workflow/scripts/set-current-role.mjs --root <项目根目录> --role <岗位名称> [--session <会话编号>]");
  process.exit(0);
}
const rootPath = argument("--root");
const role = argument("--role");
if (!rootPath || !role) throw new Error("用法：--root <项目根目录> --role <岗位名称>");
const resolved = await resolveRoleDirectory({ rootPath, roleReference: role });
console.log(JSON.stringify(await setCurrentRole({ rootPath, role: resolved.role, sessionId: sessionArgument() }), null, 2));
