import { renderMarkdown } from './markdown.js';
import { STAGE_CARDS, parsePathTable, remainingHexagramCards, parseLearningPlan } from './course-data.js';
import { parseTrigrams } from './structure.js';
import { learningStorage } from './storage.js';

const STORAGE_KEY = 'yijing-course-progress-v1';
const DOMAIN_KEY = 'yijing-course-domain-cards-v1';

function loadProgress() {
  try { return new Set(JSON.parse(learningStorage.getItem(STORAGE_KEY) || '[]')); } catch { return new Set(); }
}

function saveProgress(progress) {
  try { learningStorage.setItem(STORAGE_KEY, JSON.stringify([...progress])); return true; } catch { return false; }
}

function loadDomains() {
  try { return JSON.parse(learningStorage.getItem(DOMAIN_KEY) || '[]').map(Number).filter(Number.isInteger).slice(0, 3); } catch { return []; }
}

function saveDomains(ids) {
  try { learningStorage.setItem(DOMAIN_KEY, JSON.stringify(ids)); return true; } catch { return false; }
}

export async function mountCourse(container, context) {
  const card = await context.getCard(66);
  let rows, plan, trigrams;
  try { rows = parsePathTable(card.markdown); plan = parseLearningPlan(card.markdown, context.cards); trigrams = parseTrigrams(card.markdown); } catch (error) {
    container.innerHTML = `<section class="error-card"><p class="eyebrow">实时源结构错误</p><h1>课程路径无法生成</h1><p>${escapeHtml(error.message)}</p><a class="ink-button" href="#reader/66">打开知识卡66原文 →</a></section>`;
    throw Object.assign(error, { rendered: true });
  }
  const progress = loadProgress();
  const availableHexagrams = context.cards.filter(({ id }) => Number(id) >= 1 && Number(id) <= 64);
  let domains = [...new Set(loadDomains())].filter(id => availableHexagrams.some(card => Number(card.id) === id));

  const render = () => {
    const expandedStages = [...container.querySelectorAll('.stage-card[open]')].map(stage => stage.id);
    const stageCards = rows.map((_, index) => {
      if (index === 7) return remainingHexagramCards(context.cards);
      if (index === 5) return [STAGE_CARDS[5][0], ...domains.map((id) => {
        const cardItem = context.cards.find((item) => Number(item.id) === id);
        return { id, label: cardItem?.title || `知识卡 ${id}`, removable: true };
      })];
      return STAGE_CARDS[index] || [];
    });
    container.innerHTML = `
    <div class="course-layout">
      <aside class="course-rail" aria-label="课程章节">
        <p class="eyebrow">从三画到六画</p>
        <ol><li><a href="#course/foundation-1"><span>起步</span>七天学八卦</a></li>${rows.map((row, i) => `<li><a href="#course/stage-${i}"><span>${escapeHtml(row[0])}</span>${escapeHtml(i === 5 ? '选修 · 定域应用' : i === 6 ? '选修 · 横读专题' : row[1].replace(/：.*/, ''))}</a></li>`).join('')}</ol>
        <a class="course-schedule" href="#reader/66/十-每天-20-分钟的十九周首轮">每天20分钟 · 完整日程 ↗</a>
      </aside>
      <article class="course-page">
        <header class="course-hero">
          <p class="eyebrow">知识卡 66 · 可执行路径</p>
          <h1>先识<em>八卦</em><br>再读六十四卦</h1>
          <p class="hero-lede">先用七天认识三画八卦，再把上下卦叠成六爻。从八纯卦起步，逐组学完六十四卦。</p>
          <div class="proof-strip"><strong>8 个构件 → 64 种组合</strong><span>基础七课 · 每天20分钟</span><span>首轮19周，可按掌握程度调整</span></div>
          <p class="factual-note">主线：八卦基础 → 第0–4阶的24卦 → 第7阶补齐40卦。第5–6阶为应用选修。</p>
        </header>
        <section class="foundation-section" aria-label="七天三画八卦基础">
          <div class="section-heading"><p class="eyebrow">先从这里开始</p><h2>认识八个三画卦</h2><p>每课有练习与过关标准。完成后自行勾选，随时可以回来复习。</p></div>
          ${plan.lessons.map(lesson => foundationMarkup(lesson, progress, context.cards, trigrams)).join('')}
          <a class="ink-button" href="#course/stage-0">八卦认形学会了，开始叠卦 →</a>
        </section>
        <section class="stage-list" aria-label="八阶课程">
          <div class="section-heading"><p class="eyebrow">接着读六爻卦</p><h2>从叠卦到完整六十四卦</h2></div>
          ${rows.map((row, i) => stageMarkup(row, i, progress, stageCards[i], plan, i === 5 ? domainChooser(availableHexagrams, domains) : '')).join('')}
        </section>
        <p class="storage-note" data-storage-note role="status" hidden>学习进度未能保存；本次打开期间仍可继续勾选。请稍后重试。</p>
        <section class="source-note"><p class="eyebrow">来源与读法</p>${renderMarkdown('> 基础课、路径表、过关标准与40卦分组实时取自知识卡66。学习顺序与白话助记属于教学编排；经传词汇在原卡注明出处。勾选表示自己确认读过，不代表自动判定掌握。')}<a href="#reader/66">阅读完整路径与首轮笔记模板 ↗</a></section>
      </article>
    </div>`;
    container.querySelectorAll('.stage-card').forEach((stage) => {
      if (expandedStages.includes(stage.id)) stage.open = true;
      updateStage(container, stage);
    });
  };
  render();

  const onChange = (event) => {
    const checkbox = event.target.closest('[data-progress]');
    if (!checkbox) return;
    checkbox.checked ? progress.add(checkbox.dataset.progress) : progress.delete(checkbox.dataset.progress);
    if (!saveProgress(progress)) showStorageNote(container);
    updateStage(container, checkbox.closest('.stage-card'));
  };
  const onClick = (event) => {
    const add = event.target.closest('[data-add-domain]');
    const remove = event.target.closest('[data-remove-domain]');
    if (add) {
      const select = container.querySelector('[data-domain-select]');
      const id = Number(select?.value);
      if (Number.isInteger(id) && domains.length < 3 && !domains.includes(id)) {
        domains = [...domains, id]; const saved = saveDomains(domains); render(); if (!saved) showStorageNote(container);
      }
    }
    if (remove) {
      const id = Number(remove.dataset.removeDomain);
      domains = domains.filter((item) => item !== id); const domainsSaved = saveDomains(domains); progress.delete(`5:${id}`); const progressSaved = saveProgress(progress); render(); if (!domainsSaved || !progressSaved) showStorageNote(container);
    }
  };
  container.addEventListener('change', onChange);
  container.addEventListener('click', onClick);
  return () => { container.removeEventListener('change', onChange); container.removeEventListener('click', onClick); };
}

function foundationMarkup(lesson, progress, cards, trigrams) {
  const key = `foundation:${lesson.day}`;
  const examples = trigrams.filter(item => lesson.markdown.includes(`${item.name}${item.symbol}：`));
  return `<details class="stage-card foundation-card" id="foundation-${lesson.day}" ${lesson.day === 1 ? 'open' : ''}>
    <summary><span class="stage-number">${String(lesson.day).padStart(2, '0')}</span><span class="stage-title"><small>第${lesson.day}天 · 三画八卦</small><strong>${escapeHtml(lesson.title)}</strong></span><span class="stage-count" data-stage-count>0/1</span></summary>
    <div class="stage-body">${examples.length ? `<div class="trigram-pair">${examples.map(item => `<figure><span class="trigram-symbol" role="img" aria-label="${item.name}，从下往上${item.bits.map(bit => bit ? '阳' : '阴').join('、')}">${item.symbol}</span><figcaption><strong>${item.name}</strong><span>下→上 ${item.bits.join('')}</span></figcaption></figure>`).join('')}</div>` : ''}<div class="markdown-body">${renderMarkdown(lesson.markdown, { cards })}</div><label class="foundation-check"><input type="checkbox" data-progress="${key}" ${progress.has(key) ? 'checked' : ''}> 已完成第${lesson.day}天练习并自查</label>${lesson.day < 7 ? `<a class="lesson-next" href="#course/foundation-${lesson.day + 1}">下一课 →</a>` : '<a class="lesson-next" href="#course/stage-0">进入叠卦 →</a>'}</div>
  </details>`;
}

function readingList(cards, index, progress) {
  return `<ul class="reading-list">${cards.map((item) => {
    const key = `${index}:${item.id}`;
    return `<li><label><input type="checkbox" data-progress="${key}" aria-label="已读 ${escapeHtml(item.label)}" ${progress.has(key) ? 'checked' : ''}><span aria-hidden="true"></span></label><a href="#reader/${item.id}">${escapeHtml(item.label)}</a>${item.removable ? `<button class="text-button" type="button" data-remove-domain="${item.id}" aria-label="移除${escapeHtml(item.label)}">移除</button>` : ''}</li>`;
  }).join('')}</ul>`;
}

function stageMarkup(row, index, progress, cards, plan, extra = '') {
  const special = index === 5 ? '<p class="turning-point">分水岭 · 从「学易」变成「用易」</p>' : '';
  const factualNote = index === 7 ? '<p class="factual-note">前面24卦＋本阶40卦＝64卦。每周一组：4天读新卦，3天对照与复习。</p>' : '';
  return `<details class="stage-card${index === 5 ? ' is-pivot' : ''}" id="stage-${index}">
    <summary><span class="stage-number">${escapeHtml(row[0])}</span><span class="stage-title"><small>${escapeHtml(row[5])} · ${escapeHtml(row[3])}</small><strong>${escapeHtml(row[1])}</strong></span><span class="stage-count" data-stage-count>0/${cards.length}</span></summary>
    <div class="stage-body">${special}<p>${escapeHtml(row[4])}</p>${factualNote}
      <dl class="stage-facts"><div><dt>范围</dt><dd>${escapeHtml(row[2])}</dd></div><div><dt>本次任务</dt><dd>${escapeHtml(row[3])}</dd></div><div><dt>建议时长</dt><dd>${escapeHtml(row[5])}</dd></div></dl>
      <p class="stage-goal"><strong>过关自查</strong>${escapeHtml(plan.goals[index])}</p>
      ${extra}${index === 7 ? plan.groups.map(group => `<section class="completion-group"><h3>第${group.number}组 <span>4卦</span></h3>${readingList(group.cards, index, progress)}<p class="factual-note">${escapeHtml(group.question)}</p></section>`).join('') : readingList(cards, index, progress)}
      ${index === 0 ? '<a class="ink-button" href="#practice">进入手算练习 →</a>' : ''}
      ${index === 4 ? '<a class="ink-button" href="#course/stage-7">继续主线：补全其余40卦 →</a>' : ''}
      ${index === 7 ? '<a class="ink-button" href="#quiz">完成后去知识卡75自测 →</a>' : ''}
    </div>
  </details>`;
}

function domainChooser(cards, selected) {
  const choices = cards.filter(({ id }) => !selected.includes(Number(id)));
  return `<div class="domain-chooser"><label for="domain-card">选择路由命中的卦卡（最多 3 张）</label><div><select id="domain-card" data-domain-select ${selected.length >= 3 ? 'disabled' : ''}>${choices.map(({ id, title }) => `<option value="${id}">${escapeHtml(title || `知识卡 ${id}`)}</option>`).join('')}</select><button type="button" data-add-domain ${selected.length >= 3 || choices.length === 0 ? 'disabled' : ''}>加入本阶</button></div><small>选择与已读状态只保存在本机。</small></div>`;
}

function escapeHtml(value) {
  const node = document.createElement('div'); node.textContent = String(value); return node.innerHTML;
}

function showStorageNote(container) {
  const note = container.querySelector('[data-storage-note]');
  if (note) note.hidden = false;
}

function updateStage(container, stage) {
  if (!stage) return;
  const checks = [...stage.querySelectorAll('[data-progress]')];
  const done = checks.filter((item) => item.checked).length;
  stage.querySelector('[data-stage-count]').textContent = `${done}/${checks.length}`;
  stage.classList.toggle('is-complete', checks.length > 0 && done === checks.length);
}
