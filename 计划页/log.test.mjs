import test from 'node:test';
import assert from 'node:assert/strict';
import { formatEvent, parseDay, foldEvents, readAll, validDate } from './log.mjs';
import { createTestWorkspace } from './fsguard.mjs';
const date = '2026-09-06', id = '20260906-001';
const events = [
  { time: '09:00:00', verb: '记', id, text: '写完方案' },
  { time: '09:01:00', verb: '始', id, minutes: 25 },
  { time: '09:26:00', verb: '止', id, minutes: 25, outcome: '完成' },
  { time: '09:27:00', verb: '完', id },
  { time: '09:28:00', verb: '撤', id },
  { time: '09:29:00', verb: '注', id: '-', text: '有人来访' }
];
test('six verbs round trip, completion reversal, exact model and chronology', () => {
  const parsed = parseDay(events.map(formatEvent).join('\n') + '\n', date);
  assert.equal(parsed.malformed, 0); assert.equal(parsed.torn, 0);
  assert.deepEqual(parsed.events.map(formatEvent), events.map(formatEvent));
  const [task] = foldEvents(parsed.events);
  assert.equal(task.body, ''); assert.deepEqual(task.roles, []); assert.equal(task.execution, 'pending');
  assert.equal(task.done, false); assert.equal(task.blocks[0].actual, 25);
  const earlier = parseDay('- 08:00:00 记 20260906-002 先写的\n', date).events;
  assert.deepEqual(foldEvents([...parsed.events, ...earlier]).map(t => t.id), ['20260906-002', id]);
});
test('three malformed rows skipped, invalid date and injected input rejected', () => {
  const result = parseDay('- 25:00:00 记 20260906-001 不保存\n- 09:00:00 错 20260906-001\n- 09:00:00 始 20260906-001 -1\n', date);
  assert.equal(result.malformed, 3); assert.deepEqual(result.events, []);
  assert.equal(validDate('2026-02-30'), false);
  for (const text of ['a\nb', 'a\0b', 'a'.repeat(4096)]) {
    assert.throws(() => formatEvent({ ...events[0], text }));
  }
  for (const text of ['卦', '爻', '判词', '吉', '凶']) assert.equal(parseDay(formatEvent({ ...events[0], text }) + '\n', date).events[0].text, text);
});
test('torn valid-looking tail never becomes an event after repair and restart', async t => {
  const fixture = await createTestWorkspace(); t.after(() => fixture.dispose());
  const filename = `计划/日志/${date}.md`;
  await fixture.seed(filename, `${formatEvent(events[0])}\n- 09:01:00 记 20260906-002 未保存`);
  assert.equal((await readAll(fixture.guard)).torn, 1);
  await fixture.guard.appendLine(filename, formatEvent(events[3]));
  const restarted = await readAll(fixture.guard);
  assert.equal(restarted.torn, 1); assert.equal(restarted.events.length, 2);
  assert.equal(foldEvents(restarted.events).length, 1);
  await fixture.guard.appendLine(filename, formatEvent(events[4]));
  assert.equal((await readAll(fixture.guard)).events.length, 3);
  assert.equal(foldEvents((await readAll(fixture.guard)).events)[0].done, false);
});
