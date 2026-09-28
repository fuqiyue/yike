import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGuard } from './fsguard.mjs';
import { localDate, readDay } from './log.mjs';

function positiveDays(value) {
  if (!/^\d+$/.test(value ?? '')) throw new Error('天数必须是正整数');
  const days = Number(value);
  if (!Number.isSafeInteger(days) || days < 1 || days > 366) throw new Error('天数必须在 1 到 366 之间');
  return days;
}

export function recentLocalDates(now = new Date(), days = 7) {
  const count = positiveDays(String(days));
  const noon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  return Array.from({ length: count }, (_, offset) => {
    const date = new Date(noon);
    date.setDate(noon.getDate() - offset);
    return localDate(date);
  });
}

export async function countActiveDays(guard, { now = new Date(), days = 7 } = {}) {
  const results = await Promise.all(recentLocalDates(now, days).map(date => readDay(guard, date)));
  return results.filter(day => day.events.length > 0).length;
}

function parseArgs(args) {
  if (args[0] !== 'active-days') throw new Error('用法：readings.mjs active-days --days 7');
  if (args.length === 1) return 7;
  if (args.length !== 3 || args[1] !== '--days') throw new Error('用法：readings.mjs active-days --days 7');
  return positiveDays(args[2]);
}

export async function run(args, { guard = createGuard(), now = new Date(), write = text => process.stdout.write(text) } = {}) {
  const days = parseArgs(args);
  const count = await countActiveDays(guard, { now, days });
  write(`${count}\n`);
  return count;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
