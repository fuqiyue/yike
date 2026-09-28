import { _electron as electron } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Synthetic records and an isolated profile; never reads real user material.
const root = path.resolve('.'), packaged = process.argv.includes('--packaged');
const evidence = path.join(root, '.desktop-tests', `opportunity-${packaged ? 'packaged-' : ''}${Date.now()}`);
const profile = path.join(evidence, 'profile');
const legacyRecords = [
  { kind: 'dossier', record: { id: 'legacy-dossier', title: '合成旧档案', body: '原有笔记', roles: ['工作'], taskIds: [], background: '测试背景', otherFacts: '一次已知交流', otherAssumptions: '待核实的合作', archived: false, updatedAt: '2026-09-28T00:00:00.000Z' } },
  { kind: 'periodic', record: { id: 'legacy-periodic', title: '合成季度房租', startDate: '2026-10-01', frequency: 'quarterly', amount: 2700, currency: 'CNY', notes: '原有周期信息', updatedAt: '2026-09-28T00:00:00.000Z' } },
];
await mkdir(path.join(profile, 'data', '计划', '资料'), { recursive: true });
await writeFile(path.join(profile, 'data', '计划', '资料', '变更.md'), legacyRecords.map(record => '- ' + JSON.stringify(record) + '\n').join(''));
const checks = [], errors = [], requests = [];
const mock = createServer(async (request, response) => {
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  requests.push({ body: JSON.parse(Buffer.concat(chunks).toString()), authenticated: request.headers.authorization === 'Bearer opportunity-synthetic-key' });
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ choices: [{ message: { content: '合成机会分析：已有样品可用于小规模演示。\n下一步：先核实对方预算与时间。\n【推测】若反馈积极，再研究合作范围。' }, finish_reason: 'stop' }] }));
});
await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${mock.address().port}/v1`;
const env = { ...process.env, YIJING_USER_DATA_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
const options = packaged || process.env.OPPORTUNITY_EXE
  ? { executablePath: process.env.OPPORTUNITY_EXE || path.join(root, 'dist/build/win-unpacked/Yike.exe'), args: ['--force-device-scale-factor=1'], env }
  : { executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root, '--force-device-scale-factor=1'], env };
let app, page;
async function launch() {
  app = await electron.launch(options); page = await app.firstWindow();
  app.process().stderr?.on('data', chunk => { appendFile(path.join(evidence, 'electron-stderr.log'), chunk).catch(() => {}); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
  await page.locator('#entry').waitFor();
}
async function api(url, payload) {
  return page.evaluate(async ({ url, payload }) => {
    const response = await fetch(url, payload === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return { status: response.status, data: await response.json() };
  }, { url, payload });
}
async function context() { return (await api('/api/context')).data; }
async function submit(selector, suffix = '/api/context') {
  const [response] = await Promise.all([page.waitForResponse(response => response.url().endsWith(suffix) && response.request().method() === 'POST'), page.locator(selector).click()]);
  assert.ok(response.ok(), await response.text()); await page.waitForTimeout(120);
  return response.json();
}
async function navigate(hash) { await page.evaluate(hash => { location.hash = hash; }, hash); await page.waitForTimeout(150); }
async function openOpportunities() { await navigate('analysis'); await page.locator('[data-analysis-view=opportunities]').click(); }
async function screenshot(width) {
  await page.setViewportSize({ width, height: 900 });
  await page.evaluate(() => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); return document.fonts.ready; });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${width} horizontal overflow`);
  if (!process.env.OPPORTUNITY_SKIP_SHOTS) {
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.show(); window.focus(); });
    await page.bringToFront();
    await page.screenshot({ path: path.join(evidence, `opportunity-${width}.png`), scale: 'css', animations: 'disabled', timeout: 15000 });
  }
}
try {
  await launch();
  const initial = await context(); assert.equal(initial.malformed, 0);
  await navigate('personal');
  assert.deepEqual(await page.locator('[data-personal]').evaluateAll(nodes => nodes.map(node => node.dataset.personal)), ['conditions', 'notes', 'periodic']);
  await page.locator('[data-personal=notes]').click();
  assert.equal(await page.locator('[data-dossier="legacy-dossier"]').isVisible(), true);
  await page.locator('[data-personal=periodic]').click();
  assert.equal(await page.locator('[data-edit-periodic="legacy-periodic"]').isVisible(), true);
  await page.locator('[data-personal=conditions]').click();
  assert.equal(await page.locator('#condition-grid').isVisible(), true);
  checks.push('个人情况三个顶层入口直接展示条件、原有笔记和周期信息');
  await navigate('settings');
  await page.locator('#ai-settings-form [name=baseUrl]').fill(baseUrl);
  await page.locator('#ai-settings-form [name=model]').fill('opportunity-synthetic-model');
  await page.locator('#ai-settings-form [name=apiKey]').fill('opportunity-synthetic-key');
  await page.locator('#ai-settings-form button').click();
  await page.waitForFunction(() => document.querySelector('#ai-config-status')?.textContent.includes('已保存'));
  await openOpportunities();
  await page.locator('#new-opportunity').click();
  await page.locator('#opportunity-form [name=title]').fill('合成机会：样品演示合作');
  await page.locator('#opportunity-form [name=body]').fill('已有样品，对方可能有演示需求，需要进一步核实。');
  await page.locator('#opportunity-form [name=nextStep]').fill('联系对方确认时间');
  await page.locator('#opportunity-form [name=source]').fill('合成交流记录');
  await page.locator('#opportunity-form [name=roles][value="工作"]').check();
  await submit('#opportunity-form button.primary');
  let state = await context();
  const first = state.opportunities.find(item => item.title === '合成机会：样品演示合作');
  assert.ok(first); assert.equal(first.nextStep, '联系对方确认时间');
  assert.equal(first.source, '合成交流记录'); assert.ok(first.roles.includes('工作'));
  await page.locator(`.opportunity-title[data-edit-opportunity="${first.id}"]`).click();
  await page.locator('#opportunity-form [name=nextStep]').fill('先核实预算，再预约演示');
  await page.locator('#opportunity-form [name=status]').selectOption('researching');
  await submit('#opportunity-form button.primary');
  assert.equal((await context()).opportunities.find(item => item.id === first.id).status, 'researching');
  await page.locator('#opportunity-role-filter').selectOption('家庭');
  assert.equal(await page.locator(`.opportunity-title[data-edit-opportunity="${first.id}"]`).count(), 0);
  await page.locator('#opportunity-role-filter').selectOption('工作');
  assert.equal(await page.locator(`.opportunity-title[data-edit-opportunity="${first.id}"]`).count(), 1);
  checks.push('机会新增、编辑、角色筛选，来源和下一步完整保存');

  await page.locator(`[data-analyze-opportunity="${first.id}"]`).click();
  assert.equal(await page.locator('#analysis-mode').inputValue(), 'opportunity');
  const preview = await submit('#analysis-form button.primary', '/api/analysis');
  assert.equal(requests.length, 0, 'Preview must not call model');
  assert.ok(JSON.stringify(preview.snapshot).includes(first.id));
  const countBeforeAnalysis = (await context()).opportunities.length;
  await submit('#generate-analysis', '/api/analysis');
  assert.equal(requests.length, 1); assert.equal(requests[0].authenticated, true);
  assert.equal((await context()).opportunities.length, countBeforeAnalysis, 'Analysis must not automatically create an opportunity');
  await page.locator('#save-as-opportunity').click();
  await page.locator('#opportunity-form').waitFor();
  assert.equal((await context()).opportunities.length, countBeforeAnalysis, 'Opening review form must not write');
  await page.locator('#opportunity-form [name=title]').fill('合成分析转为机会');
  await page.locator('#opportunity-form [name=nextStep]').fill('本周进行一次需求访谈');
  await page.locator('#opportunity-form [name=roles][value="工作"]').check();
  await submit('#opportunity-form button.primary');
  state = await context();
  const generated = state.opportunities.find(item => item.title === '合成分析转为机会');
  assert.ok(generated.analysisId); assert.ok(generated.body.includes('合成机会分析'));
  assert.equal(generated.nextStep, '本周进行一次需求访谈');
  assert.ok(generated.roles.includes('工作')); assert.ok(generated.source);
  checks.push('机会分析预览零网络，生成后显式确认表单才存为机会并保留分析来源');

  await openOpportunities();
  await page.locator('#opportunity-role-filter').selectOption('');
  await submit(`[data-opportunity-status="${first.id}"][data-next-status=archived]`);
  state = await context(); assert.equal(state.opportunities.find(item => item.id === first.id).status, 'archived');
  const archivedPreview = await api('/api/analysis', { action: 'prepare', mode: 'opportunity', opportunityId: first.id });
  assert.ok(archivedPreview.status >= 400, 'Archived opportunity must not be analyzable');
  await page.locator('#opportunity-status-filter').selectOption('archived');
  await submit(`[data-opportunity-status="${first.id}"][data-next-status=candidate]`);
  state = await context(); assert.equal(state.opportunities.find(item => item.id === first.id).status, 'candidate');
  const restoredPreview = await api('/api/analysis', { action: 'prepare', mode: 'opportunity', opportunityId: first.id });
  assert.equal(restoredPreview.status, 200);
  await page.locator('#opportunity-status-filter').selectOption('active');
  checks.push('归档机会排除分析，恢复后再次可分析');
  for (const width of [1280, 390]) await screenshot(width);

  await app.close(); app = undefined; await launch();
  state = await context();
  assert.equal(state.opportunities.length, 2);
  assert.equal(state.opportunities.find(item => item.id === first.id).nextStep, '先核实预算，再预约演示');
  assert.equal(state.opportunities.find(item => item.id === generated.id).analysisId, generated.analysisId);
  assert.deepEqual(state.dossiers, initial.dossiers);
  assert.deepEqual(state.periodicItems, initial.periodicItems);
  assert.deepEqual(errors, []);
  checks.push('重启后机会角色、来源、下一步及分析关联持久化，旧档案和周期无损');
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ passed: true, checks, errors, modelRequests: requests.length }, null, 2));
  console.log(evidence);
} catch (error) {
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ passed: false, checks, errors, failure: error.stack }, null, 2));
  console.error(evidence); throw error;
} finally {
  if (app) {
    await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) { window.webContents.removeAllListeners('will-prevent-unload'); window.webContents.on('will-prevent-unload', event => event.preventDefault()); } }).catch(() => {});
    await app.close();
  }
  await new Promise(resolve => mock.close(resolve));
}
