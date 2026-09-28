export const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
export function dateKey(date = new Date()) { return date.getFullYear() + '-' + String(date.getMonth()+1).padStart(2,'0') + '-' + String(date.getDate()).padStart(2,'0'); }
export function addDays(base, days) { const date = new Date(base + 'T12:00:00'); date.setDate(date.getDate() + days); return dateKey(date); }
export function validDay(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(new Date(value + 'T12:00:00').getTime()) && dateKey(new Date(value + 'T12:00:00')) === value; }
export function dateSuggestion(text, base = dateKey()) {
  if (!validDay(base)) return null;
  if (/大后天|下下周|上周|上上周|昨天|前天/.test(text)) return null;
  const tokens = [...text.matchAll(/\d{4}-\d{2}-\d{2}|今天|明天|后天|(?:下周|这周|周|星期)[一二三四五六日天]/g)];
  if (tokens.length !== 1) return null;
  const token = tokens[0][0]; let date;
  if (/^\d/.test(token)) { if (!validDay(token)) return null; date = token; }
  else if (['今天', '明天', '后天'].includes(token)) date = addDays(base, ['今天', '明天', '后天'].indexOf(token));
  else {
    const day = new Date(base + 'T12:00:00').getDay() || 7;
    const target = '一二三四五六日'.indexOf(token.at(-1).replace('天', '日')) + 1;
    let offset = target - day;
    if (token.startsWith('下周')) offset += 7;
    else if (!token.startsWith('这周') && offset < 0) offset += 7;
    date = addDays(base, offset);
  }
  const tail = text.slice(tokens[0].index + token.length);
  const field = /^(?:(?:上午|下午|晚上))?(?:之?前|截止|前交|前完成)/.test(tail) || /截止(?:到)?$/.test(text.slice(0,tokens[0].index)) ? 'due' : 'scheduled';
  const period = field === 'scheduled' ? (tail.match(/^(上午|下午|晚上)/)?.[1] || '') : '';
  return { field, date, period, label: (field === 'due' ? '截止 ' : '安排 ') + date.slice(5) + (period ? ' ' + period : '') };
}
export function taskView(task) {
  const date = field => task[field] && validDay(task[field].date) ? { date: task[field].date, period: task[field].period || '' } : null;
  return { id: task.id, text: task.text, done: Boolean(task.done), blocks: (task.blocks || []).map(block => ({ started: block.started, minutes: block.minutes, ended: block.ended, actual: block.actual })), created: task.created,
    notes: (task.notes || []).map(note => ({ text: note.text, at: note.at })), waiting: Boolean(task.waiting),
    scheduled: date('scheduled'), due: date('due'), review: date('review'), reviewResult: task.reviewResult || null,
    quadrant: Object.hasOwn(quadrants,task.quadrant) ? task.quadrant : null, recurrence: task.recurrence || 'none', amount: task.amount ?? null, currency: task.currency || 'CNY', anchorDate: task.anchorDate || null, completedAt: task.completedAt || null };
}
export const quadrants = { q1:'紧急 · 重要',q2:'紧急 · 不重要',q3:'不紧急 · 重要',q4:'不紧急 · 不重要' };
export const repeatLabels = { none:'不重复',daily:'每天',weekly:'每周',monthly:'每月',yearly:'每年' };
export function money(amount,currency='CNY') { return new Intl.NumberFormat('zh-CN',{style:'currency',currency,maximumFractionDigits:2}).format(amount); }
export function groupedRows(items,active,today,selectedId=null) {
  return ['q1','q2','q3','q4',null].map(key=>{
    const group=items.filter(t=>(t.quadrant||null)===key);
    return group.length ? '<li class="quadrant-heading" data-quadrant="'+(key||'unclassified')+'"><h3>'+ (quadrants[key]||'待分类') +'</h3><span>'+group.length+'</span></li>'+group.map(t=>rowHTML(t,active,today,t.id===selectedId)).join('') : '';
  }).join('');
}
export function eventHTML(event) {
  return '<li class="record is-done event-record" data-event-id="'+escapeHTML(event.eventId)+'"><span class="event-check" aria-hidden="true">✓</span><div class="record-copy"><span class="event-title">'+escapeHTML(event.text)+'</span><span class="record-meta"><time>'+escapeHTML(event.completedAt.replace('T',' '))+'</time>'+(event.due?'<span>本期到期 '+escapeHTML(event.due.date)+'</span>':'')+(event.amount!==null&&event.amount!==undefined?'<span>预计 '+escapeHTML(money(event.amount,event.currency))+'</span>':'')+'</span></div>'+(event.reversible?'<button class="undo-event" type="button" aria-label="撤销完成：'+escapeHTML(event.text)+'">撤销完成</button>':'<span class="section-note">已归档</span>')+'</li>';
}
export function costSummary(tasks,today) {
  const end=addDays(today,30), totals={},overdue={};
  for(const t of tasks) if(!t.done&&t.amount!==null&&t.amount!==undefined&&t.due?.date<=end) {
    const target=t.due.date<today?overdue:totals, currency=t.currency||'CNY';
    target[currency]=(target[currency]||0)+Math.round(t.amount*100);
  }
  const format=values=>Object.entries(values).map(([currency,cents])=>money(cents/100,currency)).join(' + ');
  return [Object.keys(totals).length?'30天内到期预计 '+format(totals):'',Object.keys(overdue).length?'已逾期预计 '+format(overdue):''].filter(Boolean).join(' · ')+(Object.keys(totals).length||Object.keys(overdue).length?'（每项仅计当前一期）':'');
}
export function listView(tasks) { return tasks.map(taskView).sort((a,b) => a.created.localeCompare(b.created)); }
export function timerState(tasks, now = Date.now()) {
  for (const task of tasks) {
    const block = (task.blocks || []).find(item => !item.ended);
    if (block) { const ends = new Date(block.started).getTime() + block.minutes * 60000; return { id: task.id, text: task.text, key: task.id + ':' + block.started, ends, remaining: Math.max(0, ends - now), expired: now >= ends }; }
  }
  return null;
}
export const needsRecovery = (tasks, now) => Boolean(timerState(tasks, now)?.expired);
export function durationValue(value) { const number = Number(value); return Number.isInteger(number) && number >= 1 && number <= 240 ? number : 25; }
export function loadDuration(storage) { try { return durationValue(storage.getItem('plan-duration')); } catch { return 25; } }
export function saveDuration(storage, value) { try { storage.setItem('plan-duration', String(durationValue(value))); } catch {} }
export function hasHistory(storage) { try { return storage.getItem('plan-has-history') === 'yes'; } catch { return false; } }
export function rememberHistory(storage) { try { storage.setItem('plan-has-history', 'yes'); } catch {} }
export function actualMinutes(task) { return Math.round((task.blocks || []).reduce((n,b) => n + (b.ended ? Number(b.actual || 0) : 0), 0)); }
export function isLater(task, day) { return !task.done && !task.waiting && task.scheduled?.date > day && !(task.due && task.due.date <= day); }
export function rowHTML(rawTask, active = false, today = dateKey(), selected = false) {
  const task = taskView(rawTask), running = task.blocks.some(b => !b.ended), count = task.blocks.filter(b => b.ended).length;
  const suggestion = !task.scheduled && !task.due && !task.done ? dateSuggestion(task.text, task.created.slice(0,10)) : null;
  const badges = [];
  if (task.recurrence !== 'none') badges.push(repeatLabels[task.recurrence] || '周期');
  if (task.amount !== null) badges.push(money(task.amount,task.currency));
  if (task.scheduled) badges.push('安排 ' + task.scheduled.date.slice(5) + ' ' + task.scheduled.period);
  if (task.due) badges.push((!task.done && task.due.date < today ? '已逾期 · ' : !task.done && task.due.date === today ? '今天到期 · ' : task.due.date === addDays(today,1) ? '明天到期 · ' : '到期 ') + (task.due.date.slice(0,4) === today.slice(0,4) ? task.due.date.slice(5) : task.due.date));
  if (task.waiting) badges.push('等待中');
  if (task.review && !task.reviewResult) badges.push((task.review.date <= today ? '待回看 ' : '回看 ') + task.review.date.slice(5));
  const id = escapeHTML(task.id), text = escapeHTML(task.text);
  return '<li class="record' + (task.done ? ' is-done' : '') + (selected ? ' is-selected' : '') + '" data-quadrant="' + (task.quadrant || 'unclassified') + '" data-id="' + id + '"><label class="check-wrap"><input class="done-check" type="checkbox" ' + (task.done ? 'checked' : '') + ' ' + (running ? 'disabled' : '') + ' aria-label="' + (task.done ? '恢复' : '完成') + '：' + text + '"><span class="check-face" aria-hidden="true"></span></label><div class="record-copy"><button type="button" class="record-text" aria-expanded="' + selected + '" aria-controls="detail-panel" aria-label="查看详情：' + text + '">' + text + '</button><span class="record-meta"><time datetime="' + escapeHTML(task.created) + '">' + escapeHTML(task.created.slice(5,16).replace('T',' · ')) + '</time>' + (count ? '<span>' + actualMinutes(task) + ' 分钟 · ' + count + ' 次专注</span>' : '') + badges.map(label => '<span class="date-chip' + (/^已逾期/.test(label) ? ' is-overdue' : /^今天到期/.test(label) ? ' is-due-today' : '') + '">' + escapeHTML(label) + '</span>').join('') + '</span>' + (suggestion ? '<button class="date-prompt" type="button">采纳时间提示 · ' + escapeHTML(suggestion.label) + '</button>' : '') + '</div><button class="start" type="button" ' + (active || task.done || task.waiting ? 'disabled' : '') + '><span aria-hidden="true">▷</span> 开始</button></li>';
}
