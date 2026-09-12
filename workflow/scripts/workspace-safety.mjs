import fs from 'node:fs/promises';
import path from 'node:path';

export function safeSegment(value, label = '名称') {
  const name = String(value ?? '');
  if (!name || name !== name.trim() || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || name === '.' || name === '..' || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)) throw new Error(`${label}不合法。`);
  return name;
}

// Reject links at every existing component, including links whose target is inside root:
// this also makes backup/restore destinations unambiguous.
export async function boundedPath(rootPath, ...parts) {
  const root = path.resolve(rootPath);
  const target = path.resolve(root, ...parts);
  const relative = path.relative(root, target);
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw new Error('目标路径不合法，超出工作区。');
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('目标路径不合法：不允许符号链接或目录联接。'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return target;
}

export async function withRootLock(rootPath, operation, { timeoutMs = 0 } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 5000) throw new Error('锁等待时间必须为 0–5000 毫秒。');
  const directory = await boundedPath(rootPath, '.recruitment-agent');
  await fs.mkdir(directory, { recursive: true });
  const lockPath = await boundedPath(rootPath, '.recruitment-agent', 'writer.lock');
  let handle;
  const deadline = performance.now() + timeoutMs;
  while (!handle) {
    try { handle = await fs.open(lockPath, 'wx'); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw new Error('另一个写入正在执行，或上次进程中断留下 writer.lock；请确认进程退出后重试。');
      await new Promise(resolve => setTimeout(resolve, Math.min(50, remaining)));
    }
  }
  try { await handle.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()})); return await operation(); }
  finally { await handle.close(); await fs.rm(lockPath, {force:true}); }
}
