import fs from "node:fs/promises";

export const defaultStatuses = ["进行中", "通过", "终止"];

export function normalizePipeline(input) {
  if (!Array.isArray(input?.stages) || input.stages.length === 0) throw new Error("流程配置至少需要一个主阶段。");
  const stages = input.stages.map(({ id, name }) => ({ id: Number(id), name: String(name ?? "").trim() })).sort((a, b) => a.id - b.id);
  if (stages.some((stage) => !Number.isInteger(stage.id) || !stage.name)) throw new Error("每个阶段必须有整数 id 和非空名称。");
  if (new Set(stages.map((stage) => stage.id)).size !== stages.length) throw new Error("流程阶段 id 不能重复。");
  if (stages.some((stage, index) => stage.id !== index)) throw new Error("流程阶段 id 必须从 0 开始连续编号，确保 Excel 与复盘漏斗顺序一致。");
  const statuses = [...new Set((input.statuses ?? defaultStatuses).map((value) => String(value).trim()).filter(Boolean))];
  if (statuses.join("|") !== defaultStatuses.join("|")) throw new Error("阶段状态必须且只能为：进行中、通过、终止。");
  return { stages, statuses };
}
export const stageLabels = (pipeline) => pipeline.stages.map(({ id, name }) => `${id}-${name}`);
export async function readPipeline(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`流程配置文件不存在：${filePath}。请先完成岗位澄清并创建 PIPELINE.json。`);
    throw new Error(`流程配置文件解析失败：${filePath}。${error.message}`);
  }
  try {
    return normalizePipeline(parsed);
  } catch (error) {
    throw new Error(`流程配置不合法：${filePath}。${error.message}`);
  }
}
