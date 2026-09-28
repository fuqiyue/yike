import test from 'node:test';
import assert from 'node:assert/strict';
import { createLearningApp } from './app.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function setup({ hash = '#course', unified = true, fetch, loadRoute } = {}) {
  const node = () => ({ children: [], setAttribute() {}, removeAttribute() {}, querySelector() { return null; }, focus() {}, replaceChildren(...items) { this.children = items; } });
  const app = node(), window = new EventTarget(), location = { hash };
  const document = { querySelector: () => unified ? {} : null, querySelectorAll: () => [], createElement: node };
  const runtime = createLearningApp({ app, document, window, location, fetch, loadRoute });
  return { app, window, location, ...runtime };
}
const catalog = () => Promise.resolve({ ok: true, json: async () => ({ cards: [{ id: 66 }] }) });

test('plan and unknown routes fetch no knowledge and load no learning submodule', async () => {
  for (const hash of ['#plan', '#unrecognized', '']) {
    const env = setup({ hash, fetch: () => assert.fail('unexpected fetch'), loadRoute: () => assert.fail('unexpected import') });
    await env.start(); assert.deepEqual(env.app.children, []);
  }
});

test('standalone empty route starts course; disposal releases DOM and reloads catalog on return', async () => {
  let reads = 0, cleanups = 0;
  const names = [];
  const env = setup({ hash: '', unified: false, fetch: () => { reads++; return catalog(); }, loadRoute: async name => {
    names.push(name); return { mountCourse: async () => () => { cleanups++; } };
  } });
  await env.start(); assert.equal(env.app.children.length, 1);
  env.dispose(); assert.equal(cleanups, 1); assert.deepEqual(env.app.children, []);
  env.location.hash = '#quiz';
  env.window.dispatchEvent(new Event('hashchange'));
  assert.deepEqual(names, ['course']);
  env.location.hash = '#course'; await env.start();
  assert.equal(reads, 2); env.dispose();
});

test('standalone unknown hash falls back to course while unified unknown hash stays idle', async () => {
  const loaded = [];
  const env = setup({ hash: '#unknown', unified: false, fetch: catalog, loadRoute: async name => { loaded.push(name); return { mountCourse: async () => {} }; } });
  await env.start(); assert.deepEqual(loaded, ['course']); assert.equal(env.app.children.length, 1); env.dispose();
  const unified = setup({ hash: '#unknown', fetch: () => assert.fail('unexpected fetch'), loadRoute: () => assert.fail('unexpected import') });
  await unified.start(); assert.deepEqual(unified.app.children, []); unified.dispose();
});

test('late catalog response after disposal cannot mount or survive a new session', async () => {
  const first = deferred(); let reads = 0, mounts = 0, signal;
  const env = setup({ fetch: (_url, options) => { signal = options.signal; return ++reads === 1 ? first.promise : catalog(); }, loadRoute: async () => ({ mountCourse: async () => { mounts++; } }) });
  const initial = env.start(); env.dispose(); assert.equal(signal.aborted, true);
  await env.start(); assert.equal(mounts, 1);
  first.resolve({ ok: true, json: async () => ({ cards: [{ id: 1 }] }) });
  await initial; assert.equal(mounts, 1); assert.equal(env.app.children.length, 1); env.dispose();
});

test('late mount cleanup runs and stale card result never reaches its consumer', async () => {
  const mounting = deferred(), entered = deferred(); let cleaned = 0;
  const env = setup({ fetch: catalog, loadRoute: async () => ({ mountCourse: async () => { entered.resolve(); await mounting.promise; return () => { cleaned++; }; } }) });
  const initial = env.start(); await entered.promise; env.dispose(); mounting.resolve(); await initial;
  assert.equal(cleaned, 1); assert.deepEqual(env.app.children, []);

  const card = deferred(), requested = deferred(); let consumed = false;
  const next = setup({ fetch: url => url === '/api/cards' ? catalog() : (requested.resolve(), card.promise), loadRoute: async () => ({ mountCourse: async (_view, context) => { await context.getCard(66); consumed = true; } }) });
  const pending = next.start(); await requested.promise; next.dispose();
  card.resolve({ ok: true, json: async () => ({ markdown: 'late' }) });
  await pending; assert.equal(consumed, false); assert.deepEqual(next.app.children, []);
});
