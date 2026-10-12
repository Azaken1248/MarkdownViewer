// Part of the DOM suite. See dom.test.js, which sets all this up and calls it.
//
// Finding the words inside the document you are already reading.
//
// The search panel finds documents; this finds the matches in the open one,
// marks them, and steps between them. docs/TESTING.md had it down as thin on
// purpose because the stepping is geometry — scrolling a match into view is
// not a thing jsdom can answer — but the finding and the marking are not, and
// they are where the rules live: what is skipped, which term wins when two
// match at the same place, and what happens to a mark when it is cleared.
module.exports = async (ctx) => {
  const { check, window, doc } = ctx;

  const run = (source) => window.eval(source);
  const state = () => run("window.__t.state");

  // A document of this suite's own making, so what is searched is known
  // rather than whatever the fixture happens to say.
  const docFrom = (html) => {
    const root = doc.createElement("div");
    root.innerHTML = html;
    return root;
  };

  // The marks, as text, in the order they appear.
  const marked = (root) => [...root.querySelectorAll("mark.doc-jump-highlight")]
    .map((one) => one.textContent);

  console.log("=== finding the words in the document on screen ===");
  {
    const root = docFrom("<p>The cart is in the Cart folder, carted twice.</p>");
    const found = run("window.__t.findDocumentTextMatches")(root, ["cart"]);
    check("every occurrence is found, whatever its case", found.length, 3);

    /* Code is not prose.
     *
     * Marking inside a fenced block rewrites what the reader is being shown
     * the exact bytes of, and marking inside a rendered diagram breaks the
     * SVG it was rendered into.
     */
    const mixed = docFrom(`
      <p>deploy here</p>
      <pre><code>deploy --now</code></pre>
      <div class="mermaid">deploy</div>
      <p>and deploy there</p>`);
    const prose = run("window.__t.findDocumentTextMatches")(mixed, ["deploy"]);
    check("code blocks are left alone", prose.length, 2);

    // Already-marked text is skipped too, or a second search over the same
    // document marks the inside of its own marks.
    const again = docFrom('<p>one <mark class="doc-jump-highlight">two</mark> three</p>');
    check("so is text that is already marked",
      run("window.__t.findDocumentTextMatches")(again, ["two"]).length, 0);

    /* The longest term wins where two could match.
     *
     * A query of "deploy deployment" has both as terms; matching the short
     * one first would leave "ment" unmarked beside a highlight, which reads
     * as the search having found the wrong thing.
     */
    const both = docFrom("<p>deployment</p>");
    const longest = run("window.__t.findDocumentTextMatches")(both, ["deploy", "deployment"]);
    check("the longest term wins where both could match", longest.length, 1);
    check("...and takes the whole word", longest[0].end - longest[0].start, 10);

    check("a term that is not there finds nothing",
      run("window.__t.findDocumentTextMatches")(root, ["zzz"]).length, 0);
  }

  console.log("=== marking them, and taking the marks off again ===");
  {
    const root = docFrom("<p>alpha beta alpha gamma alpha</p>");
    const found = run("window.__t.findDocumentTextMatches")(root, ["alpha"]);
    const nodes = run("window.__t.highlightDocumentMatches")(found, 1);

    check("each match becomes a mark", nodes.length, 3);
    check("...around the word it matched", marked(root), ["alpha", "alpha", "alpha"]);

    /* One of them is the one you are on, and the others are not.
     *
     * Wrapping runs from the end backwards so that the text offsets of the
     * earlier matches are still valid when they are reached — marking
     * forwards moves every match after the first one.
     */
    const active = root.querySelectorAll("mark.doc-jump-highlight-active");
    check("exactly one is the active one", active.length, 1);
    check("...the one that was asked for", active[0], nodes[1]);
    check("...and the rest are not",
      root.querySelectorAll("mark.doc-jump-highlight-passive").length, 2);

    // Put the document back as it was: a mark is a wrapper, and taking it off
    // has to leave the text, not an empty element or a lost word.
    const inContent = doc.getElementById("docContent");
    const before = inContent.textContent;
    inContent.appendChild(root);
    run("window.__t.clearDocumentJumpDecorations()");

    check("clearing takes every mark off", marked(inContent).length, 0);
    check("...leaving the words behind",
      inContent.textContent.includes("alpha beta alpha gamma alpha"), true);
    check("...and forgetting which document they were in", state().jumpMatchFile, null);

    root.remove();
    check("(the document is as it was)", inContent.textContent, before);
  }

  console.log("=== whether this is the same search as last time ===");
  {
    // What decides between re-using the marks already on the page and
    // rebuilding them, which is why order counts as a difference.
    const same = run("window.__t.areSameJumpTerms");
    check("the same terms in the same order are the same", same(["a", "b"], ["a", "b"]), true);
    check("...in a different order are not", same(["a", "b"], ["b", "a"]), false);
    check("...and a longer list is not", same(["a"], ["a", "b"]), false);
    check("anything that is not a list is not", same("a", ["a"]), false);
  }
};
