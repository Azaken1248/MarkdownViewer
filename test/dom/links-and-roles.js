// Part of the DOM suite. See dom.test.js, which sets all this up and calls it.
//
// The editor tabs, saved links as a place of their own, uploads, and what each
// role is allowed to see.
//
// Everything it needs is handed to it: the suite's own check(), the window the
// app is running in, and the handles the setup built. Split out of one file
// only because that file had grown past a thousand lines.
module.exports = async (ctx) => {
  const {
    check, waitUntil, get, server, window, doc, ROOT, fs, path, clientSource, styleSource,
    coreSource
  } = ctx;

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
      /if \(state\.linksLoaded\) \{[\s\S]{0,80}?renderLinks\(\);[\s\S]{0,40}?return true;/.test(clientSource), true);

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
      /viewFromLocation\(\) === "links"[\s\S]{0,240}?await refreshLinks\(\)/.test(clientSource), true);

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
    const core = coreSource(ROOT);
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
    const css = styleSource(ROOT);
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

};
