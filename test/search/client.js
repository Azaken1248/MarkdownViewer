/* Part of the SEARCH suite. See search.test.js, which loads this.
 *
 * The client's own scorer, which is what the library falls back to when the
 * server cannot be reached — and which the comment at the top of
 * public/js/app/search.js says is "deliberately the same shape" as the
 * server's, "so the offline fallback ranks a library the way the server
 * would". Nothing was holding that.
 *
 * It is a scorer rather than an index: the whole corpus is in memory, a query
 * is tokenized, every document is scored, and the best few are shown. So the
 * checks here are about the ordering — which kind of match beats which — and
 * about the two things a scorer is easiest to get wrong: a query that matches
 * nothing, and a query that matches everything.
 */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const { loadScript, coreScriptPaths } = require("../app-source.js");

module.exports = (check) => {
  const ROOT = path.join(__dirname, "..", "..", "public");
  const page = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

  const dom = new JSDOM(page, { url: "https://docs.example/", runScripts: "outside-only" });
  const { window } = dom;

  /* The renderer, because one escape in the app is one escape, and app/text.js
   * asks markdown-core for it. marked and DOMPurify only have to be there.
   */
  window.marked = /** @type {any} */ ({ setOptions() {}, parse: (text) => String(text) });
  window.DOMPurify = /** @type {any} */ ({ sanitize: (value) => value });
  for (const file of coreScriptPaths(ROOT)) {
    loadScript(window, file);
  }

  // And the modules the scorer is a function of, in the order the page loads
  // them: each one's top-level `var` is what the next reads.
  for (const file of ["app/text.js", "app/dom.js", "app/state.js", "app/api.js",
    "app/library.js", "app/search.js"]) {
    loadScript(window, path.join(ROOT, "js", file));
  }

  const Search = window.AppSearch;
  const { state } = window.AppState;

  /* A library, and the text of each document where there is any — the scorer
   * reads the body out of the cache the page fills as documents are opened, so
   * a document nobody has opened is matched on its name alone.
   */
  const library = (docs) => docs.map((doc) => {
    if (doc.body !== undefined) {
      state.contentCache.set(doc.file, { content: doc.body });
    }

    return { updatedAt: "2026-01-01T00:00:00.000Z", ...doc };
  });

  const found = (query, docs) => Search.buildSuperSearchMatches(query, library(docs))
    .matches.map((one) => one.file);

  console.log("=== what a query is broken into ===");
  {
    check("a query is its words", Search.tokenizeSearchQuery("deploy the thing"),
      ["deploy", "the", "thing"]);
    // Two characters, because a one-letter token matches most of a library and
    // ranks none of it.
    check("...and a single letter is not one of them",
      Search.tokenizeSearchQuery("a deploy b"), ["deploy"]);
    check("...however it was spaced", Search.tokenizeSearchQuery("  deploy   now  "),
      ["deploy", "now"]);
    check("a query of nothing has no words", Search.tokenizeSearchQuery("   "), []);

    /* The terms the document view highlights, longest first — so that a
     * document matching both "deploy" and "deployment" marks the longer one
     * and does not leave "ment" unmarked after it.
     */
    check("the terms to mark in a document are longest first",
      Search.buildJumpSearchTerms("deploy deployment"), ["deploy deployment", "deployment", "deploy"]);
    check("...with anything the caller already has, and no duplicates",
      Search.buildJumpSearchTerms("deploy", ["Deploy", "rollback"]), ["rollback", "deploy"]);
  }

  console.log("=== and what it marks in what it found ===");
  {
    check("a match is marked", Search.highlightMatches("Deployment notes", ["deploy"]),
      "<mark>Deploy</mark>ment notes");
    check("...whatever case it was written in",
      Search.highlightMatches("DEPLOYMENT", ["deploy"]), "<mark>DEPLOY</mark>MENT");
    check("...every time it appears",
      Search.highlightMatches("deploy and deploy", ["deploy"]),
      "<mark>deploy</mark> and <mark>deploy</mark>");
    // Longest first, so "deployment" wins where both could match and the rest
    // of the word is not left outside the mark.
    check("...and the longest term wins where two could match",
      Search.highlightMatches("deployment", ["deploy", "deployment"]),
      "<mark>deployment</mark>");

    /* Escaped on the way out, because the text is a document's own title and
     * the result is set as markup. A document called `<script>` is a document
     * somebody uploaded.
     */
    check("the text is escaped, since it came from a document",
      Search.highlightMatches("<b>deploy</b>", ["deploy"]),
      "&lt;b&gt;<mark>deploy</mark>&lt;/b&gt;");
    // Including the part that matched, which is the half that is easy to
    // forget: a document called `<img onerror=…>` found by searching for
    // `<img` is markup going onto the page inside the mark.
    check("...the part that matched included",
      Search.highlightMatches("x<b>y", ["<b>"]), "x<mark>&lt;b&gt;</mark>y");
    check("...and so is nothing with no terms to mark",
      Search.highlightMatches("<b>x</b>", []), "&lt;b&gt;x&lt;/b&gt;");
    // A term that is a regular expression is a term, not a pattern: `.*` finds
    // documents called `.*`.
    check("a term that looks like a pattern is taken as the text it is",
      Search.highlightMatches("a.c and abc", [".c"]), "a<mark>.c</mark> and abc");
    check("nothing to mark is nothing marked", Search.highlightMatches(null, ["x"]), "");
    check("...and nothing to mark it with leaves the text alone",
      Search.highlightMatches("deploy"), "deploy");
  }

  console.log("=== which kind of match beats which ===");
  {
    const docs = [
      { file: "deploy-notes.md", title: "Deploy notes", folderName: "" },
      { file: "ops.md", title: "Operations", folderName: "Deploy" },
      { file: "rollback.md", title: "Rollback", folderName: "", body: "deploy with care" },
      { file: "unrelated.md", title: "Catering", folderName: "" }
    ];

    /* The order is the point: a name that starts with the query beats a folder
     * that contains it, which beats a body that mentions it — the same shape
     * the server's scorer uses, so switching to the offline fallback does not
     * reorder somebody's library under them.
     */
    check("a title that starts with the query comes first",
      found("deploy", docs), ["deploy-notes.md", "ops.md", "rollback.md"]);
    check("...and a document that mentions it nowhere is not a match",
      found("deploy", docs).includes("unrelated.md"), false);

    // A filename match counts even when the title does not: a document renamed
    // in the library keeps the name it was uploaded under.
    check("the filename counts as well as the title",
      found("rollback", docs), ["rollback.md"]);

    /* The loose match, which is what makes a mistyped query still find
     * something: the letters in order, anywhere in the name.
     */
    /* The loose match is deliberately generous, and it is only reached when
     * nothing else matched at all — and it only looks at the name, not at the
     * text, or every query would match every document that has any.
     */
    check("the letters in order are a match of last resort",
      found("dpy", docs), ["deploy-notes.md"]);
    check("...of the name, and not of the words in the document",
      found("ctrg", docs), ["unrelated.md"]);
    check("...and a letter the name does not have is not a match at all",
      found("dpqy", docs), []);
    // A document with no name at all has nothing to match loosely against,
    // which is a library that was handed something it should not have been.
    check("...and a document with no name is not matched by anything",
      found("dpy", [{ file: "", title: "", folderName: "" }]), []);

    check("a query of nothing finds nothing", found("   ", docs), []);
    check("...and so does a library of nothing", found("deploy", []), []);
  }

  console.log("=== and which document wins a tie ===");
  {
    /* Two documents matching equally well are ordered by when they were last
     * touched, because the one somebody was working on this morning is the one
     * they are looking for.
     */
    const docs = [
      { file: "old.md", title: "Deploy one", folderName: "", updatedAt: "2020-01-01T00:00:00.000Z" },
      { file: "new.md", title: "Deploy two", folderName: "", updatedAt: "2026-06-01T00:00:00.000Z" }
    ];
    check("the more recent of two equal matches comes first",
      found("deploy", docs), ["new.md", "old.md"]);

    // And with nothing to go on, by name — so the same library and the same
    // query give the same order twice.
    const undated = [
      { file: "b.md", title: "Deploy", folderName: "", updatedAt: "" },
      { file: "a.md", title: "Deploy", folderName: "", updatedAt: "" }
    ];
    check("...and two with no dates at all are ordered by name",
      found("deploy", undated), ["a.md", "b.md"]);
  }

  console.log("=== the line of the document a result shows ===");
  {
    const long = `${"filler ".repeat(40)}the deployment went fine${" more".repeat(40)}`;
    const matches = Search.buildSuperSearchMatches("deployment", library([
      { file: "long.md", title: "Notes", folderName: "", body: long },
      { file: "short.md", title: "Deployment", folderName: "", body: "" },
      { file: "elsewhere.md", title: "Deployment plan", folderName: "",
        body: "nothing about it here" }
    ])).matches;

    const snippetOf = (file) => matches.find((one) => one.file === file).snippet;

    check("a result shows the part of the document the query was found in",
      snippetOf("long.md").includes("the deployment went fine"), true);
    /* The earliest of the terms, not the last one looked at: a query of two
     * words shows the first of them that appears, which is where somebody
     * reading the result starts.
     */
    check("...from the earliest of the words, and not the last one looked at",
      Search.buildSuperSearchMatches("deploy rollback", library([
        { file: "both.md", title: "Notes", folderName: "",
          body: `deploy happens${" y".repeat(90)} rollback happens` }
      ])).matches[0].snippet.includes("deploy happens"), true);
    // With an ellipsis either side, because it is the middle of a document and
    // reads as a sentence that was cut rather than one that was written.
    check("...cut from the middle, and shown as cut",
      [snippetOf("long.md").startsWith("..."), snippetOf("long.md").endsWith("...")],
      [true, true]);

    // A document nobody has opened has no text to show; its name is the whole
    // of what is known about it.
    check("a document with no text says there is none to show",
      snippetOf("short.md"), "No preview available.");
    // And one whose text does not mention the query is shown from the top,
    // which is the most useful part of a document by default.
    check("...and one matched on its name alone is shown from the beginning",
      snippetOf("elsewhere.md"), "nothing about it here");

    const wordy = "x".repeat(400);
    check("...and a long one is cut rather than shown whole",
      Search.buildSuperSearchMatches("deployment", library([
        { file: "wordy.md", title: "Deployment", folderName: "", body: wordy }
      ])).matches[0].snippet.endsWith("..."), true);
  }

  console.log("=== and how many of them are offered at once ===");
  {
    /* Eight, then twelve more per press. A list that reveals everything at
     * once is a list somebody scrolls past rather than reads, and one that
     * reveals three at a time is one they press twenty times.
     */
    check("the panel offers a handful before anything is pressed",
      Search.SUPERSEARCH_LIMIT, 8);
    check("...and a page more each time it is", Search.SUPERSEARCH_PAGE_SIZE, 12);

    // Every match is returned, though: how many to show is the panel's
    // decision, not the scorer's.
    const many = Array.from({ length: 30 }, (_, at) => ({
      file: `doc-${at}.md`, title: `Deploy ${at}`, folderName: ""
    }));
    check("the scorer hands back everything that matched", found("deploy", many).length, 30);
  }

  console.log("=== which collection is searched ===");
  {
    /* The recycle bin is a different library. Searching while looking at it
     * searches what is in it, because a document somebody is trying to find in
     * the bin is in the bin.
     */
    state.docs = library([{ file: "live.md", title: "Deploy live", folderName: "" }]);
    state.deletedDocs = library([{ file: "gone.md", title: "Deploy gone", folderName: "" }]);

    state.isRecycleBinMode = false;
    check("the library is searched by default",
      Search.buildSuperSearchMatches("deploy").matches.map((one) => one.file), ["live.md"]);

    state.isRecycleBinMode = true;
    check("...and the recycle bin while that is what is on screen",
      Search.buildSuperSearchMatches("deploy").matches.map((one) => one.file), ["gone.md"]);
    state.isRecycleBinMode = false;
  }
};
