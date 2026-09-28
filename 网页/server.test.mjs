import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTestWorkspace } from '../计划页/fsguard.mjs';
import { startUnifiedServer } from './server.mjs';
import { createUnifiedServer } from './server.mjs';
import http from 'node:http';

test('one local page serves plan and learning without widening either data boundary', async t => {
  const fixture = await createTestWorkspace();
  t.after(() => fixture.dispose());
  await fixture.seed('计划页/public/app.js', 'export const plan = true;');
  await fixture.seed('计划页/public/view.js', 'export const view = true;');
  await fixture.seed('计划页/public/periodic.js', 'export const nextPeriodicDue = true;');
  await fixture.seed('计划页/public/style.css', '.plan-app{--paper:white}.plan-app .record{display:flex}');

  const learningRoot = await mkdtemp(path.join(os.tmpdir(), 'yijing-home-test-'));
  t.after(async () => {
    assert.equal(path.dirname(learningRoot), os.tmpdir());
    assert.ok(path.basename(learningRoot).startsWith('yijing-home-test-'));
    await rm(learningRoot, { recursive: true, force: true });
  });
  await mkdir(path.join(learningRoot, '知识库'));
  await writeFile(path.join(learningRoot, '知识库', '知识卡72-消息卦.md'), '# 消息卦');

  const app = await startUnifiedServer({ port: 0, guard: fixture.guard, learningRoot, clock: () => new Date('2026-09-06T09:00:00') });
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const html = await (await fetch(base)).text();
  assert.match(html, /id="plan-workspace"/);
  assert.match(html, /id="learn-workspace"/);
  assert.match(html, /href="#plan"/);
  assert.match(html, /href="#course"/);
  assert.equal((await fetch(`${base}/shell.js`)).status, 200);
  assert.equal((await fetch(`${base}/plan/app.js`)).status, 200);
  assert.match(await (await fetch(`${base}/plan/periodic.js`)).text(), /nextPeriodicDue/);
  assert.equal((await fetch(`${base}/learn/app.js`)).status, 200);

  const css = await (await fetch(`${base}/plan/style.css`)).text();
  assert.match(css, /@scope \(\.plan-app\)/);
  assert.match(css, /:scope\{--paper/);
  assert.match(css, /:scope \.record\{display:flex/);
  assert.doesNotMatch(css, /\.plan-app \.record/);
  assert.doesNotMatch(css, /body\{color:black/);

  const cards = await (await fetch(`${base}/api/cards`)).json();
  assert.deepEqual(cards.cards.map(card => card.id), [72]);
  assert.equal((await (await fetch(`${base}/api/cards/72`)).json()).markdown, '# 消息卦');
  const saved = await fetch(`${base}/api/event`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verb: '记', text: '合并入口验收' }) });
  assert.equal(saved.status, 201);
  assert.equal((await (await fetch(`${base}/api/open`)).json())[0].text, '合并入口验收');

  for (const resource of ['/实录/private.md', '/logic_readme.md', '/unknown', '/plan/', '/learn/']) assert.equal((await fetch(`${base}${resource}`)).status, 404);
  assert.equal((await fetch(base, { headers: { Origin: 'https://outside.invalid' } })).status, 403);
});

test('new plan reads and two explicit assets are forwarded without opening adjacent paths', async t => {
  const upstream = http.createServer((request, response) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ path: request.url })); });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => upstream.close(resolve)));
  const server = createUnifiedServer({ planPort: upstream.address().port, learningPort: upstream.address().port });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const route of ['/api/state/2026-09-21', '/api/revision', '/api/search?q=hello', '/plan/insights.js', '/plan/dates.js']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200); assert.equal((await response.json()).path, route.startsWith('/plan/') ? route.slice('/plan'.length) : route);
  }
  for (const route of ['/api/state/private', '/api/state/2026-09-21/extra', '/api/revision/extra', '/plan/store.js', '/plan/private.js']) {
    assert.equal((await fetch(base + route)).status, 404);
  }
});
