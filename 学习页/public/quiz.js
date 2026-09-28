import { renderMarkdown } from "./markdown.js";
import { normalizeAssessment, parseQuizSource, QuizSourceError, routeTargets } from "./quiz-data.js";
import { learningStorage } from './storage.js';

const STORAGE_KEY = "yijing-learning:quiz75:self-assessment:v1";

export function saveAssessment(storage, assessment) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(assessment));
    return true;
  } catch {
    return false;
  }
}

function readAssessment(questionIds) {
  try {
    const value = JSON.parse(learningStorage.getItem(STORAGE_KEY) || "{}");
    return normalizeAssessment(value, questionIds);
  } catch {
    return {};
  }
}

function card75Link(container, context, label = "直接阅读知识卡75") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "quiz-text-link";
  button.textContent = label;
  button.addEventListener("click", () => context.navigate("#reader/75"));
  container.append(button);
}

function showSourceError(container, context, error) {
  container.replaceChildren();
  const panel = document.createElement("section");
  panel.className = "quiz-source-error";
  panel.setAttribute("role", "alert");
  const title = document.createElement("h2");
  title.textContent = "题库读取异常";
  const message = document.createElement("p");
  message.textContent = error instanceof Error ? error.message : "无法读取知识卡75。";
  panel.append(title, message);
  if (error instanceof QuizSourceError && error.issues.length) {
    const list = document.createElement("ul");
    for (const issue of error.issues) {
      const item = document.createElement("li");
      item.textContent = issue;
      list.append(item);
    }
    panel.append(list);
  }
  card75Link(panel, context);
  container.append(panel);
}

function renderRoute(route, data, context) {
  const section = document.createElement("section");
  section.className = "quiz-route";
  const heading = document.createElement("h3");
  heading.textContent = `${route.group} 组回读`;
  const diagnosis = document.createElement("div");
  diagnosis.className = "quiz-markdown";
  diagnosis.innerHTML = renderMarkdown(route.diagnosisMarkdown, { cards: context.cards });
  const source = document.createElement("div");
  source.className = "quiz-route-source";
  const sourceLabel = document.createElement("strong");
  sourceLabel.textContent = "卡75原指向：";
  const sourceText = document.createElement("div");
  sourceText.innerHTML = renderMarkdown(route.routeMarkdown, { cards: context.cards });
  source.append(sourceLabel, sourceText);
  const links = document.createElement("div");
  links.className = "quiz-route-links";
  for (const target of routeTargets(route, data.questions, context.cards)) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `回读 ${target.card.title}`;
    button.addEventListener("click", () => {
      const suffix = target.section ? `/${target.section}` : "";
      context.navigate(`#reader/${target.card.id}${suffix}`);
    });
    links.append(button);
  }
  section.append(heading, diagnosis, source, links);
  return section;
}

export async function mountQuiz(container, context) {
  const controller = new AbortController();
  container.replaceChildren();
  container.classList.add("quiz-page");
  const loading = document.createElement("p");
  loading.className = "quiz-loading";
  loading.textContent = "正在从知识卡75读取题目……";
  container.append(loading);

  try {
    const card = await context.getCard(75);
    if (controller.signal.aborted) return () => {};
    const data = parseQuizSource(card.markdown);
    const assessment = readAssessment(data.questions.map((question) => question.id));
    const drafts = new Map();

    const intro = document.createElement("header");
    intro.className = "quiz-intro";
    intro.innerHTML = `<p class="quiz-kicker">知识卡 75 · 辨析题库</p><h1>先想，再看原答案</h1><p>17 道原题按 A4、B6、C4、D3 分组。这里不替你判分；展开原答案后，请自行标记“已理解”或“答错”。草稿只留在当前页面内。</p>`;

    const summary = document.createElement("div");
    summary.className = "quiz-summary";
    summary.setAttribute("aria-live", "polite");
    const updateSummary = () => {
      const understood = Object.values(assessment).filter((value) => value === "understood").length;
      const wrong = Object.values(assessment).filter((value) => value === "wrong").length;
      summary.textContent = `已理解 ${understood} · 答错 ${wrong} · 未标记 ${17 - understood - wrong}`;
    };
    updateSummary();
    const storageNotice = document.createElement("p");
    storageNotice.className = "quiz-storage-notice";
    storageNotice.setAttribute("role", "status");
    storageNotice.hidden = true;

    const groups = document.createElement("div");
    groups.className = "quiz-groups";
    const inlineRoutes = new Map();
    for (const group of Object.keys({ A: 1, B: 1, C: 1, D: 1 })) {
      const groupSection = document.createElement("section");
      groupSection.className = "quiz-group";
      const groupTitle = document.createElement("h2");
      groupTitle.textContent = `${group} 组 · ${data.questions.filter((item) => item.group === group).length} 题`;
      groupSection.append(groupTitle);

      for (const question of data.questions.filter((item) => item.group === group)) {
        const article = document.createElement("article");
        article.className = "quiz-question";
        article.dataset.state = assessment[question.id] || "unmarked";
        const heading = document.createElement("h3");
        heading.textContent = `${question.id} ｜ ${question.title}`;
        const prompt = document.createElement("div");
        prompt.className = "quiz-markdown quiz-prompt";
        prompt.innerHTML = renderMarkdown(question.questionMarkdown, { cards: context.cards });
        const draftLabel = document.createElement("label");
        draftLabel.htmlFor = `quiz-draft-${question.id}`;
        draftLabel.textContent = "我的草稿（仅本次打开期间保留）";
        const draft = document.createElement("textarea");
        draft.id = `quiz-draft-${question.id}`;
        draft.rows = 3;
        draft.value = drafts.get(question.id) || "";
        draft.addEventListener("input", () => drafts.set(question.id, draft.value), { signal: controller.signal });
        const details = document.createElement("details");
        details.className = "quiz-answer";
        const reveal = document.createElement("summary");
        reveal.textContent = `展开${question.answerSummary}`;
        const answer = document.createElement("div");
        answer.className = "quiz-markdown";
        answer.innerHTML = renderMarkdown(question.answerMarkdown, { cards: context.cards });
        const actions = document.createElement("div");
        actions.className = "quiz-assessment";
        actions.setAttribute("aria-label", `${question.id} 自评`);
        for (const [state, label] of [["understood", "已理解"], ["wrong", "答错"]]) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = label;
          button.setAttribute("aria-pressed", String(assessment[question.id] === state));
          button.addEventListener("click", () => {
            assessment[question.id] = state;
            if (!saveAssessment(learningStorage, assessment)) {
              storageNotice.hidden = false;
              storageNotice.textContent = "未能保存自评；本次打开期间仍可继续作答。请稍后重试。";
            }
            article.dataset.state = state;
            for (const sibling of actions.querySelectorAll("button[aria-pressed]")) sibling.setAttribute("aria-pressed", String(sibling === button));
            updateSummary();
            refreshRoutes();
          }, { signal: controller.signal });
          actions.append(button);
        }
        const clear = document.createElement("button");
        clear.type = "button";
        clear.className = "quiz-clear-assessment";
        clear.textContent = "清除自评";
        clear.addEventListener("click", () => {
          delete assessment[question.id];
          if (!saveAssessment(learningStorage, assessment)) {
            storageNotice.hidden = false;
            storageNotice.textContent = "未能保存自评；本次打开期间仍可继续作答。请稍后重试。";
          }
          article.dataset.state = "unmarked";
          for (const sibling of actions.querySelectorAll("button[aria-pressed]")) sibling.setAttribute("aria-pressed", "false");
          updateSummary();
          refreshRoutes();
        }, { signal: controller.signal });
        actions.append(clear);
        const inlineRoute = document.createElement("div");
        inlineRoute.className = "quiz-inline-route";
        inlineRoutes.set(question.id, inlineRoute);
        details.append(reveal, answer, actions, inlineRoute);
        article.append(heading, prompt, draftLabel, draft, details);
        groupSection.append(article);
      }
      groups.append(groupSection);
    }

    const routeHeading = document.createElement("h2");
    routeHeading.className = "quiz-route-heading";
    routeHeading.textContent = "错题回读";
    const routes = document.createElement("div");
    routes.className = "quiz-routes";
    const refreshRoutes = () => {
      for (const question of data.questions) {
        const inline = inlineRoutes.get(question.id);
        const route = data.routes.find((item) => item.group === question.group);
        inline.replaceChildren(...(assessment[question.id] === "wrong" && route ? [renderRoute(route, data, context)] : []));
      }
      const activeRoutes = data.routes
        .filter((item) => data.questions.some((question) => question.group === item.group && assessment[question.id] === "wrong"))
        .map((item) => renderRoute(item, data, context));
      if (activeRoutes.length) {
        routes.replaceChildren(...activeRoutes);
      } else {
        const routeHint = document.createElement("p");
        routeHint.className = "quiz-route-hint";
        routeHint.textContent = "把任一题标为“答错”后，这里会按卡75第六节显示对应回读入口。";
        routes.replaceChildren(routeHint);
      }
    };
    refreshRoutes();
    container.replaceChildren(intro, summary, storageNotice, groups, routeHeading, routes);
  } catch (error) {
    if (!controller.signal.aborted) showSourceError(container, context, error);
  }

  return () => {
    controller.abort();
    container.classList.remove("quiz-page");
    container.replaceChildren();
  };
}
