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

console.log("=== the blanket overrides that broke edges are gone ===");
const themeCss = js.slice(js.indexOf("function buildDiagramThemeCss("), js.indexOf("function ensureMermaidInitialized("));
check("no blanket fill on <path> (would blob every connector)",
  /^\s*rect,\s*polygon,\s*path,\s*circle\s*\{/m.test(themeCss), false);
check("relationship lines explicitly unfilled", /fill:\s*none/.test(themeCss), true);
check("stray-fill cleanup is scoped to shapes, not paths",
  themeCss.includes('["rect", "polygon", "circle", "ellipse"]'), true);
check("no path selector in the stray-fill shape list", /"path"/.test(themeCss), false);

console.log(failures === 0 ? "\nALL DIAGRAM CHECKS PASSED" : `\n${failures} DIAGRAM CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
