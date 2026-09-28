import test from 'node:test';
import assert from 'node:assert/strict';
import { LEARNING_KEYS, resolveLearningStorage, exportLearningProgress } from './public/storage.js';

test('desktop bridge wins without touching browser storage; browser remains compatible', () => {
  const bridge = { getItem() {}, setItem() {} };
  const browser = { getItem() {}, setItem() {} };
  assert.equal(resolveLearningStorage({ window: { yijingStorage: bridge }, get localStorage() { throw new Error('must not read browser storage'); } }), bridge);
  assert.equal(resolveLearningStorage({ localStorage: browser }), browser);
  assert.equal(resolveLearningStorage({ window: { yijingStorage: {} }, localStorage: browser }), browser);
});

test('export contains only allowlisted learning keys and preserves raw JSON', () => {
  const data = new Map([[LEARNING_KEYS[0], '["foundation-1"]'], [LEARNING_KEYS[2], '{"1":"yes"}'], ['personal-record', 'private']]);
  const read = [];
  const result = exportLearningProgress({ getItem(key) { read.push(key); return data.get(key) ?? null; } });
  assert.deepEqual(read, LEARNING_KEYS);
  assert.deepEqual(result, { format: 'yijing-learning', version: 1, values: { [LEARNING_KEYS[0]]: '["foundation-1"]', [LEARNING_KEYS[2]]: '{"1":"yes"}' } });
});

test('unreadable or corrupt progress fails visibly instead of exporting a misleading empty backup', () => {
  assert.throws(() => exportLearningProgress({ getItem() { throw new Error('storage denied'); } }), /storage denied/);
  assert.throws(() => exportLearningProgress({ getItem() { return '{broken'; } }), SyntaxError);
  assert.throws(() => exportLearningProgress({ getItem() { return {}; } }), /格式异常/);
  assert.deepEqual(exportLearningProgress({ getItem() { return null; } }).values, {});
});
