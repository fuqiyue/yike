import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { STAGE_CARDS, parsePathTable, remainingHexagramCards, parseLearningPlan } from './course-data.js';
import { parseStructureTable, parseTrigrams } from './structure.js';

const markdown = await readFile(new URL('../../知识库/知识卡66-入门学习路径.md', import.meta.url), 'utf8');
const rows = parsePathTable(markdown);

assert.equal(rows.length, 8, '知识卡66路径表应恰有八阶');
assert.deepEqual(rows.map((row) => row[0]), ['0', '1', '2', '3', '4', '5', '6', '7']);
assert.match(rows[5][4], /分水岭/);
assert.equal(STAGE_CARDS[1].find((card) => card.label === '坤 2').id, 2);
assert.equal(STAGE_CARDS[3].find((card) => card.label.includes('否 12')).id, 11);
assert.throws(() => parsePathTable('## 一、路径总表\n| 阶 | 读什么 |'), /结构缺失/);
const remaining = remainingHexagramCards([{ id: 1, title: '乾' }, { id: 12, title: '不存在的独立否卡' }, { id: 13, title: '同人' }, { id: 67, title: '专题' }]);
assert.deepEqual(remaining.map(({ id }) => id), [13]);
console.log('course: 8-stage source table and card aliases verified');

const filenames = (await readdir(new URL('../../知识库/', import.meta.url))).filter(name => /^知识卡\d{2}-/.test(name));
const cards = filenames.map(filename => ({ id: Number(filename.match(/^知识卡(\d{2})/)[1]), filename }));
const plan = parseLearningPlan(markdown, cards);

test('七天基础课、八阶自查与10组补全从真实卡66读取', () => {
  assert.deepEqual(plan.lessons.map(item => item.day), [1, 2, 3, 4, 5, 6, 7]);
  for (const lesson of plan.lessons) {
    assert.ok(markdown.includes(lesson.markdown));
    assert.match(lesson.markdown, /练习/);
    assert.match(lesson.markdown, /过关/);
  }
  assert.equal(plan.goals.length, 8);
  assert.equal(plan.groups.length, 10);
  assert.match(plan.lessons[6].markdown, /明天怎么开始/);
  const changed = parseLearningPlan(markdown.replace('阴阳与读图方向', '阴阳与读图方向（更新）'), cards);
  assert.equal(changed.lessons[0].title, '阴阳与读图方向（更新）');
});

test('先24卦加分组40卦完整覆盖1–64，泰否合卡保持原阅读进度键', () => {
  const core = new Set([1, 2, 3, 4].flatMap(stage => STAGE_CARDS[stage].map(({ id }) => id)));
  core.add(12); // card11 contains both hexagrams.
  assert.equal(core.size, 24);
  const completionIds = plan.groups.flatMap(group => group.cards.map(({ id }) => id));
  assert.equal(completionIds.length, 40);
  assert.ok(completionIds.every(id => !core.has(id)));
  assert.deepEqual([...core, ...completionIds].sort((a, b) => a - b), Array.from({ length: 64 }, (_, i) => i + 1));
  assert.deepEqual(completionIds.slice().sort((a, b) => a - b), remainingHexagramCards(cards).map(({ id }) => id));
  for (const id of completionIds) assert.ok(cards.some(card => card.id === id));
});

test('缺课、缺自查、重复卦或来源少卡时拒绝生成课程', () => {
  assert.throws(() => parseLearningPlan(markdown.replace('### 第4天：', '### 复习：'), cards), /七天/);
  assert.throws(() => parseLearningPlan(markdown.replace('### 各阶过关标准', '### 已移除'), cards), /过关标准/);
  assert.throws(() => parseLearningPlan(markdown.replace('13 同人、14 大有', '14 大有、14 大有'), cards), /40卦/);
  assert.throws(() => parseLearningPlan(markdown, cards.filter(card => card.id !== 13)), /40卦/);
});

test('基础课阴阳例子与叠卦示例逐项对照卡65', async () => {
  const authority = parseStructureTable(await readFile(new URL('../../知识库/知识卡65-全64卦结构速查表.md', import.meta.url), 'utf8'));
  const trigrams = parseTrigrams(markdown);
  const examples = [...plan.lessons.map(item => item.markdown).join('\n').matchAll(/([乾坤震艮离坎巽兑])[☰☷☳☶☲☵☴☱]：([01]{3})/g)];
  assert.equal(examples.length, 8);
  for (const [, name, bits] of examples) assert.equal(bits, trigrams.find(item => item.name === name).bits.join(''));
  const combinations = [...plan.lessons[6].markdown.matchAll(/^\| ([乾坤震艮离坎巽兑]) \| ([乾坤震艮离坎巽兑]) \| (\d+) (\S+) \|/gm)];
  assert.equal(combinations.length, 5);
  for (const [, lower, upper, id, name] of combinations) {
    const row = authority.find(item => item.id === Number(id));
    assert.deepEqual([lower, upper, name], [row.lower, row.upper, row.name]);
  }
});
