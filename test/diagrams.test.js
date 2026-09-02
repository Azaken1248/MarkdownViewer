// Guards the failure that made diagrams invisible: svg-pan-zoom sets the SVG to
// height:100%, so if the block has no height of its own the pair resolves to
// zero. Also checks the diagram palette is actually distinguishable.
const fs = require("fs");
const path = require("path");
const PUBLIC_DIR = path.join(__dirname, "..", "public");


const css = fs.readFileSync(path.join(PUBLIC_DIR, "css", "app.css"), "utf8");
// The render engine moved into markdown-core.js so the share page could use the
// same sanitizer and the same Mermaid security level. Read it from there.
const js = fs.readFileSync(path.join(PUBLIC_DIR, "js", "markdown-core.js"), "utf8");
// The repaint-on-theme-change lives with whichever page owns the DOM it
// repaints, so those checks read the pages rather than the engine.
const appJs = fs.readFileSync(path.join(PUBLIC_DIR, "js", "app.js"), "utf8");
const shareJs = fs.readFileSync(path.join(PUBLIC_DIR, "js", "share.js"), "utf8");
// And the two pages themselves, because which scripts a page loads decides
// which diagrams it can draw.
const indexHtml = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");
const shareHtml = fs.readFileSync(path.join(PUBLIC_DIR, "share.html"), "utf8");

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

function rule(selector) {
  const re = new RegExp(`(^|[},])\\s*${selector.replace(/[.#*:()\-[\]]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "m");
  const m = css.match(re);
  return m ? m[2] : null;
}

console.log("=== the block has a height of its own ===");
const block = rule(".markdown-body .mermaid-block");
check("declares an aspect ratio", /aspect-ratio:/.test(block), true);
check("has a floor so tiny diagrams stay readable", /min-height:\s*(\d+)px/.test(block), true);
check("has a ceiling so tall ones fit the window", /max-height:/.test(block), true);
check("the SVG fills it rather than sizing it", /width:\s*100%[\s\S]*height:\s*100%/.test(rule(".markdown-body .mermaid-block svg")), true);
check("no height:auto on the SVG (collapses under pan-zoom)", /height:\s*auto/.test(rule(".markdown-body .mermaid-block svg")), false);

console.log("=== the ratio comes from the diagram, not a constant ===");
check("a sizing helper exists", js.includes("function sizeDiagramContainer("), true);
check("it reads the viewBox", js.includes("svg.viewBox?.baseVal"), true);
check("it falls back to a measured bbox", js.includes("svg.getBBox()"), true);
check("getBBox is guarded (throws when detached)", /try \{[\s\S]{0,200}getBBox\(\)[\s\S]{0,200}\} catch/.test(js), true);
check("it has a last-resort ratio", js.includes("DIAGRAM_FALLBACK_RATIO"), true);
check("it runs before pan-zoom takes the SVG over",
  js.indexOf("sizeDiagramContainer(svg);") < js.indexOf("window.svgPanZoom(`#${id}`"), true);

console.log("=== a parse failure is not squeezed into the aspect box ===");
check("fallback source releases the ratio", /:has\(\.mermaid-fallback-code\)[\s\S]*?aspect-ratio:\s*auto/.test(css), true);

console.log("=== rendered box for real diagram shapes ===");
// The viewer pane at a typical desktop width, minus the markdown padding.
const paneWidth = 1920 - 280 - 64;
const minH = Number(block.match(/min-height:\s*(\d+)px/)[1]);
const maxH = 0.78 * 1080;
const minW = Number(js.match(/DIAGRAM_MIN_WIDTH = (\d+)/)[1]);
const chrome = Number(js.match(/DIAGRAM_BLOCK_CHROME = (\d+)/)[1]);

const shapes = [
  ["3-node flowchart (wide, short)", 900, 220],
  ["typical flowchart", 800, 600],
  ["ER diagram", 1200, 900],
  ["tall sequence diagram", 700, 2400],
  ["single node (tiny)", 160, 90],
  ["very wide architecture map", 2600, 700]
];

for (const [label, w, h] of shapes) {
  // width:100% capped by the inline max-width, then height from aspect-ratio.
  const boxW = Math.min(paneWidth, Math.max(w, minW) + chrome);
  const natural = boxW * (h / w);
  const boxH = Math.min(Math.max(natural, minH), maxH);
  const scale = boxW / (w + chrome);
  // It must be visible, fit the window, and not be blown up absurdly.
  const ok = boxH > 0 && boxH <= maxH && boxW <= paneWidth && scale <= 3;
  if (!ok) failures++;
  const note = natural > maxH ? "  (clamped, pan/zoom to explore)"
    : scale > 1.05 ? `  (scaled up ${scale.toFixed(1)}x)`
      : scale < 0.95 ? `  (scaled down ${scale.toFixed(2)}x)` : "";
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${Math.round(boxW)} x ${Math.round(boxH)}px${note}`);
}

console.log("=== nothing can resolve to zero height ===");
check("floor is above zero", minH > 0, true);
check("small diagrams get a width cap, not the full pane", js.includes("block.style.maxWidth"), true);
check("a diagram with no usable size still gets a ratio",
  /block\.style\.aspectRatio = DIAGRAM_FALLBACK_RATIO/.test(js), true);
check("...and a fallback width, so it is not pane-wide", /block\.style\.maxWidth = `\$\{DIAGRAM_FALLBACK_WIDTH\}px`/.test(js), true);

// --- Diagram palette ------------------------------------------------------

function hex(v) {
  const n = v.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
}
function lum(rgb) {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [l1, l2] = [lum(hex(a)), lum(hex(b))].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// Two palettes now — one per theme — and both have to hold up.
// Indentation-agnostic on purpose: the engine lives inside an IIFE now, and a
// test that breaks when code is re-indented is testing the wrong thing.
function paletteVars(name) {
  const marker = new RegExp(`\\b${name}:\\s*\\{\\s*themeVariables:\\s*\\{`);
  const match = js.match(marker);
  if (!match) {
    return {};
  }

  const from = match.index + match[0].length;
  const to = js.indexOf("},", from);
  const block = js.slice(from, to);
  const out = {};
  for (const m of block.matchAll(/([a-zA-Z]+):\s*"(#[0-9a-fA-F]{6})"/g)) {
    out[m[1]] = m[2].toLowerCase();
  }
  return out;
}

for (const themeName of ["dark", "light"]) {
  const vars = paletteVars(themeName);
  console.log(`=== ${themeName} diagram palette is actually distinguishable ===`);
  check("the palette was found", Object.keys(vars).length > 20, true);
  check("node fill differs from the block background", vars.mainBkg !== vars.background, true);

  const nodeVsBg = ratio(vars.mainBkg, vars.background);
  console.log(`  node ${vars.mainBkg} on block ${vars.background}: ${nodeVsBg.toFixed(2)}:1`);
  // Two near-black (or two near-white) surfaces can never reach a meaningful
  // WCAG ratio against each other, so fill-vs-background is not the measure of
  // whether a node is visible. What defines the node is its outline, and WCAG
  // 1.4.11 sets 3:1 for exactly that kind of non-text boundary.
  const borderVsBg = ratio(vars.nodeBorder, vars.background);
  console.log(`  border ${vars.nodeBorder} on block ${vars.background}: ${borderVsBg.toFixed(2)}:1`);
  check("node outline meets non-text contrast against the background", borderVsBg >= 3.0, true);
  check("the fill is still a distinct surface", nodeVsBg > 1.0, true);

  const pairs = [
    ["node border against node fill", vars.nodeBorder, vars.mainBkg, 1.8],
    ["node text against node fill", vars.nodeTextColor, vars.mainBkg, 4.5],
    ["edge lines against the background", vars.lineColor, vars.background, 3.0],
    ["text against the background", vars.textColor, vars.background, 4.5],
    ["actor text against actor fill", vars.actorTextColor, vars.actorBkg, 4.5],
    ["note text against note fill", vars.noteTextColor, vars.noteBkgColor, 4.5]
  ];

  for (const [label, fg, bg, min] of pairs) {
    const r = ratio(fg, bg);
    const ok = r >= min;
    if (!ok) failures++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${r.toFixed(2)}:1 (min ${min})`);
  }
}

console.log("=== the palette follows the active theme ===");
check("a light palette exists alongside the dark one", /DIAGRAM_PALETTES = \{[\s\S]*?light: \{/.test(js), true);
check("init reads the active theme", js.includes("const theme = activeThemeName();"), true);
check("darkMode is derived, not hardcoded", js.includes('darkMode: theme === "dark"'), true);
check("the engine keeps the source needed to redraw", js.includes("block.dataset.mermaidSource"), true);
check("...and exposes a way to invalidate the baked-in palette",
  js.includes("resetMermaidForThemeChange"), true);
check("the app redraws its diagrams on a theme change",
  appJs.includes("async function repaintDiagramsForTheme("), true);
check("...after releasing pan/zoom on the old SVGs",
  appJs.indexOf("destroyPanZoomInstances();") < appJs.indexOf("block.dataset.mermaidSource"), true);
// The share page renders the same diagrams and has the same theme toggle, so
// it needs the same repaint or its diagrams keep the old palette.
check("the share page does the same", shareJs.includes("resetMermaidForThemeChange"), true);
check("...and redraws from the stored source", shareJs.includes("block.dataset.mermaidSource"), true);

// A diagram carrying its own layout is drawn by us rather than by Mermaid. A
// page that does not load the drawing still renders that diagram — Mermaid
// ignores the comments — so the failure is silent: the same file, arranged one
// way in the app and another way in the shared copy of it.
for (const [page, markup, script] of [
  ["the app", indexHtml, "app.js"],
  ["the share page", shareHtml, "share.js"]
]) {
  check(`${page} loads the model a laid-out diagram is read with`,
    markup.includes("diagram-model.js"), true);
  check("...and the drawing it is drawn with", markup.includes("diagram-draw.js"), true);
  // Deferred scripts run in the order they are written, and the page's own
  // script is the one that renders anything.
  check("...before the script that renders the document",
    markup.indexOf("diagram-draw.js") < markup.indexOf(`/js/${script}`), true);
}

console.log("=== the blanket overrides that broke edges are gone ===");
const themeCss = js.slice(js.indexOf("function buildDiagramThemeCss("), js.indexOf("function ensureMermaidInitialized("));
check("no blanket fill on <path> (would blob every connector)",
  /^\s*rect,\s*polygon,\s*path,\s*circle\s*\{/m.test(themeCss), false);
check("relationship lines explicitly unfilled", /fill:\s*none/.test(themeCss), true);
check("stray-fill cleanup is scoped to shapes, not paths",
  themeCss.includes('["rect", "polygon", "circle", "ellipse"]'), true);
check("no path selector in the stray-fill shape list", /"path"/.test(themeCss), false);

// --- Rendering the same root twice -----------------------------------------
//
// Everything above reads the source. This part runs it, because the failure it
// guards is a sequencing one and no amount of reading the file shows it.
//
// A rendered diagram is an <svg>, and an <svg> carries its own <style>. So a
// second pass over a root that has already been rendered used to read that
// stylesheet as the diagram's source, fail to parse it, and replace the diagram
// with a wall of CSS ending in the node labels. Two passes over one root is not
// exotic: the flowchart builder redraws its preview on every pause in typing
// while an earlier render of the block around it is still waiting on the 3.5MB
// engine, and both of them call renderMermaidBlocks.
console.log("=== rendering a root twice draws the diagram, not its stylesheet ===");
{
  const { JSDOM } = require("jsdom");

  const page = new JSDOM("<body></body>", { runScripts: "dangerously", pretendToBeVisual: true });
  const win = page.window;

  // Enough of the libraries markdown-core reaches for. The point is to run the
  // real render path, so these are stand-ins rather than mocks of the path
  // itself — and every lazy library is declared present so that nothing here
  // waits on a CDN that this process has no way to reach.
  win.marked = { setOptions() {}, parse: (text) => text };
  win.DOMPurify = { sanitize: (html) => html };
  win.hljs = { highlightElement() {}, highlightAuto: () => ({ value: "", language: null }), getLanguage: () => null };
  win.katex = { render() {} };
  win.renderMathInElement = () => {};
  const panZoomed = [];
  win.svgPanZoom = (selector) => {
    panZoomed.push(selector);

    // svg-pan-zoom nulls its own internals on destroy and throws out of any
    // method called afterwards — "Cannot read properties of undefined (reading
    // 'options')" — which is the whole reason this stand-in has a destroy that
    // does something.
    const gone = () => {
      throw new TypeError("Cannot read properties of undefined (reading 'options')");
    };

    const instance = {
      resize() {},
      fit() {},
      center() {},
      enableMouseWheelZoom() {},
      destroy() {
        instance.resize = gone;
        instance.fit = gone;
        instance.center = gone;
      }
    };

    return instance;
  };

  // What Mermaid actually hands back: an SVG carrying the stylesheet that made
  // this bug, and refusing anything that is not a diagram — which a stylesheet
  // is not.
  const drawn = [];
  win.mermaid = {
    initialize() {},
    render(id, text) {
      drawn.push(text);
      if (!/^\s*(flowchart|graph)\b/.test(text)) {
        throw new Error(`No diagram type detected matching given configuration for text: ${text.slice(0, 40)}`);
      }

      return {
        svg: `<svg id="${id}"><style>.svg-pan-zoom-control { cursor: pointer; }#${id}{font-family:"Inter";}</style><g class="node">Start</g></svg>`
      };
    }
  };

  // The model and the renderer are loaded the way the page loads them: plain
  // scripts, before markdown-core, hanging themselves off the window.
  win.eval(fs.readFileSync(path.join(PUBLIC_DIR, "js", "diagram-model.js"), "utf8"));
  win.eval(fs.readFileSync(path.join(PUBLIC_DIR, "js", "diagram-icons.js"), "utf8"));
  win.eval(fs.readFileSync(path.join(PUBLIC_DIR, "js", "diagram-draw.js"), "utf8"));
  win.eval(fs.readFileSync(path.join(PUBLIC_DIR, "js", "markdown-core.js"), "utf8"));

  const root = win.document.createElement("div");
  win.document.body.appendChild(root);

  // Written through a holder rather than by assigning root.innerHTML: the same
  // assignment after an await is a race in every other file, and a lint rule
  // that says so is worth more than the two characters it costs here.
  const seed = (target, markup) => {
    const holder = win.document.createElement("div");
    holder.innerHTML = markup;
    target.replaceChildren(...holder.childNodes);
  };

  seed(root, '<pre><code class="language-mermaid">flowchart TD\n  A[Start] --> B[End]</code></pre>');

  const sourceOf = () => {
    const block = root.querySelector(".mermaid-block");
    return block ? block.getAttribute("data-mermaid-source") : null;
  };

  (async () => {
    await win.MarkdownCore.renderMermaidBlocks(root);
    check("the first pass draws the diagram", Boolean(root.querySelector(".mermaid-block svg")), true);
    check("...from the source it was given", drawn[0], "flowchart TD\n  A[Start] --> B[End]");
    check("...and keeps that source on the block", sourceOf(), "flowchart TD\n  A[Start] --> B[End]");

    const passes = drawn.length;
    await win.MarkdownCore.renderMermaidBlocks(root);
    check("the second pass leaves the diagram alone",
      Boolean(root.querySelector(".mermaid-block svg")), true);
    check("...rather than parsing the stylesheet the first one drew",
      root.querySelectorAll(".mermaid-fallback-error").length, 0);
    check("...and does not redraw what is already on screen", drawn.length, passes);

    // And the same root rendered by two calls that overlap, which is the shape
    // the builder actually produces.
    seed(root, '<pre><code class="language-mermaid">flowchart LR\n  C[Go]</code></pre>');
    await Promise.all([
      win.MarkdownCore.renderMermaidBlocks(root),
      win.MarkdownCore.renderMermaidBlocks(root)
    ]);
    check("two overlapping renders still leave a diagram",
      Boolean(root.querySelector(".mermaid-block svg")), true);
    check("...and no parse failure between them",
      root.querySelectorAll(".mermaid-fallback-error").length, 0);

    // The flowchart builder's preview is a control: a box in it is tapped to go
    // to that box's row. svg-pan-zoom would take those pointer events and put
    // its own buttons over the top, so a container can opt out — and the opting
    // out has to survive being rendered by a call whose root is somewhere
    // further up, which is exactly the call the builder races with.
    const panel = win.document.createElement("div");
    panel.setAttribute("data-pan-zoom", "off");
    seed(panel, '<pre><code class="language-mermaid">flowchart TD\n  P[Preview]</code></pre>');
    root.replaceChildren(panel);

    panZoomed.length = 0;
    await win.MarkdownCore.renderMermaidBlocks(root);
    check("a diagram the builder drew is left to take its own clicks", panZoomed, []);

    seed(root, '<pre><code class="language-mermaid">flowchart TD\n  Q[Document]</code></pre>');
    panZoomed.length = 0;
    await win.MarkdownCore.renderMermaidBlocks(root);
    check("...while a diagram in the document still gets pan and zoom", panZoomed.length, 1);

    /* Pan and zoom is set up now and refitted on the next frame, because the
     * SVG has to have been laid out before it can be fitted to anything. Which
     * leaves a gap: a second render pass over the same root takes that instance
     * apart and builds another one, and the frame the first one was waiting for
     * still arrives.
     *
     * Two passes over one root is not exotic — an embedded block redraws while
     * the page around it is still rendering — and this was reaching the console
     * as a TypeError out of svg-pan-zoom on every one of them.
     */
    seed(root, '<pre><code class="language-mermaid">flowchart TD\n  R[Refit]</code></pre>');
    await win.MarkdownCore.renderMermaidBlocks(root);

    // Listened to through a holder rather than by putting the console back
    // after an await, which is a race in every other file and a lint rule here.
    const complaints = [];
    const console_ = { on: false };
    const realError = win.console.error;
    win.console.error = (...args) => {
      if (console_.on) {
        complaints.push(String(args[0]));
        return;
      }

      realError(...args);
    };

    console_.on = true;

    // Both passes inside one frame, which is the shape that broke.
    win.MarkdownCore.applyPanZoom(root);
    win.MarkdownCore.applyPanZoom(root);
    await new Promise((done) => win.requestAnimationFrame(
      () => win.requestAnimationFrame(done)));
    console_.on = false;

    check("a refit left over from a replaced instance does not fire", complaints, []);
    check("...and the diagram still has one that works",
      Boolean(root.querySelector(".mermaid-block svg")), true);

    // A block whose source will not parse keeps the source, not the apology it
    // was given — or a retry would try to draw the error message.
    seed(root, '<pre><code class="language-mermaid">not a diagram at all</code></pre>');
    await win.MarkdownCore.renderMermaidBlocks(root);
    check("a diagram that will not parse says so", root.querySelectorAll(".mermaid-fallback-error").length, 1);
    check("...and still remembers what it was asked to draw", sourceOf(), "not a diagram at all");

    const beforeRetry = drawn.length;
    await win.MarkdownCore.renderMermaidBlocks(root);
    check("...so a retry retries the diagram, not the error message",
      drawn.slice(beforeRetry), ["not a diagram at all"]);

    /* A diagram that says where its own boxes go is drawn here rather than by
     * Mermaid, which is the whole point of writing the layout down: the file
     * renders anywhere, and where this app renders it, it looks the way it was
     * left. The engine is never asked — a page whose diagrams are all like this
     * never downloads it.
     */
    const arranged = [
      "flowchart TD",
      "    %% layout v1",
      "    %% @ A 40,40 160x56",
      "    %% @ B 40,220 160x56",
      "    A[Start]",
      "    B[End]",
      "    A --> B"
    ].join("\n");

    seed(root, `<pre><code class="language-mermaid">${arranged}</code></pre>`);
    const beforeDrawn = drawn.length;
    panZoomed.splice(0);
    await win.MarkdownCore.renderMermaidBlocks(root);

    check("a diagram carrying its own layout is drawn here",
      Boolean(root.querySelector(".mermaid-block svg.dd")), true);
    check("...without asking the engine to lay it out again", drawn.length, beforeDrawn);
    check("...with each box where the file says it is",
      [...root.querySelectorAll(".dd-node")].map((g) => g.getAttribute("transform")),
      ["translate(40,40)", "translate(40,220)"]);
    check("...at the size the file says it is",
      root.querySelector('.dd-node[data-id="A"] .dd-shape').getAttribute("width"), "160");
    check("...and an arrow drawn between them",
      Boolean(root.querySelector(".dd-edge .dd-line")), true);
    check("...still marked as the block it came from", sourceOf(), arranged);
    check("...and still something to pan and zoom", panZoomed.length, 1);

    // Rendering the same root twice must leave it alone, for the same reason a
    // Mermaid one must: what is in the node now is a drawing, not a source.
    const standing = root.querySelector(".mermaid-block svg");
    await win.MarkdownCore.renderMermaidBlocks(root);
    check("a second pass leaves the drawing alone",
      root.querySelectorAll(".mermaid-block svg").length, 1);
    check("...the same drawing, rather than an identical new one",
      root.querySelector(".mermaid-block svg") === standing, true);
    check("...and still does not reach for the engine", drawn.length, beforeDrawn);

    // The theme repaint puts the source back as the block's text and renders
    // again. A drawn diagram has to survive that, because it is the same path.
    const block = root.querySelector(".mermaid-block");
    block.textContent = block.getAttribute("data-mermaid-source");
    await win.MarkdownCore.renderMermaidBlocks(root);
    check("a repaint draws it again rather than handing it over",
      Boolean(root.querySelector(".mermaid-block svg.dd")), true);
    check("...still without the engine", drawn.length, beforeDrawn);

    // A group is drawn here now, so a laid-out diagram with a subgraph in it is
    // ours to draw rather than the engine's — and the frame it gets is worked
    // out from the boxes in it rather than read out of the file.
    const grouped = "flowchart TD\n    %% layout v1\n    %% @ A 10,10 160x56\n    %% @ B 10,150 160x56"
      + "\n    subgraph outer [\"Outer\"]\n    A[One]\n    B[Two]\n    end\n    A --> B";
    seed(root, `<pre><code class="language-mermaid">${grouped}</code></pre>`);
    const beforeGroup = drawn.length;
    await win.MarkdownCore.renderMermaidBlocks(root);
    check("a laid-out diagram with a group in it is drawn here",
      Boolean(root.querySelector(".mermaid-block svg.dd .dd-group")), true);
    check("...with the group's name on it",
      root.querySelector(".mermaid-block .dd-group-name")?.textContent, "Outer");
    check("...and without the engine", drawn.slice(beforeGroup), []);

    /* A frame reaches further than the boxes it holds, so the paper has to be
     * measured with it on. These boxes sit ten pixels from the origin, which
     * puts the frame past it — and paper measured by the boxes alone would cut
     * the frame off at exactly its own padding.
     */
    const paper = root.querySelector(".mermaid-block svg.dd")
      .getAttribute("viewBox").split(" ").map(Number);
    const framed = root.querySelector(".mermaid-block .dd-group-box");
    check("...on paper measured with the frame on it, not just the boxes",
      [paper[0] <= Number(framed.getAttribute("x")),
        paper[1] <= Number(framed.getAttribute("y"))], [true, true]);

    // Layout comments on a diagram this cannot read — one whose subgraph is
    // never closed — are still comments, and Mermaid ignores comments. So it
    // goes to Mermaid, which is the only reading that leaves a diagram on the
    // screen rather than an error where one was.
    const beyond = "flowchart TD\n    %% layout v1\n    %% @ A 40,40 160x56\n    subgraph outer\n    A --> B";
    seed(root, `<pre><code class="language-mermaid">${beyond}</code></pre>`);
    const beforeHandover = drawn.length;
    await win.MarkdownCore.renderMermaidBlocks(root);
    check("a laid-out diagram we cannot read is handed to the engine",
      drawn.slice(beforeHandover), [beyond]);

    console.log(failures === 0 ? "\nALL DIAGRAM CHECKS PASSED" : `\n${failures} DIAGRAM CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  })().catch((error) => {
    // Without this a throw in here would end the process quietly with a zero
    // status, which is a suite that passes by not running.
    console.error(error);
    console.log("\nDIAGRAM CHECKS DID NOT FINISH");
    process.exit(1);
  });
}

