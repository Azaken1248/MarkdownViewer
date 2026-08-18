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

// Brace-match a media block out of the stylesheet, so each tier can be read
// on its own rather than by hoping a regex stops in the right place.
function mediaBlock(query, from = 0) {
  const start = css.indexOf(query, from);
  if (start < 0) return "";

  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(start, i);
  }

  return "";
}

// Rules only. Several of these checks are "nothing still does X", and the
// comment explaining why nothing does X says X.
const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");

const mobile = mediaBlock("@media (max-width: 920px)");
const phone = mediaBlock("@media (max-width: 640px)");
const short = mediaBlock("@media (max-height: 560px)");
const shortPhone = mediaBlock("@media (max-height: 560px) and (max-width: 920px)");
const shareHtml = fs.readFileSync(path.join(PUBLIC_DIR, "share.html"), "utf8");
const errorHtml = fs.readFileSync(path.join(PUBLIC_DIR, "error.html"), "utf8");

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

console.log("=== a phone keeps the controls that live nowhere else ===");
{
  // This rule used to hide every icon button in the header and restore one
  // #lockToggleBtn, which is not in the markup and never has been — so a phone
  // had no theme switch and no account menu, and therefore no way to sign out,
  // change a password or reach the account list at all.
  check("no rule reaches for a button that does not exist",
    rules.includes("lockToggleBtn"), false);
  check("...and the markup really does not have one", html.includes("lockToggleBtn"), false);

  const hidden = (mobile.match(/\.header-actions ([^{]*)\{\s*display: none;/) || [])[1] || "";
  check("upload steps aside, since the dock has it", hidden.includes("#uploadWrap"), true);
  check("...and so does edit, for the same reason", hidden.includes("#editDocBtn"), true);
  check("the theme switch stays", /themeToggleBtn/.test(hidden), false);
  check("...and so does the account menu", /accountBtn/.test(hidden), false);
  check("...which is not hidden by a blanket rule either",
    /\.header-actions \.icon-btn[^{]*\{\s*display: none/.test(mobile), false);

  // A menu anchored to its button's left edge, on a button sitting at the
  // right edge of a phone, opens off the side of the screen.
  check("the account menu is not flipped off the screen on mobile",
    /\.account-menu \{\s*right: auto;\s*left: 0;/.test(css), false);
}

console.log("=== the match navigator is on the screen at all ===");
{
  // It is moved to <body> at start-up so a transformed shell cannot drag it
  // about. As a static child of a body whose other child is a full-height
  // shell, and which hides its overflow, it was laid out below the fold and
  // clipped: present, correct and invisible.
  check("it is moved out of the toolbar", js.includes("document.body.appendChild(elements.matchNav)"), true);

  const rule = (css.match(/\.match-nav \{([^}]*)\}/) || [])[1] || "";
  check("...so it places itself against the viewport", /position:\s*fixed/.test(rule), true);
  check("...clear of the file tree, which it would otherwise cover",
    /left:\s*calc\(var\(--sidebar-width\)/.test(rule), true);
  check("...and the layout column is that same width",
    /grid-template-columns:\s*var\(--sidebar-width\)/.test(css), true);

  // Three things float over the bottom of a phone. Each needs its own band.
  const band = (block, selector) => {
    const rule = (block.match(new RegExp(`\\${selector} \\{([^}]*)\\}`)) || [])[1] || "";
    return Number((rule.match(/bottom:\s*calc\((\d+)px/) || [])[1] || 0);
  };

  const dock = band(mobile, ".mobile-dock");
  const nav = band(mobile, ".match-nav");
  const toast = band(mobile, ".toast-region");
  console.log(`  (dock ${dock}px, match nav ${nav}px, toasts ${toast}px from the bottom)`);
  check("the match navigator clears the dock", nav > dock, true);
  check("...and the toasts clear the match navigator", toast > nav, true);
}

console.log("=== a dialog fits the room the modal gives it ===");
{
  const modal = (css.match(/\.modal \{([^}]*)\}/) || [])[1] || "";
  const dialog = (css.match(/\.dialog \{([^}]*)\}/) || [])[1] || "";

  check("the modal is the viewport as it is now, not at its tallest",
    /height:\s*100dvh/.test(modal), true);
  check("...and the dialog measures itself against the modal",
    /max-height:\s*100%/.test(dialog), true);
  check("...rather than restating the desktop padding by hand",
    /max-height:\s*calc\(100vh/.test(dialog), false);

  // vh is the viewport at its tallest — the size it is with the URL bar rolled
  // away — so every panel capped in vh was over-tall while the bar showed.
  check("nothing is still measured in vh", /[0-9]vh\b/.test(rules), false);

  check("a short screen puts dialogs at the top so they can scroll",
    /\.modal:not\(#editorModal\) \{\s*align-items: flex-start;/.test(short), true);
}

console.log("=== there is a phone tier, not just a not-desktop tier ===");
{
  // One breakpoint meant a 360px phone was laid out exactly like a 900px
  // tablet: words vanished from buttons with ample room for them, and padding
  // sized for a mouse stayed at a width where it is a quarter of the screen.
  check("a phone tier exists", phone.length > 0, true);
  check("the wordmark survives tablet width", /\.brand-text \{\s*display: none;/.test(mobile), false);
  check("...and goes at phone width", /\.brand-text,/.test(phone), true);
  check("the section names go with it", /\.place-btn span,/.test(phone), true);
  check("...and the New label too", /\.btn-compact span \{\s*display: none;/.test(phone), true);
  check("the document pane tightens up", /\.app-shell \.markdown-body \{\s*padding: 14px/.test(phone), true);
  check("...and the cards go to one column", /\.links-grid \{\s*grid-template-columns: 1fr;/.test(phone), true);

  check("a short screen has its own tier", short.length > 0, true);
  check("...where the dock drops its labels", /\.dock-btn span \{\s*display: none;/.test(shortPhone), true);
  check("...and gives the document back the room", /padding-bottom: 72px;/.test(shortPhone), true);
}

console.log("=== the links pane is held to the same rules as the viewer ===");
{
  const paneAt = (block) => (block.match(/\.links-pane \{([^}]*)\}/) || [])[1] || "";
  check("it clears the floating dock, as the document pane does",
    /96px/.test(paneAt(mobile)), true);
  check("...and again at phone width", /96px/.test(paneAt(phone)), true);
  check("...with the side padding the viewer beside it uses",
    /max\(12px, env\(safe-area-inset-right\)\)/.test(paneAt(phone)), true);
}

console.log("=== things that sit above each other line up ===");
{
  // One side of a padding shorthand, expanded the way CSS expands it, so a
  // rule written as one, two or four values reads the same here.
  const pad = (selector, side = "right", block = rules) => {
    const rule = (block.match(new RegExp(`\\${selector} \\{([^}]*)\\}`)) || [])[1] || "";
    const parts = ((rule.match(/padding:\s*([^;]+);/) || [])[1] || "").trim().split(/\s+/);
    const [top, right = top, bottom = top, left = right] = parts;
    return { top, right, bottom, left }[side];
  };

  // The edit bar hangs directly under the viewer toolbar. Two rows of controls
  // a few pixels out of step read as a mistake rather than as a hierarchy.
  check("the edit bar starts where the toolbar above it does",
    pad(".page-edit-bar", "left"), pad(".viewer-toolbar", "left"));
  check("...and still does on a phone-sized screen",
    /\.page-edit-bar \{\s*gap: 8px;\s*padding: 6px 16px;/.test(rules), true);
  check("the editor's tab strip lines up with its toolbar",
    pad(".editor-tabs", "left"), pad(".editor-toolbar", "left"));

  // The sidebar's title, its meta line and its rows are one column.
  check("the tree rows share the sidebar's gutter",
    /padding: 0 8px 0 calc\(var\(--tree-gutter\)/.test(rules), true);
  const gutter = (rules.match(/--tree-gutter:\s*(\d+px)/) || [])[1];
  check("...which is the one the heading and the meta line already used",
    [gutter, pad(".sidebar-head", "left"), pad(".sidebar-meta", "left")],
    ["12px", "12px", "12px"]);
  check("...measured from the same variable as the folder guide line",
    /left: calc\(var\(--tree-gutter\) \+ 7px/.test(rules), true);
  check("...and no stray 15px left where the guide line was",
    /left: calc\(15px/.test(rules), false);
}

console.log("=== touch targets in the header ===");
{
  // The drawer's buttons grew for touch and the header's did not, which left
  // the two most-tapped controls on the screen smaller than the ones inside a
  // drawer that has to be opened first.
  check("both sizes of icon button grow on a small screen",
    /\.icon-btn,\s*\.icon-btn\.icon-btn-sm \{\s*width: 36px;/.test(mobile), true);

  // The switcher is that height plus its own padding and border, so the two
  // have to move together or the header gets a step in it.
  const seat = (block) => {
    const rule = (block.match(/\.place-btn \{([^}]*)\}/) || [])[1] || "";
    return Number((rule.match(/height:\s*(\d+)px/) || [])[1] || 0) + 6;
  };

  check("the switcher matches the icon buttons on a pointer", seat(rules), 32);
  check("...and matches them again on a touch screen",
    seat(mediaBlock("@media (hover: none)", css.indexOf("@media (max-height: 560px)"))), 36);
}

console.log("=== one file, one version of it ===");
{
  // The query string is what makes a browser fetch a changed asset. Three
  // pages sharing app.css had drifted to two different numbers, so a visitor
  // who had opened a shared document kept serving themselves the old
  // stylesheet from cache under the old address — including, until this, none
  // of the responsive rules that page needs.
  const versions = new Map();
  for (const [page, markup] of [["index.html", html], ["share.html", shareHtml], ["error.html", errorHtml]]) {
    for (const [, file, version] of markup.matchAll(/\/((?:css|js)\/[a-z-]+\.(?:css|js))\?v=(\d+)/g)) {
      if (!versions.has(file)) versions.set(file, new Map());
      versions.get(file).set(page, version);
    }
  }

  for (const [file, pages] of versions) {
    const seen = [...new Set(pages.values())];
    if (seen.length > 1) {
      console.log(`  (${file}: ${[...pages].map(([p, v]) => `${p}=${v}`).join(", ")})`);
    }
    check(`${file} carries one version everywhere it is loaded`, seen.length, 1);
  }
}

console.log("=== the notch ===");
{
  // env(safe-area-inset-*) is 0 unless the page asks to be laid out under the
  // system furniture, so the dock's careful offset was always adding nothing.
  for (const [name, page] of [["the app", html], ["a shared document", shareHtml], ["the error page", errorHtml]]) {
    // The tag itself, not the file: the comment above it explaining why it is
    // there says the same words.
    const meta = (page.match(/<meta name="viewport"[^>]*>/i) || [""])[0];
    check(`${name} asks to be laid out under the system furniture`,
      /viewport-fit=cover/.test(meta), true);
  }

  // A bare inset is fine where it is an extra offset on top of padding an
  // element already has — the drawer adds one so its rows clear the notch. It
  // is wrong where it stands in for a real value, because on a phone without a
  // notch the inset is 0 and the padding is simply gone.
  check("no padding is replaced wholesale by an inset that may be zero",
    /\bpadding:\s*env\(safe-area-inset/.test(rules), false);
  check("the panes pair the inset with a value to fall back to",
    /padding: 12px max\(12px, env\(safe-area-inset-right\)\)/.test(phone), true);
  check("...and so does the header",
    /padding: 8px max\(10px, env\(safe-area-inset-right\)\)/.test(phone), true);
  check("the dock sits above the home indicator",
    /bottom: calc\(8px \+ env\(safe-area-inset-bottom\)\)/.test(mobile), true);
  check("...and clears a landscape notch on either side",
    /left: max\(8px, env\(safe-area-inset-left\)\)/.test(mobile), true);
}

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
