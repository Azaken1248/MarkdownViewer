// Part of the DOM suite. See dom.test.js, which sets all this up and calls it.
//
// Opening a document: the race between two of them, the one that cannot be
// read, and the ones that are not in the library any more.
//
// app/opening.js puts every document on the screen, and the ordinary path
// through it is exercised by every other file in this suite. What nothing
// reached was the rest: the open that is abandoned because the page is being
// edited, the answer that arrives after somebody opened something else, the
// failure, and the whole of the recycle bin's reader — which is the only way
// to look at a deleted document before deciding whether to restore it.
module.exports = async (ctx) => {
  const { check, waitUntil, window, doc, server, cookieHeader } = ctx;

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
  // The same shape the client uses: the slashes stay, the segments are
  // escaped. Encoding the lot turns a document in a folder into a 500.
  const docUrl = (file) => String(file).split("/").map(encodeURIComponent).join("/");
  const binned = async (name) => {
    await server.request("POST", `/api/docs/${name}/delete`, { mode: "soft" },
      { Cookie: cookieHeader(), "X-CSRF-Token": csrf() });
  };

  /* Everything the earlier files threw away is still in here, and the two
   * empty states cannot be read until it is gone. The bin empties into the
   * archive, so emptying both is two passes.
   */
  const emptyTheBin = async () => {
    for (const entry of state().deletedDocs.map((one) => one.file)) {
      await server.request("POST", `/api/recycle-bin/${docUrl(entry)}/hard-delete`,
        {}, { Cookie: cookieHeader(), "X-CSRF-Token": csrf() });
    }
  };
  const emptyTheArchive = async () => {
    for (const one of state().deletedDocs) {
      await server.request("DELETE", `/api/archive/${docUrl(one.file)}`,
        { confirmFile: one.originalFile || one.file },
        { Cookie: cookieHeader(), "X-CSRF-Token": csrf() });
    }
  };

  const shown = () => doc.getElementById("docContent").textContent;
  const emptyState = () => [doc.querySelector("#emptyState h3")?.textContent,
    doc.getElementById("emptyState").style.display !== "none"];

  await made("reading-one.md", "# Reading One\n\nFirst document.\n");
  await made("reading-two.md", "# Reading Two\n\nSecond document.\n");
  await run("window.__t.refreshDocs({ preserveSearch: true })");

  console.log("=== two documents opened at once ===");
  {
    await run('window.__t.openDocument("reading-one.md", false)');
    await waitUntil(() => shown().includes("First document"), 4000);

    /* The answers can arrive in either order. Whichever document was asked
     * for last is the one that must be on screen when they have: the first
     * one's content arriving late must not paint over it, and every await in
     * the open is checked against the request id for that reason.
     *
     * The slow one is made slow here, because against a local server both
     * come back in the same millisecond and the race never happens.
     */
    const realFetch = window.fetch;
    const useFetch = (fn) => { window.fetch = fn; };
    useFetch(async (url, options = {}) => {
      if (String(url).includes("reading-one.md")) {
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      return realFetch(url, options);
    });

    const slow = run('window.__t.openDocument("reading-one.md", false, { forceReload: true })');
    await settle();
    const quick = run('window.__t.openDocument("reading-two.md", false, { forceReload: true })');
    await Promise.all([slow, quick]);
    await settle();

    check("the document asked for last is the one on screen",
      [shown().includes("Second document"), shown().includes("First document")], [true, false]);
    check("...and it is the one the app says is open", state().activeFile, "reading-two.md");
    useFetch(realFetch);
  }

  console.log("=== one that cannot be read ===");
  {
    await made("reading-gone.md", "# Gone\n");
    await run("window.__t.refreshDocs({ preserveSearch: true })");
    await binned("reading-gone.md");
    await settle();
    await waitUntil(() => {
      run('window.__t.state.contentCache.delete("reading-gone.md")');
      return !run('window.__t.state.contentCache.has("reading-gone.md")');
    }, 4000);

    clearToasts();
    await run('window.__t.openDocument("reading-gone.md", false)');
    await waitUntil(() => said().length > 0, 4000);
    /* The empty state says it as well as the toast. A toast is gone in a few
     * seconds and the panel behind it would otherwise still be showing the
     * document somebody had open before this one failed.
     */
    check("a document the server will not give up says so on the page",
      emptyState(), ["Could not load this markdown", true]);
    check("...and in a message", said().length > 0, true);

    /* And a failure that arrives after somebody opened something else is not
     * shown at all. The document on screen is the one that was asked for
     * last; painting "could not load this" over it would be an error message
     * about a document nobody is looking at.
     */
    await run('window.__t.openDocument("reading-one.md", false, { forceReload: true })');
    await waitUntil(() => shown().includes("First document"), 4000);

    const realFetch = window.fetch;
    const useFetch = (fn) => { window.fetch = fn; };
    useFetch(async (url, options = {}) => {
      if (String(url).includes("reading-one.md")) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        return { status: 500, ok: false, async json() { return { error: "Gone wrong." }; },
          async text() { return "{}"; } };
      }
      return realFetch(url, options);
    });

    clearToasts();
    const failing = run('window.__t.openDocument("reading-one.md", false, { forceReload: true })');
    await settle();
    const landing = run('window.__t.openDocument("reading-two.md", false, { forceReload: true })');
    await Promise.all([failing, landing]);
    await settle();
    useFetch(realFetch);

    check("a failure that arrives late is not shown over the document that won",
      [shown().includes("Second document"), said().at(-1)],
      [true, "Viewing reading-two.md"]);
    check("...and nothing says anything went wrong",
      [said().some((one) => /could not|wrong/i.test(one)), ...emptyState().slice(1)],
      [false, false]);

    // A file the library has never heard of is not an error at all: there is
    // nothing to show and nothing went wrong.
    clearToasts();
    const before = shown();
    await run('window.__t.openDocument("never-in-the-library.md", false)');
    await settle();
    check("one that was never in the library does nothing at all",
      [said(), shown()], [[], before]);
  }

  console.log("=== opening something else while the page is being edited ===");
  {
    await run('window.__t.openDocument("reading-one.md", false, { forceReload: true })');
    await waitUntil(() => shown().includes("First document"), 4000);
    await run("window.__t.startPageEdit()");
    await waitUntil(() => run("window.__t.pageEditActive()"), 4000);

    const block = doc.querySelector('#docContent .ve-block[contenteditable="true"]');
    block.innerHTML = "<h1>Half written</h1>";
    block.dispatchEvent(new window.Event("input", { bubbles: true }));

    /* Opening another document would replace the edits with it. The question
     * is asked first, and saying "keep editing" has to leave both the editing
     * and the document that is open exactly as they were.
     */
    const abandoned = run('window.__t.openDocument("reading-two.md", false)');
    await waitUntil(() => state().confirmOpen, 4000);
    run("window.__t.resolveConfirmDialog(false)");
    await abandoned;
    await settle();
    check("keeping the edits abandons the open",
      [state().activeFile, run("window.__t.pageEditActive()")], ["reading-one.md", true]);
    check("...with what was typed still on the page",
      shown().includes("Half written"), true);

    const leaving = run('window.__t.openDocument("reading-two.md", false)');
    await waitUntil(() => state().confirmOpen, 4000);
    run("window.__t.resolveConfirmDialog(true)");
    await leaving;
    await waitUntil(() => state().activeFile === "reading-two.md", 4000);
    check("discarding them opens the other document",
      [state().activeFile, run("window.__t.pageEditActive()")], ["reading-two.md", false]);
    check("...and what was typed is gone, which is what discard means",
      shown().includes("Half written"), false);
  }

  console.log("=== reading a document that has been deleted ===");
  {
    await made("reading-binned.md", "# Binned\n\nStill readable.\n");
    await run("window.__t.refreshDocs({ preserveSearch: true })");
    await binned("reading-binned.md");

    await run('window.__t.switchViewMode("recycle")');
    await waitUntil(() => state().viewMode === "recycle"
      && state().deletedDocs.length > 0, 6000);

    const row = [...doc.querySelectorAll(".tree-row-doc")]
      .find((one) => one.dataset.file.endsWith("--reading-binned.md"));
    const button = row.querySelector(".tree-row-btn");

    clearToasts();
    button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitUntil(() => shown().includes("Still readable"), 6000);

    /* The whole point of the bin is deciding whether to restore something,
     * which means reading it first. It is rendered the same way the library
     * renders a document — through the sanitizer — and the title and the
     * message say where it is being read from, because the buttons on screen
     * mean different things here.
     */
    check("a row in the bin opens the deleted document", shown().includes("Still readable"), true);
    check("...and the app knows which one is open",
      state().activeFile, row.dataset.file);
    // The render is on screen before the title and the message are set: a
    // frame and a Mermaid pass happen in between.
    await waitUntil(() => said().length > 0, 6000);
    check("...the title says it is in the recycle bin",
      doc.title.includes("Recycle Bin"), true);
    check("...and so does the message", said().at(-1),
      "Viewing deleted doc reading-binned.md");

    // The same document, read out of the archive, says the other thing.
    const archiving = run(`window.__t.hardDeleteDeletedDocumentByFile(${
      JSON.stringify(row.dataset.file)})`);
    await waitUntil(() => state().confirmOpen, 4000);
    run("window.__t.resolveConfirmDialog(true)");
    await archiving;

    await run('window.__t.switchViewMode("archive")');
    await waitUntil(() => state().viewMode === "archive"
      && state().deletedDocs.some((one) => one.file.endsWith("--reading-binned.md")), 6000);
    clearToasts();
    const archived = state().deletedDocs
      .find((one) => one.file.endsWith("--reading-binned.md")).file;
    await run(`window.__t.openRecycleBinDocument(${JSON.stringify(archived)}, { forceReload: true })`);
    await waitUntil(() => said().length > 0, 6000);
    check("the same document read out of the archive says so in the title",
      doc.title.includes("Archive"), true);
    check("...and in the message", said().at(-1),
      "Viewing archived doc reading-binned.md");

    /* Refreshing the list while something is open reopens it. The row is
     * drawn again from the answer the server just gave, so the document
     * behind it has to be drawn again too or the two stop agreeing.
     */
    clearToasts();
    await run("window.__t.refreshDeletedDocs({ preserveSearch: true })");
    await waitUntil(() => said().length > 0, 6000);
    check("refreshing the list puts the open document back up",
      [shown().includes("Still readable"), said().at(-1)],
      [true, "Viewing archived doc reading-binned.md"]);

    // Asked for something that is not in this list, it does nothing rather
    // than drawing an empty document over the one being read.
    clearToasts();
    const reading = shown();
    await run('window.__t.openRecycleBinDocument("not-in-the-bin.md")');
    await settle();
    check("a file that is not in this list is not opened",
      [said(), shown()], [[], reading]);
  }

  console.log("=== and one whose content has gone from under it ===");
  {
    const entry = state().deletedDocs
      .find((one) => one.file.endsWith("--reading-binned.md")).file;
    // Erasing for good makes the caller echo the name back, so a stray
    // DELETE cannot destroy a document by accident.
    await server.request("DELETE", `/api/archive/${docUrl(entry)}`,
      { confirmFile: "reading-binned.md" },
      { Cookie: cookieHeader(), "X-CSRF-Token": csrf() });
    await waitUntil(() => {
      run(`window.__t.state.contentCache.delete(${JSON.stringify(entry)})`);
      return !run(`window.__t.state.contentCache.has(${JSON.stringify(entry)})`);
    }, 4000);

    clearToasts();
    await run(`window.__t.openRecycleBinDocument(${JSON.stringify(entry)}, { forceReload: true })`);
    await waitUntil(() => said().length > 0, 4000);
    check("a deleted document whose bytes have gone says so",
      emptyState(), ["Could not load deleted document", true]);
  }

  console.log("=== an empty bin, and an empty archive ===");
  {
    // Whatever earlier files left in the bin is emptied, so the two empty
    // states are the ones being read rather than a leftover document.
    await run('window.__t.switchViewMode("recycle")');
    await waitUntil(() => state().viewMode === "recycle", 6000);
    await emptyTheBin();

    clearToasts();
    await run("window.__t.refreshDeletedDocs({ preserveSearch: true })");
    await waitUntil(() => state().deletedDocs.length === 0, 6000);
    check("an empty recycle bin says what would be in it",
      emptyState(), ["Recycle bin is empty", true]);
    check("...and says it once, in a message as well",
      said().at(-1), "Recycle bin is empty.");
    check("...with nothing claimed to be open", state().activeFile, null);

    await run('window.__t.switchViewMode("archive")');
    await waitUntil(() => state().viewMode === "archive", 6000);
    await emptyTheArchive();

    clearToasts();
    await run("window.__t.refreshDeletedDocs({ preserveSearch: true })");
    await waitUntil(() => state().deletedDocs.length === 0, 6000);
    check("an empty archive says the other thing",
      emptyState(), ["Archive is empty", true]);
    check("...and so does its message", said().at(-1), "Archive is empty.");

    /* A bin with something in it, but nothing to open: the file that was
     * being read is gone and nothing was asked for. The empty state says so
     * and no message is sent, because a toast on every refresh is what
     * teaches people to ignore toasts.
     */
    await made("reading-leftover.md", "# Leftover\n");
    await run('window.__t.switchViewMode("docs")');
    await waitUntil(() => state().viewMode === "docs", 6000);
    await run("window.__t.refreshDocs({ preserveSearch: true })");
    await binned("reading-leftover.md");

    await run('window.__t.switchViewMode("recycle")');
    await waitUntil(() => state().viewMode === "recycle"
      && state().deletedDocs.length > 0, 6000);
    run("window.__t.state.activeFile = null");
    clearToasts();
    await run("window.__t.refreshDeletedDocs({ preserveSearch: true })");
    await settle();
    check("a bin with nothing chosen in it asks for a choice",
      emptyState(), ["No file selected", true]);
    check("...without a message, which would fire on every refresh", said(), []);

    await emptyTheBin();
    await run('window.__t.switchViewMode("docs")');
    await waitUntil(() => state().viewMode === "docs", 6000);
  }

  for (const file of ["reading-one.md", "reading-two.md"]) {
    await binned(file);
  }
  await run("window.__t.refreshDocs({ preserveSearch: true })");
};
