import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { normalizePipeline } from "./pipeline-config.mjs";
import { writeLedger } from "./create-role-ledger.mjs";
import { createReviewDashboard } from "./create-review-dashboard.mjs";
import { syncDashboard } from "./sync-dashboard-data.mjs";
import { safeSegment, boundedPath, withRootLock } from "./workspace-safety.mjs";
import {validateConfirmation,writeRoleConfirmation} from './role-standard-state.mjs';
import {currentRolePath, sessionLockOptions, sessionArgument} from './agent-state.mjs';
import {validateScoringRules} from './scoring-rules.mjs';

const templateNames = ["CONTEXT.md", "ROLE_STANDARD.md", "SOURCING_STRATEGY.md", "KEYWORD_ITERATIONS.md", "FEEDBACK_ITERATIONS.md"];

function safeRoleName(roleName) {
  return safeSegment(roleName, "岗位名称");
}

export async function initializeRoleWorkspace({ rootPath, roleName, sessionId, pipeline, capacity, documents = {}, confirmation, scoringRules, templateRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../templates") }) {
  return withRootLock(rootPath, async () => {
  const role = safeRoleName(roleName);
  const normalizedPipeline = normalizePipeline(pipeline);
  if(confirmation!==undefined)validateConfirmation(confirmation);
  if(scoringRules!=null)validateScoringRules(scoringRules);
  for (const [name, content] of Object.entries(documents)) {
    if (!templateNames.includes(name)) throw new Error(`不支持的岗位文档：${name}`);
    if (typeof content !== "string" || !content.trim() || /\{\{[^}]+\}\}/.test(content)) throw new Error(`已确认文档 ${name} 不能为空或含有占位符。`);
  }
  const rolePath = await boundedPath(rootPath, "workflow", "roles", role);
  if (await fs.access(rolePath).then(() => true).catch(() => false)) throw new Error(`岗位目录已存在：${role}。请切换岗位或使用新的岗位名称。`);
  await fs.mkdir(path.join(rolePath, "candidates"), { recursive: true });
  try {
    for (const fileName of templateNames) {
      const template = await fs.readFile(path.join(templateRoot, fileName), "utf8");
      const content = documents[fileName] ?? `> 草稿：尚未完成需求确认。\n\n${template.replaceAll("{{岗位名称}}", role)}`;
      await fs.writeFile(path.join(rolePath, fileName), content, "utf8");
    }
    await fs.writeFile(path.join(rolePath, "PIPELINE.json"), `${JSON.stringify(normalizedPipeline, null, 2)}\n`, "utf8");
    if(scoringRules!=null)await fs.writeFile(path.join(rolePath,'SCORING_RULES.json'),JSON.stringify(scoringRules,null,2)+'\n','utf8');
    await fs.writeFile(path.join(rolePath, "ACTION_LOG.md"), `# ${role}｜操作日志\n\n> 仅追加已确认的 Agent 写回操作。\n`, "utf8");
    await writeLedger({ roleName: role, outputPath: path.join(rolePath, "candidate-ledger.xlsx"), pipeline: normalizedPipeline, capacity });
    await createReviewDashboard(path.join(rolePath, "招聘数据复盘.html"));
    await syncDashboard({ ledgerPath: path.join(rolePath, "candidate-ledger.xlsx"), dashboardPath: path.join(rolePath, "招聘数据复盘.html"), role });
    if(confirmation!==undefined)await writeRoleConfirmation({rolePath,confirmation});
    const statePath = await boundedPath(rootPath, path.relative(rootPath, currentRolePath(rootPath, sessionId)));
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(statePath, JSON.stringify({ role, updatedAt: new Date().toISOString() }, null, 2) + "\n", "utf8");
    return { role, rolePath };
  } catch (error) {
    await fs.rm(rolePath, { recursive: true, force: true });
    throw error;
  }
  }, sessionLockOptions(sessionId));
}

function argument(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(currentFile).href) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("用途：创建岗位工作区。\n用法：node workflow/scripts/initialize-role-workspace.mjs --root <项目根目录> --role <岗位名称> --pipeline <PIPELINE.json> [--documents <已确认文档.json>] [--confirmation <确认信息.json>] [--scoring-rules <评分规则.json>] [--capacity <人数>] [--session <会话编号>]\n未传 confirmation 时保留草稿，候选人写入前必须确认岗位标准。");
    process.exit(0);
  }
  const rootPath = argument("--root");
  const roleName = argument("--role");
  const pipelinePath = argument("--pipeline");
  const capacity = argument("--capacity");
  if (!rootPath || !roleName || !pipelinePath) throw new Error("用法：--root <项目根目录> --role <岗位名称> --pipeline <PIPELINE.json> [--capacity <人数>]");
  const pipeline = JSON.parse(await fs.readFile(pipelinePath, "utf8"));
  const documentsPath = argument("--documents");
  const documents = documentsPath ? JSON.parse(await fs.readFile(documentsPath, "utf8")) : {};
  const confirmationPath=argument('--confirmation');
  const confirmation=confirmationPath?JSON.parse(await fs.readFile(confirmationPath,'utf8')):undefined;
  const scoringPath=argument('--scoring-rules');
  const scoringRules=scoringPath?JSON.parse(await fs.readFile(scoringPath,'utf8')):undefined;
  console.log(JSON.stringify(await initializeRoleWorkspace({ rootPath, roleName, sessionId: sessionArgument(), pipeline, capacity, documents, confirmation, scoringRules }), null, 2));
}
