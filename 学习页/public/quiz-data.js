import { slugify } from "./markdown.js";

export const EXPECTED_QUIZ_COUNTS = Object.freeze({ A: 4, B: 6, C: 4, D: 3 });

const ROUTE_SECTION_TITLES = Object.freeze({
  A: { 0: ["二、定域路由表（第一步\"定域\"）"], 66: ["六、第 5 阶：从\"学\"转到\"用\"（分水岭）"] },
  B: { 66: ["八、七个最容易犯的错（每条都配本库自己的反例）"] },
  C: { 65: ["二、由本表导出的五条结构律（均已证明）"], 75: ["C3 ｜ 六爻全对 vs 六爻全错"] },
  D: {
    65: ["一、计算规则（可复算）", "二、由本表导出的五条结构律（均已证明）"],
    66: ["二、第 0 阶：叠卦与手算（八卦基础之后）"],
  },
});

export class QuizSourceError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = "QuizSourceError";
    this.issues = issues;
  }
}

export function normalizeAssessment(value, questionIds) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const valid = new Set(questionIds);
  return Object.fromEntries(Object.entries(value).filter(([id, state]) =>
    valid.has(id) && (state === "understood" || state === "wrong")));
}

const edgeTrim = (value) => value.replace(/^\s*\n/, "").replace(/\s+$/, "");

function cardNumbersFrom(markdown) {
  const numbers = new Set();
  for (const match of markdown.matchAll(/\*\*[^*\r\n|]*?\b(\d{1,2})\b[^*\r\n|]*\*\*/g)) {
    const value = Number(match[1]);
    if (value >= 1 && value <= 64) numbers.add(value);
  }
  return [...numbers];
}

function parseRouteRows(markdown) {
  const heading = markdown.match(/^## 六、错题指向表[^\r\n]*\r?$/m);
  if (!heading) return [];
  const tail = markdown.slice(heading.index + heading[0].length);
  const nextHeading = tail.search(/^## /m);
  const section = nextHeading < 0 ? tail : tail.slice(0, nextHeading);
  return [...section.matchAll(/^\|\s*\*\*([A-D]) 组\*\*\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/gm)].map((match) => ({
    group: match[1],
    diagnosisMarkdown: match[2],
    routeMarkdown: match[3],
  }));
}

export function parseQuizSource(markdown) {
  if (typeof markdown !== "string" || !markdown.trim()) {
    throw new QuizSourceError("知识卡75没有可读取的正文。", ["markdown-empty"]);
  }

  const questions = [];
  const issues = [];
  const heading = /^### ([A-D])(\d+)\s*｜\s*([^\r\n]+)\r?$/gm;
  const matches = [...markdown.matchAll(heading)];

  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const end = matches[index + 1]?.index ?? markdown.search(/^## 六、错题指向表\s*$/m);
    const block = markdown.slice(current.index + current[0].length, end < 0 ? markdown.length : end);
    const details = block.match(/<details><summary>([^<]+)<\/summary>\s*([\s\S]*?)\s*<\/details>/);
    const id = `${current[1]}${current[2]}`;
    if (!details) {
      issues.push(`${id}: 缺少可配对的 <details> 原答案`);
      continue;
    }
    const questionMarkdown = edgeTrim(block.slice(0, details.index));
    const answerMarkdown = edgeTrim(details[2]);
    if (!questionMarkdown || !answerMarkdown) issues.push(`${id}: 题目或答案为空`);
    questions.push({
      id,
      group: current[1],
      number: Number(current[2]),
      title: current[3],
      questionMarkdown,
      answerSummary: details[1],
      answerMarkdown,
      referencedCardNumbers: cardNumbersFrom(questionMarkdown),
    });
  }

  const routes = parseRouteRows(markdown);
  for (const [group, expected] of Object.entries(EXPECTED_QUIZ_COUNTS)) {
    const actual = questions.filter((question) => question.group === group).length;
    if (actual !== expected) issues.push(`${group} 组应有 ${expected} 题，实际解析 ${actual} 题`);
    if (!routes.some((route) => route.group === group)) issues.push(`${group} 组缺少第六节错题路由`);
  }
  if (questions.length !== 17) issues.push(`题库应有 17 题，实际解析 ${questions.length} 题`);

  if (issues.length) throw new QuizSourceError("知识卡75的题目或错题路由结构异常。", issues);
  return { questions, routes };
}

export function findCardForKnowledgeNumber(cards, number) {
  const padded = String(number).padStart(2, "0");
  return cards.find((card) => card.id === number)
    ?? cards.find((card) => new RegExp(`知识卡(?:\\d+-)?${padded}(?:-|\\.)`).test(card.filename));
}

export function routeTargets(route, questions, cards) {
  const targets = [];
  const addCard = (number, section = "") => {
    const card = findCardForKnowledgeNumber(cards, number);
    if (card && !targets.some((item) => item.card.id === card.id && item.section === section)) {
      targets.push({ card, section });
    }
  };

  const addRoutedCard = (number) => {
    const titles = ROUTE_SECTION_TITLES[route.group]?.[number];
    if (titles) {
      for (const title of titles) addCard(number, slugify(title));
    } else {
      addCard(number);
    }
  };

  for (const match of route.routeMarkdown.matchAll(/知识卡(\d{1,2})/g)) addRoutedCard(Number(match[1]));
  if (/索引第二节/.test(route.routeMarkdown)) addRoutedCard(0);
  if (/本卡 C3/.test(route.routeMarkdown)) addRoutedCard(75);
  if (/对应两卦/.test(route.routeMarkdown)) {
    for (const question of questions.filter((item) => item.group === route.group)) {
      for (const number of question.referencedCardNumbers) addCard(number);
    }
  }
  return targets;
}
