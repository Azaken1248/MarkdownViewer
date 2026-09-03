// Deriving a title and a plain-text summary from a document, for link previews.
//
// Crawlers read og:description as text, so this has to *undo* markdown rather
// than render it: a preview showing `## Overview` or a fenced code block is
// worse than no preview. The rules below are ordered — front matter and fences
// come out before inline syntax, because otherwise a `#` inside a code block
// looks like a heading.
//
// This is not a markdown parser and does not need to be. It only has to produce
// a readable sentence or two, and fail to plain text rather than fail loudly.

const MAX_DESCRIPTION_LENGTH = 200;
const MAX_TITLE_LENGTH = 120;

// Notebooks and diagram sources are not prose; summarising their raw JSON or
// their graph syntax produces noise, so they are handled separately below.
const NOTEBOOK_EXTENSIONS = new Set([".ipynb"]);
const DIAGRAM_EXTENSIONS = new Set([".mmd", ".mermaid"]);

function extensionOf(fileName) {
  const match = String(fileName || "").toLowerCase().match(/\.[a-z0-9]+$/);
  return match ? match[0] : "";
}

function stripFrontMatter(markdown) {
  // Only at the very start, and only the first block — a `---` further down is
  // a horizontal rule, not the end of metadata.
  // The \uFEFF is a byte-order mark, written as an escape rather than as the
  // character itself: as a character it is invisible in every editor, which
  // makes it indistinguishable from a typo in a regex that must not have one.
  return String(markdown || "").replace(/^\uFEFF?\s*---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
}

function stripMarkdown(markdown) {
  let text = stripFrontMatter(markdown);

  // Block-level constructs first, so their contents cannot be mistaken for
  // inline syntax afterwards.
  text = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/^\s{4,}\S.*$/gm, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/?[a-z][^>]*>/gi, " ")
    // Tables read terribly as a sentence.
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    // Horizontal rules, and the `===` / `---` runs that underline a setext
    // heading — the heading text is prose, the underline is punctuation.
    .replace(/^\s*[-*_=]{3,}\s*$/gm, " ");

  text = text
    // Images before links: an image is a link with a leading bang, and its alt
    // text is rarely a sentence.
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    // Reference definitions and bare URLs.
    .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, " ")
    .replace(/<https?:\/\/[^>]+>/g, " ");

  return text.replace(/\s+/g, " ").trim();
}

function truncate(text, maxLength) {
  const value = String(text || "").trim();
  if (value.length <= maxLength) {
    return value;
  }

  // Cut on a word boundary, not mid-word, and only fall back to a hard cut when
  // there is no space to break on.
  const clipped = value.slice(0, maxLength - 1);
  const lastSpace = clipped.lastIndexOf(" ");
  const base = lastSpace > maxLength * 0.6 ? clipped.slice(0, lastSpace) : clipped;
  return `${base.replace(/[\s.,;:!?-]+$/, "")}…`;
}

// The first markdown cell of a notebook is where its prose lives; the rest is
// code and output.
function notebookMarkdownSource(rawContent) {
  try {
    const notebook = JSON.parse(rawContent);
    const cells = Array.isArray(notebook.cells) ? notebook.cells : [];

    for (const cell of cells) {
      if (cell?.cell_type !== "markdown") {
        continue;
      }

      const source = Array.isArray(cell.source) ? cell.source.join("") : String(cell.source || "");
      if (stripMarkdown(source)) {
        return source;
      }
    }
  } catch {
    // Malformed notebook. Fall through to the generic description.
  }

  return "";
}

function notebookProse(rawContent) {
  return stripMarkdown(notebookMarkdownSource(rawContent));
}

function firstMermaidLabel(rawContent) {
  // `graph TD`, `sequenceDiagram`, `erDiagram`, ... — the first keyword tells a
  // reader far more than the node list would.
  const first = String(rawContent || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("%%"));

  return first ? first.replace(/\s+/g, " ").slice(0, 60) : "";
}

// The document's own H1 wins over its filename: "Q3 Planning Notes" beats
// "q3-planning-notes".
function extractTitle(fileName, rawContent, fallbackTitle) {
  const extension = extensionOf(fileName);

  // A notebook's prose lives in its markdown cells, so run the same heading
  // rules over the first one rather than over the raw JSON.
  if (NOTEBOOK_EXTENSIONS.has(extension)) {
    const source = notebookMarkdownSource(rawContent);
    return source ? extractTitle("cell.md", source, fallbackTitle) : fallbackTitle;
  }

  if (DIAGRAM_EXTENSIONS.has(extension)) {
    return fallbackTitle;
  }

  const body = stripFrontMatter(rawContent).replace(/```[\s\S]*?```/g, "");

  const atx = body.match(/^\s{0,3}#\s+(.+?)\s*#*\s*$/m);
  if (atx) {
    const text = stripMarkdown(atx[1]);
    if (text) {
      return truncate(text, MAX_TITLE_LENGTH);
    }
  }

  // Setext: a line underlined with = signs.
  const setext = body.match(/^\s{0,3}(\S.*)\r?\n\s{0,3}=+\s*$/m);
  if (setext) {
    const text = stripMarkdown(setext[1]);
    if (text) {
      return truncate(text, MAX_TITLE_LENGTH);
    }
  }

  return fallbackTitle;
}

function extractDescription(fileName, rawContent, { title = "", siteName = "" } = {}) {
  const extension = extensionOf(fileName);

  if (DIAGRAM_EXTENSIONS.has(extension)) {
    const kind = firstMermaidLabel(rawContent);
    return kind ? `Mermaid diagram — ${kind}` : "A Mermaid diagram.";
  }

  const text = NOTEBOOK_EXTENSIONS.has(extension)
    ? notebookProse(rawContent)
    : stripMarkdown(rawContent);

  if (!text) {
    return siteName ? `A document shared from ${siteName}.` : "A shared document.";
  }

  // The first line of a document is usually its title, and repeating it as the
  // description wastes the preview's second line.
  const normalizedTitle = String(title || "").trim().toLowerCase();
  let body = text;
  if (normalizedTitle && body.toLowerCase().startsWith(normalizedTitle)) {
    body = body.slice(normalizedTitle.length).replace(/^[\s.:—–-]+/, "");
  }

  return truncate(body || text, MAX_DESCRIPTION_LENGTH);
}

module.exports = {
  extractTitle,
  extractDescription,
  stripMarkdown,
  truncate,
  MAX_DESCRIPTION_LENGTH,
  MAX_TITLE_LENGTH
};
