/* Who you are signed in as.
 *
 * One place decides what the session means for the interface, so a role change
 * or a sign-out cannot leave half the controls in the wrong state, and the two
 * dialogs that change it — sign in, change password — sit next to that
 * decision rather than each keeping their own idea of it.
 *
 * This is also where the two signals api.js raises are answered: a request
 * that comes back 401 or 403 has discovered something about the session, and
 * this module is what owns the consequence.
 */

(function (global) {
  const { elements } = global.AppDom;
  const { updateActiveDocUI } = global.AppViewerHeader;
  const { state } = global.AppState;
  const { requestJson, can, onSessionSignal } = global.AppApi;
  const { enterModalLayer, exitModalLayer } = global.AppModal;
  const { syncBodyLock } = global.AppShell;
  const { notify } = global.AppNotify;

  /* The answers to the two signals api.js raises, given by the parts that own
   * what has to change: the session state here, the forced password dialog
   * further down.
   */
  onSessionSignal({
    ended() {
      applySession({ authenticated: false, user: null, permissions: [], csrfToken: null });
    },
    passwordChangeRequired() {
      state.mustChangePassword = true;
      openPasswordModal({ forced: true });
    }
  });

  // One place decides what the session means for the UI, so a role change or a
  // sign-out cannot leave half the controls in the wrong state.
  function applySession(payload) {
    state.authenticated = Boolean(payload?.authenticated);
    state.user = payload?.user || null;
    state.permissions = Array.isArray(payload?.permissions) ? payload.permissions : [];
    state.csrfToken = payload?.csrfToken || "";
    state.publicReads = Boolean(payload?.publicReads);
    state.canWrite = can("doc:write");
    state.mustChangePassword = Boolean(payload?.user?.mustChangePassword);

    syncAccountUI();
  }

  function syncAccountUI() {
    const signedIn = state.authenticated;

    if (elements.accountBtn) {
      const icon = elements.accountBtn.querySelector("i");
      if (icon) {
        icon.className = signedIn ? "ph ph-user-circle" : "ph ph-sign-in";
      }

      const label = signedIn
        ? `Signed in as ${state.user.username} (${state.user.role}). Account menu`
        : "Sign in";
      elements.accountBtn.setAttribute("aria-label", label);
      elements.accountBtn.title = label;
      delete elements.accountBtn.dataset.tip;
    }

    document.body.classList.toggle("is-signed-in", signedIn);
    document.body.classList.toggle("can-write", can("doc:write"));

    // Re-render the tree so row actions match the new role, then re-apply the
    // toolbar gate for whatever document is open.
    App.renderDocList();
    updateActiveDocUI(state.activeFile);
  }

  async function refreshSession() {
    try {
      const payload = await requestJson("/api/session", { cache: "no-store" });
      applySession(payload);
      return payload;
    } catch {
      applySession({ authenticated: false, user: null, permissions: [], csrfToken: null });
      return null;
    }
  }

  /* --------------------------------------------------------------------------
     Login, password change and account management
     -------------------------------------------------------------------------- */

  function showFieldError(element, message) {
    if (!element) {
      return;
    }

    element.textContent = message || "";
    element.hidden = !message;
  }

  function openLoginModal() {
    state.loginOpen = true;
    showFieldError(elements.loginError, "");
    elements.loginPassword.value = "";

    elements.loginModal.classList.add("open");
    elements.loginModal.setAttribute("aria-hidden", "false");
    enterModalLayer(elements.loginModal);
    syncBodyLock();

    window.requestAnimationFrame(() => {
      (elements.loginUsername.value ? elements.loginPassword : elements.loginUsername).focus();
    });
  }

  function closeLoginModal() {
    state.loginOpen = false;
    elements.loginPassword.value = "";
    elements.loginModal.classList.remove("open");
    elements.loginModal.setAttribute("aria-hidden", "true");
    exitModalLayer(elements.loginModal);
    syncBodyLock();
  }

  async function submitLogin() {
    const username = String(elements.loginUsername.value || "").trim();
    const password = String(elements.loginPassword.value || "");

    if (!username || !password) {
      showFieldError(elements.loginError, "Enter your username and password.");
      return;
    }

    elements.loginSubmitBtn.disabled = true;
    showFieldError(elements.loginError, "");

    try {
      // Not requestJson: a failed sign-in is an expected outcome to show inline,
      // not an exception to toast, and there is no session to invalidate yet.
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        showFieldError(elements.loginError, payload?.error || "Sign-in failed.");
        elements.loginPassword.select();
        return;
      }

      applySession(payload);
      closeLoginModal();

      if (state.mustChangePassword) {
        notify("Set a new password to continue.", "warning");
        openPasswordModal({ forced: true });
        return;
      }

      notify(`Signed in as ${payload.user.username}.`, "success");
      await App.refreshDocs({ preserveSearch: false });
    } catch (error) {
      showFieldError(elements.loginError, error.message || "Sign-in failed.");
    } finally {
      // eslint-disable-next-line require-atomic-updates
      elements.loginSubmitBtn.disabled = false;
    }
  }

  async function signOut() {
    try {
      await requestJson("/api/auth/logout", { method: "POST" });
    } catch {
      // Even if the call fails, drop local state — the cookie may already be gone.
    }

    applySession({ authenticated: false, user: null, permissions: [], csrfToken: null });
    state.docs = [];
    state.filteredDocs = [];
    state.activeFile = null;
    App.renderDocList();
    updateActiveDocUI(null);
    notify("Signed out.", "neutral");
    openLoginModal();
  }

  function openPasswordModal({ forced = false } = {}) {
    if (state.passwordOpen) {
      return;
    }

    state.passwordOpen = true;
    state.passwordForced = forced;

    elements.currentPassword.value = "";
    elements.newPassword.value = "";
    elements.confirmPassword.value = "";
    elements.passwordUsername.value = state.user?.username || "";
    showFieldError(elements.passwordError, "");

    elements.passwordTitle.textContent = forced ? "Choose a new password" : "Change your password";
    elements.passwordMessage.textContent = forced
      ? "This account is using a password someone else set. Choose your own before continuing."
      : "Changing your password signs out every other session on your account.";
    // Nothing behind a forced change is usable, so there is nothing to cancel to.
    elements.passwordCancelBtn.hidden = forced;

    elements.passwordModal.classList.add("open");
    elements.passwordModal.setAttribute("aria-hidden", "false");
    enterModalLayer(elements.passwordModal);
    syncBodyLock();
    window.requestAnimationFrame(() => elements.currentPassword.focus());
  }

  function closePasswordModal() {
    if (state.passwordForced) {
      return;
    }

    state.passwordOpen = false;
    elements.currentPassword.value = "";
    elements.newPassword.value = "";
    elements.confirmPassword.value = "";
    elements.passwordModal.classList.remove("open");
    elements.passwordModal.setAttribute("aria-hidden", "true");
    exitModalLayer(elements.passwordModal);
    syncBodyLock();
  }

  async function submitPasswordChange() {
    const currentPassword = String(elements.currentPassword.value || "");
    const newPassword = String(elements.newPassword.value || "");
    const confirmPassword = String(elements.confirmPassword.value || "");

    if (newPassword !== confirmPassword) {
      showFieldError(elements.passwordError, "The two new passwords do not match.");
      elements.confirmPassword.select();
      return;
    }

    showFieldError(elements.passwordError, "");

    try {
      const payload = await requestJson("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword })
      });

      applySession(payload);
      state.passwordForced = false;
      closePasswordModal();
      notify("Password changed. Other sessions were signed out.", "success");

      // A forced change blocked the initial load, so the library is still empty.
      if (state.docs.length === 0) {
        await App.refreshDocs({ preserveSearch: false });
      }
    } catch (error) {
      showFieldError(elements.passwordError, error.message);
    }
  }

  global.AppSession = {
    applySession,
    syncAccountUI,
    refreshSession,
    showFieldError,
    openLoginModal,
    closeLoginModal,
    submitLogin,
    signOut,
    openPasswordModal,
    closePasswordModal,
    submitPasswordChange
  };
})(typeof window === "undefined" ? globalThis : window);
