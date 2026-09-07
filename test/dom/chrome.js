// Part of the DOM suite. See dom.test.js, which sets all this up and calls it.
//
// The furniture around the document: toasts, dialogs, the theme, the bins,
// notebooks and the saved links.
//
// Everything it needs is handed to it: the suite's own check(), the window the
// app is running in, and the handles the setup built. Split out of one file
// only because that file had grown past a thousand lines.
module.exports = async (ctx) => {
  const {
    check, server, window, doc, ROOT, fs, path, clientSource
  } = ctx;

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
    check("focus returns to whatever opened it", doc.activeElement === opener, true);
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
    const app = withoutComments(clientSource);
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

};
