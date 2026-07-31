import fs from "node:fs/promises";
import path from "node:path";

export const stateDirectory = (rootPath) => path.join(rootPath, ".recruitment-agent");
export const currentRolePath = (rootPath) => path.join(stateDirectory(rootPath), "current-role.json");

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

export async function resolveCurrentRole({ rootPath, readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8")) }) {
  let state;
  try {
    state = await readJson(currentRolePath(rootPath));
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error("当前没有已选择的岗位。请先新建岗位或明确说“切换到某岗位”。");
    throw error;
  }
  const role = String(state?.role ?? "").trim();
  if (!role) throw new Error("当前岗位状态文件缺少岗位名称。请重新切换岗位。");
  return role;
}

export async function getSelectedRole({ rootPath }) {
  return resolveRoleDirectory({ rootPath, roleReference: await resolveCurrentRole({ rootPath }) });
}

export async function setCurrentRole({ rootPath, role }) {
  const normalizedRole = String(role ?? "").trim();
  if (!normalizedRole) throw new Error("岗位名称不能为空。");
  await fs.mkdir(stateDirectory(rootPath), { recursive: true });
  const payload = { role: normalizedRole, updatedAt: new Date().toISOString() };
  await fs.writeFile(currentRolePath(rootPath), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}
