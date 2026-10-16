// Part of the DOM suite. See dom.test.js, which sets all this up and calls it.
//
// Saving what the source editor holds, and the three ways it refuses to open.
//
// test/dom/editing.js drives the editor's keys and one plain save of a
// document that already exists. Everything else in app/editor-save.js was
// unreached: the rename a changed name performs, the new document, the
// "replace what is already there?" question a name collision asks, and every
// refusal. The overwrite is the one that matters — it is the only path in this
// app where a save can land on somebody else's file.
module.exports = async (ctx) => {
  const { check, waitUntil, window, doc, server, cookieHeader, get } = ctx;

  const run = (source) => window.eval(source);
  const state = () => run("window.__t.state");
  const said = () => [...doc.querySelectorAll("#toastStack .toast, #toastStackUrgent .toast")]
    .map((one) => one.querySelector(".toast-message")?.textContent || "");
  const clearToasts = () => doc.querySelectorAll(".toast").forEach((one) => one.remove());
  const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

  const csrf = () => state().csrfToken;
  const made = async (name, content = `# ${name}\n`) => {
    await server.request("POST", "/api/docs",
      { fileName: name, overwrite: true, content },
      { Cookie: cookieHeader(), "X-CSRF-Token": csrf() });
  };
  const onDisk = async (file) => {
    const answer = await get(`/api/docs/${encodeURIComponent(file)}`);
    return answer.status === 200 ? JSON.parse(answer.body).content : answer.status;
  };

  const removed = async (file) => {
    await server.request("POST", `/api/docs/${file}/delete`, { mode: "soft" },
      { Cookie: cookieHeader(), "X-CSRF-Token": csrf() });
  };
  const shut = () => run("window.__t.closeEditor()");

  const nameField = () => doc.getElementById("editorFileName");
  const textField = () => doc.getElementById("editorInput");
  const openOn = async (file) => {
    await run(`window.__t.openEditorForDocument(${JSON.stringify(file)})`);
    await waitUntil(() => state().editorOpen, 3000);
  };
  // Ctrl+S: writes and stays in the text. The Save button is the one that
  // finishes, and the two paths part company at the very end of the save.
  const press = async (options) => {
    await run(`window.__t.runEditorSave(${JSON.stringify(options)})`);
    await settle();
  };

  console.log("=== the editor opens on a document, or says why not ===");
  {
    await made("saving-one.md", "# one\n");
    await made("saving-two.md", "# two\n");
    await run("window.__t.refreshDocs({ preserveSearch: true })");

    shut();
    clearToasts();
    await run('window.__t.openEditorForDocument("never-written.md")');
    check("a file the library does not have is not opened",
      [state().editorOpen, said().at(-1)],
      [false, "Select a markdown first, then choose Edit."]);

    const notebook = state().docs.find((one) => one.file.endsWith(".ipynb"));
    shut();
    clearToasts();
    await run(`window.__t.openEditorForDocument(${JSON.stringify(notebook.file)})`);
    /* A notebook is JSON with the output of every cell in it. Opening one in a
     * markdown editor and saving would write the text of that JSON back as the
     * file, which is a document destroyed by a save that looked ordinary.
     */
    check("a notebook is not opened in the markdown editor",
      [state().editorOpen, said().at(-1)],
      [false, "Notebook files are view-only in this viewer."]);

    shut();
    clearToasts();
    run(`window.__t.state.activeFile = ${JSON.stringify(notebook.file)}`);
    await run("window.__t.openEditorForCurrentDoc()");
    check("...and the Edit button says the same about the open one",
      [state().editorOpen, said().at(-1)],
      [false, "Notebook files are view-only in this viewer."]);

    shut();
    clearToasts();
    run('window.__t.state.activeFile = null');
    await run("window.__t.openEditorForCurrentDoc()");
    check("Edit with nothing open says what to do first",
      [state().editorOpen, said().at(-1)],
      [false, "Select a markdown first, then choose Edit."]);

    run('window.__t.state.activeFile = "saving-one.md"');
    clearToasts();
    await run("window.__t.openEditorForCurrentDoc()");
    await waitUntil(() => state().editorOpen, 3000);
    check("...and with one open, it opens on it",
      [state().editorOpen, state().editorFile, textField().value],
      [true, "saving-one.md", "# one\n"]);
    run("window.__t.closeEditor()");

    // The three refusals again from the recycle bin, which is a view of files
    // that are not where the editor would write them back to.
    await run('window.__t.switchViewMode("recycle")');
    await waitUntil(() => state().viewMode === "recycle"
      && state().docs.length > 0, 6000);
    shut();
    clearToasts();
    await run("window.__t.openEditorForCurrentDoc()");
    check("Edit in the recycle bin says to restore it first",
      [state().editorOpen, said().at(-1)],
      [false, "Restore a recycle bin document before editing."]);

    /* A row that is in the bin's own list, so the question reaching the
      * editor is "may this be edited" rather than "is there such a file".
      */
    const binned = state().deletedDocs[0].file;
    shut();
    clearToasts();
    await run(`window.__t.openEditorForDocument(${JSON.stringify(binned)})`);
    check("...and so does a row in it",
      [state().editorOpen, said().at(-1)],
      [false, "Restore a recycle bin document before editing."]);

    await run('window.__t.switchViewMode("docs")');
    await waitUntil(() => state().viewMode === "docs", 6000);
    await waitUntil(() => state().docs.length > 0, 6000);
  }

  console.log("=== and says so when the document is not there to read ===");
  {
    /* The library says the document exists; the server says it does not,
     * because something removed it since the list was fetched. Opening the
     * editor then throws where nothing would catch it, and the Edit button
     * would do nothing at all.
     */
    await made("saving-gone.md", "# gone\n");
    await run("window.__t.refreshDocs({ preserveSearch: true })");
    run('window.__t.state.activeFile = "saving-gone.md"');
    await removed("saving-gone.md");
    check("(the document really is gone from the server)",
      await onDisk("saving-gone.md"), 404);

    /* The cache is emptied last and waited on: refreshing the library starts
     * a read of the documents in it, and one that is still in the air will
     * put this file's text back after it has been taken out.
     */
    await settle();
    await waitUntil(() => {
      run('window.__t.state.contentCache.delete("saving-gone.md")');
      return !run('window.__t.state.contentCache.has("saving-gone.md")');
    }, 4000);

    shut();
    clearToasts();
    await run("window.__t.openEditorForCurrentDoc()");
    check("a document that has gone since the list was read is said to be gone",
      [state().editorOpen, said().length > 0], [false, true]);
  }

  console.log("=== a name is required, and a changed one is a rename ===");
  {
    await run("window.__t.refreshDocs({ preserveSearch: true })");
    await openOn("saving-one.md");

    clearToasts();
    nameField().value = "   ";
    await press({ close: false });
    check("a save with no name is refused", said().at(-1), "File name is required.");
    check("...with the cursor put in the field that needs filling",
      doc.activeElement, nameField());
    check("...and the editor still open on the document", state().editorOpen, true);

    clearToasts();
    nameField().value = "saving-renamed.md";
    textField().value = "# renamed and written\n";
    await press({ close: false });
    await waitUntil(() => said().some((one) => /^Saved /.test(one)), 4000);

    check("changing the name renames the file", await onDisk("saving-renamed.md"),
      "# renamed and written\n");
    check("...and the old name is not left behind", await onDisk("saving-one.md"), 404);
    /* The rename goes first so the write lands on the new path. The editor has
     * to be told about it, or the next Ctrl+S writes to a file that is no
     * longer there.
     */
    check("...and the editor is now editing the new name",
      state().editorFile, "saving-renamed.md");
    check("...and nothing is unsaved", run("window.__t.isEditorDirty()"), false);

    clearToasts();
    textField().value = "# written again\n";
    await press({ close: false });
    await waitUntil(() => said().some((one) => /^Saved /.test(one)), 4000);
    check("a second save writes to the new name rather than creating it again",
      await onDisk("saving-renamed.md"), "# written again\n");

    /* The rename has happened on the server; the write after it has not. The
     * editor has to be holding the new name by then, or the next Ctrl+S
     * renames a file that is not there any more and the text has nowhere to
     * go. Only the write is refused, so the rename is real.
     */
    const realFetch = window.fetch;
    const refuseWrites = (url, options = {}) => (
      (options.method || "GET").toUpperCase() === "PUT"
        ? Promise.resolve({
          status: 500, ok: false,
          async json() { return { error: "The disk is full." }; },
          async text() { return "{}"; }
        })
        : realFetch(url, options));
    const useFetch = (fn) => { window.fetch = fn; };

    clearToasts();
    nameField().value = "saving-halfway.md";
    textField().value = "# half of a save\n";
    useFetch(refuseWrites);
    await press({ close: false });
    useFetch(realFetch);
    await waitUntil(() => said().length > 0, 4000);

    check("a rename that lands with a write that does not says so",
      said().at(-1), "The disk is full.");
    check("...and the editor is holding the name the file now has",
      state().editorFile, "saving-halfway.md");
    check("...so saving again writes it rather than renaming again",
      [await onDisk("saving-halfway.md"), await onDisk("saving-renamed.md")],
      ["# written again\n", 404]);

    clearToasts();
    await press({ close: false });
    await waitUntil(() => said().some((one) => /^Saved /.test(one)), 4000);
    check("...which it does", await onDisk("saving-halfway.md"), "# half of a save\n");

    run("window.__t.closeEditor()");
  }

  console.log("=== a new document, and the name that is already taken ===");
  {
    run("window.__t.startNewDocument()");
    await waitUntil(() => state().editorOpen, 3000);
    check("a new document starts in create mode with no file behind it",
      [state().editorMode, state().editorFile], ["create", null]);

    clearToasts();
    nameField().value = "saving-new.md";
    textField().value = "# brand new\n";
    await press({ close: false });
    await waitUntil(() => said().some((one) => /^Saved /.test(one)), 4000);
    check("saving it writes the file", await onDisk("saving-new.md"), "# brand new\n");
    /* Staying open turns the create into an edit. Without that, a second
     * Ctrl+S would try to create the same document again and be told it
     * already exists — by the dialog below, about the file it just wrote.
     */
    check("...and the editor is now editing it rather than still creating it",
      [state().editorMode, state().editorFile], ["edit", "saving-new.md"]);
    run("window.__t.closeEditor()");

    // The same name again, from a new document: the server refuses, and the
    // refusal is a question rather than an error.
    run("window.__t.startNewDocument()");
    await waitUntil(() => state().editorOpen, 3000);
    nameField().value = "saving-new.md";
    textField().value = "# written over the top\n";
    clearToasts();

    const asking = run("window.__t.runEditorSave({ close: false })");
    await waitUntil(() => state().confirmOpen, 4000);
    check("a name that is taken asks before anything is written",
      doc.getElementById("confirmMessage").textContent,
      "saving-new.md already exists. Replace its content with what is in the editor now?");
    check("...and the button says what it will do",
      doc.getElementById("confirmProceedBtn").textContent, "Replace File");
    run("window.__t.resolveConfirmDialog(false)");
    await asking;
    await settle();
    check("answering no writes nothing", await onDisk("saving-new.md"), "# brand new\n");
    check("...and says what to do instead", said().at(-1),
      "Save cancelled. Pick a different file name or open the existing doc and edit it.");

    clearToasts();
    const replacing = run("window.__t.runEditorSave({ close: false })");
    await waitUntil(() => state().confirmOpen, 4000);
    run("window.__t.resolveConfirmDialog(true)");
    await replacing;
    await waitUntil(() => said().some((one) => /^Saved /.test(one)), 4000);
    check("answering yes replaces what was there",
      await onDisk("saving-new.md"), "# written over the top\n");

    run("window.__t.closeEditor()");

    /* Only "it already exists" becomes a question. Every other refusal is
     * rethrown to the handler that shows it — a dialog offering to replace a
     * file over a name the server will not accept at all would ask a question
     * whose yes cannot work.
     */
    run("window.__t.startNewDocument()");
    await waitUntil(() => state().editorOpen, 3000);
    nameField().value = `${"n".repeat(200)}.md`;
    textField().value = "# too long a name\n";
    clearToasts();
    /* Started rather than awaited, because a build that asks a question here
     * would never answer this promise: the check would hang instead of
     * failing, and a check that hangs says nothing about anything.
     */
    const refusing = run("window.__t.runEditorSave({ close: false })");
    await waitUntil(() => said().length > 0 || state().confirmOpen, 4000);
    check("a create refused for any other reason is shown, not asked about",
      [state().confirmOpen, said().at(-1)], [false, "Invalid document file name"]);
    run("window.__t.resolveConfirmDialog(false)");
    await refusing;
    check("...and the editor keeps the text", state().editorOpen, true);
    run("window.__t.closeEditor()");
  }

  console.log("=== a save the server refuses, and the save that closes ===");
  {
    await made("saving-vanish.md", "# here\n");
    await run("window.__t.refreshDocs({ preserveSearch: true })");
    await openOn("saving-vanish.md");
    await removed("saving-vanish.md");

    clearToasts();
    textField().value = "# written into thin air\n";
    await press({ close: false });
    await waitUntil(() => said().length > 0, 4000);
    /* The text stays in the editor, which is the only place it still exists.
     * A failed save that closed the window would be the save losing the work
     * it failed to write.
     */
    check("a save the server refuses says so and keeps the text",
      [state().editorOpen, textField().value, said().at(-1).length > 0],
      [true, "# written into thin air\n", true]);
    run("window.__t.closeEditor()");

    // The Save button's path: write, close, and redraw the library behind it.
    await made("saving-closing.md", "# before\n");
    await run("window.__t.refreshDocs({ preserveSearch: true })");
    await openOn("saving-closing.md");
    clearToasts();
    textField().value = "# after the button\n";
    await press({ close: true });
    await waitUntil(() => state().editorOpen === false, 4000);
    check("the Save button writes and closes",
      [state().editorOpen, await onDisk("saving-closing.md")], [false, "# after the button\n"]);
    check("...saying which file it wrote", said().at(-1), "Saved saving-closing.md.");

    /* Settling belongs to an editor that is still open. The save that closes
     * has already thrown the editor's state away, and a late settle would put
     * a file name and a button label back into a window nobody is looking at.
     */
    run('window.__t.settleEditorSave("ghost.md", "# ghost\\n")');
    check("settling a closed editor changes nothing",
      [state().editorOpen, state().editorFile], [false, "saving-closing.md"]);
  }

  console.log("=== closing with something unsaved in it ===");
  {
    await openOn("saving-closing.md");
    clearToasts();
    await run("window.__t.requestEditorClose()");
    check("closing with nothing unsaved just closes",
      [state().editorOpen, state().confirmOpen], [false, false]);

    await openOn("saving-closing.md");
    textField().value = "# not saved yet\n";
    const asking = run("window.__t.requestEditorClose()");
    await waitUntil(() => state().confirmOpen, 4000);
    run("window.__t.resolveConfirmDialog(false)");
    await asking;
    check("saying no to the question leaves the editor open with the text in it",
      [state().editorOpen, textField().value], [true, "# not saved yet\n"]);

    const discarding = run("window.__t.requestEditorClose()");
    await waitUntil(() => state().confirmOpen, 4000);
    run("window.__t.resolveConfirmDialog(true)");
    await discarding;
    await waitUntil(() => state().editorOpen === false, 4000);
    check("discarding closes it", state().editorOpen, false);
    check("...and the file is as it was", await onDisk("saving-closing.md"),
      "# after the button\n");
  }

  // The documents this file made are not left in the library for the next one.
  for (const file of ["saving-two.md", "saving-halfway.md", "saving-new.md", "saving-closing.md"]) {
    await removed(file);
  }
  await run("window.__t.refreshDocs({ preserveSearch: true })");
};
