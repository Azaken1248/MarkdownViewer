// Share links.
//
// A share link publishes one document at an unguessable URL. The token is the
// credential, so the server stores only its hash and hands back the full URL
// exactly once — which is why the dialog says so, and why "create" on an
// already-shared document is a rotation that invalidates the old link.

/* exported AppShare */
var AppShare = (function () {
  const { html } = DomHtml;
  const { elements } = AppDom;
  const { state } = AppState;
  const { requestJson, can } = AppApi;
  const { docUrl } = AppText;
  const { syncBodyLock } = AppShell;
  const { notify, requestConfirmation } = AppNotify;
  const { enterModalLayer, exitModalLayer } = AppModal;

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
      elements.shareStatus.innerHTML = html`
        <p class="share-live"><i class="ph ph-globe-simple" aria-hidden="true"></i>
          <span><strong>${state.shareFile}</strong> is shared publicly.</span></p>
        <p class="share-sub">Created ${new Date(share.createdAt).toLocaleDateString()} by
          ${share.createdBy || "unknown"}. ${viewed}</p>
      `;
      elements.revokeShareBtn.hidden = false;
      elements.createShareBtn.textContent = "Replace link";
      elements.shareExportField.hidden = false;
      elements.shareExportToggle.checked = Boolean(share.allowExport);

      /* On unless the owner has turned them off, which is also what a link
       * made before these existed does. `!== false` rather than Boolean(),
       * so a payload from an older server reads as on rather than off.
       */
      elements.shareTicksField.hidden = false;
      elements.shareTicksToggle.checked = share.allowTicks !== false;
      elements.shareInkField.hidden = false;
      elements.shareInkToggle.checked = share.allowInk !== false;
    } else {
      elements.shareStatus.innerHTML = html`
        <p class="share-live"><i class="ph ph-lock-simple" aria-hidden="true"></i>
          <span><strong>${state.shareFile}</strong> is private.</span></p>
        <p class="share-sub">Only signed-in accounts can read it.</p>
      `;
      elements.revokeShareBtn.hidden = true;
      elements.createShareBtn.textContent = "Create link";
      // Nothing to permit until there is a link to permit it on.
      elements.shareExportField.hidden = true;
      elements.shareExportToggle.checked = false;
      elements.shareTicksField.hidden = true;
      elements.shareInkField.hidden = true;
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

  /* Saved as it is switched rather than on a Save button.
   *
   * There is no other pending state in this dialog, so a button to confirm one
   * checkbox would only be a way to think you had changed something and not
   * have. If the write fails the box goes back to what the server still says.
   */
  async function setExportAllowed(allowed) {
    return setLinkAllows({ allowExport: allowed }, allowed
      ? "Anyone with the link can now export this document."
      : "Exporting from the link is off.");
  }

  /* The switches a link carries, each saved as it is switched.
   *
   * One function because they are one request and one failure path: if the
   * write fails the box goes back to what the server still says, which is the
   * only honest thing a toggle with no Save button can do.
   */
  async function setLinkAllows(asked, said) {
    const file = state.shareFile;
    const [[name, allowed]] = Object.entries(asked);
    const toggles = {
      allowExport: elements.shareExportToggle,
      allowTicks: elements.shareTicksToggle,
      allowInk: elements.shareInkToggle
    };

    try {
      const payload = await requestJson(`/api/docs/${docUrl(file)}/share`, {
        method: "PATCH",
        body: JSON.stringify(asked)
      });

      state.shares.set(file, { ...state.shares.get(file), ...payload.share, file });
      notify(said, "success");
    } catch (error) {
      toggles[name].checked = !allowed;
      notify(error.message, "error");
    }
  }

  async function setTicksAllowed(allowed) {
    return setLinkAllows({ allowTicks: allowed }, allowed
      ? "Readers can tick the boxes in their own copy."
      : "The boxes are shown as they are written, and cannot be ticked.");
  }

  async function setInkAllowed(allowed) {
    return setLinkAllows({ allowInk: allowed }, allowed
      ? "Readers can write on their own copy."
      : "Writing on the link is off, including marks already made.");
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

  return {
    refreshShares,
    openShareModal,
    closeShareModal,
    createShareLink,
    revokeShareLink,
    setExportAllowed,
    setTicksAllowed,
    setInkAllowed,
    updateShareButton
  };
})();
