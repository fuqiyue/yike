import { section } from './structure.js';

export const STAGE_CARDS = {
  0: [
    { id: 0, label: '知识卡00 · 第〇节' },
    { id: 65, label: '知识卡65 · 第一、二节' },
  ],
  1: [
    { id: 1, label: '乾 1' }, { id: 2, label: '坤 2' },
    { id: 29, label: '坎 29' }, { id: 30, label: '离 30' },
    { id: 51, label: '震 51' }, { id: 52, label: '艮 52' },
    { id: 57, label: '巽 57' }, { id: 58, label: '兑 58' },
  ],
  2: ['屯 3', '蒙 4', '需 5', '讼 6'].map((label, offset) => ({ id: offset + 3, label })),
  3: [
    { id: 7, label: '师 7' }, { id: 8, label: '比 8' }, { id: 9, label: '小畜 9' },
    { id: 10, label: '履 10' }, { id: 11, label: '泰 11／否 12' },
  ],
  4: [
    { id: 11, label: '泰 11／否 12（已读）' }, { id: 63, label: '既济 63' },
    { id: 64, label: '未济 64' }, { id: 41, label: '损 41' }, { id: 42, label: '益 42' },
    { id: 23, label: '剥 23' }, { id: 24, label: '复 24' },
  ],
  5: [{ id: 0, label: '知识卡00 · 第二节定域路由表' }],
  6: ['孚与信任', '授权与用人', '尊位与放弃', '影响力四路径', '过度与分寸', '消息卦与周期律', '不可控冲击', '明与狱'].map((title, offset) => ({ id: offset + 67, label: `专题卡 ${offset + 67} · ${title}` })),
  7: [],
};

export function parsePathTable(markdown) {
  const section = markdown.match(/## 一、路径总表([\s\S]*?)(?=\n---|\n## )/)?.[1] || '';
  const rows = section.split('\n').filter((line) => /^\|/.test(line)).slice(2);
  const parsed = rows.map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim().replace(/\*\*/g, ''))).filter((row) => row.length >= 6);
  if (parsed.length !== 8 || parsed.some((row, index) => row[0] !== String(index))) {
    throw new Error('知识卡66第一节「路径总表」结构缺失或不是完整的 0–7 八阶，课程已停止生成。');
  }
  return parsed;
}

const COVERED_HEXAGRAM_CARD_IDS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 23, 24, 29, 30, 41, 42, 51, 52, 57, 58, 63, 64]);

export function remainingHexagramCards(cards = []) {
  return cards
    .filter(({ id }) => Number.isInteger(Number(id)) && Number(id) >= 1 && Number(id) <= 64 && !COVERED_HEXAGRAM_CARD_IDS.has(Number(id)))
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map(({ id, title }) => ({ id: Number(id), label: title || `知识卡 ${id}` }));
}

export function parseLearningPlan(markdown, cards) {
  const foundation = section(markdown, '## 起步、七天三画八卦基础');
  const lessons = [...foundation.matchAll(/^### 第(\d)天：([^\n]+)\n([\s\S]*?)(?=^### |$(?![\s\S]))/gm)]
    .map(([, day, title, body]) => ({ day: Number(day), title: title.trim(), markdown: body.trim() }));
  if (lessons.length !== 7 || lessons.some((lesson, index) => lesson.day !== index + 1)) {
    throw new Error('知识卡66 的七天八卦基础不完整，请回读原卡。');
  }
  const goalSection = section(markdown, '## 一、路径总表').split('### 各阶过关标准')[1] || '';
  const goals = [...goalSection.matchAll(/^\| (\d) \| ([^\n]+) \|$/gm)].map(([, stage, goal]) => ({ stage: Number(stage), goal }));
  if (goals.length !== 8 || goals.some((item, index) => item.stage !== index)) throw new Error('知识卡66 的各阶过关标准不完整。');
  const completion = section(markdown, '## 十三、第7阶');
  const groups = [...completion.matchAll(/^\| (\d+) \| ([^\n|]+) \| ([^\n|]+) \|$/gm)].map(([, number, reading, question]) => ({
    number: Number(number), question,
    cards: reading.split('、').map((item) => {
      const match = item.trim().match(/^(\d+)\s+(.+)$/);
      if (!match) throw new Error('知识卡66 补全卦卡格式有误。');
      return { id: Number(match[1]), label: `${match[2]} ${match[1]}` };
    }),
  }));
  const expected = remainingHexagramCards(cards).map(({ id }) => id);
  const actual = groups.flatMap(group => group.cards.map(({ id }) => id));
  if (groups.length !== 10 || groups.some((group, index) => group.number !== index + 1 || group.cards.length !== 4)
      || actual.length !== 40 || new Set(actual).size !== 40
      || JSON.stringify([...actual].sort((a, b) => a - b)) !== JSON.stringify(expected)) {
    throw new Error('知识卡66 的10组补全清单与其余40卦不一致，课程已停止生成。');
  }
  return { lessons, goals: goals.map(item => item.goal), groups };
}
