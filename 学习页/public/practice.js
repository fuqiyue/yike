import { renderMarkdown } from './markdown.js';
import { parseTrigrams, parseStructureTable, calculateStructure, compareWithAuthority, validateLibrary, gradeAttempt, section } from './structure.js';

const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const labels = ['初爻', '二爻', '三爻', '四爻', '五爻', '上爻'];
const list = values => values.length ? values.join('、') : '无';

export async function mountPractice(container, context) {
  const [reference, course] = await Promise.all([context.getCard(65), context.getCard(66)]);
  const trigrams = parseTrigrams(course.markdown);
  const rows = parseStructureTable(reference.markdown);
  const sourceSection = section(course.markdown, '## 二、第 0 阶');
  const selfTestStart = sourceSection.indexOf('### 第 0 阶自测');
  if (selfTestStart < 0) throw new Error('知识卡66 的第0阶自测缺失');
  const selfTest = sourceSection.slice(selfTestStart);
  const warning = selfTest.split('<details>')[1]?.match(/^4\. (.+)$/m)?.[1];
  if (!warning) throw new Error('知识卡66 第4题答案缺失，不能展示教学警告');
  const failures = validateLibrary(rows, trigrams);
  let lower = '巽';
  let upper = '离';
  let bits = Array(6).fill(null);
  let submitted = false;
  const options = selected => trigrams.map(item => `<option value="${item.name}"${item.name === selected ? ' selected' : ''}>${item.name} ${item.symbol}</option>`).join('');

  container.innerHTML = `<section class="practice-page">
    <header class="practice-heading"><p class="eyebrow">第 0 阶 · 结构层</p><h1>从六条爻开始</h1><p>先看上下卦，再从初爻往上拼。答案逐项对照知识卡65。</p></header>
    <div class="practice-warning markdown-body">${renderMarkdown(warning, { cards: context.cards })}<a href="#reader/66">出处：知识卡66 · 第0阶自测第4题</a></div>
    <p class="practice-validation" role="status">${failures.length ? `来源校验发现 ${failures.length} 卦不一致，已停止判分。` : '64 / 64 卦结构校验一致 · 以知识卡65为准'}</p>
    ${failures.length ? `<div class="practice-error" role="alert"><h2>计算与卡内值不一致</h2>${failures.map(result => `<p>${result.authority.id} ${escape(result.authority.name)}：${escape(result.issues.join('、'))}不一致。卡内当位爻：${escape(list(result.authority.correct))}；当位数：${result.authority.count}；乘刚爻：${escape(list(result.authority.riding))}；六爻：${escape(result.authority.lines.join(' '))}。</p>`).join('')}<a href="#reader/65">打开知识卡65核对</a></div>` : ''}
    <div class="practice-workbench">
      <section class="practice-build" aria-labelledby="build-heading"><h2 id="build-heading">拼出这个卦</h2>
        <div class="practice-selectors"><label>下卦<select id="lower-trigram">${options(lower)}</select></label><span aria-hidden="true">＋</span><label>上卦<select id="upper-trigram">${options(upper)}</select></label></div>
        <p class="practice-direction">由下往上：初、二、三为下卦；四、五、上为上卦。</p>
        <div id="line-builder" class="line-builder"></div>
        <div class="practice-actions"><button type="button" id="check-structure" class="primary-button"${failures.length ? ' disabled' : ''}>对照知识卡65</button><button type="button" id="reset-structure">重新拼</button></div>
        <p id="practice-result" role="status" aria-live="polite"></p>
      </section>
      <section class="practice-reading" aria-labelledby="structure-heading"><h2 id="structure-heading">六爻里的结构</h2><div id="structure-preview"></div><a href="#reader/65">查结构速查表 ↗</a></section>
    </div>
    <details class="practice-source"><summary>八行阴阳、三个动作与当位数公式</summary><div class="markdown-body">${renderMarkdown(sourceSection.slice(0, selfTestStart), { cards: context.cards })}</div></details>
    <section class="practice-original markdown-body">${renderMarkdown(selfTest, { cards: context.cards })}<a href="#reader/66">阅读完整入门学习路径 ↗</a></section>
  </section>`;

  const builder = container.querySelector('#line-builder');
  const result = container.querySelector('#practice-result');
  const preview = container.querySelector('#structure-preview');
  const target = () => rows.find(row => row.lower === lower && row.upper === upper);
  function drawLines() {
    builder.innerHTML = [5, 4, 3, 2, 1, 0].map(index => `<div class="line-choice" data-position="${index}"><span class="line-label">${labels[index]}</span><div class="line-options" role="group" aria-label="${labels[index]}阴阳"><button type="button" data-index="${index}" data-bit="1" aria-pressed="${bits[index] === 1}" aria-label="${labels[index]}阳"><span class="yang-line" aria-hidden="true"></span>阳</button><button type="button" data-index="${index}" data-bit="0" aria-pressed="${bits[index] === 0}" aria-label="${labels[index]}阴"><span class="yin-line" aria-hidden="true"></span>阴</button></div><span class="line-hint">${index > 2 ? '上卦' : '下卦'}</span></div>`).join('');
  }
  function structureMarkup(row, computed) {
    return `<p class="practice-hexagram">${escape(row.name)} <span>第 ${row.id} 卦</span></p><p class="practice-code">${row.bits.join('')} <small>自下往上</small></p><dl class="structure-facts"><div><dt>六爻</dt><dd>${escape(row.lines.join(' '))}</dd></div><div><dt>当位爻</dt><dd>${escape(list(row.correct))}</dd></div><div><dt>当位数</dt><dd>${row.count} / 6</dd></div><div><dt>乘刚爻</dt><dd>${escape(list(row.riding))}</dd></div><div><dt>得中</dt><dd>${escape(list([row.lines[1], row.lines[4]]))}</dd></div></dl><p class="practice-footnote">上列位属性取自知识卡65；得中按该卡第一节定义取二、五爻。${computed ? '教学计算已逐项校验。' : ''}</p>`;
  }
  function update() {
    const completed = bits.every(bit => bit !== null);
    container.querySelector('#check-structure').disabled = failures.length > 0 || !completed;
    if (!completed) {
      preview.innerHTML = `<p class="practice-empty">已选 ${bits.filter(bit => bit !== null).length} / 6 爻。选完后，会显示你拼出的卦及其当位、得中与乘刚。</p>`;
      result.textContent = '';
      return;
    }
    const own = rows.find(row => row.bits.join('') === bits.join(''));
    if (!own) {
      preview.innerHTML = '<p role="alert">知识卡65 未找到这个六爻组合，已停止判分。</p>';
      container.querySelector('#check-structure').disabled = true;
      return;
    }
    const verified = compareWithAuthority(own, trigrams);
    preview.innerHTML = `<p>${submitted ? '你拼出的卦' : '当前拼法的结构'}</p>${structureMarkup(own, verified.ok)}${!verified.ok ? '<p role="alert">计算与表格不一致，以上保留卡内值。</p>' : ''}`;
    if (!submitted) result.textContent = '';
  }
  function reset() { bits = Array(6).fill(null); submitted = false; drawLines(); update(); }
  builder.addEventListener('click', event => {
    const button = event.target.closest('button[data-index]');
    if (!button) return;
    bits[Number(button.dataset.index)] = Number(button.dataset.bit);
    submitted = false;
    // Keep the focused button alive for keyboard and screen-reader users.
    builder.querySelectorAll(`button[data-index="${button.dataset.index}"]`).forEach(item => item.setAttribute('aria-pressed', String(Number(item.dataset.bit) === bits[Number(item.dataset.index)])));
    update();
  });
  container.querySelector('#lower-trigram').addEventListener('change', event => { lower = event.target.value; reset(); });
  container.querySelector('#upper-trigram').addEventListener('change', event => { upper = event.target.value; reset(); });
  container.querySelector('#reset-structure').addEventListener('click', reset);
  container.querySelector('#check-structure').addEventListener('click', () => {
    if (failures.length || bits.some(bit => bit === null)) return;
    const grade = gradeAttempt(bits, target(), trigrams);
    submitted = true;
    update();
    if (grade.status === 'source-mismatch') {
      result.textContent = '计算与知识卡65不一致，无法判分。';
    } else if (grade.status === 'correct') {
      result.textContent = `六爻全对。下${lower}上${upper}是${target().name}${target().id}，当位 ${target().count}/6；这是结构核对结果。`;
    } else {
      result.textContent = `请再核对${grade.matches.flatMap((match, index) => match ? [] : [labels[index]]).join('、')}。下${lower}上${upper}的卡内答案如下。`;
      preview.innerHTML += `<details open class="practice-correction"><summary>目标卦的卡内答案</summary>${structureMarkup(target(), true)}</details>`;
    }
  });
  drawLines();
  update();
}
