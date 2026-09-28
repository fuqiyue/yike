import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { createTestWorkspace } from './fsguard.mjs';
import { countActiveDays, recentLocalDates, run } from './readings.mjs';

const fixedNow = new Date(2026, 8, 6, 9, 30, 0);
const execFile = promisify(execFileCallback);

test('active-days returns zero when the isolated plan log is absent', async t => {
  const workspace = await createTestWorkspace();
  t.after(() => workspace.dispose());
  assert.equal(await countActiveDays(workspace.guard, { now: fixedNow, days: 7 }), 0);
});

test('active-days counts only days containing a valid newline-complete event', async t => {
  const workspace = await createTestWorkspace();
  t.after(() => workspace.dispose());
  const dates = recentLocalDates(fixedNow, 8);

  await workspace.seed(`计划/日志/${dates[0]}.md`, '- 09:00:00 记 20260906-001 完整事件\n');
  await workspace.seed(`计划/日志/${dates[1]}.md`, '');
  await workspace.seed(`计划/日志/${dates[2]}.md`, '不是事件\n');
  await workspace.seed(`计划/日志/${dates[3]}.md`, '- 09:00:00 记 20260903-001 撕裂事件');
  await workspace.seed(`计划/日志/${dates[4]}.md`, '# 标题\n\n<!-- 注释 -->\n');
  await workspace.seed(`计划/日志/${dates[5]}.md`, '- 10:30:00 注 - 完整备注\n畸形尾随行\n');
  await workspace.seed(`计划/日志/${dates[7]}.md`, '- 08:00:00 记 20260830-001 窗口外事件\n');

  assert.equal(await countActiveDays(workspace.guard, { now: fixedNow, days: 7 }), 2);
});

test('active-days command writes exactly one integer line and validates its arguments', async t => {
  const workspace = await createTestWorkspace();
  t.after(() => workspace.dispose());
  const output = [];
  const result = await run(['active-days', '--days', '7'], {
    guard: workspace.guard,
    now: fixedNow,
    write: text => output.push(text)
  });
  assert.equal(result, 0);
  assert.deepEqual(output, ['0\n']);
  await assert.rejects(() => run(['active-days', '--days', '0'], { guard: workspace.guard, now: fixedNow }));
  await assert.rejects(() => run(['unknown'], { guard: workspace.guard, now: fixedNow }));
});

test('standalone CLI reads an isolated empty project and prints only zero', async t => {
  const workspace = await createTestWorkspace();
  t.after(() => workspace.dispose());
  for (const source of ['fsguard.mjs', 'log.mjs', 'readings.mjs', 'package.json']) {
    await workspace.seed(`计划页/${source}`, await workspace.source(`计划页/${source}`));
  }
  const result = await execFile(process.execPath, [path.join(workspace.root, '计划页', 'readings.mjs'), 'active-days', '--days', '7'], {
    cwd: workspace.root,
    windowsHide: true
  });
  assert.equal(result.stdout, '0\n');
  assert.equal(result.stderr, '');
});
