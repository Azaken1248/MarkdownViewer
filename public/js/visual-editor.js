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

  /* ---------------------------------------------------------------------
     Tables

     A table is a grid of text and an alignment for each column. Both of those
     survive being edited as a grid, which is why a table can be typed into
     directly rather than through its markdown. What does not survive is the
     spacing of the source — so a table is rewritten only when it has actually
     been edited, and then it is rewritten properly: columns padded to a
     consistent width and the alignment row rebuilt from the alignments the
     original declared.
     ------------------------------------------------------------------- */

  // Split a table row on its unescaped pipes. The outer pipes are optional in
  // GFM, so an empty first or last cell that came from one is dropped.
  function splitTableRow(line) {
    const text = String(line).trim();
    const cells = [];
    let current = "";

    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === "\\" && text[i + 1] === "|") {
        current += "\\|";
        i += 1;
        continue;
      }

      if (text[i] === "|") {
        cells.push(current);
        current = "";
        continue;
      }

      current += text[i];
    }

    cells.push(current);

    if (cells.length > 1 && text.startsWith("|") && cells[0].trim() === "") {
      cells.shift();
    }

    if (cells.length > 1 && text.endsWith("|") && cells[cells.length - 1].trim() === "") {
      cells.pop();
    }

    return cells.map((cell) => cell.trim());
  }

  // What each column's delimiter cell declares: "left", "center", "right", or
  // "" for a table that never said.
  function tableAlignments(source) {
    const delimiter = String(source).split("\n")[1] || "";

    return splitTableRow(delimiter).map((cell) => {
      const left = cell.startsWith(":");
      const right = cell.endsWith(":");
      if (left && right) {
        return "center";
      }
      if (right) {
        return "right";
      }
      if (left) {
        return "left";
      }
      return "";
    });
  }

  function alignmentRule(align, width) {
    const size = Math.max(3, width);

    switch (align) {
      case "left":
        return `:${"-".repeat(size - 1)}`;
      case "right":
        return `${"-".repeat(size - 1)}:`;
      case "center":
        return `:${"-".repeat(size - 2)}:`;
      default:
        return "-".repeat(size);
    }
  }

  function serializeTable(rows, alignments = []) {
    if (rows.length === 0) {
      return "";
    }

    const columns = rows.reduce((most, row) => Math.max(most, row.length), 0);
    const grid = rows.map((row) => {
      const cells = row.slice();
      while (cells.length < columns) {
        cells.push("");
      }
      return cells;
    });

    // Three is the narrowest a delimiter cell can be and still carry a colon at
    // each end, so it is the floor for every column.
    const widths = [];
    for (let i = 0; i < columns; i += 1) {
      widths.push(grid.reduce((most, row) => Math.max(most, row[i].length), 3));
    }

    const line = (cells) => `| ${cells.map((cell, i) => cell.padEnd(widths[i])).join(" | ")} |`;

    const out = [
      line(grid[0]),
      `| ${widths.map((width, i) => alignmentRule(alignments[i] || "", width)).join(" | ")} |`
    ];

    for (const row of grid.slice(1)) {
      out.push(line(row));
    }

    return `${out.join("\n")}\n`;
  }

  function tableCellToMarkdown(cell) {
    return childrenToMarkdown(cell)
      // A cell is one line by definition; a newline inside it would end the row.
      .replace(/\s*\n\s*/g, " ")
      // And a bare pipe would start a new one.
      .replace(/\|/g, "\\|")
      .trim();
  }

  function tableElementToMarkdown(table, alignments = []) {
    const rows = [];

    for (const row of table.querySelectorAll("tr")) {
      const cells = [...row.children]
        .filter((cell) => ["th", "td"].includes(cell.tagName.toLowerCase()))
        .map((cell) => tableCellToMarkdown(cell));

      if (cells.length > 0) {
        rows.push(cells);
      }
    }

    return serializeTable(rows, alignments);
  }

  /* ---------------------------------------------------------------------
     Fences

     The text inside a fence is literal, so it can be typed into as itself.
     What has to be preserved around it is the fence's own shape: the marker it
     was written with, its length, its indentation and its info string. A block
     fenced with four tildes stays fenced with four tildes.
     ------------------------------------------------------------------- */

  function parseFence(source) {
    const text = String(source);
    // A fence at the very end of a file with no final newline has to stay that
    // way; adding one would be an edit to a block nobody touched.
    const trailing = text.endsWith("\n");
    const lines = text.replace(/\n$/, "").split("\n");
    const opened = (lines[0] || "").match(FENCE_RE);

    if (!opened) {
      return { indent: "", marker: "```", info: "", body: lines.join("\n"), closed: true, trailing };
    }

    const indent = opened[1];
    const marker = opened[2];
    const info = opened[3].trim();

    const last = lines.length - 1;
    const closing = last > 0
      && new RegExp(`^\\s{0,3}\\${marker[0]}{${marker.length},}\\s*$`).test(lines[last]);

    // The fence's own indentation is not part of the code — a renderer strips
    // it before showing the block, so the body here is what is on screen.
    const strip = new RegExp(`^ {0,${indent.length}}`);
    const bodyLines = lines
      .slice(1, closing ? last : last + 1)
      .map((line) => (indent ? line.replace(strip, "") : line));

    return {
      indent,
      marker,
      info,
      body: bodyLines.join("\n"),
      // One empty line and no lines at all are both the empty string. Keeping
      // the lines themselves is what tells them apart, so a fence whose entire
      // content is a blank line comes back with it.
      bodyLines,
      // An unclosed fence stays unclosed: closing it would change where the
      // block ends, which is a decision about the rest of the document.
      closed: closing,
      // The closing line as it was actually written, trailing spaces and all.
      close: closing ? lines[last] : "",
      // The opening line likewise, so a fence written "``` js" is not tidied
      // into "```js" by the act of editing the code under it. `declared` is
      // what that line said, so a changed language can be told from an
      // unchanged one.
      open: lines[0],
      declared: info,
      trailing
    };
  }

  /* Blank lines at the end of a code block are code — an empty last line in a
   * shell script is still a line — so the body goes back exactly as given and
   * only the fence itself is rebuilt around it.
   */
  function serializeFence({
    indent = "",
    marker = "```",
    info = "",
    body = "",
    bodyLines = null,
    closed = true,
    close = "",
    open = "",
    declared = null,
    trailing = true
  }) {
    const text = String(body);
    // The parsed lines are used only while they still say the same thing as the
    // body — which is how an edit that emptied the block is told from a block
    // that was one blank line to begin with.
    const kept = Array.isArray(bodyLines) && bodyLines.join("\n") === text ? bodyLines : null;
    const source = kept || (text === "" ? [] : text.split("\n"));
    const lines = source.map((line) => (line ? `${indent}${line}` : line));

    // The opening line is rebuilt only when the language actually changed;
    // otherwise it goes back exactly as it was written.
    const opening = open && info === declared ? open : `${indent}${marker}${info}`;
    const out = [opening, ...lines];

    if (closed) {
      out.push(close || `${indent}${marker}`);
    }

    return `${out.join("\n")}${trailing ? "\n" : ""}`;
  }

  // --- Task lists ---------------------------------------------------------
  //
  // A checkbox on the page is one character in the file. Finding which one is
  // the whole problem: "- [ ]" inside a code fence is text, not a checkbox, so
  // counting markers through the raw source would drift out of step with the
  // rendering on the first fence that mentions one. Walking the blocks instead
  // means the count can only include blocks a renderer turns into list items.
  //
  // GFM wants a whitespace character after the bracket, so "- [x]done" is an
  // ordinary list item and is deliberately not matched here.
  const TASK_MARKER_RE = /^([ \t]*(?:>[ \t]*)*)([-*+]|\d{1,9}[.)])([ \t]+)\[([ xX])\](?=[ \t])/;
  const TASK_BLOCK_SKIP = new Set(["fence", "math", "frontmatter", "html"]);

  // Every task-list marker in the document, in the order a renderer meets them,
  // each with the offset of the one character that says whether it is ticked.
  function taskMarkers(source) {
    const text = String(source == null ? "" : source);
    const found = [];
    let blockStart = 0;

    for (const block of splitBlocks(text)) {
      if (!TASK_BLOCK_SKIP.has(block.type)) {
        let lineStart = blockStart;

        for (const line of block.source.split("\n")) {
          const match = TASK_MARKER_RE.exec(line);
          if (match) {
            found.push({
              // Past the indent, the bullet, the gap and the opening bracket.
              index: lineStart + match[1].length + match[2].length + match[3].length + 1,
              checked: match[4] !== " "
            });
          }

          lineStart += line.length + 1;
        }
      }

      blockStart += block.source.length;
    }

    return found;
  }

  // Ticking a box is a one-character edit. Everything else in the file — every
  // marker style, every trailing space, the newline at the end or its absence —
  // is untouched by construction rather than by care.
  function setTaskMarker(source, index, checked) {
    const text = String(source == null ? "" : source);

    if (!Number.isInteger(index) || index < 0 || index >= text.length) {
      return text;
    }

    return `${text.slice(0, index)}${checked ? "x" : " "}${text.slice(index + 1)}`;
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
    splitTableRow,
    tableAlignments,
    serializeTable,
    tableElementToMarkdown,
    parseFence,
    serializeFence,
    taskMarkers,
    setTaskMarker,
    RICH_TYPES
  };
})(typeof window === "undefined" ? globalThis : window);
