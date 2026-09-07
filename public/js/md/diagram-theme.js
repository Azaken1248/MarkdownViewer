/* What a diagram looks like, and which blocks are diagrams at all.
 *
 * Mermaid bakes its palette into the SVG it produces, so the palette has to be
 * settled before the first render and re-settled whenever the theme changes.
 * Below that: promoting a ```mermaid fence into a diagram container, and
 * drawing the ones that carry their own layout without the engine at all.
 */
(function (global) {
  "use strict";

  const { mermaidState } = global.MdLazy;
  const { activeThemeName } = global.MdText;

  const DIAGRAM_PALETTES = {
    dark: {
      themeVariables: {
        background: "#0c1214",
        mainBkg: "#1c262a",
        primaryColor: "#1c262a",
        primaryTextColor: "#dce7e5",
        primaryBorderColor: "#3f8d84",
        secondaryColor: "#253238",
        secondaryTextColor: "#dce7e5",
        secondaryBorderColor: "#2e3d42",
        tertiaryColor: "#0a1013",
        tertiaryTextColor: "#dce7e5",
        tertiaryBorderColor: "#2e3d42",
        lineColor: "#86a09d",
        textColor: "#dce7e5",
        nodeBorder: "#3f8d84",
        nodeTextColor: "#dce7e5",
        clusterBkg: "#0a1013",
        clusterBorder: "#2e3d42",
        edgeLabelBackground: "#0c1214",
        labelBoxBkgColor: "#1c262a",
        labelBoxBorderColor: "#2e3d42",
        labelTextColor: "#dce7e5",
        titleColor: "#dce7e5",
        actorBkg: "#1c262a",
        actorBorder: "#3f8d84",
        actorTextColor: "#dce7e5",
        actorLineColor: "#86a09d",
        signalColor: "#86a09d",
        signalTextColor: "#dce7e5",
        loopTextColor: "#dce7e5",
        noteBkgColor: "#253238",
        noteTextColor: "#dce7e5",
        noteBorderColor: "#2e3d42",
        attributeBackgroundColorOdd: "#0c1214",
        attributeBackgroundColorEven: "#1c262a",
        altBackground: "#0a1013"
      },
      // Fills the base theme emits that have to be corrected on this background.
      strayFills: ["#ffffff", "white", "#ECECFF"]
    },
    light: {
      themeVariables: {
        background: "#ffffff",
        mainBkg: "#eef4f2",
        primaryColor: "#eef4f2",
        primaryTextColor: "#101b1a",
        primaryBorderColor: "#10635a",
        secondaryColor: "#dcece9",
        secondaryTextColor: "#101b1a",
        secondaryBorderColor: "#a6b9b5",
        tertiaryColor: "#f4f8f7",
        tertiaryTextColor: "#101b1a",
        tertiaryBorderColor: "#a6b9b5",
        lineColor: "#465956",
        textColor: "#101b1a",
        nodeBorder: "#10635a",
        nodeTextColor: "#101b1a",
        clusterBkg: "#f4f8f7",
        clusterBorder: "#a6b9b5",
        edgeLabelBackground: "#ffffff",
        labelBoxBkgColor: "#eef4f2",
        labelBoxBorderColor: "#a6b9b5",
        labelTextColor: "#101b1a",
        titleColor: "#101b1a",
        actorBkg: "#eef4f2",
        actorBorder: "#10635a",
        actorTextColor: "#101b1a",
        actorLineColor: "#465956",
        signalColor: "#465956",
        signalTextColor: "#101b1a",
        loopTextColor: "#101b1a",
        noteBkgColor: "#dcece9",
        noteTextColor: "#101b1a",
        noteBorderColor: "#a6b9b5",
        attributeBackgroundColorOdd: "#ffffff",
        attributeBackgroundColorEven: "#eef4f2",
        altBackground: "#f4f8f7"
      },
      // On white, the base theme's own light fills are fine; the lavender is not.
      strayFills: ["#ECECFF"]
    }
  };

  function buildDiagramThemeCss(palette) {
    const vars = palette.themeVariables;
    const strayShapes = palette.strayFills
      .flatMap((fill) => ["rect", "polygon", "circle", "ellipse"].map((shape) => `${shape}[fill="${fill}"]`))
      .join(", ");

    return `
        /* Only the gaps the base theme leaves. Crucially not a blanket rule on
           <path>: that fills edge lines and turns every connector into a solid
           blob. */
        text,
        tspan {
          fill: ${vars.textColor};
        }

        .nodeLabel,
        .edgeLabel,
        .label,
        foreignObject div,
        foreignObject span {
          color: ${vars.textColor} !important;
        }

        /* Edge labels ship with their own plate behind them. */
        .edgeLabel rect,
        .labelBkg,
        rect.background {
          fill: ${vars.edgeLabelBackground} !important;
          opacity: 1 !important;
        }

        .er.entityBox,
        .entityBox {
          fill: ${vars.mainBkg};
          stroke: ${vars.nodeBorder};
        }

        .relationshipLine,
        .messageLine0,
        .messageLine1 {
          stroke: ${vars.lineColor};
          fill: none;
        }

        /* Stray fills the base theme still emits, without touching edges. */
        ${strayShapes} {
          fill: ${vars.mainBkg} !important;
        }
      `;
  }

  function ensureMermaidInitialized() {
    if (!window.mermaid) {
      return;
    }

    // Re-initialize when the theme has moved on, not only when nothing has been
    // initialized yet — otherwise a stale palette survives a theme change.
    const theme = activeThemeName();
    if (mermaidState.ready && mermaidState.theme === theme) {
      return;
    }

    const palette = DIAGRAM_PALETTES[theme] || DIAGRAM_PALETTES.dark;

    window.mermaid.initialize({
      startOnLoad: false,
      // "antiscript" runs DOMPurify over diagram labels and blocks javascript:
      // click directives, while still allowing the <br/> tags our docs rely on.
      // Do not set this back to "loose": Mermaid renders after DOMPurify has run
      // on the markdown, so "loose" lets an uploaded document execute script.
      securityLevel: "antiscript",
      theme: "base",
      darkMode: theme === "dark",
      fontFamily: '"Inter", sans-serif',
      // Colours belong in themeVariables, not in blanket !important overrides.
      // An earlier set filled every node with the surface colour — the same
      // colour as the block behind it — and stroked them in --border-muted, which
      // is barely a shade off it. Nodes have to sit a step above the background
      // with a border that can actually be seen.
      themeVariables: palette.themeVariables,
      er: {
        useMaxWidth: true
      },
      themeCSS: buildDiagramThemeCss(palette)
    });

    mermaidState.theme = theme;
    mermaidState.ready = true;
  }

  function promoteMermaidCodeBlock(codeNode) {
    const source = codeNode.textContent || "";
    const block = document.createElement("div");
    block.className = "mermaid mermaid-block";
    block.textContent = source;
    // Kept so the diagram can be redrawn from source when the theme changes;
    // Mermaid bakes its colours into the SVG at render time, so a repaint is
    // the only way to recolour one.
    block.dataset.mermaidSource = source;
    const pre = codeNode.closest("pre");
    if (pre) {
      pre.replaceWith(block);
    }

    return block;
  }

  function promoteMermaidCodeBlocks(root) {
    const codeNodes = root.querySelectorAll("pre > code.language-mermaid, pre > code.lang-mermaid");
    codeNodes.forEach(promoteMermaidCodeBlock);
  }

  /* Diagrams that say where their own boxes go.
   *
   * A flowchart carrying layout comments has already been arranged, by hand, in
   * the editor. Handing it to Mermaid would arrange it again — the comments
   * mean nothing to it — so those are drawn here instead, from the same
   * arithmetic the editor drew them with, and land in the document laid out the
   * way they were left.
   *
   * Which also means a page whose diagrams are all like this never asks the CDN
   * for the 3.5MB engine at all. That is why this runs before the question of
   * loading it comes up.
   */
  function drawLaidOutDiagrams(root) {
    if (!root || !global.DiagramDraw || !global.DiagramModel) {
      return 0;
    }

    const candidates = [
      ...root.querySelectorAll("pre > code.language-mermaid, pre > code.lang-mermaid"),
      ...root.querySelectorAll(".mermaid")
    ];

    let drawn = 0;

    for (const node of candidates) {
      // Already on screen, the same way and for the same reason as a rendered
      // Mermaid block: what is in the node now is a drawing, not a source.
      if (node.querySelector("svg")) {
        continue;
      }

      const source = typeof node.dataset.mermaidSource === "string"
        ? node.dataset.mermaidSource
        : (node.textContent || "");

      if (!global.DiagramModel.hasLayout(source)) {
        continue;
      }

      const svg = global.DiagramDraw.renderSource(source);
      if (!svg) {
        // Layout comments on something this cannot draw. Mermaid ignores them,
        // so leaving it alone leaves a diagram rather than an error.
        continue;
      }

      const block = node.classList.contains("mermaid")
        ? node
        : promoteMermaidCodeBlock(node);

      block.dataset.mermaidSource = source;
      block.dataset.diagramDrawn = "1";
      block.innerHTML = svg;
      drawn += 1;
    }

    return drawn;
  }

  // Resolves when the code on screen is coloured. As with maths, an already
  // loaded highlighter runs synchronously: the editor preview repaints on every
  // keystroke and must not lose its colours to a microtask each time.

  global.MdDiagramTheme = {
    DIAGRAM_PALETTES, buildDiagramThemeCss, ensureMermaidInitialized, promoteMermaidCodeBlock, promoteMermaidCodeBlocks, drawLaidOutDiagrams
  };
})(typeof window === "undefined" ? globalThis : window);
