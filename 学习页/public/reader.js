import { plainText, renderMarkdown, slugify } from "./markdown.js";

function ensureStylesheet() {
  if (document.querySelector('link[data-reader-styles]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("./reader.css", import.meta.url).href;
  link.dataset.readerStyles = "";
  document.head.append(link);
}

function section(raw, headingText) {
  const lines = String(raw || "").replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((line) => new RegExp(`^#{2,4}\\s+.*${headingText}`).test(line));
  if (start < 0) return "";
  const level = (lines[start].match(/^#+/) || ["##"])[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const match = lines[i].match(/^(#{1,6})\s+/);
    if (match && match[1].length <= level) { end = i; break; }
  }
  return lines.slice(start, end).join("\n");
}

function cardNumber(card) {
  return String(card.filename || card.title || "").match(/知识卡(\d{2})/)?.[1] || String(card.id).padStart(2, "0");
}

function groupFor(card) {
  const number = Number(cardNumber(card));
  if (number >= 67 && number <= 74) return "第 6 阶 · 横读专题";
  if ([0, 65, 66, 75].includes(number)) return "索引与学习工具";
  return "六十四卦";
}

function createCardIndex(cards, onOpen) {
  const root = document.createElement("div");
  const search = document.createElement("input");
  search.className = "reader-search";
  search.type = "search";
  search.placeholder = "搜索卡号或标题";
  search.setAttribute("aria-label", "搜索知识卡");
  const groups = document.createElement("div");
  root.append(search, groups);

  const draw = () => {
    const query = search.value.trim().toLocaleLowerCase("zh-CN");
    groups.replaceChildren();
    for (const name of ["索引与学习工具", "第 6 阶 · 横读专题", "六十四卦"]) {
      const matches = cards.filter((card) => groupFor(card) === name && `${cardNumber(card)} ${card.title} ${card.filename}`.toLocaleLowerCase("zh-CN").includes(query));
      if (!matches.length) continue;
      const block = document.createElement("section");
      block.className = "reader-card-group";
      const heading = document.createElement("h3"); heading.textContent = name;
      const list = document.createElement("div"); list.className = "reader-card-list";
      for (const card of matches) {
        const button = document.createElement("button");
        button.type = "button"; button.dataset.cardId = card.id;
        const number = document.createElement("span");
        number.className = "reader-card-number";
        number.textContent = cardNumber(card);
        const title = document.createElement("span"); title.className = "reader-card-title";
        title.textContent = plainText(card.title || card.filename);
        button.append(number, title);
        button.addEventListener("click", () => onOpen(card.id));
        list.append(button);
      }
      block.append(heading, list); groups.append(block);
    }
    if (!groups.children.length) groups.innerHTML = '<p class="reader-empty">没有匹配的知识卡</p>';
  };
  search.addEventListener("input", draw); draw();
  return { root, setActive(id) { root.querySelectorAll("button").forEach((button) => button.classList.toggle("is-active", String(button.dataset.cardId) === String(id))); } };
}

function learningGuide(raw, cards, isLearningCard) {
  const order = section(raw, "读一张卦卡的正确顺序");
  const aids = isLearningCard ? [
    ["七个最容易犯的错", section(raw, "八、七个最容易犯的错")],
    ["要背的只有三样", section(raw, "九、要背的东西")],
    ["十九周首轮学习", section(raw, "十、每天 20 分钟")]
  ] : [];
  if (!order && !aids.some(([, value]) => value)) return "";
  const prefixIds = (html) => html.replace(/(<h[1-6]) id="([^"]+)"/g, '$1 id="guide-$2"');
  return `<aside class="reader-guide">${order ? `<details class="reader-guide-primary"><summary>读一张卦卡的顺序</summary>${prefixIds(renderMarkdown(order, { cards }))}</details>` : ""}${aids.filter(([, value]) => value).map(([title, value]) => `<details><summary>${title}</summary>${prefixIds(renderMarkdown(value, { cards }))}</details>`).join("")}</aside>`;
}

function buildToc(article, currentId, navigate) {
  const nav = document.createElement("nav"); nav.className = "reader-toc"; nav.setAttribute("aria-label", "本卡目录");
  const title = document.createElement("strong"); title.textContent = "本卡目录"; nav.append(title);
  const toggle = document.createElement("button"); toggle.className = "reader-toc-toggle";
  toggle.type = "button"; toggle.textContent = "展开本卡目录";
  toggle.setAttribute("aria-expanded", "false");
  toggle.addEventListener("click", () => {
    const expanded = nav.classList.toggle("is-expanded");
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.textContent = expanded ? "收起本卡目录" : "展开本卡目录";
  });
  nav.append(toggle);
  const headings = article.querySelectorAll("h2, h3");
  headings.forEach((heading) => {
    const link = document.createElement("a");
    link.href = `#reader/${currentId}/${heading.id}`;
    link.className = heading.tagName === "H3" ? "is-subsection" : "";
    link.textContent = heading.textContent;
    link.addEventListener("click", (event) => { event.preventDefault(); navigate(link.getAttribute("href")); });
    nav.append(link);
  });
  return nav;
}

export async function mountReader(container, context) {
  ensureStylesheet();
  const cards = Array.isArray(context?.cards) ? context.cards : [];
  let disposed = false;
  const pendingFrames = new Set();
  container.innerHTML = '<div class="reader-shell"><aside class="reader-library"></aside><main class="reader-main"><div class="reader-status">正在打开知识卡…</div></main></div>';
  const library = container.querySelector(".reader-library");
  const main = container.querySelector(".reader-main");
  const open = (id, slug = "") => context.navigate(`#reader/${id}${slug ? `/${slug}` : ""}`);
  const index = createCardIndex(cards, open); library.append(index.root);

  async function loadFromHash() {
    const match = location.hash.match(/^#reader\/(\d+)(?:\/(.+))?$/);
    const fallback = cards.find((card) => Number(cardNumber(card)) === 66) || cards[0];
    const id = Number(match?.[1] ?? fallback?.id);
    const target = cards.find((card) => Number(card.id) === id) || fallback;
    if (!target) { main.innerHTML = '<p class="reader-error">没有可阅读的知识卡。</p>'; return; }
    index.setActive(target.id);
    main.innerHTML = '<div class="reader-status">正在读取原始卡片…</div>';
    try {
      const guideCard = cards.find((card) => Number(cardNumber(card)) === 66);
      const [card, guide] = await Promise.all([
        context.getCard(target.id),
        guideCard && Number(guideCard.id) !== Number(target.id) ? context.getCard(guideCard.id) : Promise.resolve(null)
      ]);
      if (disposed) return;
      const guideRaw = guide?.markdown || card.markdown;
      const isLearningCard = Number(cardNumber(target)) === 66;
      const article = document.createElement("article"); article.className = "reader-article";
      article.innerHTML = learningGuide(guideRaw, cards, isLearningCard);
      const source = document.createElement("div");
      source.className = "reader-source";
      source.innerHTML = renderMarkdown(card.markdown, { cards });
      article.append(source);
      article.addEventListener("click", (event) => {
        const link = event.target.closest("a[data-card-id]");
        if (!link) return;
        event.preventDefault(); open(link.dataset.cardId);
      });
      const toc = buildToc(source, target.id, context.navigate);
      const layout = document.createElement("div"); layout.className = "reader-reading-layout"; layout.append(toc, article);
      main.replaceChildren(layout);
      let slug = "";
      try { slug = decodeURIComponent(match?.[2] || ""); } catch { slug = match?.[2] || ""; }
      if (slug) {
        let attempts = 0;
        const scrollAfterMount = () => {
          pendingFrames.delete(frame);
          if (disposed) return;
          if (!container.isConnected && attempts++ < 12) {
            frame = requestAnimationFrame(scrollAfterMount);
            pendingFrames.add(frame);
            return;
          }
          if (!container.isConnected) return;
          [...source.querySelectorAll("[id]")].find((element) => element.id === slug)?.scrollIntoView({ block: "start" });
        };
        let frame = requestAnimationFrame(scrollAfterMount);
        pendingFrames.add(frame);
      }
      document.title = `${plainText(card.title || target.title)} · 易学阅读`;
    } catch (error) {
      if (!disposed) main.innerHTML = `<p class="reader-error">知识卡读取失败。<button type="button">重新读取</button></p>`;
      main.querySelector("button")?.addEventListener("click", loadFromHash);
      console.error(error);
    }
  }

  await loadFromHash();
  return () => { disposed = true; pendingFrames.forEach((frame) => cancelAnimationFrame(frame)); pendingFrames.clear(); };
}

export { renderMarkdown, plainText, slugify } from "./markdown.js";
