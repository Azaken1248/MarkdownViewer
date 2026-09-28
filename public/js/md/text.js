/* Markdown in, sanitized HTML out — and the small text jobs around it.
 *
 * The math pass runs before marked does, because `$...$` and `\[...\]` are not
 * markdown and marked would mangle them; what comes back is placeholder spans
 * carrying the TeX, for AppMdMath to fill in once KaTeX has arrived.
 */
/* exported MdText */
var MdText = (function () {
  "use strict";

  const { MARKDOWN_SANITIZE_OPTIONS } = MdLazy;

  function normalize(text) {
    return String(text || "").toLowerCase();
  }

  function encodeBase64Utf8(value) {
    const bytes = new TextEncoder().encode(String(value || ""));
    let binary = "";

    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }

    return window.btoa(binary);
  }

  function normalizeMatrixEnvironments(tex) {
    const source = String(tex || "");
    const matrixEnvironmentPattern = /\\begin\{(matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|smallmatrix)\}([\s\S]*?)\\end\{\1\}/g;

    return source.replace(matrixEnvironmentPattern, (match, environmentName, body) => {
      if (body.includes("\\\\")) {
        return match;
      }

      const rows = body
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => line.replace(/\\+\s*$/, "").trim())
        .filter((line) => line.length > 0);

      if (rows.length <= 1) {
        return match;
      }

      return `\\begin{${environmentName}}\n${rows.join(" \\\\ \n")}\n\\end{${environmentName}}`;
    });
  }

  // One escape in the app, in js/dom-html.js, because an escape that exists
  // twice is an escape that can be fixed once.
  const { escapeHtml } = DomHtml;

  // What a name means is decided once, in doc-kinds.js, for the server and
  // the client alike. These are the engine's names for the same answers.
  const { isNotebookFile, isDiagramFile } = DocKinds;

  function toMermaidMarkdown(diagramSource) {
    return `\n\
  \`\`\`mermaid
  ${String(diagramSource || "")}
  \`\`\`
  `;
  }

  function decodeBase64Utf8(value) {
    const binary = window.atob(String(value || ""));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  /* Which theme is showing, read off <html>.
   *
   * `data-theme` is the contract between theme-boot.js, which writes it before
   * the page paints and is the only thing that changes it, and the stylesheet,
   * which is all custom properties hanging off it. Reading the attribute is
   * how the engine joins that without knowing ThemeSwitch exists — it renders
   * the same documents on the share page, and a renderer that needs one of the
   * app's globals is a renderer that only works on one page.
   */
  function activeThemeName() {
    return document.documentElement.dataset.theme === "light" ? "light" : "dark";
  }

  /* Display maths, turned into a marker element the renderer leaves alone.
   *
   * Three spellings open a block — `[`, `\[` and `$$` — and each closes with
   * its own, so a walk over the lines is a small state machine: inside a code
   * fence nothing is maths, inside a block every line is, and everywhere else
   * a line is itself.
   */
  const MATH_OPENERS = ["[", "\\[", "$$"];

  const closesMath = (mode, trimmed) => (mode === "$$"
    ? trimmed === "$$"
    : trimmed === "]" || trimmed === "\\]");

/* Inline maths, taken out of the line before markdown can read it.
 *
 * `$...$` used to be left in the text for KaTeX's own scanner to find after
 * markdown had run, which meant markdown saw the TeX first and applied its own
 * escaping rules to it. `\\` is an escaped backslash in markdown and becomes
 * one; `\{` is an escaped brace and becomes a bare one. So
 *
 *     $\left\{ \begin{bmatrix} 0 & 0 \\ y & 0 \end{bmatrix} \right\}$
 *
 * reached KaTeX as `\left{ ... 0 & 0 \ y & 0 ...` — a missing delimiter and a
 * row separator turned into a space — and rendered as an error. Display maths
 * never had this problem, because the walk above lifts it out first. This does
 * the same for the inline kind, which is the whole fix: markdown never sees
 * TeX at all.
 *
 * The placeholder keeps the source as its text as well as in the attribute,
 * because the page editor renders blocks without the KaTeX pass and a person
 * editing a paragraph has to see the formula they are editing.
 */

// A dollar that is a delimiter, rather than a price or an escape. The rules
// are the ones markdown-it-katex settled on after this exact argument: an
// opener is not followed by a space, a closer is not preceded by one, and a
// closer is not followed by a digit — which is what keeps "$5 and $10" prose.
const opensInlineMath = (line, at) => at + 1 < line.length && !/\s/.test(line[at + 1]);

const closesInlineMath = (line, at, from) => at > from
  && !/\s/.test(line[at - 1])
  && !/[0-9]/.test(line[at + 1] || "");

/* Where an inline code span runs to, or -1.
 *
 * Backticks win over dollars: `$x$` inside code is code, and the run has to be
 * closed by a run of the same length, which is markdown's own rule.
 */
function codeSpanEnd(line, at) {
  let ticks = 0;
  while (line[at + ticks] === "`") {
    ticks += 1;
  }

  const closer = line.indexOf("`".repeat(ticks), at + ticks);
  return closer === -1 ? -1 : closer + ticks;
}

function extractInlineMath(line, mark) {
  if (!line.includes("$")) {
    return line;
  }

  let out = "";
  let index = 0;

  while (index < line.length) {
    const char = line[index];

    // An escaped dollar is a dollar, and the backslash stays for markdown to
    // deal with as it always has.
    if (char === "\\" && line[index + 1] === "$") {
      out += line.slice(index, index + 2);
      index += 2;
      continue;
    }

    if (char === "`") {
      const end = codeSpanEnd(line, index);
      if (end !== -1) {
        out += line.slice(index, end);
        index = end;
        continue;
      }
    }

    if (char !== "$" || !opensInlineMath(line, index)) {
      out += char;
      index += 1;
      continue;
    }

    // Find the closer, skipping escaped dollars inside the maths.
    let end = -1;
    for (let at = index + 1; at < line.length; at += 1) {
      if (line[at] === "\\") {
        at += 1;
        continue;
      }

      if (line[at] === "$" && closesInlineMath(line, at, index)) {
        end = at;
        break;
      }
    }

    if (end === -1) {
      out += char;
      index += 1;
      continue;
    }

    out += mark(line.slice(index + 1, end), line.slice(index, end + 1));
    index = end + 1;
  }

  return out;
}

  // Where the walk is: inside a fence, inside a maths block, or in the prose.
  function mathWalker(push) {
    let inCodeFence = false;
    let codeFenceMarker = "";
    let mode = "";
    let held = [];

    const flush = () => {
      const tex = normalizeMatrixEnvironments(held.join("\n").trim());
      if (tex) {
        push(`<div class="math-block" data-math-tex="${encodeBase64Utf8(tex)}"></div>`);
      }

      held = [];
      mode = "";
    };

    const fence = (line) => {
      const found = line.match(/^(\s*)(`{3,}|~{3,})/);
      if (!found) {
        return false;
      }

      const marker = found[2][0];
      if (!inCodeFence) {
        inCodeFence = true;
        codeFenceMarker = marker;
      } else if (marker === codeFenceMarker) {
        inCodeFence = false;
        codeFenceMarker = "";
      }

      push(line);
      return true;
    };

    const maths = (line) => {
      const trimmed = line.trim();

      if (!mode) {
        if (!MATH_OPENERS.includes(trimmed)) {
          return false;
        }

        mode = trimmed;
        held = [];
        return true;
      }

      if (closesMath(mode, trimmed)) {
        flush();
        return true;
      }

      held.push(line);
      return true;
    };

    return {
      line(line) {
        if (fence(line) || (!inCodeFence && maths(line))) {
          return;
        }

        // Inside a fence the text is the text. Everywhere else, the inline
        // maths comes out before markdown is allowed to read the line.
        push(inCodeFence ? line : extractInlineMath(line, inlineMathMarker));
      },
      // A block nobody closed is not maths, it is the rest of the document.
      end: () => held
    };
  }

  /* One inline formula, as the element that stands in for it.
   *
   * The TeX is carried base64 in the attribute so that no amount of markdown,
   * sanitising or HTML escaping can alter it, and repeated as the element's
   * text so the page editor — which renders without KaTeX — still shows the
   * formula somebody is editing. `$` and all.
   */
  const inlineMathMarker = (tex, source) =>
    `<span class="math-inline" data-math-tex="${encodeBase64Utf8(tex)}">${escapeHtml(source)}</span>`;

  function normalizeMarkdownMath(markdown) {
    const source = String(markdown || "");
    if (!source.includes("$") && !source.includes("[") && !source.includes("]")
      && !source.includes("\\[")) {
      return source;
    }

    const normalizedLines = [];
    const walker = mathWalker((line) => normalizedLines.push(line));

    for (const line of source.split(/\r?\n/)) {
      walker.line(line);
    }

    normalizedLines.push(...walker.end());
    return normalizedLines.join("\n");
  }

  function renderMarkdown(markdown) {
    const normalizedMarkdown = normalizeMarkdownMath(markdown);
    const unsafeHtml = marked.parse(normalizedMarkdown);
    return DOMPurify.sanitize(unsafeHtml, MARKDOWN_SANITIZE_OPTIONS);
  }

  // Display maths is a marker element; inline maths is whatever KaTeX's own
  // scanner would pick up, so this looks for the same delimiters it does. A
  // false positive costs one download nobody reads; a false negative leaves an
  // equation as raw TeX, so the pattern errs towards fetching.

  return {
    normalize, encodeBase64Utf8, decodeBase64Utf8, normalizeMatrixEnvironments, escapeHtml, isNotebookFile, isDiagramFile, toMermaidMarkdown, activeThemeName, normalizeMarkdownMath, renderMarkdown, extractInlineMath
  };
})();
