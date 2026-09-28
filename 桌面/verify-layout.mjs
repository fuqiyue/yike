import { _electron as electron } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile, appendFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { backupData } from './data.mjs';

// Every fixture, credential and model response in this script is synthetic.
// Never attach to the installed app or use its real profile.
const root = path.resolve('.');
const packaged = process.argv.includes('--packaged');
const evidence = path.join(root, '.desktop-tests', `layout-${packaged ? 'packaged-' : ''}${Date.now()}`);
const profile = path.join(evidence, 'profile');
await mkdir(profile, { recursive: true });
const legacyDossier = { id: 'legacy-company', title: '旧版公司档案', roles: ['工作'], taskIds: [], background: '公司基本信息：合成公司', goal: '了解合作方式', selfSituation: '已有一次交流', otherFacts: '对方明确表示需要演示', otherAssumptions: '尚不确定预算', progress: '等待合成材料', constraints: '仅作为测试', questions: '最终联系人是谁', archived: false, updatedAt: '2026-09-27T00:00:00.000Z' };
await mkdir(path.join(profile, 'data', '计划', '资料'), { recursive: true });
const legacyPeriodic = { id: 'layout-rent', title: '合成季度房租', startDate: '2026-10-01', frequency: 'quarterly', amount: 2700, currency: 'CNY', notes: '布局验收的周期信息', updatedAt: '2026-09-28T00:00:00.000Z' };
await writeFile(path.join(profile, 'data', '计划', '资料', '变更.md'), [{ kind: 'dossier', record: legacyDossier }, { kind: 'periodic', record: legacyPeriodic }].map(record => '- ' + JSON.stringify(record) + '\n').join(''));
const requests = [], checks = [], errors = [];
let responseContent = '合成分析：依据已记录事实，先核实资源和时间。';
const mock = createServer(async (req, res) => {
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    requests.push({ url: req.url, body: JSON.parse(Buffer.concat(chunks).toString()), authenticated: req.headers.authorization === 'Bearer layout-synthetic-key' });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: responseContent }, finish_reason: 'stop' }] }));
  } catch { res.writeHead(500); res.end('{}'); }
});
await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${mock.address().port}/v1`;
const env = { ...process.env, YIJING_USER_DATA_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
const options = packaged
  ? { executablePath: path.join(root, 'dist/build/win-unpacked/Yike.exe'), args: ['--force-device-scale-factor=1'], env }
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
async function submit(selector, suffix, expected) {
  const [response] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith(suffix) && response.request().method() === 'POST'),
    page.locator(selector).click(),
  ]);
  if (expected) assert.equal(response.status(), expected, await response.text());
  else assert.ok(response.ok(), await response.text());
  await page.waitForTimeout(100);
  return response.json();
}
async function navigate(hash) {
  await page.evaluate(hash => { location.hash = hash; }, hash);
  await page.waitForTimeout(150);
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
}
async function assertPersonalNavigation() {
  const buttons = page.locator('[data-personal]');
  assert.deepEqual(await buttons.evaluateAll(nodes => nodes.map(node => node.dataset.personal)), ['conditions', 'notes', 'periodic']);
  assert.deepEqual((await buttons.allTextContents()).map(text => text.trim()), ['个人条件', '笔记档案', '周期信息']);
  assert.equal(await page.locator('[data-dossier-view]').count(), 0, 'No second-level archive navigation');
  for (const [value, target] of [['conditions', '#condition-grid'], ['notes', '#dossier-list'], ['periodic', '#periodic-list']]) {
    await page.locator(`[data-personal=${value}]`).click();
    assert.equal(await page.locator(target).isVisible(), true, `${value} directly reachable`);
  }
  await page.locator('[data-personal=conditions]').click();
}
async function shot(route, width) {
  await page.setViewportSize({ width, height: 900 }); await navigate(route);
  await capture(route, width, !!process.env.LAYOUT_SKIP_BASE_SHOTS);
}
async function capture(name, width, skip = false) {
  await page.evaluate(() => document.fonts.ready);
  if (name === 'plan') assert.equal(await page.locator('.quadrant-section').evaluate(node => getComputedStyle(node).marginBottom), '32px', 'Scoped spacing tokens remain available in unified app');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${name} ${width} overflow`);
  if (!process.env.LAYOUT_SKIP_SHOTS && !skip) {
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.show(); window.focus(); });
    await page.bringToFront();
    await page.screenshot({ path: path.join(evidence, `${name}-${width}.png`), scale: 'css', animations: 'disabled', timeout: 15000 });
  }
}
try {
  await launch();
  const initialContext = (await api('/api/context')).data;
  assert.equal(initialContext.malformed, 0);
  assert.equal(initialContext.dossiers[0].otherFacts, legacyDossier.otherFacts);
  checks.push('旧版档案可直接回放，已知事实与猜测保留');
  await navigate('settings');
  await page.locator('#ai-settings-form [name=baseUrl]').fill(baseUrl);
  await page.locator('#ai-settings-form [name=model]').fill('layout-synthetic-model');
  await page.locator('#ai-settings-form [name=apiKey]').fill('layout-synthetic-key');
  await page.locator('#ai-settings-form button').click();
  await page.waitForFunction(() => document.querySelector('#ai-config-status')?.textContent.includes('已保存'));
  assert.ok(!(await readFile(path.join(profile, 'ai-settings.json'), 'utf8')).includes('layout-synthetic-key'));
  checks.push('独立配置模拟模型，密钥加密保存');

  // Test invalid batches through the public endpoint: one valid item followed by
  // an invalid item must not append the valid prefix or the import source.
  const beforeInvalid = (await api('/api/context')).data;
  const invalidPreview = await api('/api/analysis', { action: 'prepare-conditions', text: '每周有两晚可用于学习，另外一条需要确认。', role: '个人' });
  assert.equal(invalidPreview.status, 200);
  assert.equal(requests.length, 0, 'Preparing conditions must be local');
  responseContent = JSON.stringify({ conditions: [{ roles: ['个人'], quadrant: 'internal_resource', text: '每周有两晚可用于学习' }, { roles: ['个人'], quadrant: 'invalid', text: '不可写入的条件' }] });
  const invalidWrite = await api('/api/analysis', { action: 'write-conditions', previewId: invalidPreview.data.previewId });
  assert.ok(invalidWrite.status >= 400);
  const afterInvalid = (await api('/api/context')).data;
  assert.equal(afterInvalid.revision, beforeInvalid.revision);
  assert.equal(afterInvalid.conditions.length, beforeInvalid.conditions.length);
  assert.equal(afterInvalid.conditionImports.length, beforeInvalid.conditionImports.length);
  checks.push('AI 批次含一条无效记录时，条件和来源均零部分写入');

  await navigate('personal');
  await assertPersonalNavigation();
  await page.locator('#add-role').click();
  await page.locator('#role-form [name=name]').fill('创业者');
  await submit('#role-form button.primary', '/api/context');
  await page.locator('[data-role="创业者"]').waitFor();
  assert.ok((await api('/api/context')).data.roles.includes('创业者'));
  await page.locator('#ai-condition').click();
  await page.locator('#condition-ai-form [name=role]').selectOption('创业者');
  await page.locator('#condition-ai-form [name=text]').fill('已有可演示的样品，合作预算尚未确定。');
  const countBeforePreview = requests.length;
  await submit('#condition-ai-form button.primary', '/api/analysis');
  assert.equal(requests.length, countBeforePreview);
  responseContent = JSON.stringify({ conditions: [{ roles: ['创业者'], quadrant: 'internal_resource', text: '已有可演示的样品' }, { roles: ['创业者'], quadrant: 'external_risk', text: '合作预算尚未确定' }] });
  await submit('#write-conditions', '/api/analysis');
  await page.locator('#editor-dialog').waitFor({ state: 'hidden' });
  assert.equal((await api('/api/context')).data.conditions.length, 2);
  await page.locator('#ai-condition').click();
  await page.locator('#condition-ai-form [name=text]').fill('家人可以帮助照顾孩子；目前每周只有两晚可以学习。');
  assert.equal(await page.locator('#condition-ai-form [name=role]').inputValue(), '');
  await submit('#condition-ai-form button.primary', '/api/analysis');
  responseContent = JSON.stringify({ conditions: [{ roles: ['家庭'], quadrant: 'external_support', text: '家人可以帮助照顾孩子' }, { roles: ['个人'], quadrant: 'internal_limit', text: '每周只有两晚可以学习' }] });
  await submit('#write-conditions', '/api/analysis');
  await page.locator('#editor-dialog').waitFor({ state: 'hidden' });
  checks.push('新增角色，AI 指定角色和自动多角色写入，预览不发请求');

  await page.locator('[data-personal=notes]').click();
  await page.locator('[data-dossier="legacy-company"]').click();
  await page.locator('#dossier-form [name=body]').fill('新的笔记：记录与合成公司的交集。');
  await submit('#dossier-form button.primary', '/api/context');
  const migrated = (await api('/api/context')).data.dossiers.find(d => d.id === 'legacy-company');
  for (const key of ['background', 'goal', 'selfSituation', 'otherFacts', 'otherAssumptions', 'progress', 'constraints', 'questions']) assert.equal(migrated[key], legacyDossier[key]);
  await page.locator('#new-dossier').click();
  await page.locator('#dossier-form [name=title]').fill('合成行业笔记');
  await page.locator('#dossier-form [name=body]').fill('行业信息比较零散。\n已知：目前有一次交流。\n待核实：是否存在合作机会。');
  await page.locator('#dossier-form [name=roles][value="创业者"]').check();
  await submit('#dossier-form button.primary', '/api/context');
  checks.push('笔记档案在个人情况右侧分类，修改后旧档案八项信息保留');

  await navigate('plan');
  assert.equal(await page.locator('#new-dossier').count(), 0);
  await page.locator('#entry').fill('合成任务：演示产品样品');
  await page.locator('#entry-quadrant').selectOption('q1');
  await submit('#entry-form button', '/api/event');
  await page.locator('[data-edit-task]').first().click();
  await page.locator('#task-form [name=body]').fill('备注：先确认对方时间，再安排演示。');
  await page.locator('#task-form [name=roles][value="创业者"]').check();
  await submit('#task-form button.primary', '/api/event');
  assert.equal(await page.locator('#legacy-form, #note-form').count(), 0);
  await page.locator('[data-quadrant=q2]').click();
  assert.equal(await page.locator('[data-edit-task]').count(), 0);
  await page.locator('[data-quadrant=q1]').click();
  assert.equal(await page.locator('[data-edit-task]').count(), 1);
  assert.ok(await page.locator('[data-quadrant=q1]').evaluate(el => el.getBoundingClientRect().top < document.querySelector('[data-tab=now]').getBoundingClientRect().top));
  const tasks = (await api('/api/open')).data;
  assert.equal(tasks[0].quadrant, 'q1'); assert.ok(tasks[0].roles.includes('创业者'));
  checks.push('任务必填象限位于状态上方且可筛选，任务备注编辑保留自定义角色');

  await navigate('analysis');
  await page.locator('#analysis-mode').selectOption('all');
  await page.locator('#analysis-form [name=role]').selectOption('创业者');
  let preview = await submit('#analysis-form button', '/api/analysis');
  assert.equal(preview.snapshot.role, '创业者');
  assert.equal(preview.snapshot.tasks.length, 1);
  assert.ok(preview.snapshot.conditions.every(c => c.roles.includes('创业者')));
  const beforeAnalysis = requests.length;
  responseContent = '合成分析：结合样品资源与待核实预算，先安排一次小规模演示。<script>window.injected=true</script>';
  await submit('#generate-analysis', '/api/analysis');
  assert.equal(requests.length, beforeAnalysis + 1);
  assert.equal(requests.at(-1).authenticated, true);
  assert.equal(JSON.parse(requests.at(-1).body.messages[1].content).role, '创业者');
  assert.equal(await page.evaluate(() => window.injected), undefined);
  for (const mode of ['task', 'all', 'future', 'dossier']) {
    await page.locator('#analysis-mode').selectOption(mode);
    assert.equal(await page.locator('#analysis-form [name=role]').isVisible(), true);
    await page.locator('#analysis-form [name=role]').selectOption('');
    preview = await submit('#analysis-form button', '/api/analysis');
    assert.ok(!preview.snapshot.role);
  }
  checks.push('四种分析范围独立选择角色或不限角色，模型请求采用预览角色和材料');
  const nav = await page.locator('.hub-nav a').allTextContents();
  assert.ok(nav.findIndex(x => x.includes('分析')) < nav.findIndex(x => x.includes('学习与查阅')));
  assert.ok(nav.findIndex(x => x.includes('学习与查阅')) < nav.findIndex(x => x.includes('设置')));
  if (!process.env.LAYOUT_PERSONAL_ONLY) for (const width of [1280, 390]) for (const route of ['plan', 'personal', 'analysis']) await shot(route, width);
  await navigate('personal'); await page.locator('[data-personal=conditions]').click();
  await page.locator('[data-role="创业者"]').click();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const section of ['conditions', 'notes', 'periodic']) {
      await page.locator(`[data-personal=${section}]`).click();
      await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
      await capture(section, width);
    }
  }
  if (!process.env.LAYOUT_PERSONAL_ONLY) {
    await page.locator('[data-personal=conditions]').click();
    await page.locator('#ai-condition').click();
    await capture('ai-write-dialog', 390);
    await page.locator('[data-close-dialog]').click();
  }
  checks.push('个人条件、笔记档案、周期信息三个顶层入口可直接访问，六个代表视图无横向溢出');
  checks.push('六个桌面/窄屏视图无横向溢出，学习与查阅位于分析和设置之间');

  await app.close(); app = undefined; await launch();
  const persisted = (await api('/api/context')).data;
  assert.ok(persisted.roles.includes('创业者'));
  assert.equal(persisted.conditions.length, 4);
  assert.equal(persisted.dossiers.length, 2);
  assert.equal(persisted.analyses.length, 1);
  assert.equal(persisted.conditionImports.length, 2);
  assert.deepEqual(persisted.periodicItems, initialContext.periodicItems);
  assert.equal((await api('/api/open')).data[0].body, '备注：先确认对方时间，再安排演示。');
  assert.deepEqual(errors, []);
  checks.push('重启后角色、条件及 AI 来源、档案、任务备注和分析均持久化');
  await app.close(); app = undefined;
  await mkdir(path.join(evidence, 'backup'), { recursive: true });
  await backupData(path.join(profile, 'data'), path.join(evidence, 'backup'));
  const backupFiles = await readdir(path.join(evidence, 'backup'), { recursive: true });
  const contextFile = backupFiles.find(file => file.includes('资料') && file.endsWith('.md'));
  assert.ok(contextFile);
  const backupContext = await readFile(path.join(evidence, 'backup', contextFile), 'utf8');
  assert.ok(backupContext.includes('创业者') && backupContext.includes('合成行业笔记'));
  assert.ok(!backupFiles.some(file => file.includes('ai-settings')));
  checks.push('备份包含自定义角色、AI 条件来源和笔记档案，不含模型密钥');
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
