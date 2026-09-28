import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createLearningStore, LEARNING_KEYS, importPlan, backupData } from './data.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yijing-desktop-data-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const data = path.join(root, 'data');
  const backups = path.join(root, 'backups');
  for (const folder of [path.join(source, '计划', '日志'), data, backups]) fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(source, '计划', '日志', 'sample.md'), '# Synthetic test data\n');
  return { root, source, data, backups };
}
const document = values => ({ format: 'yijing-learning', version: 1, values });

test('learning values survive reopening, exports do not expose mutable state, imports replace the whole snapshot', t => {
  const { data } = fixture(t);
  const store = createLearningStore(data);
  assert.equal(store.getItem(LEARNING_KEYS[0]), null);
  store.setItem(LEARNING_KEYS[0], '["foundation:1"]');
  store.setItem(LEARNING_KEYS[1], '[1,2,3]');
  assert.equal(createLearningStore(data).getItem(LEARNING_KEYS[0]), '["foundation:1"]');
  const exported = store.exportData(); exported.values[LEARNING_KEYS[0]] = '[]';
  assert.equal(store.getItem(LEARNING_KEYS[0]), '["foundation:1"]');
  assert.deepEqual(store.importData(document({ [LEARNING_KEYS[2]]: '{"A1":"wrong"}' })), { importedKeys: 1 });
  assert.equal(store.getItem(LEARNING_KEYS[1]), null);
  assert.equal(store.getItem(LEARNING_KEYS[0]), null);
  assert.equal(store.getItem(LEARNING_KEYS[2]), '{"A1":"wrong"}');
});

test('invalid and oversized learning values cannot change persisted progress', t => {
  const { data } = fixture(t);
  const store = createLearningStore(data);
  store.setItem(LEARNING_KEYS[0], '["foundation:1"]');
  for (const [key, value] of [['unknown', '[]'], [LEARNING_KEYS[0], '{}'], [LEARNING_KEYS[0], 'bad'], [LEARNING_KEYS[1], '[0]'], [LEARNING_KEYS[2], '{"A1":"yes"}'], [LEARNING_KEYS[0], ' '.repeat(2 * 1024 * 1024 + 1)]]) {
    assert.throws(() => store.setItem(key, value));
  }
  assert.throws(() => store.importData(document({ unknown: '[]' })));
  assert.equal(store.getItem(LEARNING_KEYS[0]), '["foundation:1"]');
});

test('corrupt learning file remains untouched and prevents writes', t => {
  const { data } = fixture(t);
  const store = createLearningStore(data);
  const filename = path.join(data, 'learning-progress.json');
  fs.writeFileSync(filename, '{broken');
  assert.throws(() => createLearningStore(data), /原文件已保留/);
  assert.throws(() => store.setItem(LEARNING_KEYS[0], '[]'), /原文件已保留/);
  assert.equal(fs.readFileSync(filename, 'utf8'), '{broken');
});

test('plan import preserves original and verifies hashes, excludes locks and non Markdown, refuses overwrite', async t => {
  const { source, data } = fixture(t);
  fs.writeFileSync(path.join(source, '计划', '.lock'), JSON.stringify({ pid: 2147483647 }));
  fs.writeFileSync(path.join(source, '计划', 'ignored.txt'), 'not imported');
  fs.mkdirSync(path.join(data, '计划', '草稿'), { recursive: true });
  const result = await importPlan(source, data);
  assert.equal(result.fileCount, 1);
  const original = fs.readFileSync(path.join(source, '计划', '日志', 'sample.md'));
  assert.deepEqual(fs.readFileSync(path.join(data, '计划', '日志', 'sample.md')), original);
  assert.equal(result.files[0].sha256, createHash('sha256').update(original).digest('hex'));
  assert.equal(fs.existsSync(path.join(data, '计划', '.lock')), false);
  assert.equal(fs.existsSync(path.join(data, '计划', 'ignored.txt')), false);
  await assert.rejects(importPlan(source, data), /已有数据/);
});

test('active source lock prevents import and leaves target retryable', async t => {
  const { source, data } = fixture(t);
  const lock = path.join(source, '计划', '.lock');
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid }));
  await assert.rejects(importPlan(source, data), /正在运行/);
  assert.equal(fs.existsSync(path.join(data, '计划')), false);
  fs.unlinkSync(lock);
  assert.equal((await importPlan(source, data)).fileCount, 1);
});

test('junctions within sources or ancestor paths cannot escape import and backup boundaries', async t => {
  const { root, source, data, backups } = fixture(t);
  const link = path.join(source, '计划', 'linked');
  fs.symlinkSync(backups, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(importPlan(source, data), /链接/);
  fs.unlinkSync(link);
  const alias = path.join(root, 'alias');
  fs.symlinkSync(data, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => createLearningStore(path.join(alias, 'nested')), /链接/);
  await assert.rejects(backupData(source, alias), /链接/);
});

test('backup includes only plan Markdown and learning JSON; destination cannot be inside data', async t => {
  const { source, data, backups } = fixture(t);
  await importPlan(source, data);
  createLearningStore(data).setItem(LEARNING_KEYS[0], '["foundation:1"]');
  fs.writeFileSync(path.join(data, 'browser-cache'), 'secret cache');
  fs.writeFileSync(path.join(data, '计划', '.lock'), JSON.stringify({ pid: 2147483647 }));
  const result = await backupData(data, backups);
  assert.equal(result.fileCount, 2);
  assert.deepEqual(fs.readdirSync(result.directory).sort(), ['learning-progress.json', '计划'].sort());
  assert.equal(fs.existsSync(path.join(result.directory, '计划', '.lock')), false);
  assert.equal(createLearningStore(result.directory).getItem(LEARNING_KEYS[0]), '["foundation:1"]');
  await assert.rejects(backupData(data, data), /不能位于/);
  assert.notEqual((await backupData(data, backups)).directory, result.directory);
});

test('backup refuses a running service and keeps the destination clean', async t => {
  const { source, data, backups } = fixture(t);
  await importPlan(source, data);
  fs.writeFileSync(path.join(data, '计划', '.lock'), JSON.stringify({ pid: process.pid }));
  await assert.rejects(backupData(data, backups), /正在运行/);
  assert.deepEqual(fs.readdirSync(backups), []);
});

test('hardlinked progress cannot be read or overwritten', t => {
  const { root, data } = fixture(t);
  const original = path.join(root, 'external.json');
  fs.writeFileSync(original, JSON.stringify(document({})));
  fs.linkSync(original, path.join(data, 'learning-progress.json'));
  assert.throws(() => createLearningStore(data), /链接/);
});
