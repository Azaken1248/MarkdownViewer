// Part of the DOM suite. See dom.test.js, which sets all this up and calls it.
//
// The page editor's refusals, and the formatting bar's own.
//
// test/dom/page-editor.js drives editing a document on the page: the blocks,
// the history, the save, the handoff to the canvas. What nothing reached was
// the other half of app/page-edit.js — every reason it will not start, the
// document that goes somewhere else instead, and the places the toolbar has
// to say "not like that" rather than doing something approximate.
module.exports = async (ctx) => {
  const {
    check, waitUntil, window, doc, server, cookieHeader, execCommands, execCommandCalls,
    consoleErrors
  } = ctx;

  const run = (source) => window.eval(source);
  const state = () => run("window.__t.state");
  const said = () => [...doc.querySelectorAll("#toastStack .toast, #toastStackUrgent .toast")]
    .map((one) => one.querySelector(".toast-message")?.textContent || "");
  const clearToasts = () => doc.querySelectorAll(".toast").forEach((one) => one.remove());
  const settle = () => new Promise((resolve) => setTimeout(resolve, 80));
  const editing = () => run("window.__t.pageEditActive()");

  const csrf = () => state().csrfToken;
  const made = async (name, content) => {
    await server.request("POST", "/api/docs",
      { fileName: name, overwrite: true, content },
      { Cookie: cookieHeader(), "X-CSRF-Token": csrf() });
  };
  const binned = async (name) => {
    await server.request("POST", `/api/docs/${name}/delete`, { mode: "soft" },
      { Cookie: cookieHeader(), "X-CSRF-Token": csrf() });
  };

  const openOn = async (file) => {
    await run(`window.__t.openDocument(${JSON.stringify(file)}, false, { forceReload: true })`);
    await waitUntil(() => state().activeFile === file, 6000);
  };
  const blocks = () => [...doc.querySelectorAll('#docContent .ve-block[contenteditable="true"]')];

  await made("page-plain.md", "# Plain\n\nSomething to edit.\n");
  await made("page-empty.md", "");
  await run("window.__t.refreshDocs({ preserveSearch: true })");

  console.log("=== every reason Edit will not start ===");
  {
    /* The reasons are one list in the source rather than a run of guards, and
     * the list is in a deliberate order: the recycle bin before "nothing is
     * open", because a bin row *is* open and the answer about it is the
     * useful one.
     */
    await openOn("page-plain.md");
    await run('window.__t.switchViewMode("recycle")');
    await waitUntil(() => state().viewMode === "recycle", 6000);
    clearToasts();
    await run("window.__t.startPageEdit()");
    check("a deleted document says to restore it first",
      [editing(), said().at(-1)], [false, "Restore this document before editing it."]);

    await run('window.__t.switchViewMode("docs")');
    await waitUntil(() => state().viewMode === "docs", 6000);
    await waitUntil(() => state().docs.length > 0, 6000);

    run("window.__t.state.activeFile = null");
    clearToasts();
    await run("window.__t.startPageEdit()");
    check("with nothing open it says to open something",
      [editing(), said().at(-1)], [false, "Open a document first, then choose Edit."]);

    const notebook = state().docs.find((one) => one.file.endsWith(".ipynb"));
    run(`window.__t.state.activeFile = ${JSON.stringify(notebook.file)}`);
    clearToasts();
    await run("window.__t.startPageEdit()");
    /* A notebook is JSON with the output of every cell in it. Cutting it into
     * markdown blocks and writing them back would be a document destroyed by
     * an edit that looked ordinary.
     */
    check("a notebook is view-only, and says so without calling it an error",
      [editing(), said().at(-1)], [false, "Notebook files are view-only in this viewer."]);

    await openOn("page-plain.md");
    run(`window.__t.applySession({ authenticated: true, publicReads: false,
      user: { id: "u1", username: "reader", role: "viewer", mustChangePassword: false },
      permissions: ["doc:read"], csrfToken: window.__t.state.csrfToken })`);
    clearToasts();
    await run("window.__t.startPageEdit()");
    check("a reader is told it is their account, not the document",
      [editing(), said().at(-1)], [false, "Your account cannot edit documents."]);

    await run("window.__t.refreshSession()");
    await waitUntil(() => run('window.__t.can("doc:write")'), 6000);
  }

  console.log("=== and the ones that are not refusals ===");
  {
    await openOn("page-plain.md");
    await run("window.__t.startPageEdit()");
    await waitUntil(() => editing(), 6000);

    clearToasts();
    const before = run("window.__t.collectPageMarkdown()");
    await run("window.__t.startPageEdit()");
    check("Edit pressed twice is not a second editor",
      [editing(), run("window.__t.collectPageMarkdown()"), said()], [true, before, []]);

    await run("window.__t.cancelPageEdit({ confirm: false })");
    await waitUntil(() => editing() === false, 6000);

    check("leaving an editor that is not open is not a refusal",
      await run("window.__t.cancelPageEdit()"), true);

    clearToasts();
    await run("window.__t.openSourceFromPageEdit()");
    check("...and neither is handing a document over that nobody is editing",
      [state().editorOpen, said()], [false, []]);
  }

  console.log("=== a document with nothing in it ===");
  {
    /* An empty file has no blocks, so there is nowhere to put the cursor: the
     * editor would open on a document that cannot be typed into. One
     * paragraph is made for it, and it is the only block in the app allowed
     * to show words the file does not contain.
     */
    await openOn("page-empty.md");
    await run("window.__t.startPageEdit()");
    await waitUntil(() => editing(), 6000);

    check("an empty document is given somewhere to type", blocks().length, 1);
    check("...with a placeholder, since it is the one block that is empty by accident",
      blocks()[0].classList.contains("ve-placeholder"), true);
    check("...and the file is still empty until something is typed",
      run("window.__t.collectPageMarkdown()").trim(), "");

    await run("window.__t.cancelPageEdit({ confirm: false })");
    await waitUntil(() => editing() === false, 6000);
  }

  console.log("=== a document that goes somewhere else instead ===");
  {
    /* A .mmd file is diagram source and the whole file is the diagram, so
     * Edit means the canvas rather than a page of text blocks — when the
     * canvas can read it. When it cannot, the source editor opens instead:
     * a canvas that opened a diagram it half-understood would save a
     * flowchart over somebody's sequence diagram.
     */
    await made("page-drawable.mmd", "flowchart TD\n  A[Start] --> B[End]\n");
    await made("page-unreadable.mmd", "sequenceDiagram\n  A->>B: hello\n");
    await run("window.__t.refreshDocs({ preserveSearch: true })");

    /* jsdom will not let a test stand in for window.location — href is
     * unforgeable — and its "navigation" complaint carries no URL, so what is
     * read here is that a navigation was attempted at all, and that the two
     * files part company: one leaves the page, the other opens the source
     * editor without going anywhere. Where it goes is checked by the
     * diagram-page suite from the other end.
     */
    const navigations = () => consoleErrors.filter((one) => /navigation/.test(one)).length;

    await openOn("page-drawable.mmd");
    clearToasts();
    const before = navigations();
    await run("window.__t.startPageEdit()");
    await waitUntil(() => navigations() > before, 8000);
    check("a diagram the canvas can read leaves this page",
      navigations() > before, true);
    check("...rather than opening as a page of text blocks or in the source editor",
      [editing(), state().editorOpen], [false, false]);

    await openOn("page-unreadable.mmd");
    clearToasts();
    const settled = navigations();
    await run("window.__t.startPageEdit()");
    await waitUntil(() => state().editorOpen, 8000);
    check("one it cannot read opens in the source editor instead",
      [state().editorOpen, state().editorFile], [true, "page-unreadable.mmd"]);
    check("...and stays on this page", navigations(), settled);
    run("window.__t.closeEditor()");
  }

  console.log("=== a document that cannot be read, and one left behind ===");
  {
    await made("page-vanishing.md", "# Vanishing\n");
    await run("window.__t.refreshDocs({ preserveSearch: true })");
    await openOn("page-vanishing.md");
    await binned("page-vanishing.md");
    await settle();
    await waitUntil(() => {
      run('window.__t.state.contentCache.delete("page-vanishing.md")');
      return !run('window.__t.state.contentCache.has("page-vanishing.md")');
    }, 4000);

    clearToasts();
    await run("window.__t.startPageEdit()");
    await waitUntil(() => said().length > 0, 6000);
    check("a document the server will not give up does not open an editor",
      [editing(), said().length > 0], [false, true]);

    /* Loading is async and the sidebar is not. Somebody who clicks Edit and
     * then clicks another document must not find themselves editing the one
     * they left — the content arrives for a file that is no longer the one
     * on screen.
     */
    const realFetch = window.fetch;
    const useFetch = (fn) => { window.fetch = fn; };
    useFetch(async (url, options = {}) => {
      if (String(url).includes("page-plain.md")) {
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      return realFetch(url, options);
    });

    await openOn("page-plain.md");
    run('window.__t.state.contentCache.delete("page-plain.md")');
    clearToasts();
    const starting = run("window.__t.startPageEdit()");
    await settle();
    run('window.__t.state.activeFile = "page-empty.md"');
    await starting;
    useFetch(realFetch);
    check("the editor does not open on the document the reader left",
      [editing(), said()], [false, []]);
  }

  console.log("=== saving a document nobody changed ===");
  {
    await openOn("page-plain.md");
    await run("window.__t.startPageEdit()");
    await waitUntil(() => editing(), 6000);

    clearToasts();
    await run("window.__t.savePageEdit({ exit: false })");
    await waitUntil(() => said().length > 0, 6000);
    check("saving an untouched document says there was nothing to save",
      said().at(-1), "No changes to save in page-plain.md.");
    check("...and leaves the editor open, since Ctrl+S means carry on",
      editing(), true);

    clearToasts();
    await run("window.__t.savePageEdit({ exit: true })");
    await waitUntil(() => editing() === false, 6000);
    /* Done with it is done with it: the same sentence, but the page goes back
     * to being a page. A Save button that left the editor open on a document
     * it had nothing to write would look like it had failed.
     */
    check("...while Save closes the editor and says the same thing",
      [editing(), said().at(-1)], [false, "No changes to save in page-plain.md."]);
    check("...with the document back on the page rather than its blocks",
      [doc.querySelectorAll('#docContent .ve-block').length,
        doc.getElementById("docContent").textContent.includes("Something to edit")],
      [0, true]);
  }

  console.log("=== and one the server refuses to take ===");
  {
    await run("window.__t.startPageEdit()");
    await waitUntil(() => editing(), 6000);
    const block = blocks()[0];
    block.innerHTML = "<h1>Refused</h1>";
    block.dispatchEvent(new window.Event("input", { bubbles: true }));

    const realFetch = window.fetch;
    const useFetch = (fn) => { window.fetch = fn; };
    useFetch(async (url, options = {}) => (
      (options.method || "GET").toUpperCase() === "PUT"
        ? { status: 507, ok: false, async json() { return { error: "No room left." }; },
          async text() { return "{}"; } }
        : realFetch(url, options)));

    clearToasts();
    await run("window.__t.savePageEdit({ exit: true })");
    await waitUntil(() => said().length > 0, 6000);
    useFetch(realFetch);

    check("a save the server refuses says why", said().at(-1), "No room left.");
    check("...and leaves the editing where it is, which is where the work is",
      [editing(), run("window.__t.collectPageMarkdown()").includes("Refused")], [true, true]);
    check("...with the Save button usable again rather than stuck",
      doc.getElementById("pageEditSaveBtn").disabled, false);

    await run("window.__t.cancelPageEdit({ confirm: false })");
    await waitUntil(() => editing() === false, 6000);
  }

  console.log("=== the formatting bar's own refusals ===");
  {
    await openOn("page-plain.md");
    await run("window.__t.startPageEdit()");
    await waitUntil(() => editing(), 6000);

    const putCursorIn = (node, text = "") => {
      const range = doc.createRange();
      range.selectNodeContents(node);
      if (text) {
        const at = node.textContent.indexOf(text);
        range.setStart(node.firstChild, at);
        range.setEnd(node.firstChild, at + text.length);
      } else {
        range.collapse(true);
      }
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    };

    // Nothing selected anywhere: the bar says where to put the cursor rather
    // than formatting whichever block it finds first.
    /* Caught rather than let through: without the guard these reach into a
     * block that is not there, and a check that dies on the exception takes
     * the rest of the file with it instead of saying which guard went.
     */
    const tried = (source) => {
      try {
        run(source);
        return null;
      } catch (error) {
        return error.message;
      }
    };

    window.getSelection().removeAllRanges();
    clearToasts();
    execCommands.length = 0;
    check("a command with the cursor nowhere says where to put it",
      [tried('window.__t.applyVisualCommand("bold")'), said().at(-1), execCommands],
      [null, "Put the cursor in the text first.", []]);

    clearToasts();
    execCommands.length = 0;
    check("...and so does a block format",
      [tried('window.__t.applyVisualBlockFormat("h2")'), said().at(-1), execCommands],
      [null, "Put the cursor in the text first.", []]);

    const target = blocks()[1] || blocks()[0];
    target.textContent = "words to mark up";

    putCursorIn(target);
    clearToasts();
    execCommands.length = 0;
    run('window.__t.applyVisualCommand("code")');
    /* Code is the one inline command that needs a selection: there is no
     * sensible placeholder for it, and marking the whole block as code
     * because nothing was selected is a paragraph destroyed by a click.
     */
    check("code with nothing selected asks for a selection",
      [said().at(-1), execCommands], ["Select the text to mark as code.", []]);

    putCursorIn(target, "words");
    execCommands.length = 0;
    run('window.__t.applyVisualCommand("code")');
    check("...and with something selected it marks it up",
      execCommands.includes("insertHTML"), true);

    // The link command asks for an address, which jsdom has no prompt for.
    const ask = (fn) => { window.prompt = fn; };
    const realPrompt = window.prompt;

    putCursorIn(target, "words");
    execCommands.length = 0;
    ask(() => null);
    run('window.__t.applyVisualCommand("link")');
    check("a link whose address was not given writes nothing", execCommands, []);

    putCursorIn(target, "words");
    execCommands.length = 0;
    ask(() => "https://example.com/here");
    run('window.__t.applyVisualCommand("link")');
    check("...one over selected words is a link around them",
      execCommands.includes("createLink"), true);

    putCursorIn(target);
    execCommands.length = 0;
    execCommandCalls.length = 0;
    ask(() => "https://example.com/bare");
    run('window.__t.applyVisualCommand("link")');
    /* With nothing selected the address becomes its own label, so the link
     * is visible rather than an anchor around no text at all. jsdom runs no
     * execCommand, so what it was asked to insert is what is read.
     */
    check("...and one with nothing selected writes the address as the words",
      execCommandCalls.at(-1),
      { name: "insertHTML",
        value: '<a href="https://example.com/bare">https://example.com/bare</a>' });
    ask(realPrompt);

    putCursorIn(target);
    execCommands.length = 0;
    run('window.__t.applyVisualCommand("underline")');
    check("a command this bar does not have does nothing at all", execCommands, []);

    await run("window.__t.cancelPageEdit({ confirm: false, restore: true })");
    await waitUntil(() => editing() === false, 6000);
  }

  for (const file of ["page-plain.md", "page-empty.md", "page-drawable.mmd",
    "page-unreadable.mmd"]) {
    await binned(file);
  }
  await run("window.__t.refreshDocs({ preserveSearch: true })");
};
