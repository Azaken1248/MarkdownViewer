// Saying what just happened.
//
// A single inline status line could only ever show the most recent thing that
// happened, and it showed it somewhere nobody was looking. Toasts stack, say
// what happened, and clear themselves.
//
// The confirmation dialog is here too, because it is the same question asked
// in a way that blocks: both are how the app speaks to the person using it.

(function (global) {
  const { elements } = global.AppDom;
  const { state } = global.AppState;
  const { enterModalLayer, exitModalLayer } = global.AppModal;
  const { syncBodyLock } = global.AppShell;

  const TOAST_TONES = {
    success: { icon: "ph-check-circle", title: "Done", duration: 4000 },
    error: { icon: "ph-warning-circle", title: "Something went wrong", duration: 8000 },
    warning: { icon: "ph-warning", title: "Heads up", duration: 6000 },
    info: { icon: "ph-info", title: "", duration: 4500 },
    neutral: { icon: "ph-info", title: "", duration: 4500 }
  };

  const TOAST_MAX_VISIBLE = 4;
  const activeToasts = new Set();

  function dismissToast(toast) {
    if (!toast || !activeToasts.has(toast)) {
      return;
    }

    activeToasts.delete(toast);
    window.clearTimeout(toast.dataset.timerId ? Number(toast.dataset.timerId) : 0);
    toast.classList.add("is-leaving");

    // Fall back to removing it outright if the animation never fires (reduced
    // motion, background tab), otherwise the stack would fill up with corpses.
    const remove = () => toast.remove();
    toast.addEventListener("animationend", remove, { once: true });
    window.setTimeout(remove, 400);
  }

  function notify(message, tone = "info", options = {}) {
    const text = String(message || "").trim();
    if (!text) {
      return null;
    }

    const preset = TOAST_TONES[tone] || TOAST_TONES.info;
    const toneClass = TOAST_TONES[tone] ? tone : "info";
    const title = options.title !== undefined ? options.title : preset.title;
    const duration = Number.isFinite(options.duration) ? options.duration : preset.duration;
    const isUrgent = toneClass === "error";

    const stack = isUrgent ? elements.toastStackUrgent : elements.toastStack;
    if (!stack) {
      return null;
    }

    // Collapse a repeat of the message already on screen instead of stacking
    // duplicates, which is what a retry loop or a double-click produces.
    for (const existing of activeToasts) {
      if (existing.dataset.toastKey === `${toneClass}:${text}`) {
        dismissToast(existing);
        break;
      }
    }

    const toast = document.createElement("div");
    toast.className = `toast toast-${toneClass}`;
    toast.dataset.toastKey = `${toneClass}:${text}`;
    toast.setAttribute("role", isUrgent ? "alert" : "status");

    const icon = document.createElement("i");
    icon.className = `ph ${preset.icon} toast-icon`;
    icon.setAttribute("aria-hidden", "true");

    const body = document.createElement("div");
    body.className = "toast-body";

    if (title) {
      const titleNode = document.createElement("p");
      titleNode.className = "toast-title";
      titleNode.textContent = title;
      body.appendChild(titleNode);
    }

    const messageNode = document.createElement("p");
    messageNode.className = "toast-message";
    messageNode.textContent = text;
    body.appendChild(messageNode);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "toast-close";
    closeBtn.setAttribute("aria-label", "Dismiss notification");
    closeBtn.innerHTML = '<i class="ph ph-x" aria-hidden="true"></i>';
    closeBtn.addEventListener("click", () => dismissToast(toast));

    const timer = document.createElement("span");
    timer.className = "toast-timer";
    timer.setAttribute("aria-hidden", "true");
    timer.style.animationDuration = `${duration}ms`;

    toast.append(icon, body, closeBtn, timer);
    stack.appendChild(toast);
    activeToasts.add(toast);

    const timerId = window.setTimeout(() => dismissToast(toast), duration);
    toast.dataset.timerId = String(timerId);

    // Oldest first, so trimming the overflow drops the stalest message.
    while (activeToasts.size > TOAST_MAX_VISIBLE) {
      const [oldest] = activeToasts;
      dismissToast(oldest);
    }

    return toast;
  }

  // Existing call sites speak in "neutral"/"success"/"error"; keep that vocabulary
  // working rather than rewriting ninety of them by hand.
  function setStatus(message, tone = "neutral") {
    if (!message) {
      return;
    }

    notify(message, tone === "neutral" ? "info" : tone);
  }

  function resolveConfirmDialog(confirmed) {
    if (!state.confirmOpen) {
      return;
    }

    state.confirmOpen = false;
    elements.confirmModal.classList.remove("open");
    elements.confirmModal.setAttribute("aria-hidden", "true");
    exitModalLayer(elements.confirmModal);
    syncBodyLock();

    if (typeof state.confirmResolver === "function") {
      const resolver = state.confirmResolver;
      state.confirmResolver = null;
      // Every dialog but the unsaved-changes one is a yes or a no, and every
      // caller reads it as one. "alt" is the third button and only exists when a
      // caller asked for it, so it can never reach code that is not expecting it.
      resolver(confirmed === "alt" ? "alt" : Boolean(confirmed));
    }
  }

  /* A question with two answers, or three.
   *
   * "Discard your edits?" has a third honest answer — don't discard them, keep
   * them — and offering only Discard and Cancel makes the safe way out the one
   * that looks like backing away from the question. altLabel adds that third
   * button and resolves to "alt"; without it nothing about this dialog changes.
   */
  function requestConfirmation({
    title,
    message,
    confirmLabel = "Continue",
    altLabel = "",
    tone = "danger"
  }) {
    return new Promise((resolve) => {
      if (typeof state.confirmResolver === "function") {
        const previousResolver = state.confirmResolver;
        state.confirmResolver = null;
        previousResolver(false);
      }

      elements.confirmTitle.textContent = title || "Please confirm this action";
      elements.confirmMessage.textContent = message || "Are you sure you want to continue?";
      elements.confirmProceedBtn.textContent = confirmLabel || "Continue";
      elements.confirmProceedBtn.classList.remove("btn-danger", "btn-primary");

      if (tone === "primary") {
        elements.confirmProceedBtn.classList.add("btn-primary");
      } else {
        elements.confirmProceedBtn.classList.add("btn-danger");
      }

      if (elements.confirmAltBtn) {
        elements.confirmAltBtn.hidden = !altLabel;
        elements.confirmAltBtn.textContent = altLabel || "Save Changes";
      }

      state.confirmOpen = true;
      state.confirmResolver = resolve;
      elements.confirmModal.classList.add("open");
      elements.confirmModal.setAttribute("aria-hidden", "false");
    enterModalLayer(elements.confirmModal);
      syncBodyLock();
      // The keeping answer takes the focus when there is one, so Enter on a
      // dialog about unsaved work never means "throw it away".
      if (altLabel && elements.confirmAltBtn) {
        elements.confirmAltBtn.focus();
      } else {
        elements.confirmProceedBtn.focus();
      }
    });
  }

  /* The question on the way out of an editor.
   *
   * Both editors ask it and both ask it the same way, because the answer a person
   * leaving with unsaved work most often wants is "save it" — which a Discard or
   * Cancel pair does not offer at all, leaving Cancel as the only way to keep the
   * work and no way at all to keep it and still leave.
   *
   * Resolves "alt" to save and then leave, true to leave and lose the edits,
   * false to stay in the editor.
   */
  function askAboutUnsavedWork(message) {
    return requestConfirmation({
      title: "Save your changes?",
      message,
      confirmLabel: "Discard Changes",
      altLabel: "Save Changes",
      tone: "danger"
    });
  }

  global.AppNotify = {
    notify,
    setStatus,
    requestConfirmation,
    resolveConfirmDialog,
    askAboutUnsavedWork
  };
})(typeof window === "undefined" ? globalThis : window);
