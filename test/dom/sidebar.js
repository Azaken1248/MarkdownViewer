// Part of the DOM suite. See dom.test.js, which sets all this up and calls it.
//
// The sidebar's own controls: the empty space under the rows, the folder
// dialog's buttons, and Refresh.
//
// test/dom/folders.js drives the folder operations and test/dom/tree.js the
// rows. What nothing pressed was the furniture around them — and the folder
// dialog is the one place in the app where the same button means three
// different things depending on why the dialog was opened, which is exactly
// the kind of thing that stops meaning the right one.
module.exports = async (ctx) => {
  const { check, waitUntil, window, doc, server, cookieHeader, get } = ctx;

  const run = (source) => window.eval(source);
  const state = () => run("window.__t.state");
  const el = (id) => doc.getElementById(id);
  const said = () => [...doc.querySelectorAll("#toastStack .toast, #toastStackUrgent .toast")]
    .map((one) => one.querySelector(".toast-message")?.textContent || "");
  const clearToasts = () => doc.querySelectorAll(".toast").forEach((one) => one.remove());
  const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

  const press = (id) => el(id).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const csrf = () => state().csrfToken;
  const made = async (name, content = `# ${name}\n`, folderId = null) => {
    await server.request("POST", "/api/docs",
      { fileName: name, overwrite: true, content, folderId },
      { Cookie: cookieHeader(), "X-CSRF-Token": csrf() });
  };
  const folderNamed = async (name) => (await server.request("POST", "/api/folders",
    { name }, { Cookie: cookieHeader(), "X-CSRF-Token": csrf() })).body.folder;

  // The folder a document is in, as the server has it: null for one that is
  // in none, and a sentinel for one that is not there at all — which ?? on
  // folderName would otherwise turn into the same answer.
  const whereIs = async (file) => {
    const docs = JSON.parse((await get("/api/docs")).body).docs;
    const entry = docs.find((one) => one.file.endsWith(file));
    return entry ? entry.folderName : "(not there)";
  };

  console.log("=== the empty space under the rows ===");
  {
    await made("sidebar-one.md");
    await run("window.__t.refreshDocs({ preserveSearch: true })");
    await waitUntil(() => doc.querySelectorAll(".tree-row-doc").length > 0, 4000);

    run('window.__t.setSelection(["sidebar-one.md"], { anchor: "sidebar-one.md" })');
    check("(a row is selected)", state().selection.size, 1);

    /* Clicking the empty space below the rows clears the selection, the way a
     * file manager does. A click that landed on a row belongs to the row, so
     * the handler asks which it was.
     */
    el("docList").dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    check("clicking the empty space below the rows clears the selection",
      state().selection.size, 0);

    run('window.__t.setSelection(["sidebar-one.md"], { anchor: "sidebar-one.md" })');
    doc.querySelector(".tree-row-doc")
      .dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    check("...while a click on a row leaves it to the row",
      state().selection.size, 1);

    // Right-clicking the empty space offers what can be done to the library
    // itself rather than to a document.
    const menu = (target) => {
      const event = new window.MouseEvent("contextmenu",
        { bubbles: true, cancelable: true, clientX: 20, clientY: 20 });
      target.dispatchEvent(event);
      return event;
    };

    const empty = menu(el("docList"));
    const items = () => [...doc.querySelectorAll("#contextMenu .context-item")]
      .map((one) => one.textContent.trim());
    check("right-clicking it opens a menu of its own", empty.defaultPrevented, true);
    check("...offering the things that are about the library",
      [items().includes("New file"), items().includes("New folder"),
        items().includes("Select all")], [true, true, true]);
    /* Paste is offered disabled rather than hidden, so the menu does not
     * change shape between a copy and no copy.
     */
    check("...and Paste, which says how many are waiting",
      items().some((one) => /^Paste$/.test(one)), true);
    run("window.__t.closeContextMenu()");

    run('window.__t.state.clipboard = { mode: "copy", files: ["sidebar-one.md"] }');
    menu(el("docList"));
    check("...and counts them once something is on the clipboard",
      items().some((one) => one.includes("Paste 1 file(s) into Ungrouped")), true);
    run("window.__t.closeContextMenu()");
    run('window.__t.state.clipboard = { mode: null, files: [] }');

    // A right-click that landed on a row is the row's menu, not this one.
    const onRow = menu(doc.querySelector(".tree-row-doc"));
    check("a right-click on a row is left to the row", onRow.defaultPrevented, true);
    check("...which offers what can be done to a document",
      items().some((one) => /Rename|Move|recycle bin/i.test(one)), true);
    run("window.__t.closeContextMenu()");

    // Select all, from that menu, takes everything the tree is showing.
    menu(el("docList"));
    const all = [...doc.querySelectorAll("#contextMenu .context-item")]
      .find((one) => one.textContent.trim() === "Select all");
    all.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await settle();
    check("Select all selects every row the tree is showing",
      state().selection.size, state().visibleFileOrder.length);
    run("window.__t.clearSelection()");
  }

  console.log("=== the folder dialog's three ways out ===");
  {
    press("createFolderBtn");
    await waitUntil(() => el("folderModal").classList.contains("open"), 4000);
    check("the New folder button opens the dialog in create mode",
      [el("folderModal").classList.contains("open"), state().folderModalMode],
      [true, "create"]);

    press("closeFolderModalBtn");
    await settle();
    check("...its close button closes it", el("folderModal").classList.contains("open"), false);

    press("createFolderBtn");
    await waitUntil(() => el("folderModal").classList.contains("open"), 4000);
    press("folderBackdrop");
    await settle();
    check("...and so does clicking away", el("folderModal").classList.contains("open"), false);

    // The confirm button, which is what actually makes the folder.
    press("createFolderBtn");
    await waitUntil(() => el("folderModal").classList.contains("open"), 4000);
    el("folderNameInput").value = "Sidebar Made";
    clearToasts();
    press("createFolderConfirmBtn");
    await waitUntil(() => state().folders.some((one) => one.name === "Sidebar Made"), 6000);
    check("Create folder makes the folder",
      state().folders.some((one) => one.name === "Sidebar Made"), true);
    check("...and closes the dialog behind it",
      el("folderModal").classList.contains("open"), false);

    /* Enter in the name field is the same action. A dialog with one text field
     * and a button that has to be clicked instead is the kind of thing people
     * put up with rather than report.
     */
    press("createFolderBtn");
    await waitUntil(() => el("folderModal").classList.contains("open"), 4000);
    el("folderNameInput").value = "Sidebar Typed";
    const entered = new window.KeyboardEvent("keydown",
      { key: "Enter", bubbles: true, cancelable: true });
    el("folderNameInput").dispatchEvent(entered);
    await waitUntil(() => state().folders.some((one) => one.name === "Sidebar Typed"), 6000);
    check("Enter in the name field makes it too",
      [entered.defaultPrevented, state().folders.some((one) => one.name === "Sidebar Typed")],
      [true, true]);

    // Another key is the field's own.
    press("createFolderBtn");
    await waitUntil(() => el("folderModal").classList.contains("open"), 4000);
    const typing = new window.KeyboardEvent("keydown",
      { key: "a", bubbles: true, cancelable: true });
    el("folderNameInput").dispatchEvent(typing);
    check("...and any other key is left to the typing", typing.defaultPrevented, false);
    press("closeFolderModalBtn");
    await settle();
  }

  console.log("=== Move to Ungrouped, which means three different things ===");
  {
    const folder = await folderNamed("Sidebar Holding");
    await made("sidebar-filed.md", "# Filed\n", folder.id);
    await run("window.__t.refreshDocs({ preserveSearch: true })");
    check("(the document is in the folder)", await whereIs("sidebar-filed.md"), "Sidebar Holding");

    run('window.__t.openFolderModal({ mode: "move", file: "Sidebar Holding/sidebar-filed.md" })');
    await waitUntil(() => el("folderModal").classList.contains("open"), 4000);
    clearToasts();
    press("moveToRootBtn");
    await waitUntil(() => el("folderModal").classList.contains("open") === false, 6000);
    check("in move mode it takes the document out of its folder",
      await whereIs("sidebar-filed.md"), null);

    /* With nothing to move it does nothing at all, rather than moving the
     * document that happened to be open.
     */
    run('window.__t.openFolderModal({ mode: "move", file: null })');
    await waitUntil(() => el("folderModal").classList.contains("open"), 4000);
    clearToasts();
    press("moveToRootBtn");
    await settle();
    check("with no document named it does nothing",
      [el("folderModal").classList.contains("open"), said()], [true, []]);
    press("closeFolderModalBtn");
    await settle();

    // A move the server refuses leaves the dialog open with the reason.
    run('window.__t.openFolderModal({ mode: "move", file: "never-written-at-all.md" })');
    await waitUntil(() => el("folderModal").classList.contains("open"), 4000);
    clearToasts();
    press("moveToRootBtn");
    await waitUntil(() => said().length > 0, 6000);
    check("a move the server refuses says why",
      [el("folderModal").classList.contains("open"), said().length > 0], [true, true]);
    press("closeFolderModalBtn");
    await settle();

    /* And in upload mode the same button means "put this file in no folder",
     * which is the one path where the dialog is holding a file rather than a
     * document that already exists.
     */
    // The file is handed to the window through a function, so the assignment
    // is not one made across an await.
    const waiting = (file) => { window.__pending = file; };
    waiting(new window.File(["# Uploaded from the sidebar\n"],
      "sidebar-uploaded.md", { type: "text/markdown" }));

    run('window.__t.openFolderModal({ mode: "upload" })');
    await waitUntil(() => el("folderModal").classList.contains("open"), 4000);
    run("window.__t.state.pendingUploadFile = window.__pending");
    clearToasts();
    press("moveToRootBtn");
    await waitUntil(() => said().some((one) => /Uploaded/.test(one)), 8000);
    check("in upload mode it uploads the waiting file into no folder",
      said().at(-1), "Uploaded sidebar-uploaded.md.");
    check("...and the document is in the library", await whereIs("sidebar-uploaded.md"), null);
    check("...with the dialog closed", el("folderModal").classList.contains("open"), false);
  }

  console.log("=== and Refresh, which refreshes whichever list is showing ===");
  {
    clearToasts();
    press("refreshDocs");
    await waitUntil(() => said().length > 0, 6000);
    check("in the library it refreshes the documents", said().at(-1), "Document list refreshed.");

    await run('window.__t.switchViewMode("recycle")');
    await waitUntil(() => state().viewMode === "recycle", 6000);
    clearToasts();
    press("refreshDocs");
    await waitUntil(() => said().length > 0, 6000);
    check("in the recycle bin it refreshes the bin", said().at(-1), "Recycle bin refreshed.");

    await run('window.__t.switchViewMode("archive")');
    await waitUntil(() => state().viewMode === "archive", 6000);
    clearToasts();
    press("refreshDocs");
    await waitUntil(() => said().length > 0, 6000);
    check("...and in the archive, the archive", said().at(-1), "Archive refreshed.");

    await run('window.__t.switchViewMode("links")');
    await waitUntil(() => state().viewMode === "links", 6000);
    clearToasts();
    press("refreshDocs");
    await waitUntil(() => said().length > 0, 6000);
    check("in the links pane it refreshes the links", said().at(-1), "Saved links refreshed.");

    // A refresh that fails says so rather than leaving the list as it was
    // with nothing said about it.
    const realFetch = window.fetch;
    const useFetch = (fn) => { window.fetch = fn; };
    useFetch(async (url, options = {}) => (String(url).startsWith("/api/links")
      ? { status: 500, ok: false, async json() { return { error: "The list fell over." }; },
        async text() { return "{}"; } }
      : realFetch(url, options)));
    clearToasts();
    press("refreshDocs");
    await waitUntil(() => said().length > 0, 6000);
    useFetch(realFetch);
    check("a refresh that fails says so", said().at(-1), "The list fell over.");

    await run('window.__t.switchViewMode("docs")');
    await waitUntil(() => state().viewMode === "docs", 6000);
    await run("window.__t.refreshDocs({ preserveSearch: true })");
  }

  console.log("=== the drawer's own way out ===");
  {
    // On a phone the drawer covers the header, so it carries its own close
    // button; on a wide screen it is the same element, hidden by CSS.
    const shell = doc.getElementById("appShell");
    run("window.__t.setNavOpen(true)");
    check("(the drawer is open)",
      [shell.classList.contains("nav-open"),
        el("toggleSidebar").getAttribute("aria-expanded")], [true, "true"]);

    press("closeSidebarBtn");
    await settle();
    check("the drawer's close button closes it",
      [shell.classList.contains("nav-open"),
        el("toggleSidebar").getAttribute("aria-expanded")], [false, "false"]);
  }

  for (const file of ["sidebar-one.md", "sidebar-filed.md", "sidebar-uploaded.md"]) {
    await server.request("POST", `/api/docs/${file}/delete`, { mode: "soft" },
      { Cookie: cookieHeader(), "X-CSRF-Token": csrf() });
  }
  await run("window.__t.refreshDocs({ preserveSearch: true })");
};
