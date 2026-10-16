// Part of the DOM suite. See dom.test.js, which sets all this up and calls it.
//
// The account button and everything that drops out of it.
//
// Signing in and out, changing a password, managing users and sharing a
// document are four modules with suites of their own, every one of them
// driven by calling into the module. The menu that is how a person actually
// reaches them had never been clicked: none of app/account-menu.js ran, so
// an item wired to the wrong function, or to nothing, would have been found
// by somebody using the app rather than by this suite.
const { SEED_USERNAME, TEST_PASSWORD } = require("../helpers/server.js");

module.exports = async (ctx) => {
  const { check, waitUntil, window, doc, server, clipboardWrites } = ctx;

  const run = (source) => window.eval(source);
  const state = () => run("window.__t.state");
  const el = (id) => doc.getElementById(id);
  const said = () => [...doc.querySelectorAll("#toastStack .toast, #toastStackUrgent .toast")]
    .map((one) => one.querySelector(".toast-message")?.textContent || "");
  const clearToasts = () => doc.querySelectorAll(".toast").forEach((one) => one.remove());
  const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

  const press = (id) => el(id).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const clickOn = (node) => node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const submit = (id) => {
    const event = new window.Event("submit", { bubbles: true, cancelable: true });
    el(id).dispatchEvent(event);
    return event;
  };
  const menuOpen = () => !el("accountMenu").hidden;

  console.log("=== the account button ===");
  {
    check("(the seeded admin is the one signed in)", state().user.username, SEED_USERNAME);

    press("accountBtn");
    check("pressing it drops the menu down", menuOpen(), true);
    check("...and says so to anything reading the page",
      el("accountBtn").getAttribute("aria-expanded"), "true");
    /* Who you are signed in as, which is the question the menu is opened to
     * answer at least as often as it is opened to do something.
     */
    check("...with the account it belongs to named in it",
      el("accountIdentity").textContent, `${SEED_USERNAME} · admin`);
    check("...and the first thing in it holding the focus, for the keyboard",
      doc.activeElement, el("accountMenu").querySelector(".account-item:not([hidden])"));

    press("accountBtn");
    check("pressing it again puts the menu away",
      [menuOpen(), el("accountBtn").getAttribute("aria-expanded")], [false, "false"]);

    press("accountBtn");
    clickOn(el("accountIdentity"));
    check("a click inside the menu leaves it open", menuOpen(), true);
    clickOn(doc.getElementById("docContent"));
    check("...and a click anywhere else closes it", menuOpen(), false);

    // With the menu already closed, a click in the page is nobody's business.
    clickOn(doc.getElementById("docContent"));
    check("...which it does not have to do twice", menuOpen(), false);
  }

  console.log("=== the three things it offers ===");
  {
    press("accountBtn");
    press("changePasswordItem");
    check("Change password opens the dialog and puts the menu away",
      [state().passwordOpen, menuOpen()], [true, false]);
    press("passwordCancelBtn");
    await settle();
    check("...Cancel closes it", state().passwordOpen, false);

    press("accountBtn");
    press("changePasswordItem");
    await waitUntil(() => state().passwordOpen, 3000);
    press("passwordBackdrop");
    await settle();
    check("...and so does clicking away from it", state().passwordOpen, false);

    press("accountBtn");
    press("manageUsersItem");
    await waitUntil(() => el("usersModal").classList.contains("open"), 4000);
    check("Manage users opens the list, and puts the menu away",
      [el("usersModal").classList.contains("open"), menuOpen()], [true, false]);
    check("...with the accounts in it",
      doc.querySelectorAll("#usersTableBody tr").length > 0, true);

    press("closeUsersBtn");
    await settle();
    check("...its close button closes it", el("usersModal").classList.contains("open"), false);

    press("accountBtn");
    press("manageUsersItem");
    await waitUntil(() => el("usersModal").classList.contains("open"), 4000);
    press("usersBackdrop");
    await settle();
    check("...and so does clicking away", el("usersModal").classList.contains("open"), false);
  }

  console.log("=== the forms, which are three different submits ===");
  {
    // Every one of these is a form, so every one of them would reload the
    // page if its submit were not taken off the browser.
    press("accountBtn");
    press("manageUsersItem");
    await waitUntil(() => el("usersModal").classList.contains("open"), 4000);

    el("newUserName").value = "";
    el("newUserPassword").value = "";
    clearToasts();
    check("submitting the new-user form does not reload the page",
      submit("newUserForm").defaultPrevented, true);
    await waitUntil(() => said().length > 0 || !el("newUserError").hidden, 4000);
    /* An empty one is refused, which is the point: the submit reached the
     * module rather than the browser's navigation.
     */
    check("...it sends the form instead",
      [said().length > 0, el("newUserError").hidden === false].includes(true), true);
    press("closeUsersBtn");
    await settle();

    press("accountBtn");
    press("changePasswordItem");
    await waitUntil(() => state().passwordOpen, 3000);
    el("currentPassword").value = "";
    el("newPassword").value = "";
    el("confirmPassword").value = "";
    check("...nor does the password form", submit("passwordForm").defaultPrevented, true);
    await waitUntil(() => el("passwordError").textContent.length > 0, 4000);
    check("...which answers in its own error line",
      el("passwordError").textContent.length > 0, true);
    press("passwordCancelBtn");
    await settle();
  }

  console.log("=== the share dialog, reached from the button ===");
  {
    const docs = state().docs;
    check("(there is a document to share)", docs.length > 0, true);
    await run(`window.__t.openDocument(${JSON.stringify(docs[0].file)}, false)`);
    await waitUntil(() => state().activeFile === docs[0].file, 4000);

    press("shareDocBtn");
    await waitUntil(() => el("shareModal").classList.contains("open"), 4000);
    check("the share button opens the dialog on the open document",
      [el("shareModal").classList.contains("open"), state().shareFile], [true, docs[0].file]);

    press("shareCloseBtn");
    await settle();
    check("...its close button closes it", el("shareModal").classList.contains("open"), false);

    press("shareDocBtn");
    await waitUntil(() => el("shareModal").classList.contains("open"), 4000);
    press("shareBackdrop");
    await settle();
    check("...and so does clicking away", el("shareModal").classList.contains("open"), false);

    // Nothing open is nothing to share, and the button says nothing rather
    // than opening a dialog about no document.
    const open = state().activeFile;
    run("window.__t.state.activeFile = null");
    press("shareDocBtn");
    await settle();
    check("with nothing open the button does nothing",
      el("shareModal").classList.contains("open"), false);
    run(`window.__t.state.activeFile = ${JSON.stringify(open)}`);
  }

  console.log("=== and the four controls inside it ===");
  {
    press("shareDocBtn");
    await waitUntil(() => el("shareModal").classList.contains("open"), 4000);

    clearToasts();
    press("createShareBtn");
    await waitUntil(() => el("shareUrlInput").value.length > 0, 6000);
    /* The link is built on the address the deployment is configured with,
     * which is not this test server - the token at the end of it is the part
     * that has to be real.
     */
    check("Create makes a link", /\/s\/[A-Za-z0-9_-]{20,}$/.test(el("shareUrlInput").value), true);

    /* The toggle is the difference between "read it" and "take a copy away",
     * and it is sent as it is flipped rather than on a save button.
     */
    const toggle = el("shareExportToggle");
    clearToasts();
    toggle.checked = true;
    toggle.dispatchEvent(new window.Event("change", { bubbles: true }));
    await waitUntil(() => said().some((one) => /can now export/i.test(one)), 6000);
    /* Read back through the link itself, which is the only thing that cares:
     * the shared page asks what it may offer rather than assuming.
     */
    const token = el("shareUrlInput").value.split("/s/")[1];
    const asVisitor = async () => (await server.request("GET", `/api/share/${token}`)).body;
    check("the export toggle is sent as it is flipped",
      (await asVisitor()).allowExport, true);

    clearToasts();
    toggle.checked = false;
    toggle.dispatchEvent(new window.Event("change", { bubbles: true }));
    await waitUntil(() => said().some((one) => /Exporting from the link is off/i.test(one)), 6000);
    check("...and taken away the same way", (await asVisitor()).allowExport, false);

    // jsdom has no clipboard, so the suite's stand-in writes down what was
    // copied. The link is selected either way, so Ctrl+C works when it fails.
    clipboardWrites.length = 0;
    clearToasts();
    const link = el("shareUrlInput").value;
    press("copyShareUrlBtn");
    await waitUntil(() => said().length > 0, 4000);
    check("Copy copies the link", clipboardWrites.at(-1), link);
    check("...and says it did", said().at(-1), "Share link copied.");

    // Put aside inside the window, since the stand-in has to live there too.
    run(`window.__realCopy = window.MarkdownCore.copyText;
      window.MarkdownCore.copyText = () => Promise.reject(new Error("refused"));`);
    clearToasts();
    press("copyShareUrlBtn");
    await waitUntil(() => said().length > 0, 4000);
    check("a clipboard that refuses says what to press instead",
      said().at(-1), "Press Ctrl+C to copy the selected link.");
    run("window.MarkdownCore.copyText = window.__realCopy; delete window.__realCopy;");

    clearToasts();
    press("revokeShareBtn");
    await waitUntil(() => state().confirmOpen || said().length > 0, 4000);
    if (state().confirmOpen) {
      run("window.__t.resolveConfirmDialog(true)");
    }
    await waitUntil(() => said().some((one) => /revok/i.test(one)), 6000);
    check("Revoke takes the link away",
      (await server.request("GET", `/api/share/${token}`)).status, 404);

    press("shareCloseBtn");
    await settle();
  }

  console.log("=== and the way out ===");
  {
    press("accountBtn");
    press("signOutItem");
    await waitUntil(() => state().authenticated === false, 6000);
    check("Sign out signs out, and puts the menu away",
      [state().authenticated, menuOpen()], [false, false]);

    // Signed out, the button is the way back in rather than a menu.
    press("accountBtn");
    check("...after which the button offers the sign-in dialog instead",
      [state().loginOpen, menuOpen()], [true, false]);

    el("loginUsername").value = SEED_USERNAME;
    el("loginPassword").value = TEST_PASSWORD;
    check("the sign-in form does not reload the page either",
      submit("loginForm").defaultPrevented, true);
    await waitUntil(() => state().authenticated, 8000);
    check("...and signs back in", state().user.username, SEED_USERNAME);
    await waitUntil(() => state().docs.length > 0, 8000);
  }
};
