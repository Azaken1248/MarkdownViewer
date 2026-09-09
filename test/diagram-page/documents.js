// Part of the diagram-page suite. See diagram-page.test.js, which sets all this
// up and calls it.
//
// The page's address, and a diagram going out of a document and back into it.
//
// Everything it needs is handed to it: the suite's own check(), the helpers
// that boot a page and drag a box, and the fixtures. Split out of one file only
// because that file had grown well past a thousand lines.
module.exports = async (ctx) => {
  const {
    check, server, cookie, origin, JSDOM, pageHtml, pagesSource, DIAGRAM_DOC, settle, boot,
    openPage, saveAndWait, csrfFor, addressOf, dragBox
  } = ctx;

  console.log("=== the page has an address of its own ===");
  {
    // A document path is a document path wherever it appears, so /diagram/doc/
    // has to be kept out of the shell route or opening the editor would serve
    // the app instead.
    check("the editor's address is not read as a document",
      /SHELL_RESERVED_PREFIXES = \[[^\]]*"\/diagram"/.test(pagesSource), true);

    for (const [what, url] of [
      ["a fence inside a document", "/diagram/doc/Notes/deploy.md"],
      ["a diagram file", "/diagram/file/plan.mmd"]
    ]) {
      const res = await server.request("GET", url, undefined, { Cookie: cookie });
      check(`${what} gets the editor page`, res.status, 200);
      /* By what the page *is*, not by the name of a script it loads: with a
       * build in place the editor's scripts are one bundle and none of them is
       * called diagram-page.js any more. The canvas is only on this page and
       * the document view is only on the other, so the pair says both halves.
       */
      check("...which is the editor and not the app",
        [res.raw.includes('id="diagramCanvas"'), res.raw.includes('id="docContent"')],
        [true, false]);
    }

    // Same reason the document shell does not: answering differently for a real
    // path and an imaginary one is a list of what is in the library.
    const missing = await server.request("GET", "/diagram/doc/nothing/here.md", undefined, { Cookie: cookie });
    check("a document that is not there gets the same page as one that is", missing.status, 200);

    const signedOut = await server.request("GET", "/diagram/doc/Notes/deploy.md");
    check("...and so does a reader with no session", signedOut.status, 200);

    const nonsense = await server.request("GET", "/diagram/elsewhere", undefined, { Cookie: cookie });
    check("an address that names neither is not the editor", nonsense.status, 404);
  }

  console.log("=== a diagram inside a document ===");
  {
    const made = await server.request("POST", "/api/docs",
      { fileName: "deploy.md", content: DIAGRAM_DOC, overwrite: true },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });
    check("the fixture document is there to be edited", made.status, 201);

    const address = addressOf(DIAGRAM_DOC, 0);
    const page = await openPage({
      url: `${origin}/diagram/doc/deploy.md#${address}`,
      cookie,
      origin
    });

    check("the page reads the document it was opened on",
      page.requested.some((one) => one.url === "/api/docs/deploy.md"), true);
    check("...and draws the diagram that was in it",
      page.document.querySelectorAll(".dd-node").length, 2);
    check("...naming the file it belongs to",
      page.document.getElementById("diagramTitle").textContent, "deploy.md");
    check("nothing is saveable until something is changed",
      page.document.getElementById("diagramSave").disabled, true);

    /* The theme. This page loads none of app.js, so it used to have no way to
     * change the theme at all — the whole cycle lived in a file it does not
     * load. It lives in theme-boot.js now, which every page with a theme runs
     * before it paints, so there is one cycle rather than two to disagree.
     */
    const themeButton = page.document.getElementById("diagramTheme");
    const themeNow = () => page.document.documentElement.dataset.theme;
    const wanted = () => page.document.documentElement.dataset.themePreference;

    check("the page has a way to change the theme", Boolean(themeButton), true);
    check("...saying what it is now and what pressing it does",
      /dark theme\. switch to light/i.test(themeButton.getAttribute("aria-label")), true);
    check("...starting where the library starts", [wanted(), themeNow()], ["dark", "dark"]);

    themeButton.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    check("pressing it goes to the next one", [wanted(), themeNow()], ["light", "light"]);
    check("...and says so", themeButton.querySelector("i").className, "ph ph-sun");

    themeButton.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    check("...and then to following the system", wanted(), "auto");
    // "Auto" is a preference, not a palette. What goes on the page has to be
    // one of the two real ones or the stylesheet has nothing to paint with.
    check("...which is put on the page as whichever one that turns out to be",
      ["dark", "light"].includes(themeNow()), true);

    // Written down under the same name the library uses, or the two pages
    // disagree about the theme the moment you move between them.
    check("...and the choice is kept where the library keeps it",
      page.window.localStorage.getItem("mdviewer.theme"), "auto");

    themeButton.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    check("...and round to the start again", wanted(), "dark");

    // Move a box. That is an edit to the layout comments and nothing else, and
    // it is the smallest edit the canvas can make.
    dragBox(page.window, "A", 60, 40);
    await settle();

    check("moving a box makes the diagram saveable",
      page.document.getElementById("diagramSave").disabled, false);

    page.document.getElementById("diagramSave").click();
    await settle();

    const saved = await server.request("GET", "/api/docs/deploy.md", undefined, { Cookie: cookie });
    check("saving writes the document back", /%% @ A /.test(saved.body.content), true);
    check("...with everything around the diagram untouched",
      saved.body.content.startsWith("# Deployment\n\nBefore the diagram.\n\n```mermaid\n"), true);
    check("...and the prose after it still after it",
      saved.body.content.endsWith("```\n\nAfter the diagram.\n"), true);
    check("...and it is still a mermaid fence",
      (saved.body.content.match(/```/g) || []).length, 2);

    /* And again. The address is half an index and half a hash of what is in the
     * block, so saving the block is what makes it stop matching — and the
     * address has to be taken again from what was actually written. Looked up
     * by the address it already had, it found a body that had just been
     * replaced, found nothing, and left the address pointing at a block that no
     * longer existed. Which the second save then said out loud.
     */
    dragBox(page.window, "A", 20, 0);
    await settle();
    check("a second edit is saveable too",
      page.document.getElementById("diagramSave").disabled, false);

    await saveAndWait(page);
    check("...and saving it does not say the block has gone",
      /no longer in the document/.test(page.document.getElementById("diagramStatus").textContent),
      false);

    const twice = await server.request("GET", "/api/docs/deploy.md", undefined, { Cookie: cookie });
    check("...and the second edit reaches the file too",
      twice.body.content !== saved.body.content, true);
    check("...with the document still whole around it",
      twice.body.content.startsWith("# Deployment\n\nBefore the diagram.\n\n```mermaid\n")
        && twice.body.content.endsWith("```\n\nAfter the diagram.\n"), true);
  }

  console.log("=== a stash belongs to one document ===");
  {
    // The stash is keyed by the document it holds, and a page that reached for
    // any stash at all would open one document with the contents of another.
    await server.request("POST", "/api/docs",
      { fileName: "other.md", content: DIAGRAM_DOC, overwrite: true },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const address = addressOf(DIAGRAM_DOC, 0);
    const dom = new JSDOM(pageHtml, {
      url: `${origin}/diagram/doc/other.md#${address}`,
      runScripts: "outside-only",
      pretendToBeVisual: true
    });
    dom.window.sessionStorage.setItem("azadocs:diagram:something-else.md", "# Not this one\n");

    const page = await boot(dom, { cookie, origin });
    check("a stash for another document is not used",
      page.requested.some((one) => one.url === "/api/docs/other.md"), true);
    check("...and the diagram that opens is the one in this document",
      page.document.querySelectorAll(".dd-node").length, 2);
  }

  console.log("=== ...and comes back the same way ===");
  {
    const unsaved = DIAGRAM_DOC.replace("Before the diagram.", "Before the diagram, edited and not saved.");
    const address = addressOf(unsaved, 0);
    const url = `${origin}/diagram/doc/deploy.md#${address}`;

    const page = await openPage({ url, cookie, origin, stash: unsaved });
    const dom = page.dom;

    check("the stashed document is used instead of the file",
      page.requested.some((one) => one.url === "/api/docs/deploy.md"), false);
    check("...and the diagram in it is the one that is drawn",
      page.document.querySelectorAll(".dd-node").length, 2);

    dragBox(page.window, "A", 60, 40);
    await settle();
    page.document.getElementById("diagramSave").click();
    await settle();

    const held = dom.window.sessionStorage.getItem("azadocs:diagram:deploy.md");
    check("saving puts the whole document back where it came from",
      held.includes("Before the diagram, edited and not saved."), true);
    check("...with the diagram changed", /%% @ A /.test(held), true);

    const onDisk = await server.request("GET", "/api/docs/deploy.md", undefined, { Cookie: cookie });
    check("...and nothing at all written to the file",
      onDisk.body.content.includes("edited and not saved"), false);
  }

  console.log("=== a diagram whose block is gone is not written anywhere ===");
  {
    const address = addressOf(DIAGRAM_DOC, 0);
    const url = `${origin}/diagram/doc/deploy.md#${address}`;

    const page = await openPage({ url, cookie, origin, stash: DIAGRAM_DOC });
    const dom = page.dom;

    dragBox(page.window, "A", 60, 40);
    await settle();

    // Somebody deleted the block in the other tab while this one was open.
    dom.window.sessionStorage.setItem("azadocs:diagram:deploy.md", "# Deployment\n\nNo diagram any more.\n");
    page.document.getElementById("diagramSave").click();
    await settle();

    check("the page says the block is gone",
      /no longer in the document/i.test(page.document.getElementById("diagramStatus").textContent), true);
    check("...and writes nothing over what is there now",
      dom.window.sessionStorage.getItem("azadocs:diagram:deploy.md"),
      "# Deployment\n\nNo diagram any more.\n");
  }

  console.log("=== a diagram file is the whole file ===");
  {
    const made = await server.request("POST", "/api/docs",
      { fileName: "plan.mmd", content: "flowchart LR\n  Start --> Finish\n", overwrite: true },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });
    check("the fixture diagram file is there to be edited", made.status, 201);

    const page = await openPage({ url: `${origin}/diagram/file/plan.mmd`, cookie, origin });
    check("a .mmd file opens with no address at all",
      page.document.querySelectorAll(".dd-node").length, 2);

    dragBox(page.window, "Start", 60, 40);
    await settle();
    page.document.getElementById("diagramSave").click();
    await settle();

    const saved = await server.request("GET", "/api/docs/plan.mmd", undefined, { Cookie: cookie });
    check("saving writes the diagram and nothing around it",
      saved.body.content.startsWith("flowchart LR\n"), true);
    check("...with its arrangement in it", /%% @ Start /.test(saved.body.content), true);
    check("...and no fence wrapped round it", saved.body.content.includes("```"), false);
    check("...ending in one newline, the way a file does",
      /[^\n]\n$/.test(saved.body.content), true);
  }

  console.log("=== a diagram says more than the canvas can change ===");
  {
    /* The canvas has controls for boxes and arrows. A diagram can say more than
     * that — what colour a class is, what layers there are, keys written by a
     * later version of this editor than the one open. None of it can be edited
     * here yet, and every bit of it has to come back out unchanged: an editor
     * that quietly drops what it has no button for is an editor that eats work.
     */
    const coloured = [
      "flowchart TD",
      "    %% layout v1",
      "    %% @ A 40,40 120x50 shadow=soft",
      "    %% @ B 40,200 120x50",
      "    %% layer 2 \"Back end\" locked",
      "    A[One]:::blue",
      "    B[Two]",
      "    A --> B",
      "    classDef blue fill:#2b6cb0,stroke:#1a365d",
      "    style B fill:#eee"
    ].join("\n") + "\n";

    await server.request("POST", "/api/docs",
      { fileName: "styled.mmd", overwrite: true, content: coloured },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/styled.mmd`, cookie, origin });
    check("a coloured diagram opens", page.document.querySelectorAll(".dd-node").length, 2);

    dragBox(page.window, "A", 60, 40);
    await saveAndWait(page);

    const saved = (await server.request("GET", "/api/docs/styled.mmd", undefined, { Cookie: cookie })).body.content;
    check("moving a box moves the box", /%% @ A (?!40,40)/.test(saved), true);
    // The class each box wears was never in danger — it is written on the box.
    // What went missing was what the class means, which left the names behind
    // pointing at nothing.
    check("...and what its colour means is still there",
      saved.includes("classDef blue fill:#2b6cb0,stroke:#1a365d"), true);
    check("...along with the box that wears it", saved.includes("class A blue"), true);
    check("...the one-off colour on the other box", saved.includes("style B fill:#eee"), true);
    check("...the layer nothing here can show yet",
      saved.includes('%% layer 2 "Back end" locked'), true);
    check("...and a key written by a version this one has never met",
      saved.includes("shadow=soft"), true);
  }

};
