// Part of the DOM suite. See dom.test.js, which sets all this up and calls it.
//
// The three halves of delete and restore, which between them are the only
// place in this app that can lose work.
//
// There are three places a document can be — the library, the recycle bin and
// the archive — and five verbs for moving between them, because getting out of
// the last two is not the same as getting into the first. What the server does
// with each is covered thoroughly by `recycle`. What was not covered is the
// side a person sees: which view they are left looking at afterwards, what
// they are asked before anything is lost, and what they are told when it
// could not be done.
module.exports = async (ctx) => {
  const { check, waitUntil, window, doc, server, cookieHeader } = ctx;

  const run = (source) => window.eval(source);
  const state = () => run("window.__t.state");
  const el = (id) => doc.getElementById(id);

  const cheers = () => [...doc.querySelectorAll("#toastStack .toast")]
    .map((one) => one.querySelector(".toast-message")?.textContent || "");
  const complaints = () => [...doc.querySelectorAll("#toastStackUrgent .toast")]
    .map((one) => one.querySelector(".toast-message")?.textContent || "");
  const clearToasts = () => doc.querySelectorAll(".toast").forEach((one) => one.remove());

  // Everything the app said, loud or otherwise: setStatus is a toast here, so
  // "it told the reader" and "it complained" are the same question asked of
  // two stacks.
  const said = () => [...cheers(), ...complaints()];
  const saidThat = (text) => said().some((one) => one.includes(text));

  /* Answering the dialog the app opened. A dialog that never opens is a check
   * about to wait for a promise nothing will settle, so this says so instead
   * of hanging.
   */
  const answer = async (yes) => {
    if (!await waitUntil(() => state().confirmOpen, 4000)) {
      throw new Error("nothing was asked, so there was nothing to answer");
    }

    run(`window.__t.resolveConfirmDialog(${yes})`);
  };

  // What the dialog is asking, which is the thing that stops a delete being
  // something somebody did by accident.
  const asked = () => el("confirmMessage").textContent;
  const askedTitle = () => el("confirmTitle").textContent;

  // A document of this suite's own, so nothing here depends on what the rest
  // of it left behind.
  const made = async (name, body) => {
    const csrf = state().csrfToken;
    await server.request("POST", "/api/docs",
      { fileName: name, overwrite: true, content: body },
      { Cookie: cookieHeader(), "X-CSRF-Token": csrf });
    await run("window.__t.refreshDocs({ preserveSearch: true })");
    return name;
  };

  const inLibrary = (name) => state().docs.some((one) => one.file === name);

  // The deleted list is only loaded when somebody is looking at it, so asking
  // what is in the bin means loading it.
  const inBin = async (name) => {
    await run("window.__t.refreshDeletedDocs({ preserveSearch: true })");
    return state().deletedDocs.some((one) => one.originalFile === name || one.file === name);
  };

  const binEntry = async (name) => {
    await run("window.__t.refreshDeletedDocs({ preserveSearch: true })");
    return state().deletedDocs.find((one) => one.originalFile === name);
  };

  console.log("=== the document you are looking at, moved to the bin ===");
  {
    clearToasts();
    const file = await made("discard-me.md", "# Discard me\n");
    run(`window.__t.state.activeFile = ${JSON.stringify(file)}`);
    run("window.__t.state.isRecycleBinMode = false");

    /* Asked first, and asked plainly: a delete that happens on the press is a
     * delete somebody did by accident.
     */
    const refused = run("window.__t.deleteCurrentDocument('soft')");
    check("deleting the open document asks first", asked().includes(file), true);
    await answer(false);
    await refused;
    check("...and a no leaves it where it was", inLibrary(file), true);
    check("...saying nothing happened", saidThat("Delete cancelled."), true);

    const deleting = run("window.__t.deleteCurrentDocument('soft')");
    await answer(true);
    await deleting;
    check("...while a yes moves it to the recycle bin",
      [inLibrary(file), await inBin(file)], [false, true]);
    check("...and says which document went where",
      saidThat("discard-me.md moved to recycle bin"), true);
    // And its text is forgotten, or reopening it after a restore would show
    // what it said before rather than what it says now.
    check("...forgetting what it said",
      run(`window.__t.state.contentCache.has(${JSON.stringify(file)})`), false);
  }

  console.log("=== and brought back out of it ===");
  {
    clearToasts();
    const entry = await binEntry("discard-me.md");
    run("window.__t.state.isRecycleBinMode = true");
    run(`window.__t.state.activeFile = ${JSON.stringify(entry.file)}`);

    await run("window.__t.restoreCurrentDeletedDocument()");
    check("restoring puts it back in the library", inLibrary("discard-me.md"), true);
    /* And puts you back in the library looking at it, rather than leaving you
     * in the recycle bin looking at an entry that is no longer there.
     */
    check("...and leaves you looking at it rather than at the bin",
      [state().isRecycleBinMode, state().activeFile], [false, "discard-me.md"]);
    check("...saying where it came from", saidThat("from recycle bin"), true);
  }

  console.log("=== straight to the archive, skipping the bin ===");
  {
    clearToasts();
    const file = await made("archive-me.md", "# Archive me\n");
    run(`window.__t.state.activeFile = ${JSON.stringify(file)}`);
    run("window.__t.state.isRecycleBinMode = false");

    const archiving = run("window.__t.deleteCurrentDocument('hard')");
    // A different question, because it is a different place and the recycle
    // bin is not where it will be found afterwards.
    check("archiving asks about the archive rather than the bin",
      asked().includes("skipping the recycle bin"), true);
    await answer(true);
    await archiving;
    check("...and the document leaves the library", inLibrary(file), false);
  }

  console.log("=== the three of them refused where they make no sense ===");
  {
    /* Each of these is a button that can be reached in the wrong view — by a
     * keyboard shortcut, or by the view changing under a dialog that was
     * already open. None of them may act on whatever happens to be selected.
     */
    run("window.__t.state.isRecycleBinMode = true");
    await run("window.__t.deleteCurrentDocument('soft')");
    check("deleting while looking at the recycle bin is refused",
      saidThat("Select an active markdown to delete."), true);

    run("window.__t.state.isRecycleBinMode = false");
    await run("window.__t.restoreCurrentDeletedDocument()");
    check("...restoring while looking at the library is refused",
      saidThat("Select a recycle bin markdown to restore."), true);

    await run("window.__t.hardDeleteCurrentDeletedDocument()");
    check("...and archiving a bin entry while not in the bin is too",
      saidThat("Select a recycle bin markdown to archive."), true);

    run("window.__t.state.isRecycleBinMode = false");
    run("window.__t.state.activeFile = null");
    clearToasts();
    await run("window.__t.deleteCurrentDocument('soft')");
    check("...as is deleting with nothing open at all",
      saidThat("Select an active markdown to delete."), true);
  }

  console.log("=== a bin entry archived from the bin ===");
  {
    clearToasts();
    const file = await made("bin-then-archive.md", "# Twice over\n");
    const byName = run(`window.__t.deleteDocumentByFile(${JSON.stringify(file)}, 'soft')`);
    await answer(true);
    await byName;
    check("a document deleted by name goes to the bin", await inBin(file), true);

    const entry = await binEntry(file);
    run("window.__t.state.isRecycleBinMode = true");
    run(`window.__t.state.activeFile = ${JSON.stringify(entry.file)}`);

    const archiving = run("window.__t.hardDeleteCurrentDeletedDocument()");
    check("archiving from the bin asks first", asked().includes("stays on disk"), true);
    await answer(false);
    await archiving;
    check("...and a no leaves it in the bin", saidThat("Archive cancelled."), true);

    const again = run("window.__t.hardDeleteCurrentDeletedDocument()");
    await answer(true);
    await again;
    check("...while a yes moves it to the archive",
      saidThat("Document moved to the archive."), true);
    run("window.__t.state.isRecycleBinMode = false");
  }

  console.log("=== and out of the archive, or off the disk ===");
  {
    clearToasts();
    run('window.__t.state.viewMode = "archive"');
    await run("window.__t.refreshDeletedDocs({ preserveSearch: true })");
    const entry = state().deletedDocs.find((one) => one.originalFile === "archive-me.md");
    check("the archive has what was put in it", Boolean(entry), true);

    await run(`window.__t.restoreArchivedDocumentByFile(${JSON.stringify(entry.file)})`);
    check("restoring from the archive puts it back in the library",
      inLibrary("archive-me.md"), true);
    // And leaves you in the library looking at it, the same as the bin does.
    check("...and leaves you looking at it",
      [state().viewMode, state().activeFile], ["docs", "archive-me.md"]);
    check("...saying where it came from", saidThat("from the archive"), true);

    /* The one action in this app that destroys data. It asks, it says so in
     * those words, and the server wants the original name back before it will
     * unlink anything.
     */
    run('window.__t.state.viewMode = "archive"');
    await run("window.__t.refreshDeletedDocs({ preserveSearch: true })");
    const doomed = state().deletedDocs.find((one) => one.originalFile === "bin-then-archive.md");

    const refused = run(`window.__t.permanentlyDeleteArchivedDocument(${JSON.stringify(doomed.file)})`);
    check("erasing a document for good says that is what it is",
      asked().includes("cannot be undone"), true);
    await answer(false);
    await refused;
    check("...and a no erases nothing", saidThat("Permanent delete cancelled."), true);

    /* Erased while it is the entry on screen, which is the ordinary way to
     * reach this. It has to stop being the entry on screen, because a viewer
     * pointed at a file that is no longer on the disk cannot be refreshed.
     */
    run(`window.__t.state.activeFile = ${JSON.stringify(doomed.file)}`);
    const erasing = run(`window.__t.permanentlyDeleteArchivedDocument(${JSON.stringify(doomed.file)})`);
    await answer(true);
    await erasing;
    // Asked before the listing is reloaded, because reloading it would let go
    // of the entry anyway and the point is that the erase itself did.
    check("...and leaves nothing open rather than a file that is gone",
      state().activeFile, null);

    await run("window.__t.refreshDeletedDocs({ preserveSearch: true })");
    check("...while a yes does",
      state().deletedDocs.some((one) => one.file === doomed.file), false);

    // Refused where it makes no sense, like the rest of them.
    run('window.__t.state.viewMode = "docs"');
    clearToasts();
    await run("window.__t.permanentlyDeleteArchivedDocument('anything.md')");
    check("erasing while not looking at the archive is refused",
      saidThat("Select an archived document to delete."), true);
    clearToasts();
    await run("window.__t.restoreArchivedDocumentByFile('anything.md')");
    check("...and so is restoring from it",
      saidThat("Select an archived document to restore."), true);
  }

  console.log("=== several at once, asked about once ===");
  {
    clearToasts();
    const files = [];
    for (const name of ["batch-one.md", "batch-two.md", "batch-three.md"]) {
      files.push(await made(name, `# ${name}\n`));
    }

    const refused = run(`window.__t.deleteFiles(${JSON.stringify(files)}, 'soft')`);
    check("deleting a handful asks once, saying how many",
      askedTitle(), "Delete 3 files?");
    await answer(false);
    await refused;
    check("...and a no deletes none of them",
      files.every((one) => inLibrary(one)), true);
    check("...saying so", cheers().includes("Nothing was deleted."), true);

    clearToasts();
    const deleting = run(`window.__t.deleteFiles(${JSON.stringify(files)}, 'soft')`);
    await answer(true);
    await deleting;
    check("...while a yes deletes all of them",
      files.some((one) => inLibrary(one)), false);
    check("...and says how many went", cheers().some((one) => /3 file/.test(one)), true);

    // One file is not a handful: it goes through the single-document path, so
    // the question is about that document rather than about a count.
    clearToasts();
    const alone = await made("batch-alone.md", "# Alone\n");
    const one = run(`window.__t.deleteFiles([${JSON.stringify(alone)}], 'soft')`);
    check("deleting one file asks about that file",
      asked().includes(alone), true);
    await answer(true);
    await one;
    check("...and deletes it", inLibrary(alone), false);

    // Nothing to delete is nothing done, and nothing asked.
    clearToasts();
    await run("window.__t.deleteFiles([], 'soft')");
    await run("window.__t.deleteFiles([null, undefined], 'soft')");
    check("deleting nothing asks nothing and does nothing",
      [state().confirmOpen, cheers(), complaints()], [false, [], []]);
  }

  console.log("=== and a folder, with everything under it ===");
  {
    clearToasts();
    const csrf = state().csrfToken;
    const parent = await server.request("POST", "/api/folders", { name: "Outgoing" },
      { Cookie: cookieHeader(), "X-CSRF-Token": csrf });
    const child = await server.request("POST", "/api/folders",
      { name: "Inner", parentId: parent.body.folder.id },
      { Cookie: cookieHeader(), "X-CSRF-Token": csrf });
    await run("window.__t.refreshDocs({ preserveSearch: true })");

    const refused = run(`window.__t.deleteFolderById(${JSON.stringify(parent.body.folder.id)})`);
    /* A folder delete says how many subfolders go with it, because a folder
     * with things inside it looks the same as an empty one when it is shut.
     */
    check("deleting a folder says what else goes with it",
      asked().includes("1 subfolder"), true);
    // And that it is a label, not a filesystem: no file on disk is touched.
    check("...and that nothing on disk is touched",
      asked().includes("No file on disk is touched"), true);
    await answer(false);
    await refused;
    check("...and a no keeps the folder",
      state().folders.some((one) => one.id === parent.body.folder.id), true);

    const deleting = run(`window.__t.deleteFolderById(${JSON.stringify(parent.body.folder.id)})`);
    await answer(true);
    await deleting;
    check("...while a yes takes it and what was under it",
      state().folders.some((one) => one.id === parent.body.folder.id
        || one.id === child.body.folder.id), false);
    check("...and says how many went",
      cheers().some((one) => /1 subfolder/.test(one)), true);

    // A folder that is already gone is nothing to ask about.
    clearToasts();
    await run("window.__t.deleteFolderById('not-a-folder')");
    check("a folder that is not there is not asked about",
      [state().confirmOpen, cheers()], [false, []]);
  }

  console.log("=== the same two, reached by name rather than by being open ===");
  {
    /* The tree offers restore and archive on a row in the recycle bin without
     * opening it first, which is a different entry point into the same two
     * things — and the only one a person uses when they are tidying up.
     */
    clearToasts();
    const file = await made("by-name.md", "# By name\n");
    const deleting = run(`window.__t.deleteDocumentByFile(${JSON.stringify(file)}, 'soft')`);
    await answer(true);
    await deleting;

    const entry = await binEntry(file);
    run("window.__t.state.isRecycleBinMode = true");

    await run(`window.__t.restoreDeletedDocumentByFile(${JSON.stringify(entry.file)})`);
    check("a bin entry restored by name comes back to the library",
      inLibrary(file), true);
    check("...and leaves you in the library looking at it",
      [state().isRecycleBinMode, state().activeFile], [false, file]);

    clearToasts();
    const again = run(`window.__t.deleteDocumentByFile(${JSON.stringify(file)}, 'soft')`);
    await answer(true);
    await again;
    const second = await binEntry(file);
    run("window.__t.state.isRecycleBinMode = true");

    const refused = run(`window.__t.hardDeleteDeletedDocumentByFile(${JSON.stringify(second.file)})`);
    check("archiving a bin entry by name asks first", asked().includes("stays on disk"), true);
    await answer(false);
    await refused;
    check("...and a no leaves it in the bin", saidThat("Archive cancelled."), true);

    clearToasts();
    const archiving = run(`window.__t.hardDeleteDeletedDocumentByFile(${JSON.stringify(second.file)})`);
    await answer(true);
    await archiving;
    check("...while a yes moves it to the archive",
      saidThat("moved to the archive"), true);
    run("window.__t.state.isRecycleBinMode = false");

    // And both refused where they make no sense, the same as their open-document
    // counterparts.
    clearToasts();
    await run("window.__t.restoreDeletedDocumentByFile('anything.md')");
    check("restoring by name outside the bin is refused",
      saidThat("Select a recycle bin markdown to restore."), true);
    clearToasts();
    await run("window.__t.hardDeleteDeletedDocumentByFile('anything.md')");
    check("...and so is archiving by name",
      saidThat("Select a recycle bin markdown to archive."), true);
    clearToasts();
    run("window.__t.state.isRecycleBinMode = true");
    await run("window.__t.restoreDeletedDocumentByFile('')");
    check("...and neither works on nothing",
      saidThat("Select a recycle bin markdown to restore."), true);
    run("window.__t.state.isRecycleBinMode = false");
  }

  console.log("=== and what any of them says when the server will not ===");
  {
    clearToasts();
    const file = await made("refused.md", "# Refused\n");
    const realFetch = window.fetch;
    window.fetch = async (input, options) => {
      if (String(input).includes("/delete")) {
        return /** @type {any} */ ({
          ok: false, status: 500,
          json: async () => ({ error: "The store is unavailable." }),
          text: async () => '{"error":"The store is unavailable."}'
        });
      }

      return realFetch(input, options);
    };

    run(`window.__t.state.activeFile = ${JSON.stringify(file)}`);
    const refusedOne = run("window.__t.deleteCurrentDocument('soft')");
    await answer(true);
    await refusedOne;
    check("a delete the server refuses is said out loud",
      saidThat("The store is unavailable."), true);
    check("...and the document stays where it was", inLibrary(file), true);

    /* A delete endpoint that 404s is a different problem from a delete that
     * was refused: it means the server is running an older build without the
     * recycle-bin routes, and the only useful thing to say is "restart it".
     */
    clearToasts();
    Object.assign(window, {
      fetch: async (input, options) => {
        if (String(input).includes("/delete")) {
          return /** @type {any} */ ({
            ok: false, status: 404,
            json: async () => ({ error: "Request failed (404)" }),
            text: async () => '{"error":"Request failed (404)"}'
          });
        }

        return realFetch(input, options);
      }
    });

    const missing = run("window.__t.deleteCurrentDocument('soft')");
    await answer(true);
    await missing;
    check("a delete endpoint that is not there says to restart the server",
      saidThat("Restart the server"), true);

    /* And the other two, which have no special case: whatever the server said,
     * said back.
     */
    clearToasts();
    Object.assign(window, {
      fetch: async (input, options) => {
        if (String(input).includes("/recycle-bin/")) {
          return /** @type {any} */ ({
            ok: false, status: 500,
            json: async () => ({ error: "The bin is unavailable." }),
            text: async () => '{"error":"The bin is unavailable."}'
          });
        }

        return realFetch(input, options);
      }
    });

    run("window.__t.state.isRecycleBinMode = true");
    run('window.__t.state.activeFile = "whatever.md"');
    await run("window.__t.restoreCurrentDeletedDocument()");
    check("a restore the server refuses is said out loud",
      saidThat("The bin is unavailable."), true);

    clearToasts();
    const archiving = run("window.__t.hardDeleteCurrentDeletedDocument()");
    await answer(true);
    await archiving;
    check("...and so is an archive it refuses", saidThat("The bin is unavailable."), true);
    run("window.__t.state.isRecycleBinMode = false");

    /* And the by-name delete, which has the same two refusals and the same
     * 404 message as its open-document twin — it is reached from a tree row
     * rather than from the toolbar, and nothing had asked it anything.
     */
    clearToasts();
    Object.assign(window, { fetch: realFetch });
    run("window.__t.state.isRecycleBinMode = true");
    await run(`window.__t.deleteDocumentByFile(${JSON.stringify(file)}, 'soft')`);
    check("deleting by name while looking at the bin is refused",
      saidThat("Select a markdown to delete."), true);
    run("window.__t.state.isRecycleBinMode = false");

    clearToasts();
    await run("window.__t.deleteDocumentByFile('', 'soft')");
    check("...and so is deleting nothing by name",
      saidThat("Select a markdown to delete."), true);

    clearToasts();
    const cancelled = run(`window.__t.deleteDocumentByFile(${JSON.stringify(file)}, 'soft')`);
    await answer(false);
    await cancelled;
    check("...while a no is a delete that did not happen",
      [saidThat("Delete cancelled."), inLibrary(file)], [true, true]);

    clearToasts();
    Object.assign(window, {
      fetch: async (input, options) => {
        if (String(input).includes("/delete")) {
          return /** @type {any} */ ({
            ok: false, status: 404,
            json: async () => ({ error: "Request failed (404)" }),
            text: async () => '{"error":"Request failed (404)"}'
          });
        }

        return realFetch(input, options);
      }
    });
    const absent = run(`window.__t.deleteDocumentByFile(${JSON.stringify(file)}, 'soft')`);
    await answer(true);
    await absent;
    check("...and a missing endpoint says to restart the server here too",
      saidThat("Restart the server"), true);

    /* And whatever else the server says, said back as it was: each of the five
     * by-name verbs has its own catch, and a reader who is told nothing has no
     * idea whether their document is still there.
     */
    clearToasts();
    Object.assign(window, {
      fetch: async (input, options) => {
        if (/\/(delete|restore|hard-delete)|\/api\/archive\//.test(String(input))) {
          return /** @type {any} */ ({
            ok: false, status: 503,
            json: async () => ({ error: "The disk is busy." }),
            text: async () => '{"error":"The disk is busy."}'
          });
        }

        return realFetch(input, options);
      }
    });

    run("window.__t.state.isRecycleBinMode = true");
    await run("window.__t.restoreDeletedDocumentByFile('an-entry.md')");
    check("a restore by name the server refuses is said back as it was",
      saidThat("The disk is busy."), true);

    clearToasts();
    const archiveByName = run("window.__t.hardDeleteDeletedDocumentByFile('an-entry.md')");
    await answer(true);
    await archiveByName;
    check("...and an archive by name too", saidThat("The disk is busy."), true);
    run("window.__t.state.isRecycleBinMode = false");

    clearToasts();
    const deleteByName = run(`window.__t.deleteDocumentByFile(${JSON.stringify(file)}, 'soft')`);
    await answer(true);
    await deleteByName;
    check("...and a delete by name that failed for any other reason",
      saidThat("The disk is busy."), true);

    clearToasts();
    run('window.__t.state.viewMode = "archive"');
    await run("window.__t.restoreArchivedDocumentByFile('an-entry.md')");
    check("...and a restore out of the archive", saidThat("The disk is busy."), true);

    clearToasts();
    const erasing = run("window.__t.permanentlyDeleteArchivedDocument('an-entry.md')");
    await answer(true);
    await erasing;
    check("...and an erase it would not do", saidThat("The disk is busy."), true);
    run('window.__t.state.viewMode = "docs"');

    /* The folder delete, which reports the same way: one toast, whatever went
     * wrong.
     */
    clearToasts();
    const csrf = state().csrfToken;
    const doomedFolder = await server.request("POST", "/api/folders", { name: "Refusing" },
      { Cookie: cookieHeader(), "X-CSRF-Token": csrf });
    await run("window.__t.refreshDocs({ preserveSearch: true })");
    Object.assign(window, {
      fetch: async (input, options) => {
        if (String(input).includes("/api/folders/")) {
          return /** @type {any} */ ({
            ok: false, status: 500,
            json: async () => ({ error: "The folder store is unavailable." }),
            text: async () => '{"error":"The folder store is unavailable."}'
          });
        }

        return realFetch(input, options);
      }
    });

    const folder = run(`window.__t.deleteFolderById(${JSON.stringify(doomedFolder.body.folder.id)})`);
    await answer(true);
    await folder;
    check("a folder the server will not delete is said out loud",
      saidThat("The folder store is unavailable."), true);

    /* A batch reports the first thing that went wrong rather than one toast
     * per file: ten failures is one problem, said once.
     */
    Object.assign(window, {
      fetch: async (input, options) => {
        if (String(input).includes("/delete")) {
          return /** @type {any} */ ({
            ok: false, status: 500,
            json: async () => ({ error: "The store is unavailable." }),
            text: async () => '{"error":"The store is unavailable."}'
          });
        }

        return realFetch(input, options);
      }
    });
    run(`window.__t.state.activeFile = ${JSON.stringify(file)}`);
    clearToasts();
    const batch = run(`window.__t.deleteFiles(${JSON.stringify([file, "refused.md"])}, 'soft')`);
    await answer(true);
    await batch;
    check("...and a batch says it once rather than once per file",
      complaints().length, 1);

    Object.assign(window, { fetch: realFetch });
  }
};
