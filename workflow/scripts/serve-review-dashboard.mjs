import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { getSelectedRole, resolveRoleDirectory, sessionArgument } from './agent-state.mjs';
import { formalDashboardTemplate } from './create-review-dashboard.mjs';
import { readLiveSource, liveVersion } from './live-review-source.mjs';

export async function startLiveDashboard({ rootPath, sessionId, roleName, sourcePath, privacy = 'redacted', port = 0, pollIntervalMs = 2000 }) {
  if (!rootPath) throw new Error('请提供 --root 工作区目录。');
  if (!['redacted', 'internal'].includes(privacy)) throw new Error('privacy 必须为 redacted 或 internal。');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('port 必须为 0–65535 的整数。');
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 50 || pollIntervalMs > 60000) throw new Error('pollIntervalMs 必须为 50–60000 的整数。');
  rootPath = path.resolve(rootPath);
  const selected = await getSelectedRole({ rootPath, sessionId });
  if (roleName && (await resolveRoleDirectory({ rootPath, roleReference: roleName })).role !== selected.role) throw new Error('--role 必须与所选会话岗位一致。');
  if (sourcePath) {
    sourcePath = path.resolve(rootPath, sourcePath);
    if (!['.csv', '.xlsx'].includes(path.extname(sourcePath).toLowerCase())) throw new Error('--source 仅支持标准导出 CSV 或 XLSX。');
  }
  const options = { rootPath, ...selected, sourcePath, privacy };
  let state = { status: 'waiting', message: '正在读取指定源。', version: null, role: selected.role, privacy, source: sourcePath ? 'export' : 'ledger', updatedAt: null };
  let stopped = false, timer, running;
  async function refresh() {
    try {
      const result = await readLiveSource(options);
      if (stopped) return;
      const version = liveVersion(result);
      state = { ...state, ...result, version, updatedAt: version === state.version ? state.updatedAt : new Date().toISOString(), status: 'ok', message: '已连接指定源。' };
    } catch (error) {
      if (stopped) return;
      const waiting = error.code === 'LIVE_WAITING';
      state = { ...state, status: waiting ? 'waiting' : 'error', message: waiting ? '源正在写入或写锁占用，保留最近有效视图并等待。' : '读取失败，保留最近有效视图。请检查指定文件可读、数据完整、表头/岗位/阶段/日期正确且无重复；外部文件须由 export-review-data.mjs 标准导出。' };
    }
  }
  await refresh();
  const tokenPath = '/' + crypto.randomBytes(24).toString('hex');
  const html = await fs.readFile(formalDashboardTemplate, 'utf8');
  const clientPath = new URL('./live-review-client.mjs', import.meta.url);
  const client = await fs.readFile(clientPath, 'utf8');
  const config = JSON.stringify({ endpoint: tokenPath + '/data', pollIntervalMs, role: selected.role, source: sourcePath ? 'export' : 'ledger' }).replaceAll('<', '\\u003c');
  const page = html.replace('</body>', `<script>const LIVE_REVIEW_CONFIG = ${config};\n${client}\n</script></body>`);
  let origin;
  const server = http.createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    const reply = (status, value, type = 'text/plain; charset=utf-8') => { response.writeHead(status, { 'Content-Type': type }); response.end(value); };
    if (request.headers.host !== origin?.slice(7) || (request.headers.origin !== undefined && request.headers.origin !== origin)) return reply(403, 'Forbidden');
    if (request.method !== 'GET') return reply(405, 'Method not allowed');
    if (request.url === tokenPath) return reply(200, page, 'text/html; charset=utf-8');
    if (request.url === tokenPath + '/data') return reply(200, JSON.stringify(state), 'application/json; charset=utf-8');
    reply(404, 'Not found');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  function schedule() {
    if (stopped) return;
    timer = setTimeout(() => { running = refresh().finally(schedule); }, pollIntervalMs);
  }
  schedule();
  let closing;
  return { url: origin + tokenPath, close() {
    if (!closing) {
      stopped = true; clearTimeout(timer);
      closing = (async () => {
        const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        server.closeAllConnections();
        await Promise.all([closed, running]);
      })();
    }
    return closing;
  } };
}

export async function runCli() {
  const argument = name => {
    const index = process.argv.indexOf(name);
    if (index < 0) return undefined;
    const value = process.argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} 必须提供参数。`);
    return value;
  };
  const usage = 'node workflow/scripts/serve-review-dashboard.mjs --root <工作区> --session <会话编号> [--role <岗位>] [--source <标准导出.csv|.xlsx>] [--privacy redacted|internal] [--port 0]';
  if (process.argv.includes('--help') || process.argv.includes('-h')) return console.log(usage);
  if (!argument('--root')) throw new Error(usage);
  const server = await startLiveDashboard({ rootPath: argument('--root'), sessionId: sessionArgument(), roleName: argument('--role'), sourcePath: argument('--source'), privacy: argument('--privacy'), port: Number(argument('--port') || 0) });
  console.log(`实时看板：${server.url}\n固定启动岗位；${argument('--source') ? '持续读取指定标准导出文件' : '持续读取岗位台账'}。手动上传仅改变当前预览；Ctrl+C 停止服务。`);
  const stop = async () => { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); await server.close(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  return server;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await runCli();
