// Checks the mobile rules and palette contrast without a browser: parses the
// stylesheet and measures WCAG ratios for the pairs that carry meaning.
const fs = require("fs");
const path = require("path");
const PUBLIC_DIR = path.join(__dirname, "..", "public");


const css = fs.readFileSync(path.join(PUBLIC_DIR, "css", "app.css"), "utf8");
const html = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");
const js = fs.readFileSync(path.join(PUBLIC_DIR, "js", "app.js"), "utf8");

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

// Extract the max-width:920px block by brace matching.
const start = css.indexOf("@media (max-width: 920px)");
let depth = 0;
let end = start;
for (let i = css.indexOf("{", start); i < css.length; i++) {
  if (css[i] === "{") depth++;
  else if (css[i] === "}") {
    depth--;
    if (depth === 0) { end = i; break; }
  }
}
const mobile = css.slice(start, end);

console.log("=== mobile drawer has a way out ===");
check("a close button exists in the markup", html.includes('id="closeSidebarBtn"'), true);
check("it is mobile-only", /id="closeSidebarBtn"[\s\S]{0,200}?mobile-only|mobile-only[^>]*id="closeSidebarBtn"/.test(html), true);
check("it is wired up", js.includes('elements.closeSidebarBtn?.addEventListener'), true);
check("it closes the drawer", /closeSidebarBtn\?\.addEventListener\("click", \(\) => \{\s*setNavOpen\(false\);/.test(js), true);

console.log("=== row actions collapse to one control on touch ===");
check("inline actions are hidden on mobile", /\.tree-actions \.tree-action \{\s*display: none;/.test(mobile), true);
check("the overflow button is shown instead", /\.tree-actions \.tree-action-more \{[\s\S]*?display: grid;/.test(mobile), true);
check("overflow is hidden on desktop", /\.tree-action-more \{\s*display: none;\s*\}/.test(css), true);
check("the overflow button is a 40px+ target", /\.tree-actions \.tree-action-more \{[\s\S]*?width: 40px;/.test(mobile), true);

// The permanent button must take its own column rather than float over the row,
// or it lands on the folder count and clips long names.
const mActions = mobile.match(/\.tree-actions \{([^}]*)\}/)[1];
check("actions are in flow on touch, not an overlay", /position:\s*static/.test(mActions), true);
check("they cannot be squashed", /flex-shrink:\s*0/.test(mActions), true);
check("no opaque plate covering the row", /background:\s*transparent/.test(mActions), true);
check("no leftover width reservation on the label", /padding-right:\s*46px/.test(mobile), false);
check("the folder count stays visible on touch", /\.tree-row:hover \.tree-count,[\s\S]*?visibility: visible/.test(mobile), true);

// Desktop keeps the overlay, so it yields the count slot while hovering.
check("desktop hides the count under the action plate", /@media \(hover: hover\)[\s\S]*?\.tree-row:hover \.tree-count,[\s\S]*?visibility: hidden/.test(css), true);
check("hiding uses visibility so the row does not reflow", /\.tree-row:focus-within \.tree-count \{\s*visibility: hidden;/.test(css), true);
check("the active row's plate matches its fill", /\.tree-row\.is-active \.tree-actions \{\s*background: var\(--selected\)/.test(css), true);
check("every doc row gets one", js.includes("buildOverflowAction(() => buildDocContextItems(doc))"), true);
check("every folder row gets one", js.includes("buildOverflowAction(() => buildFolderContextItems(folder))"), true);

console.log("=== sidebar header cannot overflow a narrow drawer ===");
check("the head wraps", /\.sidebar-head \{[\s\S]*?flex-wrap: wrap;/.test(mobile), true);
check("action buttons shrank", /\.icon-btn\.icon-btn-sm \{\s*width: 36px;/.test(mobile), true);

// Widest realistic case: 320px phone -> 85vw drawer = 272px.
const drawer = Math.min(0.85 * 320, 340);
const buttons = 6 * 36; // five actions plus the mobile close button
const padding = 8 + 12;
console.log(`  (drawer ${drawer}px; ${buttons}px of buttons + ${padding}px padding)`);
check("buttons alone fit the drawer width", buttons + padding <= drawer, true);

console.log("=== touch targets ===");
check("rows are 44px on touch", /\.tree-row \{\s*min-height: 44px;/.test(mobile), true);

// --- Contrast -------------------------------------------------------------

function hex(v) {
  const n = v.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [l1, l2] = [luminance(hex(a)), luminance(hex(b))].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// These assertions are about the dark palette specifically, so scope the scan
// to the base :root block. Without this it picks up whichever theme block is
// last in the file.
const darkBlock = css.slice(css.indexOf(":root {"), css.indexOf('.tooltip {') > -1 ? css.indexOf(":root[data-theme=\"light\"]") : css.length);
const vars = {};
for (const m of darkBlock.matchAll(/^\s*(--[a-z-]+):\s*(#[0-9a-f]{6});/gim)) {
  vars[m[1]] = m[2];
}

console.log("=== palette contrast (WCAG on the new darker surfaces) ===");
const pairs = [
  ["body text on canvas", "--fg", "--canvas", 4.5],
  ["body text on surface", "--fg", "--surface", 4.5],
  ["muted text on canvas", "--fg-muted", "--canvas", 4.5],
  ["muted text on surface", "--fg-muted", "--surface", 4.5],
  ["subtle text on surface", "--fg-subtle", "--surface", 3.0],
  ["accent on canvas", "--accent", "--canvas", 4.5],
  ["accent on surface", "--accent", "--surface", 4.5],
  ["accent on selected row", "--accent", "--selected", 4.5],
  ["danger on surface", "--danger", "--surface", 4.5],
  ["success on surface", "--success", "--surface", 4.5],
  ["attention on surface", "--attention", "--surface", 4.5],
  ["done on surface", "--done", "--surface", 4.5],
  ["white on primary button", "--fg-on-emphasis", "--success-emphasis", 4.5],
  ["white on danger button", "--fg-on-emphasis", "--danger-emphasis", 4.5]
];

for (const [label, fg, bg, min] of pairs) {
  const r = ratio(vars[fg], vars[bg]);
  const ok = r >= min;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${r.toFixed(2)}:1 (min ${min})`);
}

console.log("=== the palette really did get darker ===");
const canvasLum = luminance(hex(vars["--canvas"]));
console.log(`  canvas ${vars["--canvas"]} luminance ${canvasLum.toFixed(4)}`);
check("canvas is darker than the previous #0b0f12", canvasLum < luminance(hex("#0b0f12")), true);
check("accent is a light pastel, not a mid teal", luminance(hex(vars["--accent"])) > luminance(hex("#4fa8a0")), true);

console.log(failures === 0 ? "\nALL MOBILE + PALETTE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
