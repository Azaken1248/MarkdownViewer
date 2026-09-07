// Part of the DOM suite. See dom.test.js, which sets all this up and calls it.
//
// Editing a document where it is drawn, and the diagram builder it opens.
//
// Everything it needs is handed to it: the suite's own check(), the window the
// app is running in, and the handles the setup built. Split out of one file
// only because that file had grown past a thousand lines.
module.exports = async (ctx) => {
  const {
    check, waitUntil, get, window, doc, clipboardWrites, clientSource
  } = ctx;

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

  console.log("=== a diagram is built on a page of its own ===");
  {
    /* Three diagrams, and the difference between them is the whole safety
     * story: the canvas offers to build what it can read all of, and says
     * nothing about the rest. Steps and arrows it reads; a subgraph it reads
     * now that a group is drawn; a sequence diagram it does not read at all,
     * and an editor that opened one would be an editor that saved a flowchart
     * over it.
     *
     * The canvas used to open inside the block as well, in a strip a few
     * hundred pixels tall with the document either side of it. Everything it
     * has grown since — a palette, an inspector, a zoom bar, arrows drawn by
     * dragging — wants room, and a page has room. So Build goes to the page,
     * and this is the document editor's half of that: what it offers, and what
     * it hands across.
     */
    const source = "# Flow\n\n```mermaid\nflowchart TD\n  A[Start] --> B[End]\n```\n\n```mermaid\nflowchart TD\n  subgraph outer\n  C --> D\n  end\n```\n\n```mermaid\nsequenceDiagram\n  A->>B: hello\n```\n\nAfter.\n";

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
    check("every diagram is a block that keeps its source", embeds.length, 3);
    check("the one the canvas understands offers to build it",
      Boolean(embeds[0].querySelector(".ve-embed-build")), true);
    check("...and so does the one with a group in it",
      Boolean(embeds[1].querySelector(".ve-embed-build")), true);
    check("...while one that is not a flowchart at all does not",
      Boolean(embeds[2].querySelector(".ve-embed-build")), false);
    check("...which still leaves it editable as markdown",
      embeds[2].querySelector(".ve-embed-edit").textContent.trim(), "Edit code (mermaid)");
    check("a buildable diagram calls its source button by the shorter name",
      embeds[0].querySelector(".ve-embed-source-open").textContent.trim(), "Markdown");

    // One way in. Two buttons that both opened a canvas, one of them in a strip
    // too small for it, was one button too many.
    check("...and one way in, not two",
      embeds[0].querySelectorAll(".ve-embed-build, .ve-embed-expand").length, 1);

    /* What Build hands across. jsdom cannot navigate, so what is checked here
     * is the half that matters: the document is left where the diagram page
     * will find it, unsaved changes and all, before anything navigates.
     */
    const typed = window.eval("window.__t.collectPageMarkdown()");
    check("the document has the diagram in it to begin with",
      typed.includes("flowchart TD"), true);

    embeds[0].querySelector(".ve-embed-build")
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    const across = window.eval('window.sessionStorage.getItem("azadocs:diagram:flow.md")');
    check("Build leaves the document where the diagram page will find it",
      typeof across === "string", true);
    check("...as the document on screen rather than the one on disk", across, typed);
    check("...and does not open a canvas in the block instead",
      doc.querySelectorAll("#docContent .ve-diagram-canvas").length, 0);


    // Left behind, it would be picked up by an edit weeks later and quietly
    // undo everything in between. The block after this one takes it properly.
    window.eval('window.sessionStorage.removeItem("azadocs:diagram:flow.md")');
    await window.eval("window.__t.cancelPageEdit({ confirm: false })");
    await new Promise((r) => setTimeout(r, 200));
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
      Boolean(embed.querySelector(".ve-embed-build")), true);

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
    const restoreState = clientSource.slice(clientSource.indexOf("function applyPageHistoryState"));
    const body = restoreState.slice(0, restoreState.indexOf("\n}\n"));
    check("the scroll position is read before the document is re-rendered",
      body.indexOf("viewer.scrollTop") < body.indexOf("renderPageEditor(entry.markdown)"), true);
    check("...and written back after it",
      body.lastIndexOf("viewer.scrollTop = offset") > body.indexOf("renderPageEditor(entry.markdown)"), true);

    window.eval("window.__t.undoPageEdit()");
    const focused = doc.activeElement;
    check("the caret lands back in a block of the document",
      Boolean(focused && focused.closest("#docContent .ve-block")), true);

    /* Inserting a diagram goes to the thing you make a diagram with.
     *
     * A diagram is a fence, and for the frame between rendering the block and
     * drawing the diagram in it there is a <pre><code> in there holding the
     * Mermaid source. Whatever decides where the caret goes has to know that is
     * a diagram rather than a code block, or it focuses an element nobody can
     * type into and the button looks like it did nothing.
     */
    window.eval('window.__t.insertPageBlock("mermaid")');
    const madeDiagram = doc.querySelector("#docContent .ve-embed .ve-embed-build");
    check("inserting a diagram offers to build it", Boolean(madeDiagram), true);
    check("...and reaches for that rather than for the caret",
      Boolean(doc.activeElement?.closest?.("pre")), false);
    check("...having handed the document across on the way",
      typeof window.eval(
        `window.sessionStorage.getItem(window.__t.diagramStashKey(window.__t.state.pageEdit.file))`),
      "string");
    window.eval(
      `window.sessionStorage.removeItem(window.__t.diagramStashKey(window.__t.state.pageEdit.file))`);

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

};
