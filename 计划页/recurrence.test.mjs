import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestWorkspace } from './fsguard.mjs';
import { createStore } from './store.mjs';
import { nextDue, parseDay, formatEvent } from './log.mjs';
const clock = () => new Date('2026-09-21T12:00:00');
const settings = id => ({ verb:'设', id, quadrant:'q2', recurrence:'monthly', amount:99.95, currency:'CNY', anchorDate:'2024-01-31' });
async function setup(t) { const f=await createTestWorkspace(); t.after(()=>f.dispose()); const s=createStore(f.guard,clock); const {id}=await s.event({verb:'记',text:'周期账单',quadrant:'q2'}); return {f,s,id}; }
test('calendar anchoring clamps month end and restores 31; leap year restores Feb 29',()=>{
  assert.equal(nextDue('2024-01-31','monthly','2024-01-31'),'2024-02-29');
  assert.equal(nextDue('2024-02-29','monthly','2024-01-31'),'2024-03-31');
  assert.equal(nextDue('2025-01-31','monthly','2024-01-31'),'2025-02-28');
  assert.equal(nextDue('2023-02-28','yearly','2020-02-29'),'2024-02-29');
  assert.equal(nextDue('2024-12-31','daily','2024-12-31'),'2025-01-01');
  assert.equal(nextDue('2024-12-31','weekly','2024-12-31'),'2025-01-07');
});
test('atomic completion advances one overdue period, rejects duplicate, replays and undoes exact occurrences',async t=>{
  const {f,s,id}=await setup(t); await s.event(settings(id));
  await s.event({verb:'完',id,expectedDue:'2024-01-31'});
  await assert.rejects(s.event({verb:'完',id,expectedDue:'2024-01-31'}),/本期已经变化/);
  await assert.rejects(s.event({verb:'完',id}),/本期已经变化/);
  let state=await createStore(f.guard,clock).state('2026-09-21');
  assert.equal(state.openTasks[0].due.date,'2024-02-29'); assert.equal(state.completedTotal,1);
  assert.equal(state.completedTasks[0].due.date,'2024-01-31'); assert.equal(state.completedTasks[0].amount,99.95);
  const first=state.completedTasks[0].eventId;
  await s.event({verb:'完',id,expectedDue:'2024-02-29'});
  state=await s.state('2026-09-21'); const second=state.completedTasks[0].eventId;
  assert.notEqual(first,second); assert.equal(state.completedTasks[1].reversible,false);
  await assert.rejects(s.event({verb:'撤',id,eventId:first}),/不能撤销/);
  await s.event({verb:'撤',id,eventId:second});
  assert.equal((await s.state('2026-09-21')).completedTasks[0].reversible,true);
  await s.event({verb:'撤',id,eventId:first});
  state=await s.state('2026-09-21'); assert.equal(state.completedTotal,0); assert.equal(state.openTasks[0].due.date,'2024-01-31');
  const text=await f.guard.readText('计划/日志/2026-09-21.md');
  assert.equal(parseDay(text,'2026-09-21').events.map(formatEvent).join('\n')+'\n',text);
});
test('financial snapshots survive edits, unchanged recurrence preserves due, subsequent edit prevents undo',async t=>{
  const {s,id}=await setup(t); await s.event(settings(id)); await s.event({verb:'完',id,expectedDue:'2024-01-31'});
  await s.event({...settings(id),amount:120,quadrant:'q1'});
  const state=await s.state('2026-09-21');
  assert.equal(state.openTasks[0].due.date,'2024-02-29'); assert.equal(state.openTasks[0].amount,120);
  assert.equal(state.completedTasks[0].amount,99.95); assert.equal(state.completedTasks[0].quadrant,'q2');
  assert.equal(state.completedTasks[0].reversible,false);
  await assert.rejects(s.event({verb:'撤',id,eventId:state.completedTasks[0].eventId}),/不能撤销/);
  await assert.rejects(s.event({verb:'排',id,field:'due',date:'2027-01-01',period:''}),/周期截止日/);
});
test('strict settings reject bad currency, money, recurrence, dates and extra fields',async t=>{
  const {s,id}=await setup(t);
  for(const change of [{quadrant:'q5'},{amount:-1},{amount:1.001},{amount:1e9+1},{amount:'5'},{amount:NaN},{currency:'GBP'},{recurrence:'hourly'},{anchorDate:null},{anchorDate:'2026-02-30'},{extra:1}]) await assert.rejects(s.event({...settings(id),...change}),{status:400});
  await assert.rejects(s.event({verb:'记',text:'无效分类',quadrant:'x'}),{status:400});
  await s.event({...settings(id),amount:1e9});
  assert.equal((await s.open())[0].amount,1e9);
});
test('changing frequency preserves current occurrence; explicit anchor change or re-enabling resets due',async t=>{
  const {f,s,id}=await setup(t);
  const initial={...settings(id),anchorDate:'2025-01-31'};
  await s.event(initial); await s.event({verb:'完',id,expectedDue:'2025-01-31'});
  await s.event({...initial,recurrence:'yearly'});
  assert.equal((await createStore(f.guard,clock).open())[0].due.date,'2025-02-28');
  await s.event({verb:'完',id,expectedDue:'2025-02-28'});
  assert.equal((await s.open())[0].due.date,'2026-01-31');
  await s.event({...initial,recurrence:'yearly',anchorDate:'2026-04-30'});
  assert.equal((await s.open())[0].due.date,'2026-04-30');
  await s.event({...initial,recurrence:'none'});
  await s.event({...initial,recurrence:'weekly'});
  assert.equal((await s.open())[0].due.date,'2025-01-31');
});
test('legacy text and ordinary completion remain compatible; completed history is capped and date accessible',async t=>{
  const {f,s,id}=await setup(t);
  await f.seed('计划/日志/2026-09-20.md','- 08:00:00 记 20260920-001 分类:q1: 原有文字\n- 09:00:00 完 20260920-001\n');
  const legacyId = (await s.state('2026-09-20')).completedTasks[0].eventId;
  assert.equal((await s.open()).find(task=>task.id===id).quadrant,'q2');
  assert.equal((await s.day('2026-09-20'))[0].text,'分类:q1: 原有文字');
  assert.equal((await s.day('2026-09-20'))[0].quadrant,null);
  await s.event({verb:'完',id}); await assert.rejects(s.event({verb:'完',id}),/已经完成/);
  await s.event({verb:'撤',id}); assert.equal((await s.open()).length,1);
  assert.equal((await s.state('2026-09-20')).completedTotal,1);
  const lines=[];
  for(let n=1;n<=105;n++){const key='20260919-'+String(n).padStart(3,'0');lines.push('- 08:00:00 记 '+key+' 历史事项','- 09:00:00 完 '+key);}
  await f.seed('计划/日志/2026-09-19.md',lines.join('\n')+'\n');
  const state=await s.state('2026-09-21'); assert.equal(state.completedTotal,106); assert.equal(state.completedTasks.length,100);
  assert.equal((await s.state('2026-09-20')).completedTasks.length,1);
  assert.equal((await s.state('2026-09-20')).completedTasks[0].eventId,legacyId);
  await s.event({verb:'撤',id:'20260920-001',eventId:legacyId});
  assert.equal((await createStore(f.guard,clock).state('2026-09-20')).completedTotal,0);
});
