import { foldState, formatEvent, localDate, localTime, readAll, validDate, nextDue } from './log.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { createContextStore } from './context.mjs';

const bad = message => Object.assign(new Error(message), { status: 400 });
export function createStore(guard, clock = () => new Date()) {
  let pending = Promise.resolve();
  const snapshot = async () => {
    const parsed = await readAll(guard);
    return { ...parsed, ...foldState(parsed.events) };
  };
  const revision = async () => {
    const hash = createHash('sha256');
    const names = (await guard.listNames('计划/日志')).filter(name => /^\d{4}-\d{2}-\d{2}\.md$/.test(name) && validDate(name.slice(0, -3))).sort();
    for (const name of names) {
      try { hash.update(`${name}:${await guard.metadata(`计划/日志/${name}`)}\n`); }
      catch (error) { if (error.code !== 'ENOENT') throw error; hash.update(`${name}:removed\n`); }
    }
    return hash.digest('hex');
  };
  return {
    guard, clock, snapshot, revision,
    async state(date) {
      if (!validDate(date)) throw bad('日期格式不正确');
      // Capture before reading: a concurrent edit then differs on the next check.
      const marker = await revision();
      const { tasks, events, completedTasks } = await snapshot();
      const ids = new Set(events.filter(event => event.at.slice(0, 10) === date).map(event => event.id));
      const completions = date === localDate(clock()) ? completedTasks : completedTasks.filter(item => item.completedAt.startsWith(date));
      return { allTasks: tasks, dayTasks: tasks.filter(task => ids.has(task.id)), openTasks: tasks.filter(task => !task.done), reviewTasks: tasks.filter(task => task.review && !task.reviewResult), completedTasks: completions.slice(0,100), completedTotal: completions.length, revision: marker };
    },
    async search(query) {
      if (typeof query !== 'string' || query.length > 200) throw bad('搜索词太长');
      const term = query.trim().toLocaleLowerCase();
      if (!term) return [];
      return (await snapshot()).tasks.filter(task => task.text.toLocaleLowerCase().includes(term) || task.body.toLocaleLowerCase().includes(term) || task.notes.some(note => note.text.toLocaleLowerCase().includes(term))).slice(0, 50);
    },
    async day(date) {
      if (!validDate(date)) throw bad('日期格式不正确');
      const { tasks, events } = await snapshot();
      const ids = new Set(events.filter(event => event.at.slice(0, 10) === date).map(event => event.id));
      return tasks.filter(task => ids.has(task.id));
    },
    async open() { return (await snapshot()).tasks.filter(task => !task.done); },
    event(payload) {
      const operation = pending.then(async () => {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw bad('事件格式不正确');
        const eventFields = {
          '记': ['verb', 'text', 'quadrant'], '完': ['verb', 'id', 'expectedDue'], '撤': ['verb', 'id', 'eventId'],
          '改': ['verb', 'id', 'text', 'body', 'roles'], '行': ['verb', 'id', 'action'],
          '始': ['verb', 'id', 'minutes'], '止': ['verb', 'id', 'outcome', 'reason'], '注': ['verb', 'id', 'text'],
          '排': ['verb', 'id', 'field', 'date', 'period'], '候': ['verb', 'id', 'waiting'], '看': ['verb', 'id', 'result'],
          '设': ['verb','id','quadrant','recurrence','amount','currency','anchorDate']
        };
        const fields = typeof payload.verb === 'string' && Object.hasOwn(eventFields, payload.verb) ? eventFields[payload.verb] : null;
        if (!fields || Object.keys(payload).some(key => !fields.includes(key))) throw bad('不支持此事件字段');
        const now = clock(), date = localDate(now);
        const { tasks, events, completedTasks } = await snapshot();
        const event = { ...payload, time: localTime(now) };
        if (event.verb === '记') {
          if (event.quadrant === undefined) event.quadrant = 'q3';
          if (!['q1', 'q2', 'q3', 'q4'].includes(event.quadrant)) throw bad('请选择紧急重要四象限分类');
          const prefix = date.replaceAll('-', '');
          const max = events.filter(e => e.verb === '记' && e.date === date).reduce((n, e) => Math.max(n, Number(e.id.slice(9))), 0);
          if (max >= 999) throw bad('今天的记录已达到上限');
          event.id = `${prefix}-${String(max + 1).padStart(3, '0')}`;
        } else if (!(event.verb === '注' && event.id === '-') && !tasks.some(task => task.id === event.id)) throw bad('记录不存在');
        const active = tasks.flatMap(task => task.blocks.filter(block => !block.ended).map(block => ({ id: task.id, ...block })));
        const task = tasks.find(task => task.id === event.id);
        if (event.verb === '改') {
          const context = await createContextStore(guard, { snapshot }).snapshot();
          if (context.malformed || !Array.isArray(event.roles) || event.roles.some(role => !context.roles.includes(role))) throw bad('请选择已创建的角色');
        }
        if (event.verb === '行') {
          if (task.done) throw bad('已完成的任务不能开始或暂停');
          if (event.action === 'start' && task.execution === 'running') throw bad('任务已在执行');
          if (event.action === 'pause' && task.execution !== 'running') throw bad('任务尚未开始');
        }
        if (event.verb === '排' && event.field === 'due' && task.recurrence !== 'none') throw bad('周期截止日请通过周期设置调整');
        if (event.verb === '完') {
          if (task.done) throw bad('这条记录已经完成');
          if (task.recurrence !== 'none' && (!validDate(event.expectedDue) || event.expectedDue !== task.due?.date)) throw bad('本期已经变化，请刷新后再完成');
          if (task.recurrence === 'none' && event.expectedDue !== undefined && event.expectedDue !== task.due?.date) throw bad('截止日期已经变化');
          event.eventId = randomUUID(); event.occurrenceDue = task.due?.date ?? null;
          event.nextDue = task.recurrence === 'none' ? null : nextDue(task.due.date, task.recurrence, task.anchorDate);
          delete event.expectedDue;
        }
        if (event.verb === '撤') {
          const occurrence = completedTasks.find(item => item.id === event.id && (event.eventId === undefined || item.eventId === event.eventId));
          if (!occurrence || !occurrence.reversible || active.some(item => item.id === event.id)) throw bad('此完成记录之后已有改动，不能撤销；请刷新查看');
          event.eventId = occurrence.eventId;
        }
        if (event.verb === '候' && event.waiting && active.some(item => item.id === event.id)) throw bad('请先结束这条记录的计时');
        if (event.verb === '看' && !tasks.find(task => task.id === event.id)?.review) throw bad('请先设置回看日期');
        if (event.verb === '始' && (active.length || tasks.find(task => task.id === event.id)?.done || tasks.find(task => task.id === event.id)?.waiting)) throw bad('请先结束当前计时，或恢复这条记录');
        if (event.verb === '止') {
          const block = active.find(item => item.id === event.id);
          if (!block) throw bad('这条记录没有正在进行的计时');
          const elapsed = Math.max(0, now.getTime() - new Date(block.started).getTime());
          if (event.outcome === '完成' && elapsed < block.minutes * 60000) throw bad('计时尚未结束');
          event.minutes = Math.round(elapsed / 600) / 100;
        }
        let line;
        try { line = formatEvent(event); } catch (error) { throw bad(error.message); }
        await guard.appendLine(`计划/日志/${date}.md`, line);
        return { id: event.id, line };
      });
      pending = operation.catch(() => {});
      return operation;
    }
  };
}
