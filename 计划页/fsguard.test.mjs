import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuard, createTestWorkspace } from './fsguard.mjs';
import { acquireLock } from './lock.mjs';

test('six forbidden paths reject reads and both writes; static/template read only', async t => {
  const fixture = await createTestWorkspace(); t.after(() => fixture.dispose());
  for (const filename of ['实录/在办/x.md', '推演/x.md', '回顾/x.md', 'logic_readme.md', '.git/config', '计划/../escape.md', '/absolute.md', '计划\\日志\\x.md']) {
    await assert.rejects(fixture.guard.readText(filename), { code: 'EACCES' });
    await assert.rejects(fixture.guard.writeNew(filename, 'blocked'), { code: 'EACCES' });
    await assert.rejects(fixture.guard.appendLine(filename, 'blocked'), { code: 'EACCES' });
  }
  for (const filename of ['实录/_模板-实录.md', '计划页/public/index.html']) {
    await fixture.seed(filename, 'readable');
    assert.equal(await fixture.guard.readText(filename), 'readable');
    await assert.rejects(fixture.guard.writeNew(filename, 'blocked'), { code: 'EACCES' });
    await assert.rejects(fixture.guard.appendLine(filename, 'blocked'), { code: 'EACCES' });
  }
  await fixture.guard.writeNew('计划/草稿/x.md', 'original');
  await assert.rejects(fixture.guard.writeNew('计划/草稿/x.md', 'replace'), { code: 'EEXIST' });
  assert.equal(await fixture.guard.readText('计划/草稿/x.md'), 'original');
});
test('directory junction escape rejected for read, new and append', async t => {
  const fixture = await createTestWorkspace(); t.after(() => fixture.dispose());
  await fixture.seed('outside/data.md', 'secret');
  await fixture.link('计划/日志', 'outside');
  await assert.rejects(fixture.guard.readText('计划/日志/data.md'), { code: 'EACCES' });
  await assert.rejects(fixture.guard.writeNew('计划/日志/new.md', 'x'), { code: 'EACCES' });
  await assert.rejects(fixture.guard.appendLine('计划/日志/data.md', 'x'), { code: 'EACCES' });
});
test('live lock refuses second writer, stale lock recovers, release is owner-specific', async t => {
  const fixture = await createTestWorkspace(); t.after(() => fixture.dispose());
  const release = await acquireLock(fixture.guard, 3220);
  await assert.rejects(acquireLock(fixture.guard, 3221), /已有运行实例/);
  assert.equal(await fixture.guard.removeLock('not-the-owner'), false);
  assert.equal(await release(), true);
  await fixture.guard.writeNew('计划/.lock', JSON.stringify({ pid: 2147483647, port: 3220 }));
  const recovered = await acquireLock(fixture.guard, 3220);
  assert.equal(await recovered(), true);
});
test('serialized appends preserve all independent lines', async t => {
  const fixture = await createTestWorkspace(); t.after(() => fixture.dispose());
  await Promise.all(Array.from({ length: 40 }, (_, n) => fixture.guard.appendLine('计划/日志/2026-09-06.md', `- 09:00:00 注 - item ${n}`)));
  assert.equal((await fixture.guard.readText('计划/日志/2026-09-06.md')).trimEnd().split('\n').length, 40);
});

test('separate resource and data roots preserve read routing and write boundaries', async t => {
  const data = await createTestWorkspace(); t.after(() => data.dispose());
  const resources = await createTestWorkspace(); t.after(() => resources.dispose());
  const guard = createGuard(data.root, { resourceRoot: resources.root });
  for (const filename of ['实录/_模板-实录.md', '计划页/public/index.html']) {
    await resources.seed(filename, 'bundled resource');
    await data.seed(filename, 'data shadow must not be read');
    assert.equal(await guard.readText(filename), 'bundled resource');
    assert.equal(await guard.metadata(filename), await resources.guard.metadata(filename));
    await assert.rejects(guard.writeNew(filename, 'blocked'), { code: 'EACCES' });
    await assert.rejects(guard.appendLine(filename, 'blocked'), { code: 'EACCES' });
    assert.equal(await resources.guard.readText(filename), 'bundled resource');
  }
  await resources.seed('计划/日志/data.md', 'resource shadow must not be read');
  await guard.writeNew('计划/日志/data.md', 'data root\n');
  await guard.appendLine('计划/日志/data.md', 'appended');
  assert.equal(await data.guard.readText('计划/日志/data.md'), 'data root\nappended\n');
  assert.equal(await resources.guard.readText('计划/日志/data.md'), 'resource shadow must not be read');
  assert.deepEqual(await guard.listNames('计划页/public/'), ['index.html']);
  for (const filename of ['计划/../实录/_模板-实录.md', '计划页/public/../../escape.md', '实录/private.md']) {
    await assert.rejects(guard.readText(filename), { code: 'EACCES' });
    await assert.rejects(guard.writeNew(filename, 'blocked'), { code: 'EACCES' });
    await assert.rejects(guard.appendLine(filename, 'blocked'), { code: 'EACCES' });
  }
});

test('separate roots reject junctions in resource paths and configured roots', async t => {
  const data = await createTestWorkspace(); t.after(() => data.dispose());
  const resources = await createTestWorkspace(); t.after(() => resources.dispose());
  await resources.seed('outside/index.html', 'secret');
  await resources.link('计划页/public', 'outside');
  const guard = createGuard(data.root, { resourceRoot: resources.root });
  await assert.rejects(guard.readText('计划页/public/index.html'), { code: 'EACCES' });
  await assert.rejects(guard.metadata('计划页/public/index.html'), { code: 'EACCES' });
  await assert.rejects(guard.listNames('计划页/public/'), { code: 'EACCES' });
  await resources.seed('real/实录/_模板-实录.md', 'template');
  await resources.link('linked-root', 'real');
  const linkedResources = createGuard(data.root, { resourceRoot: `${resources.root}/linked-root` });
  await assert.rejects(linkedResources.readText('实录/_模板-实录.md'), { code: 'EACCES' });
  const linkedData = createGuard(`${resources.root}/linked-root`, { resourceRoot: data.root });
  await assert.rejects(linkedData.writeNew('计划/草稿/new.md', 'blocked'), { code: 'EACCES' });
});

test('flush waits for queued writes including those submitted after a rejected write', async t => {
  const fixture = await createTestWorkspace(); t.after(() => fixture.dispose());
  const rejection = assert.rejects(fixture.guard.writeNew('实录/private.md', 'blocked'), { code: 'EACCES' });
  const writes = Array.from({ length: 40 }, (_, n) => fixture.guard.appendLine('计划/日志/flush.md', `line ${n}`));
  await fixture.guard.flush();
  assert.equal((await fixture.guard.readText('计划/日志/flush.md')).trimEnd().split('\n').length, 40);
  await Promise.all([rejection, ...writes]);
});
