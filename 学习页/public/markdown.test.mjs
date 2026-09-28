import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { plainText, renderMarkdown, slugify } from './markdown.js';

const cardDirectory = path.resolve(import.meta.dirname, '..', '..', '知识库');
const names = (await readdir(cardDirectory)).filter((name) => /^知识卡\d{2}-.+\.md$/.test(name));
const cards = names.map((filename) => {
  const [, id, title] = filename.match(/^知识卡(\d{2})-(.+)\.md$/);
  return { id: Number(id), title, filename };
});

test('renders every knowledge card without executable markup', async () => {
  assert.equal(cards.length, 75);
  for (const card of cards) {
    const raw = await readFile(path.join(cardDirectory, card.filename), 'utf8');
    const html = renderMarkdown(raw, { cards });
    assert.match(html, /<h1 id=/, card.filename);
    assert.doesNotMatch(html, /<script|\son\w+=|javascript:/i, card.filename);
  }
});

test('supports tables, folds, emphasis, lists and stable duplicate heading slugs', () => {
  const html = renderMarkdown('# 标题\n## 同名\n## 同名\n\n|甲|乙|\n|---|---|\n|**一**|二|\n\n<details>\n<summary>答案</summary>\n\n- *内容*\n\n</details>');
  assert.match(html, /id="同名"/);
  assert.match(html, /id="同名-2"/);
  assert.match(html, /<table>/);
  assert.match(html, /<details>/);
  assert.doesNotMatch(html, /<p><summary>/);
  assert.match(html, /<strong>一<\/strong>/);
  assert.match(html, /<em>内容<\/em>/);
});

test('preserves ordered-list numbering across blank-line source groups', () => {
  const html = renderMarkdown('1. 第一项\n\n2. 第二项\n\n4. 第四项');
  assert.match(html, /<ol>\s*<li>第一项<\/li>\s*<\/ol>/);
  assert.match(html, /<ol start="2">\s*<li>第二项<\/li>\s*<\/ol>/);
  assert.match(html, /<ol start="4">\s*<li>第四项<\/li>\s*<\/ol>/);
});

test('escapes active HTML and does not load markdown URLs or images', () => {
  const html = renderMarkdown('<script>alert(1)</script>\n<img src=x onerror=alert(2)>\n[点我](javascript:alert(3))\n![远图](https://example.test/a.png)');
  assert.doesNotMatch(html, /<script\b|<img\b|href="javascript:/i);
  assert.match(html, /&lt;img src=x onerror=alert\(2\)&gt;/);
  assert.match(html, /图片：远图/);
});

test('routes explicit card references, including 12 to the 11–12 combined card', () => {
  const html = renderMarkdown('参见知识卡02和知识卡12；普通数字 12 不处理。', { cards });
  assert.match(html, /data-card-id="2"/);
  assert.match(html, /知识卡12<\/a>/);
  assert.match(html, /data-card-id="11"/);
  assert.match(html, /普通数字 12 不处理/);
});

test('plain text and slugs remove markdown punctuation', () => {
  assert.equal(plainText('**定域** → `定位`'), '定域 → 定位');
  assert.equal(slugify('八、七个最容易犯的错'), '八-七个最容易犯的错');
});
