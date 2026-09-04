// Share links.
//
// A share link publishes one document at an unguessable URL. The token is the
// credential, so the server stores only its hash and hands back the full URL
// exactly once — which is why the dialog says so, and why "create" on an
// already-shared document is a rotation that invalidates the old link.

(function (global) {
  const { elements } = global.AppDom;
  const { state } = global.AppState;
  const { requestJson, can } = global.AppApi;
  const { escapeHtml, docUrl } = global.AppText;
  const { syncBodyLock } = global.AppShell;
  const { notify, requestConfirmation } = global.AppNotify;
  const { enterModalLayer, exitModalLayer } = global.AppModal;

  async function refreshShares() {
    if (!can("share:manage")) {
      state.shares = new Map();
      return;
    }

    try {
      const payload = await requestJson("/api/shares", { cache: "no-store" });
      state.shares = new Map((payload.shares || []).map((share) => [share.file, share]));
    } catch {
      // Not fatal: the share button just will not show a "shared" state.
      state.shares = new Map();
    }
  }

  function openShareModal(file) {
    state.shareOpen = true;
    state.shareFile = file;

    renderShareDialog();

    elements.shareModal.classList.add("open");
    elements.shareModal.setAttribute("aria-hidden", "false");
    enterModalLayer(elements.shareModal);
    syncBodyLock();
  }

  function closeShareModal() {
    state.shareOpen = false;
    state.shareFile = null;
    elements.shareUrlInput.value = "";
    elements.shareUrlField.hidden = true;
    elements.shareOnceHint.hidden = true;
    elements.shareModal.classList.remove("open");
    elements.shareModal.setAttribute("aria-hidden", "true");
    exitModalLayer(elements.shareModal);
    syncBodyLock();
  }

  function renderShareDialog() {
    const share = state.shares.get(state.shareFile);

    if (share) {
      const viewed = share.views > 0
        ? `Opened ${share.views} time${share.views === 1 ? "" : " s"}.`.replace(" s", "s")
        : "Not opened yet.";
      elements.shareStatus.innerHTML = `
        <p class="share-live"><i class="ph ph-globe-simple" aria-hidden="true"></i>
          <span><strong>${escapeHtml(state.shareFile)}</strong> is shared publicly.</span></p>
        <p class="share-sub">Created ${escapeHtml(new Date(share.createdAt).toLocaleDateString())} by
          ${escapeHtml(share.createdBy || "unknown")}. ${escapeHtml(viewed)}</p>
      `;
      elements.revokeShareBtn.hidden = false;
      elements.createShareBtn.textContent = "Replace link";
    } else {
      elements.shareStatus.innerHTML = `
        <p class="share-live"><i class="ph ph-lock-simple" aria-hidden="true"></i>
          <span><strong>${escapeHtml(state.shareFile)}</strong> is private.</span></p>
        <p class="share-sub">Only signed-in accounts can read it.</p>
      `;
      elements.revokeShareBtn.hidden = true;
      elements.createShareBtn.textContent = "Create link";
    }
  }

  async function createShareLink() {
    const file = state.shareFile;
    const existing = state.shares.get(file);

    if (existing) {
      const confirmed = await requestConfirmation({
        title: "Replace the existing link?",
        message: "The current link stops working immediately. Anyone still using it will get a 'not valid' page.",
        confirmLabel: "Replace link",
        tone: "danger"
      });

      if (!confirmed) {
        return;
      }
    }

    try {
      const payload = await requestJson(`/api/docs/${docUrl(file)}/share`, { method: "POST" });
      await refreshShares();
      renderShareDialog();

      elements.shareUrlInput.value = payload.url;
      elements.shareUrlField.hidden = false;
      elements.shareOnceHint.hidden = false;
      elements.shareUrlInput.select();

      updateShareButton();
      notify(payload.rotated ? "New share link created. The old one no longer works." : "Share link created.", "success");
    } catch (error) {
      notify(error.message, "error");
    }
  }

  async function revokeShareLink() {
    const file = state.shareFile;
    const confirmed = await requestConfirmation({
      title: "Revoke the share link?",
      message: `"${file}" stops being publicly readable immediately.`,
      confirmLabel: "Revoke link",
      tone: "danger"
    });

    if (!confirmed) {
      return;
    }

    try {
      await requestJson(`/api/docs/${docUrl(file)}/share`, { method: "DELETE" });
      await refreshShares();
      renderShareDialog();
      elements.shareUrlField.hidden = true;
      elements.shareOnceHint.hidden = true;
      updateShareButton();
      notify("Share link revoked.", "success");
    } catch (error) {
      notify(error.message, "error");
    }
  }

  // The button carries the state, so you can see at a glance whether the open
  // document is published without opening the dialog.
  function updateShareButton() {
    if (!elements.shareDocBtn) {
      return;
    }

    const usable = can("share:manage") && Boolean(state.activeFile) && !state.isRecycleBinMode;
    elements.shareDocBtn.hidden = !can("share:manage");
    elements.shareDocBtn.disabled = !usable;

    const shared = usable && state.shares.has(state.activeFile);
    elements.shareDocBtn.classList.toggle("active", shared);

    const icon = elements.shareDocBtn.querySelector("i");
    if (icon) {
      icon.className = shared ? "ph-fill ph-link-simple" : "ph ph-link-simple";
    }

    const label = shared ? "Shared publicly - manage link" : "Share this document";
    elements.shareDocBtn.setAttribute("aria-label", label);
    elements.shareDocBtn.title = label;
    delete elements.shareDocBtn.dataset.tip;
  }

  global.AppShare = {
    refreshShares,
    openShareModal,
    closeShareModal,
    createShareLink,
    revokeShareLink,
    updateShareButton
  };
})(typeof window === "undefined" ? globalThis : window);
