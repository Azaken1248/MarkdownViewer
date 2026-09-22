// Every element in the page the interface ever reaches for, looked up once.
//
// The page is one document with everything in it, so these are all present by
// the time this runs — it is a deferred script, and the parser is done. A
// lookup that returns null here is a typo or a deleted element, not a timing
// problem, which is why nothing re-queries later.

/* exported AppDom */
var AppDom = (function () {
  // Each lookup says what kind of element the page has under that id, so a
  // `.value` or `.disabled` read further on is checked against a real input or
  // button rather than a bare HTMLElement.
  /** @param {string} id @returns {HTMLElement} */
  const element = (id) => document.getElementById(id);
  /** @param {string} id */
  const button = (id) => /** @type {HTMLButtonElement} */ (document.getElementById(id));
  /** @param {string} id */
  const input = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id));
  /** @param {string} id */
  const textarea = (id) => /** @type {HTMLTextAreaElement} */ (document.getElementById(id));
  /** @param {string} id */
  const select = (id) => /** @type {HTMLSelectElement} */ (document.getElementById(id));
  /** @param {string} id */
  const form = (id) => /** @type {HTMLFormElement} */ (document.getElementById(id));
  /** @param {string} id */
  const details = (id) => /** @type {HTMLDetailsElement} */ (document.getElementById(id));
  /** @param {string} id */
  const anchor = (id) => /** @type {HTMLAnchorElement} */ (document.getElementById(id));
  /** @param {string} id */
  const datalist = (id) => /** @type {HTMLDataListElement} */ (document.getElementById(id));

  const elements = {
    appShell: element("appShell"),
    toggleSidebar: button("toggleSidebar"),
    sidebarOverlay: button("sidebarOverlay"),
    sidebarTitle: element("sidebarTitle"),
    refreshDocs: button("refreshDocs"),
    toggleRecycleBinBtn: button("toggleRecycleBinBtn"),
    toggleArchiveBtn: button("toggleArchiveBtn"),
    uploadTrigger: button("uploadTrigger"),
    uploadMenu: element("uploadMenu"),
    uploadFilesItem: button("uploadFilesItem"),
    uploadFolderItem: button("uploadFolderItem"),
    uploadFolderInput: input("uploadFolderInput"),
    uploadInput: input("uploadInput"),
    createFolderBtn: button("createFolderBtn"),
    collapseAllBtn: button("collapseAllBtn"),
    closeSidebarBtn: button("closeSidebarBtn"),
    newDocBtn: button("newDocBtn"),
    editDocBtn: button("editDocBtn"),
    editCurrentDocBtn: button("editCurrentDocBtn"),
    softDeleteDocBtn: button("softDeleteDocBtn"),
    hardDeleteDocBtn: button("hardDeleteDocBtn"),
    restoreDocBtn: button("restoreDocBtn"),
    breadcrumbs: element("breadcrumbs"),
    activeDocMeta: element("activeDocMeta"),
    matchNav: element("matchNav"),
    matchNavLabel: element("matchNavLabel"),
    matchPrevBtn: button("matchPrevBtn"),
    matchNextBtn: button("matchNextBtn"),
    matchCloseBtn: button("matchCloseBtn"),
    dockSearch: button("dockSearch"),
    dockOpenDocs: button("dockOpenDocs"),
    dockUpload: button("dockUpload"),
    dockNew: button("dockNew"),
    dockEdit: button("dockEdit"),
    searchWrap: /** @type {HTMLElement} */ (document.querySelector(".search-wrap")),
    searchInput: input("searchInput"),
    clearSearchBtn: button("clearSearchBtn"),
    superSearchPanel: element("superSearchPanel"),
    superSearchCount: element("superSearchCount"),
    superSearchList: element("superSearchList"),
    superSearchHint: element("superSearchHint"),
    clearFilterBtn: button("clearFilterBtn"),
    themeToggleBtn: button("themeToggleBtn"),
    searchMeta: element("searchMeta"),
    selectionMeta: element("selectionMeta"),
    contextMenu: element("contextMenu"),
    toastStack: element("toastStack"),
    toastStackUrgent: element("toastStackUrgent"),
    docList: element("docList"),
    sidebar: element("sidebar"),
    emptyState: element("emptyState"),
    docContent: element("docContent"),
    viewer: /** @type {HTMLElement} */ (document.querySelector(".viewer")),
    placeDocsBtn: anchor("placeDocsBtn"),
    placeLinksBtn: anchor("placeLinksBtn"),
    uploadWrap: element("uploadWrap"),
    viewerToolbar: element("viewerToolbar"),
    linksPane: element("linksPane"),
    linksGrid: element("linksGrid"),
    linksEmpty: element("linksEmpty"),
    linksCount: element("linksCount"),
    addLinkBtn: button("addLinkBtn"),
    linkModal: element("linkModal"),
    linkBackdrop: button("linkBackdrop"),
    closeLinkModalBtn: button("closeLinkModalBtn"),
    cancelLinkBtn: button("cancelLinkBtn"),
    linkForm: form("linkForm"),
    linkUrlInput: input("linkUrlInput"),
    linkNoteInput: input("linkNoteInput"),
    linkGroupsInput: input("linkGroupsInput"),
    linkGroupOptions: datalist("linkGroupOptions"),
    linksGroups: element("linksGroups"),
    linkError: element("linkError"),
    saveLinkBtn: button("saveLinkBtn"),
    editorModal: element("editorModal"),
    editorBackdrop: button("editorBackdrop"),
    closeEditorBtn: button("closeEditorBtn"),
    saveDocBtn: button("saveDocBtn"),
    editorFileName: input("editorFileName"),
    editorFolderField: element("editorFolderField"),
    editorTabs: element("editorTabs"),
    editorGrid: element("editorGrid"),
    pageEditBar: element("pageEditBar"),
    pageEditState: element("pageEditState"),
    pageEditSourceBtn: button("pageEditSourceBtn"),
    pageEditCancelBtn: button("pageEditCancelBtn"),
    pageEditSaveBtn: button("pageEditSaveBtn"),
    visualToolbar: element("visualToolbar"),
    visualImageBtn: button("visualImageBtn"),
    imageInput: input("imageInput"),
    editorTabWrite: button("editorTabWrite"),
    editorTabPreview: button("editorTabPreview"),
    editorWritePane: element("editorWritePane"),
    editorPreviewPane: element("editorPreviewPane"),
    editorFolderSelect: select("editorFolderSelect"),
    editorInput: textarea("editorInput"),
    editorPreview: element("editorPreview"),
    confirmModal: element("confirmModal"),
    confirmBackdrop: button("confirmBackdrop"),
    confirmTitle: element("confirmTitle"),
    confirmMessage: element("confirmMessage"),
    confirmCancelBtn: button("confirmCancelBtn"),
    confirmProceedBtn: button("confirmProceedBtn"),
    confirmAltBtn: button("confirmAltBtn"),
    folderModal: element("folderModal"),
    folderBackdrop: button("folderBackdrop"),
    folderTitle: element("folderTitle"),
    folderDescription: element("folderDescription"),
    folderNameInput: input("folderNameInput"),
    createFolderConfirmBtn: button("createFolderConfirmBtn"),
    loginModal: element("loginModal"),
    loginForm: form("loginForm"),
    loginUsername: input("loginUsername"),
    loginPassword: input("loginPassword"),
    loginError: element("loginError"),
    loginSubmitBtn: button("loginSubmitBtn"),
    loginMessage: element("loginMessage"),
    loginTitle: element("loginTitle"),

    passwordModal: element("passwordModal"),
    passwordForm: form("passwordForm"),
    passwordUsername: input("passwordUsername"),
    currentPassword: input("currentPassword"),
    newPassword: input("newPassword"),
    confirmPassword: input("confirmPassword"),
    passwordError: element("passwordError"),
    passwordCancelBtn: button("passwordCancelBtn"),
    passwordBackdrop: button("passwordBackdrop"),
    passwordTitle: element("passwordTitle"),
    passwordMessage: element("passwordMessage"),

    usersModal: element("usersModal"),
    usersBackdrop: button("usersBackdrop"),
    usersTableBody: element("usersTableBody"),
    closeUsersBtn: button("closeUsersBtn"),
    newUserForm: form("newUserForm"),
    newUserName: input("newUserName"),
    newUserPassword: input("newUserPassword"),
    newUserRole: select("newUserRole"),
    newUserError: element("newUserError"),
    newUserDetails: details("newUserDetails"),

    kernelBar: element("kernelBar"),
    kernelStatus: element("kernelStatus"),
    restartKernelBtn: button("restartKernelBtn"),

    copyDocBtn: button("copyDocBtn"),
    shareDocBtn: button("shareDocBtn"),
    shareModal: element("shareModal"),
    shareBackdrop: button("shareBackdrop"),
    shareStatus: element("shareStatus"),
    shareUrlField: element("shareUrlField"),
    shareUrlInput: input("shareUrlInput"),
    copyShareUrlBtn: button("copyShareUrlBtn"),
    shareOnceHint: element("shareOnceHint"),
    shareCloseBtn: button("shareCloseBtn"),
    revokeShareBtn: button("revokeShareBtn"),
    createShareBtn: button("createShareBtn"),

    accountBtn: button("accountBtn"),
    accountMenu: element("accountMenu"),
    accountIdentity: element("accountIdentity"),
    changePasswordItem: button("changePasswordItem"),
    manageUsersItem: button("manageUsersItem"),
    signOutItem: button("signOutItem"),
    folderPicker: element("folderPicker"),
    folderPickerList: element("folderPickerList"),
    moveToRootBtn: button("moveToRootBtn"),
    closeFolderModalBtn: button("closeFolderModalBtn")
  };

  return { elements };
})();
