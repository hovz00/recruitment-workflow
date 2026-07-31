import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const formalDashboardTemplate = path.resolve(here, "../templates/recruitment-review-dashboard.html");

export async function createReviewDashboard(outputPath, { templatePath = formalDashboardTemplate, force = false } = {}) {
  const legacyPath = path.join(path.dirname(outputPath), "index.html");
  if (path.basename(outputPath) === "招聘数据复盘.html") {
    try {
      await fs.access(outputPath);
    } catch (error) {
      if (error.code === "ENOENT") {
        try {
          await fs.rename(legacyPath, outputPath);
          return outputPath;
        } catch (legacyError) {
          if (legacyError.code !== "ENOENT") throw legacyError;
        }
      } else throw error;
    }
  }
  try {
    await fs.access(outputPath);
    if (!force && !process.argv.includes("--force")) throw new Error(`看板已存在：${outputPath}。为避免覆盖已同步的数据，请使用现有文件或另存为新文件。`);
    await fs.copyFile(outputPath, `${outputPath}.bak`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    await fs.access(templatePath);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`正式招聘复盘看板模板不存在：${templatePath}`);
    throw error;
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.copyFile(templatePath, outputPath);
  return outputPath;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(currentFile).href) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("用途：创建岗位招聘数据复盘.html。\n用法：node workflow/scripts/create-review-dashboard.mjs --out <岗位目录/招聘数据复盘.html> [--force]");
    process.exit(0);
  }
  const outputPath = argument("--out");
  if (!outputPath) throw new Error("用法：node workflow/scripts/create-review-dashboard.mjs --out <岗位目录/index.html>");
  console.log(`已创建正式复盘看板：${await createReviewDashboard(outputPath)}`);
}
