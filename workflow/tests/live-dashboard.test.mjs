import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import test from 'node:test';
import { liveFixture, eventually } from './live-fixture.mjs';
import { setCurrentRole } from '../scripts/agent-state.mjs';
import ExcelJS from 'exceljs';
import { parseCanonicalCsv } from '../scripts/live-review-source.mjs';

const module = await import('../scripts/serve-review-dashboard.mjs').catch(() => ({}));
const start = options => {
  assert.equal(typeof module.startLiveDashboard, 'function', 'live dashboard API must exist');
  return module.startLiveDashboard({ ...options, pollIntervalMs: 60 });
};
const data = server => fetch(server.url + '/data').then(response => response.json());

test('live CLI rejects an explicitly provided option with no value instead of changing the source silently', async () => {
  const fixture = await liveFixture(), originalArgv = process.argv;
  try {
    for (const flag of ['--source', '--role', '--privacy', '--port']) {
      process.argv = [process.execPath, 'serve-review-dashboard.mjs', '--root', fixture.rootPath, '--session', fixture.sessionId, flag];
      await assert.rejects(async () => { const server = await module.runCli(); await server?.close(); }, /必须提供参数/);
    }
  } finally { process.argv = originalArgv; await fixture.cleanup(); }
});

test('live ledger updates, retains last good on corrupt/locked reads, recovers and pins role without writes', async () => {
  const fixture = await liveFixture(); let server;
  try {
    const before = await fs.readFile(fixture.ledgerPath);
    server = await start(fixture);
    let current = await data(server);
    assert.equal(current.status, 'ok'); assert.equal(current.rows.length, 1);
    assert.doesNotMatch(JSON.stringify(current), /私密|TEST-/);
    assert.deepEqual(await fs.readFile(fixture.ledgerPath), before);
    await setCurrentRole({ rootPath: fixture.rootPath, sessionId: fixture.sessionId, role: '另一个岗位' });
    await fixture.write(2);
    await eventually(async () => (await data(server)).rows?.length === 2);
    current = await data(server); assert.equal(current.role, fixture.role);
    await fs.writeFile(fixture.ledgerPath, 'partial workbook');
    await eventually(async () => (await data(server)).status === 'error');
    const failed = await data(server);
    assert.equal(failed.version, current.version); assert.equal(failed.rows.length, 2);
    assert.doesNotMatch(JSON.stringify(failed), new RegExp(fixture.rootPath.replaceAll('\\', '\\\\')));
    const lock = path.join(fixture.rootPath, '.recruitment-agent', 'writer.lock');
    await fs.writeFile(lock, 'busy');
    await fixture.write(3);
    await eventually(async () => (await data(server)).status === 'waiting');
    assert.equal((await data(server)).rows.length, 2);
    await fs.rm(lock);
    await eventually(async () => (await data(server)).rows?.length === 3);
    await fixture.write(0);
    await eventually(async () => (await data(server)).rows?.length === 0);
  } finally { await server?.close(); await fixture.cleanup(); }
});

for (const extension of ['csv', 'xlsx']) test(`watches canonical ${extension}, validates corruption, and resumes`, async () => {
  const fixture = await liveFixture(); let server;
  try {
    const exported = await fixture.exportData(); const sourcePath = exported[extension + 'Path'];
    server = await start({ ...fixture, sourcePath });
    assert.equal((await data(server)).rows.length, 1);
    assert.doesNotMatch(JSON.stringify(await data(server)), /私密/);
    await fixture.write(2); await fixture.exportData();
    await eventually(async () => (await data(server)).rows?.length === 2);
    await fs.writeFile(sourcePath, 'not a canonical export');
    await eventually(async () => (await data(server)).status === 'error');
    assert.equal((await data(server)).rows.length, 2);
    await fixture.write(0); await fixture.exportData();
    await eventually(async () => (await data(server)).status === 'ok' && (await data(server)).rows.length === 0);
  } finally { await server?.close(); await fixture.cleanup(); }
});

test('capability endpoint rejects foreign hosts/origins, other routes/methods and closes port', async () => {
  const fixture = await liveFixture(); let server;
  try {
    server = await start(fixture);
    const url = new URL(server.url);
    assert.equal(url.hostname, '127.0.0.1'); assert.match(url.pathname, /^\/[a-f0-9]{48}$/);
    const response = await fetch(server.url);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    for (const route of ['/', '/candidate-ledger.xlsx', url.pathname + '/data?file=secret', url.pathname + '/other']) assert.equal((await fetch(url.origin + route)).status, 404);
    assert.equal((await fetch(server.url, { method: 'POST' })).status, 405);
    assert.equal((await fetch(server.url, { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal(await new Promise((resolve, reject) => { http.get(server.url, { headers: { Host: 'evil.example' } }, r => { r.resume(); resolve(r.statusCode); }).on('error', reject); }), 403);
    await server.close(); await server.close();
    await assert.rejects(fetch(server.url));
  } finally { await server?.close(); await fixture.cleanup(); }
});

test('invalid initial source yields actionable status and no filesystem path', async () => {
  const fixture = await liveFixture(); let server;
  try {
    server = await start({ ...fixture, sourcePath: path.join(fixture.rootPath, 'missing.csv') });
    const result = await data(server);
    assert.equal(result.status, 'error'); assert.equal(result.version, null);
    assert.match(result.message, /标准导出|检查/); assert.equal(result.rows, undefined);
  } finally { await server?.close(); await fixture.cleanup(); }
});

test('canonical CSV rejects malformed quoting and preserves multiline quoted cells', () => {
  assert.deepEqual(parseCanonicalCsv('\uFEFF"a","b"\r\n"x\n""y""","z"\r\n'), [['a', 'b'], ['x\n"y"', 'z']]);
  for (const input of ['"a', 'a"b,c', '"a"x,b']) assert.throws(() => parseCanonicalCsv(input));
});

test('canonical file validation rejects dates, missing values, duplicate rows/headers, formulas and operational ledgers', async () => {
  const fixture = await liveFixture(); let server;
  try {
    const exported = await fixture.exportData();
    server = await start({ ...fixture, sourcePath: exported.csvPath });
    const original = await fs.readFile(exported.csvPath, 'utf8');
    const lines = original.trimEnd().split('\r\n');
    for (const changed of [
      original.replace('2020-01-01', '2020-02-30'),
      original.replace('"员工推荐"', '""'),
      original.replace('"阶段状态"', '"主阶段"'),
      original.replace('"进行中"', '"不合法"'),
      [lines[0], lines[1], lines[1]].join('\r\n'),
      original.replace('"0-初筛"', '"9-不存在"'),
      original.replace('"' + fixture.role + '"', '"其他岗位"'),
    ]) {
      await fs.writeFile(exported.csvPath, changed);
      await eventually(async () => (await data(server)).status === 'error');
      assert.equal((await data(server)).rows.length, 1);
      await fs.writeFile(exported.csvPath, original);
      await eventually(async () => (await data(server)).status === 'ok');
    }
    await server.close();
    server = await start({ ...fixture, sourcePath: fixture.ledgerPath });
    assert.equal((await data(server)).status, 'error');
    await server.close();
    const book = new ExcelJS.Workbook(); await book.xlsx.readFile(exported.xlsxPath);
    book.worksheets[0].getCell('A2').value = { formula: '1', result: '0-初筛' };
    await book.xlsx.writeFile(exported.xlsxPath);
    server = await start({ ...fixture, sourcePath: exported.xlsxPath });
    assert.equal((await data(server)).status, 'error');
  } finally { await server?.close(); await fixture.cleanup(); }
});

test('explicit internal privacy preserves details, mismatched session role rejects, simultaneous requests use one consistent version', async () => {
  const fixture = await liveFixture(); let server;
  try {
    server = await start({ ...fixture, privacy: 'internal' });
    assert.match(JSON.stringify(await data(server)), /私密姓名0/);
    await fs.mkdir(path.join(fixture.rootPath, 'workflow', 'roles', '第二岗位'));
    await assert.rejects(start({ ...fixture, roleName: '第二岗位' }), /会话岗位/);
    await assert.rejects(start({ ...fixture, privacy: 'public' }), /privacy/);
    await fixture.write(3);
    const results = await Promise.all(Array.from({ length: 25 }, () => data(server)));
    for (const result of results) assert.ok(result.rows.length === 1 || result.rows.length === 3);
    for (const result of results) assert.equal(results.find(other => other.version === result.version).rows.length, result.rows.length);
    await eventually(async () => (await data(server)).rows.length === 3);
  } finally { await server?.close(); await fixture.cleanup(); }
});
