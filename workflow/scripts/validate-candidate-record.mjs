const requiredFields = ["简历来源", "简历收取时间", "主阶段", "阶段状态"];
const metadataDates = new Set(["简历收取时间", "状态更新时间", "最后更新时间"]);
const blank = value => value === undefined || value === null || (typeof value === "string" && !value.trim());
const text = value => String(value ?? "").trim();
const isDynamicHistory = field => /^\d+-.+日期$/.test(field) && !field.endsWith('预约日期');
const fail = (field, message) => { throw new Error(`字段“${field}”${message}。`); };

function calendarDate(value, field) {
  if (blank(value)) return null;
  if (value instanceof Date) {
    if (!Number.isFinite(value.valueOf())) fail(field, "必须为有效的 YYYY-MM-DD 日期或 Date");
    const day = value.toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) fail(field, "必须为有效的 YYYY-MM-DD 日期或 Date");
    return day;
  }
  const day = typeof value === "string" ? value.trim() : "";
  const parsed = new Date(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== day) {
    fail(field, "必须为有效的 YYYY-MM-DD 日期或 Date");
  }
  return day;
}

function scoreInRange(value, field, maximum) {
  if (blank(value)) return;
  const numeric = typeof value === "number" || (typeof value === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()));
  if (!numeric || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > maximum) {
    fail(field, `必须是 0 至 ${maximum} 的有限数字，不能带单位或百分号`);
  }
}

/** Validate a complete merged record without changing cell values or filling unknown history. */
export function validateCandidateRecord(record, { stages, statuses = ["进行中", "通过", "终止"], now = new Date() } = {}) {
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("候选人记录必须是字段对象。");
  for (const field of requiredFields) if (blank(record[field])) fail(field, "不能为空");
  const configuredLabels = stages?.map(stage => typeof stage === "string" ? stage.trim() : `${stage.id}-${stage.name}`);
  const currentStage = text(record["主阶段"]);
  if (configuredLabels ? !configuredLabels.includes(currentStage) : !/^\d+-.+$/.test(currentStage)) fail("主阶段", "不在岗位流程配置中");
  const status = text(record["阶段状态"]);
  if (!statuses.includes(status)) fail("阶段状态", `只能为：${statuses.join("、")}`);
  const reason = text(record["终止原因"]);
  if (status === "终止" && !reason) fail("终止原因", "在阶段状态为终止时不能为空");
  if (status !== "终止" && reason) fail("终止原因", "在候选人非终止时必须明确清空");
  scoreInRange(record["能力证据得分"], "能力证据得分", 10);
  scoreInRange(record["证据覆盖率"], "证据覆盖率", 100);

  const today = calendarDate(now, "校验基准日期");
  if (!today) fail("校验基准日期", "不能为空");
  const dates = new Map();
  for (const [field, value] of Object.entries(record)) {
    if (metadataDates.has(field) || field.endsWith("日期")) dates.set(field, calendarDate(value, field));
  }
  const received = dates.get("简历收取时间");
  const historyFields = ["简历收取时间", "Offer接受日期", ...Object.keys(record).filter(isDynamicHistory)];
  for (const field of historyFields) {
    const date = dates.get(field);
    if (!date) continue;
    if (date > today) fail(field, `是已发生日期，不能晚于当前 UTC 日期 ${today}`);
    if (date < received) fail(field, `不能早于简历收取时间 ${received}`);
  }

  // Include existing dynamic history even when an older field survived a stage rename.
  const inferredLabels = Object.keys(record).filter(isDynamicHistory).map(field => field.replace(/(?:通过)?日期$/, ""));
  const labels = [...new Set([...(configuredLabels ?? []), ...inferredLabels])].sort((a, b) => Number(a.split("-")[0]) - Number(b.split("-")[0]));
  let previous = null;
  for (const label of labels) {
    const enteredField = `${label}日期`, passedField = `${label}通过日期`;
    const entered = dates.get(enteredField), passed = dates.get(passedField);
    if (entered && passed && passed < entered) fail(passedField, `不能早于${enteredField} ${entered}`);
    const known = [[enteredField, entered], [passedField, passed]];
    if (/offer/i.test(label)) {
      const accepted = dates.get("Offer接受日期");
      if (entered && accepted && accepted < entered) fail("Offer接受日期", `不能早于${enteredField} ${entered}`);
      known.push(["Offer接受日期", accepted]);
    }
    for (const [field, date] of known) {
      if (date && previous && date < previous.date) fail(field, `不能早于前序阶段的${previous.field} ${previous.date}`);
    }
    for (const [field, date] of known) if (date && (!previous || date > previous.date)) previous = { field, date };
  }
  const accepted = dates.get("Offer接受日期"), expected = dates.get("预计入职日期");
  if (accepted && expected && expected < accepted) fail("预计入职日期", `不能早于Offer接受日期 ${accepted}`);
  return record;
}
