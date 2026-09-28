const frequencies = { weekly: 0, monthly: 1, quarterly: 3, yearly: 12 };
const dayMs = 86400000;
function dateParts(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > monthDays(year, month)) return null;
  return { year, month, day };
}
function monthDays(year, month) {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
const format = ({ year, month, day }) => `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
function timestamp({ year, month, day }) {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime();
}
export const validPeriodicDate = value => dateParts(value) !== null;

// Every occurrence uses the original day as its anchor, including after clamping.
export function nextPeriodicDue(startDate, frequency, today) {
  const start = dateParts(startDate), current = dateParts(today);
  if (!start || !current || typeof frequency !== 'string' || !Object.hasOwn(frequencies, frequency)) throw new RangeError('周期或日期格式不正确');
  if (frequency === 'weekly') {
    const startTime = timestamp(start);
    const periods = Math.max(1, Math.ceil((timestamp(current) - startTime) / (7 * dayMs)));
    const date = new Date(startTime + periods * 7 * dayMs);
    const year = date.getUTCFullYear();
    return year > 9999 ? null : format({ year, month: date.getUTCMonth() + 1, day: date.getUTCDate() });
  }
  const step = frequencies[frequency];
  const startMonth = start.year * 12 + start.month - 1;
  const currentMonth = current.year * 12 + current.month - 1;
  let periods = Math.max(1, Math.floor((currentMonth - startMonth) / step));
  for (let attempt = 0; attempt < 2; attempt++, periods++) {
    const index = startMonth + periods * step;
    const year = Math.floor(index / 12), month = index % 12 + 1;
    if (year > 9999) return null;
    const candidate = format({ year, month, day: Math.min(start.day, monthDays(year, month)) });
    if (candidate >= today) return candidate;
  }
  return null;
}
