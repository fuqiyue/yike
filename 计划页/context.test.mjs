import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestWorkspace } from './fsguard.mjs';
import { createContextStore } from './context.mjs';
import { createPlanServer } from './server.mjs';
import { createStore } from './store.mjs';

test('opportunities persist independently, support partial edits and reject stale or invented analysis sources', async t => {
  const fixture = await createTestWorkspace(); t.after(() => fixture.dispose());
  const context = createContextStore(fixture.guard, { snapshot: async () => { throw new Error('机会不能自动操作任务'); } });
  let state = await context.snapshot();
  assert.deepEqual(state.opportunities, []);
  const revision = state.revision;
  const record = { title: '行业咨询方向', body: '仍需验证的可能性', nextStep: '访谈一位从业者', roles: ['工作'], status: 'candidate', source: '朋友提及，尚未核实', analysisId: '' };
  state = await context.save({ kind: 'opportunity', expectedRevision: revision, record });
  const item = state.opportunities[0];
  assert.equal(item.body, record.body); assert.ok(item.updatedAt);
  await assert.rejects(context.save({ kind: 'opportunity', expectedRevision: revision, record: { id: item.id, status: 'researching' } }), { status: 409 });
  await assert.rejects(context.save({ kind: 'opportunity', expectedRevision: state.revision, record: { id: item.id, analysisId: 'invented' } }), { status: 400 });
  await context.saveAnalysis({ id: 'real-analysis', output: '候选方向', snapshot: {} });
  state = await context.save({ kind: 'opportunity', expectedRevision: state.revision, record: { id: item.id, status: 'researching', analysisId: 'real-analysis' } });
  assert.equal(state.opportunities[0].body, record.body); assert.equal(state.opportunities[0].analysisId, 'real-analysis');
  const restarted = createContextStore(fixture.guard, {});
  assert.equal((await restarted.snapshot()).opportunities[0].status, 'researching');
  state = await restarted.save({ kind: 'opportunity', expectedRevision: state.revision, record: { id: item.id, status: 'archived' } });
  assert.equal(state.opportunities[0].status, 'archived');
  assert.deepEqual(state.conditions, []); assert.deepEqual(state.dossiers, []); assert.deepEqual(state.periodicItems, []);
  assert.equal((await fixture.guard.readText('计划/资料/变更.md')).trim().split('\n').length, 3);
});

test('opportunity field validation is strict and analyses beyond visible history can remain linked', async t => {
  const fixture = await createTestWorkspace(); t.after(() => fixture.dispose());
  const context = createContextStore(fixture.guard, {});
  const state = await context.snapshot();
  const record = { title: '候选方向', body: '', roles: ['个人'], status: 'candidate' };
  for (const patch of [{ title: '两行\n标题' }, { title: 'x'.repeat(201) }, { body: 'x'.repeat(16001) }, { nextStep: 'x'.repeat(4001) }, { source: 'x'.repeat(2001) }, { roles: [] }, { roles: ['未创建'] }, { roles: ['个人', '个人'] }, { status: 'done' }, { source: {} }, { analysisId: '../bad' }, { taskId: 'none' }]) {
    await assert.rejects(context.save({ kind: 'opportunity', expectedRevision: state.revision, record: { ...record, ...patch } }), { status: 400 });
  }
  assert.equal((await context.snapshot()).revision, state.revision);
  for (let index = 0; index < 31; index++) {
    await fixture.seed(`计划/分析/${1700000000000 + index}-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.md`, '# 分析档案\n\n<!-- yike-analysis-v1 -->\n```json\n' + JSON.stringify({ id: `analysis-${index}`, output: '旧分析' }) + '\n```\n');
  }
  assert.equal((await context.snapshot()).analyses.some(item => item.id === 'analysis-0'), false);
  const saved = await context.save({ kind: 'opportunity', expectedRevision: state.revision, record: { ...record, analysisId: 'analysis-0' } });
  assert.equal(saved.opportunities[0].analysisId, 'analysis-0');
});

test('periodic items create, edit, delete and restart independently from tasks and AI', async t => {
  const fixture = await createTestWorkspace(); t.after(() => fixture.dispose());
  const context = createContextStore(fixture.guard, { snapshot: async () => { throw new Error('周期信息不能读取任务'); } });
  let state = await context.snapshot();
  const initialRevision = state.revision;
  state = await context.save({ kind: 'periodic', expectedRevision: state.revision, record: { title: '服务器续费', startDate: '2026-01-31', frequency: 'monthly', amount: 99.99, currency: 'CNY', notes: '独立周期备注' } });
  const item = state.periodicItems[0];
  assert.equal(item.title, '服务器续费'); assert.equal(item.deleted, false); assert.ok(item.updatedAt);
  assert.deepEqual(state.conditions, []); assert.deepEqual(state.dossiers, []); assert.deepEqual(state.analyses, []);
  await assert.rejects(context.save({ kind: 'periodic', expectedRevision: initialRevision, record: { id: item.id, amount: 110 } }), { status: 409 });
  state = await context.save({ kind: 'periodic', expectedRevision: state.revision, record: { id: item.id, amount: null, frequency: 'quarterly' } });
  assert.equal(state.periodicItems[0].amount, null); assert.equal(state.periodicItems[0].notes, '独立周期备注');
  const restarted = createContextStore(fixture.guard, {});
  assert.equal((await restarted.snapshot()).periodicItems[0].frequency, 'quarterly');
  state = await restarted.save({ kind: 'periodic', expectedRevision: state.revision, record: { id: item.id, deleted: true } });
  assert.deepEqual(state.periodicItems, []);
  const afterDelete = createContextStore(fixture.guard, {});
  assert.deepEqual((await afterDelete.snapshot()).periodicItems, []);
  await assert.rejects(afterDelete.save({ kind: 'periodic', expectedRevision: state.revision, record: { id: item.id, deleted: false } }), { status: 410 });
  const lines = (await fixture.guard.readText('计划/资料/变更.md')).trim().split('\n').map(line => JSON.parse(line.slice(2)));
  assert.equal(lines.length, 3); assert.equal(lines[2].record.deleted, true); assert.equal(lines[2].record.title, item.title);
});

test('periodic validation rejects invalid dates, amounts, currencies and fields without writes', async t => {
  const fixture = await createTestWorkspace(); t.after(() => fixture.dispose());
  const context = createContextStore(fixture.guard, {});
  const state = await context.snapshot();
  const record = { title: '有效标题', startDate: '2026-01-31', frequency: 'monthly', amount: null, currency: 'CNY', notes: '' };
  for (const patch of [{ amount: -1 }, { amount: 0.001 }, { amount: '100' }, { amount: 1000000001 }, { amount: Infinity }, { currency: 'JPY' }, { startDate: '2026-02-29' }, { startDate: '0000-01-01' }, { frequency: 'daily' }, { roles: ['工作'] }, { deleted: 'true' }, { deleted: true }, { title: '' }, { notes: 'x'.repeat(4001) }]) {
    await assert.rejects(context.save({ kind: 'periodic', expectedRevision: state.revision, record: { ...record, ...patch } }), { status: 400 });
  }
  assert.equal((await context.snapshot()).revision, state.revision);
  const saved = await context.save({ kind: 'periodic', expectedRevision: state.revision, record: { ...record, amount: 0, startDate: '2024-02-29', frequency: 'yearly' } });
  assert.equal(saved.periodicItems[0].amount, 0);
});

test('registered roles survive restart and task edits require registration; new tasks have quadrants', async t => {
  const fixture = await createTestWorkspace(); t.after(() => fixture.dispose());
  const store = createStore(fixture.guard);
  const context = createContextStore(fixture.guard, store);
  let state = await context.snapshot();
  state = await context.save({ kind: 'role', expectedRevision: state.revision, record: { name: '创业' } });
  assert.deepEqual(state.roles, ['家庭', '个人', '工作', '感情', '创业']);
  await assert.rejects(context.save({ kind: 'role', expectedRevision: state.revision, record: { name: '创业' } }), { status: 409 });
  const created = await store.event({ verb: '记', text: '调查行业' });
  assert.equal((await store.snapshot()).tasks[0].quadrant, 'q3');
  await assert.rejects(store.event({ verb: '记', text: '无分类', quadrant: null }), { status: 400 });
  await store.event({ verb: '改', id: created.id, text: '调查行业', body: '已有笔记', roles: ['创业'] });
  await assert.rejects(store.event({ verb: '改', id: created.id, text: '调查行业', body: '', roles: ['未创建'] }), { status: 400 });
  assert.deepEqual((await createStore(fixture.guard).snapshot()).tasks[0].roles, ['创业']);
  state = await context.save({ kind: 'dossier', expectedRevision: state.revision, record: { title: '公司', body: '零散信息', roles: ['创业'], taskIds: [], otherFacts: '旧对方事实', constraints: '旧约束' } });
  state = await context.save({ kind: 'dossier', expectedRevision: state.revision, record: { id: state.dossiers[0].id, title: '公司笔记', body: '新笔记', roles: ['创业'], taskIds: [] } });
  const restored = await createContextStore(fixture.guard, store).snapshot();
  assert.equal(restored.dossiers[0].otherFacts, '旧对方事实');
  assert.equal(restored.dossiers[0].constraints, '旧约束');
  assert.equal(restored.dossiers[0].body, '新笔记');
  assert.equal(restored.malformed, 0);
});
test('context edits persist, reject stale writes and invalid links', async t => {
  const fixture = await createTestWorkspace(); t.after(() => fixture.dispose());
  const tasks = { snapshot: async () => ({ tasks: [{ id: 'task1' }] }) };
  const context = createContextStore(fixture.guard, tasks);
  let state = await context.snapshot();
  const revision = state.revision;
  state = await context.save({ kind: 'condition', expectedRevision: revision, record: { roles: ['工作'], quadrant: 'internal_resource', text: '有工具\n有时间' } });
  assert.equal(state.conditions[0].text, '有工具\n有时间');
  await assert.rejects(context.save({ kind: 'condition', expectedRevision: revision, record: state.conditions[0] }), { status: 409 });
  state = await context.save({ kind: 'condition', expectedRevision: state.revision, record: { ...state.conditions[0], text: '已有资源', archived: true } });
  assert.equal(state.conditions[0].archived, true);
  const record = { title: '独立事件', roles: ['家庭'], taskIds: [] };
  state = await context.save({ kind: 'dossier', expectedRevision: state.revision, record });
  assert.equal(state.dossiers[0].title, '独立事件');
  await assert.rejects(context.save({ kind: 'dossier', expectedRevision: state.revision, record: { ...record, taskIds: ['missing'] } }), { status: 400 });
  assert.equal((await createContextStore(fixture.guard, tasks).snapshot()).dossiers.length, 1);
  await assert.rejects(fixture.guard.writeNew('知识库/知识卡00-总索引与定域路由.md', 'bad'), { code: 'EACCES' });
});
test('unterminated context tail is never committed or overwritten', async t => {
  const fixture = await createTestWorkspace(); t.after(() => fixture.dispose());
  const line = '- ' + JSON.stringify({ kind: 'condition', record: { id: 'torn', roles: ['个人'], quadrant: 'internal_resource', text: '未提交' } });
  await fixture.seed('计划/资料/变更.md', line);
  const context = createContextStore(fixture.guard, { snapshot: async () => ({ tasks: [] }) });
  const state = await context.snapshot();
  assert.equal(state.conditions.length, 0); assert.equal(state.malformed, 1);
  await assert.rejects(context.save({ kind: 'condition', expectedRevision: state.revision, record: { roles: ['个人'], quadrant: 'internal_resource', text: '新内容' } }), { status: 409 });
  assert.equal(await fixture.guard.readText('计划/资料/变更.md'), line);
});
test('context HTTP API enforces origins, methods, revision and AI configuration', async t => {
  const fixture = await createTestWorkspace(); t.after(() => fixture.dispose());
  const { server } = createPlanServer({ guard: fixture.guard });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  let response = await fetch(base + '/api/context');
  const state = await response.json(); assert.equal(response.status, 200);
  const payload = { kind: 'condition', expectedRevision: state.revision, record: { roles: ['个人'], quadrant: 'internal_resource', text: '测试条件' } };
  const post = (path, value, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });
  assert.equal((await post('/api/context', payload, { Origin: 'https://other.test' })).status, 403);
  assert.equal((await post('/api/context', payload)).status, 201);
  assert.equal((await post('/api/context', payload)).status, 409);
  assert.equal((await fetch(base + '/api/analysis')).status, 405);
  response = await post('/api/analysis', { action: 'generate', previewId: 'none' });
  assert.equal(response.status, 503); assert.match((await response.json()).error, /配置/);
});
