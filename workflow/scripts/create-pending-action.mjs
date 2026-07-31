import fs from "node:fs/promises";
import { createPendingAction } from "./apply-confirmed-action.mjs";

function argument(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("用途：保存待确认的候选人变更提案。\n用法：node workflow/scripts/create-pending-action.mjs --root <项目根目录> --input <proposal.json>");
  process.exit(0);
}
const rootPath = argument("--root");
const input = argument("--input");
if (!rootPath || !input) throw new Error("用法：--root <项目根目录> --input <proposal.json>");
console.log(JSON.stringify(await createPendingAction({ rootPath, proposal: JSON.parse(await fs.readFile(input, "utf8")) }), null, 2));
