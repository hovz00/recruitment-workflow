import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { normalizePipeline } from "./pipeline-config.mjs";
import { writeLedger } from "./create-role-ledger.mjs";
import { createReviewDashboard } from "./create-review-dashboard.mjs";
import { setCurrentRole } from "./agent-state.mjs";

const templateNames = ["CONTEXT.md", "ROLE_STANDARD.md", "SOURCING_STRATEGY.md", "KEYWORD_ITERATIONS.md", "FEEDBACK_ITERATIONS.md"];

function safeRoleName(roleName) {
  const value = String(roleName ?? "").trim();
  if (!value || value !== path.basename(value) || value.includes("..")) throw new Error("岗位名称不合法。");
  return value;
}

export async function initializeRoleWorkspace({ rootPath, roleName, pipeline, capacity, templateRoot = path.resolve("workflow/templates") }) {
  const role = safeRoleName(roleName);
  const normalizedPipeline = normalizePipeline(pipeline);
  const rolePath = path.join(rootPath, "workflow", "roles", role);
  if (await fs.access(rolePath).then(() => true).catch(() => false)) throw new Error(`岗位目录已存在：${role}。请切换岗位或使用新的岗位名称。`);
  await fs.mkdir(path.join(rolePath, "candidates"), { recursive: true });
  try {
    for (const fileName of templateNames) {
      const template = await fs.readFile(path.join(templateRoot, fileName), "utf8");
      await fs.writeFile(path.join(rolePath, fileName), template.replaceAll("{{岗位名称}}", role), "utf8");
    }
    await fs.writeFile(path.join(rolePath, "PIPELINE.json"), `${JSON.stringify(normalizedPipeline, null, 2)}\n`, "utf8");
    await fs.writeFile(path.join(rolePath, "ACTION_LOG.md"), `# ${role}｜操作日志\n\n> 仅追加已确认的 Agent 写回操作。\n`, "utf8");
    await writeLedger({ roleName: role, outputPath: path.join(rolePath, "candidate-ledger.xlsx"), pipeline: normalizedPipeline, capacity });
    await createReviewDashboard(path.join(rolePath, "招聘数据复盘.html"));
    await setCurrentRole({ rootPath, role });
    return { role, rolePath };
  } catch (error) {
    await fs.rm(rolePath, { recursive: true, force: true });
    throw error;
  }
}

function argument(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(currentFile).href) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("用途：创建一个已确认流程的岗位工作区。\n用法：node workflow/scripts/initialize-role-workspace.mjs --root <项目根目录> --role <岗位名称> --pipeline <PIPELINE.json> [--capacity <人数>]");
    process.exit(0);
  }
  const rootPath = argument("--root");
  const roleName = argument("--role");
  const pipelinePath = argument("--pipeline");
  const capacity = argument("--capacity");
  if (!rootPath || !roleName || !pipelinePath) throw new Error("用法：--root <项目根目录> --role <岗位名称> --pipeline <PIPELINE.json> [--capacity <人数>]");
  const pipeline = JSON.parse(await fs.readFile(pipelinePath, "utf8"));
  console.log(JSON.stringify(await initializeRoleWorkspace({ rootPath, roleName, pipeline, capacity }), null, 2));
}
