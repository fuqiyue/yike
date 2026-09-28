// Computation is a teaching aid. Card 65 remains the answer authority.
const clean = value => value.replace(/\*\*/g, '').trim();
const positions = ['初', '二', '三', '四', '五', '上'];
export const lineName = (bit, index) => index === 0 || index === 5 ? `${positions[index]}${bit ? '九' : '六'}` : `${bit ? '九' : '六'}${positions[index]}`;

export function section(markdown, heading) {
  const text = markdown.replace(/\r\n/g, '\n');
  const start = text.indexOf(heading);
  if (start < 0) throw new Error(`来源章节缺失：${heading}`);
  const after = start + heading.length;
  const end = text.indexOf('\n## ', after);
  return text.slice(start, end < 0 ? undefined : end).trim();
}

export function parseTrigrams(markdown) {
  const body = section(markdown, '## 二、第 0 阶');
  const entries = [...body.matchAll(/^\| ([乾坤震艮离坎巽兑]) ([☰☷☳☶☲☵☴☱]) \| [^|]*?([01]{3}) \| ([^\n]+) \|$/gm)].map(([, name, symbol, bits, memory]) => ({ name, symbol, bits: [...bits].map(Number), memory }));
  if (entries.length !== 8 || new Set(entries.map(item => item.name)).size !== 8 || new Set(entries.map(item => item.bits.join(''))).size !== 8) throw new Error('知识卡66 的八行阴阳表不完整，请回读原卡');
  return entries;
}

export function parseStructureTable(markdown) {
  const body = section(markdown, '## 三、全 64 卦结构表');
  const rows = body.split('\n').filter(line => /^\|\s*\d+\s*\|/.test(line)).map(line => {
    const cells = line.split('|').slice(1, -1).map(clean);
    if (cells.length !== 8) throw new Error('知识卡65 结构表列数异常');
    const [id, name, lower, upper, lines, correct, count, riding] = cells;
    const names = lines.split(/\s+/);
    if (names.length !== 6 || names.some((value, index) => ![lineName(0, index), lineName(1, index)].includes(value))) throw new Error(`知识卡65 第 ${id} 卦六爻字段异常`);
    const list = value => !value || value === '—' ? [] : value.split(/\s+/);
    return { id: Number(id), name, lower, upper, lines: names, bits: names.map(value => value.includes('九') ? 1 : 0), correct: list(correct), count: Number(count), riding: list(riding) };
  });
  if (rows.length !== 64 || new Set(rows.map(row => row.id)).size !== 64 || rows.some(row => row.id < 1 || row.id > 64)) throw new Error('知识卡65 必须含完整且不重复的64卦');
  if (new Set(rows.map(row => row.lower + row.upper)).size !== 64) throw new Error('知识卡65 上下卦组合有重复');
  return rows;
}

export function calculateStructure(bits) {
  if (bits.length !== 6 || bits.some(bit => bit !== 0 && bit !== 1)) throw new Error('请先选完六爻阴阳');
  const lines = bits.map(lineName);
  const correct = lines.filter((_, index) => bits[index] === (index % 2 === 0 ? 1 : 0));
  const riding = lines.filter((_, index) => index > 0 && bits[index] === 0 && bits[index - 1] === 1);
  return { bits, lines, correct, count: correct.length, riding, central: [lines[1], lines[4]] };
}

export function compareWithAuthority(row, trigrams) {
  const lower = trigrams.find(item => item.name === row.lower);
  const upper = trigrams.find(item => item.name === row.upper);
  if (!lower || !upper) return { ok: false, authority: row, issues: ['上下卦定义缺失'], calculated: null };
  const calculated = calculateStructure([...lower.bits, ...upper.bits]);
  const d = item => item.bits.filter((bit, index) => bit === (index % 2 === 0 ? 1 : 0)).length;
  calculated.formulaCount = 3 + d(lower) - d(upper);
  const fields = { lines: '六爻', correct: '当位爻', count: '当位数', riding: '乘刚爻' };
  const issues = Object.entries(fields).filter(([key]) => JSON.stringify(calculated[key]) !== JSON.stringify(row[key])).map(([, label]) => label);
  if (calculated.formulaCount !== row.count) issues.push('当位数公式');
  return { ok: issues.length === 0, authority: row, calculated, issues };
}

export function validateLibrary(rows, trigrams) {
  return rows.map(row => compareWithAuthority(row, trigrams)).filter(result => !result.ok);
}

export function gradeAttempt(bits, row, trigrams) {
  const comparison = compareWithAuthority(row, trigrams);
  // Never let a calculated answer override a changed reference table.
  if (!comparison.ok) return { ...comparison, status: 'source-mismatch', matches: null };
  calculateStructure(bits);
  const matches = bits.map((bit, index) => bit === row.bits[index]);
  return { ...comparison, status: matches.every(Boolean) ? 'correct' : 'incorrect', matches };
}
