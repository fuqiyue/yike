import { TORN_MARKER } from './fsguard.mjs';
import { createHash } from 'node:crypto';
export const validRoleName = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 30 && !/[\r\n\0<>]/u.test(value);

const idPattern = /^\d{8}-\d{3}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
export const byCreated = (a, b) => a.created.localeCompare(b.created);
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00`);
  return Number.isFinite(d.getTime()) && localDate(d) === value;
}
export function localTime(date = new Date()) { return date.toTimeString().slice(0, 8); }
const recurrenceValues = ['none', 'daily', 'weekly', 'monthly', 'yearly'];
const eventIdPattern = /^(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|legacy-[a-f0-9]{32}|legacy-\d+)$/;
export function validateSettings(event) {
  if (![null, 'q1', 'q2', 'q3', 'q4'].includes(event.quadrant) || !recurrenceValues.includes(event.recurrence) || !['CNY', 'USD', 'EUR'].includes(event.currency) || !(event.anchorDate === null || validDate(event.anchorDate)) || (event.recurrence !== 'none' && !event.anchorDate) || !(event.amount === null || (typeof event.amount === 'number' && Number.isFinite(event.amount) && event.amount >= 0 && event.amount <= 1e9 && /^\d+(?:\.\d{1,2})?$/.test(String(event.amount))))) throw new Error('分类、周期或金额格式不正确');
}
export function nextDue(due, recurrence, anchorDate) {
  if (!validDate(due) || !validDate(anchorDate) || !recurrenceValues.includes(recurrence) || recurrence === 'none') throw new Error('周期日期不正确');
  const [year, month, day] = due.split('-').map(Number), anchor = anchorDate.split('-').map(Number);
  const date = new Date(`${due}T12:00:00`);
  if (recurrence === 'daily' || recurrence === 'weekly') date.setDate(day + (recurrence === 'daily' ? 1 : 7));
  else {
    const targetYear = recurrence === 'yearly' ? year + 1 : year + (month === 12 ? 1 : 0);
    const targetMonth = recurrence === 'yearly' ? anchor[1] : (month % 12) + 1;
    date.setDate(1); date.setFullYear(targetYear, targetMonth - 1, Math.min(anchor[2], new Date(targetYear, targetMonth, 0).getDate()));
  }
  const result = localDate(date); if (!validDate(result)) throw new Error('下期日期超出范围'); return result;
}
function safeText(value, oneWord = false) {
  if (typeof value !== 'string' || !value.trim() || /[\r\n\0]/u.test(value) || value.includes(TORN_MARKER.trim()) || (oneWord && /\s/u.test(value))) throw new Error('这段文字无法保存，请修改后重试');
  return value;
}
function minutes(value, zero = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < (zero ? 0 : 1) || value > (zero ? 525600 : 240) || !/^\d+(?:\.\d{1,2})?$/.test(String(value))) throw new Error('时长格式不正确');
  return String(value);
}
export function validateTaskEdit(event) {
  if (typeof event.text !== 'string' || !event.text.trim() || event.text.length > 300 || /[\r\n\0]/u.test(event.text) || typeof event.body !== 'string' || event.body.length > 6000 || /\0/u.test(event.body) || [event.text, event.body].some(value => value.includes(TORN_MARKER.trim())) || !Array.isArray(event.roles) || event.roles.length > 32 || new Set(event.roles).size !== event.roles.length || event.roles.some(role => !validRoleName(role))) throw new Error('任务标题、笔记或角色格式不正确');
}
export function formatEvent(event) {
  const { time, verb, id } = event;
  if (!timePattern.test(time) || !(idPattern.test(id) || (verb === '注' && id === '-'))) throw new Error('事件格式不正确');
  const parts = [`- ${time} ${verb} ${id}`];
  if (verb === '记' || verb === '注') {
    if (verb === '记' && event.quadrant !== undefined) {
      if (!['q1','q2','q3','q4',null].includes(event.quadrant)) throw new Error('分类格式不正确');
      parts[0] = `- ${time} 记:${event.quadrant ?? '-'} ${id}`;
      parts.push(safeText(event.text));
    } else parts.push(safeText(event.text));
  }
  else if (verb === '改') {
    validateTaskEdit(event);
    parts.push(JSON.stringify({ text: event.text, body: event.body, roles: event.roles }));
  }
  else if (verb === '行') {
    if (!['start', 'pause'].includes(event.action)) throw new Error('执行状态不正确');
    parts.push(event.action);
  }
  else if (verb === '始') parts.push(minutes(event.minutes));
  else if (verb === '止') {
    if (!['完成', '中断'].includes(event.outcome)) throw new Error('结束状态不正确');
    parts.push(minutes(event.minutes, true), event.outcome);
    if (event.reason !== undefined) parts.push(safeText(event.reason, true));
  } else if (verb === '排') {
    if (!['scheduled', 'due', 'review'].includes(event.field) || !(event.date === null || validDate(event.date)) || !['', '上午', '下午', '晚上'].includes(event.period) || (event.field !== 'scheduled' && event.period) || (event.date === null && event.period)) throw new Error('安排格式不正确');
    parts.push(event.field, event.date ?? '-');
    if (event.period) parts.push(event.period);
  } else if (verb === '候') {
    if (typeof event.waiting !== 'boolean') throw new Error('等待状态不正确');
    parts.push(event.waiting ? '等待' : '恢复');
  } else if (verb === '看') {
    if (!['符合', '不符', '暂不确定'].includes(event.result)) throw new Error('回看结果不正确');
    parts.push(event.result);
  } else if (verb === '设') {
    validateSettings(event);
    parts.push(event.quadrant ?? '-', event.recurrence, event.amount === null ? '-' : String(event.amount), event.currency, event.anchorDate ?? '-');
  } else if (verb === '完' && event.eventId !== undefined) {
    if (!eventIdPattern.test(event.eventId) || !(event.occurrenceDue === null || validDate(event.occurrenceDue)) || !(event.nextDue === null || validDate(event.nextDue))) throw new Error('完成事件格式不正确');
    parts.push(event.eventId, event.occurrenceDue ?? '-', event.nextDue ?? '-');
  } else if (verb === '撤' && event.eventId !== undefined) {
    if (!eventIdPattern.test(event.eventId)) throw new Error('完成事件编号不正确');
    parts.push(event.eventId);
  } else if (!['完', '撤'].includes(verb)) throw new Error('不支持此事件');
  const line = parts.join(' ');
  if (Buffer.byteLength(line + '\n') >= (verb === '改' ? 65536 : 4096)) throw new Error('这行太长，请缩短后保存');
  return line;
}
export function parseLine(line, date) {
  if (!validDate(date) || line.endsWith(TORN_MARKER)) return null;
  const match = line.match(/^- (\S+) ([记完撤始止注排候看设改行](?::(?:q[1-4]|-))?) (\S+)(?: (.*))?$/u);
  if (!match) return null;
  const [, time, rawVerb, id, rest] = match;
  const verb = rawVerb.split(':')[0];
  const event = { time, verb, id };
  if (rawVerb.includes(':')) { if (verb !== '记') return null; event.quadrant = rawVerb.split(':')[1] === '-' ? null : rawVerb.split(':')[1]; }
  if (verb === '记' || verb === '注') {
    event.text = rest;
  }
  else if (verb === '改') {
    try {
      const edit = JSON.parse(rest);
      if (!edit || Array.isArray(edit) || Object.keys(edit).some(key => !['text', 'body', 'roles'].includes(key))) return null;
      Object.assign(event, edit);
    } catch { return null; }
  }
  else if (verb === '行') event.action = rest;
  else if (verb === '始') event.minutes = Number(rest);
  else if (verb === '止') {
    const parts = rest?.match(/^(\d+(?:\.\d{1,2})?) (完成|中断)(?: (\S+))?$/u);
    if (!parts) return null;
    event.minutes = Number(parts[1]); event.outcome = parts[2];
    if (parts[3]) event.reason = parts[3];
  }
  else if (verb === '排') {
    const parts = rest?.match(/^(scheduled|due|review) (\d{4}-\d{2}-\d{2}|-)(?: (上午|下午|晚上))?$/u);
    if (!parts) return null;
    event.field = parts[1]; event.date = parts[2] === '-' ? null : parts[2]; event.period = parts[3] || '';
  } else if (verb === '候') {
    if (!['等待', '恢复'].includes(rest)) return null;
    event.waiting = rest === '等待';
  } else if (verb === '看') event.result = rest;
  else if (verb === '设') {
    const parts = rest?.split(' '); if (parts?.length !== 5) return null;
    [event.quadrant,event.recurrence,,event.currency,event.anchorDate] = parts;
    if (event.quadrant === '-') event.quadrant = null;
    event.amount = parts[2] === '-' ? null : Number(parts[2]);
    if (event.anchorDate === '-') event.anchorDate = null;
  } else if (verb === '完' && rest !== undefined) {
    const parts = rest.split(' '); if (parts.length !== 3) return null;
    event.eventId = parts[0]; event.occurrenceDue = parts[1] === '-' ? null : parts[1]; event.nextDue = parts[2] === '-' ? null : parts[2];
  } else if (verb === '撤' && rest !== undefined) event.eventId = rest;
  try {
    if (formatEvent(event) !== line) return null;
    if (verb === '记' && id.slice(0, 8) !== date.replaceAll('-', '')) return null;
    // Log date and scheduled date are distinct; preserve the latter for 排.
    return { ...event, ...(verb === '排' ? { logDate: date } : { date }), at: `${date}T${time}` };
  } catch { return null; }
}
export function parseDay(text, date) {
  const events = []; let malformed = 0; let torn = 0;
  const lines = text.split('\n');
  if (lines.at(-1)) { lines.pop(); torn++; } else lines.pop();
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    let line = lines[lineIndex];
    line = line.replace(/\r$/, '');
    if (!line.trim()) continue;
    if (line.endsWith(TORN_MARKER)) { torn++; continue; }
    const event = parseLine(line, date);
    if (event) {
      if (event.verb === '完' && !event.eventId) event.sourceId = 'legacy-' + createHash('sha256').update(`${date}:${lineIndex}:${line}`).digest('hex').slice(0,32);
      events.push(event);
    } else malformed++;
  }
  return { events, malformed, torn };
}
export function foldState(events) {
  const tasks = new Map(), completed = [], last = new Map(); let index = 0;
  const transition = (task, execution, at) => {
    if (task.execution !== execution) task.executionHistory.push({ from: task.execution, to: execution, at });
    task.execution = execution;
    task.executionChangedAt = at;
  };
  const closeLegacyBlock = (task, at, outcome) => {
    const block = task.blocks.findLast(item => !item.ended);
    if (block) Object.assign(block, { ended: at, actual: Math.round(Math.max(0, new Date(at) - new Date(block.started)) / 600) / 100, outcome });
  };
  // Event chronology is local date + time. Equal timestamps preserve append order.
  for (const event of [...events].sort((a, b) => a.at.localeCompare(b.at))) {
    index++;
    if (event.verb === '记' && !tasks.has(event.id)) tasks.set(event.id, { id: event.id, text: event.text, body: '', roles: [], edits: [], execution: 'pending', executionHistory: [], executionChangedAt: event.at, done: false, blocks: [], notes: [], waiting: false, scheduled: null, due: null, review: null, reviewResult: null, reviewResolved: false, quadrant: null, recurrence: 'none', amount: null, currency: 'CNY', anchorDate: null, completedAt: null, created: event.at });
    const task = tasks.get(event.id);
    if (!task) continue;
    if (event.verb === '改') {
      task.edits.push({ text: task.text, body: task.body, roles: [...task.roles], at: event.at });
      task.text = event.text; task.body = event.body; task.roles = [...event.roles]; task.updatedAt = event.at;
    }
    if (event.verb === '行' && !task.done) {
      if (event.action === 'pause') closeLegacyBlock(task, event.at, '中断');
      if (event.action === 'start') task.waiting = false;
      transition(task, event.action === 'start' ? 'running' : 'paused', event.at);
    }
    if (event.verb === '记' && event.quadrant !== undefined) task.quadrant = event.quadrant;
    if (event.verb === '注') task.notes.push({ text: event.text, at: event.at });
    if (event.verb === '候' && (!event.waiting || !task.blocks.some(block => !block.ended))) task.waiting = event.waiting;
    if (event.verb === '排') {
      task[event.field] = event.date === null ? null : { date: event.date, period: event.period };
      if (event.field === 'review') { task.reviewResult = null; task.reviewResolved = false; }
    }
    if (event.verb === '看' && task.review) { task.reviewResult = event.result; task.reviewResolved = true; }
    if (event.verb === '设') {
      const resetDue = task.recurrence === 'none' || task.anchorDate !== event.anchorDate;
      for (const key of ['quadrant','recurrence','amount','currency','anchorDate']) task[key] = event[key];
      if (task.recurrence !== 'none' && resetDue) { task.due = { date: task.anchorDate, period: '' }; if (task.done) transition(task, 'pending', event.at); task.done = false; }
    }
    if (event.verb === '完' && !task.done) {
      closeLegacyBlock(task, event.at, '完成');
      transition(task, 'completed', event.at);
      const occurrence = { eventId: event.eventId || event.sourceId || `legacy-${index}`, id: task.id, text: task.text, body: task.body, roles: [...task.roles], execution: 'completed', completedAt: event.at, due: task.due ? { ...task.due } : null, amount: task.amount, currency: task.currency, quadrant: task.quadrant, recurrence: task.recurrence, reversible: true, previousCompletedAt: task.completedAt, previousLast: last.get(task.id) };
      completed.push(occurrence); task.completedAt = event.at;
      if (task.recurrence !== 'none' && event.nextDue) { task.due = { date: event.nextDue, period: '' }; task.done = false; transition(task, 'pending', event.at); }
      else task.done = true;
      last.set(task.id, occurrence.eventId);
    } else if (event.verb === '撤') {
      const occurrence = completed.findLast(item => item.id === task.id && (!event.eventId || item.eventId === event.eventId));
      if (occurrence) {
        completed.splice(completed.indexOf(occurrence), 1); task.completedAt = occurrence.previousCompletedAt;
        if (occurrence.recurrence !== 'none') task.due = occurrence.due ? { ...occurrence.due } : null;
        last.set(task.id, occurrence.previousLast);
      }
      task.done = false;
      transition(task, 'pending', event.at);
    } else if (event.verb !== '完') last.set(task.id, `edit-${index}`);
    if (event.verb === '始' && !task.done && !task.blocks.some(block => !block.ended)) { task.blocks.push({ started: event.at, minutes: event.minutes }); transition(task, 'running', event.at); }
    if (event.verb === '止') {
      const block = task.blocks.findLast(item => !item.ended);
      if (block) Object.assign(block, { ended: event.at, actual: event.minutes, outcome: event.outcome, ...(event.reason ? { reason: event.reason } : {}) });
      if (block && !task.done) transition(task, 'paused', event.at);
    }
  }
  return { tasks: [...tasks.values()].sort(byCreated), completedTasks: completed.map(({previousCompletedAt, previousLast, ...item}) => ({ ...item, reversible: last.get(item.id) === item.eventId })).reverse() };
}
export function foldEvents(events) { return foldState(events).tasks; }
export async function readDay(guard, date) {
  if (!validDate(date)) throw new Error('日期格式不正确');
  try { return parseDay(await guard.readText(`计划/日志/${date}.md`), date); }
  catch (error) { if (error.code === 'ENOENT') return { events: [], malformed: 0, torn: 0 }; throw error; }
}
export async function readAll(guard) {
  const dates = (await guard.listNames('计划/日志')).filter(name => /^\d{4}-\d{2}-\d{2}\.md$/.test(name) && validDate(name.slice(0, -3))).sort();
  const result = { events: [], malformed: 0, torn: 0 };
  for (const name of dates) {
    const day = await readDay(guard, name.slice(0, -3));
    for (const event of day.events) result.events.push(event);
    result.malformed += day.malformed; result.torn += day.torn;
  }
  return result;
}
