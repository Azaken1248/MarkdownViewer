/* The file tree.
 *
 * A row per folder and a row per document, built from the tree the library
 * hands over, with the drag sources and drop targets that let one be moved
 * into another.
 *
 * Two things here are about a phone rather than about files. There is no
 * hover, so per-row buttons would have to be shown permanently — three to
 * five 44px targets, which leaves a ~280px drawer almost no room for the
 * filename; one overflow button opens the same actions instead. And a folder
 * renders a page of documents at a time, because a folder with a thousand
 * files in it should not cost a thousand rows before the first one is
 * readable.
 */

/* exported AppTree */
var AppTree = (function () {
  const { html } = DomHtml;
  // How many document rows each folder group renders before offering
  // "show more".
  const DOC_LIST_PAGE_SIZE = 50;

  const { elements } = AppDom;
  const { state } = AppState;
  const { can } = AppApi;
  const { docName, formatDate, formatBytes } = AppText;
  const { getDocByFile, getFolderRecord, buildFolderTree, folderPathIds } = AppLibrary;
  const { resolveTargetFiles, setSelection, handleRowSelection, updateSelectionMeta } = AppSelection;
  const { closeSidebarOnMobile } = AppShell;
  const { toggleFolderCollapse } = AppFolderCollapse;
  const { openFolderModal } = AppFolderModal;
  const { beginInlineRename, beginInlineFolderRename } = AppInlineRename;
  const { cutFiles, pasteIntoFolder, moveFilesToFolder, moveFolderToParent } = AppClipboard;
  const { deleteFolderById, deleteFiles } = AppDeletion;
  const { openContextMenu, buildDocContextItems, buildFolderContextItems } = AppContextMenu;

  function buildTreeAction(label, iconClass, handler, { danger = false, disabled = false } = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = danger ? "tree-action danger" : "tree-action";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.disabled = disabled;
    button.innerHTML = html`<i class="ph ${iconClass}" aria-hidden="true"></i>`;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handler();
    });
    return button;
  }

  // On a phone there is no hover, so the per-row buttons would have to be shown
  // permanently — three to five 44px targets, which leaves a ~280px drawer almost
  // no room for the filename. One overflow button opens the same actions instead.
  function buildOverflowAction(getItems) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tree-action tree-action-more";
    button.title = "More actions";
    button.setAttribute("aria-label", "More actions");
    button.setAttribute("aria-haspopup", "menu");
    button.innerHTML = '<i class="ph ph-dots-three-vertical" aria-hidden="true"></i>';
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = button.getBoundingClientRect();
      openContextMenu(rect.left, rect.bottom + 4, getItems());
    });
    return button;
  }

  function enableDocDrag(row, doc) {
    row.draggable = true;

    row.addEventListener("dragstart", (event) => {
      // Dragging an unselected row selects it first, so what you drag is always
      // what you can see highlighted.
      if (!state.selection.has(doc.file)) {
        setSelection([doc.file], { anchor: doc.file });
      }

      state.dragPayload = { type: "files", files: [...state.selection] };
      row.classList.add("is-dragging");

      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", [...state.selection].join("\n"));
      }
    });

    row.addEventListener("dragend", () => {
      state.dragPayload = null;
      row.classList.remove("is-dragging");
      elements.docList.querySelectorAll(".is-drop-target").forEach((node) => node.classList.remove("is-drop-target"));
    });
  }

  function enableFolderDrag(row, folder) {
    if (!can("doc:write")) {
      return;
    }

    row.draggable = true;

    row.addEventListener("dragstart", (event) => {
      event.stopPropagation();
      state.dragPayload = { type: "folder", folderId: folder.id };
      row.classList.add("is-dragging");

      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", folder.name);
      }
    });

    row.addEventListener("dragend", () => {
      state.dragPayload = null;
      row.classList.remove("is-dragging");
      elements.docList.querySelectorAll(".is-drop-target").forEach((node) => node.classList.remove("is-drop-target"));
    });
  }

  function canDropOnFolder(targetFolderId) {
    // Every drop is a move. One guard here covers both the folder and document
    // drop zones rather than each remembering to ask.
    if (!can("doc:write")) {
      return false;
    }

    const payload = state.dragPayload;
    if (!payload) {
      return false;
    }

    if (payload.type === "folder") {
      if (payload.folderId === targetFolderId) {
        return false;
      }
      // Refuse the drop that would make a folder its own ancestor. The server
      // rejects it too; this just avoids offering an action that cannot work.
      if (targetFolderId && folderPathIds(targetFolderId).includes(payload.folderId)) {
        return false;
      }
      const current = getFolderRecord(payload.folderId)?.parentId || null;
      return current !== (targetFolderId || null);
    }

    return payload.files.some((file) => {
      const doc = getDocByFile(file);
      return !doc || (doc.folderId || null) !== (targetFolderId || null);
    });
  }

  function enableFolderDrop(zone, folderRow, folderId) {
    zone.addEventListener("dragover", (event) => {
      if (!canDropOnFolder(folderId)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
      folderRow.classList.add("is-drop-target");
    });

    zone.addEventListener("dragleave", (event) => {
      if (event.relatedTarget && zone.contains(event.relatedTarget)) {
        return;
      }
      folderRow.classList.remove("is-drop-target");
    });

    zone.addEventListener("drop", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      folderRow.classList.remove("is-drop-target");

      const payload = state.dragPayload;
      state.dragPayload = null;
      if (!payload) {
        return;
      }

      if (payload.type === "folder") {
        await moveFolderToParent(payload.folderId, folderId);
        return;
      }

      await moveFilesToFolder(payload.files, folderId);
    });
  }

  function buildFolderRow(node, isCollapsed) {
    const { folder, depth } = node;
    const row = document.createElement("div");
    row.className = "tree-row tree-row-folder";
    if (folder) {
      row.dataset.folderId = folder.id;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "tree-row-btn";
    button.style.setProperty("--depth", String(depth));
    button.setAttribute("aria-expanded", String(!isCollapsed));

    const totalDocs = countNodeDocs(node);
    button.innerHTML = html`
      <i class="ph ph-caret-down tree-caret" aria-hidden="true"></i>
      <i class="ph ${folder ? "ph-folder" : "ph-stack"} tree-icon" aria-hidden="true"></i>
      <span class="tree-label"></span>
      <span class="tree-count"></span>
    `;
    button.querySelector(".tree-label").textContent = folder ? folder.name : (state.rootFolderLabel || "Ungrouped");
    button.querySelector(".tree-count").textContent = String(totalDocs);
    if (folder) {
      button.title = folder.path;
    }

    button.addEventListener("click", () => toggleFolderCollapse(folder ? folder.id : "__root__"));

    row.appendChild(button);

    if (folder && !state.isRecycleBinMode) {
      row.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openContextMenu(event.clientX, event.clientY, buildFolderContextItems(folder));
      });
      enableFolderDrag(row, folder);
    }

    return row;
  }

  function countNodeDocs(node) {
    return node.docs.length + node.children.reduce((total, child) => total + countNodeDocs(child), 0);
  }

  function buildFolderActions(node) {
    const folder = node.folder;
    const actions = document.createElement("div");
    actions.className = "tree-actions";

    actions.append(
      buildTreeAction("New subfolder", "ph-folder-plus", () => {
        openFolderModal({ mode: "create", parentId: folder.id });
      }),

      buildTreeAction(`Rename ${folder.name}`, "ph-pencil-simple", () => {
        beginInlineFolderRename(folder.id);
      }),

      buildTreeAction(`Delete ${folder.name}`, "ph-trash", () => {
        void deleteFolderById(folder.id);
      }, { danger: true }),

      buildOverflowAction(() => buildFolderContextItems(folder))
    );

    return actions;
  }

  function buildDocRow(doc, depth) {
    const row = document.createElement("li");
    row.className = "tree-row tree-row-doc";
    row.dataset.file = doc.file;

    const isActive = state.activeFile === doc.file;
    if (isActive) {
      row.classList.add("is-active");
    }
    row.setAttribute("aria-current", isActive ? "true" : "false");

    if (state.selection.has(doc.file)) {
      row.classList.add("is-selected");
    }
    row.setAttribute("aria-selected", String(state.selection.has(doc.file)));

    if (state.clipboard.mode === "cut" && state.clipboard.files.includes(doc.file)) {
      row.classList.add("is-cut");
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "tree-row-btn";
    button.style.setProperty("--depth", String(depth));

    const displayName = docName(state.isRecycleBinMode ? (doc.originalFile || doc.file) : doc.file);
    const timeLabel = state.isRecycleBinMode
      ? `deleted ${formatDate(doc.deletedAt || doc.updatedAt)}`
      : `updated ${formatDate(doc.updatedAt)}`;
    button.title = `${displayName}\n${formatBytes(doc.size)} · ${timeLabel}`;

    button.innerHTML = html`
      <i class="ph ${doc.icon} tree-icon" aria-hidden="true"></i>
      <span class="tree-label"></span>
    `;
    button.querySelector(".tree-label").textContent = doc.title;

    button.addEventListener("click", async (event) => {
      handleRowSelection(doc.file, event);

      // Ctrl/Shift are selection gestures, not "open this" gestures.
      if (event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }

      if (state.isRecycleBinMode) {
        await App.openRecycleBinDocument(doc.file);
      } else {
        await App.openDocument(doc.file, true, { jumpQuery: elements.searchInput.value });
      }

      closeSidebarOnMobile();
    });

    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!state.selection.has(doc.file)) {
        setSelection([doc.file], { anchor: doc.file });
      }
      openContextMenu(event.clientX, event.clientY, buildDocContextItems(doc));
    });

    const actions = document.createElement("div");
    actions.className = "tree-actions";

    if (state.isRecycleBinMode) {
      const inArchive = state.viewMode === "archive";

      actions.append(
        buildTreeAction("Restore", "ph-arrow-counter-clockwise", async () => {
          if (inArchive) {
            await AppFileActions.restoreArchivedDocumentByFile(doc.file);
          } else {
            await AppFileActions.restoreDeletedDocumentByFile(doc.file);
          }
        }),
        buildTreeAction(
          inArchive ? "Delete forever" : "Archive",
          inArchive ? "ph-trash" : "ph-archive-box",
          async () => {
            if (inArchive) {
              await AppFileActions.permanentlyDeleteArchivedDocument(doc.file);
            } else {
              await AppFileActions.hardDeleteDeletedDocumentByFile(doc.file);
            }
          },
          { danger: true }
        ),
        buildOverflowAction(() => buildDocContextItems(doc))
      );
    } else if (can("doc:write")) {
      actions.append(
        buildTreeAction("Edit", "ph-pencil-simple", async () => {
          await AppEditorSave.openEditorForDocument(doc.file);
        }),
        buildTreeAction("Rename", "ph-cursor-text", () => beginInlineRename(doc.file)),
        buildTreeAction("Move to recycle bin", "ph-trash", () => {
          void deleteFiles(resolveTargetFiles(doc.file), "soft");
        }, { danger: true }),
        buildOverflowAction(() => buildDocContextItems(doc))
      );

      // Dragging a row is a move; without write access there is nothing to drag.
      enableDocDrag(row, doc);
    } else if (can("share:manage")) {
      // Nothing to edit, but sharing is still available from the row.
      actions.append(buildOverflowAction(() => buildDocContextItems(doc)));
    }

    row.append(button, actions);
    return row;
  }

  function renderTreeNode(node, container) {
    const folderKey = node.folder ? node.folder.id : "__root__";
    const isCollapsed = state.collapsedFolderIds.has(folderKey);

    const groupItem = document.createElement("li");
    groupItem.className = isCollapsed ? "tree-group is-collapsed" : "tree-group";
    groupItem.dataset.folderKey = folderKey;

    const folderRow = buildFolderRow(node, isCollapsed);

    if (!state.isRecycleBinMode && node.folder && can("doc:write")) {
      folderRow.appendChild(buildFolderActions(node));
    }

    groupItem.appendChild(folderRow);

    if (!state.isRecycleBinMode) {
      enableFolderDrop(groupItem, folderRow, node.folder ? node.folder.id : null);
    }

    const childList = document.createElement("ul");
    childList.className = "tree-children";
    childList.style.setProperty("--depth", String(node.depth));

    for (const child of node.children) {
      renderTreeNode(child, childList);
    }

    const revealed = state.groupRevealCounts.get(folderKey) || DOC_LIST_PAGE_SIZE;
    const activeIndex = node.docs.findIndex((doc) => doc.file === state.activeFile);
    const visibleCount = Math.max(revealed, activeIndex + 1);
    const visibleDocs = node.docs.slice(0, visibleCount);
    const hiddenCount = node.docs.length - visibleDocs.length;

    for (const doc of visibleDocs) {
      childList.appendChild(buildDocRow(doc, node.depth + 1));
      state.visibleFileOrder.push(doc.file);
    }

    if (node.docs.length === 0 && node.children.length === 0) {
      const emptyRow = document.createElement("li");
      emptyRow.className = "tree-empty";
      emptyRow.style.setProperty("--depth", String(node.depth + 1));
      emptyRow.textContent = "Empty";
      childList.appendChild(emptyRow);
    }

    if (hiddenCount > 0) {
      const moreRow = document.createElement("li");
      const moreBtn = document.createElement("button");
      moreBtn.type = "button";
      moreBtn.className = "tree-more";
      moreBtn.style.setProperty("--depth", String(node.depth + 1));
      moreBtn.innerHTML = '<i class="ph ph-caret-down" aria-hidden="true"></i><span></span>';
      moreBtn.querySelector("span").textContent =
        `Show ${Math.min(hiddenCount, DOC_LIST_PAGE_SIZE)} more of ${node.docs.length}`;
      moreBtn.addEventListener("click", () => {
        state.groupRevealCounts.set(folderKey, visibleCount + DOC_LIST_PAGE_SIZE);
        renderDocList();
      });
      moreRow.appendChild(moreBtn);
      childList.appendChild(moreRow);
    }

    groupItem.appendChild(childList);
    container.appendChild(groupItem);
  }

  function renderDocList() {
    const treeScrollTop = elements.docList.scrollTop || 0;
    const sidebarScrollTop = elements.sidebar?.scrollTop || 0;

    elements.docList.innerHTML = "";
    state.visibleFileOrder = [];

    const nodes = buildFolderTree(state.filteredDocs);

    if (nodes.length === 0) {
      const item = document.createElement("li");
      item.className = "tree-empty";
      item.textContent = elements.searchInput.value.trim() ? "No files match this search." : "No files yet.";
      elements.docList.appendChild(item);
      elements.docList.scrollTop = treeScrollTop;
      updateSelectionMeta();
      return;
    }

    for (const node of nodes) {
      renderTreeNode(node, elements.docList);
    }

    elements.docList.scrollTop = treeScrollTop;
    if (elements.sidebar) {
      elements.sidebar.scrollTop = sidebarScrollTop;
    }

    updateSelectionMeta();
  }

  /* Moving through the tree without a mouse.
   *
   * Arrow keys walk the rows, left and right open and close a folder, and the
   * letters are the shortcuts a file manager has: F2 renames, Delete deletes,
   * Ctrl+X cuts, Ctrl+V pastes. The rows are real buttons, so focus is the
   * browser's to keep and this only ever moves it.
   */
  function getVisibleTreeButtons() {
    return [.../** @type {NodeListOf<HTMLElement>} */ (elements.docList.querySelectorAll(".tree-row-btn"))]
      .filter((button) => button.offsetParent !== null);
  }

  function moveTreeFocus(from, offset) {
    const buttons = getVisibleTreeButtons();
    const index = buttons.indexOf(from);
    if (index < 0) {
      return;
    }

    const next = buttons[Math.min(Math.max(index + offset, 0), buttons.length - 1)];
    if (next && next !== from) {
      next.focus();
    }
  }

  /* A row of the tree is a button, so the keyboard has to do what the mouse
   * does: the file manager's own keys for cut, paste, rename and delete, and
   * the arrow keys for walking and for opening and closing a folder.
   *
   * Two families, asked in this order. The commands take Ctrl or a function
   * key and act on the selection; the navigation keys act on the row that has
   * the focus, so they need a row and the commands do not.
   */
  function whereTheFocusIs(event) {
    const button = event.target.closest(".tree-row-btn");
    return {
      button,
      group: button?.closest(".tree-group"),
      docRow: button?.closest(".tree-row-doc"),
      folderRow: button?.closest(".tree-row-folder")
    };
  }

  /* The commands, as a list rather than as a run of guards.
   *
   * `write` marks the ones that change something, which is what a reader may
   * not do: select-all and the arrow keys stay available to everybody, and
   * cut, paste, rename and delete do not.
   */
  const TREE_COMMANDS = [
    { chord: true, key: "a", write: false, run: () => setSelection(state.visibleFileOrder) },
    { chord: true, key: "x", write: true, run: () => cutFiles([...state.selection]) },
    { chord: true, key: "v", write: true, run: (event, { group, folderRow }) => {
      const targetFolderId = folderRow?.dataset.folderId
        || (group?.dataset.folderKey !== "__root__" ? group?.dataset.folderKey : null)
        || null;
      void pasteIntoFolder(targetFolderId);
    } },
    { chord: false, key: "f2", write: true, run: (event, { docRow, folderRow }) => {
      if (docRow) {
        beginInlineRename(docRow.dataset.file);
      } else if (folderRow?.dataset.folderId) {
        beginInlineFolderRename(folderRow.dataset.folderId);
      }
    } },
    { chord: false, key: "delete", write: true, when: () => !state.isRecycleBinMode,
      run: (event, { docRow }) => {
        const targets = docRow ? resolveTargetFiles(docRow.dataset.file) : [...state.selection];
        if (targets.length) {
          void deleteFiles(targets, event.shiftKey ? "hard" : "soft");
        }
      } }
  ];

  function answeredByTreeCommand(event, at) {
    const key = String(event.key).toLowerCase();
    const chord = Boolean(event.ctrlKey || event.metaKey);

    const command = TREE_COMMANDS.find((one) => one.key === key
      && one.chord === chord
      && (!one.when || one.when()));

    if (!command || (command.write && !can("doc:write"))) {
      return false;
    }

    event.preventDefault();
    command.run(event, at);
    return true;
  }

  // Right opens a closed folder and otherwise walks on; left closes an open
  // one and otherwise goes up to the folder this row is in. Which is what the
  // arrow keys do in every tree anybody has used.
  function moveAcross(event, at, forward) {
    const { button, group, folderRow } = at;
    const collapsed = group?.classList.contains("is-collapsed");

    if (folderRow && collapsed === forward) {
      event.preventDefault();
      toggleFolderCollapse(group.dataset.folderKey);
      return;
    }

    if (forward) {
      if (folderRow) {
        event.preventDefault();
        moveTreeFocus(button, 1);
      }
      return;
    }

    event.preventDefault();
    const parentGroup = group?.parentElement?.closest(".tree-group");
    const targetGroup = folderRow ? parentGroup : group;
    targetGroup?.querySelector(".tree-row-folder .tree-row-btn")?.focus();
  }

  function answeredByTreeNavigation(event, at) {
    const { button } = at;
    const buttons = () => getVisibleTreeButtons();

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveTreeFocus(button, 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveTreeFocus(button, -1);
        break;
      case "Home": {
        event.preventDefault();
        const [first] = buttons();
        if (first) first.focus();
        break;
      }
      case "End": {
        event.preventDefault();
        const all = buttons();
        if (all.length) all[all.length - 1].focus();
        break;
      }
      case "ArrowRight":
        moveAcross(event, at, true);
        break;
      case "ArrowLeft":
        moveAcross(event, at, false);
        break;
      default:
        break;
    }
  }

  function handleTreeKeydown(event) {
    // An inline rename owns every key while it is open.
    if (event.target.classList?.contains("tree-rename-input")) {
      return;
    }

    const at = whereTheFocusIs(event);
    if (answeredByTreeCommand(event, at)) {
      return;
    }

    // Everything below moves the focus from one row to another, so there has
    // to be a row it is moving from.
    if (at.button) {
      answeredByTreeNavigation(event, at);
    }
  }

  // Opening a document only changes which row is highlighted. Rebuilding all
  // ~93 rows and their listeners for that was both wasteful and visible:
  // emptying the list collapsed the page height and threw the scroll position
  // back to the top.
  function updateActiveRowHighlight() {
    for (const row of /** @type {NodeListOf<HTMLElement>} */ (elements.docList.querySelectorAll(".tree-row-doc"))) {
      const isActive = row.dataset.file === state.activeFile;
      row.classList.toggle("is-active", isActive);
      row.setAttribute("aria-current", isActive ? "true" : "false");
    }
  }

  return {
    updateActiveRowHighlight,
    getVisibleTreeButtons,
    moveTreeFocus,
    handleTreeKeydown,
    buildTreeAction,
    buildOverflowAction,
    canDropOnFolder,
    renderTreeNode,
    renderDocList
  };
})();
