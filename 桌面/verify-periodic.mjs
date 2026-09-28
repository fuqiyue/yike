import { _electron as electron } from 'playwright-core';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Synthetic profile only. This script neither opens the installed application
// nor configures a real model service.
const root = path.resolve('.');
const packaged = process.argv.includes('--packaged');
const evidence = path.join(root, '.desktop-tests', `periodic-${packaged ? 'packaged-' : ''}${Date.now()}`);
const profile = path.join(evidence, 'profile');
const legacy = { id: 'legacy-periodic-check', title: '原有公司资料', body: '原有笔记必须保留', roles: ['工作'], taskIds: [], background: '合成公司背景', otherFacts: '已进行一次交流', otherAssumptions: '尚未确定合作', archived: false, updatedAt: '2026-09-28T00:00:00.000Z' };
await mkdir(path.join(profile, 'data', '计划', '资料'), { recursive: true });
await writeFile(path.join(profile, 'data', '计划', '资料', '变更.md'), '- ' + JSON.stringify({ kind: 'dossier', record: legacy }) + '\n');
const env = { ...process.env, YIJING_USER_DATA_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
const launchOptions = packaged || process.env.PERIODIC_EXE
  ? { executablePath: process.env.PERIODIC_EXE || path.join(root, 'dist/build/win-unpacked/Yike.exe'), args: ['--force-device-scale-factor=1'], env }
  : { executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root, '--force-device-scale-factor=1'], env };
let app, page, acceptNextConfirm = false;
const checks = [], errors = [], dialogs = [], outsideRequests = [];
async function launch() {
  app = await electron.launch(launchOptions); page = await app.firstWindow();
  app.process().stderr?.on('data', chunk => { appendFile(path.join(evidence, 'electron-stderr.log'), chunk).catch(() => {}); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url()) && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(request.url()).hostname)) outsideRequests.push(request.url()); });
  page.on('dialog', dialog => { dialogs.push({ type: dialog.type(), message: dialog.message(), accepted: acceptNextConfirm }); const accepted = acceptNextConfirm; acceptNextConfirm = false; (accepted ? dialog.accept() : dialog.dismiss()).catch(() => {}); });
  await page.locator('#entry').waitFor();
}
async function context() { return page.evaluate(async () => (await fetch('/api/context')).json()); }
async function submit(selector) {
  const [response] = await Promise.all([page.waitForResponse(response => response.url().endsWith('/api/context') && response.request().method() === 'POST'), page.locator(selector).click()]);
  assert.ok(response.ok(), await response.text());
  await page.waitForTimeout(100);
  return response.json();
}
async function openPeriodic() {
  await page.evaluate(() => { location.hash = 'personal'; });
  assert.deepEqual(await page.locator('[data-personal]').evaluateAll(nodes => nodes.map(node => node.dataset.personal)), ['conditions', 'notes', 'periodic']);
  assert.equal(await page.locator('[data-dossier-view]').count(), 0);
  await page.locator('[data-personal=periodic]').click();
}
async function screenshot(width) {
  await page.setViewportSize({ width, height: 900 });
  await page.evaluate(() => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); return document.fonts.ready; });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${width} horizontal overflow`);
  if (!process.env.PERIODIC_SKIP_SHOTS) {
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.show(); window.focus(); });
    await page.bringToFront();
    await page.screenshot({ path: path.join(evidence, `periodic-${width}.png`), scale: 'css', animations: 'disabled', timeout: 15000 });
  }
}
try {
  await launch();
  const before = await context(); assert.equal(before.malformed, 0);
  await openPeriodic();
  await page.locator('#new-periodic').click();
  await page.locator('#periodic-form [name=title]').fill('合成房租');
  await page.locator('#periodic-form [name=startDate]').fill('2026-10-01');
  await page.locator('#periodic-form [name=frequency]').selectOption('quarterly');
  await page.locator('#periodic-form [name=amount]').fill('2700');
  await page.locator('#periodic-form [name=notes]').fill('合成验收：每季度记录一次房租。');
  await submit('#periodic-form button.primary');
  let state = await context();
  const rentId = state.periodicItems.find(item => item.title === '合成房租').id;
  assert.equal(state.periodicItems[0].amount, 2700);
  assert.equal(state.periodicItems[0].frequency, 'quarterly');
  await page.locator('#new-periodic').click();
  await page.locator('#periodic-form [name=title]').fill('合成会员');
  await page.locator('#periodic-form [name=startDate]').fill('2026-10-03');
  await page.locator('#periodic-form [name=frequency]').selectOption('monthly');
  await submit('#periodic-form button.primary');
  state = await context();
  const membershipId = state.periodicItems.find(item => item.title === '合成会员').id;
  assert.equal(state.periodicItems.find(item => item.id === membershipId).amount, null);
  checks.push('从个人情况档案分类新增季度房租和无金额月度会员');

  await page.locator(`[data-edit-periodic="${rentId}"]`).click();
  await page.locator('#periodic-form [name=amount]').fill('2800');
  await page.locator('#periodic-form [name=startDate]').fill('2026-10-05');
  await submit('#periodic-form button.primary');
  state = await context();
  assert.equal(state.periodicItems.find(item => item.id === rentId).amount, 2800);
  assert.equal(state.periodicItems.find(item => item.id === rentId).startDate, '2026-10-05');
  checks.push('周期记录金额和起始日期可以修改');
  for (const width of [1280, 390]) await screenshot(width);

  const revisionBeforeCancel = (await context()).revision;
  await page.locator(`[data-delete-periodic="${membershipId}"]`).click();
  assert.equal((await context()).revision, revisionBeforeCancel);
  assert.ok((await context()).periodicItems.some(item => item.id === membershipId));
  assert.equal(dialogs.at(-1)?.accepted, false);
  acceptNextConfirm = true;
  await submit(`[data-delete-periodic="${membershipId}"]`);
  state = await context();
  assert.ok(!state.periodicItems.some(item => item.id === membershipId));
  checks.push('取消删除保留记录，确认删除移除指定周期记录');
  await app.close(); app = undefined; await launch();
  state = await context();
  assert.equal(state.periodicItems.length, 1);
  assert.equal(state.periodicItems[0].id, rentId);
  assert.equal(state.periodicItems[0].amount, 2800);
  assert.equal(state.periodicItems[0].startDate, '2026-10-05');
  assert.deepEqual(state.dossiers, before.dossiers);
  assert.deepEqual(errors, []); assert.deepEqual(outsideRequests, []);
  checks.push('重启保留修改及删除结果，旧档案无损，无页面异常或外部网络请求');
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ passed: true, checks, errors, dialogs, outsideRequests }, null, 2));
  console.log(evidence);
} catch (error) {
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ passed: false, checks, errors, failure: error.stack }, null, 2));
  console.error(evidence); throw error;
} finally {
  if (app) {
    await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) { window.webContents.removeAllListeners('will-prevent-unload'); window.webContents.on('will-prevent-unload', event => event.preventDefault()); } }).catch(() => {});
    await app.close();
  }
}
