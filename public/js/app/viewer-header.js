/* The header above the document.
 *
 * The trail of folders that says where the open file sits, the line of facts
 * about it — size, date, folder — and the gating of every write control in the
 * viewer toolbar and the mobile dock.
 *
 * Those three used to be spread out. updateActiveDocUI has three exits and
 * each set the buttons independently, which is how a viewer ended up with live
 * Edit and Delete buttons that only failed once the server refused them. They
 * are one place now.
 */

(function (global) {
  const { elements } = global.AppDom;
  const { MOBILE_BREAKPOINT, setNavOpen } = global.AppShell;
  const { state } = global.AppState;
  const { can } = global.AppApi;
  const { docName, isNotebookFile, formatDate, formatBytes } = global.AppText;
  const { getDocByFile, getFolderRecord, folderPathIds } = global.AppLibrary;
  const { persistCollapsedFolders } = global.AppFolderCollapse;
  const { updateShareButton } = global.AppShare;
  const { renderLinks, closeLinkModal } = global.AppLinks;
  const { findFolderRow } = global.AppInlineRename;

  // Beyond this many crumbs the middle ancestors collapse behind an overflow
  // button, so a deep path cannot push the file name out of view.
  const BREADCRUMB_MAX_CRUMBS = 4;

  function scrollTreeRowIntoView(row) {
    // Scrolling is the least important half of "reveal this folder", so it must
    // not be able to take the expand-and-focus half down with it.
    if (!row || typeof row.scrollIntoView !== "function") {
      return;
    }

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    row.scrollIntoView({ block: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
  }

  function revealFolderInTree(folderId) {
    // Expanding the whole ancestor chain, not just the folder, so revealing a
    // deep folder cannot leave it hidden inside a collapsed parent.
    for (const id of folderPathIds(folderId)) {
      state.collapsedFolderIds.delete(id);
    }

    persistCollapsedFolders();
    App.renderDocList();

    const row = findFolderRow(folderId);
    scrollTreeRowIntoView(row);
    row?.querySelector(".tree-row-btn")?.focus();

    if (window.innerWidth <= MOBILE_BREAKPOINT) {
      setNavOpen(true);
    }
  }

  function buildCrumbButton(label, { title = "", icon = "", onClick }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "crumb";
    button.title = title || label;
    button.innerHTML = icon ? `<i class="ph ${icon}" aria-hidden="true"></i><span></span>` : "<span></span>";
    button.querySelector("span").textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function appendCrumbSeparator(container) {
    const sep = document.createElement("i");
    sep.className = "ph ph-caret-right crumb-sep";
    sep.setAttribute("aria-hidden", "true");
    container.appendChild(sep);
  }

  function renderBreadcrumbs({ iconClass, label, folderId, rootLabel }) {
    const nav = elements.breadcrumbs;
    if (!nav) {
      return;
    }

    nav.innerHTML = "";

    // Root crumb: the scope being browsed, not a folder.
    const rootIcon = state.viewMode === "links"
      ? "ph-link-simple"
      : state.viewMode === "archive"
        ? "ph-archive-box"
        : state.viewMode === "recycle" ? "ph-trash" : "ph-house";

    const crumbs = [
      buildCrumbButton(rootLabel, {
        icon: rootIcon,
        title: `Back to the top of ${rootLabel}`,
        onClick: () => {
          elements.docList.scrollTo({ top: 0 });
          if (window.innerWidth <= MOBILE_BREAKPOINT) {
            setNavOpen(true);
          }
        }
      })
    ];

    const ancestors = folderId ? folderPathIds(folderId) : [];
    for (const id of ancestors) {
      const folder = getFolderRecord(id);
      if (!folder) {
        continue;
      }

      crumbs.push(buildCrumbButton(folder.name, {
        title: `Show ${folder.path} in the file tree`,
        onClick: () => revealFolderInTree(id)
      }));
    }

    // Everything except the root and the last folder can fold away; the file name
    // is rendered separately and always survives.
    const overflowCount = crumbs.length - (BREADCRUMB_MAX_CRUMBS - 1);
    if (overflowCount > 1) {
      const hidden = crumbs.splice(1, overflowCount);
      const hiddenIds = ancestors.slice(0, overflowCount);

      const more = document.createElement("button");
      more.type = "button";
      more.className = "crumb crumb-overflow";
      more.title = "Show the folders in between";
      more.setAttribute("aria-label", `${hidden.length} more folders`);
      more.setAttribute("aria-haspopup", "menu");
      more.innerHTML = '<i class="ph ph-dots-three" aria-hidden="true"></i>';
      more.addEventListener("click", (event) => {
        event.stopPropagation();
        const rect = more.getBoundingClientRect();
        App.openContextMenu(rect.left, rect.bottom + 4, hiddenIds.map((id) => ({
          label: getFolderRecord(id)?.name || id,
          icon: "ph-folder",
          action: () => revealFolderInTree(id)
        })));
      });

      crumbs.splice(1, 0, more);
    }

    crumbs.forEach((crumb, index) => {
      if (index > 0) {
        appendCrumbSeparator(nav);
      }
      nav.appendChild(crumb);
    });

    appendCrumbSeparator(nav);

    const current = document.createElement("span");
    current.className = "crumb crumb-current";
    current.setAttribute("aria-current", "page");
    current.innerHTML = `<i class="ph ${iconClass}" aria-hidden="true"></i><span></span>`;
    current.querySelector("span").textContent = label;
    nav.appendChild(current);
  }

  // The tree rows are one line each, so the size/date/folder facts they used to
  // carry as chips live here instead, next to the file they describe.
  function setViewerHeading(iconClass, label, metaParts, folderId = null) {
    const rootLabel = state.viewMode === "links"
      ? "Links"
      : state.viewMode === "archive"
        ? "Archive"
        : state.viewMode === "recycle" ? "Recycle bin" : "Files";

    renderBreadcrumbs({ iconClass, label, folderId, rootLabel });

    if (elements.activeDocMeta) {
      elements.activeDocMeta.textContent = (metaParts || []).filter(Boolean).join("  ·  ");
    }
  }

  // Every write control in the viewer toolbar and the mobile dock, gated in one
  // place. updateActiveDocUI has three exits and each used to set these
  // independently, so a viewer ended up with live Edit and Delete buttons that
  // only failed once the server refused them.
  function applyPermissionGating() {
    const writable = can("doc:write");

    // Two different reasons a document control should not be on screen: the
    // account may not write, or there is no document in front of it because the
    // links pane is up. syncModeUI writes the same set from the same rule.
    const docTools = writable && state.viewMode !== "links";

    // Hidden rather than disabled: a greyed-out button that can never become
    // usable is just clutter with a tooltip.
    for (const control of [elements.newDocBtn, elements.uploadTrigger, elements.editDocBtn,
      elements.createFolderBtn, elements.editCurrentDocBtn, elements.softDeleteDocBtn,
      elements.dockNew, elements.dockUpload, elements.dockEdit]) {
      if (control) {
        control.hidden = !docTools;
      }
    }

    // Erasing from the archive is admin-only; the same button is "Archive" for
    // everyone else, so it follows doc:write outside the archive view.
    if (elements.hardDeleteDocBtn) {
      elements.hardDeleteDocBtn.hidden = state.viewMode === "archive"
        ? !can("doc:erase")
        : !writable;
    }

    if (elements.restoreDocBtn) {
      elements.restoreDocBtn.hidden = !writable || !state.isRecycleBinMode;
    }

    if (elements.manageUsersItem) {
      elements.manageUsersItem.hidden = !can("user:manage");
    }

    // A viewer can read the saved links but not add, refresh or remove one.
    // Adding makes the server fetch a URL, which is a write in every sense that
    // matters here.
    if (elements.addLinkBtn) {
      elements.addLinkBtn.hidden = !writable;
    }

    if (!writable && state.linkModalOpen) {
      closeLinkModal();
    }

    // The per-card buttons are built at render time, so the cards have to be
    // rebuilt for a role change to reach them.
    if (state.viewMode === "links") {
      renderLinks();
    }

    // A menu left open over a control that has just been hidden.
    if (!writable && elements.uploadMenu && !elements.uploadMenu.hidden) {
      App.setUploadMenuOpen(false);
    }

    updateShareButton();
  }

  function updateActiveDocUI(fileName) {
    // Copying is reading. It needs a document open and nothing else — not a
    // write permission, and not a document that still exists in the library,
    // since a deleted one is exactly the thing you want to take a copy of.
    elements.copyDocBtn.disabled = !fileName;

    if (!fileName) {
      setViewerHeading("ph-file-text", "No file selected", []);
      elements.editDocBtn.disabled = true;
      elements.editCurrentDocBtn.disabled = true;
      elements.dockEdit.disabled = true;
      elements.softDeleteDocBtn.disabled = true;
      elements.hardDeleteDocBtn.disabled = true;
      elements.restoreDocBtn.disabled = true;
      applyPermissionGating();
      return;
    }

    if (state.isRecycleBinMode) {
      const deletedDoc = state.deletedDocs.find((doc) => doc.file === fileName);
      const label = deletedDoc?.originalFile || fileName;
      const inArchive = state.viewMode === "archive";
      setViewerHeading(inArchive ? "ph-archive-box" : "ph-trash", label, [
        inArchive ? "Archived" : "In recycle bin",
        deletedDoc ? formatBytes(deletedDoc.size) : "",
        deletedDoc?.deletedAt ? `deleted ${formatDate(deletedDoc.deletedAt)}` : ""
      ], deletedDoc?.folderId || null);
      elements.editDocBtn.disabled = true;
      elements.editCurrentDocBtn.disabled = true;
      elements.dockEdit.disabled = true;
      elements.softDeleteDocBtn.disabled = true;
      elements.hardDeleteDocBtn.disabled = false;
      elements.restoreDocBtn.disabled = false;
      applyPermissionGating();
      return;
    }

    const notebookFile = isNotebookFile(fileName);
    const doc = getDocByFile(fileName);
    // The folder is in the breadcrumb trail now, so it is not repeated here.
    // The trail already names every folder above it, so the last crumb is the
    // document's name rather than its whole path.
    setViewerHeading(notebookFile ? "ph-file-code" : "ph-file-text", docName(fileName), [
      doc ? formatBytes(doc.size) : "",
      doc?.updatedAt ? `updated ${formatDate(doc.updatedAt)}` : ""
    ], doc?.folderId || null);
    elements.editDocBtn.disabled = notebookFile;
    updateShareButton();
    elements.editCurrentDocBtn.disabled = notebookFile;
    elements.dockEdit.disabled = notebookFile;
    elements.softDeleteDocBtn.disabled = false;
    elements.hardDeleteDocBtn.disabled = false;
    elements.restoreDocBtn.disabled = true;
    applyPermissionGating();
  }

  global.AppViewerHeader = {
    scrollTreeRowIntoView,
    revealFolderInTree,
    renderBreadcrumbs,
    setViewerHeading,
    applyPermissionGating,
    updateActiveDocUI
  };
})(typeof window === "undefined" ? globalThis : window);
