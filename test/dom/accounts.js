// Part of the DOM suite. See dom.test.js, which sets all this up and calls it.
//
// The accounts dialog: the most privileged surface in the client, and the one
// with the least of it exercised.
//
// The `auth` suite covers the server thoroughly — who may call these routes,
// what the store refuses, the last-admin guard. None of that says what an
// administrator is *shown*, or what the interface does when the server says
// no. Four fifths of app/users.js was the second thing, which is where a
// mistake costs somebody their account.
module.exports = async (ctx) => {
  const { check, waitUntil, window, doc, server, cookieHeader } = ctx;

  const run = (source) => window.eval(source);
  const state = () => run("window.__t.state");
  const el = (id) => doc.getElementById(id);

  const complaints = () => [...doc.querySelectorAll("#toastStackUrgent .toast")]
    .map((one) => one.querySelector(".toast-message")?.textContent || "");
  const cheers = () => [...doc.querySelectorAll("#toastStack .toast")]
    .map((one) => one.querySelector(".toast-message")?.textContent || "");
  const clearToasts = () => doc.querySelectorAll(".toast").forEach((one) => one.remove());

  // Counted, because several of these are about a request that must not be
  // made: a cancelled prompt and a declined confirmation both have to leave
  // the server untouched, and from the outside that looks like nothing.
  const asked = [];
  const realFetch = window.fetch;
  window.fetch = (url, options) => {
    asked.push(`${String(options?.method || "GET").toUpperCase()} ${String(url)}`);
    return realFetch(url, options);
  };
  const watching = async (made) => {
    const from = asked.length;
    await made();
    return asked.slice(from);
  };

  // A row by the name in its first cell, read back off the table rather than
  // held, because every one of these actions rebuilds it.
  const rowFor = (username) => [...doc.querySelectorAll("#usersTableBody tr")]
    .find((tr) => tr.querySelector(".users-cell-name")?.textContent.startsWith(username));
  const cells = (tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent.trim());
  const buttons = (tr) => [...tr.querySelectorAll(".users-actions button")].map((one) => one.textContent);

  await run("window.__t.refreshSession()");
  clearToasts();

  console.log("=== the accounts dialog lists who there is ===");
  await run("window.__t.openUsersModal()");
  await waitUntil(() => doc.querySelectorAll("#usersTableBody tr").length > 0);

  const me = state().user.username;
  check("the dialog is open", el("usersModal").classList.contains("open"), true);
  check("...with the signed-in admin in it", Boolean(rowFor(me)), true);

  console.log("=== you cannot take your own account away from yourself ===");
  {
    const mine = rowFor(me);
    check("your own row says which one it is",
      Boolean(mine.querySelector(".users-self")), true);
    /* Disabled rather than absent, so the role is still readable.
     *
     * Changing your own role is the one-click route to locking yourself out,
     * and the server refuses it too — these two have to agree, because a
     * control the server will refuse is a control that should not be offered.
     */
    check("...its role cannot be changed here", mine.querySelector(".users-role").disabled, true);
    check("...and it offers no way to disable or delete it", buttons(mine), ["Reset password"]);

    const refused = await server.request("PATCH", `/api/users/${state().user.id}`,
      { role: "viewer" }, { Cookie: cookieHeader(), "X-CSRF-Token": state().csrfToken });
    check("...which is what the server would have said anyway", refused.status, 400);
  }

  console.log("=== a new account the server will not take says so in the form ===");
  {
    clearToasts();
    el("newUserName").value = "shorty";
    el("newUserPassword").value = "abc";
    el("newUserRole").value = "viewer";
    el("newUserDetails").open = true;

    await run("window.__t.submitNewUser()");

    /* Inline, not a toast.
     *
     * The message belongs next to the field that caused it, and a toast over
     * a form that is still open is a message you have to remember rather than
     * read. The toast paths in this module are for the table, where there is
     * no field to point at.
     */
    check("the reason is beside the form", el("newUserError").hidden, false);
    check("...and says something", el("newUserError").textContent.length > 0, true);
    check("...without a toast as well", complaints(), []);
    check("the form keeps what was typed", el("newUserName").value, "shorty");
    check("...and stays open", el("newUserDetails").open, true);
  }

  console.log("=== one it will take appears in the table ===");
  {
    clearToasts();
    el("newUserName").value = "rosalind";
    el("newUserPassword").value = "temporary-9134";
    el("newUserRole").value = "editor";

    await run("window.__t.submitNewUser()");
    await waitUntil(() => Boolean(rowFor("rosalind")));

    const row = rowFor("rosalind");
    check("the new account is listed", cells(row)[0], "rosalind");
    check("...as an editor", row.querySelector(".users-role").value, "editor");
    /* The status the account is actually in.
     *
     * A password somebody else chose is not a password, so the account is in
     * the forced-change state from the moment it is made — and the table says
     * so rather than calling it Active.
     */
    check("...owing a password of its own", cells(row)[2], "Must set password");
    check("...and never having signed in", cells(row)[3], "Never");
    check("the form is emptied for the next one",
      [el("newUserName").value, el("newUserPassword").value], ["", ""]);
    check("...and folded away", el("newUserDetails").open, false);
    check("...with a word about what happened",
      cheers().some((one) => one.includes("rosalind")), true);
  }

  console.log("=== somebody else's row offers the two destructive things ===");
  {
    const row = rowFor("rosalind");
    check("disable and delete are both there", buttons(row),
      ["Reset password", "Disable", "Delete"]);

    row.querySelectorAll(".users-actions button")[1]
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitUntil(() => cells(rowFor("rosalind"))[2] === "Disabled");

    check("disabling it says so", cells(rowFor("rosalind"))[2], "Disabled");
    check("...and the button becomes the way back", buttons(rowFor("rosalind"))[1], "Enable");

    rowFor("rosalind").querySelectorAll(".users-actions button")[1]
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitUntil(() => cells(rowFor("rosalind"))[2] !== "Disabled");
    check("...and pressing it brings the account back", cells(rowFor("rosalind"))[2], "Must set password");
  }

  console.log("=== a prompt nobody answered asks the server nothing ===");
  {
    clearToasts();
    // What the prompt will answer, rather than a prompt swapped in and out: a
    // function installed once and told what to say is a function this file can
    // put back without racing its own awaits.
    let answer = null;
    const realPrompt = window.prompt;
    window.prompt = () => answer;

    // Whose account it is does not matter here: the point is that nothing
    // leaves the page, so there is nothing for an id to be wrong about.
    const them = state().users.find((one) => one.username === "rosalind");
    const afterCancel = await watching(() =>
      run(`window.__t.resetUserPassword(${JSON.stringify({ id: them.id, username: them.username })})`));
    check("cancelling the prompt sends nothing",
      afterCancel.filter((one) => one.includes("/password")), []);

    // And answered, it does.
    answer = "another-temporary-9134";
    const afterAnswer = await watching(() =>
      run(`window.__t.resetUserPassword(${JSON.stringify({ id: them.id, username: them.username })})`));
    check("answering it does", afterAnswer.filter((one) => one.includes("/password")).length, 1);
    check("...and says whose sessions ended",
      cheers().some((one) => one.includes("rosalind")), true);

    answer = null;
    // Put back, so nothing after this file sees a prompt that always answers.
    Object.assign(window, { prompt: realPrompt });
  }

  console.log("=== a confirmation that was declined deletes nobody ===");
  {
    clearToasts();
    const target = state().users.find((one) => one.username === "rosalind");
    const from = asked.length;

    const asking = run(`window.__t.deleteUser(${JSON.stringify({ id: target.id, username: target.username })})`);
    await waitUntil(() => state().confirmOpen === true);
    check("it asks first", el("confirmModal").classList.contains("open"), true);

    run("window.__t.resolveConfirmDialog(false)");
    await asking;

    check("saying no sends nothing",
      asked.slice(from).filter((one) => one.startsWith("DELETE")), []);
    check("...and the account is still there", Boolean(rowFor("rosalind")), true);
  }

  console.log("=== and one that was accepted deletes them ===");
  {
    clearToasts();
    const target = state().users.find((one) => one.username === "rosalind");

    const asking = run(`window.__t.deleteUser(${JSON.stringify({ id: target.id, username: target.username })})`);
    await waitUntil(() => state().confirmOpen === true);
    run("window.__t.resolveConfirmDialog(true)");
    await asking;
    await waitUntil(() => !rowFor("rosalind"));

    check("the row is gone", Boolean(rowFor("rosalind")), false);
    check("...and so is the account", state().users.some((one) => one.username === "rosalind"), false);
  }

  console.log("=== a table that has gone stale corrects itself rather than lying ===");
  {
    clearToasts();
    el("newUserName").value = "ghost";
    el("newUserPassword").value = "temporary-9134";
    el("newUserRole").value = "viewer";
    await run("window.__t.submitNewUser()");
    await waitUntil(() => Boolean(rowFor("ghost")));

    // Deleted by somebody else, in another window, while this table is open —
    // which is the ordinary way a list of accounts goes out of date.
    const target = state().users.find((one) => one.username === "ghost");
    await server.request("DELETE", `/api/users/${target.id}`, undefined,
      { Cookie: cookieHeader(), "X-CSRF-Token": state().csrfToken });

    const select = rowFor("ghost").querySelector(".users-role");
    select.value = "admin";
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
    await waitUntil(() => complaints().length > 0);

    check("the refusal reaches the screen", complaints()[0].length > 0, true);
    /* And the table is read again rather than left showing the change.
     *
     * The select still held "admin" when the request came back; a list that
     * keeps an edit the server refused is a list that says somebody is an
     * administrator when they are not.
     */
    await waitUntil(() => !rowFor("ghost"));
    check("...and the row that is no longer real is gone", Boolean(rowFor("ghost")), false);
  }

  run("window.__t.closeUsersModal()");
  check("the dialog closes", el("usersModal").classList.contains("open"), false);
  clearToasts();
};
