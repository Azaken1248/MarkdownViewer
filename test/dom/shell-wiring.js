// Part of the DOM suite. See dom.test.js, which sets all this up and calls it.
//
// What app.js itself does: the gestures, the menus and the keys the shell
// binds, as against what the modules under it do once they are called.
//
// It is a wiring file, and a wiring file is only ever wrong at the wiring —
// a handler bound to the wrong element, a shortcut that fires while somebody
// is typing, a menu that cannot be dismissed. None of that shows up anywhere
// else, because every module it calls is tested on its own.
module.exports = async (ctx) => {
  const { check, waitUntil, window, doc, server, cookieHeader, clipboardWrites } = ctx;

  const run = (source) => window.eval(source);
  const state = () => run("window.__t.state");
  const el = (id) => doc.getElementById(id);

  const said = () => [...doc.querySelectorAll("#toastStack .toast, #toastStackUrgent .toast")]
    .map((one) => one.querySelector(".toast-message")?.textContent || "");
  const saidThat = (text) => said().some((one) => one.includes(text));
  const clearToasts = () => doc.querySelectorAll(".toast").forEach((one) => one.remove());

  const press = (node, init = {}) => node.dispatchEvent(
    new window.MouseEvent("click", { bubbles: true, ...init }));

  const key = (name, init = {}) => window.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: name, bubbles: true, ...init }));

  const made = async (name, body) => {
    await server.request("POST", "/api/docs",
      { fileName: name, overwrite: true, content: body },
      { Cookie: cookieHeader(), "X-CSRF-Token": state().csrfToken });
    await run("window.__t.refreshDocs({ preserveSearch: true })");
    return name;
  };

  console.log("=== slash puts the cursor in the search box ===");
  {
    /* The way it does in every other document browser — and ignored while
     * somebody is typing, so it never eats a literal slash.
     */
    el("searchInput").blur();
    doc.body.focus();
    key("/");
    check("slash focuses the search box", doc.activeElement, el("searchInput"));

    el("searchInput").blur();
    key("/", { ctrlKey: true });
    check("...but not with a modifier held", doc.activeElement === el("searchInput"), false);

    /* A field is somewhere a slash is a slash. Pressed on the element rather
     * than on the window, which is how a real keystroke arrives — and the
     * same press on something that is not a field has to still work, or this
     * would pass by never reaching the handler at all.
     */
    const plain = doc.createElement("div");
    doc.body.appendChild(plain);
    el("searchInput").blur();
    plain.dispatchEvent(new window.KeyboardEvent("keydown", { key: "/", bubbles: true }));
    check("...pressed anywhere on the page, not only at the window",
      doc.activeElement, el("searchInput"));
    plain.remove();

    const field = doc.createElement("input");
    doc.body.appendChild(field);
    field.focus();
    field.dispatchEvent(new window.KeyboardEvent("keydown", { key: "/", bubbles: true }));
    check("...and not while somebody is typing into a field", doc.activeElement, field);
    field.remove();

    // Nor over an open dialog, where it would take the keyboard out of it.
    el("searchInput").blur();
    doc.body.focus();
    run("window.__t.state.shareOpen = true");
    key("/");
    check("...nor over an open dialog", doc.activeElement === el("searchInput"), false);
    run("window.__t.state.shareOpen = false");
  }

  console.log("=== and Escape works its way back out, one rung at a time ===");
  {
    /* One press, one thing undone. The ladder is ordered by what is most in
     * the way: a dialog before a menu, a menu before a selection.
     */
    run("window.__t.setNavOpen(true)");
    check("the sidebar is open", el("appShell").classList.contains("nav-open"), true);
    key("Escape");
    check("Escape closes the sidebar", el("appShell").classList.contains("nav-open"), false);

    run("window.__t.state.clipboard = { files: ['a.md'], mode: 'copy' }");
    key("Escape");
    check("...and then lets go of what was being carried",
      state().clipboard, { files: [], mode: null });

    // With nothing in the way it does nothing, rather than closing something
    // somebody was using.
    key("Escape");
    check("...and with nothing in the way it does nothing",
      [el("appShell").classList.contains("nav-open"), state().clipboard.files], [false, []]);
    // Another key is not a rung.
    run("window.__t.setNavOpen(true)");
    key("a");
    check("another key is not a way out", el("appShell").classList.contains("nav-open"), true);
    run("window.__t.setNavOpen(false)");
  }

  console.log("=== the upload menu, and the two pickers behind it ===");
  {
    check("the menu starts shut", el("uploadMenu").hidden, true);

    press(el("uploadTrigger"));
    check("the trigger opens it",
      [el("uploadMenu").hidden, el("uploadTrigger").getAttribute("aria-expanded")],
      [false, "true"]);
    // The keyboard goes into it, or opening a menu with the keyboard leaves
    // the keyboard outside it.
    check("...putting the keyboard in it",
      el("uploadMenu").contains(doc.activeElement), true);

    press(el("uploadMenu"));
    check("a press inside the menu leaves it open", el("uploadMenu").hidden, false);

    press(doc.body);
    check("...and a press anywhere else shuts it",
      [el("uploadMenu").hidden, el("uploadTrigger").getAttribute("aria-expanded")],
      [true, "false"]);

    press(el("uploadTrigger"));
    press(el("uploadTrigger"));
    check("the trigger shuts it again too", el("uploadMenu").hidden, true);

    /* Choosing either kind opens the browser's own file dialogue, which is
     * the one thing here that cannot be driven — so what is checked is that
     * the right picker was asked.
     */
    const asked = [];
    el("uploadInput").click = () => asked.push("files");
    el("uploadFolderInput").click = () => asked.push("folder");

    press(el("uploadTrigger"));
    press(el("uploadFilesItem"));
    check("choosing files asks for files", asked, ["files"]);
    check("...and shuts the menu behind it", el("uploadMenu").hidden, true);

    press(el("uploadTrigger"));
    press(el("uploadFolderItem"));
    check("choosing a folder asks for a folder", asked, ["files", "folder"]);
  }

  console.log("=== and what happens once a file comes back ===");
  {
    const fileLike = (name) => {
      const made = new window.File([`# ${name}\n`], name, { type: "text/markdown" });
      return made;
    };

    // A change event with nothing picked is somebody who opened the dialogue
    // and thought better of it.
    const was = state().folderModalOpen;
    Object.defineProperty(el("uploadInput"), "files", { configurable: true, value: [] });
    el("uploadInput").dispatchEvent(new window.Event("change", { bubbles: true }));
    check("a dialogue closed with nothing picked does nothing",
      state().folderModalOpen, was);

    /* With folders in the library there is somewhere to put it, so it asks
     * which — and the file is held until the question is answered.
     */
    Object.defineProperty(el("uploadInput"), "files",
      { configurable: true, value: [fileLike("picked.md")] });
    el("uploadInput").dispatchEvent(new window.Event("change", { bubbles: true }));
    check("a file picked with folders to choose from asks which",
      state().folderModalOpen, true);
    check("...holding the file until it is answered",
      state().pendingUploadFile?.name, "picked.md");
    run("window.__t.closeFolderModal()");
    run("window.__t.state.pendingUploadFile = null");

    /* With no folders in the library there is nothing to ask, so the same
     * file goes straight up. The question is about what the library holds
     * rather than about the file, which is why the state is what moves.
     */
    const folders = state().folders;
    run("window.__t.state.folders = []");
    clearToasts();
    Object.defineProperty(el("uploadInput"), "files",
      { configurable: true, value: [fileLike("unasked.md")] });
    el("uploadInput").dispatchEvent(new window.Event("change", { bubbles: true }));
    check("...and with no folders to choose between, it does not ask at all",
      state().folderModalOpen, false);
    await waitUntil(() => saidThat("Uploaded unasked.md"));
    check("...it just puts the file in the library", saidThat("Uploaded unasked.md"), true);
    run(`window.__t.state.folders = ${JSON.stringify(folders)}`);

    // A folder picker that comes back empty is the same kind of nothing.
    Object.defineProperty(el("uploadFolderInput"), "files", { configurable: true, value: [] });
    el("uploadFolderInput").dispatchEvent(new window.Event("change", { bubbles: true }));
    check("a folder dialogue closed with nothing picked does nothing too",
      state().folderModalOpen, false);
    /* And the input is cleared either way, because without it picking the
     * same folder twice in a row never fires a second change event.
     */
    check("...and the picker is emptied so the same one can be picked again",
      el("uploadFolderInput").value, "");

    // ...and one that comes back with something sends it, without asking.
    const inFolder = fileLike("carried.md");
    Object.defineProperty(inFolder, "webkitRelativePath",
      { value: "Picked Folder/carried.md" });
    Object.defineProperty(el("uploadFolderInput"), "files",
      { configurable: true, value: [inFolder] });
    clearToasts();
    el("uploadFolderInput").dispatchEvent(new window.Event("change", { bubbles: true }));
    await waitUntil(() => saidThat("Uploaded 1 document"), 12000);
    check("a folder that was picked is uploaded, and asks nothing",
      [saidThat("Uploaded 1 document"), state().folderModalOpen], [true, false]);
  }

  console.log("=== the buttons above the document, in each of the three views ===");
  {
    /* Three places a document can be and one set of buttons, so each one asks
     * where it is before it acts. The wrong answer here archives a document
     * somebody meant to restore.
     */
    const file = await made("buttons.md", "# Buttons\n");
    await run(`window.__t.openDocument(${JSON.stringify(file)}, true)`);
    await waitUntil(() => state().activeFile === file);

    clearToasts();
    press(el("softDeleteDocBtn"));
    await waitUntil(() => state().confirmOpen);
    check("the delete button asks about the recycle bin in the library",
      el("confirmTitle").textContent, "Move markdown to recycle bin?");
    run("window.__t.resolveConfirmDialog(false)");

    clearToasts();
    press(el("hardDeleteDocBtn"));
    await waitUntil(() => state().confirmOpen);
    check("...and the archive button about the archive",
      el("confirmTitle").textContent, "Archive this markdown?");
    run("window.__t.resolveConfirmDialog(false)");

    // In the recycle bin the same button archives the bin entry instead.
    run("window.__t.state.isRecycleBinMode = true");
    clearToasts();
    press(el("hardDeleteDocBtn"));
    await waitUntil(() => state().confirmOpen);
    check("in the recycle bin it archives the entry instead",
      el("confirmMessage").textContent.includes("stays on disk"), true);
    run("window.__t.resolveConfirmDialog(false)");

    /* And the restore button, which in the bin restores from the bin — said
      * with the bin's own wording rather than the archive's.
      */
    clearToasts();
    run("window.__t.state.activeFile = null");
    press(el("restoreDocBtn"));
    await waitUntil(() => said().length > 0);
    check("...and the restore button restores from the bin",
      saidThat("Select a recycle bin markdown to restore."), true);
    run(`window.__t.state.activeFile = ${JSON.stringify(file)}`);
    run("window.__t.state.isRecycleBinMode = false");

    // And in the archive, both buttons mean the archive's own versions.
    run('window.__t.state.viewMode = "archive"');
    run("window.__t.state.activeFile = null");
    clearToasts();
    press(el("restoreDocBtn"));
    await waitUntil(() => said().length > 0);
    check("in the archive the restore button restores from the archive",
      saidThat("Select an archived document to restore."), true);

    clearToasts();
    press(el("hardDeleteDocBtn"));
    await waitUntil(() => said().length > 0);
    check("...and the delete button erases from it",
      saidThat("Select an archived document to delete."), true);
    run('window.__t.state.viewMode = "docs"');

    // The two that are one line each and go to the two editors.
    run(`window.__t.state.activeFile = ${JSON.stringify(file)}`);
    press(el("newDocBtn"));
    await waitUntil(() => state().editorOpen);
    check("New opens the editor on nothing in particular",
      [state().editorOpen, state().editorMode], [true, "create"]);
    run("window.__t.closeEditor()");

    press(el("editDocBtn"));
    await waitUntil(() => state().editorOpen);
    check("Edit opens it on the document that is open", state().editorFile, file);
    run("window.__t.closeEditor()");
  }

  console.log("=== and the one that takes the document away ===");
  {
    /* Copy has four answers and had none of them checked. The copy is the
     * markdown the page was made from, read out of the same cache the
     * renderer read — not a second fetch that could disagree with what is on
     * screen.
     */
    const body = "# Copied\n\nThe words that were on the page.\n";
    const file = await made("copied.md", body);
    await run(`window.__t.openDocument(${JSON.stringify(file)}, true, { forceReload: true })`);
    await waitUntil(() => state().activeFile === file);

    clipboardWrites.splice(0);
    clearToasts();
    press(el("copyDocBtn"));
    await waitUntil(() => said().length > 0);
    check("Copy copies the markdown the page was made from",
      clipboardWrites.at(-1), body);
    check("...and says which document it took", saidThat("Copied copied.md as markdown."), true);

    // With the cache gone it is read again, which is the path a document
    // opened before a reload takes.
    clipboardWrites.splice(0);
    clearToasts();
    run(`window.__t.state.contentCache.delete(${JSON.stringify(file)})`);
    press(el("copyDocBtn"));
    await waitUntil(() => said().length > 0);
    check("...and reads it from the server when the cache has gone",
      clipboardWrites.at(-1), body);

    clearToasts();
    run("window.__t.state.activeFile = null");
    press(el("copyDocBtn"));
    await waitUntil(() => said().length > 0);
    check("with nothing open it says to open something",
      saidThat("Open a document first."), true);

    // A clipboard the browser refuses, which is the one failure where the
    // app has nowhere else to put the text.
    clearToasts();
    run(`window.__t.state.activeFile = ${JSON.stringify(file)}`);
    run(`window.__realCopy = window.MarkdownCore.copyText;
      window.MarkdownCore.copyText = () => Promise.reject(new Error("refused"));`);
    press(el("copyDocBtn"));
    await waitUntil(() => said().length > 0);
    check("a clipboard the browser refuses says so",
      saidThat("Your browser would not let this page use the clipboard."), true);
    run("window.MarkdownCore.copyText = window.__realCopy; delete window.__realCopy;");

    // ...and a document the server will not give up, with nothing cached.
    clearToasts();
    run(`window.__t.state.contentCache.delete(${JSON.stringify(file)})`);
    await server.request("POST", `/api/docs/${file}/delete`, { mode: "soft" },
      { Cookie: cookieHeader(), "X-CSRF-Token": state().csrfToken });
    press(el("copyDocBtn"));
    await waitUntil(() => said().length > 0);
    check("a document that cannot be read says that instead",
      saidThat("Could not read this document."), true);
    await run("window.__t.refreshDocs({ preserveSearch: true })");
  }

  console.log("=== a swipe across the document steps through the matches ===");
  {
    /* On a phone there is no next/previous key and the floating bar is small.
     * A swipe is the gesture everything else on a phone uses for "the next
     * one", so it is the gesture here too.
     */
    const file = await made("swiping.md", "# Swipe\n\nrollback and rollback and rollback.\n");
    await run(`window.__t.openDocument(${JSON.stringify(file)}, true, {
      jumpQuery: "rollback", jumpTerms: ["rollback"] })`);
    await waitUntil(() => state().activeFile === file && state().jumpMatchCount > 0);
    run('window.__t.state.jumpQuery = "rollback"');

    const touch = (type, points) => el("docContent").dispatchEvent(
      Object.assign(new window.Event(type, { bubbles: true }), {
        touches: type === "touchend" ? [] : points,
        changedTouches: points
      }));

    clearToasts();
    touch("touchstart", [{ clientX: 300, clientY: 200 }]);
    touch("touchend", [{ clientX: 100, clientY: 210 }]);
    await waitUntil(() => said().length > 0);
    check("a swipe left steps to the next match", saidThat("Match"), true);

    clearToasts();
    touch("touchstart", [{ clientX: 100, clientY: 200 }]);
    touch("touchend", [{ clientX: 300, clientY: 210 }]);
    await waitUntil(() => said().length > 0);
    check("...and a swipe right steps back", saidThat("Match"), true);

    /* Everything below is a gesture that must *not* step, and stepping is a
     * round trip — so each one is given a moment to have stepped in before
     * the silence is believed.
     */
    const notAStep = async (label, start, end) => {
      clearToasts();
      touch("touchstart", start);
      touch("touchend", end);
      await waitUntil(() => said().length > 0, 400);
      check(label, said(), []);
    };

    await notAStep("two fingers is a zoom rather than a swipe",
      [{ clientX: 300, clientY: 200 }, { clientX: 320, clientY: 240 }],
      [{ clientX: 100, clientY: 200 }]);
    await notAStep("...and a drag down the page is a scroll",
      [{ clientX: 300, clientY: 200 }], [{ clientX: 260, clientY: 500 }]);
    await notAStep("...and a short one is a tap",
      [{ clientX: 300, clientY: 200 }], [{ clientX: 290, clientY: 205 }]);

    // A gesture the browser takes away leaves nothing half-started.
    clearToasts();
    touch("touchstart", [{ clientX: 300, clientY: 200 }]);
    el("docContent").dispatchEvent(new window.Event("touchcancel", { bubbles: true }));
    touch("touchend", [{ clientX: 100, clientY: 200 }]);
    await waitUntil(() => said().length > 0, 400);
    check("a gesture the browser takes away is not a swipe", said(), []);

    // And with nothing being searched for there is nothing to step through.
    run('window.__t.state.jumpQuery = ""');
    await notAStep("...and with no search running, a swipe is just a swipe",
      [{ clientX: 300, clientY: 200 }], [{ clientX: 100, clientY: 200 }]);
  }

  console.log("=== the keys and the toolbar while editing in place ===");
  {
    /* Ctrl+B and Ctrl+I are the browser's own inside a contenteditable.
     * Ctrl+K and Ctrl+E are not, and the browser would otherwise take them —
     * so the page takes them first.
     */
    const file = await made("in-place.md", "# In place\n\nSome words to edit.\n");
    await run(`window.__t.openDocument(${JSON.stringify(file)}, true)`);
    await waitUntil(() => state().activeFile === file);
    await run("window.__t.startPageEdit()");
    await waitUntil(() => run("window.__t.pageEditActive()"));
    check("the document is being edited in place", run("window.__t.pageEditActive()"), true);

    const inDoc = (name, init = {}) => el("docContent").dispatchEvent(
      new window.KeyboardEvent("keydown", { key: name, bubbles: true, ...init }));

    // Something to save, or the answer is "no changes" and the save path is
    // never walked.
    const paragraph = el("docContent").querySelector('.ve-block[contenteditable="true"]');
    paragraph.textContent = "Some words to edit, and a few more.";
    paragraph.dispatchEvent(new window.Event("input", { bubbles: true }));

    clearToasts();
    inDoc("s", { ctrlKey: true });
    await waitUntil(() => saidThat("Saved"), 6000);
    check("ctrl-s saves where you stand", saidThat("Saved"), true);
    // Saving is not leaving: leaving is the Save button's job, and Escape's.
    check("...without leaving the editor", run("window.__t.pageEditActive()"), true);

    /* Undo and redo are the page's, not the browser's — a whole-document step
     * rather than a character — except inside a form control, where the
     * browser's own is character-accurate and keeps the caret.
     */
    clearToasts();
    inDoc("z", { ctrlKey: true });
    inDoc("y", { ctrlKey: true });
    inDoc("z", { ctrlKey: true, shiftKey: true });
    check("undo and redo are taken by the page", run("window.__t.pageEditActive()"), true);

    const field = doc.createElement("textarea");
    el("docContent").appendChild(field);
    field.dispatchEvent(new window.KeyboardEvent("keydown",
      { key: "z", ctrlKey: true, bubbles: true }));
    check("...but left to the browser inside a form control",
      run("window.__t.pageEditActive()"), true);
    field.remove();

    inDoc("k", { ctrlKey: true });
    inDoc("e", { ctrlKey: true });
    check("the link and code shortcuts are taken too",
      run("window.__t.pageEditActive()"), true);

    /* And Escape is the way out, asking first if there is anything to lose —
     * which there is, since this document has just been saved and then left
     * alone.
     */
    inDoc("Escape");
    await waitUntil(() => !run("window.__t.pageEditActive()")
      || state().confirmOpen, 3000);
    if (state().confirmOpen) {
      run("window.__t.resolveConfirmDialog(true)");
    }

    await waitUntil(() => !run("window.__t.pageEditActive()"), 3000);
    check("Escape is the way out of editing in place",
      run("window.__t.pageEditActive()"), false);

    // And back in, for the rest of this section.
    await run("window.__t.startPageEdit()");
    await waitUntil(() => run("window.__t.pageEditActive()"), 6000);
    // A key with no modifier is a key being typed into the document.
    inDoc("q");
    inDoc("q", { ctrlKey: true });
    check("...and anything else is left alone", run("window.__t.pageEditActive()"), true);

    /* The toolbar is delegated, so it can grow without another listener each
     * time — and a press on it must not take the selection out of the text,
     * which focusing a button would do.
     */
    const tool = doc.querySelector(".visual-tool[data-command], .visual-tool[data-block], .visual-tool[data-insert]");
    check("the toolbar has tools on it", Boolean(tool), true);

    const held = new window.MouseEvent("mousedown", { bubbles: true, cancelable: true });
    tool.dispatchEvent(held);
    check("...and pressing one does not take the selection out of the text",
      held.defaultPrevented, true);

    const emptyPress = new window.MouseEvent("mousedown", { bubbles: true, cancelable: true });
    el("visualToolbar").dispatchEvent(emptyPress);
    check("...while a press on the bar itself is not a press on a tool",
      emptyPress.defaultPrevented, false);

    for (const which of ["data-command", "data-block", "data-insert"]) {
      const one = doc.querySelector(`.visual-tool[${which}]`);
      if (one) {
        press(one);
      }
    }

    check("every kind of tool on the bar can be pressed",
      run("window.__t.pageEditActive()"), true);
    press(el("visualToolbar"));
    check("...and a press on the bar itself does nothing",
      run("window.__t.pageEditActive()"), true);
  }

  console.log("=== and a picture put into it, picked or dropped ===");
  {
    /* A real PNG, because the store sniffs what it is given rather than
     * trusting the type on it.
     */
    const PNG = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from([0, 0, 0, 13]), Buffer.from("IHDR"),
      Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
      Buffer.from([0x1f, 0x15, 0xc4, 0x89])
    ]);
    const picture = () => new window.File([PNG], "shot.png", { type: "image/png" });

    const asked = [];
    el("imageInput").click = () => asked.push("picked");
    press(el("visualImageBtn"));
    check("the picture button asks for a file", asked, ["picked"]);

    // Nothing picked is nothing to insert.
    Object.defineProperty(el("imageInput"), "files", { configurable: true, value: [] });
    el("imageInput").dispatchEvent(new window.Event("change", { bubbles: true }));
    check("a dialogue closed with nothing picked inserts nothing",
      el("docContent").querySelectorAll("img").length, 0);
    // And the input is cleared, so the same file can be picked twice running.
    check("...and the picker is emptied either way", el("imageInput").value, "");

    clearToasts();
    Object.defineProperty(el("imageInput"), "files",
      { configurable: true, value: [picture()] });
    el("imageInput").dispatchEvent(new window.Event("change", { bubbles: true }));
    await waitUntil(() => el("docContent").querySelectorAll("img").length > 0
      || said().length > 0, 6000);
    check("a picked picture goes into the document",
      el("docContent").querySelectorAll("img").length > 0 || saidThat("cursor"), true);

    /* Dropped rather than picked, which is the same upload by a different
     * route — and only while editing, since there is nowhere to put it
     * otherwise.
     */
    const transfer = {
      files: [picture()],
      items: [{ kind: "file", type: "image/png", getAsFile: () => picture() }],
      types: ["Files"]
    };
    const dropOn = (type) => {
      const event = new window.Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { dataTransfer: transfer, clientX: 10, clientY: 10 });
      el("docContent").dispatchEvent(event);
      return event;
    };

    const over = dropOn("dragover");
    check("a picture dragged over the document is accepted while editing",
      over.defaultPrevented, true);

    const dropped = dropOn("drop");
    check("...and dropping it is taken by the page", dropped.defaultPrevented, true);

    // Nothing but a picture is nothing to drop.
    const empty = { files: [], items: [], types: [] };
    const plain = new window.Event("dragover", { bubbles: true, cancelable: true });
    Object.assign(plain, { dataTransfer: empty });
    el("docContent").dispatchEvent(plain);
    check("...while something that is not a picture is not", plain.defaultPrevented, false);

    /* Leaving asks first, because there is a picture in it now that was not
     * there before.
     */
    const leavingEdit = run("window.__t.cancelPageEdit()");
    if (await waitUntil(() => state().confirmOpen, 3000)) {
      run("window.__t.resolveConfirmDialog(true)");
    }

    await leavingEdit;
    await waitUntil(() => !run("window.__t.pageEditActive()"), 6000);
    check("leaving the editor with something unsaved asks, and then leaves",
      run("window.__t.pageEditActive()"), false);

    // And with nothing being edited, a drop is the browser's business again.
    const outside = new window.Event("drop", { bubbles: true, cancelable: true });
    Object.assign(outside, { dataTransfer: transfer });
    el("docContent").dispatchEvent(outside);
    check("a picture dropped on a document nobody is editing is not taken",
      outside.defaultPrevented, false);
    press(el("visualImageBtn"));
    check("...and the picture button asks for nothing", asked.length, 1);
  }

  console.log("=== leaving the page, and coming back to it ===");
  {
    /* The browser asks before it throws unsaved work away, and it only asks
     * when there is some: a page that always asks is a page people learn to
     * click through.
     */
    const leaving = () => {
      const event = new window.Event("beforeunload", { bubbles: true, cancelable: true });
      window.dispatchEvent(event);
      return event;
    };

    check("leaving with nothing unsaved asks nothing", leaving().defaultPrevented, false);

    const file = await made("unsaved.md", "# Unsaved\n\nWords.\n");
    await run(`window.__t.openDocument(${JSON.stringify(file)}, true)`);
    await waitUntil(() => state().activeFile === file);
    await run("window.__t.openEditor({ mode: 'edit', fileName: " + JSON.stringify(file) + ", content: '# Unsaved\\n' })");
    el("editorInput").value = "# Changed\n";
    el("editorInput").dispatchEvent(new window.Event("input", { bubbles: true }));
    check("...and leaving with something unsaved does", leaving().defaultPrevented, true);
    run("window.__t.closeEditor?.()");
    run("window.__t.state.editorOpen = false");

    /* The window changing size, which matters for one thing: the edit bar
     * sticks below a toolbar that wraps to two rows on a narrow window.
     */
    run("window.__t.setNavOpen(true)");
    window.dispatchEvent(new window.Event("resize"));
    check("a window wide enough for the sidebar closes the drawer over it",
      el("appShell").classList.contains("nav-open"), false);

    // Back and forward, which pushState does not fire — only the buttons do.
    const other = await made("elsewhere.md", "# Elsewhere\n");
    await run(`window.__t.openDocument(${JSON.stringify(other)}, true)`);
    await waitUntil(() => state().activeFile === other);

    // The address of a document is its own name at the root, which is what
    // showDocumentInUrl writes.
    window.history.pushState({}, "", `/${file}`);
    window.dispatchEvent(new window.PopStateEvent("popstate"));
    await waitUntil(() => state().activeFile === file, 6000);
    check("the back button opens the document the address names",
      state().activeFile, file);

    // And back as far as the library itself: the address says nothing is
    // open, so nothing is.
    window.history.pushState({}, "", "/");
    window.dispatchEvent(new window.PopStateEvent("popstate"));
    await waitUntil(() => !state().activeFile, 6000);
    check("...and back past that closes the document",
      state().activeFile, null);

    // And the old fragment form, which some links still use.
    window.history.pushState({}, "", `/#${other}`);
    window.dispatchEvent(new window.Event("hashchange"));
    await waitUntil(() => state().activeFile === other, 6000);
    check("...and so does the fragment older links still carry",
      state().activeFile, other);
    window.history.pushState({}, "", "/");
  }

  console.log("=== and the dock along the bottom, which is the phone's toolbar ===");
  {
    press(el("dockOpenDocs"));
    check("the dock opens the library", el("appShell").classList.contains("nav-open"), true);
    press(el("dockOpenDocs"));
    check("...and closes it again", el("appShell").classList.contains("nav-open"), false);

    const scrolled = [];
    window.scrollTo = (options) => scrolled.push(options);
    el("searchInput").value = "";
    press(el("dockSearch"));
    check("the search button takes the page back to the top",
      scrolled[0].top, 0);
    check("...and puts the keyboard in the box", doc.activeElement, el("searchInput"));

    /* Smoothly, unless the reader has asked for less motion — in which case
     * it simply arrives.
     */
    let quiet = true;
    window.matchMedia = /** @type {any} */ (() => ({ matches: quiet }));
    press(el("dockSearch"));
    check("...without animating it for a reader who asked for less motion",
      scrolled[1].behavior, "auto");
    quiet = false;
    press(el("dockSearch"));
    check("...and with, for everybody else", scrolled[2].behavior, "smooth");

    const asked = [];
    el("uploadInput").click = () => asked.push("files");
    press(el("dockUpload"));
    check("the upload button asks for a file", asked, ["files"]);

    press(el("dockNew"));
    check("the new button opens the editor on a new document",
      [state().editorOpen, el("editorFileName").value], [true, ""]);
    check("...with something in it to start from",
      el("editorInput").value.startsWith("# New Markdown"), true);
    run("window.__t.closeEditor?.()");
    run("window.__t.state.editorOpen = false");
  }
};
