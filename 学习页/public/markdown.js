const RAW_TAGS = /&lt;(\/?)(details|summary|br)\s*\/?&gt;/gi;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function plainText(raw) {
  return String(raw ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~>#|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugify(text) {
  const slug = plainText(text)
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

function cardTarget(number, cards) {
  const n = Number(number);
  const exact = cards.find((card) => Number(card.id) === n);
  if (exact) return exact.id;
  const padded = String(n).padStart(2, "0");
  const byFile = cards.find((card) => {
    const match = String(card.filename || "").match(/知识卡(\d{2})(?:-(\d{2}))?/);
    if (!match) return false;
    return match[1] === padded || match[2] === padded;
  });
  return byFile?.id ?? null;
}

function inline(source, cards) {
  const code = [];
  let value = escapeHtml(source).replace(/`([^`\n]+)`/g, (_, body) => {
    code.push(`<code>${body}</code>`);
    return `\u0000CODE${code.length - 1}\u0000`;
  });

  value = value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '<span class="md-image-note" role="note">[图片：$1]</span>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      const safe = href.trim();
      if (/^#[\p{Letter}\p{Number}_-]+$/u.test(safe)) return `<a href="${safe}">${label}</a>`;
      return `<span class="md-link-label">${label}</span>`;
    })
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>")
    .replace(/知识卡\s*(\d{1,2})(?!\d)/gu, (all, number) => {
      const target = cardTarget(number, cards);
      return target == null
        ? all
        : `<a class="card-reference" href="#reader/${target}" data-card-id="${target}">知识卡${String(number).padStart(2, "0")}</a>`;
    })
    .replace(RAW_TAGS, (_, close, tag) => tag.toLowerCase() === "br" ? "<br>" : `<${close}${tag.toLowerCase()}>`);

  return value.replace(/\u0000CODE(\d+)\u0000/g, (_, index) => code[Number(index)]);
}

function isTableDivider(line) {
  const cells = line.trim().replace(/^\||\|$/g, "").split("|");
  return cells.length > 1 && cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell));
}

function tableRow(line) {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

export function renderMarkdown(raw, { cards = [] } = {}) {
  const lines = String(raw ?? "").replace(/\r\n?/g, "\n").split("\n");
  const html = [];
  const slugs = new Map();
  let paragraph = [];
  let listType = null;
  let listNext = null;
  let quote = [];
  let inCode = false;
  let codeLang = "";
  let codeLines = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${inline(paragraph.join("\n"), cards).replace(/\n/g, "<br>")}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = null;
    listNext = null;
  };
  const flushQuote = () => {
    if (!quote.length) return;
    html.push(`<blockquote>${quote.map((line) => inline(line, cards)).join("<br>")}</blockquote>`);
    quote = [];
  };
  const closeBlocks = () => { flushParagraph(); flushList(); flushQuote(); };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fence = line.match(/^```\s*([^ ]*)/);
    if (fence) {
      if (inCode) {
        html.push(`<pre><code${codeLang ? ` data-language="${escapeHtml(codeLang)}"` : ""}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        inCode = false; codeLang = ""; codeLines = [];
      } else {
        closeBlocks(); inCode = true; codeLang = fence[1] || "";
      }
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      closeBlocks();
      const level = heading[1].length;
      const base = slugify(heading[2]);
      const count = (slugs.get(base) || 0) + 1;
      slugs.set(base, count);
      const id = count === 1 ? base : `${base}-${count}`;
      html.push(`<h${level} id="${escapeHtml(id)}">${inline(heading[2], cards)}</h${level}>`);
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      closeBlocks();
      const heads = tableRow(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(tableRow(lines[i])); i += 1;
      }
      i -= 1;
      html.push('<div class="table-scroll"><table><thead><tr>' + heads.map((cell) => `<th>${inline(cell, cards)}</th>`).join("") + "</tr></thead><tbody>" + rows.map((row) => "<tr>" + heads.map((_, index) => `<td>${inline(row[index] || "", cards)}</td>`).join("") + "</tr>").join("") + "</tbody></table></div>");
      continue;
    }

    const item = line.match(/^\s*([-+*]|\d+[.)])\s+(.+)$/);
    if (item) {
      flushParagraph(); flushQuote();
      const wanted = /^\d/.test(item[1]) ? "ol" : "ul";
      const sourceNumber = wanted === "ol" ? Number.parseInt(item[1], 10) : null;
      if (listType !== wanted) {
        flushList();
        html.push(wanted === "ol" ? `<ol${sourceNumber === 1 ? "" : ` start="${sourceNumber}"`}>` : "<ul>");
        listType = wanted;
        listNext = sourceNumber;
      }
      const value = wanted === "ol" && sourceNumber !== listNext ? ` value="${sourceNumber}"` : "";
      html.push(`<li${value}>${inline(item[2], cards)}</li>`);
      if (wanted === "ol") listNext = sourceNumber + 1;
      continue;
    }

    const blockquote = line.match(/^>\s?(.*)$/);
    if (blockquote) { flushParagraph(); flushList(); quote.push(blockquote[1]); continue; }

    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) { closeBlocks(); html.push("<hr>"); continue; }
    if (/^\s*$/.test(line)) { closeBlocks(); continue; }

    if (/^\s*<\/?details>\s*$/i.test(line) || /^\s*<summary>.*<\/summary>\s*$/i.test(line) || /^\s*<br\s*\/?>\s*$/i.test(line)) {
      closeBlocks(); html.push(inline(line.trim(), cards)); continue;
    }
    paragraph.push(line.trim());
  }
  if (inCode) html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  closeBlocks();
  return html.join("\n");
}
