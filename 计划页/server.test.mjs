import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createTestWorkspace } from './fsguard.mjs';
import { startPlanServer } from './server.mjs';

async function setup(t, clock) {
  const fixture = await createTestWorkspace(); t.after(() => fixture.dispose());
  await fixture.seed('计划页/public/index.html', '<input autofocus>');
  const app = await startPlanServer({ guard: fixture.guard, port: 0, clock });
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = event => fetch(`${base}/api/event`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event) });
  return { fixture, app, base, post };
}
test('HTTP contract: local origin, private paths, methods, HEAD and absent sort control', async t => {
  const { fixture, base, post } = await setup(t, () => new Date('2026-09-06T09:00:00'));
  assert.equal((await post({ verb: '记', text: '写一份说明' })).status, 201);
  const normal = await (await fetch(`${base}/api/day/2026-09-06`)).json();
  assert.deepEqual(await (await fetch(`${base}/api/day/2026-09-06?sort=x`)).json(), normal);
  assert.equal(normal[0].body, ''); assert.deepEqual(normal[0].roles, []); assert.equal(normal[0].execution, 'pending');
  assert.equal((await post({ verb: '记', text: 'x', sort: 'x' })).status, 400);
  for (const address of ['/实录/在办/x.md', '/.git/config', '/unknown', '/%2e%2e/.git/config']) assert.equal((await fetch(`${base}${address}`)).status, 404);
  assert.equal((await fetch(`${base}/api/day`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${base}/api/event`)).status, 405);
  assert.equal((await fetch(base, { headers: { Origin: 'https://outside.invalid' } })).status, 403);
  assert.equal((await fetch(base, { headers: { Origin: 'null' } })).status, 403);
  assert.equal((await fetch(base, { method: 'HEAD' })).status, 200);
  assert.equal(await (await fetch(`${base}/api/open`, { method: 'HEAD' })).text(), '');
  const port = new URL(base).port;
  const hostStatus = await new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, headers: { Host: 'outside.invalid' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject);
  });
  assert.equal(hostStatus, 403);
  assert.deepEqual((await fixture.snapshot('计划')).filter(name => !name.includes('日志') && name !== '.lock'), []);
});
test('concurrent creation gets unique IDs; timer, interruption, rollover and restart fold', async t => {
  let now = new Date('2026-09-06T23:55:00');
  const { fixture, app, base, post } = await setup(t, () => now);
  const saves = await Promise.all(Array.from({ length: 8 }, (_, n) => post({ verb: '记', text: `第 ${n} 件事` })));
  assert.equal(saves.filter(response => response.status === 201).length, 8);
  let tasks = await (await fetch(`${base}/api/open`)).json();
  assert.equal(new Set(tasks.map(task => task.id)).size, 8);
  const id = tasks[0].id;
  assert.equal((await post({ verb: '始', id, minutes: 25 })).status, 201);
  assert.equal((await post({ verb: '始', id: tasks[1].id, minutes: 25 })).status, 400);
  assert.equal((await post({ verb: '止', id, outcome: '完成' })).status, 400);
  now = new Date('2026-09-07T00:02:00');
  assert.equal((await post({ verb: '止', id, outcome: '中断', reason: '未知' })).status, 201);
  tasks = await (await fetch(`${base}/api/day/2026-09-07`)).json();
  assert.equal(tasks[0].blocks[0].actual, 7);
  assert.equal((await post({ verb: '完', id })).status, 201);
  assert.equal((await (await fetch(`${base}/api/open`)).json()).length, 7);
  assert.equal((await post({ verb: '撤', id })).status, 201);
  assert.equal((await post({ verb: '止', id, outcome: '中断' })).status, 400);
  assert.equal((await post({ verb: '始', id, minutes: 25 })).status, 201);
  assert.equal((await post({ verb: '完', id })).status, 201);
  const completed = (await app.store.snapshot()).tasks.find(task => task.id === id);
  assert.equal(completed.execution, 'completed');
  assert.equal(completed.blocks.filter(block => !block.ended).length, 0);
  await assert.rejects(startPlanServer({ guard: fixture.guard, port: 0 }), /已有运行实例/);
  assert.equal((await app.store.snapshot()).tasks.length, 8);
});
test('bad payloads never create an event file', async t => {
  const { fixture, post, base } = await setup(t);
  for (const payload of [null, [], {}, { verb: '__proto__' }, { verb: 'constructor' }, { verb: { toString: null } }, { verb: '记', text: 'two\nlines' }, { verb: '记', text: 'a\0b' }, { verb: '完', id: '20260906-999' }]) assert.equal((await post(payload)).status, 400);
  assert.equal((await fetch(`${base}/api/event`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await fetch(`${base}/api/event`, { method: 'POST', body: 'text' })).status, 415);
  assert.equal((await post({ verb: '记', text: 'x'.repeat(65536) })).status, 413);
  assert.deepEqual(await fixture.guard.listNames('计划/日志'), []);
});
