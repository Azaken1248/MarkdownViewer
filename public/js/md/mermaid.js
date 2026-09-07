/* One Mermaid block, rendered — including when it will not parse.
 *
 * An ER diagram written the way most people write one is the common failure,
 * so there is a simplifier that strips what the engine cannot read and tries
 * again, rather than showing a stack trace where a picture should be.
 */
(function (global) {
  "use strict";

  const { mermaidState } = global.MdLazy;
  const { escapeHtml } = global.MdText;

  function normalizeMermaidSource(source) {
    return String(source || "")
      .replace(/\uFEFF/g, "")
      .replace(/[\u200B-\u200D]/g, "")
      .replace(/\u00A0/g, " ")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\r\n/g, "\n")
      .trim();
  }

  function simplifyErDiagramSource(source) {
    const raw = normalizeMermaidSource(source);
    if (!/^erDiagram\b/.test(raw)) {
      return raw;
    }

    const lines = raw.split("\n");
    let inEntity = false;
    const output = [];

    for (const originalLine of lines) {
      const line = originalLine.replace(/\t/g, "  ");
      const trimmed = line.trim();

      if (!trimmed) {
        output.push("");
        continue;
      }

      if (trimmed === "erDiagram") {
        output.push("erDiagram");
        continue;
      }

      if (trimmed.endsWith("{")) {
        inEntity = true;
        output.push(`  ${trimmed}`);
        continue;
      }

      if (trimmed === "}") {
        inEntity = false;
        output.push("  }");
        continue;
      }

      if (inEntity) {
        const match = trimmed.match(/^([A-Za-z][A-Za-z0-9_]*)\s+([A-Za-z][A-Za-z0-9_]*)(?:\s+(PK|FK|UK))?/i);
        if (!match) {
          continue;
        }

        let type = match[1].toLowerCase();
        const name = match[2];
        const key = match[3] ? match[3].toUpperCase() : "";

        if (type === "timestamp") {
          type = "datetime";
        }
        if (type === "text") {
          type = "string";
        }
        if (type === "enum") {
          type = "string";
        }

        output.push(`    ${type} ${name}${key ? ` ${key}` : ""}`);
        continue;
      }

      const relMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9_]*)\s+(\|\|--\|\{|\|\|--o\{|o\|--\|\{|o\|--o\{|\|o--\|\{|\|o--o\{|\}\|--\|\{|\}\|--o\{|\|\|--\|\||\|\|--o\||o\|--\|\||o\|--o\|)\s+([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.+)$/);
      if (relMatch) {
        const left = relMatch[1];
        const connector = relMatch[2];
        const right = relMatch[3];
        const rawLabel = relMatch[4]
          .replace(/^"|"$/g, "")
          .replace(/[^A-Za-z0-9_ ]/g, " ")
          .replace(/\s+/g, "_")
          .replace(/^_+|_+$/g, "")
          .toLowerCase();
        const label = rawLabel || "relates_to";
        output.push(`  ${left} ${connector} ${right} : ${label}`);
        continue;
      }

      output.push(`  ${trimmed}`);
    }

    return output.join("\n");
  }

  /* The source a block was drawn from.
   *
   * Reading the node back is only right the first time. After a successful
   * render the node holds an <svg>, and an <svg> carries its own <style>; after
   * a failed one it holds the fallback, which is the source with a parser error
   * appended. Either read as "the diagram source" produces nonsense, so the
   * source is recorded the first time the node is seen and read from there
   * afterwards. promoteMermaidCodeBlocks already records it for a fenced block;
   * this covers a `.mermaid` div written by hand, and the theme repaint that
   * puts the source back as the node's text.
   */
  function mermaidSourceOf(node) {
    if (typeof node.dataset.mermaidSource === "string") {
      return node.dataset.mermaidSource;
    }

    const source = node.textContent || "";
    node.dataset.mermaidSource = source;
    return source;
  }

  async function renderSingleMermaidNode(node) {
    // Already on screen. Two passes over one root is not exotic — the flowchart
    // builder redraws its preview as it is typed into while an earlier render
    // of the block around it is still waiting on the 3.5MB engine — and without
    // this the second pass would redraw a diagram that is already correct, or,
    // before the source was recorded, feed the parser the first one's stylesheet
    // and leave a wall of CSS where the diagram was.
    //
    // Everything that wants a diagram redrawn takes its SVG away first: see the
    // theme repaint, which puts the source back as the node's own text.
    if (node.querySelector("svg")) {
      return true;
    }

    const raw = normalizeMermaidSource(mermaidSourceOf(node));
    const attempts = [raw];
    const simplified = simplifyErDiagramSource(raw);
    if (simplified && simplified !== raw) {
      attempts.push(simplified);
    }

    let lastError = null;

    for (const candidate of attempts) {
      try {
        mermaidState.panZoomCounter += 1;
        const renderId = `mermaid-svg-${mermaidState.panZoomCounter}`;
        const { svg, bindFunctions } = await window.mermaid.render(renderId, candidate);
        node.innerHTML = svg;
        if (typeof bindFunctions === "function") {
          bindFunctions(node);
        }
        return true;
      } catch (error) {
        lastError = error;
      }
    }

    const errText = String(lastError?.str || lastError?.message || "Unknown parser error");
    node.innerHTML = `
      <pre class="mermaid-fallback-code">${escapeHtml(raw)}</pre>
      <p class="mermaid-fallback-error">Mermaid parse failed: ${escapeHtml(errText)}</p>
    `;
    return false;
  }

  // svg-pan-zoom binds window resize and wheel handlers per instance. They were
  // never released, so every re-render and every document switch leaked another
  // set that kept firing against detached SVGs for the life of the page.

  global.MdMermaid = {
    normalizeMermaidSource, simplifyErDiagramSource, mermaidSourceOf, renderSingleMermaidNode
  };
})(typeof window === "undefined" ? globalThis : window);
