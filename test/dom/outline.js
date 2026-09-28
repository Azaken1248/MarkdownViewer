// Part of the DOM suite. See dom.test.js, which starts the server it uses.
//
// The document outline: the headings of whatever is open, as a tree beside it.
//
// The anchors it points at are checked in the markdown suite, which has the
// real marked; this suite stands marked in with the two functions it needs.
// What is checked here is the shape of the outline against the document it
// came from, and what is easy to get wrong the moment a second document is
// opened: that it is rebuilt, and that it disappears when there is nothing
// left to list.

module.exports = async (ctx) => {
  const { check, window, doc } = ctx;

  const outline = () => doc.getElementById("docIndexBody");
  const links = () => [...outline().querySelectorAll(".doc-index-link")];
  const AppDocIndex = window.AppDocIndex;

  console.log("=== the outline is the document's headings, nested ===");

  const tree = AppDocIndex.nest([
    { id: "a", text: "A", level: 1 },
    { id: "b", text: "B", level: 2 },
    { id: "c", text: "C", level: 3 },
    { id: "d", text: "D", level: 2 },
    { id: "e", text: "E", level: 1 }
  ]);

  check("a level is a level", tree.map((one) => one.id), ["a", "e"]);
  check("...and what sits under it is under it", tree[0].children.map((one) => one.id), ["b", "d"]);
  check("...however deep", tree[0].children[0].children.map((one) => one.id), ["c"]);

  // A document that starts at h3 is not malformed, it just starts there.
  const shallow = AppDocIndex.nest([
    { id: "x", text: "X", level: 3 },
    { id: "y", text: "Y", level: 4 }
  ]);
  check("a document that starts deep starts at the top of its own tree",
    [shallow.length, shallow[0].children.length], [1, 1]);

  // A jump from h2 straight to h4 means the h4 belongs to the h2, not to a
  // level that is not in the document.
  const jumped = AppDocIndex.nest([
    { id: "p", text: "P", level: 2 },
    { id: "q", text: "Q", level: 4 }
  ]);
  check("a skipped level does not invent one", jumped[0].children.map((one) => one.id), ["q"]);

  console.log("=== and it follows whatever document is open ===");

  /* The content is put on the page directly rather than rendered from
   * markdown: this suite stands marked in with the two functions it needs, so
   * there is no markdown pass here to produce headings. What is under test is
   * the outline's reading of a document, not the making of one.
   */
  const content = doc.getElementById("docContent");
  const kept = content.innerHTML;

  const show = (html) => {
    content.innerHTML = html;
    AppDocIndex.refresh();
  };

  show([
    '<h1 id="title">Title</h1>',
    '<h2 id="first">First</h2>',
    '<h3 id="deeper">Deeper</h3>',
    '<h2 id="second">Second</h2>'
  ].join(""));

  check("one entry per heading", links().length, 4);
  check("...reading the document in order",
    links().map((link) => link.textContent), ["Title", "First", "Deeper", "Second"]);
  check("...each pointing at an anchor that is on the page",
    links().every((link) => doc.querySelector(`#docContent ${link.getAttribute("href")}`)), true);
  check("...and nested the way the levels say",
    outline().querySelectorAll(":scope > ul > li").length, 1);
  check("the toggle is offered", doc.getElementById("docIndexToggleBtn").hidden, false);

  // A heading with children gets a control that says whether they are showing;
  // one without gets no control to press.
  check("a branch says whether it is open",
    outline().querySelector(".doc-index-caret[aria-expanded]").getAttribute("aria-expanded"), "true");
  check("...and a leaf offers nothing to press",
    outline().querySelectorAll(".doc-index-caret.is-empty").length > 0, true);

  // A heading with no id is a heading nothing can link to, so it is left out
  // rather than listed as a link that goes nowhere.
  show('<h1 id="has-one">Has one</h1><h2>No id</h2><h2 id="also">Also</h2>');
  check("a heading with no anchor is not listed",
    links().map((link) => link.textContent), ["Has one", "Also"]);

  // A document with one heading is a document with a title, not an outline.
  show('<h1 id="only">Only one</h1><p>Nothing to list.</p>');
  check("a document with a single heading offers no outline",
    doc.getElementById("docIndexToggleBtn").hidden, true);
  check("...and the panel is not left open behind it",
    doc.getElementById("docIndex").hidden, true);

  show('<h1 id="back">Back</h1><h2 id="again">Again</h2>');
  check("and it comes back for a document that has them",
    doc.getElementById("docIndexToggleBtn").hidden, false);

  content.innerHTML = kept;
  AppDocIndex.refresh();
};
