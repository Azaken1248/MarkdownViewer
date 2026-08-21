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

// A fixed sleep long enough for a slow machine is a slow suite everywhere else,
// and a fixed sleep short enough to be quick is a flake. Wait for the thing
// itself, and let the check that follows say what it found if it never happens.
async function waitUntil(condition, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
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

  // Nor does it implement object URLs, which is how a pasted picture is shown
  // on the page before its upload finishes.
  let objectUrls = 0;
  window.URL.createObjectURL = () => `blob:${ORIGIN}/${++objectUrls}`;
  window.URL.revokeObjectURL = () => {};

  // jsdom has no layout, so it implements no scrolling. The app only ever uses
  // this to be polite about where it just put something.
  window.Element.prototype.scrollIntoView = function scrollIntoView() {};

  // Third-party globals the app expects to already be on the page.
  //
  // A stand-in for marked. It only has to produce the shapes the editor works
  // on — a table, a code block, a paragraph — because what is under test in
  // this suite is what the editor does with a rendering, not how markdown is
  // parsed. The parsing itself is marked's, and the serializers that read these
  // shapes back are checked against the real library in the visual suite.
  const escape = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // One block at a time. The reading view hands marked a whole document while
  // the editor hands it a single block, so parse() below splits the input first
  // and this renders each piece.
  const renderOneBlock = (md) => {
      const text = String(md);

      if (text.trim() === "") {
        return "";
      }

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

      // GFM task lists, rendered the way marked renders them — the checkbox
      // disabled, which is exactly the default the app has to override.
      if (lines.length > 0 && lines.every((line) => /^\s*([-*+]|\d+[.)])\s/.test(line))) {
        const items = lines.map((line) => {
          const item = line.replace(/^\s*([-*+]|\d+[.)])\s+/, "");
          const task = item.match(/^\[([ xX])\]\s+([\s\S]*)$/);
          return task
            ? `<li><input${task[1] === " " ? "" : " checked=\"\""} disabled="" type="checkbox"> ${escape(task[2])}</li>`
            : `<li>${escape(item)}</li>`;
        }).join("");
        return `<ul>${items}</ul>`;
      }

      // Inline images, because a document that has had one pasted into it has
      // to render as a picture and serialize back out of one.
      const inline = text.replace(/[<>]/g, "")
        .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g,
          (_, alt, src) => `<img src="${escape(src)}" alt="${escape(alt)}">`);

      return `<p>${inline}</p>`;
  };

  window.marked = {
    setOptions() {},
    parse(md) {
      const text = String(md);

      // Chunk with the app's own splitter rather than on blank lines, so a
      // fence containing one is not torn in half. It is loaded by the time any
      // rendering happens; before that there is only ever a single block.
      const split = window.VisualEditor?.splitBlocks;
      if (!split) {
        return renderOneBlock(text);
      }

      return split(text).map((block) => renderOneBlock(block.source)).filter(Boolean).join("\n");
    }
  };
  window.DOMPurify = { sanitize: (html) => html };
  window.mermaid = { initialize() {}, render: async () => ({ svg: "<svg></svg>" }) };
  // Knows one language and genuinely rewrites the markup for it, so the
  // live-highlighting checks below are moving the DOM the caret stands in
  // rather than watching a stub hand the source straight back.
  window.hljs = {
    getLanguage: (name) => (name === "javascript" ? { name } : null),
    highlightAuto: (s) => ({ value: s }),
    highlight: (s) => ({ value: String(s).replace(/\b(const|return)\b/g, '<span class="hljs-keyword">$1</span>') })
  };
  // KaTeX replaces the placeholder's contents with typeset maths and leaves the
  // TeX attribute alone; that is all this suite needs it to do.
  window.katex = {
    renderToString: (t) => t,
    render: (tex, node) => { node.textContent = tex; }
  };
  window.renderMathInElement = () => {};
  window.svgPanZoom = () => ({ destroy() {}, resize() {}, fit() {}, center() {}, updateBBox() {} });

  // jsdom implements no execCommand at all. Enough of insertText to be real —
  // it is how the app inserts into a textarea without wiping the undo stack, so
  // a suite where it always fell through to the fallback would never exercise
  // the path a browser actually takes.
  const execCommands = [];
  window.document.execCommand = (name, _ui, value) => {
    execCommands.push(name);

    if (name !== "insertText") {
      return false;
    }

    const field = window.document.activeElement;
    if (!field || !["TEXTAREA", "INPUT"].includes(field.tagName)) {
      return false;
    }

    const start = field.selectionStart ?? 0;
    const end = field.selectionEnd ?? start;
    field.value = `${field.value.slice(0, start)}${value}${field.value.slice(end)}`;
    const at = start + String(value).length;
    field.setSelectionRange(at, at);
    return true;
  };

  // jsdom builds neither a clipboard nor a secure context, and the app checks
  // for both before it will use the modern path.
  const clipboardWrites = [];
  window.isSecureContext = true;
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: (text) => { clipboardWrites.push(String(text)); return Promise.resolve(); } }
  });

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

  // jsdom's Blob has no arrayBuffer(), so the bytes come out through the one
  // reader it does implement.
  const blobBytes = (blob) => new Promise((resolve, reject) => {
    const reader = new window.FileReader();
    reader.onload = () => resolve(Buffer.from(reader.result));
    reader.onerror = () => reject(reader.error || new Error("Could not read blob"));
    reader.readAsArrayBuffer(blob);
  });

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

    // A FormData body is what the browser turns into a multipart request. The
    // app sends one when attaching an image, so the proxy has to encode it the
    // same way rather than writing "[object FormData]" down the socket.
    let payload = options.body;
    let extraHeaders = {};

    if (payload && typeof payload !== "string" && typeof payload.entries === "function") {
      const boundary = `----domsuite${Math.random().toString(16).slice(2)}`;
      const chunks = [];

      for (const [name, value] of payload.entries()) {
        if (value instanceof window.Blob) {
          chunks.push(Buffer.from(
            `--${boundary}\r\n`
            + `Content-Disposition: form-data; name="${name}"; filename="${value.name || "file"}"\r\n`
            + `Content-Type: ${value.type || "application/octet-stream"}\r\n\r\n`
          ));
          chunks.push(await blobBytes(value));
          chunks.push(Buffer.from("\r\n"));
        } else {
          chunks.push(Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
          ));
        }
      }

      chunks.push(Buffer.from(`--${boundary}--\r\n`));
      payload = Buffer.concat(chunks);
      extraHeaders = {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": payload.length
      };
    }

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
            ...extraHeaders,
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
        if (payload) req.write(payload);
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

  // And the flowchart model the diagram builder is made of, and the drawing it
  // puts on the screen, the same way.
  window.eval(fs.readFileSync(path.join(ROOT, "js", "diagram-model.js"), "utf8"));
  window.eval(fs.readFileSync(path.join(ROOT, "js", "diagram-draw.js"), "utf8"));
  window.eval(fs.readFileSync(path.join(ROOT, "js", "diagram-editor.js"), "utf8"));

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
        deleteFiles, switchViewMode, resolveConfirmDialog, requestConfirmation,
        requestEditorClose, isEditorDirty, requestJson, refreshDocs,
        uploadFolder, isUploadableFile, startNewDocument, closeContextMenu, closeEditor,
        renderLinks, syncModeUI, openLinkModal, closeLinkModal, refreshLinks, submitLink,
        syncEditorTabs, selectEditorTab, openEditor, openEditorForCurrentDoc, saveEditorDocument,
        startPageEdit, savePageEdit, cancelPageEdit, collectPageMarkdown, insertPageBlock,
        undoPageEdit, redoPageEdit, commitPageHistory, pageHistory,
        insertIntoTextarea, replaceInTextarea, toggleMarkdownWrap, applySourceShortcut,
        documentPath, fileFromLocation, showDocumentInUrl,
        goToPlace, viewFromLocation, showLinksInUrl, applySearch, linksNeedingIcons,
        backfillLinkIcons,
        restoreDocumentView, stashSearchQuery, setPlaceBusy, hydrateSearchContent,
        showEmptyState, showLoadingState, updateActiveDocUI,
        openSourceFromPageEdit, isPageEditDirty, pageEditActive, applyVisualCommand,
        stashDocument, takeStashedDocument, diagramStashKey
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
    // A real one-pixel PNG, so the <img> the card builds has something a
    // browser would actually decode rather than a string that happens to
    // start with "data:".
    const PIXEL_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

    const links = [
      { id: "a1", url: "https://pyodide.org/en/stable/", title: "Pyodide", description: "Python in the browser", siteName: "Pyodide", note: "runtime docs", fetched: true, fetchError: null },
      { id: "b2", url: "https://expressjs.com/", title: "Express", description: "Fast, unopinionated", siteName: "Express", note: "", icon: PIXEL_PNG, fetched: true, fetchError: null },
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

    // The site's own icon, fetched by the server when the link was saved and
    // carried with it. It has to come off disk: a card that reaches out to the
    // site to draw its icon tells that site every time this page is opened.
    check("a link with an icon shows it",
      cards[1].querySelector(".link-card-head img.link-icon")?.getAttribute("src"), PIXEL_PNG);
    check("...as decoration, not as something to read",
      cards[1].querySelector(".link-card-head img.link-icon").alt, "");
    check("a link without one gets a letter instead",
      cards[0].querySelector(".link-card-head .link-icon-mark")?.textContent, "P");
    check("...and no broken image beside it",
      cards[0].querySelectorAll(".link-card-head img").length, 0);

    // Which links get fetched once, quietly, when the pane opens. Missing and
    // empty are different answers: missing means nobody has ever looked, empty
    // means the page was read and had none. Confusing the two turns a one-off
    // migration into a request per card per visit.
    check("a link saved before icons existed has never been asked",
      window.eval("window.__t.linksNeedingIcons()"), ["a1", "c3"]);

    window.eval('window.__t.state.links = [{ id: "n", url: "https://x.example/", icon: "" }];');
    check("...and one that was asked and had none is not asked again",
      window.eval("window.__t.linksNeedingIcons()"), []);
    window.eval(`window.__t.state.links = ${JSON.stringify(links)};`);
    window.eval("window.__t.renderLinks();");

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

    // Put the app back where it was found. The links are a place with an
    // address of their own now, so an app left standing in them behaves
    // differently — the back button in a later section navigates out of them —
    // and a mode set by hand has to be unset the same way.
    window.eval('window.__t.state.viewMode = "docs"; window.__t.syncModeUI();');
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

    console.log("=== Ctrl+S saves where you stand ===");
    // Pressed mid-sentence, out of habit, it means "write this down" — not "I
    // have finished". Closing the editor on it throws away the caret, the
    // scroll and the undo history of somebody who only wanted their work safe.
    await window.eval("window.__t.startPageEdit()");
    await new Promise((r) => setTimeout(r, 300));

    const inPlace = doc.querySelector('#docContent .ve-block[contenteditable="true"]');
    inPlace.innerHTML = "<h1>Saved In Place</h1>";
    inPlace.dispatchEvent(new window.Event("input", { bubbles: true }));
    window.eval("window.__t.commitPageHistory()");
    const stepsBeforeSave = window.eval("window.__t.pageHistory.past.length");

    const pressSave = () => {
      const event = new window.KeyboardEvent("keydown", {
        key: "s", ctrlKey: true, bubbles: true, cancelable: true
      });
      doc.getElementById("docContent").dispatchEvent(event);
      return event.defaultPrevented;
    };

    check("Ctrl+S is taken by the editor", pressSave(), true);
    await waitUntil(() => window.eval("window.__t.isPageEditDirty()") === false);

    check("...and writes the document",
      JSON.parse((await get("/api/docs/in-place.md")).body).content.includes("# Saved In Place"), true);
    check("...without leaving editing mode", window.eval("window.__t.pageEditActive()"), true);
    // The same node, not a redrawn one: a re-render would take the caret and
    // the scroll with it.
    check("...without redrawing the block being typed into", inPlace.isConnected, true);
    check("...and the bar stays where it was", doc.getElementById("pageEditBar").hidden, false);
    check("nothing is left unsaved to warn about", window.eval("window.__t.isPageEditDirty()"), false);
    check("...and the bar says so", doc.getElementById("pageEditState").textContent, "No changes yet");
    check("undo still reaches back past the save",
      window.eval("window.__t.pageHistory.past.length"), stepsBeforeSave);

    pressSave();
    await new Promise((r) => setTimeout(r, 400));
    check("a second press with nothing to write leaves you editing too",
      window.eval("window.__t.pageEditActive()"), true);

    // The button is the one thing that finishes.
    const finishing = doc.querySelector('#docContent .ve-block[contenteditable="true"]');
    finishing.innerHTML = "<h1>Saved By The Button</h1>";
    finishing.dispatchEvent(new window.Event("input", { bubbles: true }));
    doc.getElementById("pageEditSaveBtn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitUntil(() => window.eval("window.__t.pageEditActive()") === false);
    await new Promise((r) => setTimeout(r, 300));
    check("the Save button is what leaves", window.eval("window.__t.pageEditActive()"), false);
    check("...having written the document too",
      JSON.parse((await get("/api/docs/in-place.md")).body).content.includes("# Saved By The Button"), true);

    console.log("=== leaving with unsaved work offers to keep it ===");
    await window.eval("window.__t.startPageEdit()");
    await new Promise((r) => setTimeout(r, 300));
    const kept = doc.querySelector('#docContent .ve-block[contenteditable="true"]');
    kept.innerHTML = "<h1>Kept On The Way Out</h1>";
    kept.dispatchEvent(new window.Event("input", { bubbles: true }));

    const leaving = window.eval("window.__t.cancelPageEdit()");
    await new Promise((r) => setTimeout(r, 120));
    const altBtn = doc.getElementById("confirmAltBtn");
    check("the way out asks", doc.getElementById("confirmModal").classList.contains("open"), true);
    check("...and offers to save, not only to discard", altBtn.hidden, false);
    // Enter on this dialog must not mean "throw it away".
    check("...with the keeping answer holding the focus", doc.activeElement === altBtn, true);

    window.eval('window.__t.resolveConfirmDialog("alt")');
    const left = await leaving;
    await waitUntil(() => window.eval("window.__t.pageEditActive()") === false);
    check("saying save leaves the editor", left, true);
    check("...and editing really is over", window.eval("window.__t.pageEditActive()"), false);
    check("...having written the work it was told to keep",
      JSON.parse((await get("/api/docs/in-place.md")).body).content.includes("# Kept On The Way Out"), true);

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

  console.log("=== a flowchart is built from its steps, not typed ===");
  {
    // Two diagrams, and the difference between them is the whole safety story:
    // the first is steps and arrows and nothing else, the second has a subgraph
    // in it. A builder that models only steps and arrows must open the one and
    // refuse the other, because writing the second one back would delete the
    // subgraph nobody asked it to touch.
    const source = [
      "# Flow",
      "",
      "```mermaid",
      "flowchart TD",
      "  A[Start] --> B[End]",
      "```",
      "",
      "```mermaid",
      "flowchart TD",
      "  subgraph outer",
      "  C --> D",
      "  end",
      "```",
      "",
      "After.",
      ""
    ].join("\n");

    await window.eval(`window.__t.requestJson("/api/docs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: ${JSON.stringify(JSON.stringify({ fileName: "flow.md", content: source }))}
    })`);

    await window.eval('window.__t.refreshDocs({ preserveSearch: false })');
    await window.eval('window.__t.openDocument("flow.md", false, { forceReload: true })');
    await new Promise((r) => setTimeout(r, 700));
    check("the diagram document is open", window.eval("window.__t.state.activeFile"), "flow.md");

    await window.eval("window.__t.startPageEdit()");
    await new Promise((r) => setTimeout(r, 300));

    const embeds = [...doc.querySelectorAll("#docContent .ve-embed")];
    check("both diagrams are blocks that keep their source", embeds.length, 2);
    check("the one the builder understands offers to build it",
      Boolean(embeds[0].querySelector(".ve-embed-build")), true);
    check("...and the one with a subgraph in it does not",
      Boolean(embeds[1].querySelector(".ve-embed-build")), false);
    check("...which still leaves it editable as markdown",
      embeds[1].querySelector(".ve-embed-edit").textContent.trim(), "Edit code (mermaid)");
    check("a buildable diagram calls its source button by the shorter name",
      embeds[0].querySelector(".ve-embed-source-open").textContent.trim(), "Markdown");

    const embed = embeds[0];
    embed.querySelector(".ve-embed-build").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    const canvas = embed.querySelector(".ve-diagram-canvas");
    const inspector = embed.querySelector(".ve-diagram-inspector");
    const palette = embed.querySelector(".ve-diagram-palette");
    const svg = () => canvas.querySelector("svg");
    const boxes = () => [...canvas.querySelectorAll(".dd-node")].map((g) => g.getAttribute("data-id"));
    const markdown = () => window.eval("window.__t.collectPageMarkdown()");

    check("Build opens a canvas, not a text box", Boolean(canvas), true);
    check("...with no source box in sight", embed.querySelectorAll(".ve-embed-source").length, 0);
    check("...and a place for whatever is selected", Boolean(inspector), true);
    check("...and shapes to drag onto it", palette.querySelectorAll(".ve-diagram-tool").length > 1, true);
    check("nothing is selected to begin with, so it says what to do",
      embed.querySelector(".ve-diagram-hint").textContent, "Tap a box to work on it, or drag one to move it.");

    // The diagram is ours now: a real SVG, drawn from the model, with a group
    // per step that carries the id it stands for. Nothing here waits on Mermaid
    // and nothing here downloads it.
    check("the diagram is drawn rather than rendered", Boolean(svg()), true);
    check("...with a box per step", boxes(), ["A", "B"]);
    check("...and an arrow between them",
      canvas.querySelectorAll(".dd-edge").length, 1);
    check("...on paper that can be dragged into",
      Number(svg().getAttribute("width")) > 200, true);

    // Every gesture is a pointer press, a move and a release. jsdom has no
    // PointerEvent, but an event is dispatched by its name: a MouseEvent named
    // pointerdown reaches a pointerdown listener with the coordinates on it,
    // which is all any of this reads.
    const at = (x, y) => ({ clientX: x, clientY: y, bubbles: true });
    const press = (target, x, y) => target.dispatchEvent(new window.MouseEvent("pointerdown", at(x, y)));
    const move = (x, y) => canvas.dispatchEvent(new window.MouseEvent("pointermove", at(x, y)));
    const release = (x, y) => canvas.dispatchEvent(new window.MouseEvent("pointerup", at(x, y)));

    // jsdom measures nothing, so the SVG reports a zero-sized box and a point on
    // the screen is a point in the diagram. Which is what the builder is for:
    // these are the coordinates the file will hold.
    const box = (id) => {
      const group = canvas.querySelector(`.dd-node[data-id="${id}"]`);
      const found = /translate\(([-\d.]+),([-\d.]+)\)/.exec(group.getAttribute("transform"));
      return [Number(found[1]), Number(found[2])];
    };

    const tap = (id) => {
      const [x, y] = box(id);
      press(canvas.querySelector(`.dd-node[data-id="${id}"]`), x + 10, y + 10);
      release(x + 10, y + 10);
    };

    tap("A");
    check("tapping a box selects it", Boolean(inspector.querySelector(".ve-diagram-selected")), true);
    check("...and offers its name straight away",
      inspector.querySelector(".ve-diagram-text").value, "Start");
    check("...and the arrow it already has",
      inspector.querySelectorAll(".ve-diagram-arrow").length, 1);
    check("...and draws a ring on it, in the diagram rather than over it",
      canvas.querySelectorAll(".dd-marks .dd-ring").length, 1);
    check("...with a handle to resize it by",
      canvas.querySelectorAll('[data-role="resize"]').length, 1);
    check("...and one to draw an arrow from",
      canvas.querySelectorAll('[data-role="connect"]').length, 1);

    // Dragging is the whole point of the layout comments. Nothing else in the
    // file can say where a box is.
    // Dragged by an amount the grid has to round, or the snap would be proved by
    // arithmetic that happened to land on it anyway.
    const beforeDrag = box("A");
    press(canvas.querySelector('.dd-node[data-id="A"]'), beforeDrag[0] + 10, beforeDrag[1] + 10);
    move(beforeDrag[0] + 137, beforeDrag[1] + 73);
    release(beforeDrag[0] + 137, beforeDrag[1] + 73);

    check("dragging a box moves it", box("A"), [beforeDrag[0] + 130, beforeDrag[1] + 60]);
    check("...snapped to the grid it is drawn on", box("A").every((n) => n % 10 === 0), true);
    check("...and the file now says where it is",
      markdown().includes(`%% @ A ${beforeDrag[0] + 130},${beforeDrag[1] + 60} 90x50`), true);
    check("...under a header saying what those lines are",
      markdown().includes("%% layout v1"), true);
    check("...inside a diagram that is still a diagram",
      markdown().includes("flowchart TD\n    %% layout v1"), true);
    check("...and the bar says there is something to save",
      doc.getElementById("pageEditState").textContent, "Unsaved changes");

    // A tap that wobbles is still a tap: below the slop a press and release
    // leaves the box where it is and leaves the drawing alone. The second half
    // of that is the half that matters — a redraw on every tap is a diagram
    // that flickers under the finger.
    const steady = box("B");
    tap("B");
    const untouched = svg();
    press(canvas.querySelector('.dd-node[data-id="B"]'), steady[0] + 10, steady[1] + 10);
    move(steady[0] + 13, steady[1] + 12);
    release(steady[0] + 13, steady[1] + 12);
    check("a tap that wobbles does not move the box", box("B"), steady);
    check("...or redraw the diagram under the finger", svg() === untouched, true);

    // The same move, without a pointing device. The ring is drawn in the
    // diagram's own coordinates and slid along with the box during a drag, so a
    // move with no drag behind it has to leave it somewhere real rather than at
    // an offset from a drag that never started.
    const nudged = box("B");
    const nudge = () => canvas.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    // Dragging snaps and an arrow key does not, which is the whole reason to
    // reach for one: the grid has put something a few pixels from where you
    // want it, and only an arrow key can say so.
    nudge();
    check("an arrow key moves the selected box by one pixel",
      box("B"), [nudged[0] + 1, nudged[1]]);

    // And again once the redraw has caught up, which is the case that matters:
    // these marks were drawn fresh, with no drag behind them to measure from.
    await new Promise((r) => setTimeout(r, 400));
    nudge();
    check("...and again after it has been redrawn", box("B"), [nudged[0] + 2, nudged[1]]);

    // Shift is the coarse one, and it lands on the grid rather than a step away
    // from wherever those two pixels left the box.
    canvas.dispatchEvent(new window.KeyboardEvent("keydown",
      { key: "ArrowRight", shiftKey: true, bubbles: true }));
    check("...while shift moves it a whole grid step, onto the grid",
      box("B"), [nudged[0] + 10, nudged[1]]);
    check("...leaving the ring somewhere on the paper",
      /NaN/.test(canvas.querySelector(".dd-marks").getAttribute("transform") || ""), false);

    // The corner drags the box bigger. It never shrinks on its own afterwards.
    tap("B");
    const grip = canvas.querySelector('[data-role="resize"]');
    press(grip, steady[0] + 90, steady[1] + 50);
    move(steady[0] + 190, steady[1] + 100);
    release(steady[0] + 190, steady[1] + 100);
    check("the corner resizes the box", markdown().includes("%% @ B "), true);
    check("...to the size it was dragged to",
      /%% @ B [-\d]+,[-\d]+ 190x100/.test(markdown()), true);

    // Renaming, which is the one thing that waits: a redraw on every keystroke
    // is a redraw nobody asked for.
    tap("A");
    const name = inspector.querySelector(".ve-diagram-text");
    name.value = "Begin";
    name.dispatchEvent(new window.Event("input", { bubbles: true }));

    check("renaming a step reaches the document immediately",
      markdown().includes("A[Begin]"), true);
    check("the diagram waits rather than redrawing on every keystroke",
      canvas.querySelector('.dd-node[data-id="A"]').textContent.includes("Begin"), false);

    await new Promise((r) => setTimeout(r, 400));
    check("...then catches up with what was typed",
      canvas.querySelector('.dd-node[data-id="A"]').textContent.includes("Begin"), true);

    // The circle on the edge of the selected box, dragged onto another box, is
    // an arrow. Let go of it on empty paper and it is a new box instead,
    // already joined — the gesture a flowchart is actually built with.
    tap("A");
    const arrowsIn = () => canvas.querySelectorAll(".dd-edge").length;
    const before = arrowsIn();
    const spot = box("A");
    const target = box("B");
    press(canvas.querySelector('[data-role="connect"]'), spot[0] + 100, spot[1] + 25);
    move(target[0] + 40, target[1] + 40);
    release(target[0] + 40, target[1] + 40);
    check("dragging the handle onto another box draws an arrow", arrowsIn(), before + 1);
    // Two arrows between the same two boxes is a real thing — a yes and a no —
    // so the second one is a second arrow rather than a no-op, and the drawing
    // gives each of them its own lane off the middle of the box.
    check("...from the box it was dragged off",
      markdown().split("\n").filter((line) => /^\s+A --> B$/.test(line)).length, 2);

    tap("A");
    const grown = box("A");
    press(canvas.querySelector('[data-role="connect"]'), grown[0] + 100, grown[1] + 25);
    move(grown[0] + 400, grown[1] + 300);
    release(grown[0] + 400, grown[1] + 300);
    check("letting go on empty paper grows a new box there", boxes().length, 3);
    check("...joined to the one it was drawn from", markdown().includes("A --> n1"), true);
    // Centred on where the finger was, then snapped to the grid — so "where it
    // was let go" is within half a grid step of it, not on it.
    const dropped = box("n1");
    check("...where it was let go, not where a layout engine would have put it",
      Math.abs(dropped[0] - (grown[0] + 355)) <= 5 && Math.abs(dropped[1] - (grown[1] + 275)) <= 5, true);
    check("...snapped there too", dropped.every((n) => n % 10 === 0), true);
    check("...and it is what is selected now, ready to be named",
      inspector.querySelector(".ve-diagram-text").value, "Step 3");

    const shape = inspector.querySelector(".ve-diagram-shape");
    shape.value = "diamond";
    shape.dispatchEvent(new window.Event("change", { bubbles: true }));
    check("a shape is a menu, not a bracket to remember",
      markdown().includes("n1{Step 3}"), true);

    // A table box is an ordinary Mermaid node with rows in its label, so the
    // file still renders anywhere. The layout line is what says to rule a line
    // under the first row.
    const tableTool = [...palette.querySelectorAll(".ve-diagram-tool")]
      .find((tool) => tool.textContent === "Table");
    tableTool.dispatchEvent(new window.MouseEvent("pointerdown", at(0, 0)));
    tableTool.dispatchEvent(new window.MouseEvent("pointerup", at(0, 0)));
    check("the palette adds a shape", boxes().length, 4);
    check("...and a table says it is one, in a comment rather than in the diagram",
      /%% @ \w+ [-\d]+,[-\d]+ \d+x\d+ kind=table/.test(markdown()), true);
    check("...with its rows written the way Mermaid writes a line break",
      markdown().includes("field: type"), true);
    check("...drawn with a rule under its title",
      canvas.querySelectorAll(".dd-node-table .dd-rule").length, 1);

    const rows = inspector.querySelector(".ve-diagram-text");
    rows.value = "Person\nname: string\nage: int";
    rows.dispatchEvent(new window.Event("input", { bubbles: true }));
    check("its rows are lines in a box, not tags to type",
      markdown().includes('n2["Person<br/>name: string<br/>age: int"]'), true);

    // Arrow to…: arm it, then tap the box it should point at. The way to draw
    // an arrow without a pointing device, and the way to draw one to a box that
    // is off the edge of the paper.
    tap("A");
    inspector.querySelector(".ve-diagram-connect").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("arming an arrow says what to do next",
      embed.querySelector(".ve-diagram-hint").textContent, "Now tap the step this one should point at.");

    const armed = arrowsIn();
    tap("n1");
    check("tapping the target draws the arrow", arrowsIn(), armed + 1);
    check("...and the hint stands down", embed.querySelector(".ve-diagram-hint").hidden, true);

    const arrowLabel = inspector.querySelector(".ve-diagram-arrow .ve-diagram-text");
    arrowLabel.value = "yes";
    arrowLabel.dispatchEvent(new window.Event("input", { bubbles: true }));
    check("an arrow can be labelled without typing pipes",
      markdown().includes("A -->|yes| B"), true);

    // Tidy is the way back: every box arranged again along the flow, which is
    // also what every other reader of this file does with it.
    const scattered = box("n1");
    embed.querySelector(".ve-diagram-tidy").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("Tidy arranges everything again", String(box("n1")) === String(scattered), false);
    check("...still saying where everything is", markdown().includes("%% @ n1 "), true);

    const flow = embed.querySelector(".ve-diagram-direction");
    flow.value = "LR";
    flow.dispatchEvent(new window.Event("change", { bubbles: true }));
    check("the direction is a menu in the header, reachable with nothing selected",
      markdown().includes("flowchart LR"), true);

    // Removing a step has to take its arrows with it: an arrow that names a
    // step Mermaid has never heard of declares it, and the step comes back as
    // an empty box. Its position has to go too, or the next box to be given
    // that id inherits where this one was.
    // Dragged out to the far corner first, so that the paper is demonstrably
    // bigger for its being there — a position left behind by a box that is gone
    // is paper nobody can reach the end of.
    tap("n1");
    const corner = box("n1");
    press(canvas.querySelector('.dd-node[data-id="n1"]'), corner[0] + 10, corner[1] + 10);
    move(corner[0] + 610, corner[1] + 510);
    release(corner[0] + 610, corner[1] + 510);
    const stretched = Number(svg().getAttribute("width"));

    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    check("Delete removes the selected step", boxes().includes("n1"), false);
    check("...and the paper it was out on", Number(svg().getAttribute("width")) < stretched, true);
    check("...and every arrow that touched it",
      markdown().includes("n1"), false);
    check("...and nothing is selected", Boolean(inspector.querySelector(".ve-diagram-selected")), false);

    // The full lists are still there, folded away: the way to reach an arrow
    // nobody can find on a crowded diagram, and the way to work without a
    // pointing device.
    const all = embed.querySelector(".ve-diagram-all");
    all.open = true;
    all.dispatchEvent(new window.Event("toggle", { bubbles: true }));
    const lists = () => [...embed.querySelectorAll(".ve-diagram-all .ve-diagram-rows")];
    check("every step is in the full list", lists()[0].children.length, 3);
    check("...named as the diagram names it",
      [...lists()[0].children].map((row) => row.querySelector(".ve-diagram-text").value)[0], "Begin");
    check("every arrow is there too", lists()[1].children.length, 2);

    embed.querySelector(".ve-embed-done").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("Done returns the block to its rendering",
      embed.querySelectorAll(".ve-diagram-canvas").length, 0);
    check("...and offers to build it again",
      Boolean(embed.querySelector(".ve-embed-build")), true);
    check("...drawn where it was left rather than handed to a layout engine",
      Boolean(embed.querySelector(".ve-embed-view svg.dd")), true);

    await window.eval("window.__t.savePageEdit()");
    await new Promise((r) => setTimeout(r, 900));
    const savedFlow = JSON.parse((await get("/api/docs/flow.md")).body).content;
    check("the built diagram reached the file", savedFlow.includes("flowchart LR"), true);
    check("...carrying the arrangement in comments", /%% @ A \d+,\d+ 90x50/.test(savedFlow), true);
    check("...and still fenced as mermaid", savedFlow.includes("```mermaid"), true);
    check("...with the diagram itself still a diagram",
      savedFlow.includes("    A[Begin]"), true);
    check("the diagram nobody opened is untouched",
      savedFlow.includes("  subgraph outer\n  C --> D\n  end"), true);
    check("...and so is the prose", savedFlow.endsWith("After.\n"), true);
  }

  console.log("=== a diagram leaves the document and comes back to it ===");
  {
    /* A diagram opens on a page of its own, and the document behind it may have
     * changes in it nobody has saved. Reading the file from disk on the other
     * side would throw those away without saying so, so the document goes
     * across in sessionStorage and comes back the same way. This is the half of
     * that the document editor owns: leaving it, and picking it back up.
     */
    await window.eval("window.__t.startPageEdit()");
    await new Promise((r) => setTimeout(r, 300));

    const embed = doc.querySelector("#docContent .ve-embed");
    check("a buildable diagram offers a page of its own",
      Boolean(embed.querySelector(".ve-embed-expand")), true);

    // Change something first, so what goes across is a document that would be
    // lost if the other page read the file instead.
    const before = window.eval("window.__t.collectPageMarkdown()");
    const stashed = before.replace("After.", "Edited and not saved.");

    check("a document can be left where the diagram page will find it",
      window.eval(`window.__t.stashDocument("flow.md", ${JSON.stringify(JSON.stringify(stashed))})`), true);
    check("...under a name that is that document's and no other",
      window.eval('window.__t.diagramStashKey("flow.md")'), "azadocs:diagram:flow.md");

    await window.eval("window.__t.cancelPageEdit({ confirm: false })");
    await new Promise((r) => setTimeout(r, 200));

    // Coming back. The document on screen is the one that was left, with
    // whatever the diagram page did to it, and it is still unsaved.
    await window.eval("window.__t.startPageEdit()");
    await new Promise((r) => setTimeout(r, 400));

    check("the document comes back as it was left, not as it is on disk",
      window.eval("window.__t.collectPageMarkdown()").includes("Edited and not saved."), true);
    check("...and is still unsaved", window.eval("window.__t.isPageEditDirty()"), true);
    check("...with the bar saying so rather than looking clean",
      doc.getElementById("pageEditSaveBtn").disabled, false);
    check("...and a note saying where the change came from",
      [...doc.querySelectorAll(".toast")].some((one) => /has the edited diagram in it/.test(one.textContent)), true);

    // Taken, not read. Left behind, it would be picked up by an edit weeks
    // later and quietly undo everything in between.
    check("the stash is gone once it has been used",
      window.eval('window.sessionStorage.getItem("azadocs:diagram:flow.md")'), null);

    await window.eval("window.__t.cancelPageEdit({ confirm: false })");
    await new Promise((r) => setTimeout(r, 200));
    await window.eval("window.__t.startPageEdit()");
    await new Promise((r) => setTimeout(r, 300));
    check("...so opening the document again is the document, not the diagram session",
      window.eval("window.__t.collectPageMarkdown()").includes("Edited and not saved."), false);
    await window.eval("window.__t.cancelPageEdit({ confirm: false })");
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log("=== a wait says what it is waiting for ===");
  {
    const panel = doc.getElementById("emptyState");

    // The shell ships this spinning, because at /Notes/day-one.md the app is
    // already fetching that document before any script has run. Something on
    // every path out of initialize() has to stop it, and the app has long since
    // finished booting by the time this suite gets here.
    check("a settled app is not left spinning", panel.classList.contains("is-loading"), false);

    window.eval('window.__t.showLoadingState("Opening Notes/day-one.md", "Fetching this document from the library.")');
    check("a wait names the document it is fetching",
      panel.querySelector("h3").textContent, "Opening Notes/day-one.md");
    check("...and spins", panel.classList.contains("is-loading"), true);
    check("...and says so to a screen reader", panel.getAttribute("aria-busy"), "true");

    // Every settled state goes through showEmptyState, which is what makes this
    // true of the ones written after today as well.
    window.eval('window.__t.showEmptyState("No file selected", "Pick a file from the explorer.")');
    check("a settled state stops the spinner", panel.classList.contains("is-loading"), false);
    check("...and drops aria-busy", panel.getAttribute("aria-busy"), null);
    check("...and says the settled thing", panel.querySelector("h3").textContent, "No file selected");
  }

  console.log("=== a code block hands itself over ===");
  {
    const source = [
      "# Snippet",
      "",
      "```js",
      "const answer = 42;",
      "console.log(answer);",
      "```",
      ""
    ].join("\n");

    await window.eval(`window.__t.requestJson("/api/docs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: ${JSON.stringify(JSON.stringify({ fileName: "snippet.md", content: source }))}
    })`);

    await window.eval('window.__t.refreshDocs({ preserveSearch: false })');
    await window.eval('window.__t.openDocument("snippet.md", false, { forceReload: true })');
    await new Promise((r) => setTimeout(r, 700));

    const button = doc.querySelector("#docContent .code-copy");
    check("the rendered block has a copy button", Boolean(button), true);
    // Inside the <pre> it would scroll off the side of any block with one long
    // line in it, so it belongs to a wrapper around the block instead.
    check("...pinned to a wrapper rather than to the scrolling block",
      button.parentElement.className, "code-block");

    clipboardWrites.length = 0;
    button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 50));
    check("clicking it copies the code and nothing around it",
      clipboardWrites, ["const answer = 42;\nconsole.log(answer);\n"]);

    console.log("=== so does the whole document ===");
    const copyDoc = doc.getElementById("copyDocBtn");
    check("the toolbar offers it", Boolean(copyDoc), true);
    check("...and it is live while a document is open", copyDoc.disabled, false);

    clipboardWrites.length = 0;
    copyDoc.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
    // Markdown, not the rendering: this is a markdown library, and the source
    // is the thing that pastes into another document and comes back the same.
    check("what lands on the clipboard is the source", clipboardWrites, [source]);

    window.eval('window.__t.updateActiveDocUI("")');
    check("with nothing open there is nothing to copy", copyDoc.disabled, true);
    window.eval('window.__t.updateActiveDocUI("snippet.md")');

    console.log("=== code being typed into is left to be typed into ===");
    await window.eval("window.__t.startPageEdit()");
    await new Promise((r) => setTimeout(r, 300));

    const editable = doc.querySelector("#docContent .ve-code pre code");
    check("the fence is a code block the caret goes into", Boolean(editable), true);
    check("...and is not given a copy button over its language field",
      Boolean(doc.querySelector("#docContent .ve-code .code-copy")), false);

    console.log("=== ...and stays coloured while it is ===");
    const typed = "const answer = 43;\nreturn answer;";
    editable.textContent = typed;
    editable.dispatchEvent(new window.Event("input", { bubbles: true }));

    check("nothing is repainted mid-keystroke",
      editable.querySelectorAll("span.hljs-keyword").length, 0);

    // Past the debounce, which is what "as you type" actually means here.
    await new Promise((r) => setTimeout(r, 400));
    check("a pause repaints the block", editable.querySelectorAll("span.hljs-keyword").length, 2);
    check("...without changing a character of the code", editable.textContent, typed);
    // The serializer reads textContent, so colouring must be invisible to it.
    check("...and the markdown written back is the code, not the colours",
      window.eval("window.__t.collectPageMarkdown()").includes("```js\nconst answer = 43;\nreturn answer;\n```"), true);

    // The block was typed into, so an ordinary cancel would stop for the
    // discard dialog. That dialog has its own checks elsewhere.
    await window.eval("window.__t.cancelPageEdit({ confirm: false })");
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log("=== undo in the page editor is the document, not the DOM ===");
  {
    const source = "# Undo\n\nFirst line.\n";
    await window.eval(`window.__t.requestJson("/api/docs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: ${JSON.stringify(JSON.stringify({ fileName: "undo.md", content: source }))}
    })`);

    await window.eval('window.__t.refreshDocs({ preserveSearch: false })');
    await window.eval('window.__t.openDocument("undo.md", false, { forceReload: true })');
    await new Promise((r) => setTimeout(r, 600));
    await window.eval("window.__t.startPageEdit()");
    await new Promise((r) => setTimeout(r, 300));

    const markdown = () => window.eval("window.__t.collectPageMarkdown()");
    const paragraph = () => [...doc.querySelectorAll('#docContent .ve-block[contenteditable="true"]')]
      .find((node) => node.textContent.includes("First line") || node.textContent.includes("Second"));

    const type = (text) => {
      const node = paragraph();
      node.innerHTML = `<p>${text}</p>`;
      node.dispatchEvent(new window.Event("input", { bubbles: true }));
    };

    check("the editor opens on the document as it stands", markdown(), source);

    // A burst of typing is one step. Four keystrokes without a pause between
    // them must not cost four presses of Ctrl+Z to take back.
    type("Second");
    type("Second l");
    type("Second li");
    type("Second line.");
    window.eval("window.__t.commitPageHistory()");
    check("a burst of typing is one step", window.eval("window.__t.pageHistory.past.length"), 1);

    const afterFirst = markdown();
    check("...that reached the document", afterFirst.includes("Second line."), true);

    type("Third line.");
    window.eval("window.__t.commitPageHistory()");
    check("a second burst is a second step", window.eval("window.__t.pageHistory.past.length"), 2);

    check("undo goes back one step", window.eval("window.__t.undoPageEdit()") && markdown(), afterFirst);
    check("...and again, to the document as it was opened", window.eval("window.__t.undoPageEdit()") && markdown(), source);
    check("...and stops there rather than inventing one", window.eval("window.__t.undoPageEdit()"), false);

    check("redo comes forward again", window.eval("window.__t.redoPageEdit()") && markdown(), afterFirst);
    check("...all the way", window.eval("window.__t.redoPageEdit()") && markdown().includes("Third line."), true);
    check("...and stops at the newest state", window.eval("window.__t.redoPageEdit()"), false);

    // Typing after an undo is a new branch; there is nothing left to redo onto.
    window.eval("window.__t.undoPageEdit()");
    type("A different line.");
    window.eval("window.__t.commitPageHistory()");
    check("typing after an undo drops the redo stack",
      window.eval("window.__t.pageHistory.future.length"), 0);

    console.log("=== ...and it puts you back where you were ===");
    // The scroll position is checked by reading the source rather than by
    // scrolling: jsdom runs no layout, so emptying the container does not reset
    // scrollTop here the way a browser does, and a behavioural check would pass
    // whether or not the app carried the position across.
    const restoreState = appSource.slice(appSource.indexOf("function applyPageHistoryState"));
    const body = restoreState.slice(0, restoreState.indexOf("\n}\n"));
    check("the scroll position is read before the document is re-rendered",
      body.indexOf("viewer.scrollTop") < body.indexOf("renderPageEditor(entry.markdown)"), true);
    check("...and written back after it",
      body.lastIndexOf("viewer.scrollTop = offset") > body.indexOf("renderPageEditor(entry.markdown)"), true);

    window.eval("window.__t.undoPageEdit()");
    const focused = doc.activeElement;
    check("the caret lands back in a block of the document",
      Boolean(focused && focused.closest("#docContent .ve-block")), true);

    /* Inserting a diagram opens the thing you make a diagram with.
     *
     * A diagram is a fence, and for the frame between rendering the block and
     * drawing the diagram in it there is a <pre><code> in there holding the
     * Mermaid source. Whatever decides where the caret goes has to know that is
     * a diagram rather than a code block, or it focuses an element nobody can
     * type into and the button looks like it did nothing.
     */
    window.eval('window.__t.insertPageBlock("mermaid")');
    const madeDiagram = doc.querySelector("#docContent .ve-embed.is-builder-open");
    check("inserting a diagram opens the builder", Boolean(madeDiagram), true);
    check("...on a canvas with the new diagram's boxes on it",
      [...(madeDiagram?.querySelectorAll(".dd-node") || [])].map((g) => g.getAttribute("data-id")),
      ["A", "B"]);
    check("...and the shapes to add more with",
      (madeDiagram?.querySelectorAll(".ve-diagram-tool") || []).length > 1, true);
    check("...rather than the diagram's own source under the caret",
      Boolean(doc.activeElement?.closest?.("pre")), false);

    window.eval("window.__t.undoPageEdit()");

    console.log("=== a structural edit is its own step ===");
    window.eval("window.__t.commitPageHistory()");
    const beforeInsert = markdown();
    const stepsBefore = window.eval("window.__t.pageHistory.past.length");

    window.eval('window.__t.insertPageBlock("table")');
    check("adding a block reaches the document", markdown().includes("|"), true);
    check("...as exactly one step", window.eval("window.__t.pageHistory.past.length"), stepsBefore + 1);
    check("...which undo takes back whole", window.eval("window.__t.undoPageEdit()") && markdown(), beforeInsert);

    console.log("=== Ctrl+Z is routed, not swallowed ===");
    const press = (target, key, extra = {}) => {
      const event = new window.KeyboardEvent("keydown", {
        key, ctrlKey: true, bubbles: true, cancelable: true, ...extra
      });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };

    check("Ctrl+Z in a block is taken by the editor",
      press(paragraph() || doc.getElementById("docContent"), "z"), true);
    check("Ctrl+Shift+Z as well", press(doc.getElementById("docContent"), "z", { shiftKey: true }), true);
    check("...and Ctrl+Y, which is the same request spelled differently",
      press(doc.getElementById("docContent"), "y"), true);
    check("Ctrl+S saves from inside the document", press(doc.getElementById("docContent"), "s"), true);

    // A source box and the language field have their own undo, and it is better
    // than a whole-document step: character-accurate, and the caret stays put.
    const field = doc.createElement("textarea");
    doc.getElementById("docContent").appendChild(field);
    check("Ctrl+Z inside a form control is left to the browser", press(field, "z"), false);
    field.remove();

    console.log("=== leaving the editor leaves its history behind ===");
    await window.eval("window.__t.cancelPageEdit({ confirm: false })");
    await new Promise((r) => setTimeout(r, 300));
    check("nothing is left to undo into a document that is closed",
      window.eval("window.__t.pageHistory.past.length"), 0);
    check("...and nothing to redo either", window.eval("window.__t.pageHistory.future.length"), 0);
  }

  console.log("=== the source editor answers to the same keys ===");
  {
    await window.eval("window.__t.openEditorForCurrentDoc()");
    await new Promise((r) => setTimeout(r, 400));
    check("the source editor is open on the document", window.eval("window.__t.state.editorOpen"), true);

    const area = doc.getElementById("editorInput");
    const value = () => area.value;

    area.value = "plain words here";
    area.focus();
    area.setSelectionRange(6, 11);

    execCommands.length = 0;
    window.eval('window.__t.toggleMarkdownWrap(document.getElementById("editorInput"), "**", "bold text")');
    check("Ctrl+B wraps the selection", value(), "plain **words** here");
    // Assigning to .value clears a textarea's undo history outright, so the
    // insertion has to be one the browser knows about.
    check("...through an insertion the undo stack can see", execCommands, ["insertText"]);
    check("...leaving the wrapped words selected",
      [area.selectionStart, area.selectionEnd], [8, 13]);

    window.eval('window.__t.toggleMarkdownWrap(document.getElementById("editorInput"), "**", "bold text")');
    check("pressing it again takes the markers off, not another pair", value(), "plain words here");

    area.setSelectionRange(6, 6);
    window.eval('window.__t.toggleMarkdownWrap(document.getElementById("editorInput"), "*", "italic text")');
    check("with nothing selected it offers a placeholder to type over",
      value(), "plain *italic text*words here");
    check("...already selected", [area.selectionStart, area.selectionEnd], [7, 18]);

    area.value = "";
    area.setSelectionRange(0, 0);
    execCommands.length = 0;
    window.eval('window.__t.insertIntoTextarea(document.getElementById("editorInput"), "hello")');
    check("an image placeholder goes in the same way", value(), "hello");
    check("...not by assigning the whole value", execCommands, ["insertText"]);

    execCommands.length = 0;
    window.eval('window.__t.replaceInTextarea(document.getElementById("editorInput"), "hello", "goodbye")');
    check("...and is swapped for the finished upload the same way", value(), "goodbye");
    check("...also as a real insertion", execCommands, ["insertText"]);

    // Ctrl+S is bound on the modal rather than on the textarea, so it also
    // works from the field somebody has just typed a filename into.
    const fromName = new window.KeyboardEvent("keydown", {
      key: "s", ctrlKey: true, bubbles: true, cancelable: true
    });
    doc.getElementById("editorFileName").dispatchEvent(fromName);
    check("Ctrl+S saves from the filename field, not only from the text",
      fromName.defaultPrevented, true);

    const written = "typed in the source editor\n";
    area.value = written;
    const fromText = new window.KeyboardEvent("keydown", {
      key: "s", ctrlKey: true, bubbles: true, cancelable: true
    });
    area.dispatchEvent(fromText);
    await waitUntil(() => window.eval("window.__t.isEditorDirty()") === false);
    check("...and it really saves", JSON.parse((await get("/api/docs/undo.md")).body).content, written);
    check("...without closing the editor", window.eval("window.__t.state.editorOpen"), true);
    check("...leaving nothing unsaved behind it", window.eval("window.__t.isEditorDirty()"), false);
    // The redraw behind the modal must not reach into the text being written.
    check("...and the caret still in the text it was in", doc.activeElement, area);

    // These belong to the text, so they are not taken off the other fields.
    const fromNameAgain = new window.KeyboardEvent("keydown", {
      key: "b", ctrlKey: true, bubbles: true, cancelable: true
    });
    doc.getElementById("editorFileName").dispatchEvent(fromNameAgain);
    check("Ctrl+B in the filename field is not a formatting command",
      fromNameAgain.defaultPrevented, false);

    // Closing with something unsaved asks the same question the page editor
    // asks, and offers the same three answers.
    const more = `${written}and then some more\n`;
    area.value = more;
    const closing = window.eval("window.__t.requestEditorClose()");
    await new Promise((r) => setTimeout(r, 150));
    check("closing with unsaved text asks first",
      doc.getElementById("confirmModal").classList.contains("open"), true);
    check("...and offers to save it rather than only to lose it",
      doc.getElementById("confirmAltBtn").hidden, false);

    window.eval('window.__t.resolveConfirmDialog("alt")');
    await closing;
    await waitUntil(() => window.eval("window.__t.state.editorOpen") === false);
    check("saying save closes the editor", window.eval("window.__t.state.editorOpen"), false);
    check("...having written what was in it",
      JSON.parse((await get("/api/docs/undo.md")).body).content, more);

    // Two saves of one document must never be in flight together: they can
    // reach the server in either order, and the loser is the one that wrote
    // first — leaving the file holding older text than the editor claims. That
    // they overlap at all is a matter of timing, so this is read from the
    // source rather than raced for, for the same reason the scroll check above
    // is: a passing race proves nothing about the run where it loses.
    const queues = (name, chain) => {
      const from = appSource.slice(appSource.indexOf(`function ${name}(options) {`));
      return from.slice(0, from.indexOf("\n}\n")).includes(`${chain} = ${chain}.then(run, run)`);
    };
    check("saves on the page are queued behind each other, not raced",
      queues("savePageEdit", "pageSaveChain"), true);
    check("...and so are saves from the source editor",
      queues("saveEditorDocument", "editorSaveChain"), true);

    await new Promise((r) => setTimeout(r, 200));
  }

  console.log("=== a document has a real address, without leaving the page ===");
  {
    const nested = server.docPaths["alpha.md"] || "alpha.md";
    const path = () => window.location.pathname;

    check("a document's address is its path",
      window.eval(`window.__t.documentPath(${JSON.stringify(nested)})`),
      `/${nested.split("/").map(encodeURIComponent).join("/")}`);
    check("...and reading it back gives the document again",
      window.eval(`(function () {
        window.history.replaceState(null, "", window.__t.documentPath(${JSON.stringify(nested)}));
        return window.__t.fileFromLocation();
      })()`),
      nested);

    // The page itself must never be replaced: this is one page, and opening a
    // document changes the address without going anywhere.
    window.eval('window.__marker = "same-page";');
    const article = doc.getElementById("docContent");

    await window.eval('window.__t.openDocument("beta.md", true)');
    await new Promise((r) => setTimeout(r, 500));
    check("opening a document puts it in the address bar", path(), "/beta.md");
    check("...with no fragment left behind", window.location.hash, "");
    check("...and the page was never reloaded", window.eval("window.__marker"), "same-page");
    check("...it is still the same article element",
      doc.getElementById("docContent") === article, true);

    await window.eval(`window.__t.openDocument(${JSON.stringify(nested)}, true)`);
    await new Promise((r) => setTimeout(r, 500));
    check("a document in folders gets the whole path",
      decodeURIComponent(path()), `/${nested}`);
    check("...and the app agrees that is what is open",
      window.eval("window.__t.state.activeFile"), nested);

    // Back and forward are the browser's, and they have to work.
    window.history.back();
    await new Promise((r) => setTimeout(r, 600));
    check("back returns to the previous document", path(), "/beta.md");
    check("...and actually opens it", window.eval("window.__t.state.activeFile"), "beta.md");
    check("...still without reloading", window.eval("window.__marker"), "same-page");

    window.history.forward();
    await new Promise((r) => setTimeout(r, 600));
    check("forward goes to the next one again",
      window.eval("window.__t.state.activeFile"), nested);

    // Landing on the app without asking for anything should not invent a
    // history entry for whatever it happened to open.
    const depth = window.history.length;
    await window.eval('window.__t.openDocument("beta.md", false)');
    await new Promise((r) => setTimeout(r, 500));
    check("a document opened without being asked for still shows in the address",
      path(), "/beta.md");
    check("...but adds no history entry to go back through",
      window.history.length, depth);

    // Links from before this existed.
    check("an old fragment link still names its document",
      window.eval(`(function () {
        window.history.replaceState(null, "", "/#" + encodeURIComponent(${JSON.stringify(nested)}));
        return window.__t.fileFromLocation();
      })()`),
      nested);
    check("...and is turned into the real address",
      window.eval(`(function () {
        window.__t.showDocumentInUrl(${JSON.stringify(nested)}, { replace: true });
        return window.location.pathname;
      })()`),
      `/${nested.split("/").map(encodeURIComponent).join("/")}`);

    // A path that names no document is the app's own root, not a document
    // called "settings".
    for (const junk of ["/", "/img/embed-card.png", "/some/page"]) {
      check(`${junk} names no document`, window.eval(`(function () {
        window.history.replaceState(null, "", ${JSON.stringify(junk)});
        return window.__t.fileFromLocation();
      })()`), null);
    }

    // Back as far as the library itself. The address says nothing is open, so
    // nothing may be: an address and a screen that disagree is how a refresh
    // ends up somewhere the last click never went.
    window.eval('window.history.replaceState(null, "", "/");');
    await window.eval('window.__t.openDocument("beta.md", true)');
    await new Promise((r) => setTimeout(r, 500));
    check("the library is the entry behind an open document", path(), "/beta.md");

    window.history.back();
    await new Promise((r) => setTimeout(r, 600));
    check("back to the library closes the document", path(), "/");
    check("...and the app agrees nothing is open",
      window.eval("window.__t.state.activeFile"), null);
    check("...and the document is off the screen, not just out of the address",
      doc.getElementById("docContent").classList.contains("visible"), false);
    check("...with the empty state in its place",
      doc.getElementById("emptyState").textContent.includes("No file selected"), true);
    check("...still without reloading", window.eval("window.__marker"), "same-page");

    window.history.forward();
    await new Promise((r) => setTimeout(r, 600));
    check("forward opens it again",
      window.eval("window.__t.state.activeFile"), "beta.md");

    // Unsaved work is not a thing to lose to a stray Back: beforeunload never
    // fires for a history move within one page, so the address is put back
    // rather than the document being torn down under the edit.
    await window.eval('window.__t.startPageEdit()');
    await new Promise((r) => setTimeout(r, 400));
    check("the page edit is running", window.eval("window.__t.pageEditActive()"), true);
    const leaving = doc.querySelector('#docContent .ve-block[contenteditable="true"]');
    leaving.innerHTML = "<p>Edited on the way out.</p>";
    leaving.dispatchEvent(new window.Event("input", { bubbles: true }));
    check("...and it is dirty", window.eval("window.__t.isPageEditDirty()"), true);

    window.history.back();
    await new Promise((r) => setTimeout(r, 600));
    check("back does not walk out on unsaved changes", path(), "/beta.md");
    check("...the document is still open", window.eval("window.__t.state.activeFile"), "beta.md");
    check("...and the edit is still running", window.eval("window.__t.pageEditActive()"), true);

    await window.eval('window.__t.cancelPageEdit({ confirm: false })');
    await new Promise((r) => setTimeout(r, 300));

    window.eval('window.history.replaceState(null, "", "/");');
  }

  console.log("=== the bar can put a new block into the document ===");
  {
    const source = ["# Notes", "", "First.", "", "Last.", ""].join("\n");

    await window.eval(`window.__t.requestJson("/api/docs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: ${JSON.stringify(JSON.stringify({ fileName: "insert.md", content: source }))}
    })`);

    await window.eval('window.__t.refreshDocs({ preserveSearch: false })');
    await window.eval('window.__t.openDocument("insert.md", false, { forceReload: true })');
    await new Promise((r) => setTimeout(r, 700));
    await window.eval("window.__t.startPageEdit()");
    await new Promise((r) => setTimeout(r, 300));

    const bar = doc.getElementById("visualToolbar");
    const press = (kind) => {
      const button = bar.querySelector(`.visual-tool[data-insert="${kind}"]`);
      button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      return button;
    };
    const editables = () => [...doc.querySelectorAll('#docContent .ve-block[contenteditable="true"]')];
    const putCursorIn = (node) => {
      node.focus();
      const range = doc.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    };

    check("the bar offers a button for each of them",
      [...bar.querySelectorAll(".visual-tool[data-insert]")].map((b) => b.dataset.insert),
      ["fence", "table", "math", "mermaid"]);
    check("...and one for a picture", Boolean(doc.getElementById("visualImageBtn")), true);
    check("nothing is unsaved yet", window.eval("window.__t.isPageEditDirty()"), false);

    // A code block, below the paragraph the cursor is in — not at the end of
    // the document, and not on top of what is already there.
    putCursorIn(editables()[1]);
    press("fence");

    check("a code block appears", doc.querySelectorAll("#docContent .ve-code").length, 1);
    check("...and it counts as unsaved", window.eval("window.__t.isPageEditDirty()"), true);
    check("...with the cursor already in the code",
      doc.activeElement?.closest?.(".ve-code") !== null, true);

    const afterFence = window.eval("window.__t.collectPageMarkdown()");
    check("it lands under the paragraph the cursor was in",
      afterFence, "# Notes\n\nFirst.\n\n```\n\n```\n\nLast.\n");

    // A table, below the code block this time.
    press("table");
    check("a table appears", doc.querySelectorAll("#docContent .ve-table").length, 1);
    check("...with a header row and a body row",
      doc.querySelectorAll("#docContent .ve-table tr").length, 2);
    check("...and the cursor in its first cell",
      doc.activeElement?.tagName, "TH");
    check("...and it is a real table in the markdown",
      window.eval("window.__t.collectPageMarkdown()").includes("| Column | Column |\n| --- | --- |"), true);

    // Maths and diagrams have nothing to type into, so they open on source.
    putCursorIn(editables()[0]);
    press("math");
    const mathBlock = doc.querySelector("#docContent .ve-embed");
    check("a formula appears", Boolean(mathBlock), true);
    check("...opened on its source, because there is nothing else to type in",
      Boolean(mathBlock.querySelector(".ve-embed-source")), true);
    check("...with a preview already beside it",
      Boolean(mathBlock.querySelector(".ve-embed-preview")), true);
    check("...and it went under the heading, where the cursor was",
      /^# Notes\n\n\$\$/.test(window.eval("window.__t.collectPageMarkdown()")), true);

    press("mermaid");
    const diagram = doc.querySelector("#docContent .ve-embed.is-builder-open");
    check("a diagram appears", Boolean(diagram), true);
    check("...opened on the canvas you make one on",
      Boolean(diagram.querySelector(".ve-diagram-canvas .dd-node")), true);
    check("...as a fence the renderer will draw",
      window.eval("window.__t.collectPageMarkdown()").includes("```mermaid\nflowchart TD"), true);

    // Everything that was in the file to begin with is still in it, in order.
    const built = window.eval("window.__t.collectPageMarkdown()");
    check("the document still starts where it did", built.startsWith("# Notes\n"), true);
    check("...and ends where it did", built.trimEnd().endsWith("Last."), true);
    check("...with both original paragraphs intact",
      [built.includes("\nFirst.\n"), built.includes("\nLast.\n")], [true, true]);

    await window.eval("window.__t.savePageEdit()");
    await new Promise((r) => setTimeout(r, 900));
    const saved = JSON.parse((await get("/api/docs/insert.md")).body).content;
    check("what was on screen is what reached the file", saved, built);
    check("...and it reopens as the same blocks", saved.includes("```mermaid"), true);

    // Pressing one with the cursor nowhere should append rather than refuse.
    await window.eval("window.__t.startPageEdit()");
    await new Promise((r) => setTimeout(r, 300));
    window.getSelection().removeAllRanges();
    doc.activeElement?.blur?.();
    press("table");
    check("with the cursor nowhere, it goes at the end",
      window.eval("window.__t.collectPageMarkdown()").trimEnd().endsWith("|  |  |"), true);
    await window.eval("window.__t.cancelPageEdit({ confirm: false })");
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log("=== a pasted picture becomes an image in the document ===");
  {
    // A real PNG signature, so what goes up is an image rather than the word.
    const png = (tail) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...tail]);
    const pngFile = (name = "Screenshot 2026-08-12.png", tail = [1, 2, 3, 4]) =>
      new window.File([png(tail)], name, { type: "image/png" });

    // jsdom builds no clipboard, so the transfer object is handed over
    // directly. It is read exactly as a real one is: files first, items after.
    const pasteEvent = (target, files) => {
      const event = new window.Event("paste", { bubbles: true, cancelable: true });
      event.clipboardData = { files, items: [], getData: () => "" };
      target.dispatchEvent(event);
      return event;
    };

    await window.eval(`window.__t.requestJson("/api/docs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: ${JSON.stringify(JSON.stringify({ fileName: "pictures.md", content: "# Pictures\n\nBefore.\n" }))}
    })`);

    await window.eval('window.__t.refreshDocs({ preserveSearch: false })');
    await window.eval('window.__t.openDocument("pictures.md", false, { forceReload: true })');
    await new Promise((r) => setTimeout(r, 700));

    console.log("  -- into the markdown editor --");
    await window.eval("window.__t.openEditorForCurrentDoc()");
    await new Promise((r) => setTimeout(r, 500));

    const input = doc.getElementById("editorInput");
    check("the editor opens on the document", input.value, "# Pictures\n\nBefore.\n");
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;

    const pasted = pasteEvent(input, [pngFile()]);
    check("the paste is taken over from the browser", pasted.defaultPrevented, true);
    check("...and something stands in for the picture straight away",
      input.value.includes("![Uploading Screenshot 2026-08-12.png...]()"), true);

    await new Promise((r) => setTimeout(r, 900));

    check("the placeholder is replaced once the bytes are up",
      input.value.includes("Uploading"), false);
    const link = input.value.match(/!\[([^\]]*)\]\((\/api\/assets\/[0-9a-f]{64}\.png)\)/);
    check("...by an ordinary markdown image", Boolean(link), true);
    check("...with the file's name as the alt text", link[1], "Screenshot 2026-08-12");
    check("...and the text that was already there is untouched",
      input.value.startsWith("# Pictures\n\nBefore.\n"), true);

    // The link has to be real: the image must actually be fetchable.
    const served = await get(link[2]);
    check("the image is really there at that address", served.status, 200);

    await window.eval("window.__t.saveEditorDocument()");
    await new Promise((r) => setTimeout(r, 900));
    const saved = JSON.parse((await get("/api/docs/pictures.md")).body).content;
    check("the image link reached the file", saved.includes(link[2]), true);

    console.log("  -- into the document being edited on the page --");
    await window.eval('window.__t.openDocument("pictures.md", false, { forceReload: true })');
    await new Promise((r) => setTimeout(r, 500));
    await window.eval("window.__t.startPageEdit()");
    await new Promise((r) => setTimeout(r, 300));

    const target = [...doc.querySelectorAll('#docContent .ve-block[contenteditable="true"]')][1];
    target.focus();
    const range = doc.createRange();
    // Inside the paragraph, which is where a caret actually sits.
    range.selectNodeContents(target.querySelector("p"));
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    check("nothing is dirty before the paste", window.eval("window.__t.isPageEditDirty()"), false);
    pasteEvent(target, [pngFile("diagram.png", [9, 9, 9, 9])]);

    // The block already holds the image pasted into the source editor, so the
    // new one is the last, not the first.
    const inserted = [...target.querySelectorAll("img")].at(-1);
    check("the picture is on the page immediately", Boolean(inserted), true);
    check("...shown from the local copy while it uploads",
      inserted.getAttribute("src").startsWith("blob:"), true);
    check("...and marked as still going up", inserted.dataset.uploading, "true");
    check("...and it counts as an edit", window.eval("window.__t.isPageEditDirty()"), true);

    await new Promise((r) => setTimeout(r, 900));

    check("the picture swaps to the uploaded copy",
      /^\/api\/assets\/[0-9a-f]{64}\.png$/.test(inserted.getAttribute("src")), true);
    check("...and is no longer marked as uploading", "uploading" in inserted.dataset, false);
    check("the block writes it back as markdown",
      /!\[diagram\]\(\/api\/assets\/[0-9a-f]{64}\.png\)/.test(window.eval("window.__t.collectPageMarkdown()")), true);

    await window.eval("window.__t.savePageEdit()");
    await new Promise((r) => setTimeout(r, 900));
    const withBoth = JSON.parse((await get("/api/docs/pictures.md")).body).content;
    check("both pictures are in the file now",
      (withBoth.match(/!\[[^\]]*\]\(\/api\/assets\//g) || []).length, 2);

    console.log("  -- what is not a picture --");
    await window.eval("window.__t.openEditorForCurrentDoc()");
    await new Promise((r) => setTimeout(r, 500));
    const before = doc.getElementById("editorInput").value;

    const text = new window.Event("paste", { bubbles: true, cancelable: true });
    text.clipboardData = { files: [new window.File(["x"], "notes.txt", { type: "text/plain" })], items: [], getData: () => "" };
    doc.getElementById("editorInput").dispatchEvent(text);
    check("pasting a text file is left to the browser", text.defaultPrevented, false);
    check("...and nothing is uploaded",
      doc.getElementById("editorInput").value, before);
    window.eval("window.__t.closeEditor()");
  }

  console.log("=== a checkbox on the page ticks the box in the file ===");
  {
    const source = [
      "# Jobs",
      "",
      "- [ ] buy milk",
      "- [x] call back",
      "",
      "```md",
      "- [ ] not a checkbox",
      "```",
      ""
    ].join("\n");

    await window.eval(`window.__t.requestJson("/api/docs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: ${JSON.stringify(JSON.stringify({ fileName: "jobs.md", content: source }))}
    })`);

    await window.eval('window.__t.refreshDocs({ preserveSearch: false })');
    await window.eval('window.__t.openDocument("jobs.md", false, { forceReload: true })');
    await new Promise((r) => setTimeout(r, 700));
    check("the task list is open", window.eval("window.__t.state.activeFile"), "jobs.md");

    const boxes = () => [...doc.querySelectorAll('#docContent li input[type="checkbox"]')];
    check("the tasks are on the page as checkboxes", boxes().length, 2);
    check("...and the one in the code fence is not among them",
      doc.querySelectorAll("#docContent pre input").length, 0);
    check("a checkbox is live, not a picture of one",
      boxes().map((b) => b.disabled), [false, false]);
    check("...showing what the file says", boxes().map((b) => b.checked), [false, true]);

    // Ticking one. No dialog, no save button — the click is the edit.
    boxes()[0].checked = true;
    boxes()[0].dispatchEvent(new window.Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 700));

    const ticked = JSON.parse((await get("/api/docs/jobs.md")).body).content;
    check("the tick reached the file", ticked.includes("- [x] buy milk"), true);
    check("...without disturbing the task beside it", ticked.includes("- [x] call back"), true);
    check("...or the one inside the fence", ticked.includes("```md\n- [ ] not a checkbox\n```"), true);
    check("...and the rest of the file is byte-for-byte what it was",
      ticked, source.replace("- [ ] buy milk", "- [x] buy milk"));
    check("the page was not rebuilt under the click",
      doc.getElementById("docContent").querySelectorAll("li").length, 2);

    // And clearing one.
    boxes()[1].checked = false;
    boxes()[1].dispatchEvent(new window.Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 700));

    const cleared = JSON.parse((await get("/api/docs/jobs.md")).body).content;
    check("clearing a box reaches the file too", cleared.includes("- [ ] call back"), true);
    check("...and the one ticked a moment ago stayed ticked",
      cleared.includes("- [x] buy milk"), true);

    // Reopening proves the file, not the page, is the record.
    await window.eval('window.__t.openDocument("jobs.md", false, { forceReload: true })');
    await new Promise((r) => setTimeout(r, 500));
    check("reopening shows what was ticked", boxes().map((b) => b.checked), [true, false]);

    // The same boxes have to work while the document is being edited in place,
    // where they sit inside a contenteditable that would otherwise swallow the
    // click. Here the tick is part of the edit rather than a save of its own.
    await window.eval("window.__t.startPageEdit()");
    await new Promise((r) => setTimeout(r, 300));

    const editing = [...doc.querySelectorAll("#docContent .ve-block input[type=\"checkbox\"]")];
    check("the boxes are still there while editing", editing.length, 2);
    check("...and still live", editing.map((b) => b.disabled), [false, false]);
    check("...but not part of the text being typed",
      editing.every((b) => b.getAttribute("contenteditable") === "false"), true);
    check("nothing is dirty yet", window.eval("window.__t.isPageEditDirty()"), false);

    editing[1].dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    check("clicking a box in the editor ticks it", editing[1].checked, true);
    check("...and counts as an edit", window.eval("window.__t.isPageEditDirty()"), true);
    check("...which the block writes back as markdown",
      window.eval("window.__t.collectPageMarkdown()").includes("- [x] call back"), true);
    check("...leaving the task above it alone",
      window.eval("window.__t.collectPageMarkdown()").includes("- [x] buy milk"), true);

    await window.eval("window.__t.savePageEdit()");
    await new Promise((r) => setTimeout(r, 900));
    const fromEditor = JSON.parse((await get("/api/docs/jobs.md")).body).content;
    check("saving the page keeps the tick", fromEditor.includes("- [x] call back"), true);
    check("...and the fence is still untouched",
      fromEditor.includes("```md\n- [ ] not a checkbox\n```"), true);
  }

  console.log("=== a reader is shown the boxes but cannot tick them ===");
  {
    const session = (role, permissions) => window.eval(`window.__t.applySession(${JSON.stringify({
      authenticated: true,
      permissions,
      user: { id: "u1", username: "reader", role, mustChangePassword: false },
      csrfToken: "t"
    })})`);
    const editorSession = window.eval("JSON.stringify(window.__t.state.permissions)");

    session("viewer", ["doc:read"]);
    await window.eval('window.__t.openDocument("jobs.md", false, { forceReload: true })');
    await new Promise((r) => setTimeout(r, 500));

    const boxes = [...doc.querySelectorAll('#docContent li input[type="checkbox"]')];
    check("a reader still sees the tasks", boxes.length, 2);
    check("...but every box is inert", boxes.map((b) => b.disabled), [true, true]);
    check("...and none is wired up",
      boxes.some((b) => b.hasAttribute("data-task-index")), false);
    check("...so there is nothing for a click to act on",
      window.eval("window.__t.state.taskMarkers.length"), 0);

    session("editor", JSON.parse(editorSession));
    await window.eval('window.__t.openDocument("jobs.md", false, { forceReload: true })');
    await new Promise((r) => setTimeout(r, 500));
    check("giving the permission back makes them live again",
      [...doc.querySelectorAll('#docContent li input[type="checkbox"]')].every((b) => !b.disabled), true);
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

  console.log("=== the links are a place you can go to, and come back from ===");
  {
    // They used to be a mode, reachable only from a sixth icon in the sidebar
    // drawer and invisible to the address bar — so they could not be
    // bookmarked, survived no refresh, and the back button could not undo the
    // trip into them.
    const docsBtn = doc.getElementById("placeDocsBtn");
    const linksBtn = doc.getElementById("placeLinksBtn");
    const search = doc.getElementById("searchInput");
    const where = () => window.eval("window.__t.state.viewMode");

    check("both halves of the library are on screen",
      [docsBtn.textContent.trim(), linksBtn.textContent.trim()], ["Files", "Links"]);
    check("...and the one you are in says so", docsBtn.getAttribute("aria-current"), "page");
    check("...and the other is a real address, not a button",
      [linksBtn.tagName, linksBtn.getAttribute("href")], ["A", "/links"]);

    // A document open and a document search in progress, so the trip can be
    // shown to eat neither.
    await window.eval(`window.__t.openDocument(${JSON.stringify(server.docPaths["alpha.md"] || "alpha.md")}, true)`);
    await new Promise((r) => setTimeout(r, 500));
    const rendered = doc.getElementById("docContent").firstElementChild;
    check("(a document is open before the trip)", Boolean(rendered), true);

    search.value = "alpha";
    await window.eval('window.__t.applySearch("alpha")');

    await window.eval('window.__t.goToPlace("links")');
    await waitUntil(() => where() === "links");

    check("going to the links puts them in the address bar",
      window.location.pathname, "/links");
    check("...and reading the address back agrees",
      window.eval("window.__t.viewFromLocation()"), "links");
    check("...and the switcher moves with it", linksBtn.getAttribute("aria-current"), "page");
    check("...and Files stops claiming to be where you are",
      docsBtn.hasAttribute("aria-current"), false);

    // A control that says where you are cannot also be a toggle: pressing
    // Links while among the links has to be nothing at all — in particular not
    // a second history entry, which Back would then have to be pressed twice
    // to get past.
    const entries = window.history.length;
    await window.eval('window.__t.goToPlace("links")');
    check("pressing Links again is not a way out", where(), "links");
    check("...and leaves no history entry behind it", window.history.length, entries);

    // Nothing in this pane is a document, so nothing that acts on one belongs
    // on the screen with it.
    check("there is nothing here to create", doc.getElementById("newDocBtn").hidden, true);
    check("...nor to edit", doc.getElementById("editDocBtn").hidden, true);
    check("...nor to upload into", doc.getElementById("uploadWrap").hidden, true);
    check("...nor a folder to make", doc.getElementById("createFolderBtn").hidden, true);
    check("...and the dock offers none of them either",
      [doc.getElementById("dockNew").hidden, doc.getElementById("dockUpload").hidden,
        doc.getElementById("dockEdit").hidden], [true, true, true]);

    // One search box, and it is about whatever is on the screen.
    check("the search box says what it filters now", search.placeholder, "Filter saved links");
    check("...and the document search was put down, not thrown away", search.value, "");

    window.eval(`window.__t.state.links = [
      { id: "p", url: "https://pyodide.org/", title: "Pyodide", description: "", note: "", groups: [], fetched: true },
      { id: "e", url: "https://expressjs.com/", title: "Express", description: "", note: "", groups: [], fetched: true }
    ];`);
    search.value = "pyo";
    await window.eval('window.__t.applySearch("pyo")');
    check("typing in it filters the links",
      [...doc.querySelectorAll("#linksGrid .link-card-title a")].map((a) => a.textContent), ["Pyodide"]);
    check("...and the sidebar counts links, not documents",
      doc.getElementById("searchMeta").textContent, "1 of 2");

    // The whole point of the address: the browser's own back button undoes it.
    window.history.back();
    await waitUntil(() => where() === "docs", 8000);
    check("back comes out of the links", where(), "docs");
    check("...and the pane goes with it", doc.getElementById("linksPane").hidden, true);

    // The article is only hidden while the links are up, never torn down, so
    // coming back is that class going back on. It used to refetch the library,
    // re-read every document to warm the search cache, and force-reload and
    // re-render the open one — which is what made the switch take seconds.
    check("...and the document is the one that was already rendered",
      rendered.isConnected, true);
    check("...shown again rather than rebuilt",
      doc.getElementById("docContent").classList.contains("visible"), true);
    check("...and the document search is handed back",
      [search.value, search.placeholder], ["alpha", "Search files and contents"]);
    check("...and Files is lit again", docsBtn.getAttribute("aria-current"), "page");

    // The same rule applies to the half you are already standing in. Pressing
    // Files among the files used to reload the whole library and redraw the
    // open document underneath you, which is a long way to go to arrive where
    // you already were.
    await window.eval(`window.__t.openDocument(${JSON.stringify(server.docPaths["alpha.md"] || "alpha.md")}, true)`);
    await new Promise((r) => setTimeout(r, 500));
    const standing = doc.getElementById("docContent").firstElementChild;
    check("(a document is open to be left alone)", Boolean(standing), true);

    await window.eval('window.__t.goToPlace("docs")');
    await new Promise((r) => setTimeout(r, 500));
    check("pressing Files while in the files does not redraw the document",
      standing.isConnected, true);

    // The icons for links nobody has ever asked about are collected in one
    // call. It used to be one PATCH per link, in a queue: seven round trips,
    // seven page reads and seven whole rewrites of the file, so they trickled
    // in over about ten seconds.
    {
      const calls = [];
      const realFetch = window.fetch;

      window.fetch = async (url, options = {}) => {
        calls.push(`${(options.method || "GET").toUpperCase()} ${String(url)}`);
        return {
          status: 200,
          ok: true,
          async json() {
            return {
              links: [{ id: "old", url: "https://x.example/", title: "Old", groups: [], icon: "" }],
              groups: [],
              fetched: 1,
              remaining: 0
            };
          },
          async text() { return ""; }
        };
      };

      try {
        window.eval('window.__t.state.links = [{ id: "old", url: "https://x.example/", title: "Old", groups: [] }];');
        await window.eval("window.__t.backfillLinkIcons()");
      } finally {
        // Restoring a stub this block installed itself; nothing else runs
        // against this window in between.
        // eslint-disable-next-line require-atomic-updates
        window.fetch = realFetch;
      }

      check("the missing icons are asked for in one request", calls, ["POST /api/links/icons"]);
      check("...and the list that comes back is the one that is kept",
        window.eval("window.__t.state.links.map((link) => link.icon)"), [""]);
      check("...which leaves nothing still to ask about",
        window.eval("window.__t.linksNeedingIcons()"), []);
    }

    // A switch that waits on the network has to look like it is waiting.
    window.eval('window.__t.setPlaceBusy("links", true)');
    check("a switch that has to wait says so", linksBtn.getAttribute("aria-busy"), "true");
    check("...with the glyph itself as the spinner",
      linksBtn.querySelector("i").className, "ph ph-circle-notch");

    window.eval('window.__t.setPlaceBusy("links", false)');
    check("...and gives the icon back when it lands",
      [linksBtn.hasAttribute("aria-busy"), linksBtn.querySelector("i").className],
      [false, "ph ph-link-simple"]);

    // Only around a real round trip: a move already in memory finishes in the
    // same frame, and a spinner inside one frame is a flicker, not an answer.
    check("a move that is already in memory never raises one",
      /if \(state\.linksLoaded\) \{[\s\S]{0,80}?renderLinks\(\);[\s\S]{0,40}?return true;/.test(appSource), true);

    // The free path back is only free from the links. The recycle bin and the
    // archive put deleted entries in the tree and in the filtered list, so
    // pressing Files from one of those has to reload however much is in
    // memory — restoring what the links pane left would put deleted documents
    // under a heading that says Files.
    await window.eval('window.__t.switchViewMode("recycle")');
    await waitUntil(() => where() === "recycle", 8000);
    check("(the recycle bin is open)", where(), "recycle");

    await window.eval('window.__t.goToPlace("docs")');
    await waitUntil(() => where() === "docs" && window.eval("window.__t.state.filteredDocs.length") > 0, 8000);
    check("pressing Files from the recycle bin reloads the library", where(), "docs");
    check("...with live documents in the list, not deleted ones",
      window.eval(`window.__t.state.filteredDocs.every((entry) =>
        window.__t.state.docs.some((doc) => doc.file === entry.file))`), true);

    // Typed, bookmarked or refreshed. The shell has to come back for this
    // address the same as for the root, or /links is a 404 the moment it
    // leaves this tab.
    const shell = await get("/links");
    check("/links is served as the app shell", shell.status, 200);
    check("...the same page the root is served", shell.body.includes('id="placeLinksBtn"'), true);

    // And the boot has to consult the address. This one is read off the source
    // rather than driven: initialize() runs once, at load, and there is no way
    // to make it run again at a different address inside a page that has
    // already booted.
    check("...and the boot looks at it before loading the library",
      /viewFromLocation\(\) === "links"[\s\S]{0,240}?await refreshLinks\(\)/.test(appSource), true);

    // Leave nothing behind for the sections after this one.
    search.value = "";
    await window.eval('window.__t.applySearch("")');
  }

  console.log("=== warming the search cache does not take the whole connection ===");
  {
    // The offline search fallback matches on document text, so every document
    // is read once in the background after the library loads. It used to ask
    // for all of them at once: a browser opens six connections to a host, so a
    // library of any size filled all six for as long as it took to move every
    // byte of it, and everything asked for in the meantime — opening a
    // document, the saved links, a search — waited behind that.
    let inFlight = 0;
    let peak = 0;
    const realFetch = window.fetch;

    window.fetch = async (url, options = {}) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      try {
        return await realFetch(url, options);
      } finally {
        inFlight -= 1;
      }
    };

    try {
      window.eval("window.__t.state.contentCache.clear();");
      await window.eval("window.__t.hydrateSearchContent()");
    } finally {
      // Restoring a stub this block installed itself; nothing else runs
      // against this window in between.
      // eslint-disable-next-line require-atomic-updates
      window.fetch = realFetch;
    }

    check("a few at a time, not all of them at once", peak <= 3, true);
    check("...and there was enough of a library for that to mean something",
      window.eval("window.__t.state.docs.length") > 10, true);
    check("...and every document still ends up in the cache",
      window.eval("window.__t.state.docs.every((doc) => window.__t.state.contentCache.has(doc.file))"),
      true);
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

    // The third button belongs to the unsaved-work question alone. Every other
    // dialog here is a yes or a no, and ninety call sites read the answer as
    // one, so it has to stay a boolean for them.
    const asking = window.eval(`window.__t.requestConfirmation({
      title: "Ordinary", message: "Two answers", confirmLabel: "Go"
    })`);
    await new Promise((r) => setTimeout(r, 60));
    check("an ordinary confirmation has two answers, not three",
      doc.getElementById("confirmAltBtn").hidden, true);
    window.eval("window.__t.resolveConfirmDialog(false)");
    check("...and answers with a plain false", await asking, false);
  }

  console.log("=== console output ===");
  const realErrors = consoleErrors.filter((e) => !/Could not parse CSS|Not implemented/.test(e));
  check("no errors logged during load", realErrors, []);
}
