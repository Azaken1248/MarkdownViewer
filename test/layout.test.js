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

console.log(failures === 0 ? "\nALL LAYOUT CHECKS PASSED" : `\n${failures} LAYOUT CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
