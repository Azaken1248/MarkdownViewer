// Part of the DOM suite. See dom.test.js, which sets all this up and calls it.
//
// The source editor's keys, the address bar, the insert bar, pasted pictures
// and the checkboxes on the page.
//
// Everything it needs is handed to it: the suite's own check(), the window the
// app is running in, and the handles the setup built. Split out of one file
// only because that file had grown past a thousand lines.
module.exports = async (ctx) => {
  const {
    check, waitUntil, get, server, window, doc, execCommands, clientSource
  } = ctx;

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
    check("...and the caret still in the text it was in", doc.activeElement === area, true);

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
      const from = clientSource.slice(clientSource.indexOf(`function ${name}(options) {`));
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
    const diagram = [...doc.querySelectorAll("#docContent .ve-embed")]
      .find((one) => one.querySelector(".ve-embed-build"));
    check("a diagram appears", Boolean(diagram), true);
    check("...offering the canvas you make one on",
      Boolean(diagram.querySelector(".ve-embed-build")), true);
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

};
