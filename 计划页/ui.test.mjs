import test from 'node:test';
import assert from 'node:assert/strict';
import { listView, rowHTML, needsRecovery, timerState, loadDuration, saveDuration, dateSuggestion, isLater, groupedRows, eventHTML, costSummary } from './public/view.js';
import { createTestWorkspace } from './fsguard.mjs';

const task = { id: '20260906-001', text: '先写文档', done: false, blocks: [], created: '2026-09-06T09:00:00' };
test('list receives only folded fields, ignores foreign metadata and escapes HTML', () => {
  const injected = { ...task, extra: '\u4e7e\u5366', annotation: { name: '\u4e7e\u5366' } };
  const views = listView([injected, { ...task, id: '20260906-002', created: '2026-09-06T08:00:00' }]);
  assert.equal(views[0].id, '20260906-002');
  assert.deepEqual(Object.keys(views[1]), ['id', 'text', 'done', 'blocks', 'created', 'notes', 'waiting', 'scheduled', 'due', 'review', 'reviewResult', 'quadrant', 'recurrence', 'amount', 'currency', 'anchorDate', 'completedAt']);
  const html = rowHTML(injected);
  assert.equal(html.includes(injected.extra), false);
  assert.equal(html.includes('data-annotation'), false);
  assert.equal(rowHTML({ ...task, text: '<img src=x onerror=alert(1)>' }).includes('<img'), false);
});

test('date hints preserve uncertainty, distinguish deadlines and anchor to recording day', () => {
  assert.deepEqual(dateSuggestion('明天下午整理方案', '2026-09-21'), {field:'scheduled',date:'2026-09-22',period:'下午',label:'安排 09-22 下午'});
  assert.equal(dateSuggestion('周五前交方案', '2026-09-21').field, 'due');
  assert.equal(dateSuggestion('下周一讨论', '2026-09-21').date, '2026-09-28');
  assert.equal(dateSuggestion('2026-02-30开会', '2026-09-21'), null);
  assert.equal(dateSuggestion('明天或后天处理', '2026-09-21'), null);
  assert.equal(dateSuggestion('过几天处理', '2026-09-21'), null);
  assert.equal(dateSuggestion('大后天处理', '2026-09-21'), null);
  assert.equal(dateSuggestion('下下周一处理', '2026-09-21'), null);
  assert.equal(dateSuggestion('周五下午前交', '2026-09-21').field, 'due');
  assert.equal(isLater({...task, scheduled:{date:'2026-09-25'}, due:{date:'2026-09-21'}}, '2026-09-21'), false);
});

test('new metadata is escaped; waiting cannot start; actual minutes remain descriptive', () => {
  const html = rowHTML({...task, waiting:true, notes:[{text:'<script>',at:'2026-09-21T12:00:00'}], blocks:[{started:'2026-09-21T12:00:00', ended:'2026-09-21T12:20:00',minutes:25,actual:20}]});
  assert.match(html, /20 分钟/); assert.match(html, /class="start" type="button" disabled/);
  assert.doesNotMatch(html, /<script>/);
});
test('timer expiry/recovery is exact at boundary and crosses midnight', () => {
  const tasks = [{ ...task, blocks: [{ started: '2026-09-06T23:55:00', minutes: 25 }] }];
  assert.equal(needsRecovery(tasks, new Date('2026-09-07T00:19:59').getTime()), false);
  assert.equal(needsRecovery(tasks, new Date('2026-09-07T00:20:00').getTime()), true);
  assert.equal(timerState(tasks, new Date('2026-09-07T00:00:00').getTime()).remaining, 20 * 60000);
  tasks[0].blocks[0].ended = '2026-09-07T00:20:00';
  assert.equal(needsRecovery(tasks, Date.now()), false);
});
test('blocked or corrupt preference storage uses default and never blocks input', () => {
  const storage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(loadDuration(storage), 25); assert.doesNotThrow(() => saveDuration(storage, 35));
  assert.equal(loadDuration({ getItem: () => '999' }), 25);
  assert.equal(loadDuration({ getItem: () => '45' }), 45);
});
test('notebook shell has accessible navigation and local assets, dynamic editors preserve semantic labels', async t => {
  const fixture = await createTestWorkspace(); t.after(() => fixture.dispose());
  const html = await fixture.source('计划页/public/index.html');
  const script = await fixture.source('计划页/public/app.js');
  assert.match(html, /id="notebook-root"/);
  assert.match(html, /aria-label="主导航"/);
  assert.match(html, /<dialog id="editor-dialog"/);
  assert.doesNotMatch(html, /(?:src|href)="https:\/\//);
  for(const label of ['目前任务','正在执行','已完成','个人情况','对方情况的推测','发送材料并分析']) assert.ok(script.includes(label));
  assert.match(script, /type="password" autocomplete="off"/);
  assert.doesNotMatch(script, /verb:'始'/);
});

test('quadrants are explicit and group order retains creation order; costs do not combine currencies', () => {
  const items=listView([{...task,quadrant:'q3',text:'重要事项'},{...task,id:'20260906-002',quadrant:'q1',text:'先处理'}, {...task,id:'20260906-003',quadrant:null,text:'待分'}]);
  const html=groupedRows(items,false,'2026-09-21');
  assert.ok(html.indexOf('先处理')<html.indexOf('重要事项'));
  assert.ok(html.indexOf('重要事项')<html.indexOf('待分'));
  const costs=costSummary([{...task,amount:100,currency:'CNY',due:{date:'2026-09-22'}},{...task,amount:20,currency:'USD',due:{date:'2026-09-23'}},{...task,amount:5,currency:'EUR',due:{date:'2026-09-01'}},{...task,amount:900,currency:'CNY',due:{date:'2027-01-01'}}],'2026-09-21');
  assert.match(costs,/100/);assert.match(costs,/20/);assert.match(costs,/已逾期/);assert.doesNotMatch(costs,/120|900/);
});

test('completion rows escape snapshots and expose reversal only when allowed', () => {
  const item={...task,eventId:'event-1',completedAt:'2026-09-21T12:00:00',text:'<script>费用',due:{date:'2026-09-21'},amount:25,currency:'USD',reversible:true};
  assert.match(eventHTML(item),/undo-event/);assert.doesNotMatch(eventHTML(item),/<script>/);
  assert.doesNotMatch(eventHTML({...item,reversible:false}),/undo-event/);
});

test('deadline labels distinguish today, overdue and another year without reclassifying tasks', () => {
  const dated = {...task, quadrant:'q3', due:{date:'2026-09-21'}};
  assert.match(rowHTML(dated,false,'2026-09-21',true), /is-selected/);
  assert.match(rowHTML(dated,false,'2026-09-21'), /今天到期 · 09-21/);
  assert.match(rowHTML(dated,false,'2026-09-22'), /is-overdue/);
  assert.match(rowHTML(dated,false,'2026-09-20'), /明天到期/);
  assert.match(rowHTML({...dated,due:{date:'2027-01-01'}},false,'2026-09-21'), /2027-01-01/);
  assert.match(rowHTML(dated,false,'2026-09-22'), /data-quadrant="q3"/);
});
