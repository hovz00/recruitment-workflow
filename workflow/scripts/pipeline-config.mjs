import fs from "node:fs/promises";

export const defaultStatuses = ["进行中", "通过", "终止"];

export function normalizePipeline(input) {
  if (!Array.isArray(input?.stages) || input.stages.length === 0) throw new Error("流程配置至少需要一个主阶段。");
  const stages = input.stages.map(({ id, name, slaDays, kind, appointmentField }) => ({ id: Number(id), name: String(name ?? "").trim(), ...(slaDays === undefined ? {} : { slaDays: Number(slaDays) }),...(kind===undefined?{}:{kind}),...(appointmentField===undefined?{}:{appointmentField}) })).sort((a, b) => a.id - b.id);
  if (stages.some((stage) => !Number.isInteger(stage.id) || !stage.name)) throw new Error("每个阶段必须有整数 id 和非空名称。");
  if (new Set(stages.map((stage) => stage.id)).size !== stages.length) throw new Error("流程阶段 id 不能重复。");
  if (new Set(stages.map((stage) => stage.name)).size !== stages.length) throw new Error("流程阶段名称不能重复。");
  if (stages.some(({ slaDays }) => slaDays !== undefined && (!Number.isInteger(slaDays) || slaDays < 1 || slaDays > 90))) throw new Error("阶段 SLA 天数必须为 1 至 90 的整数。");
  if (stages.some((stage, index) => stage.id !== index)) throw new Error("流程阶段 id 必须从 0 开始连续编号，确保 Excel 与复盘漏斗顺序一致。");
  for(const stage of stages){
    if(stage.kind!==undefined&&!['interview','process'].includes(stage.kind))throw new Error('阶段 kind 只能为 interview 或 process。');
    if(stage.appointmentField!==undefined){
      if(stage.kind!=='interview'||typeof stage.appointmentField!=='string'||!['一面日期','二面日期','三面日期','HRBP日期','决策会日期',`${stage.id}-${stage.name}预约日期`].includes(stage.appointmentField))throw new Error('面试 appointmentField 必须是固定约面字段或本阶段的“编号-阶段名预约日期”。');
    }
    if(stage.kind==='interview'&&stage.appointmentField===undefined)stage.appointmentField=`${stage.id}-${stage.name}预约日期`;
  }
  const appointments=stages.map(interviewAppointmentField).filter(Boolean);
  if(new Set(appointments).size!==appointments.length)throw new Error('面试预约字段不能在多个阶段间共用。');
  const statuses = [...new Set((input.statuses ?? defaultStatuses).map((value) => String(value).trim()).filter(Boolean))];
  if (statuses.join("|") !== defaultStatuses.join("|")) throw new Error("阶段状态必须且只能为：进行中、通过、终止。");
  return { stages, statuses };
}
export const stageLabels = (pipeline) => pipeline.stages.map(({ id, name }) => `${id}-${name}`);
export function interviewAppointmentField(stage){
  if(stage?.kind==='process')return null;
  if(stage?.kind==='interview')return stage.appointmentField??`${stage.id}-${stage.name}预约日期`;
  return ['一面日期','二面日期','三面日期','HRBP日期','决策会日期'].find(field=>stage?.name.includes(field.replace(/日期$/,'')))??null;
}
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
