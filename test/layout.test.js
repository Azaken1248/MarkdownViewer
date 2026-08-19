// Audits the layout rules structurally: no hardcoded header offsets, one scroll
// owner per region, nothing that reintroduces the side gutters.
const fs = require("fs");
const path = require("path");
const PUBLIC_DIR = path.join(__dirname, "..", "public");


const css = fs.readFileSync(path.join(PUBLIC_DIR, "css", "app.css"), "utf8");

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

// Pull a rule body out by selector, from the base sheet or a media block.
function rule(selector, source = css) {
  const re = new RegExp(`(^|[},])\\s*${selector.replace(/[.#*]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "m");
  const m = source.match(re);
  return m ? m[2] : null;
}

function mediaBlock(query) {
  const start = css.indexOf(query);
  if (start < 0) return "";
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(start, i);
    }
  }
  return "";
}

const mobile = mediaBlock("@media (max-width: 920px)");

console.log("=== the black side strips are gone ===");
const shell = rule(".app-shell");
check("app-shell has no max-width", /max-width/.test(shell), false);
check("app-shell spans the full width", /width:\s*100%/.test(shell), true);
check("no auto side margins", /margin:\s*0 auto/.test(shell), false);
check("no side borders framing it", /border-left|border-right/.test(shell), false);
// There are two body rules (reset, then styling); check the sheet as a whole.
check("body background matches the shell", /body \{[^}]*background:\s*var\(--canvas\)/.test(css), true);

console.log("=== markdown fills its pane ===");
const md = rule(".markdown-body");
check("no measure cap left", /max-width/.test(md), false);
check("still full width of the pane", /width:\s*100%/.test(md), true);

console.log("=== the hardcoded header height is gone ===");
check("no 53px offsets anywhere", css.includes("53px"), false);
// calc(100vh - 32px) is modal padding, not a header offset; only offsets that
// encode the header height are the problem.
const headerCalcs = [...css.matchAll(/calc\(100vh - (\d+)px\)/g)].map((m) => Number(m[1]));
check("no calc encodes a header height", headerCalcs.filter((n) => n !== 32), []);

console.log("=== one scroll owner per region ===");
check("the shell itself does not scroll", /overflow:\s*hidden/.test(shell), true);
check("the shell is viewport height", /height:\s*100dvh/.test(shell), true);
check("the header is not sticky", /position:\s*sticky/.test(rule(".app-header")), false);
check("the header cannot be squashed", /flex-shrink:\s*0/.test(rule(".app-header")), true);
check("the layout clips", /overflow:\s*hidden/.test(rule(".layout")), true);
check("the viewer scrolls itself", /overflow-y:\s*auto/.test(rule(".viewer")), true);
check("the viewer can shrink below content", /min-height:\s*0/.test(rule(".viewer")), true);
check("the sidebar clips, its tree scrolls", /overflow:\s*hidden/.test(rule(".sidebar")), true);
check("the tree is the sidebar's scroller", /overflow-y:\s*auto/.test(rule(".tree")), true);

// The same trap the header is already held out of, one level down. .viewer is
// a column flex container with a definite height, so everything directly
// inside it is a flex item. A flex item normally cannot be squashed below its
// content, but an explicit min-height replaces that automatic minimum — and
// the document below these bars cannot shrink at all, since its own minimum is
// its content. So when a document overflowed, these bars were the only things
// that could give, and they gave all of it: the toolbar sat at its min-height
// with its breadcrumb and buttons hanging out past the bottom border, over the
// text. Which is also why widening its padding changed nothing anyone could
// see — the box was pinned, so the extra only pushed the contents further out.
for (const selector of [".viewer-toolbar", ".page-edit-bar", ".kernel-bar"]) {
  check(`${selector} cannot be squashed by the document below it`,
    /flex-shrink:\s*0/.test(rule(selector)), true);
}

// And the one that made it dangerous: a min-height without that is a flex item
// that has quietly given up its floor.
for (const selector of [".viewer-toolbar", ".page-edit-bar", ".kernel-bar"]) {
  const body = rule(selector) || "";
  if (!/min-height:/.test(body)) continue;
  check(`${selector} keeps a floor to go with its min-height`,
    /flex-shrink:\s*0/.test(body), true);
}

console.log("=== the toolbar sticks to its own scroller, not the viewport ===");
const toolbar = rule(".viewer-toolbar");
check("sticky at top 0", /top:\s*0/.test(toolbar), true);
check("no mobile top override left behind", /\.viewer-toolbar\s*\{[^}]*top:/.test(mobile), false);
check("toolbar sits below the header in z-order", Number(toolbar.match(/z-index:\s*(\d+)/)[1]) < Number(rule(".app-header").match(/z-index:\s*(\d+)/)[1]), true);

console.log("=== mobile drawer no longer covers the header ===");
const mSidebar = rule(".sidebar", mobile);
check("drawer is absolute, not viewport-fixed", /position:\s*absolute/.test(mSidebar), true);
check("it spans the layout area", /top:\s*0/.test(mSidebar) && /bottom:\s*0/.test(mSidebar), true);
check("no 100dvh drawer height", /100dvh/.test(mSidebar), false);
check("layout is its positioning context", /position:\s*relative/.test(rule(".layout", mobile)), true);
const mOverlay = rule(".sidebar-overlay", mobile);
check("overlay dims the content area only", /position:\s*absolute/.test(mOverlay), true);
check("drawer sits above the overlay", Number(mSidebar.match(/z-index:\s*(\d+)/)[1]) > Number(mOverlay.match(/z-index:\s*(\d+)/)[1]), true);

console.log("=== mobile header layout ===");
check("actions are pushed right once search wraps", /\.header-actions\s*\{[^}]*margin-left:\s*auto/.test(mobile), true);
check("search takes its own row", /\.search-wrap\s*\{[^}]*flex:\s*1 0 100%/.test(mobile), true);

console.log("=== z-index scale stays ordered ===");
const layers = [...css.matchAll(/z-index:\s*(\d+)/g)].map((m) => Number(m[1]));
const unique = [...new Set(layers)].sort((a, b) => a - b);
console.log(`  (${unique.join(" < ")})`);
// Tooltips describe the thing under the cursor, including controls inside a
// toast, so they are the one layer that has to sit above everything.
check("tooltips are the topmost layer", Math.max(...unique), 250);
check("toasts sit just below them", unique[unique.length - 2], 200);
check("no duplicate-purpose collisions below 100", unique.filter((n) => n < 100).length, new Set(unique.filter((n) => n < 100)).size);

console.log("=== the hidden attribute actually hides ===");
{
  // `hidden` only works through the UA rule `[hidden] { display: none }`, which
  // any author `display:` declaration beats — and nearly every control here
  // sets one. That silently broke the role-gated buttons and the share page's
  // spinner: the property was true, the element was still on screen.
  const { JSDOM } = require("jsdom");
  const probe = new JSDOM(`<style>${css}</style>
    <button class="icon-btn" id="a"></button>
    <button class="btn" id="b"></button>
    <button class="dock-btn" id="c"></button>
    <div class="share-loading" id="d"></div>
    <div class="field" id="e"></div>
    <div class="account-menu" id="f"></div>`);

  for (const id of ["a", "b", "c", "d", "e", "f"]) {
    const el = probe.window.document.getElementById(id);
    const shown = probe.window.getComputedStyle(el).display;
    el.hidden = true;
    const hidden = probe.window.getComputedStyle(el).display;
    const ok = shown !== "none" && hidden === "none";
    if (!ok) failures++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  .${el.className}: ${shown} -> ${hidden}`);
  }

  check("the rule is !important so specificity cannot beat it",
    /\[hidden\] \{\s*display: none !important;/.test(css), true);
  // It is also the last rule in the file, so it wins on order too. jsdom does
  // not honour !important across rules; browsers do. Being last satisfies both.
  check("...and last in the file, so order cannot beat it either",
    css.trimEnd().endsWith("[hidden] {\n  display: none !important;\n}"), true);
}

console.log("=== the error page stands on its own ===");
{
  const html = fs.readFileSync(path.join(PUBLIC_DIR, "error.html"), "utf8");

  // An error page that needs the thing that just failed is an error page that
  // renders blank.
  check("it loads no application script", /js\/app\.js/.test(html), false);
  check("...and no markdown engine", /markdown-core/.test(html), false);
  check("only the theme boot, so it matches light and dark", /theme-boot\.js/.test(html), true);

  // It can be served from any URL depth, so relative asset paths would resolve
  // against whatever the reader typed.
  const localAssets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)]
    .map((m) => m[1])
    .filter((href) => !href.startsWith("http"));
  check("every local asset path is absolute",
    localAssets.filter((href) => !href.startsWith("/")), []);

  check("the status number is hidden from screen readers (the heading says it)",
    /class="error-status" aria-hidden="true"/.test(html), true);
  check("an empty detail line collapses", /\.error-detail:empty \{\s*display: none;/.test(css), true);
}

console.log("=== the share page can scroll ===");
{
  // body is overflow:hidden so the app shell can own its scrollers. The share
  // page has no shell, so it needs one of its own or a long document is stuck.
  // There are two `body {` blocks (reset, then theme), so match across all of
  // them rather than whichever one the helper finds first.
  const bodyBlocks = [...css.matchAll(/(?:^|\n)body \{([^}]*)\}/g)].map((m) => m[1]).join("\n");
  check("body still does not scroll (the app shell owns that)",
    /overflow:\s*hidden/.test(bodyBlocks), true);

  const sharePage = rule(".share-page");
  check("the share page has a bounded height", /height:\s*100dvh/.test(sharePage), true);
  check("...and scrolls its own content", /overflow-y:\s*auto/.test(sharePage), true);
  check("no horizontal scroll", /overflow-x:\s*hidden/.test(sharePage), true);
}

console.log("=== the editor split stays even ===");
{
  // A grid item's automatic minimum size is its min-content width, not zero, so
  // `1fr 1fr` is only an even split until the preview holds something that
  // refuses to get narrower — a wide table, a long unbroken URL, a code line.
  // That column then wins and the textarea is squeezed to a sliver, which is
  // exactly what happened on documents with a wide table in them.
  const grid = rule(".editor-grid");
  check("the editor is two equal columns", /grid-template-columns:\s*1fr 1fr/.test(grid), true);

  const pane = rule(".editor-pane");
  check("...and a pane may shrink below its content", /min-width:\s*0/.test(pane), true);

  const preview = rule(".editor-preview");
  check("the preview may shrink too", /min-width:\s*0/.test(preview), true);
  check("...and scrolls anything too wide instead of pushing",
    /overflow-x:\s*auto/.test(preview), true);
  check("...and breaks a long unbroken URL rather than widening",
    /overflow-wrap:\s*anywhere/.test(preview), true);
}

console.log("=== a narrow editor becomes two tabs ===");
{
  // Stacking put the preview a screen below the thing that produced it, and
  // left the textarea short. One pane at a time, with a tap to switch.
  const tabs = rule(".editor-tabs");
  check("the tab bar is hidden by default", /display:\s*none/.test(tabs), true);

  const narrow = mediaBlock("@media (max-width: 1160px)");
  check("...and appears below the split point", /\.editor-tabs \{[^}]*display:\s*flex/.test(narrow), true);
  check("the grid collapses to one column",
    /\.editor-grid \{[^}]*grid-template-columns:\s*1fr/.test(narrow), true);

  // Both panes occupy the same cell, so the hidden one takes no room. Stacking
  // them in separate rows is the thing being replaced.
  check("both panes share one cell", /\.editor-pane \{[^}]*grid-row:\s*1/.test(narrow), true);
  check("...and one column too", /\.editor-pane \{[^}]*grid-column:\s*1/.test(narrow), true);
  check("the labels give way to the tabs",
    /\.editor-label \{[^}]*display:\s*none/.test(narrow), true);

  // The CSS decides whether the tab bar is visible; the client decides whether
  // a pane is hidden. If those disagree you get a tab bar that controls
  // nothing, or no visible pane at all.
  const js = fs.readFileSync(path.join(PUBLIC_DIR, "js", "app.js"), "utf8");
  const jsQuery = (js.match(/EDITOR_TABS_QUERY = "([^"]+)"/) || [])[1];
  check("the client uses the same breakpoint as the stylesheet",
    jsQuery, "(max-width: 1160px)");
  check("...and puts both panes back when the window widens past it",
    /matchMedia\?\.\(EDITOR_TABS_QUERY\)\.addEventListener\?\.\("change", syncEditorTabs\)/.test(js), true);
  check("above the breakpoint neither pane is hidden",
    /pane\.hidden = tabbed && !selected/.test(js), true);

  // A hidden element has no width, and Mermaid draws to the width it measures.
  check("switching to preview redraws it at its real width",
    /state\.editorTab === "preview"\)\s*\{\s*[\s\S]{0,300}renderEditorPreview\(\)/.test(js), true);

  const tab = rule(".editor-tab");
  check("the tabs are a comfortable touch target", /min-height:\s*44px/.test(tab), true);
  check("the selected one is marked for assistive tech, not just coloured",
    /\.editor-tab\[aria-selected="true"\]/.test(css), true);
}

console.log("=== the editor shows the characters that are there ===");
{
  // JetBrains Mono draws "###" as one glyph spread across the cells it
  // replaces, so typing ### into a markdown file rendered as "  #" and looked
  // like two characters had been swallowed. Nothing was — but a field whose
  // content *is* the characters cannot lie about them.
  const input = rule("#editorInput");
  check("the editor turns ligatures off", /font-variant-ligatures:\s*none/.test(input), true);
  check("...including contextual alternates, which is how this font ships them",
    /font-feature-settings:[^;]*"calt"\s*0/.test(input), true);

  const code = rule(".markdown-body code");
  check("rendered code does the same", /font-variant-ligatures:\s*none/.test(code), true);
  check("...and also turns calt off", /font-feature-settings:[^;]*"calt"\s*0/.test(code), true);
}

console.log("=== editing the document does not move the document ===");
{
  // The whole claim of in-place editing is that starting to edit changes
  // nothing about the page. Wrapping every markdown block in a div can only
  // keep that promise while the wrappers are metrically invisible: a border,
  // padding, or an overflow value on them would stop the children's margins
  // collapsing through and every gap in the document would change the moment
  // the pencil was pressed.
  const block = rule(".markdown-body.doc-editing .ve-block");
  check("the block wrappers exist", Boolean(block), true);
  check("they add no margin", /margin:\s*0/.test(block), true);
  check("they add no padding", /padding:\s*0/.test(block), true);
  check("they add no border", /border:\s*0/.test(block), true);
  check("they add no background", /background:\s*none/.test(block), true);
  check("...and nothing sets overflow on them, which would also stop collapsing",
    /overflow/.test(block), false);
  check("...and nothing sets a height on them", /height/.test(block), false);

  // Focus has to be visible without taking up space, so it is drawn out of
  // flow rather than as a border or an outline offset.
  const focus = (css.match(/:focus::before\s*\{([^}]*)\}/) || [])[1] || "";
  check("the focus mark is positioned out of the flow", /position:\s*absolute/.test(focus), true);
  check("...in the margin, beside the text rather than in it", /left:\s*-\d+px/.test(focus), true);

  // The first element's top margin is killed in the reading view; with wrappers
  // in the way the same rule has to reach one level deeper or the document
  // gains a gap at the top when editing starts.
  check("the first block still loses its top margin",
    /\.markdown-body\.doc-editing>\s*\.ve-block:first-child>\s*:first-child\s*\{[^}]*margin-top:\s*0/.test(css), true);

  // The bar sits below the sticky toolbar, which is 20 in the z-index scale.
  const bar = rule(".page-edit-bar");
  check("the edit bar sticks", /position:\s*sticky/.test(bar), true);
  check("...below the toolbar rather than over it", /z-index:\s*19/.test(bar), true);
  check("...at an offset measured from the toolbar, not guessed",
    /top:\s*var\(--page-edit-top/.test(bar), true);
}

console.log(failures === 0 ? "\nALL LAYOUT CHECKS PASSED" : `\n${failures} LAYOUT CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
