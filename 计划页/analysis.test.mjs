import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestWorkspace } from './fsguard.mjs';
import { createContextStore } from './context.mjs';
import { createAnalysis } from './analysis.mjs';

test('opportunity analysis scopes hypotheses and freezes the visible input without creating tasks or opportunities', async t => {
  const fixture = await createTestWorkspace(); t.after(() => fixture.dispose());
  await fixture.seed('知识库/知识卡00-总索引与定域路由.md', '定域');
  const store = { snapshot: async () => ({ tasks: [{ id: 'work', text: '工作任务', roles: ['工作'], done: false }, { id: 'home', text: '家庭任务', roles: ['家庭'], done: false }, { id: 'done', text: '已完成任务', roles: ['工作'], done: true }] }) };
  const context = createContextStore(fixture.guard, store);
  let state = await context.snapshot();
  for (const role of ['工作', '家庭']) {
    state = await context.save({ kind: 'condition', expectedRevision: state.revision, record: { roles: [role], quadrant: 'internal_resource', text: `${role}资源` } });
    state = await context.save({ kind: 'dossier', expectedRevision: state.revision, record: { title: `${role}档案`, roles: [role], taskIds: [] } });
    state = await context.save({ kind: 'opportunity', expectedRevision: state.revision, record: { title: `${role}可能性`, body: '待验证假设', roles: [role], source: '旧消息，不代表有效' } });
  }
  state = await context.save({ kind: 'opportunity', expectedRevision: state.revision, record: { title: '已归档方向', roles: ['工作'], status: 'archived' } });
  const opportunity = state.opportunities.find(item => item.roles[0] === '工作' && item.status === 'candidate');
  let calls = 0, received;
  const run = createAnalysis({ guard: fixture.guard, store, context, ai: { info: () => ({ configured: true, model: 'mock' }), generate: async messages => { calls++; received = JSON.parse(messages[1].content); assert.match(messages[0].content, /待验证假设/); assert.match(messages[0].content, /最小验证行动/); return '候选方向尚待验证。'; } } });
  const preview = await run({ action: 'prepare', mode: 'opportunity', opportunityId: opportunity.id, role: '工作' });
  assert.equal(calls, 0); assert.equal(preview.snapshot.opportunities.length, 1); assert.equal(preview.snapshot.tasks.length, 1);
  assert.equal(preview.snapshot.conditions.length, 1); assert.equal(preview.snapshot.dossiers.length, 1);
  assert.ok(!JSON.stringify(preview.snapshot).includes('家庭')); assert.ok(!JSON.stringify(preview.snapshot).includes('已完成任务'));
  state = await context.save({ kind: 'opportunity', expectedRevision: state.revision, record: { id: opportunity.id, body: '预览后编辑' } });
  const result = await run({ action: 'generate', previewId: preview.previewId });
  assert.equal(calls, 1); assert.deepEqual(received, JSON.parse(JSON.stringify(preview.snapshot))); assert.deepEqual(result.snapshot, preview.snapshot);
  assert.equal(received.opportunities[0].body, '待验证假设');
  assert.equal((await context.snapshot()).opportunities.length, 3);
  for (const mode of ['all', 'future', 'role']) {
    const next = await run({ action: 'prepare', mode, role: '工作' });
    assert.equal(next.snapshot.opportunities.length, 1); assert.equal(next.snapshot.opportunities[0].id, opportunity.id);
  }
  const all = await run({ action: 'prepare', mode: 'all' });
  assert.equal(all.snapshot.opportunities.length, 2);
  const singleTask = await run({ action: 'prepare', mode: 'task', taskId: 'work' });
  const singleDossier = await run({ action: 'prepare', mode: 'dossier', dossierId: state.dossiers[0].id });
  assert.deepEqual(singleTask.snapshot.opportunities, []); assert.deepEqual(singleDossier.snapshot.opportunities, []);
  await assert.rejects(run({ action: 'prepare', mode: 'opportunity' }), { status: 400 });
  await assert.rejects(run({ action: 'prepare', mode: 'opportunity', opportunityId: opportunity.id, role: '家庭' }), { status: 404 });
  await assert.rejects(run({ action: 'prepare', mode: 'opportunity', opportunityId: state.opportunities.find(item => item.status === 'archived').id }), { status: 404 });
});
test('analysis previews scoped facts before explicit send and persists exact snapshot', async t => {
  const fixture = await createTestWorkspace(); t.after(() => fixture.dispose());
  await fixture.seed('知识库/知识卡00-总索引与定域路由.md', '先定域，再定位。');
  const store = { snapshot: async () => ({ tasks: [{ id: 'work', text: '工作任务', roles: ['工作'], done: false }, { id: 'home', text: '私密家庭任务', roles: ['家庭'], done: false }] }) };
  const context = createContextStore(fixture.guard, store);
  let state = await context.snapshot();
  for (const role of ['工作', '家庭']) state = await context.save({ kind: 'condition', expectedRevision: state.revision, record: { roles: [role], quadrant: 'internal_resource', text: `${role}资源` } });
  let calls = 0;
  const run = createAnalysis({ guard: fixture.guard, store, context, ai: { info: () => ({ configured: true, model: 'test' }), generate: async messages => { calls++; assert.ok(!messages[1].content.includes('家庭')); return '根据所给条件，先核实资源。'; } } });
  const preview = await run({ action: 'prepare', mode: 'task', taskId: 'work', role: '工作' });
  assert.equal(calls, 0); assert.equal(preview.snapshot.tasks.length, 1); assert.equal(preview.snapshot.conditions.length, 1);
  const result = await run({ action: 'generate', previewId: preview.previewId });
  assert.equal(calls, 1); assert.deepEqual(result.snapshot, preview.snapshot);
  assert.equal((await context.snapshot()).analyses.length, 1);
  await assert.rejects(run({ action: 'generate', previewId: preview.previewId }), { status: 409 });
  const unavailable = createAnalysis({ guard: fixture.guard, store, context });
  await assert.rejects(unavailable({ action: 'generate', previewId: 'none' }), { status: 503 });
});
test('changed destination invalidates preview before any network call', async t => {
  const fixture = await createTestWorkspace(); t.after(() => fixture.dispose());
  await fixture.seed('知识库/知识卡00-总索引与定域路由.md', '定域');
  const store = { snapshot: async () => ({ tasks: [] }) };
  const context = createContextStore(fixture.guard, store);
  let baseUrl = 'https://example.test/v1'; let calls = 0;
  const run = createAnalysis({ guard: fixture.guard, store, context, ai: { info: () => ({ configured: true, model: 'test', baseUrl }), generate: async () => { calls++; return '结果'; } } });
  const preview = await run({ action: 'prepare', mode: 'all' });
  baseUrl = 'https://other.test/v1';
  await assert.rejects(run({ action: 'generate', previewId: preview.previewId }), { status: 409 });
  assert.equal(calls, 0);
});

test('all and future accept role filters without leaking other roles, including independent notes', async t => {
  const fixture = await createTestWorkspace(); t.after(() => fixture.dispose());
  await fixture.seed('知识库/知识卡00-总索引与定域路由.md', '定域');
  const store = { snapshot: async () => ({ tasks: [{ id: 'work', text: '工作任务', roles: ['工作'], done: false }, { id: 'home', text: '家庭任务', roles: ['家庭'], done: false }] }) };
  const context = createContextStore(fixture.guard, store);
  let state = await context.snapshot();
  for (const role of ['工作', '家庭']) {
    state = await context.save({ kind: 'condition', expectedRevision: state.revision, record: { roles: [role], quadrant: 'internal_resource', text: role + '资源' } });
    state = await context.save({ kind: 'dossier', expectedRevision: state.revision, record: { title: role + '独立档案', body: role + '零散笔记', roles: [role], taskIds: [] } });
  }
  const run = createAnalysis({ guard: fixture.guard, store, context });
  for (const mode of ['all', 'future', 'role']) {
    const { snapshot } = await run({ action: 'prepare', mode, role: '工作' });
    assert.equal(snapshot.tasks.length, 1); assert.equal(snapshot.conditions.length, 1); assert.equal(snapshot.dossiers.length, 1);
    assert.ok(!JSON.stringify(snapshot).includes('家庭'));
  }
  const unrestricted = await run({ action: 'prepare', mode: 'all', role: '' });
  assert.equal(unrestricted.snapshot.dossiers.length, 2);
  const oneTask = await run({ action: 'prepare', mode: 'task', taskId: 'work', role: '' });
  assert.equal(oneTask.snapshot.tasks.length, 1); assert.equal(oneTask.snapshot.conditions.length, 2);
  await assert.rejects(run({ action: 'prepare', mode: 'task', taskId: 'home', role: '工作' }), { status: 400 });
});

test('AI condition writes are explicit, atomic, preserve source and reject stale previews and role drift', async t => {
  const fixture = await createTestWorkspace(); t.after(() => fixture.dispose());
  const store = { snapshot: async () => ({ tasks: [] }) };
  const context = createContextStore(fixture.guard, store);
  let calls = 0;
  let output = { conditions: [{ roles: ['工作'], quadrant: 'internal_resource', text: '已有电脑' }] };
  const run = createAnalysis({ guard: fixture.guard, store, context, ai: { info: () => ({ configured: true, model: 'test', baseUrl: 'http://localhost/v1' }), generate: async messages => { calls++; assert.ok(!messages[1].content.includes('知识库')); return JSON.stringify(output); } } });
  let preview = await run({ action: 'prepare-conditions', text: '我在工作中已有电脑', role: '工作' });
  assert.equal(calls, 0); assert.equal((await context.snapshot()).conditions.length, 0);
  await assert.rejects(run({ action: 'generate', previewId: preview.previewId }), { status: 409 });
  const written = await run({ action: 'write-conditions', previewId: preview.previewId });
  assert.equal(written.conditionsWritten, 1); assert.equal(calls, 1);
  assert.equal(written.context.conditions[0].source.type, 'ai');
  assert.equal(written.context.conditionImports[0].text, '我在工作中已有电脑');
  assert.equal(written.context.analyses.length, 0);
  const edited = await context.save({ kind: 'condition', expectedRevision: written.context.revision, record: { ...written.context.conditions[0], text: '我已核实电脑可用', source: { type: 'ai', importId: 'forged' } } });
  assert.deepEqual(edited.conditions[0].source, written.context.conditions[0].source);
  await assert.rejects(run({ action: 'write-conditions', previewId: preview.previewId }), { status: 409 });
  preview = await run({ action: 'prepare-conditions', text: '新信息', role: '工作' });
  output = { conditions: [{ roles: ['家庭'], quadrant: 'internal_resource', text: '错误角色' }] };
  await assert.rejects(run({ action: 'write-conditions', previewId: preview.previewId }), { status: 502 });
  output = { conditions: [{ roles: ['工作'], quadrant: 'internal_resource', text: '合法部分' }, { roles: ['工作'], quadrant: 'invalid', text: '非法部分' }] };
  await assert.rejects(run({ action: 'write-conditions', previewId: preview.previewId }));
  assert.equal((await context.snapshot()).conditions.length, 1);
  const state = await context.snapshot();
  await context.save({ kind: 'role', expectedRevision: state.revision, record: { name: '创业' } });
  const before = calls;
  await assert.rejects(run({ action: 'write-conditions', previewId: preview.previewId }), { status: 409 });
  assert.equal(calls, before);
  preview = await run({ action: 'prepare-conditions', text: '创业有合作伙伴' });
  output = { conditions: [{ roles: ['创业'], quadrant: 'external_support', text: '有合作伙伴' }] };
  await run({ action: 'write-conditions', previewId: preview.previewId });
  const restored = await createContextStore(fixture.guard, store).snapshot();
  assert.equal(restored.conditions.length, 2); assert.equal(restored.conditionImports.length, 2); assert.equal(restored.malformed, 0);
});

test('concurrent changes during AI response leave the entire condition batch unwritten', async t => {
  const fixture = await createTestWorkspace(); t.after(() => fixture.dispose());
  const store = { snapshot: async () => ({ tasks: [] }) };
  const context = createContextStore(fixture.guard, store);
  const run = createAnalysis({ guard: fixture.guard, store, context, ai: { info: () => ({ configured: true, model: 'test' }), generate: async () => {
    const state = await context.snapshot();
    await context.save({ kind: 'role', expectedRevision: state.revision, record: { name: '其他' } });
    return JSON.stringify({ conditions: [{ roles: ['个人'], quadrant: 'internal_resource', text: '不能部分保存' }] });
  } } });
  const preview = await run({ action: 'prepare-conditions', text: '个人情况' });
  await assert.rejects(run({ action: 'write-conditions', previewId: preview.previewId }), { status: 409 });
  assert.equal((await context.snapshot()).conditions.length, 0);
});
