// Part of the DOM suite. See dom.test.js, which sets all this up and calls it.
//
// The saved-links pane, past the part a fake row can reach.
//
// test/dom/links-and-roles.js covers the chips, the filter and the grid, all
// of it against rows put straight into state. What that cannot reach is every
// path that waits on an answer: filing a card, re-reading one, removing one,
// the icon sweep, and the four sentences the empty grid picks between.
//
// Those answers cannot come from the real server here. Adding a link makes the
// server read the page, and the only addresses this machine can reach are the
// ones link-preview refuses on purpose — so a test that got a real link out of
// /api/links would be a test that needs the internet. The server's own half is
// covered by the `links` suite. What stands in here is the answer, not the
// behaviour: a small api.rows of rows that answers the five link endpoints the
// way lib/routes/links.js answers them, using the server's own group
// normaliser so the test is not inventing a second rule.
const { normalizeGroups } = require("../../lib/links.js");

module.exports = async (ctx) => {
  const { check, waitUntil, window, doc } = ctx;

  const run = (source) => window.eval(source);
  const state = () => run("window.__t.state");
  const said = () => [...doc.querySelectorAll("#toastStack .toast, #toastStackUrgent .toast")]
    .map((one) => one.querySelector(".toast-message")?.textContent || "");
  const clearToasts = () => doc.querySelectorAll(".toast").forEach((one) => one.remove());
  const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

  const row = (id, url, extra = {}) => ({
    id, url, title: id, description: "", note: "", groups: [], icon: "",
    fetched: true, fetchError: null, ...extra
  });

  // The stand-in. Everything that is not a link endpoint goes to the real
  // server, because the page keeps talking to it while this file runs.
  const realFetch = window.fetch;
  /* One holder for everything the stand-in answers with, rather than four
   * variables: a test that assigns a variable either side of an await is the
   * shape require-atomic-updates is there to stop, and this file is nothing
   * but awaits.
   */
  const api = {
    rows: [],
    icons: { status: 200, body: () => ({ fetched: 0, remaining: 0, links: api.rows }) },
    refreshed: (link) => ({ ...link, fetched: true, fetchError: null, title: `${link.title} (fresh)` }),
    // An answer for one request, when a section needs the server to say
    // something the api.rows cannot. Returning null falls through to the api.rows.
    override: null
  };
  const sent = [];
  /* Set through a function rather than assigned, because every section here
   * sets them between two awaits — which is the shape require-atomic-updates
   * exists to catch, and it is right to catch it in app code.
   */
  const serve = (rows) => { api.rows = rows; };
  const answerIcons = (answer) => { api.icons = answer; };
  const answerRefresh = (answer) => { api.refreshed = answer; };
  const intercept = (answer) => { api.override = answer; };
  const patches = () => sent.filter((one) => one.method === "PATCH").length;

  const reply = (status, body) => ({
    status, ok: status >= 200 && status < 300,
    async json() { return body; },
    async text() { return JSON.stringify(body); }
  });

  const standIn = async (url, options = {}) => {
    const answer = api.override ? await api.override(url, options) : null;
    if (answer) {
      return answer;
    }

    const path = String(url);
    const method = (options.method || "GET").toUpperCase();
    if (!path.startsWith("/api/links")) {
      return realFetch(url, options);
    }

    const body = typeof options.body === "string" ? JSON.parse(options.body) : {};
    sent.push({ path, method, body });
    const id = decodeURIComponent(path.replace("/api/links/", ""));
    const groups = () => [...new Set(api.rows.flatMap((one) => one.groups))];

    if (path === "/api/links" && method === "GET") {
      return reply(200, { links: api.rows, groups: groups() });
    }

    if (path === "/api/links" && method === "POST") {
      const made = row(`new-${api.rows.length + 1}`, body.url, {
        title: body.url, note: body.note || "", groups: normalizeGroups(body.groups),
        fetched: false, fetchError: "That site could not be read."
      });
      serve([made, ...api.rows]);
      return reply(201, { link: made, groups: groups() });
    }

    if (path === "/api/links/icons" && method === "POST") {
      return reply(api.icons.status, api.icons.body());
    }

    const found = api.rows.find((one) => one.id === id);
    if (!found) {
      return reply(404, { error: "That link is not there any more." });
    }

    if (method === "PATCH") {
      const next = body.refresh
        ? { ...api.refreshed(found), groups: normalizeGroups(body.groups) }
        : { ...found, groups: normalizeGroups(body.groups) };
      serve(api.rows.map((one) => (one.id === id ? next : one)));
      return reply(200, { link: next, groups: groups() });
    }

    if (method === "DELETE") {
      serve(api.rows.filter((one) => one.id !== id));
      return reply(200, { ok: true });
    }

    return reply(405, { error: "No." });
  };

  window.fetch = standIn;
  // Putting the real one back is a function so that it is not an assignment
  // made after an await, which is the rule this whole file is arranged around.
  const restoreFetch = () => { window.fetch = realFetch; };

  // Each section starts from the same three rows, in the links view.
  const seed = async (rows) => {
    serve(rows);
    run('window.__t.state.linkFilter = ""; window.__t.state.linkGroupFilter = null;');
    run('window.__t.state.viewMode = "links";');
    await run("window.__t.refreshLinks()");
    await settle();
  };

  const card = (id) => doc.querySelector(`#linksGrid .link-card[data-id="${id}"]`);
  const press = (node) => node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const actionOn = (id, label) => [...card(id).querySelectorAll(".link-card-actions button")]
    .find((one) => one.getAttribute("aria-label").startsWith(label));
  const groupsOn = (id) => [...card(id).querySelectorAll(".link-card-group")].map((one) => one.textContent);

  console.log("=== what a card shows when the link is not quite a link ===");
  {
    await seed([
      row("a", "https://www.example.com/one", { groups: ["osu"] }),
      row("b", "not a url at all"),
      row("c", "https://example.net/three", { icon: "data:image/png;base64,bm90", fetched: false,
        fetchError: "That site could not be read." })
    ]);

    check("the host is what the card says it is",
      card("a").querySelector(".link-card-host").textContent, "example.com");
    /* A stored URL that will not parse is not supposed to happen — the server
     * parses one before it saves it. It is in the store of anyone who has run
     * this app since before that was true, and a card that throws takes the
     * whole grid with it.
     */
    check("...and a URL that will not parse is shown as it was typed",
      card("b").querySelector(".link-card-host").textContent, "not a url at all");

    const icon = card("c").querySelector("img.link-icon");
    check("a link with an icon draws the icon", icon !== null, true);
    icon.dispatchEvent(new window.Event("error"));
    check("...and a letter takes over when that icon will not decode",
      [card("c").querySelector("img.link-icon"), card("c").querySelector(".link-icon-mark")?.textContent],
      [null, "E"]);
    check("a page that could not be read says so on the card",
      card("c").querySelector(".link-card-warn").title, "That site could not be read.");
  }

  console.log("=== filing a card from the card itself ===");
  {
    await seed([row("a", "https://example.com/one", { groups: ["osu"] }), row("b", "https://example.net/two")]);

    press(actionOn("a", "Edit groups"));
    const editor = () => card("a").querySelector(".link-card-group-edit input");
    check("the chip row becomes a field holding what it is filed under",
      editor().value, "osu");
    check("...named for the link, since a grid of them is otherwise identical",
      editor().getAttribute("aria-label"), "Groups for a");
    check("...offering the groups that already exist",
      editor().getAttribute("list"), "linkGroupOptions");

    press(actionOn("a", "Edit groups"));
    check("pressing the button again does not open a second field",
      card("a").querySelectorAll(".link-card-group-edit").length, 1);

    const type = (value) => { editor().value = value; };
    const key = (name) => {
      const event = new window.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
      editor().dispatchEvent(event);
      return event;
    };

    type("osu, APIs");
    check("Escape takes the typing back", key("Escape").defaultPrevented, true);
    await settle();
    check("...leaving the card filed where it was", groupsOn("a"), ["osu"]);

    press(actionOn("a", "Edit groups"));
    type("osu, APIs");
    check("Enter saves", key("Enter").defaultPrevented, true);
    await waitUntil(() => groupsOn("a").length === 2, 2000);
    check("...and the card is filed under both", groupsOn("a"), ["osu", "APIs"]);
    check("...which is what went to the server", sent.at(-1),
      { path: "/api/links/a", method: "PATCH", body: { groups: "osu, APIs" } });

    /* Clicking away is saving, not cancelling. The field is a chip row that
     * turned into a text box; nothing about it says the typing is provisional,
     * so losing it on a stray click is losing work.
     */
    press(actionOn("b", "Edit groups"));
    card("b").querySelector(".link-card-group-edit input").value = "games";
    card("b").querySelector(".link-card-group-edit input")
      .dispatchEvent(new window.Event("blur"));
    await waitUntil(() => groupsOn("b").length === 1, 2000);
    check("clicking away files it too", groupsOn("b"), ["games"]);

    /* Enter has already saved, and the field goes away with the card it was
     * drawn on — but losing focus is a save too, and the blur arrives after.
     * Without the guard the same typing is sent twice.
     */
    press(actionOn("b", "Edit groups"));
    const twice = card("b").querySelector(".link-card-group-edit input");
    twice.value = "games, osu";
    const was = patches();
    twice.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    twice.dispatchEvent(new window.Event("blur"));
    await waitUntil(() => groupsOn("b").length === 2, 2000);
    check("the field that has saved does not save again as it goes away",
      patches() - was, 1);

    /* The list can be replaced while the field is open — another tab removed
     * the link, or the icon sweep came back. The typing then belongs to
     * nothing, and sending it would file a group onto a link that is gone.
     */
    press(actionOn("a", "Edit groups"));
    const orphan = card("a").querySelector(".link-card-group-edit input");
    orphan.value = "osu, late";
    const kept = api.rows;
    serve([]);
    await run("window.__t.refreshLinks()");
    const before2 = patches();
    orphan.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    check("typing into a card the list no longer has sends nothing",
      patches(), before2);
    serve(kept);
    await run("window.__t.refreshLinks()");
    await settle();

    /* The server refuses. The card has to end up filed the way it is filed on
     * the server, which is how it was before the typing — and the error has
     * to be said, because a card that silently ignores what was typed looks
     * like a card that saved it.
     */
    clearToasts();
    press(actionOn("a", "Edit groups"));
    card("a").querySelector(".link-card-group-edit input").value = "osu, APIs, nope";
    const gone = api.rows;
    serve(api.rows.filter((one) => one.id !== "a"));
    card("a").querySelector(".link-card-group-edit input")
      .dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await waitUntil(() => said().length > 0, 2000);
    check("a refusal says why", said().at(-1), "That link is not there any more.");
    check("...and leaves the card filed the way the server has it", groupsOn("a"), ["osu", "APIs"]);
    serve(gone);
  }

  console.log("=== and by dragging it onto a chip ===");
  {
    await seed([row("a", "https://example.com/one", { groups: ["osu"] }), row("b", "https://example.net/two", { groups: ["games"] })]);

    const chip = (name) => doc.querySelector(`#linksGroups .group-chip[data-group="${name}"]`);
    const transfer = { effectAllowed: "", dropEffect: "", data: {}, setData(k, v) { this.data[k] = v; } };
    const drag = (node, type) => node.dispatchEvent(Object.assign(
      new window.Event(type, { bubbles: true, cancelable: true }), { dataTransfer: transfer }));

    // Nothing is being dragged, so the chip must not light up — a drop target
    // offered to a pointer that is carrying nothing is a target that does
    // nothing when it is used.
    drag(chip("osu"), "dragover");
    check("a chip ignores a pointer that is dragging nothing",
      chip("osu").classList.contains("drop-target"), false);
    drag(chip("osu"), "drop");
    await settle();
    check("...and a drop from nowhere files nothing", groupsOn("a"), ["osu"]);

    clearToasts();
    const before = patches();
    drag(card("a"), "dragstart");
    drag(chip("osu"), "dragover");
    check("the chip the card is already in still takes the pointer",
      chip("osu").classList.contains("drop-target"), true);
    drag(chip("osu"), "drop");
    await settle();
    check("...but dropping it there says it is already filed there",
      said().at(-1), 'Already in "osu".');
    check("...and sends nothing", patches(), before);

    drag(chip("games"), "dragover");
    drag(chip("games"), "drop");
    await waitUntil(() => groupsOn("a").length === 2, 2000);
    check("dropping it on another files it under both", groupsOn("a"), ["osu", "games"]);
    drag(card("a"), "dragend");
  }

  console.log("=== the four ways the grid can be empty ===");
  {
    await seed([row("a", "https://example.com/one", { groups: ["osu"] })]);
    const words = () => [doc.querySelector("#linksEmpty h3").textContent,
      doc.getElementById("linksEmpty").hidden];

    run('window.__t.state.linkFilter = "nothing like this"; window.__t.renderLinks();');
    check("nothing matches what was typed", words(), ["Nothing matches", false]);

    run('window.__t.state.linkFilter = ""; window.__t.state.linkGroupFilter = "osu"; window.__t.renderLinks();');
    check("the selected group still has something in it", words()[1], true);

    run('window.__t.state.linkGroupFilter = "emptied"; window.__t.renderLinks();');
    check("the selected group has been emptied", words(), ["This group is empty", false]);

    run('window.__t.state.linkGroupFilter = ""; window.__t.renderLinks();');
    check("Ungrouped, when everything is filed", words(), ["Everything is filed", false]);

    run('window.__t.state.linkGroupFilter = null; window.__t.state.links = []; window.__t.renderLinks();');
    check("and nothing saved at all", words(), ["No links yet", false]);

    run("window.__t.showLinksLoading()");
    check("while the one request is in the air, the same space says so",
      [doc.querySelector("#linksEmpty h3").textContent,
        doc.getElementById("linksEmpty").classList.contains("is-loading")],
      ["Loading links", true]);
  }

  console.log("=== what arriving at the pane does ===");
  {
    // A chip selected before the list was reloaded can name a group that is
    // not there any more, which leaves an empty grid and no way to see why.
    serve([row("a", "https://example.com/one", { groups: ["osu"] })]);
    run('window.__t.state.linkGroupFilter = "gone";');
    await run("window.__t.refreshLinks()");
    await settle();
    check("a filter naming a group that no longer exists is dropped",
      state().linkGroupFilter, null);

    run('window.__t.state.linkGroupFilter = "OSU";');
    await run("window.__t.refreshLinks()");
    check("...while one that differs only in case is kept",
      state().linkGroupFilter, "OSU");
    run("window.__t.state.linkGroupFilter = null;");

    /* Links saved before the icon column existed have never had one fetched.
     * The sweep goes and gets them once, in the background, rather than
     * leaving a grid of letters and a button nobody would think to press.
     */
    clearToasts();
    answerIcons({ status: 200,
      body: () => ({ fetched: 2, remaining: 0, links: api.rows.map((one) => ({ ...one, icon: "" })) }) });
    serve([row("a", "https://example.com/one", { icon: undefined }),
      row("b", "https://example.net/two", { icon: undefined })]);
    await run("window.__t.refreshLinks()");
    await waitUntil(() => said().some((one) => /site icon/.test(one)), 3000);
    check("arriving with icons missing fetches them without being asked",
      said().some((one) => one === "Found 2 site icons."), true);
    check("...and the sweep is not run again once they are settled",
      run("window.__t.linksNeedingIcons().length"), 0);
  }

  console.log("=== the icon sweep's other three answers ===");
  {
    const sweep = async (answer) => {
      clearToasts();
      answerIcons(answer);
      serve([row("a", "https://example.com/one", { icon: undefined })]);
      await run("window.__t.refreshLinks()");
      await waitUntil(() => said().length > 0, 3000);
      return said();
    };

    check("one icon is one icon, not one icons",
      (await sweep({ status: 200, body: () => ({ fetched: 1, remaining: 0, links: api.rows.map((one) => ({ ...one, icon: "" })) }) }))
        .includes("Found 1 site icon."), true);

    /* A library big enough to run past the minute's fetch budget finishes on
     * the next visit. Saying so is the difference between "it is still
     * working" and "it gave up".
     */
    const budget = await sweep({ status: 200,
      body: () => ({ fetched: 2, remaining: 7, links: api.rows.map((one) => ({ ...one, icon: "" })) }) });
    check("what the budget did not reach is promised for next time",
      budget.includes("7 more icons will be fetched next time."), true);

    const refused = await sweep({ status: 500, body: () => ({ error: "The sweep fell over." }) });
    check("a sweep that fails says so without interrupting anything",
      refused.at(-1), "Could not fetch the site icons: The sweep fell over.");
    check("...and does not leave the sweep looking like it is still running",
      run("window.__t.state.linkIconsRunning"), false);

    answerIcons({ status: 200,
      body: () => ({ fetched: 0, remaining: 0, links: api.rows.map((one) => ({ ...one, icon: "" })) }) });
  }

  console.log("=== adding one ===");
  {
    await seed([]);
    run("window.__t.openLinkModal()");

    doc.getElementById("linkUrlInput").value = "   ";
    await run("window.__t.submitLink()");
    check("an empty address is refused before anything is sent",
      doc.getElementById("linkError").textContent, "Enter a URL.");
    check("...and the field is where the cursor is put back",
      doc.activeElement, doc.getElementById("linkUrlInput"));

    clearToasts();
    doc.getElementById("linkUrlInput").value = "https://example.com/saved";
    doc.getElementById("linkNoteInput").value = "read later";
    doc.getElementById("linkGroupsInput").value = "osu, APIs";
    await run("window.__t.submitLink()");
    await settle();

    check("what was typed is what was sent", sent.at(-1).body,
      { url: "https://example.com/saved", note: "read later", groups: "osu, APIs" });
    check("the new link is at the top of the grid",
      [...doc.querySelectorAll("#linksGrid .link-card")].map((one) => one.dataset.id)[0], "new-1");
    check("the dialog closes behind it", state().linkModalOpen, false);
    /* Saved, but not read: the server keeps a link whose page it could not
     * fetch, and the card is useless if it does not say which of the two
     * happened.
     */
    check("...and a page that could not be read is said to be saved anyway",
      said().at(-1), "Saved, but that page could not be read: That site could not be read.");

    clearToasts();
    run("window.__t.openLinkModal()");
    doc.getElementById("linkUrlInput").value = "https://example.net/read";
    doc.getElementById("linkNoteInput").value = "";
    const readable = api.rows;
    intercept((url, options) => (
      String(url) === "/api/links" && (options.method || "GET").toUpperCase() === "POST"
        ? reply(201, { link: row("read", "https://example.net/read"), groups: [] })
        : null));
    await run("window.__t.submitLink()");
    await settle();
    check("a page that was read says only that it is saved", said().at(-1), 'Saved "read".');
    intercept(null);
    serve(readable);

    // The dialog stays open with the message in it, since the address in the
    // field is the thing that needs correcting.
    run("window.__t.openLinkModal()");
    doc.getElementById("linkUrlInput").value = "https://example.org/refused";
    intercept((url, options) => (
      String(url) === "/api/links" && (options.method || "GET").toUpperCase() === "POST"
        ? reply(400, { error: "That address is inside a private network." })
        : null));
    await run("window.__t.submitLink()");
    check("a refusal is shown in the dialog",
      [doc.getElementById("linkError").textContent, doc.getElementById("linkError").hidden],
      ["That address is inside a private network.", false]);
    check("...which stays open with the address still in it",
      [state().linkModalOpen, doc.getElementById("linkUrlInput").value],
      [true, "https://example.org/refused"]);
    check("...and the button says what it says again, rather than still reading",
      [doc.getElementById("saveLinkBtn").disabled,
        doc.querySelector("#saveLinkBtn span").textContent],
      [false, "Add link"]);
    intercept(null);
    run("window.__t.closeLinkModal()");
  }

  console.log("=== re-reading a page, and removing a link ===");
  {
    await seed([row("a", "https://example.com/one", { groups: ["osu"] })]);

    clearToasts();
    press(actionOn("a", "Re-read"));
    await waitUntil(() => said().length > 0, 3000);
    check("re-reading says it worked", said().at(-1), "Link updated.");
    check("...and the card is redrawn from what came back",
      card("a").querySelector(".link-card-title a").textContent, "a (fresh)");
    /* The server replaces the metadata wholesale, so the groups go back with
     * the request. Without them the card comes home unfiled, which is a
     * refresh quietly undoing somebody's filing.
     */
    check("...with the groups sent back, so the card does not come home unfiled",
      [sent.at(-1).body.refresh, sent.at(-1).body.groups], [true, ["osu"]]);
    check("...and is still filed", groupsOn("a"), ["osu"]);

    clearToasts();
    answerRefresh((link) => ({ ...link, fetched: false, fetchError: "The page has gone." }));
    press(actionOn("a", "Re-read"));
    await waitUntil(() => said().length > 0, 3000);
    check("a page that cannot be read now says so",
      said().at(-1), "Could not read that page: The page has gone.");

    clearToasts();
    const vanished = api.rows;
    serve([]);
    press(actionOn("a", "Re-read"));
    await waitUntil(() => said().length > 0, 3000);
    check("and a link the server has lost says that instead",
      said().at(-1), "That link is not there any more.");
    serve(vanished);

    clearToasts();
    press(actionOn("a", "Remove"));
    await waitUntil(() => state().confirmOpen, 3000);
    check("removing asks first, naming the link",
      doc.getElementById("confirmMessage").textContent.includes(
        card("a").querySelector(".link-card-title a").textContent), true);
    check("...and says the site itself is untouched",
      doc.getElementById("confirmMessage").textContent.includes("site itself is untouched"), true);
    run("window.__t.resolveConfirmDialog(false)");
    await settle();
    check("answering no keeps the card", card("a") !== null, true);
    check("...and sends no delete", sent.at(-1).method === "DELETE", false);

    press(actionOn("a", "Remove"));
    await waitUntil(() => state().confirmOpen, 3000);
    run("window.__t.resolveConfirmDialog(true)");
    await waitUntil(() => card("a") === null, 3000);
    check("answering yes removes it", [card("a"), said().at(-1)], [null, "Link removed."]);
    check("...and the request went to the right link", sent.at(-1),
      { path: "/api/links/a", method: "DELETE", body: {} });

    /* A card can outlive the list it was drawn from — the grid is redrawn
     * while a finger is on its way to a button. Both handlers hold an id
     * rather than a row, and both have to find it gone rather than send a
     * request about a link that is not there.
     */
    await seed([row("a", "https://example.com/one")]);
    const stale = { reread: actionOn("a", "Re-read"), remove: actionOn("a", "Remove") };
    serve([]);
    await run("window.__t.refreshLinks()");
    await settle();
    clearToasts();
    const quiet = sent.length;
    press(stale.reread);
    press(stale.remove);
    await settle();
    check("a button on a card the list has dropped does nothing at all",
      [sent.length, said(), state().confirmOpen], [quiet, [], false]);

    // A delete the server refuses leaves the card where it is, with the reason.
    await seed([row("a", "https://example.com/one")]);
    clearToasts();
    intercept((url, options) => (
      (options.method || "GET").toUpperCase() === "DELETE"
        ? reply(500, { error: "The store is read-only." })
        : null));
    press(actionOn("a", "Remove"));
    await waitUntil(() => state().confirmOpen, 3000);
    run("window.__t.resolveConfirmDialog(true)");
    await waitUntil(() => said().length > 0, 3000);
    check("a delete the server refuses says why", said().at(-1), "The store is read-only.");
    check("...and the card stays where it is", card("a") !== null, true);
    intercept(null);
  }

  console.log("=== and the two things that are asked for and not done ===");
  {
    await seed([row("a", "https://example.com/one")]);

    // Nothing is missing an icon, so the sweep is not a request.
    const quiet = sent.length;
    await run("window.__t.backfillLinkIcons()");
    check("the icon sweep with nothing to fetch asks for nothing", sent.length, quiet);

    /* A viewer has no Add button, but the dialog can still be opened from the
     * keyboard shortcut, which does not know what the account may do.
     */
    run('window.__t.applySession({ authenticated: true, user: { username: "r", role: "viewer" }, permissions: ["doc:read"], csrfToken: "t" });');
    run("window.__t.openLinkModal()");
    check("a viewer asking for the add dialog does not get one",
      [state().linkModalOpen, doc.getElementById("linkModal").classList.contains("open")],
      [false, false]);

    await run("window.__t.refreshSession()");
    await settle();
  }

  restoreFetch();
  run('window.__t.state.links = []; window.__t.state.linkGroupFilter = null;');
  run('window.__t.state.viewMode = "docs"; window.__t.syncModeUI();');
};
