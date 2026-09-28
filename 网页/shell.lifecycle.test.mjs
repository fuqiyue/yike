import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('skip link keeps the active learning route and focuses the visible content', async () => {
  const source = await readFile(new URL('./public/shell.js', import.meta.url), 'utf8');
  const window = new EventTarget(), location = { hash: '#course' };
  const skip = new EventTarget();
  let focused;
  const nodes = {
    '.skip-link': skip, '#plan-workspace': {}, '#learn-workspace': {},
    '#app': { focus() { focused = 'learning'; } },
    '#entry-heading': { focus() { focused = 'plan'; } },
    '#entry': { focus() {} },
  };
  const document = { querySelector: selector => nodes[selector], querySelectorAll: () => [], createElement: () => ({ dataset: {} }), head: { append() {} } };
  vm.runInNewContext(source.replace("import('/learn/app.js')", 'loadLearning()'), {
    window, document, location, CustomEvent,
    loadLearning: async () => ({ start() {}, dispose() {} }),
  });
  await new Promise(done => setImmediate(done));
  const click = new Event('click', { cancelable: true });
  skip.dispatchEvent(click);
  assert.equal(click.defaultPrevented, true);
  assert.equal(location.hash, '#course');
  assert.equal(focused, 'learning');
  assert.equal(nodes['#plan-workspace'].hidden, true);
  location.hash = '#plan'; window.dispatchEvent(new Event('hashchange'));
  skip.dispatchEvent(new Event('click', { cancelable: true }));
  assert.equal(focused, 'plan');
});

test('shell defers all learning resources and rejects a late import after returning to plan', async () => {
  const source = await readFile(new URL('./public/shell.js', import.meta.url), 'utf8');
  const window = new EventTarget(), location = { hash: '#plan' };
  const nodes = { '#plan-workspace': {}, '#learn-workspace': {}, '#entry': { focus() {} }, '#app': {} };
  const styles = [], events = [];
  const document = { querySelector: selector => nodes[selector], querySelectorAll: () => [], createElement: () => ({ dataset: {} }), head: { append: node => styles.push(node) } };
  let imported = 0, started = 0, disposed = 0, resolve;
  const loaded = new Promise(done => { resolve = done; });
  window.addEventListener('workspacechange', event => events.push(event.detail.workspace));
  const context = { window, document, location, CustomEvent, loadLearning: () => { imported++; return loaded; } };
  vm.runInNewContext(source.replace("import('/learn/app.js')", 'loadLearning()'), context);
  assert.equal(imported, 0); assert.equal(styles.length, 0); assert.equal(nodes['#learn-workspace'].hidden, true);
  location.hash = '#course'; window.dispatchEvent(new Event('hashchange'));
  assert.equal(imported, 1); assert.equal(styles.length, 4);
  assert.equal(styles.filter(link => Object.hasOwn(link.dataset, 'readerStyles')).length, 1);
  location.hash = '#plan'; window.dispatchEvent(new Event('hashchange'));
  resolve({ start() { started++; }, dispose() { disposed++; } });
  await new Promise(done => setImmediate(done));
  assert.equal(started, 0); assert.ok(styles.every(link => link.disabled));
  location.hash = '#reader/66'; window.dispatchEvent(new Event('hashchange'));
  await new Promise(done => setImmediate(done));
  assert.equal(started, 1); assert.equal(imported, 1); assert.equal(styles.length, 4);
  location.hash = '#plan'; window.dispatchEvent(new Event('hashchange'));
  assert.equal(disposed, 1); assert.deepEqual(events, ['plan', 'learn', 'plan', 'learn', 'plan']);
});
