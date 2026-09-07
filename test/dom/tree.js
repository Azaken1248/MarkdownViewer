// Part of the DOM suite. See dom.test.js, which sets all this up and calls it.
//
// The tree the app comes up showing, and everything done to it with a pointer.
//
// Everything it needs is handed to it: the suite's own check(), the window the
// app is running in, and the handles the setup built. Split out of one file
// only because that file had grown past a thousand lines.
module.exports = async (ctx) => {
  const {
    check, server, window, doc
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
