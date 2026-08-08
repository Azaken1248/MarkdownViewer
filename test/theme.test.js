// Light theme is a token swap, so every pair the dark theme was measured on has
// to be measured again. Same thresholds: 4.5:1 for text, 3:1 for non-text
// boundaries (WCAG 1.4.11), and 24px for pointer targets (2.5.8).
const fs = require("fs");
const path = require("path");
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const css = fs.readFileSync(path.join(PUBLIC_DIR, "css", "app.css"), "utf8");
const js = fs.readFileSync(path.join(PUBLIC_DIR, "js", "app.js"), "utf8");
const html = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");
const boot = fs.readFileSync(path.join(PUBLIC_DIR, "js", "theme-boot.js"), "utf8");

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

function tokens(selector) {
  const re = new RegExp(`${selector.replace(/[[\]"=:.]/g, "\\$&")}\\s*\\{([\\s\\S]*?)\\n\\}`);
  const m = css.match(re);
  const out = {};
  if (!m) return out;
  for (const t of m[1].matchAll(/(--[a-z-]+):\s*(#[0-9a-f]{3,8}|rgba?\([^)]*\))/gi)) out[t[1]] = t[2];
  return out;
}

function rgb(v) {
  if (v.startsWith("#")) {
    const n = v.slice(1);
    const full = n.length === 3 ? n.split("").map((c) => c + c).join("") : n;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  }
  const parts = v.match(/[\d.]+/g).map(Number);
  return parts.slice(0, 3);
}
function alpha(v) {
  if (!v.startsWith("rgba")) return 1;
  const parts = v.match(/[\d.]+/g).map(Number);
  return parts.length > 3 ? parts[3] : 1;
}
function over(fg, bg) {
  const a = alpha(fg), f = rgb(fg), b = rgb(bg);
  return f.map((c, i) => c * a + b[i] * (1 - a));
}
function lum(c) {
  const [r, g, b] = c.map((x) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(fgv, bgv, T) {
  const bg = over(T[bgv] || bgv, "#ffffff");
  const fg = over(T[fgv] || fgv, T[bgv] || bgv);
  const [l1, l2] = [lum(fg), lum(bg)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

const dark = tokens(":root");
const light = { ...dark, ...tokens(':root[data-theme="light"]') };

const PAIRS = [
  ["body text on the canvas", "--fg", "--canvas", 4.5],
  ["body text on a surface", "--fg", "--surface", 4.5],
  ["muted text on a surface", "--fg-muted", "--surface", 4.5],
  ["muted text on the canvas", "--fg-muted", "--canvas", 4.5],
  ["subtle text on a surface", "--fg-subtle", "--surface", 3.0],
  // Group chips on a card, and inline code, sit on --raised rather than on a
  // plain surface.
  ["muted text on a raised surface", "--fg-muted", "--raised", 4.5],
  // A selected group chip is accent-on-selected, the same pair a selected tree
  // row uses.
  ["a selected group chip", "--accent", "--selected", 4.5],
  ["accent text on the canvas", "--accent", "--canvas", 4.5],
  ["accent on a selected row", "--accent", "--selected", 4.5],
  ["accent on a raised surface", "--accent", "--raised", 4.5],
  ["primary button label on its fill", "--fg-on-emphasis", "--success-emphasis", 4.5],
  ["danger button label on its fill", "--fg-on-emphasis", "--danger-emphasis", 4.5],
  ["danger text on a surface", "--danger", "--surface", 4.5],
  ["success text on a surface", "--success", "--surface", 4.5],
  ["attention text on a surface", "--attention", "--surface", 4.5],
  ["done text on a surface", "--done", "--surface", 4.5],
  // A code block is --surface and inline code is --raised. These five were
  // literals in the .hljs rules with no light value at all, which left most of
  // the text in every code block at 1.5–2.1:1 on white.
  ["a keyword in a code block", "--code-keyword", "--surface", 4.5],
  ["a keyword in inline code", "--code-keyword", "--raised", 4.5],
  ["a function name in a code block", "--code-entity", "--surface", 4.5],
  ["a function name in inline code", "--code-entity", "--raised", 4.5],
  ["a string in a code block", "--code-string", "--surface", 4.5],
  ["a string in inline code", "--code-string", "--raised", 4.5],
  ["a number in a code block", "--code-constant", "--surface", 4.5],
  ["a number in inline code", "--code-constant", "--raised", 4.5],
  ["a decorator in a code block", "--code-meta", "--surface", 4.5],
  ["a decorator in inline code", "--code-meta", "--raised", 4.5],
  ["a comment in a code block", "--fg-muted", "--surface", 4.5],

  ["border against the canvas", "--border", "--canvas", 1.2],
  ["hairline separator against a surface", "--border-strong", "--surface", 1.4],
  ["scrollbar thumb against the canvas", "--scrollbar-thumb", "--canvas", 3.0],
  ["scrollbar thumb against a surface", "--scrollbar-thumb", "--surface", 3.0],
  ["focus ring against the canvas", "--accent", "--canvas", 3.0]
];

for (const [name, T] of [["dark", dark], ["light", light]]) {
  console.log(`=== ${name} theme contrast ===`);
  for (const [label, fg, bg, min] of PAIRS) {
    const r = ratio(fg, bg, T);
    const ok = r >= min;
    if (!ok) failures++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${r.toFixed(2)}:1 (min ${min})`);
  }
}

console.log("=== the light theme is a complete swap, not a partial one ===");
const darkOnly = Object.keys(tokens(":root")).filter((k) => /color|fg|bg|accent|border|canvas|surface|raised|selected|success|danger|attention|done|shadow|code-/.test(k));
const lightKeys = Object.keys(tokens(':root[data-theme="light"]'));
const missing = darkOnly.filter((k) => !lightKeys.includes(k));
check("every colour token is redefined", missing, []);

// The syntax colours were literals in the .hljs rules, which is exactly how
// they escaped the swap. Nothing may set a colour from a literal again.
// Everything after the token blocks is component CSS. Print is exempt: it
// deliberately forces black on white for paper, whatever the screen theme is.
const components = css.slice(css.indexOf("color-scheme: light")).replace(/@media print[\s\S]*$/, "");
const literals = [...components.matchAll(/(?:^|;|\{)\s*color:\s*(#[0-9a-f]{3,8})/gi)].map((m) => m[1]);
check("no rule sets a text colour from a hard-coded hex", literals, []);
check("color-scheme is declared for both", /color-scheme: dark/.test(css) && /color-scheme: light/.test(css), true);

console.log("=== auto is resolved before paint, not duplicated in CSS ===");
check("no second copy of the palette in a media query", /prefers-color-scheme: light\)\s*\{\s*:root/.test(css), false);
check("a pre-paint boot script exists", boot.includes("document.documentElement.dataset.theme"), true);
check("it runs before the stylesheet", html.indexOf("theme-boot.js") < html.indexOf("css/app.css"), true);
check("it is not inline (CSP has no unsafe-inline for scripts)", /<script>[\s\S]*dataset\.theme/.test(html), false);
check("it defaults to dark, not to the system", boot.includes('stored = "dark"'), true);
check("only auto consults the system", /if \(stored === "auto"\)/.test(boot), true);
check("the preference survives a storage throw", /catch \(error\) \{[\s\S]{0,120}stored = null/.test(boot), true);

console.log("=== the toggle ===");
check("the button exists", html.includes('id="themeToggleBtn"'), true);
check("it cycles all three modes", /THEME_CYCLE = \["dark", "light", "auto"\]/.test(js), true);
check("its label says both the state and the next state", js.includes("Switch to ${THEME_META[meta.next].label.toLowerCase()}"), true);
check("theme-color meta follows the theme", js.includes('meta[name="theme-color"]'), true);
check("the system listener cannot override an explicit choice",
  /if \(themePreference\(\) === "auto"\) \{/.test(js), true);

console.log("=== pointer targets meet 24px (WCAG 2.5.8) ===");
function size(selector) {
  const re = new RegExp(`${selector.replace(/[.[\]]/g, "\\$&")}\\s*\\{([^}]*)\\}`);
  const m = css.match(re);
  if (!m) return null;
  const w = m[1].match(/(?:min-)?width:\s*(\d+)px/);
  const h = m[1].match(/(?:min-)?height:\s*(\d+)px/);
  return { w: w ? Number(w[1]) : null, h: h ? Number(h[1]) : null };
}
for (const sel of [".tree-action", ".icon-btn", ".icon-btn.icon-btn-sm", ".search-clear", ".crumb", ".filter-clear", ".supersearch-more"]) {
  const s = size(sel);
  const smallest = Math.min(s.w ?? 999, s.h ?? 999);
  const ok = smallest >= 24;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${sel}: ${s.w ?? "auto"}x${s.h ?? "auto"}px`);
}

console.log("=== print stylesheet ===");
const print = css.slice(css.indexOf("@media print"));
check("a print block exists", css.includes("@media print"), true);
for (const chrome of [".app-header", ".sidebar", ".viewer-toolbar", ".mobile-dock", ".supersearch-panel", ".toast-region", ".tooltip", ".match-nav", ".modal", ".context-menu"]) {
  const hidden = new RegExp(`\\${chrome.replace(".", ".")}[,\\s]`).test(print.split("display: none")[0]);
  if (!hidden) failures++;
  console.log(`  ${hidden ? "PASS" : "FAIL"}  ${chrome} is not printed`);
}
// The fixed shell is what would otherwise print exactly one sheet.
check("the viewport-height clamp is released", /height: auto !important/.test(print), true);
check("...and the overflow clip with it", /overflow: visible !important/.test(print), true);
check("the dark background is not sent to the printer", /background: #ffffff !important/.test(print), true);
check("text prints black", /color: #000000 !important/.test(print), true);
check("code blocks are not split across pages", /break-inside: avoid/.test(print), true);
check("...with the legacy property for older engines", /page-break-inside: avoid/.test(print), true);
check("headings stay with their content", /break-after: avoid/.test(print), true);
check("link destinations are printed", /content: " \(" attr\(href\)/.test(print), true);
check("diagrams drop their screen aspect box", /aspect-ratio: auto !important/.test(print), true);
check("pan/zoom chrome is not printed", /\.svg-pan-zoom-control \{\s*display: none/.test(print), true);
check("page margins are set", /@page \{/.test(print), true);

console.log(failures === 0 ? "\nALL THEME CHECKS PASSED" : `\n${failures} THEME CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
