import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { EXPECTED_QUIZ_COUNTS, findCardForKnowledgeNumber, normalizeAssessment, parseQuizSource, routeTargets } from "./quiz-data.js";
import { slugify } from "./markdown.js";
import { saveAssessment } from "./quiz.js";

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(resolve(here, "../../知识库/知识卡75-辨析题库.md"), "utf8");
const data = parseQuizSource(source);
const cardNames = (await readdir(resolve(here, "../../知识库")))
  .filter((filename) => /^知识卡\d{2}/.test(filename))
  .map((filename) => ({
    id: Number(filename.match(/^知识卡(\d{2})/)[1]),
    title: filename.replace(/^知识卡\d{2}(?:-\d{2})?-/, "").replace(/\.md$/, ""),
    filename,
  }));

test("从卡75完整抽取17题及 A4/B6/C4/D3 分布", () => {
  assert.equal(data.questions.length, 17);
  for (const [group, count] of Object.entries(EXPECTED_QUIZ_COUNTS)) {
    assert.equal(data.questions.filter((question) => question.group === group).length, count);
  }
});

test("题目与原答案保持源文逐字片段", () => {
  for (const question of data.questions) {
    assert.ok(source.includes(question.title));
    assert.ok(source.includes(question.questionMarkdown));
    assert.ok(source.includes(question.answerMarkdown));
    assert.ok(question.questionMarkdown.includes("**问**") || question.group === "D");
  }
});

test("四组均从第六节取得错题路由", () => {
  assert.deepEqual(data.routes.map((route) => route.group), ["A", "B", "C", "D"]);
  assert.match(data.routes.find((route) => route.group === "A").routeMarkdown, /知识卡66.*索引第二节/);
  assert.match(data.routes.find((route) => route.group === "B").routeMarkdown, /对应两卦/);
  assert.match(data.routes.find((route) => route.group === "C").routeMarkdown, /知识卡65.*本卡 C3/);
  assert.match(data.routes.find((route) => route.group === "D").routeMarkdown, /知识卡65.*知识卡66/);
});

test("合卡路由把卦12映射到卡11，且卡02保持坤卦", () => {
  assert.equal(findCardForKnowledgeNumber(cardNames, 12)?.id, 11);
  assert.equal(findCardForKnowledgeNumber(cardNames, 2)?.id, 2);
  assert.notEqual(findCardForKnowledgeNumber(cardNames, 12)?.id, 2);
});

test("自评只接受当前17个题号与两个合法状态", () => {
  const ids = data.questions.map((question) => question.id);
  assert.deepEqual(normalizeAssessment({ A1: "wrong", D3: "understood", Z9: "wrong", B2: "旧值" }, ids), {
    A1: "wrong",
    D3: "understood",
  });
});

test("localStorage 写入失败不会抛错，自评可继续留在内存", () => {
  const assessment = { A1: "wrong" };
  assert.equal(saveAssessment({ setItem() { throw new Error("quota"); } }, assessment), false);
  assert.deepEqual(assessment, { A1: "wrong" });
  let saved = "";
  assert.equal(saveAssessment({ setItem(_key, value) { saved = value; } }, assessment), true);
  assert.equal(JSON.parse(saved).A1, "wrong");
});

test("所有静态错题指向均解析为真实卡，不产生不存在的卡12", () => {
  for (const route of data.routes) {
    const targets = routeTargets(route, data.questions, cardNames);
    assert.ok(targets.length >= 2);
    assert.equal(targets.some((target) => target.card.id === 12), false);
  }
});

test("每个精确错题路由锚点都来自目标卡的真实标题", async () => {
  for (const route of data.routes) {
    for (const target of routeTargets(route, data.questions, cardNames).filter((item) => item.section)) {
      const markdown = await readFile(resolve(here, "../../知识库", target.card.filename), "utf8");
      const actualAnchors = [...markdown.matchAll(/^#{2,3}\s+(.+)$/gm)].map((match) => slugify(match[1]));
      assert.ok(actualAnchors.includes(target.section), `${route.group} → ${target.card.filename}#${target.section}`);
    }
  }
});
