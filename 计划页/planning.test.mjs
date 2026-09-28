import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestWorkspace } from './fsguard.mjs';
import { createStore } from './store.mjs';
import { formatEvent, parseDay, readAll } from './log.mjs';
import { startPlanServer } from './server.mjs';

const id = '20260906-001';
const clock = () => new Date('2026-09-06T12:00:00');
test('planning events round trip, preserve old task history, reset reviews and survive restart', async t => {
  const fixture = await createTestWorkspace(); t.after(() => fixture.dispose());
  const store = createStore(fixture.guard, clock);
  await store.event({ verb: '记', text: '准备资料' });
  const events = [
    { verb: '注', id, text: '补充说明' },
    { verb: '排', id, field: 'scheduled', date: '2026-09-08', period: '下午' },
    { verb: '排', id, field: 'due', date: '2026-09-09', period: '' },
    { verb: '排', id, field: 'review', date: '2026-09-10', period: '' },
    { verb: '候', id, waiting: true },
    { verb: '看', id, result: '暂不确定' },
    { verb: '完', id }, { verb: '撤', id }
  ];
  for (const event of events) await store.event(event);
  const text = await fixture.guard.readText('计划/日志/2026-09-06.md');
  assert.equal(parseDay(text, '2026-09-06').events.map(formatEvent).join('\n') + '\n', text);
  const restarted = createStore(fixture.guard, clock);
  const [task] = await restarted.open();
  assert.equal(task.waiting, true); assert.equal(task.done, false);
  assert.deepEqual(task.notes, [{ text: '补充说明', at: '2026-09-06T12:00:00' }]);
  assert.deepEqual(task.scheduled, { date: '2026-09-08', period: '下午' });
  assert.equal(task.due.date, '2026-09-09'); assert.equal(task.reviewResolved, true);
  assert.equal((await restarted.state('2026-09-06')).reviewTasks.length, 0);
  await restarted.event({ verb: '排', id, field: 'review', date: '2026-09-11', period: '' });
  await restarted.event({ verb: '完', id });
  const state = await restarted.state('2026-09-06');
  assert.equal(state.reviewTasks.length, 1); assert.equal(state.reviewTasks[0].reviewResult, null);
  assert.equal(state.reviewTasks[0].reviewResolved, false);
  await restarted.event({ verb: '排', id, field: 'scheduled', date: null, period: '' });
  assert.equal((await restarted.day('2026-09-06'))[0].scheduled, null);
  assert.equal((await restarted.search('补充'))[0].id, id);
});

test('strict payload validation, timer exclusion and unchanged write boundaries', async t => {
  const fixture = await createTestWorkspace(); t.after(() => fixture.dispose());
  const store = createStore(fixture.guard, clock);
  await store.event({ verb: '记', text: '资料' });
  const bad = [
    { verb: '排', id, field: 'scheduled', date: '2026-02-30', period: '' },
    { verb: '排', id, field: 'due', date: '2026-09-07', period: '下午' },
    { verb: '排', id, field: 'scheduled', date: null, period: '下午' },
    { verb: '排', id, field: '__proto__', date: null, period: '' },
    { verb: '候', id, waiting: 1 }, { verb: '候', id, waiting: true, extra: 1 },
    { verb: '看', id, result: '符合' }, { verb: '看', id, result: '其他' },
    { verb: '注', id, text: 'a'.repeat(4096) }
  ];
  for (const payload of bad) await assert.rejects(store.event(payload), { status: 400 });
  await store.event({ verb: '始', id, minutes: 25 });
  await assert.rejects(store.event({ verb: '候', id, waiting: true }), /先结束/);
  assert.equal((await readAll(fixture.guard)).events.length, 2);
  await store.event({ verb: '注', id, text: '学习卦与爻的含义' });
  assert.equal((await store.open())[0].notes[0].text, '学习卦与爻的含义');
});

test('state scans each file once without retained cache; revision uses metadata and notices manual edits', async t => {
  const fixture = await createTestWorkspace(); t.after(() => fixture.dispose());
  await fixture.seed('计划/日志/2026-09-06.md', '- 09:00:00 记 20260906-001 初始\n');
  await fixture.seed('计划/日志/2026-09-07.md', '- 09:00:00 排 20260906-001 review 2026-09-09\n');
  let reads = 0, active = 0, peak = 0;
  const guard = { ...fixture.guard, async readText(relative) {
    reads++; active++; peak = Math.max(peak, active);
    try { return await fixture.guard.readText(relative); } finally { active--; }
  } };
  const store = createStore(guard, clock);
  const revision = await store.revision(); assert.equal(reads, 0);
  const state = await store.state('2026-09-07');
  assert.equal(reads, 2); assert.equal(peak, 1); assert.equal(state.dayTasks.length, 1);
  await fixture.seed('计划/日志/2026-09-06.md', '- 09:00:00 记 20260906-001 手工更改\n');
  assert.notEqual(await store.revision(), revision); assert.equal(reads, 2);
  assert.equal((await store.state('2026-09-06')).dayTasks[0].text, '手工更改');
  assert.equal(reads, 4);
});

test('new HTTP reads and compact startup diagnostics', async t => {
  const fixture = await createTestWorkspace(); t.after(() => fixture.dispose());
  const app = await startPlanServer({ guard: fixture.guard, clock, port: 0 }); t.after(() => app.close());
  assert.deepEqual(Object.keys(app.diagnostics).sort(), ['malformed', 'torn']);
  const base = `http://127.0.0.1:${app.server.address().port}`;
  await app.store.event({ verb: '记', text: 'HTTP搜索' });
  const state = await (await fetch(`${base}/api/state/2026-09-06`)).json();
  assert.equal(state.openTasks.length, 1);
  assert.equal((await (await fetch(`${base}/api/revision`)).json()).revision, state.revision);
  assert.equal((await (await fetch(`${base}/api/search?q=HTTP`)).json()).length, 1);
  assert.equal((await fetch(`${base}/api/state/2026-02-30`)).status, 400);
  assert.equal((await fetch(`${base}/api/revision`, { method: 'POST' })).status, 405);
});
