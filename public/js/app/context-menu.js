/* The right-click menu.
 *
 * One menu, built from a list of items, positioned so it never opens off the
 * edge of the window. What goes in it depends on what was clicked and on what
 * the person is allowed to do, which is why the two builders are long and the
 * menu itself is short.
 *
 * Almost every item is an operation the app performs, so almost every action
 * here is written App.something(): the menu is a way of asking, not the thing
 * that does it.
 */

(function (global) {
  const { elements } = global.AppDom;
  const { state } = global.AppState;
  const { can } = global.AppApi;
  const { resolveTargetFiles } = global.AppSelection;
  const { cutFiles, pasteIntoFolder, moveFolderToParent } = global.AppClipboard;
  const { deleteFolderById, deleteFiles } = global.AppDeletion;
  const { openFolderModal } = global.AppFolderModal;
  const { beginInlineRename, beginInlineFolderRename } = global.AppInlineRename;
  const { openShareModal } = global.AppShare;

  // --- Context menu ---------------------------------------------------------

  function closeContextMenu() {
    if (!elements.contextMenu || elements.contextMenu.hidden) {
      return;
    }
    elements.contextMenu.hidden = true;
    elements.contextMenu.innerHTML = "";
  }

  function openContextMenu(x, y, items) {
    if (!elements.contextMenu) {
      return;
    }

    elements.contextMenu.innerHTML = "";

    for (const item of items) {
      if (item.separator) {
        const hr = document.createElement("hr");
        hr.className = "context-sep";
        elements.contextMenu.appendChild(hr);
        continue;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = item.danger ? "context-item danger" : "context-item";
      button.disabled = Boolean(item.disabled);
      button.innerHTML = `<i class="ph ${item.icon}" aria-hidden="true"></i><span></span>`;
      button.querySelector("span").textContent = item.label;

      if (item.shortcut) {
        const hint = document.createElement("kbd");
        hint.textContent = item.shortcut;
        button.appendChild(hint);
      }

      button.addEventListener("click", () => {
        closeContextMenu();
        item.action();
      });

      elements.contextMenu.appendChild(button);
    }

    elements.contextMenu.hidden = false;

    // Flip the menu back on screen if it would overflow the viewport.
    const rect = elements.contextMenu.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - rect.width - 8);
    const top = Math.min(y, window.innerHeight - rect.height - 8);
    elements.contextMenu.style.left = `${Math.max(8, left)}px`;
    elements.contextMenu.style.top = `${Math.max(8, top)}px`;

    elements.contextMenu.querySelector(".context-item:not(:disabled)")?.focus();
  }

  function buildDocContextItems(doc) {
    const targets = resolveTargetFiles(doc.file);
    const many = targets.length > 1;
    const inArchive = state.viewMode === "archive";

    // Without write access the menu is what a reader can actually do: open it,
    // and share it if the role allows. Offering Cut/Rename/Delete that only fail
    // at the server is worse than not offering them.
    if (!can("doc:write")) {
      const items = state.isRecycleBinMode
        ? [{ label: "Open", icon: "ph-file-text", action: () => void App.openRecycleBinDocument(doc.file) }]
        : [{ label: "Open", icon: "ph-file-text", action: () => void App.openDocument(doc.file, true) }];

      if (!state.isRecycleBinMode && can("share:manage")) {
        items.push({ separator: true });
        items.push({
          label: state.shares.has(doc.file) ? "Manage share link" : "Share...",
          icon: "ph-link-simple",
          action: () => openShareModal(doc.file)
        });
      }

      return items;
    }

    if (state.isRecycleBinMode) {
      return [
        {
          label: "Open", icon: "ph-file-text", action: () => void App.openRecycleBinDocument(doc.file)
        },
        { separator: true },
        {
          label: "Restore",
          icon: "ph-arrow-counter-clockwise",
          action: () => void (inArchive ? AppFileActions.restoreArchivedDocumentByFile(doc.file) : AppFileActions.restoreDeletedDocumentByFile(doc.file))
        },
        {
          label: inArchive ? "Delete forever" : "Archive",
          icon: inArchive ? "ph-trash" : "ph-archive-box",
          danger: true,
          action: () => void (inArchive ? AppFileActions.permanentlyDeleteArchivedDocument(doc.file) : AppFileActions.hardDeleteDeletedDocumentByFile(doc.file))
        }
      ];
    }

    return [
      { label: "Open", icon: "ph-file-text", disabled: many, action: () => void App.openDocument(doc.file, true) },
      { label: "Edit", icon: "ph-pencil-simple", disabled: many, action: () => void AppEditorSave.openEditorForDocument(doc.file) },
      { separator: true },
      {
        label: many ? `Cut ${targets.length} files` : "Cut",
        icon: "ph-scissors",
        shortcut: "Ctrl+X",
        action: () => cutFiles(targets)
      },
      {
        label: "Move to folder...",
        icon: "ph-folder",
        disabled: many,
        action: () => openFolderModal({ mode: "move", file: doc.file, folderId: doc.folderId || null })
      },
      {
        label: "Rename",
        icon: "ph-cursor-text",
        shortcut: "F2",
        disabled: many,
        action: () => beginInlineRename(doc.file)
      },
      { separator: true },
      {
        label: many ? `Delete ${targets.length} files` : "Delete",
        icon: "ph-trash",
        shortcut: "Del",
        danger: true,
        action: () => void deleteFiles(targets, "soft")
      },
      {
        label: many ? `Archive ${targets.length} files` : "Archive",
        icon: "ph-archive-box",
        shortcut: "Shift+Del",
        danger: true,
        action: () => void deleteFiles(targets, "hard")
      },
      ...(can("share:manage") ? [
        { separator: true },
        {
          label: state.shares.has(doc.file) ? "Manage share link" : "Share...",
          icon: "ph-link-simple",
          disabled: many,
          action: () => openShareModal(doc.file)
        }
      ] : [])
    ];
  }

  function buildFolderContextItems(folder) {
    const canPaste = state.clipboard.files.length > 0;

    // Every entry below is a write. There is no read-only folder action, so a
    // viewer gets no folder menu rather than a menu of refusals.
    if (!can("doc:write")) {
      return [];
    }

    return [
      {
        label: "New file",
        icon: "ph-file-plus",
        action: () => AppSourceEditor.startNewDocument(folder.id)
      },
      {
        label: "New subfolder",
        icon: "ph-folder-plus",
        action: () => openFolderModal({ mode: "create", parentId: folder.id })
      },
      {
        label: canPaste ? `Paste ${state.clipboard.files.length} file(s)` : "Paste",
        icon: "ph-clipboard-text",
        shortcut: "Ctrl+V",
        disabled: !canPaste,
        action: () => void pasteIntoFolder(folder.id)
      },
      { separator: true },
      {
        label: "Rename",
        icon: "ph-cursor-text",
        shortcut: "F2",
        action: () => beginInlineFolderRename(folder.id)
      },
      {
        label: "Move to top level",
        icon: "ph-arrow-line-up",
        disabled: !folder.parentId,
        action: () => void moveFolderToParent(folder.id, null)
      },
      { separator: true },
      {
        label: "Delete folder",
        icon: "ph-trash",
        danger: true,
        action: () => void deleteFolderById(folder.id)
      }
    ];
  }

  global.AppContextMenu = {
    closeContextMenu,
    openContextMenu,
    buildDocContextItems,
    buildFolderContextItems
  };
})(typeof window === "undefined" ? globalThis : window);
