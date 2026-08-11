// Loads the real index.html + app.js in jsdom against a real server, so a
// load-time crash or a broken render shows up without needing a browser.
//
// The server is spawned by the suite against a throwaway state directory with a
// known corpus (see helpers/server.js), which is what lets the write paths —
// cut, paste, rename, folder create — be exercised for real.
const fs = require("fs");
const path = require("path");
const http = require("http");
const { JSDOM, VirtualConsole } = require("jsdom");
const { startTestServer, SEED_USERNAME, SEED_PASSWORD, TEST_PASSWORD } = require("./helpers/server");

const ROOT = path.join(__dirname, "..", "public");

let failures = 0;
const consoleErrors = [];

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

let ORIGIN = "";

let sendCookies = () => "";
let receiveCookies = () => {};

function get(pathname) {
  return new Promise((resolve, reject) => {
    const headers = sendCookies() ? { Cookie: sendCookies() } : {};
    http.get(`${ORIGIN}${pathname}`, { headers }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        receiveCookies(res);
        resolve({ status: res.statusCode, body: data });
      });
    }).on("error", reject);
  });
}

(async () => {
  const server = await startTestServer();
  ORIGIN = server.origin;
  console.log(`  (test server on ${ORIGIN}, state in ${server.stateDir})`);

  try {
    await run(server);
  } finally {
    await server.stop();
  }

  console.log(failures === 0 ? "\nALL DOM CHECKS PASSED" : `\n${failures} DOM CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function run(server) {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8")
    .replace(/__EMBED_[A-Z_]+__/g, "x")
    // Strip the CDN tags; their globals are stubbed below.
    .replace(/<link[^>]+cdn[^>]+>/g, "")
    .replace(/<script[^>]+https:[^>]+><\/script>/g, "")
    .replace(/<script src="js\/app\.js[^"]*" defer><\/script>/, "");

  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => consoleErrors.push(`jsdomError: ${e.message}`));
  virtualConsole.on("error", (...args) => consoleErrors.push(`console.error: ${args.join(" ")}`));

  const dom = new JSDOM(html, {
    url: ORIGIN,
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole
  });

  const { window } = dom;

  // Browsers put these on window; jsdom does not. markdown-core stashes the TeX
  // of a maths block as base64 through TextEncoder, so without them rendering
  // any document containing maths throws and the open silently gives up.
  window.TextEncoder = TextEncoder;
  window.TextDecoder = TextDecoder;

  // Third-party globals the app expects to already be on the page.
  //
  // A stand-in for marked. It only has to produce the shapes the editor works
  // on — a table, a code block, a paragraph — because what is under test in
  // this suite is what the editor does with a rendering, not how markdown is
  // parsed. The parsing itself is marked's, and the serializers that read these
  // shapes back are checked against the real library in the visual suite.
  const escape = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  window.marked = {
    setOptions() {},
    parse(md) {
      const text = String(md);

      const fence = text.match(/^ {0,3}(?:```|~~~)(\S*)[^\n]*\n([\s\S]*?)(?:\n)?(?:```|~~~)\s*$/);
      if (fence) {
        return `<pre><code class="language-${escape(fence[1])}">${escape(fence[2])}\n</code></pre>`;
      }

      const lines = text.split("\n").filter((line) => line.trim() !== "");
      const isTable = lines.length >= 2 && lines[0].includes("|") && /^[\s|:-]*-[\s|:-]*$/.test(lines[1]);
      if (isTable) {
        const cells = (line) => line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
        const head = cells(lines[0]).map((c) => `<th>${escape(c)}</th>`).join("");
        const body = lines.slice(2)
          .map((line) => `<tr>${cells(line).map((c) => `<td>${escape(c)}</td>`).join("")}</tr>`)
          .join("");
        return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
      }

      // Real marked passes block-level raw HTML straight through. markdown-core
      // depends on that: it rewrites a maths block into a placeholder div
      // carrying the TeX, and expects the renderer to hand it back untouched.
      if (/^<[a-z]/i.test(text.trim())) {
        return text.trim();
      }

      return `<p>${text.replace(/[<>]/g, "")}</p>`;
    }
  };
  window.DOMPurify = { sanitize: (html) => html };
  window.mermaid = { initialize() {}, render: async () => ({ svg: "<svg></svg>" }) };
  window.hljs = { getLanguage: () => null, highlightAuto: (s) => ({ value: s }), highlight: (s) => ({ value: s }) };
  // KaTeX replaces the placeholder's contents with typeset maths and leaves the
  // TeX attribute alone; that is all this suite needs it to do.
  window.katex = {
    renderToString: (t) => t,
    render: (tex, node) => { node.textContent = tex; }
  };
  window.renderMathInElement = () => {};
  window.svgPanZoom = () => ({ destroy() {} });

  // Cookie jar for the proxy below. The app's session is an httpOnly cookie, so
  // there is nothing for the page script to carry — the transport has to.
  const cookieJar = new Map();

  function cookieHeader() {
    return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  sendCookies = cookieHeader;
  receiveCookies = absorbCookies;

  function absorbCookies(res) {
    for (const raw of res.headers["set-cookie"] || []) {
      const [pair] = raw.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value) {
        cookieJar.set(name, value);
      } else {
        cookieJar.delete(name);
      }
    }
  }

  // Proxy fetch to the spawned server so the app sees a real corpus.
  window.fetch = async (url, options = {}) => {
    const target = String(url).startsWith("http") ? String(url) : `${ORIGIN}${url}`;
    const method = (options.method || "GET").toUpperCase();
    // jsdom has no Response constructor, so hand back the shape requestJson uses.
    const makeResponse = (status, body) => ({
      status,
      ok: status >= 200 && status < 300,
      async json() { return JSON.parse(body); },
      async text() { return body; }
    });

    if (method !== "GET") {
      const body = await new Promise((resolve, reject) => {
        const parsed = new URL(target);
        const req = http.request({
          host: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname + parsed.search,
          method,
          // Deliberately passes the client's headers through untouched. This
          // used to add Content-Type itself, which meant a caller that forgot
          // it still worked here and failed in a browser: express.json()
          // ignores a body that does not say it is JSON, so the server saw an
          // empty req.body and complained about a missing field.
          headers: {
            ...(options.headers || {}),
            ...(cookieHeader() ? { Cookie: cookieHeader() } : {})
          }
        }, (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            absorbCookies(res);
            resolve({ status: res.statusCode, body: data });
          });
        });
        req.on("error", reject);
        if (options.body) req.write(options.body);
        req.end();
      });
      return makeResponse(body.status, body.body);
    }

    const parsed = new URL(target);
    const res = await get(parsed.pathname + parsed.search);
    return makeResponse(res.status, res.body);
  };

  // Sign in the way a browser does, before the app boots, so it comes up with a
  // real session. The seeded admin must replace its public password first.
  console.log("=== the harness signs in like a browser ===");
  {
    const login = await server.request("POST", "/api/auth/login",
      { username: SEED_USERNAME, password: SEED_PASSWORD });
    check("the seeded admin can sign in", login.status, 200);
    check("...and is required to change its password", login.body.user.mustChangePassword, true);
    absorbCookies({ headers: login.headers });

    const changed = await server.request("POST", "/api/auth/password",
      { currentPassword: SEED_PASSWORD, newPassword: TEST_PASSWORD },
      { Cookie: cookieHeader(), "X-CSRF-Token": login.body.csrfToken });
    check("the forced change succeeds", changed.status, 200);
    absorbCookies({ headers: changed.headers });
  }

  const appSource = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
  const coreSource = fs.readFileSync(path.join(ROOT, "js", "markdown-core.js"), "utf8");
  // markdown-core defines the render engine app.js delegates to; it has to be
  // in scope before app.js runs, exactly as the two <script> tags arrange.
  window.eval(coreSource);

  // Block splitting for the visual editor, loaded before app.js as the page
  // loads it.
  window.eval(fs.readFileSync(path.join(ROOT, "js", "visual-editor.js"), "utf8"));

  // The notebook Python controller, loaded before app.js the same way the page
  // loads it. jsdom has no Worker, but nothing here constructs one until a Run
  // button is pressed.
  window.eval(fs.readFileSync(path.join(ROOT, "js", "notebook-runtime.js"), "utf8"));

  console.log("=== app.js evaluates against the real DOM ===");
  try {
    window.eval(appSource + `
      ;window.__t = {
        state,
        get visibleFileOrder() { return visibleFileOrder; },
        setSelection, clearSelection, cutFiles, pasteIntoFolder,
        canDropOnFolder, closeContextMenu, beginInlineRename, notify, setStatus,
        revealFolderInTree, folderPathIds, openDocument,
        renderSuperSearchPanel, applyThemePreference, themePreference,
        activeThemeName, enterModalLayer, exitModalLayer, showTooltip,
        hideTooltip, syncFilterChip, SUPERSEARCH_LIMIT,
        applySession, refreshSession, can, openLoginModal, closeLoginModal,
        openPasswordModal, closePasswordModal, openShareModal, closeShareModal,
        updateShareButton, applyInitialFolderCollapse, persistCollapsedFolders,
        buildDocContextItems, buildFolderContextItems, canDropOnFolder,
        deleteFiles, switchViewMode, resolveConfirmDialog, requestJson, refreshDocs,
        uploadFolder, isUploadableFile, startNewDocument, closeContextMenu, closeEditor,
        renderLinks, syncModeUI, openLinkModal, closeLinkModal, refreshLinks, submitLink,
        syncEditorTabs, selectEditorTab, openEditor,
        startPageEdit, savePageEdit, cancelPageEdit, collectPageMarkdown,
        openSourceFromPageEdit, isPageEditDirty, pageEditActive, applyVisualCommand
      };
    `);
    check("no exception on load", true, true);
  } catch (error) {
    check(`no exception on load (${error.message})`, false, true);
    console.log(error.stack.split("\n").slice(0, 6).join("\n"));
    process.exit(1);
  }


  // Let the init fetches settle.
  await new Promise((r) => setTimeout(r, 1500));

  const doc = window.document;

  console.log("=== startup is quiet ===");
  check("loading the app raises no toast on its own", doc.querySelectorAll(".toast").length, 0);

  console.log("=== the tree renders from the seeded corpus ===");
  const groups = doc.querySelectorAll(".tree-group");
  const rows = doc.querySelectorAll(".tree-row-doc");
  console.log(`  (${groups.length} folder groups, ${rows.length} file rows)`);
  check("folder groups rendered", groups.length > 0, true);
  check("file rows rendered", rows.length > 0, true);
  check("every file row carries its filename", [...rows].every((r) => r.dataset.file), true);
  check("every file row has exactly one label", [...rows].every((r) => r.querySelectorAll(".tree-label").length === 1), true);
  check("every file row has hover actions", [...rows].every((r) => r.querySelector(".tree-actions")), true);
  check("file rows are draggable", [...rows].every((r) => r.getAttribute("draggable") === "true"), true);
  check("folder rows carry a caret", [...groups].every((g) => g.querySelector(".tree-caret")), true);
  check("folder rows show a count", [...groups].every((g) => /^\d+$/.test(g.querySelector(".tree-count").textContent)), true);
  check("no fat card markup survives", doc.querySelectorAll(".doc-item, .tag-chip, .doc-row").length, 0);

  console.log("=== icons are all Phosphor ===");
  const icons = [...doc.querySelectorAll("i")];
  const bad = icons.filter((i) => !i.className.split(/\s+/).some((c) => /^ph-/.test(c)));
  check(`every <i> names a ph-* glyph (${icons.length} icons)`, bad.map((i) => i.className), []);
  check("no Font Awesome left in the DOM", doc.body.innerHTML.includes("fa-"), false);

  console.log("=== tree interactions ===");
  const emptyMarkers = doc.querySelectorAll(".tree-children .tree-empty");
  console.log(`  (${emptyMarkers.length} folders rendered as empty)`);
  check("empty folders are visible rather than silently dropped", emptyMarkers.length > 0, true);

  const moreBtn = doc.querySelector(".tree-more");
  const pagingExpected = doc.querySelectorAll(".tree-row-doc").length >= 50;
  if (pagingExpected) {
    check("a paged folder offers 'show more'", Boolean(moreBtn), true);
  } else {
    console.log("  SKIP  paging (corpus smaller than one page)");
  }
  if (moreBtn && pagingExpected) {
    const before = doc.querySelectorAll(".tree-row-doc").length;
    moreBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const after = doc.querySelectorAll(".tree-row-doc").length;
    check("clicking it reveals another page", after > before, true);
  }

  // A first visit opens on a closed tree: every folder expanded at once is a
  // wall of files with no structure visible.
  const groupsAll = [...doc.querySelectorAll(".tree-group")];
  check("every folder starts collapsed on a first visit",
    groupsAll.every((g) => g.classList.contains("is-collapsed")), true);
  check("...and that is recorded so a reload does not throw them open again",
    JSON.parse(window.localStorage.getItem("mdviewer.collapsedFolders")).length, groupsAll.length);

  const firstGroup = doc.querySelector(".tree-group");
  const firstFolderBtn = firstGroup.querySelector(".tree-row-folder .tree-row-btn");
  check("aria-expanded says so", firstFolderBtn.getAttribute("aria-expanded"), "false");

  firstFolderBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const expandedGroup = doc.querySelector(".tree-group");
  check("clicking the folder expands it", expandedGroup.classList.contains("is-collapsed"), false);
  check("aria-expanded follows", expandedGroup.querySelector(".tree-row-folder .tree-row-btn").getAttribute("aria-expanded"), "true");
  check("the open folder is dropped from the stored set",
    JSON.parse(window.localStorage.getItem("mdviewer.collapsedFolders")).includes(expandedGroup.dataset.folderKey), false);

  expandedGroup.querySelector(".tree-row-folder .tree-row-btn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  check("clicking again collapses it", doc.querySelector(".tree-group").classList.contains("is-collapsed"), true);

  console.log("=== expand-all / collapse-all ===");
  const collapseAll = doc.getElementById("collapseAllBtn");
  collapseAll.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  check("from a collapsed tree the button expands everything",
    [...doc.querySelectorAll(".tree-group")].every((g) => !g.classList.contains("is-collapsed")), true);
  collapseAll.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  check("and collapses everything again",
    [...doc.querySelectorAll(".tree-group")].every((g) => g.classList.contains("is-collapsed")), true);

  // The Explorer checks below need to see rows, so open the tree back up.
  collapseAll.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  // Explorer behaviour, against the seeded hierarchy.
  {
    const click = (node, init = {}) => node.dispatchEvent(new window.MouseEvent("click", { bubbles: true, ...init }));
    // A document is identified by its path now; the fixture reports where it
    // actually wrote each one, so the tests do not hardcode the tree.
    const D = (name) => server.docPaths[name] || name;
    const rowFor = (file) => doc.querySelector(`.tree-row-doc[data-file="${file}"]`);
    const btnFor = (file) => rowFor(file)?.querySelector(".tree-row-btn");

    console.log("=== nesting renders at depth ===");
    const folderRows = [...doc.querySelectorAll(".tree-row-folder")];
    const depths = folderRows
      .map((r) => Number(r.querySelector(".tree-row-btn").style.getPropertyValue("--depth")))
      .filter((n) => !Number.isNaN(n));
    console.log(`  (folder depths present: ${[...new Set(depths)].sort().join(", ")})`);
    check("more than one nesting level is drawn", new Set(depths).size > 1, true);
    check("a depth-2 folder exists", depths.includes(2), true);

    const cart = folderRows.find((r) => r.querySelector(".tree-label").textContent === "Cart");
    check("nested folder is inside its parent's child list", Boolean(cart?.closest(".tree-children")), true);
    check("nested folder title shows the full path", cart.querySelector(".tree-row-btn").title, "Projects / Cart");
    // A folder's badge counts everything beneath it, not just its own files.
    const cartGroup = cart.closest(".tree-group");
    const parentGroup = cartGroup.parentElement.closest(".tree-group");
    const parentId = parentGroup.dataset.folderKey;
    const expectedDeep = window.eval(`window.__t.state.docs.filter(d =>
      d.folderId && window.__t.folderPathIds(d.folderId).includes(${JSON.stringify(parentId)})).length`);
    check("parent count includes descendants",
      parentGroup.querySelector(".tree-count").textContent, String(expectedDeep));

    console.log("=== multi-select ===");
    click(btnFor(D("delta.md")));
    check("plain click selects one", [...window.eval("window.__t.state.selection")], [D("delta.md")]);

    click(btnFor(D("epsilon.md")), { ctrlKey: true });
    check("ctrl+click adds", [...window.eval("window.__t.state.selection")].sort(), [D("delta.md"), D("epsilon.md")].sort());

    click(btnFor(D("epsilon.md")), { ctrlKey: true });
    check("ctrl+click again removes", [...window.eval("window.__t.state.selection")], [D("delta.md")]);

    window.eval(`window.__t.setSelection([${JSON.stringify(D("delta.md"))}], { anchor: ${JSON.stringify(D("delta.md"))} })`);
    click(btnFor(D("epsilon.md")), { shiftKey: true });
    const range = [...window.eval("window.__t.state.selection")];
    check("shift+click selects a range", range.length >= 2, true);
    check("range includes both ends", range.includes(D("delta.md")) && range.includes(D("epsilon.md")), true);

    window.eval("window.__t.setSelection(window.__t.visibleFileOrder)");
    check("select-all covers every visible file", window.eval("window.__t.state.selection.size") === window.eval("window.__t.visibleFileOrder.length"), true);
    check("selected rows are marked", doc.querySelectorAll(".tree-row-doc.is-selected").length > 0, true);
    check("the count is surfaced", doc.getElementById("selectionMeta").hidden, false);

    window.eval("window.__t.clearSelection()");
    check("clearing empties the selection", window.eval("window.__t.state.selection.size"), 0);
    check("and unmarks the rows", doc.querySelectorAll(".tree-row-doc.is-selected").length, 0);

    console.log("=== cut marks files in flight ===");
    window.eval(`window.__t.setSelection([${JSON.stringify(D("delta.md"))},${JSON.stringify(D("epsilon.md"))}])`);
    window.eval("window.__t.cutFiles([...window.__t.state.selection])");
    check("clipboard holds both", window.eval("window.__t.state.clipboard.files.length"), 2);
    check("mode is cut", window.eval("window.__t.state.clipboard.mode"), "cut");
    check("rows show as cut", doc.querySelectorAll(".tree-row-doc.is-cut").length, 2);

    console.log("=== paste actually moves them ===");
    const notesId = window.eval('window.__t.state.folders.find(f => f.name === "Notes").id');
    await window.eval(`window.__t.pasteIntoFolder(${JSON.stringify(notesId)})`);
    await new Promise((r) => setTimeout(r, 600));
    const movedInto = window.eval(`window.__t.state.docs.filter(d => d.folderId === ${JSON.stringify(notesId)}).map(d => d.file).sort()`);
    check("both files landed in the target folder", [...movedInto].map((f) => f.split("/").pop()).sort(), ["delta.md", "epsilon.md"]);
    check("clipboard is emptied after paste", window.eval("window.__t.state.clipboard.files.length"), 0);

    console.log("=== context menu ===");
    rowFor(D("alpha.md")).dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, clientX: 40, clientY: 40 }));
    const menu = doc.getElementById("contextMenu");
    check("menu opens on right-click", menu.hidden, false);
    const labels = [...menu.querySelectorAll(".context-item span")].map((s) => s.textContent);
    check("it offers the file operations", ["Open", "Cut", "Rename"].every((l) => labels.includes(l)), true);
    check("right-clicking a row selects it", [...window.eval("window.__t.state.selection")], [D("alpha.md")]);
    window.eval("window.__t.closeContextMenu()");
    check("menu closes", menu.hidden, true);

    const cartFolderRow = [...doc.querySelectorAll(".tree-row-folder")]
      .find((r) => r.querySelector(".tree-label").textContent === "Cart");
    cartFolderRow.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, clientX: 40, clientY: 40 }));
    const folderLabels = [...menu.querySelectorAll(".context-item span")].map((s) => s.textContent);
    check("folders offer a subfolder action", folderLabels.includes("New subfolder"), true);
    check("folders offer delete", folderLabels.some((l) => l.startsWith("Delete folder")), true);
    window.eval("window.__t.closeContextMenu()");

    console.log("=== F2 inline rename ===");
    window.eval(`window.__t.beginInlineRename(${JSON.stringify(D("alpha.md"))})`);
    const input = rowFor(D("alpha.md"))?.querySelector(".tree-rename-input");
    check("an input replaces the label", Boolean(input), true);
    // Seeded with the name, not the path: renaming does not move anything.
    check("it is seeded with the filename", input.value, "alpha.md");
    check("the extension is left out of the preselection", input.selectionEnd, "alpha".length);
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await new Promise((r) => setTimeout(r, 100));
    check("escape restores the row", Boolean(rowFor(D("alpha.md"))?.querySelector(".tree-rename-input")), false);

    // And now one that actually goes through. This block only ever opened the
    // box and pressed Escape, so it never noticed that the request sent `name`
    // where the endpoint reads `fileName` — every rename typed into the tree
    // came back "Invalid document file name", and had since the tree was built.
    window.eval(`window.__t.beginInlineRename(${JSON.stringify(D("alpha.md"))})`);
    const committing = rowFor(D("alpha.md")).querySelector(".tree-rename-input");
    committing.value = "alpha-inline.md";
    committing.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));

    const renamedPath = `${D("alpha.md").slice(0, D("alpha.md").lastIndexOf("/") + 1)}alpha-inline.md`;
    check("the rename actually lands", Boolean(rowFor(renamedPath)), true);
    check("...and the old row is gone", Boolean(rowFor(D("alpha.md"))), false);
    check("...and it stayed in its folder",
      window.eval(`window.__t.state.docs.some(d => d.file === ${JSON.stringify(renamedPath)})`), true);

    // Put it back, so everything after this still finds alpha.md.
    window.eval(`window.__t.beginInlineRename(${JSON.stringify(renamedPath)})`);
    const restoring = rowFor(renamedPath).querySelector(".tree-rename-input");
    restoring.value = "alpha.md";
    restoring.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    check("(restored for the checks below)", Boolean(rowFor(D("alpha.md"))), true);

    console.log("=== breadcrumbs ===");
    const nav = doc.getElementById("breadcrumbs");
    check("the breadcrumb nav exists", Boolean(nav), true);
    check("it is labelled for assistive tech", nav.getAttribute("aria-label"), "Location of the open file");

    await window.eval(`window.__t.openDocument(${JSON.stringify(D("alpha.md"))}, false)`);
    await new Promise((r) => setTimeout(r, 500));

    const crumbText = [...nav.querySelectorAll(".crumb")].map((c) => c.textContent.trim() || "…");
    console.log(`  (trail: ${crumbText.join(" > ")})`);
    check("the trail starts at the scope root", crumbText[0], "Files");
    check("the open file is the last crumb", crumbText[crumbText.length - 1], "alpha.md");
    check("the file is marked as current", nav.querySelector(".crumb-current").getAttribute("aria-current"), "page");
    check("the file crumb is not a button", nav.querySelector(".crumb-current").tagName, "SPAN");
    check("ancestors are buttons", [...nav.querySelectorAll("button.crumb")].length > 1, true);
    check("separators sit between crumbs", nav.querySelectorAll(".crumb-sep").length, crumbText.length - 1);

    console.log("=== deep paths collapse rather than pushing the file out ===");
    check("a 6-deep path does not render 8 crumbs", crumbText.length <= 5, true);
    const overflow = nav.querySelector(".crumb-overflow");
    check("middle ancestors fold into an overflow control", Boolean(overflow), true);
    check("the nearest folder stays visible", crumbText.includes("Tokens"), true);
    overflow.dispatchEvent(new window.MouseEvent("click", { bubbles: true, clientX: 20, clientY: 20 }));
    const menuLabels = [...doc.querySelectorAll("#contextMenu .context-item span")].map((s2) => s2.textContent);
    console.log(`  (folded away: ${menuLabels.join(", ")})`);
    check("the folded folders are reachable from it", menuLabels.length > 0, true);
    check("they are the ones missing from the trail", menuLabels.every((l) => !crumbText.includes(l)), true);
    window.eval("window.__t.closeContextMenu()");

    console.log("=== a crumb leads back into the tree ===");
    const tokensId = window.eval('window.__t.state.folders.find(f => f.name === "Tokens").id');
    window.eval(`window.__t.state.collapsedFolderIds.add(${JSON.stringify(tokensId)})`);
    const parents = window.eval(`JSON.stringify(window.__t.folderPathIds(${JSON.stringify(tokensId)}))`);
    JSON.parse(parents).forEach((pid) => window.eval(`window.__t.state.collapsedFolderIds.add(${JSON.stringify(pid)})`));
    window.eval(`window.__t.revealFolderInTree(${JSON.stringify(tokensId)})`);
    check("clicking it expands the whole ancestor chain",
      JSON.parse(parents).every((pid) => !window.eval(`window.__t.state.collapsedFolderIds.has(${JSON.stringify(pid)})`)), true);
    check("and the folder row is rendered", Boolean([...doc.querySelectorAll(".tree-row-folder")].find((r) => r.dataset.folderId === tokensId)), true);

    console.log("=== a top-level file gets a two-crumb trail ===");
    await window.eval(`window.__t.openDocument(${JSON.stringify(D("beta.md"))}, false)`);
    await new Promise((r) => setTimeout(r, 400));
    const shortTrail = [...nav.querySelectorAll(".crumb")].map((c) => c.textContent.trim());
    console.log(`  (trail: ${shortTrail.join(" > ")})`);
    check("root then file, no folder in between", shortTrail, ["Files", "beta.md"]);

    console.log("=== drag guards ===");
    const projectsId = window.eval('window.__t.state.folders.find(f => f.name === "Projects").id');
    const cartId = window.eval('window.__t.state.folders.find(f => f.name === "Cart").id');
    window.eval(`window.__t.state.dragPayload = { type: "folder", folderId: ${JSON.stringify(projectsId)} }`);
    check("a folder cannot be dropped into its own child", window.eval(`window.__t.canDropOnFolder(${JSON.stringify(cartId)})`), false);
    check("a folder cannot be dropped onto itself", window.eval(`window.__t.canDropOnFolder(${JSON.stringify(projectsId)})`), false);
    check("a top-level folder is not offered a top-level drop", window.eval("window.__t.canDropOnFolder(null)"), false);
    window.eval(`window.__t.state.dragPayload = { type: "folder", folderId: ${JSON.stringify(cartId)} }`);
    check("a nested folder can be dropped at the top level", window.eval("window.__t.canDropOnFolder(null)"), true);
    window.eval(`window.__t.state.dragPayload = { type: "files", files: [${JSON.stringify(D("alpha.md"))}] }`);
    // Ask the model where the file actually is rather than assuming a fixture.
    const alphaFolder = window.eval(`window.__t.state.docs.find(d => d.file === ${JSON.stringify(D("alpha.md"))}).folderId`);
    check("a file cannot be dropped where it already lives", window.eval(`window.__t.canDropOnFolder(${JSON.stringify(alphaFolder)})`), false);
    check("but can move elsewhere", window.eval(`window.__t.canDropOnFolder(${JSON.stringify(projectsId)})`), true);
    window.eval("window.__t.state.dragPayload = null");
  }

  // Clear the decks so the toast assertions below measure only what they send.
  doc.querySelectorAll(".toast").forEach((t) => t.remove());
  window.eval("window.__t.state.clipboard = { files: [], mode: null }");

  console.log("=== toasts ===");
  window.eval('window.__t.notify("Saved the thing.", "success")');
  let toasts = doc.querySelectorAll("#toastStack .toast");
  check("a success toast lands in the polite stack", toasts.length, 1);
  check("it carries the message text", toasts[0].querySelector(".toast-message").textContent, "Saved the thing.");
  check("it has a dismiss control", Boolean(toasts[0].querySelector(".toast-close")), true);
  check("it is announced as a status", toasts[0].getAttribute("role"), "status");

  window.eval('window.__t.notify("Disk exploded.", "error")');
  const urgent = doc.querySelectorAll("#toastStackUrgent .toast");
  check("errors go to the assertive stack", urgent.length, 1);
  check("errors are announced as alerts", urgent[0].getAttribute("role"), "alert");

  // Duplicates should replace, not pile up.
  window.eval('window.__t.notify("Saved the thing.", "success")');
  await new Promise((r) => setTimeout(r, 500));
  toasts = doc.querySelectorAll("#toastStack .toast:not(.is-leaving)");
  check("a repeated message does not stack", toasts.length, 1);

  // Overflow trimming.
  for (let i = 0; i < 8; i++) window.eval(`window.__t.notify("message ${i}", "info")`);
  const live = doc.querySelectorAll("#toastStack .toast:not(.is-leaving)");
  check("stack stays bounded", live.length <= 4, true);

  console.log("=== legacy status line is gone ===");
  check("no #statusMsg element", doc.getElementById("statusMsg"), null);
  check("setStatus routes into a toast", window.eval('(() => { const before = document.querySelectorAll(".toast").length; window.__t.setStatus("via setStatus", "success"); return document.querySelectorAll(".toast").length - before; })()'), 1);

  console.log("=== viewer header carries the metadata the chips used to ===");
  check("meta element exists", Boolean(doc.getElementById("activeDocMeta")), true);


  console.log("=== results panel is honest about how much it is showing ===");
  {
    const limit = window.__t.SUPERSEARCH_LIMIT;
    const many = Array.from({ length: limit + 20 }, (_, i) => ({
      file: `res-${i}.md`, originalFile: `res-${i}.md`, title: `Result ${i}`,
      size: 100, updatedAt: "", deletedAt: "", folderId: null, folderName: null,
      folderOrder: 0, icon: "ph-file", snippet: "snippet"
    }));
    doc.getElementById("searchInput").value = "widget";
    window.__t.renderSuperSearchPanel("widget", many, ["widget"]);

    const rows = () => doc.querySelectorAll("#superSearchList .supersearch-item").length;
    check("it renders only the first page", rows(), limit);
    check("the tally says so rather than claiming to show them all",
      doc.getElementById("superSearchCount").textContent, `Showing ${limit} of ${many.length}`);

    const more = doc.querySelector(".supersearch-more");
    check("a show-more control is offered", Boolean(more), true);
    check("it names the remainder", more.textContent.includes(`Show ${many.length - limit} more`), true);

    more.click();
    check("clicking it reveals more rows", rows() > limit, true);
    const shown = rows();

    doc.querySelector(".supersearch-more").click();
    check("and keeps revealing", rows() > shown, true);

    // The reveal must not survive into a different query.
    window.__t.renderSuperSearchPanel("widget", many.slice(0, limit + 3), ["widget"]);
    check("re-rendering the same query keeps the reveal", rows() > limit, true);
    doc.getElementById("searchInput").value = "other";
    window.__t.renderSuperSearchPanel("other", many, ["other"]);
    check("a new query starts over at one page", rows(), limit);

    window.__t.renderSuperSearchPanel("few", many.slice(0, 3), ["few"]);
    check("a short result set gets a plain count",
      doc.getElementById("superSearchCount").textContent, "3 results");
    check("...and no show-more control", doc.querySelector(".supersearch-more"), null);
  }

  console.log("=== the Enter shortcut is signposted ===");
  {
    const hint = doc.getElementById("superSearchHint");
    check("a hint element exists", Boolean(hint), true);
    check("it names the Enter key", hint.textContent.includes("Enter"), true);
    check("and the way out", hint.textContent.includes("Esc"), true);
  }

  console.log("=== the filtered tree says it is filtered ===");
  {
    const chip = doc.getElementById("clearFilterBtn");
    doc.getElementById("searchInput").value = "";
    window.__t.syncFilterChip();
    check("hidden with no query", chip.hidden, true);
    doc.getElementById("searchInput").value = "cart";
    window.__t.syncFilterChip();
    check("shown once a query filters the tree", chip.hidden, false);
    check("it is labelled for assistive tech", Boolean(chip.getAttribute("aria-label")), true);
    doc.getElementById("searchInput").value = "";
    window.__t.syncFilterChip();
  }

  console.log("=== dialogs contain focus and give it back ===");
  {
    const opener = doc.getElementById("createFolderBtn");
    opener.focus();
    const modal = doc.getElementById("folderModal");

    window.__t.enterModalLayer(modal);
    check("the app behind the dialog is inert", doc.getElementById("appShell").inert, true);
    check("the dialog itself is not", modal.inert, false);
    check("toasts stay announceable", doc.getElementById("toastRegion").inert, undefined);

    window.__t.exitModalLayer(modal);
    check("the app is interactive again", doc.getElementById("appShell").inert, false);
    check("focus returns to whatever opened it", doc.activeElement, opener);
  }

  console.log("=== stacked dialogs only free the background once ===");
  {
    const outer = doc.getElementById("editorModal");
    const inner = doc.getElementById("confirmModal");
    window.__t.enterModalLayer(outer);
    window.__t.enterModalLayer(inner);
    check("the dialog underneath goes inert too", outer.inert, true);
    check("only the top one is live", inner.inert, false);

    window.__t.exitModalLayer(inner);
    check("closing the top one revives the one below", outer.inert, false);
    check("but not the whole app", doc.getElementById("appShell").inert, true);

    window.__t.exitModalLayer(outer);
    check("closing the last one frees the app", doc.getElementById("appShell").inert, false);
  }

  console.log("=== the document is not a live region ===");
  {
    check("no aria-live on the article", doc.getElementById("docContent").getAttribute("aria-live"), null);
    check("only the result tally is live",
      doc.getElementById("superSearchCount").getAttribute("aria-live"), "polite");
    check("the panel around it is not",
      doc.getElementById("superSearchPanel").getAttribute("aria-live"), null);
  }

  console.log("=== icon-only controls carry a tooltip ===");
  {
    const btn = doc.getElementById("createFolderBtn");
    window.__t.showTooltip(btn);
    const tip = doc.querySelector(".tooltip");
    check("a tooltip is drawn", Boolean(tip) && tip.hidden === false, true);
    check("it says what the button does", tip.textContent, "New folder");
    check("the native tooltip is suppressed so they cannot double up", btn.getAttribute("title"), null);
    check("the text is kept for next time", btn.dataset.tip, "New folder");
    check("it is hidden from screen readers (aria-label already names it)",
      tip.getAttribute("aria-hidden"), "true");
    check("...which the button has", Boolean(btn.getAttribute("aria-label")), true);

    window.__t.hideTooltip();
    check("it goes away", doc.querySelector(".tooltip").hidden, true);
  }

  console.log("=== theme ===");
  {
    check("starts on the long-standing dark default", window.__t.activeThemeName(), "dark");

    await window.__t.applyThemePreference("light");
    check("switching applies the light attribute", doc.documentElement.dataset.theme, "light");
    check("the preference is recorded", window.__t.themePreference(), "light");
    check("browser chrome follows",
      doc.querySelector('meta[name="theme-color"]').getAttribute("content"), "#f4f8f7");
    check("it is remembered across a reload", window.localStorage.getItem("mdviewer.theme"), "light");

    const toggle = doc.getElementById("themeToggleBtn");
    check("the toggle says where it will go next",
      toggle.getAttribute("aria-label").includes("Switch to"), true);
    check("...and shows the matching icon", toggle.querySelector("i").className.includes("ph-sun"), true);

    await window.__t.applyThemePreference("auto");
    check("auto resolves to a concrete theme",
      ["light", "dark"].includes(doc.documentElement.dataset.theme), true);
    check("but remembers that it is auto", window.__t.themePreference(), "auto");

    await window.__t.applyThemePreference("dark");
    check("and back to dark", doc.documentElement.dataset.theme, "dark");
  }

  console.log("=== the recycle bin shows only deleted things ===");
  {
    const folderCount = window.eval("window.__t.state.folders.length");
    const liveRows = doc.querySelectorAll(".tree-row-doc").length;
    console.log(`  (library: ${folderCount} folders, ${liveRows} rows on screen)`);

    // Delete exactly one document, from a folder several levels deep. The
    // delete asks for confirmation, so answer it the way a click would —
    // awaiting it without that hangs forever.
    const deleting = window.eval(`window.__t.deleteFiles([${JSON.stringify(server.docPaths["paged-000.md"])}], "soft")`);
    await new Promise((r) => setTimeout(r, 150));
    window.eval("window.__t.resolveConfirmDialog(true)");
    await deleting;
    await new Promise((r) => setTimeout(r, 700));

    await window.eval('window.__t.switchViewMode("recycle")');
    await new Promise((r) => setTimeout(r, 900));

    check("the view actually switched", window.eval("window.__t.state.viewMode"), "recycle");
    const binRows = [...doc.querySelectorAll(".tree-row-doc")];
    check("it lists the one deleted document", binRows.length, 1);
    check("...and nothing that is still live",
      binRows.some((r) => r.dataset.file.includes("delta")), false);

    // The whole folder tree used to render here, empty, which made the bin look
    // like it still held the entire library.
    const binFolders = [...doc.querySelectorAll(".tree-row-folder")];
    console.log(`  (folder rows in the bin: ${binFolders.length} of ${folderCount})`);
    check("only folders that contain something are shown", binFolders.length < folderCount, true);
    check("no folder in the bin is empty",
      [...doc.querySelectorAll(".tree-group")].every((g) => g.querySelectorAll(".tree-row-doc").length > 0), true);

    console.log("=== and the archive likewise ===");
    await window.eval('window.__t.switchViewMode("archive")');
    await new Promise((r) => setTimeout(r, 900));
    check("the archive is empty, so it shows no folders at all",
      doc.querySelectorAll(".tree-row-folder").length, 0);
    check("...and no documents", doc.querySelectorAll(".tree-row-doc").length, 0);

    console.log("=== back in the library, empty folders are still welcome ===");
    await window.eval('window.__t.switchViewMode("docs")');
    await new Promise((r) => setTimeout(r, 900));

    // Count real folders only: the Ungrouped bucket also renders as a folder
    // row but is not in state.folders.
    const realFolderRows = () => [...doc.querySelectorAll(".tree-row-folder")]
      .filter((row) => row.dataset.folderId).length;
    check("every folder is rendered again", realFolderRows(), folderCount);

    // An empty folder is somewhere to put things, so the library view keeps it
    // even though the bin does not. Make one, since the cut/paste checks above
    // filled the fixture's only empty folder.
    await window.eval(`window.__t.requestJson("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Deliberately Empty" })
    })`);
    await window.eval("window.__t.refreshDocs({ preserveSearch: false })");
    await new Promise((r) => setTimeout(r, 700));

    check("a folder with nothing in it still renders", realFolderRows(), folderCount + 1);
    check("...and says it is empty rather than vanishing",
      doc.querySelectorAll(".tree-children .tree-empty").length > 0, true);
  }

  console.log("=== notebooks can run Python, but only when asked ===");
  {
    const notebook = JSON.stringify({
      metadata: { kernelspec: { language: "python", name: "python3" } },
      cells: [
        { cell_type: "markdown", source: ["# Runnable\n"] },
        { cell_type: "code", source: ["print('hello')\n"], outputs: [] },
        { cell_type: "code", source: ["   \n"], outputs: [] }
      ]
    });

    const html = window.eval(`MarkdownCore.renderDocumentContent("demo.ipynb", ${JSON.stringify(notebook)}, "Demo")`);
    check("a python cell gets a Run button", html.includes("notebook-run"), true);
    check("...and somewhere to put the output", html.includes("notebook-live-output"), true);
    check("an empty cell gets neither",
      (html.match(/notebook-run"/g) || []).length, 1);
    check("a markdown cell is not runnable",
      /notebook-cell-markdown[\s\S]*?notebook-run/.test(html.split("notebook-cell-code")[0]), false);

    // The original source has to survive to the Run handler; reading it back
    // out of the highlighted DOM would return markup, not code.
    check("the cell source is kept verbatim",
      window.eval("MarkdownCore.notebookSourceFor(2)"), "print('hello')\n");

    const rNotebook = JSON.stringify({
      metadata: { kernelspec: { language: "r" } },
      cells: [{ cell_type: "code", source: ["print(1)\n"] }]
    });
    const rHtml = window.eval(`MarkdownCore.renderDocumentContent("stats.ipynb", ${JSON.stringify(rNotebook)}, "R")`);
    check("a non-python kernel gets no Run button", rHtml.includes("notebook-run"), false);

    console.log("=== nothing runs on its own ===");
    check("opening a notebook starts no worker", window.eval("NotebookRuntime.started"), false);
    check("...and nothing is queued", window.eval("NotebookRuntime.isBusy()"), false);
  }

  console.log("=== the Python runtime is contained ===");
  {
    // Comments stripped: these checks are about what the code does, and the
    // file explains at length what it deliberately does not touch.
    const withoutComments = (text) => text
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^\s*\/\/.*$/gm, " ");

    const worker = withoutComments(fs.readFileSync(path.join(ROOT, "js", "pyodide-worker.js"), "utf8"));
    const runtime = withoutComments(fs.readFileSync(path.join(ROOT, "js", "notebook-runtime.js"), "utf8"));

    // Pyodide hands Python the host's JS scope through `import js`. On the main
    // thread that is `window`; in a worker it is the worker scope, with no DOM
    // and nothing the app holds.
    check("Python runs in a worker, not on the page", runtime.includes("new global.Worker("), true);
    check("the worker never touches document", /\bdocument\./.test(worker), false);
    check("...or window", /\bwindow\./.test(worker), false);
    check("...or localStorage", worker.includes("localStorage"), false);

    // Every write endpoint needs the CSRF token, which lives on the main
    // thread. If it were ever posted in, Python could mutate the library.
    check("the CSRF token is never sent to the worker", worker.includes("csrf"), false);
    check("...not by the controller either", /csrf/i.test(runtime), false);

    check("the runtime version is pinned", /PYODIDE_VERSION = "\d+\.\d+\.\d+"/.test(worker), true);
    check("a runaway cell can be escaped by terminating", runtime.includes("worker.terminate()"), true);
    check("...which also fails any cell still waiting",
      /terminate\(\)[\s\S]{0,400}pending\.clear\(\)/.test(runtime), true);

    // ~10MB before a single package. Opening a markdown file must not pay it.
    check("the runtime loads lazily, on the first run",
      runtime.includes("function ensureWorker()"), true);
    // The rule is that the page pulls in no part of the runtime up front, not
    // that the word never appears — a placeholder URL in a dialog mentioning
    // pyodide.org is not a 10MB download.
    const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    check("...and index.html loads no pyodide asset",
      /<(script|link)[^>]*pyodide/i.test(indexHtml), false);
    check("...nor the worker that would fetch it",
      indexHtml.includes("pyodide-worker"), false);

    // A worker scope has no DOM, but it does have the network — and the
    // reader's cookies ride along on a same-origin request. `import js;
    // js.fetch("/api/docs")` read the whole library until this went in.
    check("the worker takes its own network away", worker.includes("installNetworkGuard()"), true);
    check("...after Pyodide has loaded, not before",
      /loadPyodide\([\s\S]{0,200}installNetworkGuard\(\)/.test(worker), true);
    check("...allowing only the package CDN",
      /startsWith\(`\$\{PYODIDE_ORIGIN\}\/`\)/.test(worker), true);
    check("...and closing XHR as well", worker.includes('"XMLHttpRequest"'), true);
    check("...and the streaming transports",
      worker.includes('"WebSocket"') && worker.includes('"EventSource"'), true);
    check("...and importScripts, which would pull in more code",
      /self\.importScripts = \(\) => \{/.test(worker), true);

    // Pyodide's stdout handler belongs to the interpreter, not to a call, so
    // two overlapping runs captured each other's output. They now queue.
    check("runs are serialised", /queue = queue\.then\(\(\) => execute\(message\)\)/.test(worker), true);
    check("...and a failure cannot stall the queue",
      /queue = queue\.then[\s\S]{0,120}\.catch\(/.test(worker), true);
    check("...and the handler is cleared when a run ends",
      /finally \{[\s\S]{0,200}setStdout\(\{\}\)/.test(worker), true);
    check("resetting a namespace also waits its turn",
      /"reset"[\s\S]{0,200}queue = queue\.then\(/.test(worker), true);

    // One `while True: print(x)` should not build a string that freezes the
    // page when it is rendered.
    check("stream output is capped", /MAX_STREAM_CHARS = \d+/.test(worker), true);
    check("...and so is the echoed value", /MAX_RESULT_CHARS = \d+/.test(worker), true);
    check("...and truncation says so", worker.includes("output truncated at"), true);

    // Not a kill — a real computation may take a while — but silence for
    // minutes reads as a hang.
    check("a slow cell is told it is still going", /SLOW_CELL_MS = \d+/.test(runtime), true);
    check("...and the notice is cancelled when the result lands",
      /clearTimeout\(slowTimer\)/.test(runtime), true);

    // Switching documents mid-run used to write the result into a node that
    // had already been thrown away.
    const app = withoutComments(fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8"));
    check("a result is dropped if the document changed",
      /state\.activeFile !== startedFor/.test(app), true);
    check("...or if its output node is gone", /!target\.isConnected/.test(app), true);
  }

  console.log("=== saved links render as cards ===");
  {
    const links = [
      { id: "a1", url: "https://pyodide.org/en/stable/", title: "Pyodide", description: "Python in the browser", siteName: "Pyodide", note: "runtime docs", fetched: true, fetchError: null },
      { id: "b2", url: "https://expressjs.com/", title: "Express", description: "Fast, unopinionated", siteName: "Express", note: "", fetched: true, fetchError: null },
      { id: "c3", url: "https://gone.example/x", title: "gone.example", description: "", siteName: "", note: "", fetched: false, fetchError: "That site could not be read." }
    ];

    window.eval(`window.__t.state.links = ${JSON.stringify(links)}; window.__t.state.viewMode = "links"; window.__t.renderLinks();`);

    const cards = [...doc.querySelectorAll("#linksGrid .link-card")];
    check("one card per link", cards.length, 3);
    check("the title is the link text", cards[0].querySelector(".link-card-title a").textContent, "Pyodide");
    check("...and the description is shown",
      cards[0].querySelector(".link-card-desc").textContent, "Python in the browser");
    check("...and the host, not the whole URL",
      cards[0].querySelector(".link-card-host").textContent, "pyodide.org");
    check("...with the full URL on hover",
      cards[0].querySelector(".link-card-host").title, "https://pyodide.org/en/stable/");
    check("a note is shown when there is one",
      cards[0].querySelector(".link-card-note").textContent, "runtime docs");
    check("...and no empty note element when there is not",
      cards[1].querySelector(".link-card-note"), null);

    // The card is a way out of this app to someone else's site. window.opener
    // would let that site reach back into this page, and a referrer would tell
    // it where the reader came from.
    const anchor = cards[0].querySelector(".link-card-title a");
    check("it opens in a new tab", anchor.getAttribute("target"), "_blank");
    check("...with no opener", anchor.getAttribute("rel").includes("noopener"), true);
    check("...and no referrer", anchor.getAttribute("rel").includes("noreferrer"), true);
    check("...belt and braces on the attribute too", anchor.getAttribute("referrerpolicy"), "no-referrer");

    // A page that could not be read is still worth keeping; the card says so
    // rather than silently showing a bare hostname with no description.
    check("a link whose page could not be read is flagged",
      Boolean(cards[2].querySelector(".link-card-warn")), true);
    check("...with the reason on hover",
      cards[2].querySelector(".link-card-warn").title, "That site could not be read.");
    check("...and a readable one is not", cards[0].querySelector(".link-card-warn"), null);

    check("the count is shown", doc.getElementById("linksCount").textContent, "3 links");
    check("the empty state is hidden while there are cards",
      doc.getElementById("linksEmpty").hidden, true);

    // Titles are set as text, never as markup: they come from a page this app
    // does not control.
    window.eval(`window.__t.state.links = [{ id: "x", url: "https://x.example/", title: "<img src=x onerror=alert(1)>", description: "<script>alert(2)<\\/script>", note: "", fetched: true }]; window.__t.renderLinks();`);
    const hostile = doc.querySelector("#linksGrid .link-card");
    check("a hostile title is text, not markup",
      hostile.querySelector(".link-card-title a").textContent, "<img src=x onerror=alert(1)>");
    check("...and inserts no element", hostile.querySelectorAll("img, script").length, 0);
    check("...and neither does the description",
      hostile.querySelector(".link-card-desc").textContent, "<script>alert(2)</script>");

    window.eval(`window.__t.state.links = ${JSON.stringify(links)}; window.__t.renderLinks();`);

    // Filtering.
    window.eval('window.__t.state.linkFilter = "unopinionated"; window.__t.renderLinks();');
    check("the filter matches the description too",
      [...doc.querySelectorAll("#linksGrid .link-card-title a")].map((a) => a.textContent), ["Express"]);
    check("...and says how many of how many",
      doc.getElementById("linksCount").textContent, "1 of 3");

    window.eval('window.__t.state.linkFilter = "nothing-matches-this"; window.__t.renderLinks();');
    check("no matches shows the empty state", doc.getElementById("linksEmpty").hidden, false);
    check("...saying why", doc.querySelector("#linksEmpty h3").textContent, "Nothing matches");

    window.eval('window.__t.state.linkFilter = ""; window.__t.renderLinks();');
  }

  console.log("=== editing happens on the document itself ===");
  {
    // Prose, a table, a fence and a reference-style link that resolves from a
    // definition at the very bottom — the case that per-block rendering would
    // lose if the definitions were not carried along.
    const source = [
      "# Title",
      "",
      "Some   text here, and a [reference][docs] link.",
      "",
      "| a  | b  |",
      "|----|----|",
      "| 1  | 2  |",
      "",
      "```js",
      "const x = 1;",
      "```",
      "",
      "[docs]: https://example.com/docs",
      ""
    ].join("\n");

    await window.eval(`window.__t.requestJson("/api/docs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: ${JSON.stringify(JSON.stringify({ fileName: "in-place.md", content: source }))}
    })`);

    await window.eval('window.__t.refreshDocs({ openFile: "in-place.md", preserveSearch: false })');
    await new Promise((r) => setTimeout(r, 700));
    check("the document is open for reading",
      window.eval("window.__t.state.activeFile"), "in-place.md");

    await window.eval("window.__t.startPageEdit()");
    await new Promise((r) => setTimeout(r, 300));

    check("the pencil edits in place rather than opening a dialog",
      doc.getElementById("editorModal").classList.contains("open"), false);
    check("the document itself becomes the editing surface",
      doc.getElementById("docContent").classList.contains("doc-editing"), true);
    check("...and it is still the same article element",
      doc.getElementById("docContent").classList.contains("markdown-body"), true);
    check("the edit bar is on show", doc.getElementById("pageEditBar").hidden, false);
    check("...with the formatting toolbar in it",
      Boolean(doc.querySelector("#pageEditBar #visualToolbar")), true);
    check("the bar knows where the sticky toolbar ends",
      /^\d+px$/.test(doc.getElementById("pageEditBar").style.getPropertyValue("--page-edit-top")), true);

    const blocks = [...doc.querySelectorAll("#docContent .ve-block")];
    check("a block per drawn block, blank runs excluded", blocks.length, 5);
    check("prose is editable where it sits",
      blocks.filter((b) => b.getAttribute("contenteditable") === "true").length, 2);

    // The point of the whole exercise: the page still looks like the document,
    // and every part of it is typed into where it sits.
    const table = doc.querySelector("#docContent .ve-table");
    const codeBlock = doc.querySelector("#docContent .ve-code");
    const embeds = blocks.filter((b) => b.classList.contains("ve-embed"));

    check("the table is a table, not a box of markdown", Boolean(table?.querySelector("table")), true);
    check("...and has no source box", table.querySelectorAll("textarea").length, 0);
    check("every cell is editable where it is",
      [...table.querySelectorAll("th, td")].every((c) => c.getAttribute("contenteditable") === "true"), true);
    check("...and there are the right number of them", table.querySelectorAll("th, td").length, 4);
    check("the table carries controls for rows, columns and alignment",
      table.querySelectorAll(".ve-table-tool").length, 7);

    check("the code block is a code block", Boolean(codeBlock?.querySelector("pre code")), true);
    check("...and the code itself is editable",
      ["true", "plaintext-only"].includes(codeBlock.querySelector("pre code").getAttribute("contenteditable")), true);
    check("...holding exactly the code, without the fence",
      codeBlock.querySelector("pre code").textContent, "const x = 1;");
    check("...with the language in a field rather than buried in the source",
      codeBlock.querySelector(".ve-code-language").value, "js");

    // What is left as source is what has no rendering to type into.
    check("only what cannot be typed into stays as source", embeds.length, 1);
    check("...and it is marked rather than left invisible",
      embeds[0].querySelector(".ve-embed-note").textContent, "link definitions");
    check("...and offers its markdown",
      embeds[0].querySelector(".ve-embed-edit").textContent.trim(), "Edit link definitions");

    // Definitions live at the bottom of the file and are used halfway up it, so
    // they are handed to every block that gets rendered on its own.
    const prose = [...doc.querySelectorAll('#docContent .ve-block[contenteditable="true"]')][1];
    check("link definitions travel with each block for rendering",
      prose.textContent.includes("[docs]: https://example.com/docs"), true);

    check("nothing has changed yet", window.eval("window.__t.isPageEditDirty()"), false);
    check("an untouched document comes back byte-for-byte",
      window.eval("window.__t.collectPageMarkdown()"), source);

    // Edit one paragraph; everything else must come back exactly as it was.
    const paragraph = [...doc.querySelectorAll('#docContent .ve-block[contenteditable="true"]')][1];
    paragraph.innerHTML = "<p>Some <strong>text</strong> here.</p>";
    paragraph.dispatchEvent(new window.Event("input", { bubbles: true }));

    check("the bar says there is something to save", doc.getElementById("pageEditState").textContent, "Unsaved changes");

    const edited = window.eval("window.__t.collectPageMarkdown()");
    check("the edited paragraph is rewritten", edited.includes("Some **text** here."), true);
    check("the heading is untouched", edited.startsWith("# Title\n"), true);
    // The irregular padding is the tell: a table nobody touched is emitted
    // exactly as it was found, however it was typed.
    check("the untouched table keeps its own spacing", edited.includes("| 1  | 2  |"), true);
    check("...and its delimiter row", edited.includes("|----|----|"), true);
    check("the untouched fence is untouched", edited.includes("```js\nconst x = 1;\n```"), true);
    check("the link definition is still at the bottom",
      edited.trimEnd().endsWith("[docs]: https://example.com/docs"), true);

    // Typing into a cell. Focus first, exactly as clicking into it would: the
    // controls below act on the cell the cursor is in.
    const cell = table.querySelectorAll("td")[1];
    cell.focus();
    cell.textContent = "two";
    cell.dispatchEvent(new window.Event("input", { bubbles: true }));
    cell.dispatchEvent(new window.Event("focusin", { bubbles: true }));

    const afterCell = window.eval("window.__t.collectPageMarkdown()");
    check("a cell is written back into the table", afterCell.includes("| 1   | two |"), true);
    check("...and the table is a well-formed table again",
      afterCell.includes("| a   | b   |\n| --- | --- |"), true);
    check("...while the fence beside it is still untouched",
      afterCell.includes("```js\nconst x = 1;\n```"), true);

    // Rows and columns, from the controls on the table itself.
    const tool = (label) => table.querySelector(`.ve-table-tool[aria-label="${label}"]`);
    tool("Add row below").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("a row can be added", table.querySelectorAll("tr").length, 3);
    check("...with a cell per column", table.querySelectorAll("tr")[2].children.length, 2);

    tool("Add column to the right").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("a column can be added", table.querySelectorAll("tr")[0].children.length, 3);
    check("...in every row", [...table.querySelectorAll("tr")].every((r) => r.children.length === 3), true);
    check("...and the new cells are editable too",
      [...table.querySelectorAll("th, td")].every((c) => c.getAttribute("contenteditable") === "true"), true);

    const grown = window.eval("window.__t.collectPageMarkdown()");
    check("the grown table is still a table", grown.includes("| a   | b   |     |"), true);
    check("...with a delimiter cell for the new column",
      grown.includes("| --- | --- | --- |"), true);
    check("...and the row that was added is in it", grown.includes("\n|     |     |     |\n"), true);

    // Deleting acts on the cell the cursor is in, and leaves the cursor in
    // whatever took its place — so the next control still means "here".
    const headerCells = () => [...table.querySelectorAll("tr")[0].children];
    headerCells()[headerCells().length - 1].focus();
    tool("Delete this column").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("a column can be removed", table.querySelectorAll("tr")[0].children.length, 2);
    check("...the one the cursor was in", headerCells().map((c) => c.textContent).join(","), "a,b");
    check("...and the cursor is still in the table",
      Boolean(doc.activeElement?.closest?.(".ve-table")), true);

    const blankRow = [...table.querySelectorAll("tr")]
      .find((r) => [...r.children].every((c) => c.textContent === ""));
    blankRow.children[0].focus();
    tool("Delete this row").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("a row can be removed", table.querySelectorAll("tr").length, 2);
    check("...the one the cursor was in",
      [...table.querySelectorAll("td")].map((c) => c.textContent).join(","), "1,two");

    // The header row is the table's column names; deleting it would leave
    // something that is not a markdown table at all.
    const header = table.querySelector("th");
    header.focus();
    tool("Delete this row").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("the header row cannot be deleted", table.querySelectorAll("tr").length, 2);

    // Alignment is the one thing about a table a rendering cannot show back, so
    // it is set explicitly and written into the delimiter row.
    table.querySelectorAll("th")[1].focus();
    tool("Centre this column").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const aligned = window.eval("window.__t.collectPageMarkdown()");
    check("alignment reaches the delimiter row", aligned.includes("| --- | :-: |"), true);
    check("...and the cells are drawn with it",
      table.querySelectorAll("td")[1].style.textAlign, "center");

    // Typing into the code block.
    const codeText = codeBlock.querySelector("pre code");
    codeText.textContent = "const x = 2;";
    codeText.dispatchEvent(new window.Event("input", { bubbles: true }));
    check("code is written back inside its own fence",
      window.eval("window.__t.collectPageMarkdown()").includes("```js\nconst x = 2;\n```"), true);

    codeBlock.querySelector(".ve-code-language").value = "ts";
    codeBlock.querySelector(".ve-code-language").dispatchEvent(new window.Event("input", { bubbles: true }));
    check("changing the language rewrites the fence, not the code",
      window.eval("window.__t.collectPageMarkdown()").includes("```ts\nconst x = 2;\n```"), true);

    // Saving writes what is on screen and goes back to reading.
    await window.eval("window.__t.savePageEdit()");
    await new Promise((r) => setTimeout(r, 900));

    check("saving leaves editing mode", window.eval("window.__t.pageEditActive()"), false);
    check("...and takes the bar away", doc.getElementById("pageEditBar").hidden, true);
    check("...and the document reads normally again",
      doc.getElementById("docContent").classList.contains("doc-editing"), false);
    check("no editing wrappers survive in the reading view",
      doc.querySelectorAll("#docContent .ve-block").length, 0);

    const saved = await get("/api/docs/in-place.md");
    const savedText = JSON.parse(saved.body).content;
    check("the paragraph reached the file", savedText.includes("Some **text** here."), true);
    check("the fence reached the file", savedText.includes("const x = 2;"), true);
    // This table was edited, so it was rewritten — as a well-formed table with
    // the alignment that was set on it, rather than as whatever the cells
    // happened to serialize to.
    check("the edited table reached the file as a table",
      savedText.includes("| a   | b   |\n| --- | :-: |\n| 1   | two |"), true);
    check("and so did the heading", savedText.startsWith("# Title\n"), true);

    // Cancelling with edits asks first, and restores what is on disk.
    await window.eval("window.__t.startPageEdit()");
    await new Promise((r) => setTimeout(r, 300));
    const heading = doc.querySelector('#docContent .ve-block[contenteditable="true"]');
    heading.innerHTML = "<h1>Renamed</h1>";
    heading.dispatchEvent(new window.Event("input", { bubbles: true }));

    const cancelling = window.eval("window.__t.cancelPageEdit()");
    await new Promise((r) => setTimeout(r, 100));
    check("cancelling with unsaved edits asks first",
      doc.getElementById("confirmModal").classList.contains("open"), true);
    window.eval("window.__t.resolveConfirmDialog(false)");
    await cancelling;
    check("saying no leaves you editing", window.eval("window.__t.pageEditActive()"), true);
    check("...with the edit still there",
      window.eval("window.__t.collectPageMarkdown()").includes("# Renamed"), true);

    const discarding = window.eval("window.__t.cancelPageEdit()");
    await new Promise((r) => setTimeout(r, 100));
    window.eval("window.__t.resolveConfirmDialog(true)");
    await discarding;
    await new Promise((r) => setTimeout(r, 300));
    check("discarding goes back to reading", window.eval("window.__t.pageEditActive()"), false);
    check("...and the discarded edit is gone",
      doc.getElementById("docContent").innerHTML.includes("Renamed"), false);
    check("...leaving the document on screen, rendered as it always was",
      doc.getElementById("docContent").textContent.includes("Title"), true);
    check("...through the ordinary render path, with no block wrappers",
      doc.querySelectorAll("#docContent .ve-block").length, 0);

    // Handing off to the source editor carries the edits with it.
    await window.eval("window.__t.startPageEdit()");
    await new Promise((r) => setTimeout(r, 300));
    const para2 = [...doc.querySelectorAll('#docContent .ve-block[contenteditable="true"]')][1];
    para2.innerHTML = "<p>Carried across.</p>";
    para2.dispatchEvent(new window.Event("input", { bubbles: true }));
    await window.eval("window.__t.openSourceFromPageEdit()");
    await new Promise((r) => setTimeout(r, 300));

    check("the source editor opens", doc.getElementById("editorModal").classList.contains("open"), true);
    check("...holding the edits made on the page",
      doc.getElementById("editorInput").value.includes("Carried across."), true);
    check("...and the page is no longer in editing mode",
      window.eval("window.__t.pageEditActive()"), false);
    check("the dialog has no visual tab of its own",
      doc.querySelectorAll("#editorModal .surface-switch").length, 0);
    window.eval("window.__t.closeEditor()");

    check("the reading view is the one it started as",
      doc.getElementById("docContent").classList.contains("doc-editing"), false);
    check("...with no editing furniture left in it",
      doc.querySelectorAll("#docContent .ve-block, #docContent .ve-embed-edit").length, 0);
    check("...and nothing in it is editable",
      doc.querySelectorAll('#docContent [contenteditable="true"]').length, 0);
  }

  console.log("=== what has no editable rendering shows its source and its result ===");
  {
    // Maths has no rendering you can type into — an equation is not its own
    // markup. So it keeps a source box, and the point of this section is that
    // the box is not a blindfold: what you type is drawn back at you.
    const source = [
      "# Sums",
      "",
      "$$",
      "E = mc^2",
      "$$",
      "",
      "After.",
      ""
    ].join("\n");

    await window.eval(`window.__t.requestJson("/api/docs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: ${JSON.stringify(JSON.stringify({ fileName: "sums.md", content: source }))}
    })`);

    await window.eval('window.__t.refreshDocs({ preserveSearch: false })');
    await window.eval('window.__t.openDocument("sums.md", false, { forceReload: true })');
    await new Promise((r) => setTimeout(r, 700));
    check("the maths document is open", window.eval("window.__t.state.activeFile"), "sums.md");

    await window.eval("window.__t.startPageEdit()");
    await new Promise((r) => setTimeout(r, 300));

    const embed = doc.querySelector("#docContent .ve-embed");
    check("maths is a block that keeps its source", Boolean(embed), true);
    check("...shown rendered to begin with, not as markup",
      embed.querySelectorAll(".ve-embed-source").length, 0);
    check("...and it says what it is",
      embed.querySelector(".ve-embed-edit").textContent.trim(), "Edit math");

    embed.querySelector(".ve-embed-edit").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    const area = embed.querySelector(".ve-embed-source");
    const preview = embed.querySelector(".ve-embed-preview");
    // KaTeX is not present here, so what a rendering of maths leaves behind is
    // the placeholder the real markdown-core writes — the TeX, base64 in an
    // attribute, waiting to be typeset. Reading it back is reading the actual
    // render output rather than anything this suite invented.
    const drawnTex = (root) => {
      const node = root.querySelector(".math-block");
      return node ? Buffer.from(node.getAttribute("data-math-tex"), "base64").toString("utf8").trim() : null;
    };

    check("asking for the markdown gives you the markdown", area.value, "$$\nE = mc^2\n$$");
    check("...with the block named above it",
      embed.querySelector(".ve-embed-head").textContent, "math");
    check("...and a preview beside it from the moment it opens", drawnTex(preview), "E = mc^2");

    // The preview is debounced, so it is the wait that proves it redraws
    // rather than the keystroke.
    area.value = "$$\na^2 + b^2 = c^2\n$$";
    area.dispatchEvent(new window.Event("input", { bubbles: true }));
    check("the edit counts immediately", doc.getElementById("pageEditState").textContent, "Unsaved changes");
    check("...and reaches the document immediately",
      window.eval("window.__t.collectPageMarkdown()").includes("a^2 + b^2 = c^2"), true);

    check("the preview waits rather than redrawing on every keystroke",
      drawnTex(preview), "E = mc^2");

    await new Promise((r) => setTimeout(r, 400));
    check("...then catches up with what was typed", drawnTex(preview), "a^2 + b^2 = c^2");

    // Done puts the rendering back where the source box was.
    embed.querySelector(".ve-embed-done").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("Done returns the block to its rendering",
      embed.querySelectorAll(".ve-embed-source").length, 0);
    check("...showing the new maths, not the old",
      drawnTex(embed.querySelector(".ve-embed-view")), "a^2 + b^2 = c^2");
    check("...and offers the source again",
      Boolean(embed.querySelector(".ve-embed-edit")), true);
    check("the edit survives closing the box",
      window.eval("window.__t.collectPageMarkdown()").includes("a^2 + b^2 = c^2"), true);
    check("...and the prose around it is untouched",
      window.eval("window.__t.collectPageMarkdown()").endsWith("After.\n"), true);

    await window.eval("window.__t.savePageEdit()");
    await new Promise((r) => setTimeout(r, 900));
    const savedSums = JSON.parse((await get("/api/docs/sums.md")).body).content;
    check("the equation reached the file", savedSums.includes("$$\na^2 + b^2 = c^2\n$$"), true);
    check("...and the heading is as it was", savedSums.startsWith("# Sums\n"), true);
  }

  console.log("=== the editor tabs show one pane at a time ===");
  {
    // jsdom's matchMedia always reports false, so the breakpoint is driven
    // directly. That is the honest thing to drive anyway: the question is what
    // the client does once the query matches, not whether jsdom can evaluate a
    // media query.
    const realMatchMedia = window.matchMedia;
    let narrow = false;
    window.matchMedia = () => ({
      get matches() { return narrow; },
      addEventListener() {},
      removeEventListener() {}
    });

    const write = doc.getElementById("editorWritePane");
    const preview = doc.getElementById("editorPreviewPane");
    const writeTab = doc.getElementById("editorTabWrite");
    const previewTab = doc.getElementById("editorTabPreview");

    narrow = false;
    window.eval("window.__t.syncEditorTabs()");
    check("on a wide screen both panes are shown", [write.hidden, preview.hidden], [false, false]);

    narrow = true;
    window.eval("window.__t.syncEditorTabs()");
    check("on a narrow one only Write is", [write.hidden, preview.hidden], [false, true]);
    check("...and the tab says so", writeTab.getAttribute("aria-selected"), "true");
    check("...while the other does not", previewTab.getAttribute("aria-selected"), "false");
    // One tab in the tab order, arrows move between them — how a tablist works.
    check("only the selected tab is in the tab order",
      [writeTab.tabIndex, previewTab.tabIndex], [0, -1]);

    previewTab.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("tapping Preview swaps them", [write.hidden, preview.hidden], [true, false]);
    check("...and moves the selection", previewTab.getAttribute("aria-selected"), "true");

    // An arrow key on the tab bar goes back.
    doc.getElementById("editorTabs").dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    check("an arrow key moves between tabs", [write.hidden, preview.hidden], [false, true]);

    // The failure this prevents: a pane left hidden with no tab bar on screen
    // to bring it back.
    previewTab.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    narrow = false;
    window.eval("window.__t.syncEditorTabs()");
    check("widening past the breakpoint restores both panes",
      [write.hidden, preview.hidden], [false, false]);

    // Opening the editor always lands on Write; nobody opens an editor to read.
    narrow = true;
    window.eval('window.__t.state.editorTab = "preview"');
    window.eval('window.__t.openEditor({ mode: "create", fileName: "", content: "# x" })');
    check("the editor opens on Write", window.eval("window.__t.state.editorTab"), "write");
    check("...whatever tab was left selected last time", [write.hidden, preview.hidden], [false, true]);
    window.eval("window.__t.closeEditor()");

    window.matchMedia = realMatchMedia;
    window.eval("window.__t.syncEditorTabs()");
  }

  console.log("=== links can be grouped ===");
  {
    const grouped = [
      { id: "g1", url: "https://osu.ppy.sh/", title: "osu!", description: "", note: "", groups: ["osu", "games"], fetched: true },
      { id: "g2", url: "https://docs.render.azaken.com/", title: "OsuRender API", description: "", note: "", groups: ["osu", "APIs"], fetched: true },
      { id: "g3", url: "https://expressjs.com/", title: "Express", description: "", note: "", groups: ["APIs"], fetched: true },
      { id: "g4", url: "https://example.com/", title: "Loose", description: "", note: "", groups: [], fetched: true }
    ];

    window.eval(`window.__t.state.links = ${JSON.stringify(grouped)}; window.__t.state.linkGroupFilter = null; window.__t.state.linkFilter = ""; window.__t.state.viewMode = "links"; window.__t.renderLinks();`);

    const chipLabels = () => [...doc.querySelectorAll("#linksGroups .group-chip")]
      .map((chip) => chip.textContent.replace(/(\D)(\d+)$/, "$1 $2").trim());

    check("a chip per group, plus All and Ungrouped",
      chipLabels(), ["All 4", "APIs 2", "games 1", "osu 2", "Ungrouped 1"]);
    check("All and Ungrouped are not mistaken for group names",
      doc.querySelectorAll("#linksGroups .group-chip[data-group]").length, 3);

    // Alphabetical regardless of case, so the bar does not reorder itself as
    // groups are added.
    check("chips are in a stable order",
      [...doc.querySelectorAll("#linksGroups .group-chip[data-group]")].map((c) => c.dataset.group),
      ["APIs", "games", "osu"]);

    // "All" and "Ungrouped" are not group names, so they carry their own
    // attributes rather than an empty data-group that would collide.
    const findChip = (selector) => doc.querySelector(`#linksGroups .group-chip${selector}`);
    const clickChip = (selector) => {
      const chip = findChip(selector);
      chip.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      return chip;
    };

    clickChip('[data-group="osu"]');
    check("selecting a group filters the grid",
      [...doc.querySelectorAll("#linksGrid .link-card-title a")].map((a) => a.textContent),
      ["osu!", "OsuRender API"]);
    check("...and the chip says it is selected",
      findChip('[data-group="osu"]').getAttribute("aria-pressed"), "true");
    check("...and the count reflects it", doc.getElementById("linksCount").textContent, "2 of 4");

    // Clicking the selected chip again is the way back out; a filter you cannot
    // clear from the thing that set it is a trap.
    clickChip('[data-group="osu"]');
    check("clicking it again clears the filter",
      doc.querySelectorAll("#linksGrid .link-card").length, 4);

    clickChip("[data-group-none]");
    check("Ungrouped shows only the unfiled",
      [...doc.querySelectorAll("#linksGrid .link-card-title a")].map((a) => a.textContent), ["Loose"]);

    clickChip("[data-group-none]");

    // A group with two links in it is one chip, not two.
    check("a link in several groups shows all of them",
      [...doc.querySelectorAll('#linksGrid .link-card[data-id="g2"] .link-card-group')].map((c) => c.textContent),
      ["osu", "APIs"]);

    // Clicking a chip on a card is the fastest way to see everything beside it.
    doc.querySelector('#linksGrid .link-card[data-id="g3"] .link-card-group')
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("a chip on a card filters to that group",
      [...doc.querySelectorAll("#linksGrid .link-card-title a")].map((a) => a.textContent),
      ["OsuRender API", "Express"]);
    clickChip('[data-group="APIs"]');

    // The text filter searches group names too, so a group can be found by
    // typing rather than by hunting along the chip bar.
    window.eval('window.__t.state.linkFilter = "games"; window.__t.renderLinks();');
    check("the text filter matches a group name",
      [...doc.querySelectorAll("#linksGrid .link-card-title a")].map((a) => a.textContent), ["osu!"]);
    window.eval('window.__t.state.linkFilter = ""; window.__t.renderLinks();');

    // The add dialog offers what already exists, and pre-fills the group you
    // are looking at, since adding while filtered almost always means "here".
    clickChip('[data-group="osu"]');
    window.eval("window.__t.openLinkModal()");
    check("the dialog pre-fills the selected group",
      doc.getElementById("linkGroupsInput").value, "osu");
    check("...and offers the existing groups",
      [...doc.querySelectorAll("#linkGroupOptions option")].map((o) => o.value), ["APIs", "games", "osu"]);
    window.eval("window.__t.closeLinkModal()");
    clickChip('[data-group="osu"]');

    // With nothing filed there is nothing to filter by, and a lone "All" chip
    // is a control that does nothing.
    window.eval('window.__t.state.links = [{ id: "z", url: "https://x.example/", title: "Z", groups: [], fetched: true }]; window.__t.renderLinks();');
    check("no chip bar when nothing is grouped",
      doc.querySelectorAll("#linksGroups .group-chip").length, 0);

    window.eval(`window.__t.state.links = ${JSON.stringify(grouped)}; window.__t.renderLinks();`);
  }

  console.log("=== a card can be filed by dragging it onto a group ===");
  {
    const card = doc.querySelector('#linksGrid .link-card[data-id="g4"]');
    check("cards are draggable", card.getAttribute("draggable"), "true");

    const transfer = { effectAllowed: "", dropEffect: "", data: {}, setData(k, v) { this.data[k] = v; } };
    card.dispatchEvent(Object.assign(new window.Event("dragstart", { bubbles: true }), { dataTransfer: transfer }));
    check("the drag knows which card it is", window.eval("window.__t.state.linkDragId"), "g4");
    check("...and puts the URL on the transfer, which some browsers require",
      transfer.data["text/plain"], "https://example.com/");

    const chip = doc.querySelector('#linksGroups .group-chip[data-group="osu"]');
    chip.dispatchEvent(Object.assign(new window.Event("dragover", { bubbles: true, cancelable: true }), { dataTransfer: transfer }));
    check("the chip says it will take the drop", chip.classList.contains("drop-target"), true);

    chip.dispatchEvent(Object.assign(new window.Event("drop", { bubbles: true, cancelable: true }), { dataTransfer: transfer }));
    await new Promise((r) => setTimeout(r, 120));
    check("...and stops saying so afterwards", chip.classList.contains("drop-target"), false);

    // The PATCH goes to a link id the fixture server has never heard of, so the
    // request fails and the card is put back rather than left showing a group
    // the server never accepted.
    check("a refused drop does not leave the card looking filed",
      window.eval('(window.__t.state.links.find(l => l.id === "g4").groups || []).length'), 0);

    card.dispatchEvent(new window.Event("dragend", { bubbles: true }));
    check("the drag is cleared when it ends", window.eval("window.__t.state.linkDragId"), null);
  }

  console.log("=== a viewer cannot file anything ===");
  {
    window.eval('window.__t.applySession({ authenticated: true, user: { username: "r", role: "viewer" }, permissions: ["doc:read"], csrfToken: "t" });');
    window.eval("window.__t.renderLinks()");

    check("cards are not draggable", [...doc.querySelectorAll("#linksGrid .link-card")]
      .every((c) => c.getAttribute("draggable") !== "true"), true);
    check("...and offer no group editor",
      doc.querySelectorAll("#linksGrid .link-card-actions").length, 0);
    check("but the chips still filter",
      doc.querySelectorAll("#linksGroups .group-chip").length > 0, true);

    await window.eval("window.__t.refreshSession()");
    await new Promise((r) => setTimeout(r, 200));
    window.eval('window.__t.state.viewMode = "docs"; window.__t.syncModeUI();');
  }

  console.log("=== the add-link form actually sends the URL ===");
  {
    // The bug this exists for: requestJson did not set Content-Type, so
    // express.json() left req.body empty and the server answered "Enter a URL."
    // for a URL that was plainly in the field. Every other caller happened to
    // set the header by hand, so only the newest one was affected.
    //
    // Checked by asking the server to refuse for a *specific* reason. Getting
    // "private network" back proves the address arrived and was parsed; getting
    // "Enter a URL" back would mean it never left.
    doc.getElementById("linkUrlInput").value = "http://127.0.0.1/api/docs";
    doc.getElementById("linkNoteInput").value = "";
    await window.eval("window.__t.submitLink()");

    const message = doc.getElementById("linkError").textContent;
    check("the server saw the address that was typed",
      /private network/i.test(message), true);
    check("...rather than an empty body", /enter a url/i.test(message), false);
    check("the dialog stays open so the address can be corrected",
      doc.getElementById("linkError").hidden, false);

    // And the header itself, since that is the thing that was missing.
    const realFetch = window.fetch;

    const headersUsedBy = async (expression) => {
      const sent = [];
      window.fetch = async (url, options = {}) => {
        sent.push(options);
        return realFetch(url, options);
      };

      try {
        await window.eval(expression).catch(() => {});
      } finally {
        // Restoring a stub this function installed itself; nothing else runs
        // against this window in between.
        // eslint-disable-next-line require-atomic-updates
        window.fetch = realFetch;
      }

      return Object.keys(sent[0]?.headers || {}).map((name) => name.toLowerCase());
    };

    const posted = await headersUsedBy(
      'window.__t.requestJson("/api/links", { method: "POST", body: JSON.stringify({ url: "file:///etc/passwd" }) })');
    check("a JSON body is labelled as JSON", posted.includes("content-type"), true);
    check("...and the CSRF token still rides along", posted.includes("x-csrf-token"), true);

    // A GET has no body and must not claim one.
    const fetched = await headersUsedBy('window.__t.requestJson("/api/links")');
    check("a GET is not labelled as JSON", fetched.includes("content-type"), false);

    doc.getElementById("linkUrlInput").value = "";
    window.eval("window.__t.closeLinkModal()");
  }

  console.log("=== links are a view of their own, not a bin of documents ===");
  {
    // isRecycleBinMode used to be "anything that is not docs", which would have
    // told every caller that this pane held deleted documents.
    check("the links view is not a recycle bin",
      window.eval('window.__t.state.viewMode = "links", window.__t.state.isRecycleBinMode'), false);
    check("...but the recycle bin still is",
      window.eval('window.__t.state.viewMode = "recycle", window.__t.state.isRecycleBinMode'), true);
    check("...and so is the archive",
      window.eval('window.__t.state.viewMode = "archive", window.__t.state.isRecycleBinMode'), true);
    check("...and documents are not",
      window.eval('window.__t.state.viewMode = "docs", window.__t.state.isRecycleBinMode'), false);

    window.eval('window.__t.state.viewMode = "links"; window.__t.syncModeUI();');
    check("the pane is shown", doc.getElementById("linksPane").hidden, false);
    check("...and the document toolbar steps aside", doc.getElementById("viewerToolbar").hidden, true);
    check("...and the sidebar says where you are", doc.getElementById("sidebarTitle").textContent, "Links");

    window.eval('window.__t.state.viewMode = "docs"; window.__t.syncModeUI();');
    check("leaving hides the pane again", doc.getElementById("linksPane").hidden, true);
    check("...and gives the toolbar back", doc.getElementById("viewerToolbar").hidden, false);
  }

  console.log("=== the favicon is a valid document ===");
  {
    // A standalone .svg is served as image/svg+xml and parsed as XML, which is
    // unforgiving in a way HTML is not. This file's comment used to name the
    // CSS tokens it drew from ("--accent"), and a double hyphen inside an XML
    // comment is illegal, so the whole document failed to parse and the icon
    // silently never rendered — in the tab, and on iOS at 180px.
    const svg = fs.readFileSync(path.join(ROOT, "favicon.svg"), "utf8");
    const parsed = new window.DOMParser().parseFromString(svg, "image/svg+xml");
    const error = parsed.querySelector("parsererror");
    check("favicon.svg parses as XML", error ? error.textContent.trim() : null, null);
    check("...and its root is an svg", parsed.documentElement.tagName, "svg");

    // The old icon was a bare pale-teal stroke, which sits at ~1.6:1 on light
    // browser chrome and on the white iOS paints apple-touch-icon onto.
    check("it draws its own ground rather than borrowing the chrome's",
      /<rect[^>]*width="32"[^>]*fill="#0c1214"/.test(svg), true);
  }

  console.log("=== the share page cannot run anything ===");
  {
    const shareHtml = fs.readFileSync(path.join(ROOT, "share.html"), "utf8");
    const shareJs = fs.readFileSync(path.join(ROOT, "js", "share.js"), "utf8");

    check("it does not load the runtime", shareHtml.includes("notebook-runtime"), false);
    check("...nor the worker", shareHtml.includes("pyodide"), false);
    check("...and never enables executable cells",
      shareJs.includes("executableNotebooks"), false);

    // The core defaults to off, so forgetting to configure it fails safe.
    const core = fs.readFileSync(path.join(ROOT, "js", "markdown-core.js"), "utf8");
    check("the default is off", /executableNotebooks: false/.test(core), true);
  }

  console.log("=== uploading a folder ===");
  {
    check("the upload button opens a menu", doc.getElementById("uploadMenu") !== null, true);
    check("...offering a file", doc.getElementById("uploadFilesItem").textContent.includes("file"), true);
    check("...and a folder", doc.getElementById("uploadFolderItem").textContent.includes("folder"), true);

    const picker = doc.getElementById("uploadFolderInput");
    check("a directory picker exists", Boolean(picker), true);
    // webkitdirectory is what makes the OS dialog select folders; without it
    // this is just another file input.
    check("...that actually picks directories", picker.hasAttribute("webkitdirectory"), true);
    check("...and accepts more than one file", picker.hasAttribute("multiple"), true);

    // A folder from disk is full of things this app cannot render. Dropping
    // them here rather than at the server saves uploading them at all.
    const makeFile = (relativePath) => {
      const file = new window.File(["# doc\n"], relativePath.split("/").pop(), { type: "text/markdown" });
      Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
      return file;
    };

    const picked = [
      makeFile("Trip/notes.md"),
      makeFile("Trip/photos/beach.png"),
      makeFile("Trip/.DS_Store"),
      makeFile("Trip/2026/plan.markdown"),
      makeFile("Trip/data.ipynb")
    ];

    let sent = null;
    const realFetch = window.fetch;
    window.fetch = async (url, options = {}) => {
      if (String(url).includes("/api/upload/folder")) {
        sent = options.body;
        return {
          status: 201,
          ok: true,
          async json() {
            return {
              uploaded: [], foldersCreated: [], skipped: [],
              counts: { uploaded: 3, foldersCreated: 2, skipped: 0 }
            };
          }
        };
      }
      return realFetch(url, options);
    };

    window.__pickedFiles = picked;
    await window.eval("window.__t.uploadFolder(window.__pickedFiles)");
    await new Promise((r) => setTimeout(r, 400));
    // Test scaffolding restoring its own stub; single-threaded here.
    // eslint-disable-next-line require-atomic-updates
    window.fetch = realFetch;

    check("the request was sent", sent !== null, true);
    const files = sent ? sent.getAll("files") : [];
    check("only the documents were uploaded", files.length, 3);
    check("the image was left behind",
      files.some((f) => f.name.endsWith(".png")), false);
    check("...and so was .DS_Store",
      files.some((f) => f.name === ".DS_Store"), false);

    const paths = sent ? JSON.parse(sent.get("paths")) : [];
    check("a path accompanies every file", paths.length, files.length);
    check("...carrying the folder structure", paths.includes("Trip/2026/plan.markdown"), true);
    check("...and only for files that were sent", paths.some((p) => p.endsWith(".png")), false);
  }

  console.log("=== a viewer sees no write controls ===");
  {
    const asRole = (role, permissions) => window.eval(`window.__t.applySession(${JSON.stringify({
      authenticated: true,
      publicReads: false,
      user: { id: "u1", username: "reader", role, mustChangePassword: false },
      permissions,
      csrfToken: "test-csrf"
    })})`);

    asRole("viewer", ["doc:read"]);
    await new Promise((r) => setTimeout(r, 60));

    // Hidden, not merely disabled: a control that can never become usable for
    // this account is clutter.
    const hidden = (id) => doc.getElementById(id)?.hidden;

    // The menu on the empty area below the rows is built in an event handler
    // rather than a function, so it is read back off the DOM it renders into.
    const emptySpaceMenuLabels = () => {
      const list = doc.getElementById("docList");
      const event = new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      list.dispatchEvent(event);
      const labels = [...doc.getElementById("contextMenu").querySelectorAll(".context-item span")]
        .map((span) => span.textContent);
      window.eval("window.__t.closeContextMenu()");
      return labels;
    };
    for (const id of ["newDocBtn", "uploadTrigger", "editDocBtn", "createFolderBtn",
      "editCurrentDocBtn", "softDeleteDocBtn", "hardDeleteDocBtn",
      "dockNew", "dockUpload", "dockEdit", "shareDocBtn"]) {
      check(`  ${id} is hidden`, hidden(id), true);
    }

    check("the accounts menu item is hidden", doc.getElementById("manageUsersItem").hidden, true);
    check("no row offers Edit/Rename/Delete",
      doc.querySelectorAll(".tree-row-doc .tree-action").length, 0);
    check("no folder offers its actions",
      doc.querySelectorAll(".tree-row-folder .tree-action").length, 0);
    check("rows are not draggable", [...doc.querySelectorAll(".tree-row-doc")]
      .every((r) => r.getAttribute("draggable") !== "true"), true);
    check("a drop is refused outright", window.eval(
      'window.__t.state.dragPayload = { type: "file", files: ["delta.md"] }, window.__t.canDropOnFolder(null)'), false);

    // The context menu should offer what a reader can actually do.
    const readerMenu = window.eval('window.__t.buildDocContextItems({ file: "delta.md" }).map(i => i.label)');
    check("the context menu offers only Open", [...readerMenu], ["Open"]);
    check("...and no folder menu at all",
      window.eval('window.__t.buildFolderContextItems({ id: "f1", name: "X" }).length'), 0);
    check("...and the empty-space menu offers no way to create",
      [...emptySpaceMenuLabels()], ["Select all"]);

    console.log("=== an editor gets them back ===");
    asRole("editor", ["doc:read", "doc:write", "share:manage"]);
    await new Promise((r) => setTimeout(r, 60));

    for (const id of ["newDocBtn", "uploadTrigger", "editDocBtn", "createFolderBtn", "shareDocBtn"]) {
      check(`  ${id} is visible`, hidden(id), false);
    }
    check("rows offer actions again",
      doc.querySelectorAll(".tree-row-doc .tree-action").length > 0, true);
    check("rows are draggable again", [...doc.querySelectorAll(".tree-row-doc")]
      .every((r) => r.getAttribute("draggable") === "true"), true);
    check("the accounts menu item stays hidden for an editor",
      doc.getElementById("manageUsersItem").hidden, true);

    // Creating a document was reachable only from the toolbar; a right-click,
    // which is where you go to act on a place in the tree, offered a folder and
    // a paste and no way to make a file.
    const folderMenu = window.eval('window.__t.buildFolderContextItems({ id: "f1", name: "X" }).map(i => i.label || "-")');
    check("a folder's menu can create a file in it", [...folderMenu].includes("New file"), true);
    check("...and it comes first", [...folderMenu][0], "New file");
    check("the empty-space menu can too", [...emptySpaceMenuLabels()].includes("New file"), true);

    // ...and it lands in the folder that was right-clicked, not in Ungrouped.
    window.eval('window.__t.state.folders = [{ id: "f1", name: "X", order: 0, parentId: null }]');
    window.eval('window.__t.startNewDocument("f1")');
    check("a file made from a folder's menu starts in that folder",
      doc.getElementById("editorFolderSelect").value, "f1");
    window.eval('window.__t.startNewDocument(null)');
    check("...and from the toolbar it starts at the top level",
      doc.getElementById("editorFolderSelect").value, "");
    window.eval('window.__t.startNewDocument("gone")');
    check("...and a folder that no longer exists falls back to the top level",
      doc.getElementById("editorFolderSelect").value, "");
    window.eval("window.__t.closeEditor?.()");

    console.log("=== only an admin is offered account management ===");
    asRole("admin", ["doc:read", "doc:write", "share:manage", "doc:erase", "user:manage"]);
    await new Promise((r) => setTimeout(r, 60));
    check("the accounts menu item appears", doc.getElementById("manageUsersItem").hidden, false);

    // Restore the real session for anything after this.
    await window.eval("window.__t.refreshSession()");
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log("=== a confirmation opens above the dialog that asked for it ===");
  {
    // Every .modal shared one z-index, so the winner was document order — which
    // put the confirm dialog behind the share and accounts dialogs, making
    // "Replace link" and "Delete account" look like they did nothing.
    const css = fs.readFileSync(path.join(ROOT, "css", "app.css"), "utf8");
    const modalZ = Number(css.match(/\.modal \{[^}]*z-index:\s*(\d+)/)[1]);
    const confirmZ = Number(css.match(/#confirmModal \{[^}]*z-index:\s*(\d+)/)[1]);
    check("the confirm dialog stacks above every other dialog", confirmZ > modalZ, true);

    // ...and it must not depend on document order, which is what broke.
    const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    check("(it still sits before the share dialog in the document)",
      html.indexOf('id="confirmModal"') < html.indexOf('id="shareModal"'), true);
  }

  console.log("=== console output ===");
  const realErrors = consoleErrors.filter((e) => !/Could not parse CSS|Not implemented/.test(e));
  check("no errors logged during load", realErrors, []);
}
