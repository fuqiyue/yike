import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createLearningServer } from './server.mjs';

test('read-only local service serves fresh card contents and denies private paths and writes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yijing-learning-test-'));
  await mkdir(path.join(root, '知识库'));
  await mkdir(path.join(root, '实录'));
  await mkdir(path.join(root, 'public'));
  const source = path.join(root, '知识库', '知识卡72-消息卦.md');
  await writeFile(source, '# 旧声明');
  await writeFile(path.join(root, '实录', 'private.md'), 'private marker');
  await writeFile(path.join(root, 'public', 'index.html'), '<h1>学习</h1>');
  const server = createLearningServer({ root, publicDirectory: path.join(root, 'public') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base)).status, 200);
    const catalogue = await (await fetch(`${base}/api/cards`)).json();
    assert.deepEqual(catalogue.cards.map(card => card.id), [72]);
    assert.equal((await (await fetch(`${base}/api/cards/72`)).json()).markdown, '# 旧声明');
    await writeFile(source, '# A6 新声明');
    assert.equal((await (await fetch(`${base}/api/cards/72`)).json()).markdown, '# A6 新声明');
    for (const resource of ['/实录/private.md', '/推演/a.md', '/logic_readme.md', '/.git/config', '/api/cards/../../实录/private.md', '/api/cards/%2e%2e%5c实录%5cprivate.md', '/%252e%252e/实录/private.md', '/api/cards/12']) {
      const response = await fetch(`${base}${resource}`);
      assert.equal(response.status, 404, resource);
      assert.ok(!(await response.text()).includes('private marker'));
    }
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal((await fetch(`${base}/api/cards/72`, { method, body: 'overwrite' })).status, 405);
    assert.equal(await readFile(source, 'utf8'), '# A6 新声明');
    assert.equal((await fetch(`${base}/api/cards`, { headers: { origin: 'https://example.invalid' } })).status, 403);
    const head = await fetch(`${base}/api/cards/72`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal(head.headers.get('cache-control'), 'no-store');
  } finally {
    await new Promise(resolve => server.close(resolve));
    // Only the exact fresh test fixture under the OS temp directory is removed.
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('yijing-learning-test-'));
    await rm(root, { recursive: true, force: true });
  }
});
