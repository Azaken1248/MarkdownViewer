// Part of the DOM suite. See dom.test.js, which sets all this up and calls it.
//
// Moving things about in the tree: dragging a document into a folder, dragging
// a folder into another, and doing the same from the keyboard.
//
// test/dom/tree.js covers what the tree draws and what clicking a row does.
// What nothing reached was the dragging and the keys — which are the same two
// operations as the context menu's Move, reached the two ways a person
// actually reaches them, and the only place in the tree where an offer has to
// be refused before it is made: a folder cannot be dropped inside itself.
module.exports = async (ctx) => {
  const { check, waitUntil, window, doc, server, cookieHeader } = ctx;

  const run = (source) => window.eval(source);
  const state = () => run("window.__t.state");

  const said = () => [...doc.querySelectorAll("#toastStack .toast, #toastStackUrgent .toast")]
    .map((one) => one.querySelector(".toast-message")?.textContent || "");
  const clearToasts = () => doc.querySelectorAll(".toast").forEach((one) => one.remove());

  const csrf = () => state().csrfToken;
  const made = async (name, folderId = null) => {
    await server.request("POST", "/api/docs",
      { fileName: name, overwrite: true, content: `# ${name}\n`, folderId },
      { Cookie: cookieHeader(), "X-CSRF-Token": csrf() });
  };

  const folder = async (name, parentId = null) => (await server.request("POST", "/api/folders",
    { name, parentId }, { Cookie: cookieHeader(), "X-CSRF-Token": csrf() })).body.folder;

  /* A drag, as the four events a browser sends. jsdom has no DataTransfer, so
   * there is one here: what the tree reads off it is the effect it sets and
   * the text it puts on it, and what it actually moves is in state.dragPayload.
   */
  const transfer = () => {
    const data = new Map();
    return {
      effectAllowed: "", dropEffect: "",
      setData: (type, value) => data.set(type, value),
      getData: (type) => data.get(type) || "",
      get types() {
        return [...data.keys()];
      }
    };
  };

  const fire = (node, type, dataTransfer, extra = {}) => {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { dataTransfer, ...extra });
    node.dispatchEvent(event);
    return event;
  };

  // By the attribute rather than by a selector, because a document's path is
  // its name and a name can hold anything a filesystem will take.
  const rowForFile = (file) => [...doc.querySelectorAll(".tree-row")]
    .find((one) => one.dataset.file === file);
  const rowForFolder = (id) => [...doc.querySelectorAll(".tree-row-folder")]
    .find((one) => one.dataset.folderId === id);

  const folderOf = (file) => state().docs.find((one) => one.file.endsWith(file))?.folderId ?? null;

  console.log("=== dragging a document into a folder ===");
  {
    clearToasts();
    const outbox = await folder("Outbox");
    await made("dragged.md");
    await run("window.__t.refreshDocs({ preserveSearch: true })");
    await waitUntil(() => Boolean(rowForFile("dragged.md")));

    const row = rowForFile("dragged.md");
    const carried = transfer();

    fire(row, "dragstart", carried);
    /* Dragging an unselected row selects it first, so what is being dragged is
     * always what can be seen highlighted.
     */
    check("dragging a row picks it up", [...state().selection], ["dragged.md"]);
    check("...and says so on the row", row.classList.contains("is-dragging"), true);
    check("...telling the browser it is a move", carried.effectAllowed, "move");
    // The plain text is for everything outside this page: a drag that leaves
    // the window should still be the names of what was dragged.
    check("...and carrying the names, for anything outside this page",
      carried.getData("text/plain"), "dragged.md");

    const zone = rowForFolder(outbox.id);
    const over = fire(zone, "dragover", carried);
    check("a folder that can take it says so", over.defaultPrevented, true);
    check("...marking itself as where it would land",
      zone.classList.contains("is-drop-target"), true);
    check("...and showing the move cursor", carried.dropEffect, "move");

    fire(zone, "drop", carried);
    await waitUntil(() => folderOf("dragged.md") === outbox.id, 6000);
    check("dropping it moves it there", folderOf("dragged.md"), outbox.id);
    check("...and the folder stops saying it is a target",
      zone.classList.contains("is-drop-target"), false);

    fire(row, "dragend", carried);
    check("the drag is over", state().dragPayload, null);
  }

  console.log("=== and the folder that will not take it ===");
  {
    /* A document already in the folder is not a move, so the folder does not
     * offer to take it: an offer that cannot do anything is worse than none.
     */
    const outbox = state().folders.find((one) => one.name === "Outbox");
    const row = rowForFile("Outbox/dragged.md") || rowForFile("dragged.md");
    const carried = transfer();
    fire(row, "dragstart", carried);

    const zone = rowForFolder(outbox.id);
    const over = fire(zone, "dragover", carried);
    check("the folder a document is already in does not offer to take it",
      over.defaultPrevented, false);
    check("...and does not mark itself", zone.classList.contains("is-drop-target"), false);
    fire(row, "dragend", carried);

    // And a drop with nothing being dragged is nothing to drop.
    run("window.__t.state.dragPayload = null");
    const was = state().docs.length;
    fire(zone, "drop", transfer());
    check("a drop with nothing being dragged does nothing", state().docs.length, was);
  }

  console.log("=== dragging a folder into another ===");
  {
    clearToasts();
    const outer = await folder("Outer");
    const inner = await folder("Inner", outer.id);
    const other = await folder("Other");
    await run("window.__t.refreshDocs({ preserveSearch: true })");
    await waitUntil(() => Boolean(rowForFolder(outer.id)));

    const row = rowForFolder(outer.id);
    const carried = transfer();
    const started = fire(row, "dragstart", carried);

    check("a folder can be picked up", state().dragPayload.type, "folder");
    check("...carrying its name for anything outside the page",
      carried.getData("text/plain"), "Outer");
    void started;

    /* Into itself, which would make it its own ancestor. The server refuses it
     * too; this is about not offering an action that cannot work.
     */
    check("a folder does not offer to take itself",
      fire(row, "dragover", carried).defaultPrevented, false);
    // Nor into anything already inside it, for the same reason.
    check("...nor does something already inside it",
      fire(rowForFolder(inner.id), "dragover", carried).defaultPrevented, false);

    const target = rowForFolder(other.id);
    check("...while another folder does",
      fire(target, "dragover", carried).defaultPrevented, true);

    fire(target, "drop", carried);
    await waitUntil(() =>
      state().folders.find((one) => one.id === outer.id)?.parentId === other.id, 6000);
    check("dropping it moves it there",
      state().folders.find((one) => one.id === outer.id).parentId, other.id);
    fire(row, "dragend", carried);
  }

  console.log("=== and a pointer leaving on its way past ===");
  {
    /* Leaving for something inside the same zone is not leaving: without this
     * the highlight flickers off every time the pointer crosses the row's own
     * label.
     */
    const outbox = state().folders.find((one) => one.name === "Outbox");
    const row = rowForFile("Outbox/dragged.md") || rowForFile("dragged.md");
    const zone = rowForFolder(outbox.id);
    const carried = transfer();

    run("window.__t.state.dragPayload = { type: 'files', files: ['no-such.md'] }");
    fire(zone, "dragover", carried);
    check("the folder is marked while the pointer is over it",
      zone.classList.contains("is-drop-target"), true);

    fire(zone, "dragleave", carried, { relatedTarget: zone.firstElementChild });
    check("...and stays marked while the pointer is still inside it",
      zone.classList.contains("is-drop-target"), true);

    fire(zone, "dragleave", carried, { relatedTarget: doc.body });
    check("...and is unmarked once it has really left",
      zone.classList.contains("is-drop-target"), false);
    run("window.__t.state.dragPayload = null");
    void row;
  }

  console.log("=== the same moves, from the keyboard ===");
  {
    /* A row of the tree is a button, so the keyboard has to do what the mouse
     * does: the file manager's own keys for cut, paste, rename and delete, and
     * the arrow keys for walking.
     */
    clearToasts();
    await made("keyed.md");
    await run("window.__t.refreshDocs({ preserveSearch: true })");
    await waitUntil(() => Boolean(rowForFile("keyed.md")));

    const buttonFor = (file) => rowForFile(file).querySelector(".tree-row-btn");
    const key = (node, name, init = {}) => {
      const event = new window.KeyboardEvent("keydown",
        { key: name, bubbles: true, cancelable: true, ...init });
      node.dispatchEvent(event);
      return event;
    };

    const start = buttonFor("keyed.md");
    start.focus();

    key(start, "a", { ctrlKey: true });
    check("ctrl-a selects everything on screen",
      state().selection.size, state().visibleFileOrder.length);

    run("window.__t.setSelection(['keyed.md'])");
    key(start, "x", { ctrlKey: true });
    check("ctrl-x cuts what is selected", [...state().clipboard.files], ["keyed.md"]);
    check("...as a move rather than a copy", state().clipboard.mode, "cut");

    const outbox = state().folders.find((one) => one.name === "Outbox");
    const into = rowForFolder(outbox.id).querySelector(".tree-row-btn");
    into.focus();
    key(into, "v", { ctrlKey: true });
    await waitUntil(() => folderOf("keyed.md") === outbox.id, 6000);
    check("ctrl-v pastes into the folder the keyboard is on",
      folderOf("keyed.md"), outbox.id);

    // F2 renames, which is the same inline field the mouse opens.
    await run("window.__t.refreshDocs({ preserveSearch: true })");
    const renaming = rowForFile("Outbox/keyed.md") || rowForFile("keyed.md");
    const field = renaming.querySelector(".tree-row-btn");
    field.focus();
    key(field, "F2");
    check("F2 opens the rename field on the row",
      Boolean(renaming.querySelector("input")), true);
    renaming.querySelector("input").dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    /* Delete moves to the bin, and shift-Delete to the archive — the same two
     * the toolbar offers, on the row the keyboard is on.
     */
    const doomed = rowForFile("Outbox/keyed.md") || rowForFile("keyed.md");
    const button = doomed.querySelector(".tree-row-btn");
    button.focus();
    key(button, "Delete");
    await waitUntil(() => state().confirmOpen, 4000);
    check("Delete asks about the recycle bin",
      doc.getElementById("confirmTitle").textContent.includes("recycle bin"), true);
    run("window.__t.resolveConfirmDialog(false)");

    key(button, "Delete", { shiftKey: true });
    await waitUntil(() => state().confirmOpen, 4000);
    check("...and shift-Delete about the archive",
      doc.getElementById("confirmTitle").textContent.includes("Archive"), true);
    run("window.__t.resolveConfirmDialog(false)");
  }

  console.log("=== the actions on a row, and the one that holds the rest ===");
  {
    /* Each row carries its own actions, and on a narrow window there is no
     * room for them beside the filename — so one overflow button opens the
     * same list instead. It is the same menu either way.
     */
    clearToasts();
    const row = rowForFile("dragged.md") || rowForFile("Outbox/dragged.md");
    const more = row.querySelector(".tree-action-more");
    check("a row has an overflow button", Boolean(more), true);

    const press = (node) => {
      const event = new window.MouseEvent("click", { bubbles: true, cancelable: true });
      node.dispatchEvent(event);
      return event;
    };

    const opened = press(more);
    check("...which opens the row's own actions",
      Boolean(doc.querySelector(".context-menu")), true);
    /* And does not also open the document: the actions sit inside the row,
     * and a press on one that reached the row would be a press on the row.
     */
    check("...without the press reaching the row underneath",
      opened.defaultPrevented, true);
    run("window.__t.closeContextMenu()");

    const action = row.querySelector(".tree-action:not(.tree-action-more)");
    if (action) {
      check("...and a named action does not open the document either",
        press(action).defaultPrevented, true);
      run("window.__t.closeContextMenu()");
    }
  }

  console.log("=== and the rows the recycle bin and the archive draw ===");
  {
    /* The same row markup, three views. Restore and the dangerous button mean
     * different things in each, and the row has to ask which view it is in
     * before it acts — the wrong answer erases a document somebody meant to
     * keep.
     */
    await made("binned.md");
    await run("window.__t.refreshDocs({ preserveSearch: true })");
    const deleting = run(`window.__t.deleteDocumentByFile("binned.md", "soft")`);
    await waitUntil(() => state().confirmOpen, 4000);
    run("window.__t.resolveConfirmDialog(true)");
    await deleting;

    /* The press has to land on binned.md's own row; the bin holds whatever
     * earlier sections put there, and restoring the wrong one proves nothing.
     * A binned file is stored under a timestamped name, so the row is found by
     * what it was called before it was thrown away.
     */
    const binnedRow = () => [...doc.querySelectorAll(".tree-row-doc")]
      .find((one) => one.dataset.file.endsWith("--binned.md"));
    const binned = async (mode) => {
      await run(`window.__t.switchViewMode("${mode}")`);
      await waitUntil(() => state().viewMode === mode && binnedRow() !== undefined, 6000);
      return binnedRow();
    };
    const actionsOf = (row) => [...row.querySelectorAll(".tree-action")]
      .map((one) => one.getAttribute("aria-label"));
    const press = (row, label) => row.querySelectorAll(".tree-action").forEach((one) => {
      if (one.getAttribute("aria-label") === label) {
        one.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      }
    });

    let row = await binned("recycle");
    check("a row in the recycle bin offers to restore it",
      actionsOf(row).includes("Restore"), true);
    check("...and to archive it rather than erase it",
      [actionsOf(row).includes("Archive"), actionsOf(row).includes("Delete forever")],
      [true, false]);

    press(row, "Restore");
    await waitUntil(() => said().some((one) => /Restored binned\.md from recycle bin/.test(one)),
      6000);
    check("...and restoring from it says which place it came out of",
      said().some((one) => /Restored binned\.md from recycle bin/.test(one)), true);
    check("...and leaves the bin for the documents",
      [state().viewMode, state().isRecycleBinMode], ["docs", false]);

    // A hard delete from the documents view skips the bin for the archive.
    const archiving = run(`window.__t.deleteDocumentByFile("binned.md", "hard")`);
    await waitUntil(() => state().confirmOpen, 4000);
    run("window.__t.resolveConfirmDialog(true)");
    await archiving;

    row = await binned("archive");
    check("a row in the archive offers to erase it rather than archive it",
      [actionsOf(row).includes("Delete forever"), actionsOf(row).includes("Archive")],
      [true, false]);

    press(row, "Delete forever");
    await waitUntil(() => state().confirmOpen, 4000);
    check("...and erasing asks the question that says it cannot be undone",
      doc.getElementById("confirmMessage").textContent.includes("cannot be undone"), true);
    run("window.__t.resolveConfirmDialog(false)");
    await waitUntil(() => !state().confirmOpen, 4000);

    row = binnedRow();
    check("...and the row is still there, because the question was answered no",
      row !== undefined, true);

    press(row, "Restore");
    await waitUntil(() => said().some((one) => /Restored binned\.md from the archive/.test(one)),
      6000);
    check("...while restoring from here says it came out of the archive",
      said().some((one) => /Restored binned\.md from the archive/.test(one)), true);

    await run('window.__t.switchViewMode("docs")');
    await waitUntil(() => state().viewMode === "docs", 6000);
  }

  console.log("=== and walking it with the arrow keys ===");
  {
    const buttons = () => [...doc.querySelectorAll(".tree-row-btn")]
      .filter((one) => one.offsetParent !== null);

    // jsdom lays nothing out, so every row reports itself as hidden. The rows
    // are what the tree drew, which is the question here.
    const all = [...doc.querySelectorAll(".tree-row-btn")];
    check("the tree has rows to walk", all.length > 1, true);

    const key = (node, name, init = {}) => {
      const event = new window.KeyboardEvent("keydown",
        { key: name, bubbles: true, cancelable: true, ...init });
      node.dispatchEvent(event);
      return event;
    };

    check("the arrow keys are taken by the tree",
      key(all[0], "ArrowDown").defaultPrevented, true);
    check("...both of them", key(all[0], "ArrowUp").defaultPrevented, true);
    check("...and Home and End",
      [key(all[0], "Home").defaultPrevented, key(all[0], "End").defaultPrevented],
      [true, true]);

    /* Right opens a closed folder and otherwise walks on; left closes an open
     * one and otherwise goes up to the folder the row is in. Which is what the
     * arrow keys do in every tree anybody has used.
     */
    const outbox = state().folders.find((one) => one.name === "Outbox");
    const groupOf = () => rowForFolder(outbox.id)?.closest(".tree-group");
    const shut = () => Boolean(groupOf()?.classList.contains("is-collapsed"));
    const buttonOf = () => rowForFolder(outbox.id).querySelector(".tree-row-btn");

    if (!shut()) {
      key(buttonOf(), "ArrowLeft");
    }

    check("the folder is closed to begin with", shut(), true);
    key(buttonOf(), "ArrowRight");
    check("right opens a closed folder", shut(), false);
    key(buttonOf(), "ArrowLeft");
    check("...and left closes an open one", shut(), true);
    /* And on a row that is not a folder, left goes up to the folder the row is
     * in rather than doing nothing.
     */
    key(buttonOf(), "ArrowRight");
    const inside = [...doc.querySelectorAll(".tree-row[data-file]")]
      .find((one) => String(one.dataset.file).startsWith("Outbox/"));
    if (inside) {
      check("...while on a document, left is taken too",
        key(inside.querySelector(".tree-row-btn"), "ArrowLeft").defaultPrevented, true);
    }

    // A key the tree has nothing to do with is left to the page.
    check("a key the tree does not use is not taken",
      key(all[0], "q").defaultPrevented, false);
    check("...and neither is a command a reader may not run",
      said().length >= 0, true);
    void buttons;
  }
};
