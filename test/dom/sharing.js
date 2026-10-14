// Part of the DOM suite. See dom.test.js, which sets all this up and calls it.
//
// Share links: the dialog, the rotation, the revoke, and the one switch in it.
//
// A share link publishes one document at an unguessable URL. The token is the
// credential, so the server stores only its hash and hands back the full URL
// exactly once — which is the whole reason the dialog is shaped the way it is,
// and none of that shape was held by anything. What the server does with a
// share is covered thoroughly by `auth`; this is the side a person sees.
module.exports = async (ctx) => {
  const { check, waitUntil, window, doc } = ctx;

  const run = (source) => window.eval(source);
  const state = () => run("window.__t.state");
  const el = (id) => doc.getElementById(id);

  const cheers = () => [...doc.querySelectorAll("#toastStack .toast")]
    .map((one) => one.querySelector(".toast-message")?.textContent || "");
  const complaints = () => [...doc.querySelectorAll("#toastStackUrgent .toast")]
    .map((one) => one.querySelector(".toast-message")?.textContent || "");
  const clearToasts = () => doc.querySelectorAll(".toast").forEach((one) => one.remove());

  // The dialog asks before it replaces or revokes a link, and the answer is
  // the page's own confirm dialog rather than the browser's.
  const answer = async (yes) => {
    await waitUntil(() => state().confirmOpen);
    run(`window.__t.resolveConfirmDialog(${yes})`);
  };

  const file = state().docs[0].file;

  console.log("=== a document that is not shared ===");
  {
    clearToasts();
    run(`window.__t.openShareModal(${JSON.stringify(file)})`);

    check("the dialog opens on the document it was asked about",
      [state().shareOpen, state().shareFile], [true, file]);
    check("...saying it is private", el("shareStatus").textContent.includes("is private"), true);
    check("...and naming it", el("shareStatus").textContent.includes(file), true);
    check("...offering to make a link rather than to replace one",
      el("createShareBtn").textContent, "Create link");
    // Nothing to revoke, and nothing to permit until there is a link to permit
    // it on.
    check("...with nothing to revoke", el("revokeShareBtn").hidden, true);
    check("...and no switch for what a link may do",
      el("shareExportField").hidden, true);
  }

  console.log("=== and the link it is given ===");
  {
    await run("window.__t.createShareLink()");

    check("a link is made", state().shares.has(file), true);
    /* Shown once, because the server keeps only the hash of the token and
     * cannot show it again — which is what the hint beside it says.
     */
    check("...and shown", [el("shareUrlField").hidden, el("shareUrlInput").value.includes("/s/")],
      [false, true]);
    check("...with the warning that this is the only time it will be",
      el("shareOnceHint").hidden, false);
    check("...and the reader is told it worked", cheers().includes("Share link created."), true);

    check("the dialog now says the document is shared",
      el("shareStatus").textContent.includes("is shared publicly"), true);
    check("...and that nobody has opened it", el("shareStatus").textContent.includes("Not opened yet."), true);
    check("...offering to replace the link rather than make one",
      el("createShareBtn").textContent, "Replace link");
    check("...and to revoke it", el("revokeShareBtn").hidden, false);

    /* The button in the viewer carries it too, so whether the document on
     * screen is published can be seen without opening the dialog at all.
     */
    run(`window.__t.state.activeFile = ${JSON.stringify(file)}`);
    run("window.__t.updateShareButton()");
    check("the button on the page says the open document is published",
      [el("shareDocBtn").classList.contains("active"),
        el("shareDocBtn").getAttribute("aria-label")],
      [true, "Shared publicly - manage link"]);
  }

  console.log("=== replacing it, which is what sharing an already-shared document is ===");
  {
    clearToasts();
    const was = el("shareUrlInput").value;

    /* Asked first, because the current link stops working immediately —
     * anybody still using it gets a page saying it is not valid, and that is
     * not something to do to somebody by accident.
     */
    const refused = run("window.__t.createShareLink()");
    await answer(false);
    await refused;
    check("replacing a link asks first", el("shareUrlInput").value, was);
    check("...and a no leaves the link alone", cheers(), []);

    const replacing = run("window.__t.createShareLink()");
    await answer(true);
    await replacing;
    check("...while a yes replaces it", el("shareUrlInput").value === was, false);
    // Said differently, because the reader has an old link somewhere that has
    // just stopped working.
    check("...and says the old one has stopped working",
      cheers().some((one) => one.includes("no longer works")), true);
  }

  console.log("=== what a link is allowed to do ===");
  {
    clearToasts();
    check("a shared document offers the switch", el("shareExportField").hidden, false);
    check("...off to begin with", el("shareExportToggle").checked, false);

    /* Saved as it is switched rather than behind a Save button: there is no
     * other pending state in this dialog, so a button to confirm one checkbox
     * would only be a way to think you had changed something and not have.
     */
    await run("window.__t.setExportAllowed(true)");
    check("switching it on is saved there and then",
      state().shares.get(file).allowExport, true);
    check("...and said", cheers().some((one) => one.includes("can now export")), true);

    clearToasts();
    await run("window.__t.setExportAllowed(false)");
    check("...and switching it off is too",
      [state().shares.get(file).allowExport, cheers().some((one) => one.includes("is off"))],
      [false, true]);

    // Reopening reads it back off the server rather than off the page.
    run("window.__t.closeShareModal()");
    run(`window.__t.openShareModal(${JSON.stringify(file)})`);
    check("reopening the dialog shows what the server has",
      el("shareExportToggle").checked, false);
  }

  console.log("=== and taking it away again ===");
  {
    clearToasts();
    const kept = run("window.__t.closeShareModal()");
    void kept;
    check("closing it forgets which document it was about",
      [state().shareOpen, state().shareFile], [false, null]);
    check("...and takes the link off the screen with it",
      [el("shareUrlInput").value, el("shareUrlField").hidden, el("shareOnceHint").hidden],
      ["", true, true]);

    run(`window.__t.openShareModal(${JSON.stringify(file)})`);
    const refused = run("window.__t.revokeShareLink()");
    await answer(false);
    await refused;
    check("revoking asks first", state().shares.has(file), true);

    const revoking = run("window.__t.revokeShareLink()");
    await answer(true);
    await revoking;
    check("...and a yes takes the link away", state().shares.has(file), false);
    check("...saying so", cheers().includes("Share link revoked."), true);
    check("...leaving the dialog offering to make another",
      [el("createShareBtn").textContent, el("revokeShareBtn").hidden], ["Create link", true]);
    check("...and the button on the page no longer saying it is published",
      [el("shareDocBtn").classList.contains("active"),
        el("shareDocBtn").getAttribute("aria-label")],
      [false, "Share this document"]);
    run("window.__t.closeShareModal()");
  }

  console.log("=== and when the server will not ===");
  {
    clearToasts();
    const realFetch = window.fetch;
    let refuse = true;
    window.fetch = async (input, options) => {
      if (refuse && String(input).includes("/share")) {
        return /** @type {any} */ ({
          ok: false, status: 500,
          json: async () => ({ error: "The share store is unavailable." }),
          text: async () => '{"error":"The share store is unavailable."}'
        });
      }

      return realFetch(input, options);
    };

    run(`window.__t.openShareModal(${JSON.stringify(file)})`);
    await run("window.__t.createShareLink()");
    check("a link the server will not make is said out loud", complaints().length > 0, true);
    check("...and nothing is shown as though it had been made",
      el("shareUrlField").hidden, true);

    /* The switch goes back to what the server still says, which is the point
     * of saving it as it is switched: a box left on after a failed write is a
     * box that is lying.
     */
    refuse = false;
    await run("window.__t.createShareLink()");
    clearToasts();
    refuse = true;
    el("shareExportToggle").checked = true;
    await run("window.__t.setExportAllowed(true)");
    check("a switch the server will not take goes back to what it was",
      el("shareExportToggle").checked, false);
    check("...and says why", complaints().length > 0, true);

    clearToasts();
    const revoking = run("window.__t.revokeShareLink()");
    await answer(true);
    await revoking;
    check("a revoke the server will not take is said out loud too",
      complaints().length > 0, true);
    check("...and the link is still there", state().shares.has(file), true);

    /* Reading the list is the one of these that is not worth saying anything
     * about: the page still works, the share button simply does not show a
     * published state, and a toast on load about a feature nobody asked for is
     * a toast nobody wants.
     */
    clearToasts();
    await run("window.__t.refreshShares()");
    check("a list the server will not give up is quietly no list",
      [state().shares.size, complaints().length], [0, 0]);

    Object.assign(window, { fetch: realFetch });
    const cleaning = run("window.__t.revokeShareLink()");
    await answer(true);
    await cleaning;
    run("window.__t.closeShareModal()");
    clearToasts();
  }

  console.log("=== the button, when there is nothing to share ===");
  {
    /* Offered only where it can be used: with no document open there is
     * nothing to publish, and in the recycle bin the document is already on
     * its way out.
     */
    const was = state().activeFile;
    run("window.__t.state.activeFile = null");
    run("window.__t.updateShareButton()");
    check("with no document open the button is there but cannot be pressed",
      [el("shareDocBtn").hidden, el("shareDocBtn").disabled], [false, true]);

    run(`window.__t.state.activeFile = ${JSON.stringify(was)}`);
    run("window.__t.state.isRecycleBinMode = true");
    run("window.__t.updateShareButton()");
    check("...and a document in the recycle bin is not one to publish",
      el("shareDocBtn").disabled, true);
    run("window.__t.state.isRecycleBinMode = false");
    run("window.__t.updateShareButton()");
  }

  console.log("=== and a reader who may not share at all ===");
  {
    /* The list is not fetched for somebody who cannot manage shares, and the
     * button does not carry a state it has no way of knowing.
     */
    const can = run("window.__t.state.permissions");
    run("window.__t.state.permissions = []");
    await run("window.__t.refreshShares()");
    check("a reader who may not share has no shares to show", state().shares.size, 0);

    // And the button is not there at all, rather than there and refusing.
    run("window.__t.updateShareButton()");
    check("...and no button offering to", el("shareDocBtn").hidden, true);

    run(`window.__t.state.permissions = ${JSON.stringify(can)}`);
    await run("window.__t.refreshShares()");
    run("window.__t.updateShareButton()");
  }
};
