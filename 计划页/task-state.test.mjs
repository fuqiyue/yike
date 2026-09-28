import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestWorkspace } from './fsguard.mjs';
import { createStore } from './store.mjs';
import { formatEvent, parseDay } from './log.mjs';

async function setup(t) {
  const fixture = await createTestWorkspace(); t.after(() => fixture.dispose());
  let now = new Date('2026-09-28T09:00:00');
  const clock = () => now;
  const store = createStore(fixture.guard, clock);
  const { id } = await store.event({ verb: '记', text: '考虑下一步' });
  return { fixture, store, id, clock, advance: value => { now = new Date(value); } };
}

test('multiline notes are one append-only event; restart and search retain text, roles and edit history', async t => {
  const { fixture, store, id, clock } = await setup(t);
  const body = '已有条件：会写代码\n对方条件：还需要核实\r\n八卦作为分析参考\n' + '笔记'.repeat(2500);
  await store.event({ verb: '改', id, text: '新的任务标题', body, roles: ['工作', '家庭'] });
  const content = await fixture.guard.readText('计划/日志/2026-09-28.md');
  assert.equal(content.trimEnd().split('\n').length, 2);
  assert.equal(parseDay(content, '2026-09-28').malformed, 0);
  const restarted = createStore(fixture.guard, clock);
  const [task] = (await restarted.state('2026-09-28')).allTasks;
  assert.equal(task.body, body); assert.deepEqual(task.roles, ['工作', '家庭']);
  assert.equal(task.edits[0].text, '考虑下一步'); assert.equal(task.execution, 'pending');
  assert.equal((await restarted.search('核实'))[0].id, id);
  await store.event({ verb: '改', id, text: '第三次标题', body: '', roles: [] });
  assert.equal((await store.open())[0].edits[1].body, body);
});

test('execution is persistent and independent of timer expiry; multiple tasks can run', async t => {
  const { fixture, store, id, clock, advance } = await setup(t);
  const second = await store.event({ verb: '记', text: '另一个任务' });
  await store.event({ verb: '行', id, action: 'start' });
  await store.event({ verb: '行', id: second.id, action: 'start' });
  advance('2026-09-29T11:00:00');
  assert.deepEqual((await createStore(fixture.guard, clock).open()).map(task => task.execution), ['running', 'running']);
  await assert.rejects(store.event({ verb: '行', id, action: 'start' }), /已在执行/);
  await store.event({ verb: '行', id, action: 'pause' });
  await assert.rejects(store.event({ verb: '行', id, action: 'pause' }), /尚未开始/);
  await store.event({ verb: '行', id, action: 'start' });
  await store.event({ verb: '完', id });
  const state = await createStore(fixture.guard, clock).state('2026-09-29');
  assert.equal(state.allTasks.find(task => task.id === id).execution, 'completed');
  assert.equal(state.openTasks.length, 1);
  assert.deepEqual(state.allTasks[0].executionHistory.map(item => item.to), ['running', 'paused', 'running', 'completed']);
  await assert.rejects(store.event({ verb: '行', id, action: 'start' }), /已完成/);
  await store.event({ verb: '撤', id });
  assert.equal((await store.open())[0].execution, 'pending');
});

test('legacy unfinished timers become running; new pause and completion close them in the same event', async t => {
  const { fixture, store, id, clock, advance } = await setup(t);
  await store.event({ verb: '始', id, minutes: 25 });
  assert.equal((await createStore(fixture.guard, clock).open())[0].execution, 'running');
  advance('2026-09-28T09:05:00');
  await store.event({ verb: '行', id, action: 'pause' });
  let task = (await store.open())[0];
  assert.equal(task.blocks[0].actual, 5); assert.equal(task.blocks[0].outcome, '中断');
  await store.event({ verb: '始', id, minutes: 25 });
  advance('2026-09-28T09:07:00');
  await store.event({ verb: '完', id });
  task = (await createStore(fixture.guard, clock).state('2026-09-28')).allTasks[0];
  assert.equal(task.execution, 'completed'); assert.equal(task.blocks[1].actual, 2);
  assert.equal(task.blocks[1].outcome, '完成');
  assert.equal(task.blocks.filter(block => !block.ended).length, 0);
});

test('period completion snapshots edited notes and resets execution; later edits do not mutate past occurrences', async t => {
  const { fixture, store, id, clock } = await setup(t);
  await store.event({ verb: '设', id, quadrant: 'q2', recurrence: 'daily', amount: null, currency: 'CNY', anchorDate: '2026-09-28' });
  await store.event({ verb: '改', id, text: '周期任务', body: '本期笔记\n第二行', roles: ['个人'] });
  await store.event({ verb: '行', id, action: 'start' });
  await store.event({ verb: '完', id, expectedDue: '2026-09-28' });
  let state = await createStore(fixture.guard, clock).state('2026-09-28');
  assert.equal(state.openTasks[0].execution, 'pending'); assert.equal(state.openTasks[0].due.date, '2026-09-29');
  assert.equal(state.completedTasks[0].body, '本期笔记\n第二行');
  const occurrence = state.completedTasks[0].eventId;
  await store.event({ verb: '撤', id, eventId: occurrence });
  assert.equal((await store.open())[0].due.date, '2026-09-28');
  await store.event({ verb: '完', id, expectedDue: '2026-09-28' });
  await store.event({ verb: '改', id, text: '下期标题', body: '下期笔记', roles: ['家庭'] });
  state = await store.state('2026-09-28');
  assert.equal(state.completedTasks[0].text, '周期任务');
  assert.equal(state.completedTasks[0].body, '本期笔记\n第二行');
  assert.deepEqual(state.completedTasks[0].roles, ['个人']);
  assert.equal(state.completedTasks[0].reversible, false);
});

test('edit and action validation reject injections and invalid sizes without adding log events', async t => {
  const { fixture, store, id } = await setup(t);
  const edit = { verb: '改', id, text: '标题', body: '正文', roles: ['工作'] };
  for (const patch of [{ text: '' }, { text: 'x'.repeat(301) }, { text: 'a\nb' }, { body: 'x'.repeat(6001) }, { body: 'a\0b' }, { roles: ['未知'] }, { roles: ['工作', '工作'] }, { roles: '工作' }, { hexagram: '乾' }]) await assert.rejects(store.event({ ...edit, ...patch }), { status: 400 });
  await assert.rejects(store.event({ verb: '行', id, action: 'finish' }), { status: 400 });
  assert.equal(parseDay(await fixture.guard.readText('计划/日志/2026-09-28.md'), '2026-09-28').events.length, 1);
  const line = formatEvent({ ...edit, time: '09:01:00' });
  assert.equal(parseDay(line.replace('"text":', '"verb":"完","text":') + '\n', '2026-09-28').malformed, 1);
});

test('concurrent double clicks serialize, cross-day completion records once and reversal remains coherent', async t => {
  const { store, id, advance } = await setup(t);
  const starts = await Promise.allSettled([store.event({ verb: '行', id, action: 'start' }), store.event({ verb: '行', id, action: 'start' })]);
  assert.deepEqual(starts.map(item => item.status), ['fulfilled', 'rejected']);
  advance('2026-09-29T00:01:00');
  const ends = await Promise.allSettled([store.event({ verb: '完', id }), store.event({ verb: '完', id })]);
  assert.deepEqual(ends.map(item => item.status), ['fulfilled', 'rejected']);
  let state = await store.state('2026-09-29');
  assert.equal(state.completedTotal, 1); assert.equal(state.dayTasks[0].id, id);
  assert.equal(state.completedTasks[0].completedAt, '2026-09-29T00:01:00');
  assert.equal((await store.state('2026-09-28')).completedTotal, 0);
  const reversals = await Promise.allSettled([store.event({ verb: '撤', id }), store.event({ verb: '撤', id })]);
  assert.deepEqual(reversals.map(item => item.status), ['fulfilled', 'rejected']);
  state = await store.state('2026-09-29');
  assert.equal(state.completedTotal, 0); assert.equal(state.allTasks[0].execution, 'pending');
});
