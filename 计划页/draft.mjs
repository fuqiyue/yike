import { localDate, readDay, validDate } from './log.mjs';

const bad = message => Object.assign(new Error(message), { status: 400 });
export function makeDraft(template, events, date) {
  if (!validDate(date)) throw bad('日期格式不正确');
  const match = template.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error('实录模板缺少字段区');
  const due = new Date(`${date}T12:00:00`); due.setDate(due.getDate() + 30);
  const replacements = new Map([
    ['编号', '<待填写>'], ['标题', '<待填写>'], ['睡眠', '<待填写>'],
    ['阶段', '快录'], ['状态', '在办'], ['发生日', date], ['复核日', localDate(due)],
    ['失效触发', '未触发'], ['执行', '未填'], ['推测', '无'], ['推测来源', '不适用'], ['兑现', '不适用'],
    ['\u5366域', '未决'], ['定域\u5366', '未决'], ['定位\u723b', '未决'], ['经文\u5224\u8bcd', '未决'], ['\u5409\u51f6倾向', '未决'], ['起\u5366', '不适用']
  ]);
  const seen = new Set();
  const front = match[1].split(/\r?\n/).map(line => {
    const key = line.slice(0, line.indexOf(':'));
    if (!replacements.has(key)) return line;
    seen.add(key); return `${key}: ${replacements.get(key)}`;
  }).join('\n');
  if ([...replacements.keys()].some(key => !seen.has(key))) throw new Error('实录模板字段已变更，请检查模板契约');
  const headings = [...template.matchAll(/^## ([一二三四五六七])、[^\r\n]+/gm)].map(item => item[0]);
  if (headings.length !== 7) throw new Error('实录模板章节已变更，请检查模板契约');
  const facts = events.filter(event => ['始', '止', '完', '行'].includes(event.verb)).map(event => {
    const prefix = `- ${event.time} · ${event.id} · `;
    if (event.verb === '始') return `${prefix}开始专注，计划 ${event.minutes} 分钟。`;
    if (event.verb === '止') return `${prefix}结束专注，记录时长 ${event.minutes} 分钟，状态：${event.outcome}。`;
    if (event.verb === '行') return `${prefix}${event.action === 'start' ? '开始执行' : '暂停执行'}。`;
    return `${prefix}标记完成。`;
  });
  const reactions = events.filter(event => ['记', '注', '改'].includes(event.verb)).map(event => `> ${event.time} · ${event.id} · ${event.verb}：${(event.text + (event.body ? '\n' + event.body : '')).replace(/[<>]/g, char => char === '<' ? '&lt;' : '&gt;').replace(/\r?\n/g, '\n> ')}`);
  const sections = headings.map((heading, index) => `${heading}\n\n${index === 0 ? facts.join('\n') : index === 1 ? reactions.join('\n\n') : ''}`);
  return `---\n# 移入 实录/在办/ 前必填：编号／标题／睡眠。\n# 默认 阶段: 快录；请逐项核对记录。\n# 用户文字保留在第二段，是否提升为事实由你判断。\n${front}\n---\n\n# <待填写标题>\n\n${sections.join('\n\n')}\n`;
}
export async function generateDraft(store, date) {
  if (!validDate(date)) throw bad('日期格式不正确');
  const { events } = await readDay(store.guard, date);
  if (!events.length) throw bad('这一天还没有可生成草稿的记录');
  const template = await store.guard.readText('实录/_模板-实录.md');
  const content = makeDraft(template, events, date);
  for (let n = 0; n < 1000; n++) {
    const filename = `计划/草稿/${date}-实录草稿${n ? `-${n}` : ''}.md`;
    try { await store.guard.writeNew(filename, content); return { path: filename }; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  throw new Error('草稿文件数量过多，请检查草稿目录');
}
