import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseTrigrams, parseStructureTable, calculateStructure, validateLibrary, gradeAttempt } from './public/structure.js';

const card65 = await readFile(new URL('../知识库/知识卡65-全64卦结构速查表.md', import.meta.url), 'utf8');
const card66 = await readFile(new URL('../知识库/知识卡66-入门学习路径.md', import.meta.url), 'utf8');
const trigrams = parseTrigrams(card66);
const rows = parseStructureTable(card65);

test('all 64 calculated structures agree with authoritative card65', () => {
  assert.equal(rows.length, 64);
  assert.deepEqual(validateLibrary(rows, trigrams), []);
  for (const row of rows) {
    assert.equal(gradeAttempt(row.bits, row, trigrams).status, 'correct');
    for (let index = 0; index < 6; index++) {
      const wrong = [...row.bits]; wrong[index] = 1 - wrong[index];
      const result = gradeAttempt(wrong, row, trigrams);
      assert.equal(result.status, 'incorrect');
      assert.equal(result.matches[index], false);
    }
  }
});

test('boundary riding, extreme counts and seven non-riding hexagrams match source answers', () => {
  assert.deepEqual(rows.find(row => row.id === 39).riding, ['六四', '上六']);
  assert.equal(rows.find(row => row.id === 50).count, 1);
  assert.equal(rows.find(row => row.id === 38).count, 1);
  assert.equal(rows.find(row => row.id === 63).count, 6);
  assert.equal(rows.find(row => row.id === 64).count, 0);
  assert.deepEqual(rows.filter(row => !row.riding.length).map(row => row.id), [1, 2, 12, 20, 23, 33, 44]);
  assert.deepEqual(calculateStructure(rows.find(row => row.id === 39).bits).central, ['六二', '九五']);
});

test('injected source disagreement fails closed and returns the card values, never computed substitutes', () => {
  const row = structuredClone(rows.find(row => row.id === 63));
  row.count = 5;
  row.riding = ['上六'];
  const result = gradeAttempt(row.bits, row, trigrams);
  assert.equal(result.status, 'source-mismatch');
  assert.equal(result.matches, null);
  assert.equal(result.authority.count, 5);
  assert.deepEqual(result.authority.riding, ['上六']);
  assert.equal(result.calculated.count, 6);
  assert.ok(result.issues.includes('乘刚爻'));
});

test('incomplete authority and incomplete attempts cannot be graded', () => {
  assert.throws(() => parseStructureTable(card65.replace(/^\| 64 \|.+\r?\n/m, '')), /64卦/);
  assert.throws(() => gradeAttempt([null, 0, 0, 0, 0, 0], rows[0], trigrams), /选完/);
  assert.throws(() => parseTrigrams(card66.replace('阳阳阳 111', '阳阳阳 ???')), /八行阴阳表/);
});
