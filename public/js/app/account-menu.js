/* The account button and everything that drops out of it.
 *
 * Signing in and out, changing a password, managing users and sharing a
 * document are four different modules; what they have in common is that this
 * one menu is how anyone reaches them. The wiring is here, and the work is
 * next door in AppSession, AppUsers and AppShare.
 */
(function (global) {

const { elements } = global.AppDom;
const { state } = global.AppState;
const { notify } = global.AppNotify;
const { openShareModal, closeShareModal, createShareLink, revokeShareLink } = global.AppShare;
const {
  openLoginModal, submitLogin, signOut,
  openPasswordModal, closePasswordModal, submitPasswordChange
} = global.AppSession;
const { openUsersModal, closeUsersModal, submitNewUser } = global.AppUsers;

function setAccountMenuOpen(open) {
  elements.accountMenu.hidden = !open;
  elements.accountBtn.setAttribute("aria-expanded", open ? "true" : "false");

  if (open) {
    elements.accountIdentity.textContent = state.user
      ? `${state.user.username} · ${state.user.role}`
      : "";
    elements.accountMenu.querySelector(".account-item:not([hidden])")?.focus();
  }
}

function bindAccountMenu() {
  elements.accountBtn.addEventListener("click", (event) => {
    event.stopPropagation();

    if (!state.authenticated) {
      openLoginModal();
      return;
    }

    setAccountMenuOpen(elements.accountMenu.hidden);
  });

  document.addEventListener("click", (event) => {
    if (elements.accountMenu.hidden) {
      return;
    }

    if (!elements.accountMenu.contains(event.target) && !elements.accountBtn.contains(event.target)) {
      setAccountMenuOpen(false);
    }
  });

  elements.changePasswordItem.addEventListener("click", () => {
    setAccountMenuOpen(false);
    openPasswordModal();
  });

  elements.manageUsersItem.addEventListener("click", () => {
    setAccountMenuOpen(false);
    void openUsersModal();
  });

  elements.signOutItem.addEventListener("click", () => {
    setAccountMenuOpen(false);
    void signOut();
  });

  // -- login ------------------------------------------------------------------

  elements.loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitLogin();
  });

  // -- password ---------------------------------------------------------------

  elements.passwordForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitPasswordChange();
  });

  elements.passwordCancelBtn.addEventListener("click", () => {
    closePasswordModal();
  });

  elements.passwordBackdrop.addEventListener("click", () => {
    closePasswordModal();
  });

  // -- users ------------------------------------------------------------------

  // -- sharing ----------------------------------------------------------------

  elements.shareDocBtn.addEventListener("click", () => {
    if (state.activeFile) {
      openShareModal(state.activeFile);
    }
  });

  elements.shareCloseBtn.addEventListener("click", () => {
    closeShareModal();
  });

  elements.shareBackdrop.addEventListener("click", () => {
    closeShareModal();
  });

  elements.createShareBtn.addEventListener("click", () => {
    void createShareLink();
  });

  elements.revokeShareBtn.addEventListener("click", () => {
    void revokeShareLink();
  });

  elements.copyShareUrlBtn.addEventListener("click", async () => {
    elements.shareUrlInput.select();

    try {
      await MarkdownCore.copyText(elements.shareUrlInput.value);
      notify("Share link copied.", "success");
    } catch {
      // Both clipboard paths were refused; the text is already selected, so
      // Ctrl+C still works.
      notify("Press Ctrl+C to copy the selected link.", "info");
    }
  });

  elements.closeUsersBtn.addEventListener("click", () => {
    closeUsersModal();
  });

  elements.usersBackdrop.addEventListener("click", () => {
    closeUsersModal();
  });

  elements.newUserForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitNewUser();
  });
}

global.AppAccountMenu = { setAccountMenuOpen, bindAccountMenu };

})(typeof window === "undefined" ? globalThis : window);
