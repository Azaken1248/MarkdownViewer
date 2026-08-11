/* Editing markdown as formatted text rather than as source.
 *
 * The danger in every WYSIWYG markdown editor is the round trip. Parse a
 * document into a tree, edit one word, write the tree back out, and the whole
 * file comes back subtly different: list markers swapped, emphasis re-spelled,
 * line wrapping redone, a table realigned. For a library of documents you did
 * not write in this app, that is not a cosmetic annoyance — it is a diff you
 * did not ask for on every file you open.
 *
 * So this does not round-trip the document. It round-trips only the blocks you
 * touched.
 *
 * splitBlocks() cuts the source into blocks and keeps each one's exact text,
 * including its trailing newlines, and including the blank runs between them as
 * blocks of their own. Nothing is normalised and nothing is dropped, so
 * joining the pieces reproduces the input byte for byte — that is asserted
 * against every document in the real library, not just fixtures.
 *
 * Editing a block replaces that block's source and leaves every other block
 * untouched. Open a document, fix a typo in one paragraph, save: the diff is
 * that paragraph.
 *
 * Blocks that markdown expresses more precisely than formatted text can — code
 * fences, tables, math, HTML, front matter — are not rendered as rich text at
 * all. They are shown as their source, editable as source. Pretending to
 * WYSIWYG a table and then rewriting its alignment is exactly the kind of
 * damage this design exists to avoid.
 */

(function (global) {
  "use strict";

  // Blocks whose meaning survives being shown as formatted text and written
  // back. Everything else is handled as source.
  const RICH_TYPES = new Set(["heading", "paragraph", "list", "blockquote", "hr"]);

  const FENCE_RE = /^(\s{0,3})(`{3,}|~{3,})(.*)$/;
  const HEADING_RE = /^ {0,3}#{1,6}(\s|$)/;
  const HR_RE = /^ {0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/;
  const LIST_ITEM_RE = /^ {0,3}([-*+]|\d{1,9}[.)])(\s|$)/;
  const BLOCKQUOTE_RE = /^ {0,3}>/;
  const HTML_BLOCK_RE = /^ {0,3}<(\/?[A-Za-z][A-Za-z0-9-]*)(\s|\/?>|$)/;
  const TABLE_DELIMITER_RE = /^ {0,3}\|?[\s:-]*-[\s:|-]*\|?\s*$/;
  const MATH_FENCE_RE = /^ {0,3}\$\$\s*$/;

  function isBlank(line) {
    return line.trim() === "";
  }

  /* Cut markdown into blocks.
   *
   * The contract every other function here depends on:
   *
   *     splitBlocks(src).map((b) => b.source).join("") === src
   *
   * for any input at all. Blank runs are blocks too, which is what makes that
   * true without anyone having to reason about where the newlines went.
   */
  function splitBlocks(markdown) {
    const text = String(markdown == null ? "" : markdown);
    // Keeping the terminators attached to their lines means a document with no
    // trailing newline stays a document with no trailing newline.
    const lines = text.length === 0 ? [] : text.split("\n").map((line, index, all) =>
      (index === all.length - 1 ? line : `${line}\n`));

    const blocks = [];
    let index = 0;

    const raw = (i) => lines[i].replace(/\n$/, "");
    const push = (type, from, to, extra = {}) => {
      const source = lines.slice(from, to).join("");
      // A document ending in a newline leaves an empty final line. Keeping it
      // as a block would add a zero-length entry that joins to nothing and
      // only shows up as noise in the block list.
      if (source === "") {
        return;
      }
      blocks.push({ type, source, ...extra });
    };

    // Front matter, and only at the very start, which is the only place it
    // means anything.
    if (lines.length > 0 && /^---\s*$/.test(raw(0))) {
      let end = 1;
      while (end < lines.length && !/^(---|\.\.\.)\s*$/.test(raw(end))) {
        end += 1;
      }
      if (end < lines.length) {
        push("frontmatter", 0, end + 1);
        index = end + 1;
      }
    }

    while (index < lines.length) {
      // Blank runs are their own blocks so no other rule has to preserve them.
      if (isBlank(raw(index))) {
        let end = index;
        while (end < lines.length && isBlank(raw(end))) {
          end += 1;
        }
        push("blank", index, end);
        index = end;
        continue;
      }

      const line = raw(index);

      const fence = line.match(FENCE_RE);
      if (fence) {
        const marker = fence[2][0];
        const length = fence[2].length;
        let end = index + 1;
        while (end < lines.length) {
          const closing = raw(end).match(/^\s{0,3}(`{3,}|~{3,})\s*$/);
          if (closing && closing[1][0] === marker && closing[1].length >= length) {
            end += 1;
            break;
          }
          end += 1;
        }
        push("fence", index, end, { info: fence[3].trim() });
        index = end;
        continue;
      }

      if (MATH_FENCE_RE.test(line)) {
        let end = index + 1;
        while (end < lines.length && !MATH_FENCE_RE.test(raw(end))) {
          end += 1;
        }
        push("math", index, Math.min(end + 1, lines.length));
        index = Math.min(end + 1, lines.length);
        continue;
      }

      if (HR_RE.test(line)) {
        push("hr", index, index + 1);
        index += 1;
        continue;
      }

      if (HEADING_RE.test(line)) {
        push("heading", index, index + 1);
        index += 1;
        continue;
      }

      // A table is a row followed by a delimiter row; without the delimiter it
      // is just a paragraph containing pipes.
      if (line.includes("|") && index + 1 < lines.length && TABLE_DELIMITER_RE.test(raw(index + 1))
        && raw(index + 1).includes("-")) {
        let end = index + 2;
        while (end < lines.length && !isBlank(raw(end)) && raw(end).includes("|")) {
          end += 1;
        }
        push("table", index, end);
        index = end;
        continue;
      }

      if (BLOCKQUOTE_RE.test(line)) {
        let end = index;
        while (end < lines.length && !isBlank(raw(end))) {
          end += 1;
        }
        push("blockquote", index, end);
        index = end;
        continue;
      }

      if (LIST_ITEM_RE.test(line)) {
        // A list runs until a blank line that is not followed by more list
        // content, so a list with paragraphs inside it stays one block.
        let end = index + 1;
        while (end < lines.length) {
          if (!isBlank(raw(end))) {
            // An indented line continues the item; a new marker continues the
            // list; anything else at the left margin ends it.
            if (LIST_ITEM_RE.test(raw(end)) || /^\s+\S/.test(raw(end))) {
              end += 1;
              continue;
            }
            break;
          }

          let look = end;
          while (look < lines.length && isBlank(raw(look))) {
            look += 1;
          }

          if (look < lines.length && (LIST_ITEM_RE.test(raw(look)) || /^\s{2,}\S/.test(raw(look)))) {
            end = look + 1;
            continue;
          }

          break;
        }
        push("list", index, end);
        index = end;
        continue;
      }

      if (HTML_BLOCK_RE.test(line)) {
        let end = index;
        while (end < lines.length && !isBlank(raw(end))) {
          end += 1;
        }
        push("html", index, end);
        index = end;
        continue;
      }

      // A paragraph runs to the next blank line, but a heading, fence, hr or
      // list starting mid-paragraph ends it — markdown treats those as
      // interrupting, and so must this or the block would swallow them.
      let end = index + 1;
      while (end < lines.length && !isBlank(raw(end))) {
        const next = raw(end);
        if (HEADING_RE.test(next) || FENCE_RE.test(next) || HR_RE.test(next) || LIST_ITEM_RE.test(next)) {
          break;
        }
        end += 1;
      }
      push("paragraph", index, end);
      index = end;
    }

    return blocks;
  }

  function joinBlocks(blocks) {
    return blocks.map((block) => block.source).join("");
  }

  function isRich(block) {
    return RICH_TYPES.has(block.type);
  }

  /* ---------------------------------------------------------------------
     HTML back to markdown
     ------------------------------------------------------------------- */

  // Only what would change how the text parses. Escaping every underscore
  // would turn snake_case into snake\_case, which is worse than the problem.
  function escapeInline(text) {
    return text
      .replace(/([\\`*[\]])/g, "\\$1")
      .replace(/^(\s*)(#{1,6})(\s)/, "$1\\$2$3")
      .replace(/^(\s*)([-+*])(\s)/, "$1\\$2$3")
      .replace(/^(\s*)(\d{1,9})([.)]\s)/, "$1$2\\$3")
      .replace(/^(\s*)>/, "$1\\>");
  }

  function inlineToMarkdown(node) {
    if (node.nodeType === 3) {
      return escapeInline(node.nodeValue.replace(/\n/g, " "));
    }

    if (node.nodeType !== 1) {
      return "";
    }

    const tag = node.tagName.toLowerCase();
    const inner = childrenToMarkdown(node);

    switch (tag) {
      case "strong":
      case "b":
        return inner.trim() ? `**${inner}**` : inner;
      case "em":
      case "i":
        return inner.trim() ? `*${inner}*` : inner;
      case "del":
      case "s":
      case "strike":
        return inner.trim() ? `~~${inner}~~` : inner;
      case "code": {
        // Text inside code is literal, so it must not carry the escaping the
        // text branch adds.
        const literal = node.textContent;
        // A backtick in the content needs a longer fence around it.
        const longest = (literal.match(/`+/g) || []).reduce((max, run) => Math.max(max, run.length), 0);
        const fence = "`".repeat(longest + 1);
        const pad = literal.startsWith("`") || literal.endsWith("`") ? " " : "";
        return `${fence}${pad}${literal}${pad}${fence}`;
      }
      case "a": {
        const href = node.getAttribute("href") || "";
        const title = node.getAttribute("title");
        const label = inner || href;
        return title ? `[${label}](${href} "${title}")` : `[${label}](${href})`;
      }
      case "img": {
        const src = node.getAttribute("src") || "";
        const alt = node.getAttribute("alt") || "";
        return `![${alt}](${src})`;
      }
      case "br":
        return "  \n";
      case "hr":
        return "\n---\n";
      default:
        return inner;
    }
  }

  function childrenToMarkdown(node) {
    let out = "";
    for (const child of node.childNodes) {
      out += inlineToMarkdown(child);
    }
    return out;
  }

  function listToMarkdown(element, depth = 0) {
    const ordered = element.tagName.toLowerCase() === "ol";
    const indent = "  ".repeat(depth);
    const start = Number(element.getAttribute("start") || 1);
    const lines = [];
    let counter = Number.isFinite(start) ? start : 1;

    for (const item of element.children) {
      if (item.tagName.toLowerCase() !== "li") {
        continue;
      }

      const nested = [];
      const own = document.createElement("div");

      for (const child of item.childNodes) {
        if (child.nodeType === 1 && ["ul", "ol"].includes(child.tagName.toLowerCase())) {
          nested.push(child);
        } else {
          own.appendChild(child.cloneNode(true));
        }
      }

      let marker = ordered ? `${counter}.` : "-";
      counter += 1;

      // A checkbox is the task-list syntax, and the box has to go back as
      // text rather than as an <input>.
      const checkbox = own.querySelector('input[type="checkbox"]');
      if (checkbox) {
        checkbox.remove();
        marker += checkbox.checked ? " [x]" : " [ ]";
      }

      const text = childrenToMarkdown(own).trim();
      lines.push(`${indent}${marker} ${text}`.replace(/\s+$/, ""));

      for (const list of nested) {
        lines.push(listToMarkdown(list, depth + 1));
      }
    }

    return lines.filter((line) => line !== "").join("\n");
  }

  /* One edited block, as markdown.
   *
   * `container` is the element the block was rendered into. Only rich types
   * come through here; a source block's textarea value is its markdown already.
   */
  function elementToMarkdown(container) {
    const parts = [];

    for (const node of container.children) {
      const tag = node.tagName.toLowerCase();

      if (/^h[1-6]$/.test(tag)) {
        parts.push(`${"#".repeat(Number(tag[1]))} ${childrenToMarkdown(node).trim()}`);
        continue;
      }

      if (tag === "ul" || tag === "ol") {
        parts.push(listToMarkdown(node));
        continue;
      }

      if (tag === "blockquote") {
        const inner = elementToMarkdown(node)
          .split("\n")
          .map((line) => (line ? `> ${line}` : ">"))
          .join("\n");
        parts.push(inner);
        continue;
      }

      if (tag === "hr") {
        parts.push("---");
        continue;
      }

      const text = childrenToMarkdown(node).trim();
      if (text) {
        parts.push(text);
      }
    }

    return parts.join("\n\n");
  }

  /* The markdown for a block after editing, with its trailing newline put back
   * so the document keeps its shape. An emptied block returns "" and the caller
   * drops it.
   */
  function serializeEditedBlock(container) {
    const markdown = elementToMarkdown(container).replace(/\s+$/, "");
    return markdown ? `${markdown}\n` : "";
  }

  global.VisualEditor = {
    splitBlocks,
    joinBlocks,
    isRich,
    elementToMarkdown,
    serializeEditedBlock,
    childrenToMarkdown,
    listToMarkdown,
    escapeInline,
    RICH_TYPES
  };
})(typeof window === "undefined" ? globalThis : window);
