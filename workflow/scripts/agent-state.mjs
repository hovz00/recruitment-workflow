import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { safeSegment, boundedPath, withRootLock } from "./workspace-safety.mjs";

export const stateDirectory = (rootPath) => path.join(rootPath, ".recruitment-agent");
export function validateSessionId(sessionId) {
  if (sessionId === undefined) return undefined;
  // One spelling on both case-sensitive and Windows filesystems; never coerce numbers.
  if (typeof sessionId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(sessionId)) throw new Error('会话编号不合法，请使用 create-session.mjs 返回的小写编号。');
  return safeSegment(sessionId, '会话编号');
}
export const sessionStateDirectory = (rootPath, sessionId) => sessionId === undefined ? stateDirectory(rootPath) : path.join(stateDirectory(rootPath), "sessions", validateSessionId(sessionId));
export const currentRolePath = (rootPath, sessionId) => path.join(sessionStateDirectory(rootPath, sessionId), "current-role.json");
export const sessionLockOptions = sessionId => ({ timeoutMs: validateSessionId(sessionId) === undefined ? 0 : 5000 });
export function sessionArgument(argv = process.argv) {
  const index = argv.indexOf("--session");
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error("--session 必须提供有效的会话编号。");
  return validateSessionId(value);
}

export async function createSession({ rootPath, roleName }) {
  return withRootLock(rootPath, async () => {
    const selected = roleName === undefined ? undefined : await resolveRoleDirectory({ rootPath, roleReference: roleName });
    const sessionId = crypto.randomUUID();
    const directory = await boundedPath(rootPath, path.relative(rootPath, sessionStateDirectory(rootPath, sessionId)));
    await fs.mkdir(path.dirname(directory), { recursive: true });
    await fs.mkdir(directory);
    const payload = { sessionId, createdAt: new Date().toISOString(), ...(selected ? { role: selected.role } : {}) };
    await fs.writeFile(path.join(directory, "session.json"), `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx" });
    if (selected) await fs.writeFile(path.join(directory, "current-role.json"), `${JSON.stringify({ role: selected.role, updatedAt: payload.createdAt }, null, 2)}\n`, { flag: "wx" });
    return payload;
  }, { timeoutMs: 5000 });
}

export async function resolveRoleDirectory({ rootPath, roleReference }) {
  const normalizedReference = String(roleReference ?? "").trim();
  if (!normalizedReference) throw new Error("岗位名称不能为空。");
  const rolesPath = path.join(rootPath, "workflow", "roles");
  const entries = await fs.readdir(rolesPath, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") throw new Error("当前工作区尚未创建岗位目录。");
    throw error;
  });
  const roleNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const exact = roleNames.filter((name) => name === normalizedReference);
  if (exact.length === 1) return { role: exact[0], rolePath: path.join(rolesPath, exact[0]) };
  const partial = roleNames.filter((name) => name.includes(normalizedReference));
  if (partial.length === 0) throw new Error(`岗位不存在：${normalizedReference}。请新建岗位或选择已有岗位。`);
  if (partial.length > 1) throw new Error(`岗位名称匹配不唯一：${partial.join("、")}。请明确指定岗位。`);
  return { role: partial[0], rolePath: path.join(rolesPath, partial[0]) };
}

export async function resolveCurrentRole({ rootPath, sessionId, readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8")) }) {
  let state;
  try {
    state = await readJson(await boundedPath(rootPath, path.relative(rootPath, currentRolePath(rootPath, sessionId))));
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error("当前没有已选择的岗位。请先新建岗位或明确说“切换到某岗位”。");
    throw error;
  }
  const role = String(state?.role ?? "").trim();
  if (!role) throw new Error("当前岗位状态文件缺少岗位名称。请重新切换岗位。");
  return safeSegment(role, "岗位名称");
}

export async function getSelectedRole({ rootPath, sessionId }) {
  return resolveRoleDirectory({ rootPath, roleReference: await resolveCurrentRole({ rootPath, sessionId }) });
}

export async function setCurrentRole({ rootPath, role, sessionId }) {
  const normalizedRole = safeSegment(role, "岗位名称");
  if (!normalizedRole) throw new Error("岗位名称不能为空。");
  return withRootLock(rootPath, async () => {
  const payload = { role: normalizedRole, updatedAt: new Date().toISOString() };
  const target = await boundedPath(rootPath, path.relative(rootPath, currentRolePath(rootPath, sessionId)));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
  }, sessionLockOptions(sessionId));
}
