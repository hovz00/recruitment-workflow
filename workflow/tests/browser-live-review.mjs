import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startLiveDashboard } from '../scripts/serve-review-dashboard.mjs';
import { liveFixture } from './live-fixture.mjs';

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE || import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  for (const source of ['ledger', 'csv', 'xlsx']) {
    const fixture = await liveFixture(); let server;
    const page = await browser.newPage();
    page.on('pageerror', error => errors.push(error.message));
    try {
      const exported = await fixture.exportData();
      const sourcePath = source === 'ledger' ? undefined : exported[source + 'Path'];
      const write = async count => { await fixture.write(count); if (sourcePath) await fixture.exportData(); };
      server = await startLiveDashboard({ ...fixture, sourcePath, pollIntervalMs: 60 });
      let navigations = 0; page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
      await page.goto(server.url);
      assert.equal(await page.locator('#liveReviewStatus').count(), 1, 'live status must be present');
      await page.waitForFunction(() => rawData.length === 1);
      assert.equal(await page.title(), fixture.role + '｜招聘数据复盘（实时）');
      assert.doesNotMatch(await page.content(), /私密姓名|私密备注|私密公司/);
      const initialVersion = await page.locator('#liveReviewStatus').getAttribute('data-version');
      await write(2);
      await page.waitForFunction(() => rawData.length === 2);
      assert.notEqual(await page.locator('#liveReviewStatus').getAttribute('data-version'), initialVersion);
      await fs.writeFile(sourcePath || fixture.ledgerPath, 'partial');
      await page.waitForFunction(() => document.getElementById('liveReviewStatus').dataset.state === 'error');
      assert.equal(await page.evaluate(() => rawData.length), 2);
      await write(3);
      await page.waitForFunction(() => rawData.length === 3);
      // A wizard pauses the live stream before any asynchronous file import starts.
      await page.locator('#topStageConfigAction').click();
      await page.waitForFunction(() => document.getElementById('liveReviewStatus').dataset.state === 'paused');
      await write(2);
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(() => rawData.length), 3);
      await page.locator('#liveReviewResume').click({ force: true });
      await page.waitForFunction(() => rawData.length === 2);
      // Manual upload is explicitly local. Resume must reapply even an unchanged version.
      await fixture.write(1); const manual = await fixture.exportData();
      const manualBytes = await fs.readFile(manual.csvPath);
      if (sourcePath) { await write(2); }
      await page.locator('#fileInput').setInputFiles({ name: 'manual.csv', mimeType: 'text/csv', buffer: manualBytes });
      await page.waitForFunction(() => rawData.length === 1 && document.getElementById('liveReviewStatus').dataset.state === 'paused');
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(() => rawData.length), 1);
      if (!sourcePath) await write(2);
      await page.locator('#liveReviewResume').click();
      await page.waitForFunction(() => rawData.length === 2);
      fixture.pipeline.stages.push({ id: 2, name: '入职', slaDays: 9 });
      await fs.writeFile(path.join(fixture.rolePath, 'PIPELINE.json'), JSON.stringify(fixture.pipeline));
      await write(2);
      await page.waitForFunction(() => rawData.length === 2 && STAGES_CONFIG.length === 3 && STAGES_CONFIG[2].slaDays === 9);
      await write(0);
      await page.waitForFunction(() => rawData.length === 0 && document.getElementById('liveReviewStatus').dataset.state === 'ok');
      assert.equal(await page.locator('#reviewRecordCount').textContent(), '0');
      assert.equal(navigations, 1, 'updates must not reload or navigate');
      await page.locator('#topUploadAction').click();
      await server.close();
      await page.waitForFunction(() => document.getElementById('liveReviewStatus').dataset.connection === 'disconnected');
      assert.match(await page.locator('#liveReviewStatus').textContent(), /连接.*失败|断开/);
      console.log(`Live browser verified: ${source} updates, recovery, pause/resume, empty data, disconnect.`);
    } finally { await page.close(); await server?.close(); await fixture.cleanup(); }
  }
  const fixture = await liveFixture(); let server;
  const page = await browser.newPage();
  try {
    await fs.writeFile(fixture.ledgerPath, 'partial at startup');
    server = await startLiveDashboard({ ...fixture, pollIntervalMs: 60 });
    await page.goto(server.url);
    await page.waitForFunction(() => document.getElementById('liveReviewStatus').dataset.state === 'error');
    assert.equal(await page.evaluate(() => rawData.length), 0);
    assert.equal(await page.locator('#stageConfigModal').evaluate(element => element.classList.contains('active')), false);
    await fixture.write(1);
    await page.waitForFunction(() => rawData.length === 1 && document.getElementById('liveReviewStatus').dataset.state === 'ok');
  } finally { await page.close(); await server?.close(); await fixture.cleanup(); }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
