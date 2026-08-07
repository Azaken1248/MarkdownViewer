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
const { startTestServer } = require("./helpers/server");

const ROOT = path.join(__dirname, "..", "public");

let failures = 0;
const consoleErrors = [];

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

let ORIGIN = "";

function get(pathname) {
  return new Promise((resolve, reject) => {
    http.get(`${ORIGIN}${pathname}`, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
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

  // Third-party globals the app expects to already be on the page.
  window.marked = {
    setOptions() {},
    parse: (md) => `<p>${String(md).replace(/[<>]/g, "")}</p>`
  };
  window.DOMPurify = { sanitize: (html) => html };
  window.mermaid = { initialize() {}, render: async () => ({ svg: "<svg></svg>" }) };
  window.hljs = { getLanguage: () => null, highlightAuto: (s) => ({ value: s }), highlight: (s) => ({ value: s }) };
  window.katex = { renderToString: (t) => t };
  window.renderMathInElement = () => {};
  window.svgPanZoom = () => ({ destroy() {} });

  // Proxy fetch to the live server so the app sees the real corpus.
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
          headers: { ...(options.headers || {}), "Content-Type": "application/json" }
        }, (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => resolve({ status: res.statusCode, body: data }));
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

  const appSource = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");

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
        hideTooltip, syncFilterChip, SUPERSEARCH_LIMIT
      };
    `);
    check("no exception on load", true, true);
  } catch (error) {
    check(`no exception on load (${error.message})`, false, true);
    console.log(error.stack.split("\n").slice(0, 6).join("\n"));
    process.exit(1);
  }

  // Unlock writes the way a real session does, so the write paths are exercised.
  window.__t.state.writeToken = server.token;
  window.__t.state.canWrite = true;

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

  const firstGroup = doc.querySelector(".tree-group");
  const firstFolderBtn = firstGroup.querySelector(".tree-row-folder .tree-row-btn");
  check("folder starts expanded", firstGroup.classList.contains("is-collapsed"), false);
  firstFolderBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const collapsedGroup = doc.querySelector(".tree-group");
  check("clicking the folder collapses it", collapsedGroup.classList.contains("is-collapsed"), true);
  check("aria-expanded follows", collapsedGroup.querySelector(".tree-row-folder .tree-row-btn").getAttribute("aria-expanded"), "false");
  collapsedGroup.querySelector(".tree-row-folder .tree-row-btn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  check("clicking again expands it", doc.querySelector(".tree-group").classList.contains("is-collapsed"), false);

  console.log("=== collapse-all ===");
  doc.getElementById("collapseAllBtn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  check("every folder collapses", [...doc.querySelectorAll(".tree-group")].every((g) => g.classList.contains("is-collapsed")), true);
  doc.getElementById("collapseAllBtn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  check("and expands again", [...doc.querySelectorAll(".tree-group")].every((g) => !g.classList.contains("is-collapsed")), true);

  // Explorer behaviour, against the seeded hierarchy.
  {
    const click = (node, init = {}) => node.dispatchEvent(new window.MouseEvent("click", { bubbles: true, ...init }));
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
    click(btnFor("delta.md"));
    check("plain click selects one", [...window.eval("window.__t.state.selection")], ["delta.md"]);

    click(btnFor("epsilon.md"), { ctrlKey: true });
    check("ctrl+click adds", [...window.eval("window.__t.state.selection")].sort(), ["delta.md", "epsilon.md"]);

    click(btnFor("epsilon.md"), { ctrlKey: true });
    check("ctrl+click again removes", [...window.eval("window.__t.state.selection")], ["delta.md"]);

    window.eval('window.__t.setSelection(["delta.md"], { anchor: "delta.md" })');
    click(btnFor("epsilon.md"), { shiftKey: true });
    const range = [...window.eval("window.__t.state.selection")];
    check("shift+click selects a range", range.length >= 2, true);
    check("range includes both ends", range.includes("delta.md") && range.includes("epsilon.md"), true);

    window.eval("window.__t.setSelection(window.__t.visibleFileOrder)");
    check("select-all covers every visible file", window.eval("window.__t.state.selection.size") === window.eval("window.__t.visibleFileOrder.length"), true);
    check("selected rows are marked", doc.querySelectorAll(".tree-row-doc.is-selected").length > 0, true);
    check("the count is surfaced", doc.getElementById("selectionMeta").hidden, false);

    window.eval("window.__t.clearSelection()");
    check("clearing empties the selection", window.eval("window.__t.state.selection.size"), 0);
    check("and unmarks the rows", doc.querySelectorAll(".tree-row-doc.is-selected").length, 0);

    console.log("=== cut marks files in flight ===");
    window.eval('window.__t.setSelection(["delta.md","epsilon.md"])');
    window.eval("window.__t.cutFiles([...window.__t.state.selection])");
    check("clipboard holds both", window.eval("window.__t.state.clipboard.files.length"), 2);
    check("mode is cut", window.eval("window.__t.state.clipboard.mode"), "cut");
    check("rows show as cut", doc.querySelectorAll(".tree-row-doc.is-cut").length, 2);

    console.log("=== paste actually moves them ===");
    const notesId = window.eval('window.__t.state.folders.find(f => f.name === "Notes").id');
    await window.eval(`window.__t.pasteIntoFolder(${JSON.stringify(notesId)})`);
    await new Promise((r) => setTimeout(r, 600));
    const movedInto = window.eval(`window.__t.state.docs.filter(d => d.folderId === ${JSON.stringify(notesId)}).map(d => d.file).sort()`);
    check("both files landed in the target folder", [...movedInto], ["delta.md", "epsilon.md"]);
    check("clipboard is emptied after paste", window.eval("window.__t.state.clipboard.files.length"), 0);

    console.log("=== context menu ===");
    rowFor("alpha.md").dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, clientX: 40, clientY: 40 }));
    const menu = doc.getElementById("contextMenu");
    check("menu opens on right-click", menu.hidden, false);
    const labels = [...menu.querySelectorAll(".context-item span")].map((s) => s.textContent);
    check("it offers the file operations", ["Open", "Cut", "Rename"].every((l) => labels.includes(l)), true);
    check("right-clicking a row selects it", [...window.eval("window.__t.state.selection")], ["alpha.md"]);
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
    window.eval('window.__t.beginInlineRename("alpha.md")');
    const input = rowFor("alpha.md")?.querySelector(".tree-rename-input");
    check("an input replaces the label", Boolean(input), true);
    check("it is seeded with the filename", input.value, "alpha.md");
    check("the extension is left out of the preselection", input.selectionEnd, "alpha".length);
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await new Promise((r) => setTimeout(r, 100));
    check("escape restores the row", Boolean(rowFor("alpha.md")?.querySelector(".tree-rename-input")), false);

    console.log("=== breadcrumbs ===");
    const nav = doc.getElementById("breadcrumbs");
    check("the breadcrumb nav exists", Boolean(nav), true);
    check("it is labelled for assistive tech", nav.getAttribute("aria-label"), "Location of the open file");

    await window.eval('window.__t.openDocument("alpha.md", false)');
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
    await window.eval('window.__t.openDocument("beta.md", false)');
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
    window.eval(`window.__t.state.dragPayload = { type: "files", files: ["alpha.md"] }`);
    // Ask the model where the file actually is rather than assuming a fixture.
    const alphaFolder = window.eval('window.__t.state.docs.find(d => d.file === "alpha.md").folderId');
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

  console.log("=== console output ===");
  const realErrors = consoleErrors.filter((e) => !/Could not parse CSS|Not implemented/.test(e));
  check("no errors logged during load", realErrors, []);
}
