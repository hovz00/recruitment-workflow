import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildLedger } from '../scripts/create-role-ledger.mjs';
import { createSession } from '../scripts/agent-state.mjs';
import { exportReviewData } from '../scripts/export-review-data.mjs';

export async function liveFixture() {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-live-'));
  const role = '临时验证岗位';
  const rolePath = path.join(rootPath, 'workflow', 'roles', role);
  await fs.mkdir(rolePath, { recursive: true });
  const pipeline = { stages: [{ id: 0, name: '初筛', slaDays: 2 }, { id: 1, name: '面试', slaDays: 4 }] };
  await fs.writeFile(path.join(rolePath, 'PIPELINE.json'), JSON.stringify(pipeline));
  const ledgerPath = path.join(rolePath, 'candidate-ledger.xlsx');
  async function write(count) {
    const book = await buildLedger(role, pipeline, { capacity: 5 });
    const sheet = book.getWorksheet('候选人台账');
    const headers = sheet.getRow(3).values.slice(1);
    for (let i = 0; i < count; i++) {
      const row = { '候选人ID': `TEST-${i}`, '姓名': `私密姓名${i}`, '主阶段': '0-初筛', '阶段状态': '进行中', '简历收取时间': '2020-01-01', '简历来源': '员工推荐', '备注': '私密备注', '当前公司': '私密公司' };
      for (const [key, value] of Object.entries(row)) sheet.getCell(i + 4, headers.indexOf(key) + 1).value = value;
    }
    await book.xlsx.writeFile(ledgerPath);
  }
  await write(1);
  const { sessionId } = await createSession({ rootPath, roleName: role });
  return { rootPath, role, rolePath, ledgerPath, sessionId, pipeline, write,
    exportData: () => exportReviewData({ ledgerPath, role, outputDir: path.join(rootPath, 'exports'), privacy: 'internal' }),
    cleanup: () => fs.rm(rootPath, { recursive: true, force: true }) };
}
export async function eventually(check, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for live update');
}
