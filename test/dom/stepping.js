// Part of the DOM suite. See dom.test.js, which sets all this up and calls it.
//
// Walking the matches for a query: through the open document, and then on into
// the next document that has one.
//
// test/dom/jump.js covers the finding and the marking — which text nodes are
// skipped, which term wins where two could match, and that clearing puts the
// document back as it was. This is the stepping, which docs/TESTING.md said
// belonged in a real browser. Most of it does not: it is class toggling and
// index arithmetic, and the one part that is geometry (scrollIntoView) does
// nothing here and nothing is asked of it.
module.exports = async (ctx) => {
  const { check, waitUntil, window, doc, server, cookieHeader } = ctx;

  const run = (source) => window.eval(source);
  const state = () => run("window.__t.state");
  const el = (id) => doc.getElementById(id);

  const said = () => [...doc.querySelectorAll("#toastStack .toast, #toastStackUrgent .toast")]
    .map((one) => one.querySelector(".toast-message")?.textContent || "");
  const saidThat = (text) => said().some((one) => one.includes(text));
  const clearToasts = () => doc.querySelectorAll(".toast").forEach((one) => one.remove());

  const made = async (name, body) => {
    await server.request("POST", "/api/docs",
      { fileName: name, overwrite: true, content: body },
      { Cookie: cookieHeader(), "X-CSRF-Token": state().csrfToken });
    return name;
  };

  // Open it and wait until it has been marked, which happens on the way in.
  const openWith = async (file, query) => {
    await run(`window.__t.openDocument(${JSON.stringify(file)}, true, {
      jumpQuery: ${JSON.stringify(query)}, jumpTerms: [${JSON.stringify(query)}] })`);
    await waitUntil(() => state().activeFile === file && state().jumpMatchCount > 0);
    run(`window.__t.state.jumpQuery = ${JSON.stringify(query)}`);
  };

  const marks = () => [...el("docContent").querySelectorAll("mark.doc-jump-highlight")];
  const activeAt = () => marks().findIndex((one) => one.classList.contains("doc-jump-highlight-active"));
  const counter = () => el("matchNavLabel").textContent;

  console.log("=== stepping through the matches in one document ===");
  {
    const file = await made("stepping.md", [
      "# Rollback",
      "",
      "The rollback is one command. A rollback takes a minute.",
      "",
      "- A third rollback, in a list",
      ""
    ].join("\n"));
    await run("window.__t.refreshDocs({ preserveSearch: true })");
    await run(`window.__t.openDocument(${JSON.stringify(file)}, true)`);
    await waitUntil(() => state().activeFile === file);

    const first = run('window.__t.jumpToSearchMatch("rollback", [], 0)');
    check("every match in the document is marked", marks().length, 4);
    check("...with the first of them the one being looked at",
      [first.found, first.index, first.total, activeAt()], [true, 0, 4, 0]);
    /* The paragraph around it is marked too, so the eye has something bigger
     * than a word to land on when the document scrolls.
     */
    check("...and the block it is in is marked as where to look",
      el("docContent").querySelectorAll(".doc-jump-focus").length, 1);
    check("the counter says where you are", counter(), "1 / 4");

    const second = run("window.__t.setActiveJumpMatch(1)");
    check("stepping on moves to the next", [second.index, activeAt()], [1, 1]);
    // The one you have left goes back to being one of the rest rather than
    // staying lit.
    check("...and the one you left is no longer the active one",
      marks()[0].classList.contains("doc-jump-highlight-passive"), true);
    check("...and only one block is marked at a time",
      el("docContent").querySelectorAll(".doc-jump-focus").length, 1);

    /* Round the ends, because a search that stops at the last match is a
     * search you have to start again.
     */
    check("stepping past the last one comes back to the first",
      run("window.__t.setActiveJumpMatch(4)").index, 0);
    check("...and stepping back past the first goes to the last",
      run("window.__t.setActiveJumpMatch(-1)").index, 3);

    // Nothing marked is nothing to step through, and the counter says so
    // rather than lying about a position.
    run("window.__t.clearDocumentJumpDecorations()");
    run("window.__t.state.jumpMarkedNodes = []");
    check("with nothing marked there is nowhere to step to",
      run("window.__t.setActiveJumpMatch(0)"), { found: false, index: -1, total: 0 });
  }

  console.log("=== and the marks are reused rather than remade ===");
  {
    /* The same query in the same document, whose marks are still attached:
     * remaking them would move the caret and the scroll position for nothing,
     * and the answer to "is this the same search" is usually yes.
     */
    const again = run('window.__t.jumpToSearchMatch("rollback", [], 0)');
    check("the same query marks the document again", again.total, 4);

    const before = marks()[0];
    const third = run('window.__t.jumpToSearchMatch("rollback", [], 2)');
    check("...and asking again for the same thing keeps the marks it had",
      [marks()[0] === before, third.index], [true, 2]);

    // A different query is a different set of marks.
    const other = run('window.__t.jumpToSearchMatch("command", [], 0)');
    check("a different query marks something else",
      [other.total, marks()[0] === before], [1, false]);

    /* And marks whose document has been redrawn under them are not marks any
     * more, however much the query matches.
     */
    run('window.__t.jumpToSearchMatch("rollback", [], 0)');
    const detached = marks()[0];
    el("docContent").innerHTML = el("docContent").innerHTML;
    const remade = run('window.__t.jumpToSearchMatch("rollback", [], 0)');
    check("...and marks the document has thrown away are made again",
      [remade.found, marks()[0] === detached], [true, false]);

    // A query of nothing is not a search: the marks come off and the counter
    // goes back to saying nothing.
    const none = run('window.__t.jumpToSearchMatch("  ", [], 0)');
    check("a query of nothing takes the marks off",
      [none, marks().length], [{ found: false, index: -1, total: 0 }, 0]);
    check("...and the bar goes away with them", el("matchNav").hidden, true);

    // A query that matches nothing is a search with no matches, which is a
    // different thing from no search.
    const missing = run('window.__t.jumpToSearchMatch("kubernetes", [], 0)');
    check("a query that matches nothing says so", missing.found, false);
    check("...and leaves nothing marked", marks().length, 0);
  }

  console.log("=== which documents the walk goes on to ===");
  {
    /* The one you are looking at first, then the rest in the order the list is
     * in — so stepping on from the last match in this document lands in the
     * next document somebody can see rather than in an arbitrary one.
     */
    run('window.__t.jumpToSearchMatch("rollback", [], 0)');
    const order = run("window.__t.getNavigationDocFilesForJump()");
    check("the document you are in comes first", order[0], state().activeFile);
    check("...and the rest of the library follows it", order.length > 1, true);
    check("...each of them once", new Set(order).size, order.length);

    // With no query there is nowhere to go: the walk is a walk of one query.
    run('window.__t.jumpToSearchMatch("", [], 0)');
    check("with no query there is nothing to walk",
      run("window.__t.getNavigationDocFilesForJump()"), []);
    check("...and stepping does nothing",
      await run("window.__t.moveToAdjacentJumpMatch(1)"),
      { found: false, index: -1, total: 0 });
  }

  console.log("=== on into the next document that has one ===");
  {
    clearToasts();
    const here = await made("walk-here.md", "# Here\n\nThe word deployment appears once.\n");
    const there = await made("walk-there.md", "# There\n\nAnd deployment appears here too.\n");
    const neither = await made("walk-neither.md", "# Neither\n\nNothing of the sort.\n");
    await run("window.__t.refreshDocs({ preserveSearch: true })");

    // Only these three in the list, so the walk is a walk of known documents
    // rather than of whatever the rest of the suite has left behind.
    run(`window.__t.state.filteredDocs = window.__t.state.docs.filter(
      (one) => ${JSON.stringify([here, there, neither])}.includes(one.file))`);

    await run(`window.__t.openDocument(${JSON.stringify(here)}, true, {
      jumpQuery: "deployment", jumpTerms: ["deployment"] })`);
    await waitUntil(() => state().activeFile === here);
    check("opening a document with a query marks it on the way in",
      state().jumpMatchCount > 0, true);

    const moved = await run("window.__t.moveToAdjacentJumpMatch(1)");
    check("stepping past the last match here opens the next that has one",
      [moved.found, moved.docChanged, moved.file], [true, true, there]);
    check("...and it is the document on screen now", state().activeFile, there);
    // The one with nothing in it is passed over rather than opened and left
    // showing no matches.
    check("...the one with no matches passed over", moved.total > 0, true);

    /* And back the other way, which is the same walk with the step reversed
     * and lands on the last match rather than the first.
     */
    const back = await run("window.__t.moveToAdjacentJumpMatch(-1)");
    check("stepping back before the first match goes to the document before",
      [back.found, back.file], [true, here]);

    // A query nothing in the library matches is a walk that tries every
    // document and comes back saying so.
    await run(`window.__t.jumpToSearchMatch("kubernetes", ["kubernetes"], 0)`);
    run('window.__t.state.jumpQuery = "kubernetes"');
    run('window.__t.state.jumpTerms = ["kubernetes"]');
    const nowhere = await run("window.__t.moveToAdjacentJumpMatch(1)");
    check("a query no document matches comes back having tried them all",
      nowhere.found, false);
  }

  console.log("=== and what the bar says while you do it ===");
  {
    clearToasts();
    await openWith("walk-here.md", "deployment");

    await run("window.__t.navigateMatches(1)");
    check("moving to another document says which one and where in it",
      saidThat("Moved to walk-there.md. Match 1 of"), true);

    /* And within one document it says only where, because the document has
     * not changed and saying its name again is noise.
     */
    clearToasts();
    await openWith("stepping.md", "rollback");
    await run("window.__t.navigateMatches(1)");
    check("...and moving within one says only where", saidThat("Match 2 of"), true);

    clearToasts();
    run('window.__t.jumpToSearchMatch("kubernetes", ["kubernetes"], 0)');
    run('window.__t.state.jumpQuery = "kubernetes"');
    run("window.__t.state.filteredDocs = []");
    run("window.__t.state.searchResults = []");
    run("window.__t.state.docs = []");
    const nothing = await run("window.__t.navigateMatches(1)");
    check("a query with nothing to step to says that instead",
      [nothing.found, saidThat("No searchable matches")], [false, true]);
    await run("window.__t.refreshDocs({ preserveSearch: true })");
  }

  console.log("=== the buttons and the keys that do the same ===");
  {
    clearToasts();
    await openWith("stepping.md", "rollback");

    /* The bar is moved out of the shell and onto the body, so that it stays
     * pinned to the window however the shell is transformed underneath it.
     */
    run("window.__t.mountMatchNavToViewportLayer()");
    check("the match bar is pinned to the window rather than to the shell",
      el("matchNav").parentElement, doc.body);
    check("...and asking again leaves it there",
      (run("window.__t.mountMatchNavToViewportLayer()"), el("matchNav").parentElement),
      doc.body);

    clearToasts();
    el("matchNextBtn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitUntil(() => said().length > 0);
    check("the next button steps on", saidThat("Match"), true);

    clearToasts();
    el("matchPrevBtn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitUntil(() => said().length > 0);
    check("...and the previous button steps back", saidThat("Match"), true);

    /* Enter in the search box steps too, when what is typed is the query the
     * document is already marked for — otherwise it opens the first result,
     * which is what it does before anything is open.
     */
    clearToasts();
    el("searchInput").value = "rollback";
    el("searchInput").dispatchEvent(new window.KeyboardEvent("keydown",
      { key: "Enter", bubbles: true }));
    await waitUntil(() => said().length > 0);
    check("Enter steps through the matches it is already showing",
      saidThat("Match"), true);

    clearToasts();
    el("searchInput").dispatchEvent(new window.KeyboardEvent("keydown",
      { key: "Enter", shiftKey: true, bubbles: true }));
    await waitUntil(() => said().length > 0);
    check("...and shift-Enter steps the other way", saidThat("Match"), true);

    // Another key is not a step, and an empty box is nothing to step with.
    clearToasts();
    el("searchInput").dispatchEvent(new window.KeyboardEvent("keydown",
      { key: "a", bubbles: true }));
    el("searchInput").value = "";
    el("searchInput").dispatchEvent(new window.KeyboardEvent("keydown",
      { key: "Enter", bubbles: true }));
    check("another key is not a step, and an empty box is not a query", said(), []);
  }

  console.log("=== Enter where there is nothing to step through ===");
  {
    /* Before a document is open, Enter opens the first result rather than
     * stepping — there is nothing to step through yet, and the whole point of
     * typing was to find that document.
     */
    clearToasts();
    run("window.__t.exitSearchMode()");
    run("window.__t.state.activeFile = null");
    run('window.__t.state.jumpQuery = ""');
    await run('window.__t.applySearch("rollback")');
    await waitUntil(() => state().searchResults.length > 0);

    el("searchInput").value = "rollback";
    el("searchInput").dispatchEvent(new window.KeyboardEvent("keydown",
      { key: "Enter", bubbles: true }));
    await waitUntil(() => Boolean(state().activeFile));
    check("Enter with nothing open opens the first result",
      state().activeFile, state().searchResults[0].file);
    check("...with the words already marked in it", marks().length > 0, true);

    /* And in the links pane it does nothing at all: the filtering happened as
     * the words were typed, and there is no document to open.
     */
    clearToasts();
    run("window.__t.state.activeFile = null");
    await run('window.__t.applySearch("rollback")');
    await waitUntil(() => state().searchResults.length > 0);
    check("there is a result Enter would otherwise open",
      state().searchResults.length > 0, true);

    run('window.__t.state.viewMode = "links"');
    el("searchInput").value = "rollback";
    el("searchInput").dispatchEvent(new window.KeyboardEvent("keydown",
      { key: "Enter", bubbles: true }));
    // Given a moment to have opened something, since opening one is a round
    // trip and "it did not happen yet" and "it will not happen" look alike.
    await waitUntil(() => Boolean(state().activeFile), 600);
    check("...and Enter in the links pane does not open it", state().activeFile, null);
    run('window.__t.state.viewMode = "docs"');

    run("window.__t.exitSearchMode()");
  }

  console.log("=== and the marks nothing is attached to any more ===");
  {
    /* A document redrawn while a match was active: the node the walk is
     * pointing at is no longer in the document, and stepping to it has to
     * answer "not found" rather than lighting up a node nobody can see.
     */
    await openWith("stepping.md", "rollback");
    run("window.__t.setActiveJumpMatch(1)");
    check("a match is active", activeAt(), 1);

    el("docContent").replaceChildren();
    check("...and once the document has been redrawn there is nothing to step to",
      run("window.__t.setActiveJumpMatch(2)"), { found: false, index: -1, total: 0 });
    // Which is the same answer as never having found anything, so the counter
    // is not left claiming a position in a document that no longer has one.
    check("...and the counter is not left claiming a position",
      el("matchNavLabel").textContent, "0 / 0");

    /* And the walk across documents, with no documents to walk: the query is
     * still there but the list it would walk is empty.
     */
    run('window.__t.state.jumpQuery = "rollback"');
    run("window.__t.state.activeFile = null");
    run("window.__t.state.jumpMatchFile = null");
    run("window.__t.state.filteredDocs = []");
    run("window.__t.state.searchResults = []");
    run("window.__t.state.docs = []");
    check("a query with no documents to walk is a walk of nothing",
      await run("window.__t.moveToAdjacentJumpMatch(1)"),
      { found: false, index: -1, total: 0 });
    await run("window.__t.refreshDocs({ preserveSearch: true })");
  }

  console.log("=== and leaving search mode undoes both halves of it ===");
  {
    clearToasts();
    await openWith("stepping.md", "rollback");
    el("searchInput").value = "rollback";
    check("there is a search to leave", marks().length > 0, true);

    /* Leaving while a keystroke is still waiting to be searched for takes that
     * with it, or the search somebody has just cancelled runs a moment later.
     */
    el("searchInput").dispatchEvent(new window.Event("input", { bubbles: true }));
    check("a keystroke is waiting to be searched for",
      Boolean(state().searchInputTimer), true);

    run("window.__t.exitSearchMode()");
    await waitUntil(() => el("searchInput").value === "");
    check("leaving search mode empties the box", el("searchInput").value, "");
    check("...and forgets the keystroke that was waiting",
      state().searchInputTimer, null);
    // Both halves at once: the list goes back to the whole library and the
    // marks come off the document.
    check("...and says it has been left", saidThat("Search mode closed."), true);

    // Leaving a search that was not happening says nothing, because a toast
    // about nothing is noise.
    clearToasts();
    run("window.__t.exitSearchMode()");
    check("leaving when there was no search says nothing", said(), []);

    // And the clear button in the filter bar is the same thing.
    clearToasts();
    el("searchInput").value = "deployment";
    run('window.__t.state.jumpQuery = "deployment"');
    el("clearFilterBtn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitUntil(() => el("searchInput").value === "");
    check("the clear button in the filter bar leaves search mode too",
      [el("searchInput").value, saidThat("Search mode closed.")], ["", true]);

    // As is the close button on the floating bar.
    clearToasts();
    el("searchInput").value = "deployment";
    run('window.__t.state.jumpQuery = "deployment"');
    el("matchCloseBtn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitUntil(() => el("searchInput").value === "");
    check("...and so is the close button on the match bar",
      el("searchInput").value, "");
  }

  console.log("=== and typing in the box waits for the typing to stop ===");
  {
    /* A search per keystroke is a search per keystroke: the whole corpus is
     * scored each time. So the box waits a moment, and a second keystroke
     * inside that moment replaces the first rather than adding to it.
     */
    const timers = [];
    const realTimeout = window.setTimeout;
    Object.assign(window, {
      setTimeout: (fn, ms) => {
        if (ms === 160) {
          timers.push(fn);
          return timers.length;
        }

        return realTimeout(fn, ms);
      }
    });

    el("searchInput").value = "roll";
    el("searchInput").dispatchEvent(new window.Event("input", { bubbles: true }));
    el("searchInput").value = "rollback";
    el("searchInput").dispatchEvent(new window.Event("input", { bubbles: true }));
    check("two keystrokes in a moment are one search", timers.length, 2);
    check("...and only the last of them is still waiting",
      state().searchInputTimer, timers.length);

    timers[timers.length - 1]();
    await waitUntil(() => state().searchResultsQuery === "rollback"
      || state().filteredDocs.length >= 0);
    check("...which is the one that runs", state().searchInputTimer, null);

    Object.assign(window, { setTimeout: realTimeout });
    run("window.__t.exitSearchMode()");
  }
};
