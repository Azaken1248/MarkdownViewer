// Part of the DOM suite. See dom.test.js, which sets all this up and calls it.
//
// The tree the app comes up showing, and everything done to it with a pointer.
//
// Everything it needs is handed to it: the suite's own check(), the window the
// app is running in, and the handles the setup built. Split out of one file
// only because that file had grown past a thousand lines.
module.exports = async (ctx) => {
  const {
    check, server, window, doc, waitUntil
  } = ctx;

  console.log("=== startup is quiet ===");
  check("loading the app raises no toast on its own", doc.querySelectorAll(".toast").length, 0);

  console.log("=== the tree renders from the seeded corpus ===");
  const groups = doc.querySelectorAll(".tree-group");
  const rows = doc.querySelectorAll(".tree-row-doc");
  console.log(`  (${groups.length} folder groups, ${rows.length} file rows)`);
  check("folder groups rendered", groups.length > 0, true);
  check("file rows rendered", rows.length > 0, true);
  check("every file row carries its filename", [...rows].every((r) => r.dataset.file), true);
  check("every file row has exactly one label", [...rows].every((r) => r.querySelectorAll(".tree-label").length === 1), true);
  check("every file row has hover actions", [...rows].every((r) => r.querySelector(".tree-actions")), true);
  check("file rows are draggable", [...rows].every((r) => r.getAttribute("draggable") === "true"), true);
  check("folder rows carry a caret", [...groups].every((g) => g.querySelector(".tree-caret")), true);
  check("folder rows show a count", [...groups].every((g) => /^\d+$/.test(g.querySelector(".tree-count").textContent)), true);
  check("no fat card markup survives", doc.querySelectorAll(".doc-item, .tag-chip, .doc-row").length, 0);

  console.log("=== icons are all Phosphor ===");
  const icons = [...doc.querySelectorAll("i")];
  const bad = icons.filter((i) => !i.className.split(/\s+/).some((c) => /^ph-/.test(c)));
  check(`every <i> names a ph-* glyph (${icons.length} icons)`, bad.map((i) => i.className), []);
  check("no Font Awesome left in the DOM", doc.body.innerHTML.includes("fa-"), false);

  console.log("=== tree interactions ===");
  const emptyMarkers = doc.querySelectorAll(".tree-children .tree-empty");
  console.log(`  (${emptyMarkers.length} folders rendered as empty)`);
  check("empty folders are visible rather than silently dropped", emptyMarkers.length > 0, true);

  const moreBtn = doc.querySelector(".tree-more");
  const pagingExpected = doc.querySelectorAll(".tree-row-doc").length >= 50;
  if (pagingExpected) {
    check("a paged folder offers 'show more'", Boolean(moreBtn), true);
  } else {
    console.log("  SKIP  paging (corpus smaller than one page)");
  }
  if (moreBtn && pagingExpected) {
    const before = doc.querySelectorAll(".tree-row-doc").length;
    moreBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const after = doc.querySelectorAll(".tree-row-doc").length;
    check("clicking it reveals another page", after > before, true);
  }

  // A first visit opens on a closed tree: every folder expanded at once is a
  // wall of files with no structure visible.
  const groupsAll = [...doc.querySelectorAll(".tree-group")];
  check("every folder starts collapsed on a first visit",
    groupsAll.every((g) => g.classList.contains("is-collapsed")), true);
  check("...and that is recorded so a reload does not throw them open again",
    JSON.parse(window.localStorage.getItem("mdviewer.collapsedFolders")).length, groupsAll.length);

  const firstGroup = doc.querySelector(".tree-group");
  const firstFolderBtn = firstGroup.querySelector(".tree-row-folder .tree-row-btn");
  check("aria-expanded says so", firstFolderBtn.getAttribute("aria-expanded"), "false");

  firstFolderBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const expandedGroup = doc.querySelector(".tree-group");
  check("clicking the folder expands it", expandedGroup.classList.contains("is-collapsed"), false);
  check("aria-expanded follows", expandedGroup.querySelector(".tree-row-folder .tree-row-btn").getAttribute("aria-expanded"), "true");
  check("the open folder is dropped from the stored set",
    JSON.parse(window.localStorage.getItem("mdviewer.collapsedFolders")).includes(expandedGroup.dataset.folderKey), false);

  expandedGroup.querySelector(".tree-row-folder .tree-row-btn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  check("clicking again collapses it", doc.querySelector(".tree-group").classList.contains("is-collapsed"), true);

  /* The arrow keys open and close a folder too, and the focus survives it.
   *
   * Opening one rebuilds the whole list, which throws away the button the key
   * arrived at. With a mouse nobody notices. With a keyboard the focus falls
   * to the body and every arrow key after it does nothing — the tree stops
   * answering, having just answered, which is the worst kind of broken.
   */
  {
    const press = (node, key) =>
      node.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true }));
    const rowBtn = () => doc.querySelector(".tree-group .tree-row-folder .tree-row-btn");
    const focused = () => doc.activeElement?.classList?.contains("tree-row-btn");

    rowBtn().focus();
    press(doc.activeElement, "ArrowRight");
    check("the right arrow opens a folder",
      doc.querySelector(".tree-group").classList.contains("is-collapsed"), false);
    check("...and leaves the focus on a row, so the next key still lands", focused(), true);

    press(doc.activeElement, "ArrowLeft");
    check("the left arrow closes it again",
      doc.querySelector(".tree-group").classList.contains("is-collapsed"), true);
    check("...and the focus is still somewhere a key can arrive", focused(), true);
  }

  console.log("=== expand-all / collapse-all ===");
  const collapseAll = doc.getElementById("collapseAllBtn");
  collapseAll.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  check("from a collapsed tree the button expands everything",
    [...doc.querySelectorAll(".tree-group")].every((g) => !g.classList.contains("is-collapsed")), true);
  collapseAll.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  check("and collapses everything again",
    [...doc.querySelectorAll(".tree-group")].every((g) => g.classList.contains("is-collapsed")), true);

  // The Explorer checks below need to see rows, so open the tree back up.
  collapseAll.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  // Explorer behaviour, against the seeded hierarchy.
  {
    const click = (node, init = {}) => node.dispatchEvent(new window.MouseEvent("click", { bubbles: true, ...init }));
    // A document is identified by its path now; the fixture reports where it
    // actually wrote each one, so the tests do not hardcode the tree.
    const D = (name) => server.docPaths[name] || name;
    const rowFor = (file) => doc.querySelector(`.tree-row-doc[data-file="${file}"]`);
    const btnFor = (file) => rowFor(file)?.querySelector(".tree-row-btn");

    console.log("=== nesting renders at depth ===");
    const folderRows = [...doc.querySelectorAll(".tree-row-folder")];
    const depths = folderRows
      .map((r) => Number(r.querySelector(".tree-row-btn").style.getPropertyValue("--depth")))
      .filter((n) => !Number.isNaN(n));
    console.log(`  (folder depths present: ${[...new Set(depths)].sort().join(", ")})`);
    check("more than one nesting level is drawn", new Set(depths).size > 1, true);
    check("a depth-2 folder exists", depths.includes(2), true);

    const cart = folderRows.find((r) => r.querySelector(".tree-label").textContent === "Cart");
    check("nested folder is inside its parent's child list", Boolean(cart?.closest(".tree-children")), true);
    check("nested folder title shows the full path", cart.querySelector(".tree-row-btn").title, "Projects / Cart");
    // A folder's badge counts everything beneath it, not just its own files.
    const cartGroup = cart.closest(".tree-group");
    const parentGroup = cartGroup.parentElement.closest(".tree-group");
    const parentId = parentGroup.dataset.folderKey;
    const expectedDeep = window.eval(`window.__t.state.docs.filter(d =>
      d.folderId && window.__t.folderPathIds(d.folderId).includes(${JSON.stringify(parentId)})).length`);
    check("parent count includes descendants",
      parentGroup.querySelector(".tree-count").textContent, String(expectedDeep));

    console.log("=== multi-select ===");
    click(btnFor(D("delta.md")));
    check("plain click selects one", [...window.eval("window.__t.state.selection")], [D("delta.md")]);

    click(btnFor(D("epsilon.md")), { ctrlKey: true });
    check("ctrl+click adds", [...window.eval("window.__t.state.selection")].sort(), [D("delta.md"), D("epsilon.md")].sort());

    click(btnFor(D("epsilon.md")), { ctrlKey: true });
    check("ctrl+click again removes", [...window.eval("window.__t.state.selection")], [D("delta.md")]);

    window.eval(`window.__t.setSelection([${JSON.stringify(D("delta.md"))}], { anchor: ${JSON.stringify(D("delta.md"))} })`);
    click(btnFor(D("epsilon.md")), { shiftKey: true });
    const range = [...window.eval("window.__t.state.selection")];
    check("shift+click selects a range", range.length >= 2, true);
    check("range includes both ends", range.includes(D("delta.md")) && range.includes(D("epsilon.md")), true);

    window.eval("window.__t.setSelection(window.__t.state.visibleFileOrder)");
    check("select-all covers every visible file", window.eval("window.__t.state.selection.size") === window.eval("window.__t.state.visibleFileOrder.length"), true);
    check("selected rows are marked", doc.querySelectorAll(".tree-row-doc.is-selected").length > 0, true);
    check("the count is surfaced", doc.getElementById("selectionMeta").hidden, false);

    window.eval("window.__t.clearSelection()");
    check("clearing empties the selection", window.eval("window.__t.state.selection.size"), 0);
    check("and unmarks the rows", doc.querySelectorAll(".tree-row-doc.is-selected").length, 0);

    console.log("=== cut marks files in flight ===");
    window.eval(`window.__t.setSelection([${JSON.stringify(D("delta.md"))},${JSON.stringify(D("epsilon.md"))}])`);
    window.eval("window.__t.cutFiles([...window.__t.state.selection])");
    check("clipboard holds both", window.eval("window.__t.state.clipboard.files.length"), 2);
    check("mode is cut", window.eval("window.__t.state.clipboard.mode"), "cut");
    check("rows show as cut", doc.querySelectorAll(".tree-row-doc.is-cut").length, 2);

    console.log("=== paste actually moves them ===");
    const notesId = window.eval('window.__t.state.folders.find(f => f.name === "Notes").id');
    await window.eval(`window.__t.pasteIntoFolder(${JSON.stringify(notesId)})`);
    await new Promise((r) => setTimeout(r, 600));
    const movedInto = window.eval(`window.__t.state.docs.filter(d => d.folderId === ${JSON.stringify(notesId)}).map(d => d.file).sort()`);
    check("both files landed in the target folder", [...movedInto].map((f) => f.split("/").pop()).sort(), ["delta.md", "epsilon.md"]);
    check("clipboard is emptied after paste", window.eval("window.__t.state.clipboard.files.length"), 0);

    console.log("=== context menu ===");
    rowFor(D("alpha.md")).dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, clientX: 40, clientY: 40 }));
    const menu = doc.getElementById("contextMenu");
    check("menu opens on right-click", menu.hidden, false);
    const labels = [...menu.querySelectorAll(".context-item span")].map((s) => s.textContent);
    check("it offers the file operations", ["Open", "Cut", "Rename"].every((l) => labels.includes(l)), true);
    check("right-clicking a row selects it", [...window.eval("window.__t.state.selection")], [D("alpha.md")]);
    window.eval("window.__t.closeContextMenu()");
    check("menu closes", menu.hidden, true);

    const cartFolderRow = [...doc.querySelectorAll(".tree-row-folder")]
      .find((r) => r.querySelector(".tree-label").textContent === "Cart");
    cartFolderRow.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, clientX: 40, clientY: 40 }));
    const folderLabels = [...menu.querySelectorAll(".context-item span")].map((s) => s.textContent);
    check("folders offer a subfolder action", folderLabels.includes("New subfolder"), true);
    check("folders offer delete", folderLabels.some((l) => l.startsWith("Delete folder")), true);
    window.eval("window.__t.closeContextMenu()");

    console.log("=== F2 inline rename ===");
    window.eval(`window.__t.beginInlineRename(${JSON.stringify(D("alpha.md"))})`);
    const input = rowFor(D("alpha.md"))?.querySelector(".tree-rename-input");
    check("an input replaces the label", Boolean(input), true);
    // Seeded with the name, not the path: renaming does not move anything.
    check("it is seeded with the filename", input.value, "alpha.md");
    check("the extension is left out of the preselection", input.selectionEnd, "alpha".length);
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await new Promise((r) => setTimeout(r, 100));
    check("escape restores the row", Boolean(rowFor(D("alpha.md"))?.querySelector(".tree-rename-input")), false);

    // And now one that actually goes through. This block only ever opened the
    // box and pressed Escape, so it never noticed that the request sent `name`
    // where the endpoint reads `fileName` — every rename typed into the tree
    // came back "Invalid document file name", and had since the tree was built.
    window.eval(`window.__t.beginInlineRename(${JSON.stringify(D("alpha.md"))})`);
    const committing = rowFor(D("alpha.md")).querySelector(".tree-rename-input");
    committing.value = "alpha-inline.md";
    committing.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));

    const renamedPath = `${D("alpha.md").slice(0, D("alpha.md").lastIndexOf("/") + 1)}alpha-inline.md`;
    check("the rename actually lands", Boolean(rowFor(renamedPath)), true);
    check("...and the old row is gone", Boolean(rowFor(D("alpha.md"))), false);
    check("...and it stayed in its folder",
      window.eval(`window.__t.state.docs.some(d => d.file === ${JSON.stringify(renamedPath)})`), true);

    // Put it back, so everything after this still finds alpha.md.
    window.eval(`window.__t.beginInlineRename(${JSON.stringify(renamedPath)})`);
    const restoring = rowFor(renamedPath).querySelector(".tree-rename-input");
    restoring.value = "alpha.md";
    restoring.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    check("(restored for the checks below)", Boolean(rowFor(D("alpha.md"))), true);

    /* Renaming in place, and the four ways it comes to nothing.
     *
     * The block above renames a document and watches it land, which was all
     * of app/inline-rename.js anything reached. The rest of the module is a
     * folder renamed the same way, a second F2 on a box already open, the two
     * rows that are not there, and a name the server refuses — most of the
     * file, and all of it the part a person meets by making a mistake.
     */
    console.log("=== F2 on a box that is already open ===");
    {
      const said = () => [...doc.querySelectorAll("#toastStack .toast, #toastStackUrgent .toast")]
        .map((one) => one.querySelector(".toast-message")?.textContent || "");
      // What was said since, rather than how many are on screen: a toast from
      // earlier work expires on its own, and a count would call that a change.
      const saidSince = (before) => said().filter((one) => !before.includes(one));
      const boxIn = (file) => rowFor(file)?.querySelector(".tree-rename-input");

      window.eval(`window.__t.beginInlineRename(${JSON.stringify(D("alpha.md"))})`);
      const open = boxIn(D("alpha.md"));
      open.value = "half-typed.md";

      /* A second F2 while one box is open must not replace it: the first
       * thing it does is empty the label, so a second pass throws away
       * whatever had been typed and reseeds the box with the old name.
       */
      window.eval(`window.__t.beginInlineRename(${JSON.stringify(D("alpha.md"))})`);
      check("a second F2 leaves the box that is open alone", boxIn(D("alpha.md")), open);
      check("...and what had been typed into it", boxIn(D("alpha.md")).value, "half-typed.md");

      /* Escape settles the edit, and the blur that follows it — the box
       * leaving the document is a blur — must not then commit what Escape
       * just refused. The listener answers both, so only the flag stops it.
       */
      const beforeEscape = said();
      open.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await waitUntil(() => !boxIn(D("alpha.md")), 6000);
      open.dispatchEvent(new window.Event("blur", { bubbles: false }));
      await new Promise((r) => setTimeout(r, 300));
      check("the blur after Escape commits nothing", Boolean(rowFor(D("alpha.md"))), true);
      check("...and says nothing either", saidSince(beforeEscape), []);

      // Caught rather than thrown: without the guard this is a TypeError
      // inside a click handler, and a check that dies on it takes the rest
      // of the file with it instead of saying which guard went missing.
      /* The two ways a commit means "never mind". Both close the box quietly
       * rather than sending anything: the endpoint answers an unchanged name
       * with a 200 and an empty one with a 400, so either would put a toast
       * on screen — one that lies about having renamed something, or one
       * that reports a failure the person did not ask for.
       */
      {
        /* On a document this file has not renamed, because a toast replaces
         * one that says the same thing: "Renamed to alpha.md." is already on
         * screen from the restore above, so a second one would be invisible
         * here and the check would pass on a module that had sent the
         * request anyway.
         */
        const quiet = D("beta.md");
        const before = said();
        window.eval(`window.__t.beginInlineRename(${JSON.stringify(quiet)})`);
        boxIn(quiet).dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        await new Promise((r) => setTimeout(r, 400));
        check("a name that was not changed is not sent anywhere", saidSince(before), []);
        check("...and the row is just itself again",
          [Boolean(rowFor(quiet)), Boolean(boxIn(quiet))], [true, false]);

        window.eval(`window.__t.beginInlineRename(${JSON.stringify(quiet)})`);
        const emptied = boxIn(quiet);
        emptied.value = "   ";
        emptied.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        await new Promise((r) => setTimeout(r, 400));
        check("an emptied box is not sent either", saidSince(before), []);
        check("...and the document still has the name it had",
          [Boolean(rowFor(quiet)), Boolean(boxIn(quiet))], [true, false]);
      }

      check("a label that is not there is not edited",
        window.eval(`(() => {
          try {
            window.__t.beginInlineEdit(null, "x", () => {});
            return "no throw";
          } catch (error) {
            return error.message;
          }
        })()`),
        "no throw");

      /* A key pressed in the box is the box's. The tree's own shortcuts are
       * listening on the same path — Delete sends documents to the bin, and
       * the box sits inside the row it would delete. Two guards stand there:
       * the box stops the key propagating, and the tree's handler returns at
       * once for an event from a rename input. Either alone is enough, which
       * is why removing one does not fail this check; what it checks is that
       * the document survives the keystroke.
       */
      window.eval(`window.__t.beginInlineRename(${JSON.stringify(D("alpha.md"))})`);
      const typing = boxIn(D("alpha.md"));
      typing.value = "alpha-typed";
      typing.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      check("Delete pressed while renaming does not delete the document",
        Boolean(rowFor(D("alpha.md"))), true);
      check("...and the box is still open, with what was typed in it",
        boxIn(D("alpha.md"))?.value, "alpha-typed");
      typing.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await waitUntil(() => !boxIn(D("alpha.md")), 6000);
    }

    console.log("=== and on rows that are not there ===");
    {
      // Both lookups walk the rendered rows and can come back empty: the
      // menu that offers Rename is built from a list that may have been
      // refetched since, and F2 arrives at whatever has the focus.
      check("a document that is not in the tree has no row",
        window.eval('window.__t.findDocRow("no-such-file.md")'), null);
      check("...and a folder that is not in the tree has none either",
        window.eval('window.__t.findFolderRow("no-such-folder")'), null);

      window.eval('window.__t.beginInlineRename("no-such-file.md")');
      window.eval('window.__t.beginInlineFolderRename("no-such-folder")');
      check("renaming either opens no box anywhere",
        doc.querySelectorAll(".tree-rename-input").length, 0);
    }

    console.log("=== a document rename the library refuses ===");
    {
      const said = () => [...doc.querySelectorAll("#toastStackUrgent .toast")]
        .map((one) => one.querySelector(".toast-message")?.textContent || "");

      window.eval(`window.__t.beginInlineRename(${JSON.stringify(D("alpha.md"))})`);
      const box = rowFor(D("alpha.md")).querySelector(".tree-rename-input");
      // A colon is refused by the path sanitiser, so this is the server's
      // answer rather than a stand-in's: see test/paths.test.js.
      box.value = "alpha:md";
      box.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

      await waitUntil(() => said().some((one) => one.includes("file name")), 8000);
      check("the refusal is said in the words the server used",
        said().some((one) => one === "Invalid document file name"), true);
      check("...and the row is drawn again under the name it still has",
        Boolean(rowFor(D("alpha.md"))), true);
      check("...with no box left open on it",
        Boolean(rowFor(D("alpha.md")).querySelector(".tree-rename-input")), false);
    }

    console.log("=== renaming the document that is open ===");
    {
      // The one case that has to follow the rename: the viewer is showing
      // this file, so the refetch has to be told to open it under its new
      // name or the page is left on a document that no longer exists.
      await window.eval(`window.__t.openDocument(${JSON.stringify(D("alpha.md"))}, true, { forceReload: true })`);
      await waitUntil(() => window.eval("window.__t.state.activeFile") === D("alpha.md"), 8000);

      window.eval(`window.__t.beginInlineRename(${JSON.stringify(D("alpha.md"))})`);
      const box = rowFor(D("alpha.md")).querySelector(".tree-rename-input");
      box.value = "alpha-open.md";
      box.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

      const renamed = `${D("alpha.md").slice(0, D("alpha.md").lastIndexOf("/") + 1)}alpha-open.md`;
      await waitUntil(() => window.eval("window.__t.state.activeFile") === renamed, 8000);
      check("the open document is still the open document afterwards",
        window.eval("window.__t.state.activeFile"), renamed);
      check("...and the trail over the page is showing its new name",
        doc.querySelector("#breadcrumbs .crumb-current").textContent.trim(), "alpha-open.md");

      // Back, so everything after this still finds alpha.md.
      window.eval(`window.__t.beginInlineRename(${JSON.stringify(renamed)})`);
      const back = rowFor(renamed).querySelector(".tree-rename-input");
      back.value = "alpha.md";
      back.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await waitUntil(() => Boolean(rowFor(D("alpha.md"))), 8000);
      check("(restored for the checks below)", Boolean(rowFor(D("alpha.md"))), true);
    }

    console.log("=== and a folder renamed the same way ===");
    {
      const said = () => [...doc.querySelectorAll("#toastStack .toast, #toastStackUrgent .toast")]
        .map((one) => one.querySelector(".toast-message")?.textContent || "");
      const folderRowFor = (id) => doc.querySelector(`.tree-row-folder[data-folder-id="${id}"]`);

      /* A folder of its own, made for this, because a folder's name is its
       * directory: renaming one of the seeded folders would move the
       * documents inside it, and the checks after this one still use their
       * paths. It is made through the app's own call and taken away again at
       * the end, so the corpus is the same afterwards.
       */
      const spare = { name: "Spare for F2" };
      spare.id = await window.eval(`(async () => {
        const made = await window.__t.createFolderOnServer("Spare for F2");
        await window.__t.refreshDocs({ preserveSearch: true });
        return made.folder ? made.folder.id : made.id;
      })()`);
      check("(a folder was made to rename)", typeof spare.id, "string");

      // Through the keyboard rather than the call, so the one shortcut that
      // reaches a folder is pressed at least once.
      const row = folderRowFor(spare.id);
      row.querySelector(".tree-row-btn").focus();
      doc.activeElement.dispatchEvent(new window.KeyboardEvent("keydown", { key: "F2", bubbles: true }));

      const box = () => folderRowFor(spare.id)?.querySelector(".tree-rename-input");
      check("F2 on a folder row opens a box too", Boolean(box()), true);
      check("...seeded with the folder's name", box().value, spare.name);
      // A folder name has no extension, so the whole of it is preselected —
      // the stem rule only holds back a dot that a filename has.
      check("...with all of it selected, there being no extension to keep",
        box().selectionEnd, spare.name.length);

      box().value = "Renamed by F2";
      box().dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await waitUntil(() => said().includes("Renamed folder to Renamed by F2."), 8000);
      check("the folder is renamed, and says so",
        window.eval(`window.__t.getFolderRecord(${JSON.stringify(spare.id)}).name`), "Renamed by F2");
      check("...and the tree is showing the new name",
        folderRowFor(spare.id).querySelector(".tree-label").textContent, "Renamed by F2");

      // And the refusal, which is the same shape as the document's.
      window.eval(`window.__t.beginInlineFolderRename(${JSON.stringify(spare.id)})`);
      const refused = folderRowFor(spare.id).querySelector(".tree-rename-input");
      refused.value = "con";
      refused.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await waitUntil(() => said().includes("Invalid folder name"), 8000);
      check("a folder name the library refuses is said in its words",
        said().includes("Invalid folder name"), true);
      check("...and the folder is still called what it was",
        window.eval(`window.__t.getFolderRecord(${JSON.stringify(spare.id)}).name`), "Renamed by F2");

      // Back to the name the corpus gave it.
      window.eval(`window.__t.beginInlineFolderRename(${JSON.stringify(spare.id)})`);
      const putBack = folderRowFor(spare.id).querySelector(".tree-rename-input");
      putBack.value = spare.name;
      // Through the blur this time: clicking away from the box accepts what
      // is in it, the same as Enter, because the alternative is losing what
      // was typed to a click somewhere else on the page.
      putBack.dispatchEvent(new window.Event("blur", { bubbles: false }));
      await waitUntil(() =>
        window.eval(`window.__t.getFolderRecord(${JSON.stringify(spare.id)}).name`) === spare.name, 8000);
      check("(restored for the checks below)",
        window.eval(`window.__t.getFolderRecord(${JSON.stringify(spare.id)}).name`), spare.name);

      /* And away again, so the tree the checks below read is the seeded one.
       *
       * The record check in beginInlineFolderRename is not driven here. It
       * guards a row drawn from a list the folder has since left — a tree
       * somebody else changed — and reaching it means faking that stale
       * state, which would be a check about the inside of the module rather
       * than about anything a person can do. The row check above it already
       * makes a folder that is not there do nothing.
       */
      await window.eval(`(async () => {
        await window.__t.requestJson("/api/folders/" + encodeURIComponent(${JSON.stringify(spare.id)}),
          { method: "DELETE" });
        await window.__t.refreshDocs({ preserveSearch: true });
      })()`);
      check("(and taken away again)",
        [window.eval(`Boolean(window.__t.getFolderRecord(${JSON.stringify(spare.id)}))`),
          Boolean(folderRowFor(spare.id))],
        [false, false]);
    }

    console.log("=== breadcrumbs ===");
    const nav = doc.getElementById("breadcrumbs");
    check("the breadcrumb nav exists", Boolean(nav), true);
    check("it is labelled for assistive tech", nav.getAttribute("aria-label"), "Location of the open file");

    await window.eval(`window.__t.openDocument(${JSON.stringify(D("alpha.md"))}, false)`);
    await new Promise((r) => setTimeout(r, 500));

    const crumbText = [...nav.querySelectorAll(".crumb")].map((c) => c.textContent.trim() || "…");
    console.log(`  (trail: ${crumbText.join(" > ")})`);
    check("the trail starts at the scope root", crumbText[0], "Files");
    check("the open file is the last crumb", crumbText[crumbText.length - 1], "alpha.md");
    check("the file is marked as current", nav.querySelector(".crumb-current").getAttribute("aria-current"), "page");
    check("the file crumb is not a button", nav.querySelector(".crumb-current").tagName, "SPAN");
    check("ancestors are buttons", [...nav.querySelectorAll("button.crumb")].length > 1, true);
    check("separators sit between crumbs", nav.querySelectorAll(".crumb-sep").length, crumbText.length - 1);

    console.log("=== deep paths collapse rather than pushing the file out ===");
    check("a 6-deep path does not render 8 crumbs", crumbText.length <= 5, true);
    const overflow = nav.querySelector(".crumb-overflow");
    check("middle ancestors fold into an overflow control", Boolean(overflow), true);
    check("the nearest folder stays visible", crumbText.includes("Tokens"), true);
    overflow.dispatchEvent(new window.MouseEvent("click", { bubbles: true, clientX: 20, clientY: 20 }));
    const menuLabels = [...doc.querySelectorAll("#contextMenu .context-item span")].map((s2) => s2.textContent);
    console.log(`  (folded away: ${menuLabels.join(", ")})`);
    check("the folded folders are reachable from it", menuLabels.length > 0, true);
    check("they are the ones missing from the trail", menuLabels.every((l) => !crumbText.includes(l)), true);
    window.eval("window.__t.closeContextMenu()");

    console.log("=== a crumb leads back into the tree ===");
    const tokensId = window.eval('window.__t.state.folders.find(f => f.name === "Tokens").id');
    window.eval(`window.__t.state.collapsedFolderIds.add(${JSON.stringify(tokensId)})`);
    const parents = window.eval(`JSON.stringify(window.__t.folderPathIds(${JSON.stringify(tokensId)}))`);
    JSON.parse(parents).forEach((pid) => window.eval(`window.__t.state.collapsedFolderIds.add(${JSON.stringify(pid)})`));
    window.eval(`window.__t.revealFolderInTree(${JSON.stringify(tokensId)})`);
    check("clicking it expands the whole ancestor chain",
      JSON.parse(parents).every((pid) => !window.eval(`window.__t.state.collapsedFolderIds.has(${JSON.stringify(pid)})`)), true);
    check("and the folder row is rendered", Boolean([...doc.querySelectorAll(".tree-row-folder")].find((r) => r.dataset.folderId === tokensId)), true);

    console.log("=== a top-level file gets a two-crumb trail ===");
    await window.eval(`window.__t.openDocument(${JSON.stringify(D("beta.md"))}, false)`);
    await new Promise((r) => setTimeout(r, 400));
    const shortTrail = [...nav.querySelectorAll(".crumb")].map((c) => c.textContent.trim());
    console.log(`  (trail: ${shortTrail.join(" > ")})`);
    check("root then file, no folder in between", shortTrail, ["Files", "beta.md"]);

    console.log("=== drag guards ===");
    const projectsId = window.eval('window.__t.state.folders.find(f => f.name === "Projects").id');
    const cartId = window.eval('window.__t.state.folders.find(f => f.name === "Cart").id');
    window.eval(`window.__t.state.dragPayload = { type: "folder", folderId: ${JSON.stringify(projectsId)} }`);
    check("a folder cannot be dropped into its own child", window.eval(`window.__t.canDropOnFolder(${JSON.stringify(cartId)})`), false);
    check("a folder cannot be dropped onto itself", window.eval(`window.__t.canDropOnFolder(${JSON.stringify(projectsId)})`), false);
    check("a top-level folder is not offered a top-level drop", window.eval("window.__t.canDropOnFolder(null)"), false);
    window.eval(`window.__t.state.dragPayload = { type: "folder", folderId: ${JSON.stringify(cartId)} }`);
    check("a nested folder can be dropped at the top level", window.eval("window.__t.canDropOnFolder(null)"), true);
    window.eval(`window.__t.state.dragPayload = { type: "files", files: [${JSON.stringify(D("alpha.md"))}] }`);
    // Ask the model where the file actually is rather than assuming a fixture.
    const alphaFolder = window.eval(`window.__t.state.docs.find(d => d.file === ${JSON.stringify(D("alpha.md"))}).folderId`);
    check("a file cannot be dropped where it already lives", window.eval(`window.__t.canDropOnFolder(${JSON.stringify(alphaFolder)})`), false);
    check("but can move elsewhere", window.eval(`window.__t.canDropOnFolder(${JSON.stringify(projectsId)})`), true);
    window.eval("window.__t.state.dragPayload = null");
  }

  // Clear the decks so the toast assertions below measure only what they send.
  doc.querySelectorAll(".toast").forEach((t) => t.remove());
  window.eval("window.__t.state.clipboard = { files: [], mode: null }");

};
