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

        push(line);
      },
      // A block nobody closed is not maths, it is the rest of the document.
      end: () => held
    };
  }

  function normalizeMarkdownMath(markdown) {
    const source = String(markdown || "");
    if (!source.includes("[") && !source.includes("]") && !source.includes("\\[") && !source.includes("$$")) {
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
    normalize, encodeBase64Utf8, decodeBase64Utf8, normalizeMatrixEnvironments, escapeHtml, isNotebookFile, isDiagramFile, toMermaidMarkdown, activeThemeName, normalizeMarkdownMath, renderMarkdown
  };
})();
