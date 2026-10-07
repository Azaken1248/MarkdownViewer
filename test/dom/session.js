// Part of the DOM suite. See dom.test.js, which sets all this up and calls it.
//
// Who you are signed in as, and what the interface does when that changes
// under it.
//
// The `auth` suite covers the server: hashing, sessions, the forced change,
// what a 401 means. What nothing covered was the half of app/session.js that
// answers those — the inline refusal rather than a toast, the dialog that
// cannot be cancelled, the session that ended in another window, the sign-out
// whose own request failed. Those are the failure paths, and they are the
// ones a person meets without having done anything wrong.
//
// It runs last, because it signs out and signs in as somebody else. It leaves
// the seeded admin signed in again, which is where it found things.
const { SEED_USERNAME, TEST_PASSWORD } = require("../helpers/server.js");

const FRESH_USER = "wollstonecraft";
const FRESH_TEMPORARY = "temporary-9134";
const FRESH_CHOSEN = "chosen-by-them-9134";

module.exports = async (ctx) => {
  const { check, waitUntil, window, doc, server, cookieHeader } = ctx;

  const run = (source) => window.eval(source);
  const state = () => run("window.__t.state");
  const el = (id) => doc.getElementById(id);
  const signedIn = () => doc.body.classList.contains("is-signed-in");

  const complaints = () => [...doc.querySelectorAll("#toastStackUrgent .toast")]
    .map((one) => one.querySelector(".toast-message")?.textContent || "");
  const clearToasts = () => doc.querySelectorAll(".toast").forEach((one) => one.remove());

  const asked = [];
  const realFetch = window.fetch;
  // What the next request to a matching URL should do instead of happening.
  let sabotage = null;
  window.fetch = (url, options) => {
    asked.push(`${String(options?.method || "GET").toUpperCase()} ${String(url)}`);
    if (sabotage && String(url).includes(sabotage)) {
      sabotage = null;
      return Promise.reject(new Error("the network went away"));
    }
    return realFetch(url, options);
  };
  const watching = async (made) => {
    const from = asked.length;
    await made();
    return asked.slice(from);
  };

  /* Through the form, and answerable for having worked.
   *
   * A sign-in that does not take leaves `state.user` null, and every check
   * after it fails reading a property of null — which says nothing about why.
   * The form's own error line is the why, so it travels with the failure.
   */
  const signInAs = async (username, password, expected = true) => {
    el("loginUsername").value = username;
    el("loginPassword").value = password;
    await run("window.__t.submitLogin()");

    const got = state().authenticated;
    if (got !== expected) {
      check(`signing in as ${username} ${expected ? "works" : "is refused"}`,
        `${got} (${el("loginError").textContent || "no message"})`, String(expected));
      return false;
    }

    return true;
  };

  await run("window.__t.refreshSession()");
  clearToasts();

  console.log("=== a sign-in with nothing in it is refused before it is sent ===");
  {
    run("window.__t.openLoginModal()");
    el("loginUsername").value = "";
    el("loginPassword").value = "";

    const sent = await watching(() => run("window.__t.submitLogin()"));
    check("nothing is asked of the server",
      sent.filter((one) => one.includes("/api/auth/login")), []);
    check("...and the form says what is missing",
      el("loginError").textContent, "Enter your username and password.");
    check("...beside the field rather than over the page", complaints(), []);
    run("window.__t.closeLoginModal()");
  }

  console.log("=== a password change that does not agree with itself is too ===");
  {
    run("window.__t.openPasswordModal()");
    el("currentPassword").value = TEST_PASSWORD;
    el("newPassword").value = "one-of-them-9134";
    el("confirmPassword").value = "the-other-one-9134";

    const sent = await watching(() => run("window.__t.submitPasswordChange()"));
    check("nothing is asked", sent.filter((one) => one.includes("/api/auth/password")), []);
    check("...and it says which way they differ",
      el("passwordError").textContent, "The two new passwords do not match.");
    run("window.__t.closePasswordModal()");
  }

  // Somebody else's account, made by the admin, so that signing in as them is
  // the forced-change path rather than an ordinary sign-in.
  const madeThem = await server.request("POST", "/api/users",
    { username: FRESH_USER, password: FRESH_TEMPORARY, role: "editor" },
    { Cookie: cookieHeader(), "X-CSRF-Token": state().csrfToken });
  check("(an account exists that owes a password of its own)", madeThem.status, 201);

  console.log("=== signing out empties the page as well as the session ===");
  {
    clearToasts();
    await run("window.__t.signOut()");

    check("the session is gone", state().authenticated, false);
    check("...and the body says so, which is what gates every control", signedIn(), false);
    check("...the library is let go of rather than left on screen", state().docs, []);
    check("...nothing is open", state().activeFile, null);
    check("...and the way back in is offered", state().loginOpen, true);
  }

  console.log("=== a password the server refuses is shown in the form, not thrown ===");
  {
    clearToasts();
    await signInAs(FRESH_USER, "not-the-password", false);

    check("the form says what the server said", el("loginError").textContent.length > 0, true);
    check("...and it is not hidden", el("loginError").hidden, false);
    check("...without a toast", complaints(), []);
    check("...and nobody is signed in", state().authenticated, false);
  }

  console.log("=== an account that owes a password cannot get past the dialog ===");
  {
    clearToasts();
    const inside = await signInAs(FRESH_USER, FRESH_TEMPORARY);
    check("the sign-in worked", inside, true);
    check("...and the change is demanded straight away", state().passwordForced, true);
    check("...the dialog says why",
      el("passwordTitle").textContent, "Choose a new password");
    /* Nothing behind a forced change is usable, so there is nothing to cancel
     * to. The button is hidden and the close is refused — both, because the
     * dialog can also be closed by Escape and by the backdrop.
     */
    check("...there is no cancel", el("passwordCancelBtn").hidden, true);

    run("window.__t.closePasswordModal()");
    check("...and asking it to close does not close it",
      [state().passwordOpen, el("passwordModal").classList.contains("open")], [true, true]);

    // A refusal from the server lands in the dialog too, and leaves it open.
    el("currentPassword").value = "wrong-current-9134";
    el("newPassword").value = FRESH_CHOSEN;
    el("confirmPassword").value = FRESH_CHOSEN;
    await run("window.__t.submitPasswordChange()");
    check("a wrong current password is shown in the dialog",
      el("passwordError").textContent.length > 0, true);
    check("...which is still open", state().passwordOpen, true);

    el("currentPassword").value = FRESH_TEMPORARY;
    el("newPassword").value = FRESH_CHOSEN;
    el("confirmPassword").value = FRESH_CHOSEN;
    await run("window.__t.submitPasswordChange()");
    await waitUntil(() => state().passwordOpen === false);

    check("choosing one closes it", state().passwordOpen, false);
    check("...and the account is in", [state().authenticated, state().user.username],
      [true, FRESH_USER]);
    /* The library arrives now rather than at sign-in.
     *
     * The forced change blocked the initial load, so the page behind the
     * dialog was empty — a sign-in that ended with an empty explorer is a
     * sign-in that looks broken.
     */
    await waitUntil(() => state().docs.length > 0);
    check("...with the library it could not load before", state().docs.length > 0, true);
  }

  console.log("=== a sign-out whose own request fails still signs you out ===");
  {
    clearToasts();
    sabotage = "/api/auth/logout";
    await run("window.__t.signOut()");

    /* The cookie may already be gone, which is one of the ways the call fails.
     * Keeping the page signed in because the server could not be told is the
     * worst of both: no session, and an interface that believes there is one.
     */
    check("the local session is dropped anyway", state().authenticated, false);
    check("...and the page is gated as signed out", signedIn(), false);
    check("...with the login dialog open", state().loginOpen, true);

    /* And what the server thinks is still the truth.
     *
     * The request never arrived, so the session is alive and the cookie is
     * still being sent. Asked directly — rather than through the page, which
     * would change what the next check is about — the server still has it.
     */
    const stillThere = await server.request("GET", "/api/session", undefined,
      { Cookie: cookieHeader() });
    check("the server still has the session it was never told to end",
      stillThere.body.authenticated, true);

    /* Which is why signing in again has to work from here.
     *
     * The live cookie makes the next request an authenticated one as far as
     * the server is concerned, so the CSRF guard examines it — including the
     * sign-in. The page had just thrown that token away with the rest of the
     * session, so this was refused with "Session token missing or stale.
     * Reload and try again", and a reload was the only way back in. signOut
     * keeps the token when it could not tell the server, and submitLogin
     * sends it when it has one.
     */
    check("signing in again works without a reload",
      await signInAs(FRESH_USER, FRESH_CHOSEN), true);
    check("...and it is a session, not the old one left lying around",
      [state().authenticated, state().user.username], [true, FRESH_USER]);

    await run("window.__t.signOut()");
    check("(and a sign-out that reaches the server ends it)", state().authenticated, false);
  }

  console.log("=== a session that ended somewhere else is noticed at the next request ===");
  {
    clearToasts();
    if (!await signInAs(FRESH_USER, FRESH_CHOSEN)) {
      // Said why already. Everything below reads a session that is not there.
      return;
    }

    check("(signed in again, as the account that chose its own password)",
      state().user.username, FRESH_USER);

    // Ended in another window, or expired, or revoked by an administrator —
    // the page has no way to know until it asks for something.
    const ended = await server.request("POST", "/api/auth/logout", {},
      { Cookie: cookieHeader(), "X-CSRF-Token": state().csrfToken });
    check("(the session is over as far as the server is concerned)", ended.status, 200);

    // Any request the page makes next. This is the one the explorer makes on
    // every refresh, so it is the one a person would hit first.
    let refused = null;
    try {
      await run('window.__t.requestJson("/api/docs", { cache: "no-store" })');
    } catch (error) {
      refused = error;
    }
    check("the request is refused", Boolean(refused), true);
    /* And the refusal says which one it was.
     *
     * Every other refusal carries its status; these two did not, because they
     * were thrown before the branch that attaches it. Background work needs
     * the difference: hydration walks the whole library to warm the search,
     * and one sign-out halfway through used to write "Sign in to continue."
     * to the console once per document — twenty-eight times, which is how a
     * real error gets buried. The empty console at the end of this suite is
     * the other half of this check.
     */
    check("...carrying the status, so background work can tell what happened",
      refused.status, 401);
    check("...and the page stops believing it is signed in", state().authenticated, false);
    check("...which is what gates the controls", signedIn(), false);
  }

  console.log("=== and the seeded admin signs back in ===");
  {
    clearToasts();
    if (!await signInAs(SEED_USERNAME, TEST_PASSWORD)) {
      return;
    }

    check("signed in", state().user.username, SEED_USERNAME);
    check("...as an admin", state().user.role, "admin");
    check("...with the page gated for one", signedIn(), true);
    await waitUntil(() => state().docs.length > 0);
    check("...and the library back", state().docs.length > 0, true);

    const them = state().user.id;
    const gone = await server.request("GET", "/api/users", undefined, { Cookie: cookieHeader() });
    const fresh = gone.body.users.find((one) => one.username === FRESH_USER);
    await server.request("DELETE", `/api/users/${fresh.id}`, undefined,
      { Cookie: cookieHeader(), "X-CSRF-Token": state().csrfToken });
    check("(the borrowed account is cleaned up, and it was not this one)",
      fresh.id === them, false);
  }

  clearToasts();
};
