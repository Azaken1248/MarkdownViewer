// The visual editor, and above all its round trip.
//
// A WYSIWYG markdown editor earns its keep or destroys documents depending on
// one property: what happens to the parts you did not touch. So the first and
// largest block here is the identity — splitting a document into blocks and
// joining them back must reproduce the input byte for byte, for every document
// in the real library as well as for the awkward shapes fixtures cover.
//
// Everything else follows from that: if the identity holds, an edit can only
// affect the block it was made in.

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..", "public");

// The module is a plain script that hangs itself off the global, the same way
// the browser loads it.
global.window = globalThis;
require(path.join(ROOT, "js", "visual-editor.js"));
const VE = globalThis.VisualEditor;

// The flowchart builder's model, loaded the same way and tested here for the
// same reason: it is the other half of "edit this without retyping it".
require(path.join(ROOT, "js", "diagram-model.js"));
const DM = globalThis.DiagramModel;

// And the drawing, which is what makes writing the layout down worth doing: a
// diagram that says where its boxes are is one this app can draw itself.
require(path.join(ROOT, "js", "diagram-draw.js"));
const DD = globalThis.DiagramDraw;

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

function roundTrips(markdown) {
  return VE.joinBlocks(VE.splitBlocks(markdown)) === markdown;
}

// Every document actually on this machine. Fixtures cover what someone thought
// of; this covers what is there.
function walkDocuments(dir) {
  let out = [];
  let entries = [];

  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out = out.concat(walkDocuments(full));
    } else if (/\.(md|markdown|mmd|mermaid)$/i.test(entry.name)) {
      out.push(full);
    }
  }

  return out;
}

console.log("=== splitting and rejoining is the identity ===");
{
  const shapes = {
    "an empty document": "",
    "a single word with no newline": "hello",
    "a single line with a newline": "hello\n",
    "trailing blank lines": "hello\n\n\n\n",
    "leading blank lines": "\n\n# Title\n",
    "no trailing newline after a heading": "# Title",
    "windows line endings": "# Title\r\n\r\nBody\r\n",
    "a heading and a paragraph": "# Title\n\nSome text.\n",
    "consecutive headings": "# One\n## Two\n### Three\n",
    "a fenced block": "```js\nconst x = 1;\n```\n",
    "a fence containing blank lines": "```\n\n\n```\n",
    "an unclosed fence": "```js\nconst x = 1;\n",
    "a fence containing what looks like markdown": "```\n# not a heading\n- not a list\n```\n",
    "a tilde fence": "~~~python\nx = 1\n~~~\n",
    "an indented fence": "  ```\n  x\n  ```\n",
    "a table": "| a | b |\n| - | - |\n| 1 | 2 |\n",
    "a table with no leading pipe": "a | b\n--- | ---\n1 | 2\n",
    "a list": "- one\n- two\n",
    "a list with blank lines between items": "- one\n\n- two\n",
    "a nested list": "- one\n  - deeper\n    - deeper still\n- two\n",
    "an ordered list starting at 4": "4. four\n5. five\n",
    "a task list": "- [ ] todo\n- [x] done\n",
    "a list followed by a paragraph": "- one\n\nAfter.\n",
    "a blockquote": "> quoted\n> more\n",
    "front matter": "---\ntitle: x\n---\n\n# Body\n",
    "front matter closed with dots": "---\ntitle: x\n...\n\nBody\n",
    "something that looks like front matter but is not": "---\n\nnot front matter\n",
    "a thematic break": "---\n\ntext\n",
    "math": "$$\nx = 1\n$$\n",
    "raw html": "<div class=\"x\">\n  <p>hi</p>\n</div>\n",
    "a heading interrupting a paragraph": "text\n# heading\nmore\n",
    "a list interrupting a paragraph": "text\n- item\n",
    "tabs for indentation": "- one\n\ttab indented\n",
    "trailing whitespace on lines": "text   \nmore\t\n",
    "a lone pipe character": "a | b\n",
    "unicode and emoji": "# Café ☕\n\nnaïve — résumé 🎉\n",
    "a very long line": `${"x".repeat(5000)}\n`,
    "only blank lines": "\n\n\n",
    "a fence directly after a paragraph": "text\n```\ncode\n```\n"
  };

  for (const [label, source] of Object.entries(shapes)) {
    check(label, roundTrips(source), true);
  }
}

console.log("=== ...for every document in the real library ===");
{
  // Fixtures cover what someone thought of. The library covers what is
  // actually there, which is the set that matters.
  const docsDir = path.join(ROOT, "docs");
  const files = walkDocuments(docsDir);
  if (files.length === 0) {
    console.log("  (no documents on this machine; fixtures above still ran)");
  } else {
    const failed = files.filter((file) => !roundTrips(fs.readFileSync(file, "utf8")));
    const blocks = files.reduce((sum, file) => sum + VE.splitBlocks(fs.readFileSync(file, "utf8")).length, 0);
    console.log(`  (${files.length} documents, ${blocks} blocks)`);
    for (const file of failed.slice(0, 5)) {
      console.log(`      ${path.relative(docsDir, file)}`);
    }
    check("every real document survives the round trip", failed.length, 0);
  }
}

console.log("=== blocks are classified so the risky ones stay as source ===");
{
  const types = (source) => VE.splitBlocks(source).map((block) => block.type);

  check("a heading", types("# Title\n"), ["heading"]);
  check("a paragraph", types("text\n"), ["paragraph"]);
  check("blank runs are their own blocks", types("a\n\nb\n"), ["paragraph", "blank", "paragraph"]);
  check("a fence", types("```js\nx\n```\n"), ["fence"]);
  check("a table", types("| a |\n| - |\n"), ["table"]);
  check("math", types("$$\nx\n$$\n"), ["math"]);
  check("front matter", types("---\na: 1\n---\n"), ["frontmatter"]);
  check("a thematic break is not front matter", types("---\n\ntext\n"), ["hr", "blank", "paragraph"]);

  // The whole point of the classification: these are edited as markdown, never
  // rewritten from a rendering.
  const risky = ["fence", "table", "math", "html", "frontmatter"];
  for (const type of risky) {
    check(`${type} is not edited as rich text`, VE.isRich({ type }), false);
  }
  for (const type of ["heading", "paragraph", "list", "blockquote", "hr"]) {
    check(`${type} is`, VE.isRich({ type }), true);
  }

  check("a fence keeps its language", VE.splitBlocks("```python\nx\n```\n")[0].info, "python");
}

console.log("=== editing one block leaves the rest alone ===");
{
  const dom = new JSDOM("<!doctype html><body></body>");
  const doc = dom.window.document;
  global.document = doc;

  const source = [
    "---",
    "title: Deployment",
    "---",
    "",
    "# Deployment",
    "",
    "Run   the migration  first.",
    "",
    "| step | who |",
    "|------|-----|",
    "| one  | me  |",
    "",
    "```bash",
    "pm2 restart mdviewer",
    "```",
    ""
  ].join("\n");

  const blocks = VE.splitBlocks(source);
  check("the document splits into the expected shape",
    blocks.map((b) => b.type),
    ["frontmatter", "blank", "heading", "blank", "paragraph", "blank", "table", "blank", "fence"]);

  // Edit the paragraph, exactly as the DOM would hand it back.
  const edited = doc.createElement("div");
  edited.innerHTML = "<p>Run the <strong>migration</strong> first.</p>";
  const paragraphIndex = blocks.findIndex((b) => b.type === "paragraph");
  blocks[paragraphIndex].source = VE.serializeEditedBlock(edited);

  const out = VE.joinBlocks(blocks);
  check("the edited paragraph is rewritten",
    out.includes("Run the **migration** first."), true);

  // The irregular spacing in the untouched blocks is the tell: a whole-document
  // round trip would have normalised the table's padding and the front matter.
  check("the table keeps its own spacing", out.includes("| one  | me  |"), true);
  check("the front matter is untouched", out.startsWith("---\ntitle: Deployment\n---\n"), true);
  check("the fence is untouched", out.includes("```bash\npm2 restart mdviewer\n```"), true);
  check("...and nothing else moved",
    out.split("\n").length, source.split("\n").length);
}

console.log("=== rendered HTML becomes markdown again ===");
{
  const dom = new JSDOM("<!doctype html><body></body>");
  const doc = dom.window.document;
  global.document = doc;

  const md = (html) => {
    const el = doc.createElement("div");
    el.innerHTML = html;
    return VE.elementToMarkdown(el);
  };

  check("a heading", md("<h2>Title</h2>"), "## Title");
  check("bold", md("<p>a <strong>b</strong> c</p>"), "a **b** c");
  check("italic", md("<p>a <em>b</em> c</p>"), "a *b* c");
  check("strikethrough", md("<p>a <del>b</del> c</p>"), "a ~~b~~ c");
  check("inline code", md("<p>use <code>npm ci</code></p>"), "use `npm ci`");
  check("a link", md('<p><a href="https://x.example">x</a></p>'), "[x](https://x.example)");
  check("an image", md('<p><img src="a.png" alt="A">'), "![A](a.png)");
  check("a bullet list", md("<ul><li>one</li><li>two</li></ul>"), "- one\n- two");
  check("an ordered list", md("<ol><li>one</li><li>two</li></ol>"), "1. one\n2. two");
  check("a nested list", md("<ul><li>one<ul><li>deep</li></ul></li></ul>"), "- one\n  - deep");
  check("a blockquote", md("<blockquote><p>quoted</p></blockquote>"), "> quoted");
  check("a rule", md("<hr>"), "---");
  check("two paragraphs", md("<p>one</p><p>two</p>"), "one\n\ntwo");

  // Code content is literal, so the escaping the text branch adds must not
  // reach inside it.
  check("code content is not escaped", md("<p><code>a*b*c</code></p>"), "`a*b*c`");
  check("...and a backtick inside gets a longer fence",
    md("<p><code>a ` b</code></p>").includes("``"), true);

  // Text that would otherwise start behaving like markup.
  check("an asterisk in text is escaped", md("<p>2 * 3</p>"), "2 \\* 3");
  check("a leading hash is escaped", md("<p># not a heading</p>"), "\\# not a heading");
  check("a leading dash is escaped", md("<p>- not a list</p>"), "\\- not a list");
  check("underscores in identifiers are left alone", md("<p>snake_case_name</p>"), "snake_case_name");

  check("an emptied block serializes to nothing", VE.serializeEditedBlock(doc.createElement("div")), "");
}

console.log("=== a table is edited as a table ===");
{
  const dom = new JSDOM("<!doctype html><body></body>");
  const doc = dom.window.document;
  global.document = doc;

  // Reading a row. The outer pipes are optional in GFM, so an empty cell that
  // came from one is not a cell.
  check("a row with outer pipes", VE.splitTableRow("| a | b |"), ["a", "b"]);
  check("a row without them", VE.splitTableRow("a | b"), ["a", "b"]);
  check("an escaped pipe stays in its cell", VE.splitTableRow("| a \\| b | c |"), ["a \\| b", "c"]);
  check("a genuinely empty cell survives", VE.splitTableRow("| a |  | c |"), ["a", "", "c"]);

  // Alignment is declared in the delimiter row and is the one thing about a
  // table that formatted text cannot show back.
  check("alignments are read from the delimiter row",
    VE.tableAlignments("| a | b | c | d |\n| --- | :-- | :-: | --: |\n"),
    ["", "left", "center", "right"]);

  // Writing one back.
  const table = VE.serializeTable([["h1", "h2"], ["a", "bbbb"]], ["", "center"]);
  check("columns are padded to a consistent width",
    table, "| h1  | h2   |\n| --- | :--: |\n| a   | bbbb |\n");
  check("...and it parses back to the same grid",
    VE.splitTableRow(table.split("\n")[2]), ["a", "bbbb"]);
  check("...with the alignment intact", VE.tableAlignments(table), ["", "center"]);
  check("a column narrower than its rule is still legible",
    VE.serializeTable([["a"], ["b"]], ["right"]), "| a   |\n| ---: |\n| b   |\n".replace("---:", "--:"));

  // And from the DOM, which is what editing a cell actually produces.
  const host = doc.createElement("div");
  host.innerHTML = "<table><thead><tr><th>step</th><th>who</th></tr></thead>"
    + "<tbody><tr><td>one</td><td><strong>me</strong></td></tr></tbody></table>";
  check("a rendered table serializes back to markdown",
    VE.tableElementToMarkdown(host.querySelector("table"), ["", "right"]),
    "| step | who    |\n| ---- | -----: |\n| one  | **me** |\n");

  // A pipe typed into a cell would otherwise end the cell.
  const piped = doc.createElement("div");
  piped.innerHTML = "<table><tr><th>a|b</th></tr><tr><td>c</td></tr></table>";
  check("a pipe typed into a cell is escaped",
    VE.tableElementToMarkdown(piped.querySelector("table"), []).includes("a\\|b"), true);

  // Rows of different lengths are the normal result of adding a column.
  check("a short row is padded out",
    VE.serializeTable([["a", "b"], ["c"]], []), "| a   | b   |\n| --- | --- |\n| c   |     |\n");
}

console.log("=== a fence is edited as code ===");
{
  const fence = VE.parseFence("```js\nconst x = 1;\n```\n");
  check("the language is read", fence.info, "js");
  check("the body is the code and nothing else", fence.body, "const x = 1;");
  check("...and the fence knows it was closed", fence.closed, true);

  check("a tilde fence keeps its marker", VE.parseFence("~~~py\nx\n~~~\n").marker, "~~~");
  check("a longer fence keeps its length", VE.parseFence("````\na\n````\n").marker, "````");
  check("an unclosed fence is known to be unclosed", VE.parseFence("```js\nx\n").closed, false);
  check("...and its body is not eaten by the missing close", VE.parseFence("```js\nx\n").body, "x");
  check("an indented fence keeps its indent", VE.parseFence("  ```\n  x\n  ```\n").indent, "  ");

  // Writing back: the shape of the fence is preserved, only the code changes.
  check("editing the code keeps the fence",
    VE.serializeFence({ ...VE.parseFence("~~~py\nx = 1\n~~~\n"), body: "x = 2" }),
    "~~~py\nx = 2\n~~~\n");
  check("changing the language keeps the code",
    VE.serializeFence({ ...VE.parseFence("```\nx\n```\n"), info: "sh" }),
    "```sh\nx\n```\n");
  check("an unclosed fence is not quietly closed",
    VE.serializeFence(VE.parseFence("```js\nx\n")), "```js\nx\n");
  check("an emptied fence is still a fence",
    VE.serializeFence({ ...VE.parseFence("```js\nx\n```\n"), body: "" }), "```js\n```\n");

  // A blank line at the end of a shell script is a line, and stripping it would
  // rewrite fences nobody edited.
  check("a trailing blank line inside the fence is kept",
    VE.parseFence("```sh\nrun\n\n```\n").body, "run\n");
  check("...and written back", VE.serializeFence(VE.parseFence("```sh\nrun\n\n```\n")), "```sh\nrun\n\n```\n");

  // An indented fence's indentation belongs to the fence, not to the code: it
  // is stripped before the code is shown and put back around it afterwards.
  check("the indent is not counted as code", VE.parseFence("  ```\n  x\n  ```\n").body, "x");
  check("...and comes back on the way out",
    VE.serializeFence(VE.parseFence("  ```\n  x\n  ```\n")), "  ```\n  x\n  ```\n");

  // Round trip through both halves, for a fence nobody touched the shape of.
  for (const source of ["```js\nconst x = 1;\n```\n", "~~~~text\na\n\nb\n~~~~\n", "```\n```\n"]) {
    check(`parse then serialize is the identity for ${JSON.stringify(source)}`,
      VE.serializeFence(VE.parseFence(source)), source);
  }
}

console.log("=== every fence in the real library survives being parsed and written back ===");
{
  const docsDir = path.join(ROOT, "docs");
  const files = walkDocuments(docsDir);

  let fences = 0;
  const broken = [];

  for (const name of files) {
    const source = fs.readFileSync(name, "utf8");
    for (const block of VE.splitBlocks(source)) {
      if (block.type !== "fence") {
        continue;
      }

      fences += 1;
      if (VE.serializeFence(VE.parseFence(block.source)) !== block.source) {
        broken.push(`${path.relative(docsDir, name)}: ${JSON.stringify(block.source.slice(0, 40))}`);
      }
    }
  }

  console.log(`  (${fences} fences in ${files.length} documents)`);
  check("an untouched fence comes back exactly as it was", broken.slice(0, 5), []);
}

console.log("=== an image survives being pasted into a block ===");
{
  const dom = new JSDOM("<!doctype html><body></body>");
  const block = (html) => {
    const node = dom.window.document.createElement("div");
    node.innerHTML = html;
    return node;
  };

  check("an image inside a paragraph is written back",
    VE.serializeEditedBlock(block('<p>See <img src="/api/assets/a.png" alt="a shot"> here.</p>')),
    "See ![a shot](/api/assets/a.png) here.\n");

  // Pasting at the end of a block drops the image in beside the paragraph
  // rather than inside it. Serializing only the children of that node would
  // lose the picture silently, which is the worst way to lose one.
  check("...and so is one left beside the paragraph",
    VE.serializeEditedBlock(block('<p>Before.</p><img src="/api/assets/b.png" alt="b">')),
    "Before.\n\n![b](/api/assets/b.png)\n");

  check("an image on its own is a block of its own",
    VE.serializeEditedBlock(block('<img src="/api/assets/c.png" alt="">')),
    "![](/api/assets/c.png)\n");

  // The same rule must not resurrect elements that genuinely hold nothing.
  check("an empty paragraph is still nothing",
    VE.serializeEditedBlock(block("<p></p>")), "");
  check("...and an empty block is still empty",
    VE.serializeEditedBlock(block("<p></p><div></div>")), "");
}

console.log("=== a checkbox is one character in the file ===");
{
  const doc = [
    "# Jobs",                     // 0
    "",                           // 1
    "- [ ] one",                  // 2
    "- [x] two",                  // 3
    "  - [ ] nested",             // 4
    "",                           // 5
    "> - [x] quoted",             // 6
    "",                           // 7
    "1. [ ] numbered",            // 8
    "",                           // 9
    "```md",                      // 10
    "- [ ] not a checkbox",       // 11
    "```",                        // 12
    "",                           // 13
    "- [x]tight is not one either",
    ""
  ].join("\n");

  const markers = VE.taskMarkers(doc);

  // Five: the fenced one is code and the tight one has no space after the
  // bracket, so a renderer makes a checkbox of neither.
  check("every real task is found, and nothing else is", markers.length, 5);
  check("...with the ticked ones known apart",
    markers.map((m) => m.checked), [false, true, false, true, false]);
  check("each marker points at the character between the brackets",
    markers.map((m) => doc[m.index]), [" ", "x", " ", "x", " "]);
  check("the last one found is the numbered task, so the fence was skipped",
    doc.slice(markers[4].index).startsWith(" ] numbered"), true);

  // The whole point of an offset: the edit cannot reach anything else.
  const ticked = VE.setTaskMarker(doc, markers[0].index, true);
  check("ticking changes exactly one character", ticked.length, doc.length);
  check("...and it is the right one", ticked.includes("- [x] one"), true);
  check("...leaving every other byte alone",
    [...doc].filter((c, i) => c !== ticked[i]).length, 1);
  check("clearing it puts the file back exactly as it was",
    VE.setTaskMarker(ticked, markers[0].index, false), doc);

  check("a nested task is reachable", VE.setTaskMarker(doc, markers[2].index, true).includes("  - [x] nested"), true);
  check("so is one in a quote", VE.setTaskMarker(doc, markers[3].index, false).includes("> - [ ] quoted"), true);
  check("so is a numbered one", VE.setTaskMarker(doc, markers[4].index, true).includes("1. [x] numbered"), true);

  // An offset that no longer exists must not be able to corrupt the file.
  check("an index past the end changes nothing", VE.setTaskMarker(doc, doc.length, true), doc);
  check("a nonsense index changes nothing", VE.setTaskMarker(doc, -1, true), doc);
}

console.log("=== every task marker in the real library round-trips ===");
{
  const docsDir = path.join(ROOT, "docs");
  const files = walkDocuments(docsDir);

  let tasks = 0;
  const broken = [];

  for (const name of files) {
    const source = fs.readFileSync(name, "utf8");
    for (const marker of VE.taskMarkers(source)) {
      tasks += 1;

      // Whatever it says now, saying it again must leave the file identical.
      if (VE.setTaskMarker(source, marker.index, marker.checked) !== source) {
        broken.push(`${path.relative(docsDir, name)} @ ${marker.index}`);
      }
    }
  }

  console.log(`  (${tasks} tasks in ${files.length} documents)`);
  check("writing a task's own state back is a no-op", broken.slice(0, 5), []);
}

console.log("=== the flowchart builder reads a diagram ===");
{
  // Same shape of question as the block splitter above, one level down: a
  // diagram is opened in the builder only if the builder can account for all of
  // it, so what matters is what it accepts and — just as much — what it will
  // not touch.
  const shapes = {
    "an arrow": ["flowchart TD\n  A[Start] --> B[End]\n", 2, 1],
    "a chain": ["graph LR\n  A-->B-->C\n", 3, 2],
    "graph, not flowchart": ["graph TD\n  A --> B\n", 2, 1],
    "a header with no direction": ["flowchart\n  A --> B\n", 2, 1],
    "labels in pipes": ["flowchart TD\n  A -->|yes| B\n", 2, 1],
    "a label inside the arrow": ["flowchart TD\n  A-- maybe -->B\n", 2, 1],
    "dotted and thick links": ["flowchart TD\n  A-.->B\n  A==>C\n", 3, 2],
    "a long arrow": ["flowchart TD\n  A ----> B\n", 2, 1],
    "a long line": ["flowchart TD\n  A ---- B\n", 2, 1],
    "every bracket shape": ["flowchart TD\n  A([a]) --> B[[b]] --> C[(c)] --> D((d)) --> E{{e}} --> F{f} --> G>g]\n", 7, 6],
    "slanted shapes": ["flowchart TD\n  A[/a/] --> B[\\b\\] --> C[/c\\] --> D[\\d/]\n", 4, 3],
    "hyphenated ids": ["flowchart TD\n  my-node[Text] --> other-node\n", 2, 1],
    "quoted text with a bracket in it": ["flowchart TD\n  A[\"a [weird] label\"] --> B\n", 2, 1],
    "trailing semicolons": ["flowchart TD\n  A --> B;\n  B --> C;\n", 3, 2],
    "blank lines": ["flowchart TD\n\n  A --> B\n\n", 2, 1]
  };

  for (const [label, [source, nodes, edges]] of Object.entries(shapes)) {
    const model = DM.parseFlowchart(source);
    check(label, model.ok && [model.nodes.length, model.edges.length], [nodes, edges]);
  }

  // The one that "A-->B" gets wrong if a hyphen is simply allowed in an id:
  // the id swallows the arrow and the diagram becomes a single node.
  check("an arrow with no spaces around it is still an arrow",
    DM.parseFlowchart("flowchart TD\n  A-->B\n").nodes.map((node) => node.id), ["A", "B"]);
  check("...and so is a long one",
    DM.parseFlowchart("flowchart TD\n  A----B\n").nodes.map((node) => node.id), ["A", "B"]);

  // A node mentioned before it is declared still ends up with what it declares.
  check("a declaration anywhere names the node",
    DM.parseFlowchart("flowchart TD\n  A --> B\n  B[End]\n").nodes[1],
    { id: "B", shape: "rect", text: "End" });
  check("a node never declared is named after itself",
    DM.parseFlowchart("flowchart TD\n  A --> B\n").nodes[1],
    { id: "B", shape: "rect", text: "B" });
}

console.log("=== ...and refuses the ones it cannot account for ===");
{
  // The refusals are the safety property. Opening one of these in a builder
  // that models only steps and arrows would write back a diagram with the rest
  // of it deleted, which is the failure mode this whole file exists to prevent.
  const refused = {
    "a link style": "flowchart TD\n  A --> B\n  linkStyle 0 stroke:#f00\n",
    "a click handler": "flowchart TD\n  A --> B\n  click A href \"https://x\"\n",
    "a comment": "flowchart TD\n  %% a note\n  A --> B\n",
    "a sequence diagram": "sequenceDiagram\n  A->>B: hi\n",
    "a pie chart": "pie title x\n  \"a\" : 1\n",
    "a state diagram": "stateDiagram-v2\n  [*] --> Still\n",
    "nothing at all": "",
    // The new syntax has its own ways of being wrong, and each of them is a
    // diagram that would come back different if it were read anyway.
    "a subgraph left open": "flowchart TD\n  subgraph one\n  A --> B\n",
    "an end with nothing open": "flowchart TD\n  A --> B\n  end\n",
    "a class given to a box that is not there":
      "flowchart TD\n  A --> B\n  classDef big fill:#f00\n  class Z big\n",
    "a classDef nobody can read": "flowchart TD\n  A --> B\n  classDef big nonsense\n",
    "a box and a group sharing a name":
      "flowchart TD\n  A[Box]\n  subgraph A\n  B --> C\n  end\n",
    "a style on a box that is not there":
      "flowchart TD\n  A --> B\n  style Z fill:#f00\n"
  };

  for (const [label, source] of Object.entries(refused)) {
    const model = DM.parseFlowchart(source);
    check(label, model.ok === true, false);
    check(`...${label} says why`, typeof model.reason === "string" && model.reason.length > 0, true);
  }

  // Size is no longer one of them. It used to be, because every menu in the old
  // panel named every step and the rows were quadratic in the diagram; the page
  // editor has no such shape, the document has to draw a diagram of any size,
  // and a canvas you can browse for ever cannot refuse the thing on it.
  const wide = ["flowchart TD"];
  for (let n = 0; n <= 400; n += 1) {
    wide.push(`  a${n}[Step ${n}]`);
  }

  const huge = DM.parseFlowchart(`${wide.join("\n")}\n`);
  check("a diagram far past the old row limit opens anyway", huge.ok, true);
  check("...with every box in it", huge.nodes.length, 401);
}

console.log("=== a trip through the builder loses nothing it could see ===");
{
  // Not source to source: a diagram is rewritten properly when it is edited,
  // the same way a table is. Model to model, though, has to be exact, or an
  // edit to one box quietly changes another.
  const sources = [
    "flowchart TD\n  A[Start] --> B[End]\n",
    "graph LR\n  A-->B-->C-->A\n",
    "flowchart BT\n  A{Choose} -->|yes| B(Go)\n  A -->|no| C([Stop])\n",
    "flowchart RL\n  A[[a]] -.-> B[(b)] ==> C((c)) --- D{{d}}\n",
    "flowchart TD\n  A[/a/] --> B[\\b\\] --> C[/c\\] --> D[\\d/] --> E>e]\n",
    "flowchart TD\n  A[\"a [weird] label\"] -->|\"a | pipe\"| B\n",
    "flowchart TD\n  A[\"say #quot;hi#quot;\"] --> B\n",
    "flowchart TD\n  first-step[One] --> second-step[Two]\n",
    "flowchart TD\n  A(( )) --> B[]\n",
    "flowchart TD\n  A-- maybe -->B-. or .-C== so ==>D\n"
  ];

  for (const source of sources) {
    const model = DM.parseFlowchart(source);
    if (!model.ok) {
      check(`${JSON.stringify(source)} parses`, model.reason, "(parsed)");
      continue;
    }

    const again = DM.parseFlowchart(DM.serializeFlowchart(model));
    check(`${JSON.stringify(source)} survives the round trip`,
      JSON.stringify(again), JSON.stringify(model));
  }

  // And the reason the round trip can be trusted at all: what comes out is
  // still a flowchart, header and all.
  const written = DM.serializeFlowchart({
    direction: "LR",
    nodes: [{ id: "n1", shape: "diamond", text: "Ready?" }, { id: "n2", shape: "round", text: "Ship" }],
    edges: [{ from: "n1", to: "n2", kind: "arrow", label: "yes" }]
  });
  check("a model built from nothing writes a flowchart",
    written, "flowchart LR\n    n1{Ready?}\n    n2(Ship)\n    n1 -->|yes| n2\n");

  // Space around a label is invisible in a drawn diagram and is not kept, which
  // is the one thing here that deliberately does not survive.
  check("space around a label is dropped",
    DM.serializeFlowchart({ direction: "TD", nodes: [{ id: "A", shape: "rect", text: "  padded  " }], edges: [] }),
    "flowchart TD\n    A[padded]\n");

  // Text that would close its own bracket, or read as a link, has to come back
  // quoted or the diagram it writes will not parse.
  const dangerous = ["a [b] c", "a -- b", "one | two", "x == y", "a (b)", "a#b", "a\"b"];
  for (const text of dangerous) {
    const model = { direction: "TD", nodes: [{ id: "A", shape: "rect", text }], edges: [] };
    const back = DM.parseFlowchart(DM.serializeFlowchart(model));
    check(`text "${text}" survives being written back`, back.ok && back.nodes[0].text, text);
  }
}

console.log("=== a diagram says more than boxes and arrows ===");
{
  /* Everything here is real Mermaid, and that is the whole point of reading it.
   * A colour written as a classDef is a colour every other renderer can see; a
   * group written as a subgraph is a group GitHub draws. Only what Mermaid
   * cannot say at all — where a box is, what icon is on it — goes in comments.
   */

  // --- groups ---------------------------------------------------------------
  const grouped = DM.parseFlowchart([
    "flowchart LR",
    "  subgraph Backend [\"The back end\"]",
    "    direction TB",
    "    A[Postgres]",
    "    subgraph Inner",
    "      B[Cache]",
    "    end",
    "  end",
    "  C[Client]",
    "  C --> A"
  ].join("\n"));

  check("a subgraph is a group", grouped.ok && grouped.groups.map((g) => g.id), ["Backend", "Inner"]);
  check("...with the label it was given", grouped.groups[0].label, "The back end");
  check("...and one that names itself when it was given none", grouped.groups[1].label, "Inner");
  check("...nested where it was nested", grouped.groups[1].parent, "Backend");
  check("...keeping the direction it asked for", grouped.groups[0].direction, "TB");
  check("a box inside one belongs to it",
    grouped.nodes.map((node) => [node.id, node.parent || null]),
    [["C", null], ["A", "Backend"], ["B", "Inner"]]);

  // Mermaid lets a subgraph be nothing but a title, and invents an id for it.
  // So does this — and it writes that id into the file, so the group keeps the
  // same name from then on rather than being renamed on every save.
  const titled = DM.parseFlowchart([
    "flowchart TD",
    "  subgraph \"Query phase (60 fps)\"",
    "    A --> B",
    "  end"
  ].join("\n"));

  // Two of them in one diagram are two different groups, and two groups with
  // one name between them is a diagram that loses one of them on the next save.
  const twoTitles = DM.parseFlowchart([
    "flowchart TD",
    "  subgraph \"First\"",
    "    A[One]",
    "  end",
    "  subgraph \"Second\"",
    "    B[Two]",
    "  end"
  ].join("\n"));
  check("two subgraphs that are only titles get a name each",
    twoTitles.ok && twoTitles.groups.map((group) => group.id), ["group1", "group2"]);
  check("...and each keeps the boxes that were inside it",
    twoTitles.nodes.map((node) => [node.id, node.parent]), [["A", "group1"], ["B", "group2"]]);

  check("a subgraph that is only a title still opens", titled.ok, true);
  check("...with a name nothing else is using", titled.groups[0].id, "group1");
  check("...and the title as its label", titled.groups[0].label, "Query phase (60 fps)");
  check("...written into the file so it stays that way",
    DM.serializeFlowchart(titled).includes("subgraph group1 [\"Query phase (60 fps)\"]"), true);

  // --- colours --------------------------------------------------------------
  const coloured = DM.parseFlowchart([
    "flowchart TD",
    "  A[One]:::blue",
    "  B[Two]",
    "  A --> B",
    "  classDef blue fill:#2b6cb0,stroke:#1a365d",
    "  classDef bold stroke-width:3px",
    "  class B blue",
    "  class A bold",
    "  style B fill:#eee"
  ].join("\n"));

  check("a classDef is a colour", coloured.ok && coloured.classes.blue,
    { fill: "#2b6cb0", stroke: "#1a365d" });
  check("...and a box can wear more than one", coloured.nodes[0].classes, ["blue", "bold"]);
  check("...whether it was written inline or as a statement",
    coloured.nodes[1].classes, ["blue"]);
  check("a style is a colour on one box", coloured.nodes[1].style, { fill: "#eee" });

  // Two styles on one box are two halves of one look, not one replacing the
  // other — which is what Mermaid draws, and what anyone writing the second
  // line meant by writing it.
  const twice = DM.parseFlowchart([
    "flowchart TD",
    "  A[One]",
    "  style A fill:#eee",
    "  style A stroke:#333,stroke-width:2px"
  ].join("\n"));
  check("a second style on a box adds to the first",
    twice.ok && twice.nodes[0].style,
    { fill: "#eee", stroke: "#333", "stroke-width": "2px" });

  // The order a box's classes arrive in is the order they happen to be written
  // in, which is not the order they will be written back in: the file groups
  // them by class. So they are put into the file's order while they are read,
  // and the box that arrives wearing them backwards still comes back the same.
  const backwards = DM.parseFlowchart([
    "flowchart TD",
    "  A[One]:::bold",
    "  classDef blue fill:#2b6cb0",
    "  classDef bold stroke-width:3px",
    "  class A blue"
  ].join("\n"));
  check("the classes on a box are in the order the file will list them",
    backwards.ok && backwards.nodes[0].classes, ["blue", "bold"]);
  check("...so a box wearing them backwards still survives the round trip",
    JSON.stringify(DM.parseFlowchart(DM.serializeFlowchart(backwards))),
    JSON.stringify(backwards));

  // --- links ----------------------------------------------------------------
  const links = DM.parseFlowchart("flowchart TD\n  A <--> B\n  B <-.-> C\n  C --o D\n  D --x E\n");
  check("an arrow can point both ways",
    links.ok && links.edges.map((edge) => edge.kind),
    ["both", "dotted-both", "circle", "cross"]);

  // "A & B --> C & D" is four arrows. It is read as four and written back as
  // four, which draws identically — the shorthand is a spelling.
  const fanned = DM.parseFlowchart("flowchart TD\n  A & B --> C & D\n");
  check("a fan-out is every left to every right",
    fanned.ok && fanned.edges.map((edge) => `${edge.from}${edge.to}`),
    ["AC", "AD", "BC", "BD"]);

  // --- what Mermaid cannot say ---------------------------------------------
  const rich = [
    "flowchart TD",
    "    %% layout v1",
    "    %% @ A 40,40 160x56 kind=table icon=lucide:database layer=2 z=3",
    "    %% @ B 240,40 160x56 image=/assets/ab12cd.png",
    "    %% edge 0 sides=r,l via=210,68;210,120 ends=none,crow",
    "    %% layer 2 \"Back end\" locked hidden",
    "    A[\"Thing<br/>field: type\"]",
    "    B[Picture]",
    "    A --> B"
  ].join("\n");

  const model = DM.parseFlowchart(rich);
  check("a box can be a table, and says so on its own line", model.ok && model.nodes[0].kind, "table");
  check("...carry an icon", model.nodes[0].icon, "lucide:database");
  check("...belong to a layer, at a depth", [model.nodes[0].layer, model.nodes[0].z], [2, 3]);
  check("...and be a picture", model.nodes[1].image, "/assets/ab12cd.png");
  check("an arrow can leave and arrive by a named side", model.edges[0].sides, ["r", "l"]);
  check("...bend where it was bent",
    model.edges[0].waypoints, [{ x: 210, y: 68 }, { x: 210, y: 120 }]);
  check("...and end in something Mermaid has no spelling for", model.edges[0].ends, ["none", "crow"]);
  check("a layer has a name, and can be locked or hidden",
    model.layers, [{ id: 2, name: "Back end", locked: true, hidden: true }]);

  // The first version of the layout line put `table` on the end as a bare word.
  // Those files are out there, and they still open.
  const older = DM.parseFlowchart([
    "flowchart TD", "    %% layout v1", "    %% @ A 40,40 160x56 table", "    A[Rows]"
  ].join("\n"));
  check("a layout line from the first version of the format still reads",
    older.ok && older.nodes[0].kind, "table");

  // An editor that meets a key it has never heard of must not eat it: a diagram
  // written by a newer version and opened by an older one has to come back
  // whole, and the only way to promise that is never to throw anything away.
  const future = DM.parseFlowchart([
    "flowchart TD",
    "    %% layout v1",
    "    %% @ A 40,40 160x56 shadow=soft corner=\"top left\"",
    "    %% edge 0 curve=bezier",
    "    A[One]",
    "    B[Two]",
    "    A --> B"
  ].join("\n"));

  check("a key this version has never heard of is kept",
    future.ok && future.nodes[0].extra, { shadow: "soft", corner: "top left" });
  check("...on arrows too", future.edges[0].extra, { curve: "bezier" });
  check("...and written back exactly as it was found",
    DM.serializeFlowchart(future).includes("shadow=soft corner=\"top left\""), true);

  // An editor that takes a group apart can leave a box pointing at a group that
  // is no longer there. Whatever else that costs, it must not cost the box: a
  // file that has quietly lost one is worse than a box that has lost its group.
  const orphaned = DM.serializeFlowchart({
    direction: "TD",
    nodes: [
      { id: "A", shape: "rect", text: "Kept", parent: "Gone" },
      { id: "B", shape: "rect", text: "Here", parent: "Real" }
    ],
    edges: [],
    groups: [{ id: "Real", label: "Real", parent: "Gone" }]
  });
  check("a box in a group that is not there is still written down",
    /^\s+A\[Kept\]$/m.test(orphaned), true);
  check("...and so is a group whose own group is not there",
    orphaned.includes("subgraph Real"), true);
  check("...and reading it back finds both boxes",
    DM.parseFlowchart(orphaned).nodes.map((node) => node.id), ["A", "B"]);

  // A group inside itself is nowhere in the tree, so a walk of the tree never
  // arrives at it or at anything in it. Nobody can draw that diagram, but they
  // can open it and put it right — as long as the boxes are still in the file.
  const looped = DM.serializeFlowchart({
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", text: "Inside", parent: "Loop" }],
    edges: [],
    groups: [{ id: "Loop", label: "Loop", parent: "Loop" }]
  });
  check("a box in a group that contains itself is still written down",
    DM.parseFlowchart(looped).nodes.map((node) => node.id), ["A"]);

  // --- and all of it, twice --------------------------------------------------
  for (const [label, source] of Object.entries({
    "a grouped diagram": grouped,
    "a coloured one": coloured,
    "one with both-ways arrows": links,
    "a fanned-out one": fanned,
    "one carrying everything Mermaid cannot say": model,
    "one written by a later version": future
  })) {
    const back = DM.parseFlowchart(DM.serializeFlowchart(source));
    check(`${label} survives the round trip`, JSON.stringify(back), JSON.stringify(source));
  }

  // What comes out is a flowchart, not a flowchart with our things bolted on.
  const written = DM.serializeFlowchart(model);
  check("what is written is still a diagram Mermaid reads",
    /^flowchart TD\n(?:\s*%%.*\n)+\s+A\[/.test(written), true);
  check("...with every one of our lines a comment",
    written.split("\n").filter((line) => /^\s*%%/.test(line)).length, 5);
}

console.log("=== a diagram can say where its own boxes go ===");
{
  /* Mermaid has no coordinates in it, and every Mermaid parser throws comments
   * away. So the arrangement lives in comments: still a flowchart everywhere
   * else, drawn where it was left here.
   */
  const arranged = [
    "flowchart TD",
    "    %% layout v1",
    "    %% @ A 40,40 160x56",
    "    %% @ B 40,220 200x90 table",
    "    A[Start]",
    "    B[\"Person<br/>name: string\"]",
    "    A --> B"
  ].join("\n");

  const model = DM.parseFlowchart(arranged);
  check("a laid-out diagram still reads as a diagram", model.ok, true);
  check("...with the boxes it always had", model.nodes.map((node) => node.id), ["A", "B"]);
  check("...and where each of them is",
    model.layout.A, { x: 40, y: 40, w: 160, h: 56 });
  check("...while what each of them is belongs to the box, not to the place",
    model.nodes.find((node) => node.id === "B").kind, "table");
  check("a diagram nobody has arranged says so by having no layout at all",
    Object.prototype.hasOwnProperty.call(DM.parseFlowchart("flowchart TD\n  A --> B\n"), "layout"), false);
  check("...and is told apart without being parsed", DM.hasLayout(arranged), true);
  check("...from one that has not been", DM.hasLayout("flowchart TD\n  A --> B\n"), false);

  // Everything else beginning with %% is still refused, because keeping a
  // comment we do not understand means writing it back somewhere and there is
  // no somewhere.
  check("a comment that is not ours is still refused",
    DM.parseFlowchart("flowchart TD\n  %% a note\n  A --> B\n").ok, false);
  check("...including an init directive",
    DM.parseFlowchart("flowchart TD\n  %%{init: {'theme':'dark'}}%%\n  A --> B\n").ok, false);
  check("...and a position with no header above it",
    DM.parseFlowchart("flowchart TD\n  %% @ A 10,10 90x50\n  A --> B\n").ok, false);

  // A position for a box that is not in the diagram is a position for nothing.
  const stray = DM.parseFlowchart([
    "flowchart TD",
    "    %% layout v1",
    "    %% @ A 40,40 160x56",
    "    %% @ ghost 10,10 90x50",
    "    A[Start]"
  ].join("\n"));
  check("a position for a box that is not there is dropped",
    Object.keys(stray.layout), ["A"]);

  // The identity that matters, extended: what comes back out has to be what
  // went in, positions included, or dragging one box moves another.
  const trips = [
    arranged,
    "flowchart LR\n    %% layout v1\n    %% @ A -20,0 90x50\n    A[Only]",
    "flowchart TD\n    %% layout v1\n    A[No positions yet]"
  ];

  for (const source of trips) {
    const first = DM.parseFlowchart(source);
    const back = DM.parseFlowchart(DM.serializeFlowchart(first));
    check(`a laid-out diagram survives the round trip: ${source.split("\n")[0]} (${Object.keys(first.layout).length} placed)`,
      JSON.stringify(back), JSON.stringify(first));
  }

  // The format has no room for half a pixel, and half a pixel is not a
  // position anybody chose.
  const rounded = DM.serializeFlowchart({
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", text: "A" }],
    edges: [],
    layout: { A: { x: 40.4, y: 39.6, w: 90.2, h: 50.7, kind: "box" } }
  });
  check("a position is written as whole numbers", rounded.includes("%% @ A 40,40 90x51"), true);

  // A whole-file .mmd document is wrapped in a fence before it is rendered, and
  // the wrapper indents what it wraps. So every line of a laid-out diagram can
  // arrive with whitespace in front of it, including the lines that say where
  // the boxes are.
  const indented = arranged.split("\n").map((line) => `  ${line}`).join("\n");
  check("a diagram indented inside a fence is still a laid-out one",
    DM.hasLayout(indented), true);
  check("...and still reads the same", JSON.stringify(DM.parseFlowchart(indented).layout),
    JSON.stringify(model.layout));

  // And the comments go inside the diagram, after the line that says what it
  // is — the one place every Mermaid parser is certain to allow them.
  check("the layout is written under the header, not above it",
    rounded.indexOf("flowchart TD") < rounded.indexOf("%% layout v1"), true);
}

console.log("=== a diagram nobody has arranged is arranged on the way in ===");
{
  const model = DM.parseFlowchart("flowchart TD\n  A[Start] --> B[Middle] --> C[End]\n");
  const layout = DM.autoLayout(model);

  check("every box gets a place", Object.keys(layout).sort(), ["A", "B", "C"]);
  check("...following the flow of the diagram",
    layout.A.y < layout.B.y && layout.B.y < layout.C.y, true);
  check("...on the grid it will be dragged on",
    Object.values(layout).every((at) => at.x % DM.GRID === 0 && at.y % DM.GRID === 0), true);
  check("...clear of the edge of the paper",
    Object.values(layout).every((at) => at.x >= 0 && at.y >= 0), true);

  const overlapping = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const places = Object.values(layout);
  check("...and not on top of each other",
    places.some((a, i) => places.slice(i + 1).some((b) => overlapping(a, b))), false);

  const sideways = DM.autoLayout(DM.parseFlowchart("flowchart LR\n  A --> B\n"));
  check("a left-to-right diagram is laid out left to right",
    sideways.A.x < sideways.B.x && sideways.A.y === sideways.B.y, true);

  // A flowchart with a loop in it has no longest path. Ranking one anyway walks
  // the boxes round and round until a cap stops it, and the first step ends up
  // somewhere in the middle of the picture.
  const looped = DM.autoLayout(DM.parseFlowchart("flowchart TD\n  A --> B\n  B --> C\n  C --> A\n"));
  check("a loop does not scramble the order it is drawn in",
    looped.A.y < looped.B.y && looped.B.y < looped.C.y, true);

  // A box can arrive without a position — somebody edited the source by hand.
  // It has to be drawn somewhere, and somewhere is out of the way of everything
  // that already has one.
  const partial = DM.parseFlowchart([
    "flowchart TD",
    "    %% layout v1",
    "    %% @ A 40,40 160x56",
    "    A[Start]",
    "    B[Added by hand]",
    "    A --> B"
  ].join("\n"));
  const filled = DM.ensureLayout(partial);
  check("a box with no position gets one", Boolean(filled.B), true);
  check("...without moving the boxes that had one", filled.A, partial.layout.A);
  check("...and clear of them", filled.B.y >= filled.A.y + filled.A.h, true);

  // Bigger text needs a bigger box, and a box is only ever measured to start
  // with: a size somebody dragged to is a size they chose.
  const small = DM.measureNode({ text: "Go", shape: "rect" }, "box");
  const large = DM.measureNode({ text: "A much longer label than that", shape: "rect" }, "box");
  check("a longer label starts in a wider box", large.w > small.w, true);
  check("...and more lines in a taller one",
    DM.measureNode({ text: "one<br/>two<br/>three", shape: "rect" }, "box").h > small.h, true);
  check("a table's rows are the lines in its label",
    DM.textRows("Person<br/>name: string"), ["Person", "name: string"]);
  check("...and are written back the way Mermaid writes a line break",
    DM.joinRows(["Person", "name: string"]), "Person<br/>name: string");
}

console.log("=== an arrow goes round what is in its way ===");
{
  // The drawing is the other half of writing the layout down: nothing else on
  // the page knows where these boxes are, so nothing else can draw the lines
  // between them.
  const square = (x, y) => ({ x, y, w: 100, h: 60, kind: "box" });
  const layout = { A: square(0, 0), B: square(0, 300) };

  const straight = DD.routeEdge(layout, { from: "A", to: "B", kind: "arrow", label: "" });
  const corners = (route) => route.points.length;
  const axial = (route) => route.points.every((point, index) => index === 0
    || point[0] === route.points[index - 1][0]
    || point[1] === route.points[index - 1][1]);

  check("an arrow between two boxes in line is a straight line", corners(straight), 2);
  check("...leaving the box it comes from", straight.points[0], [50, 60]);
  check("...and arriving at the one it points to", straight.points[1], [50, 300]);

  // Put something between them and the arrow has to go round it rather than
  // through it.
  const blocked = { ...layout, C: square(0, 140) };
  const around = DD.routeEdge(blocked, { from: "A", to: "B", kind: "arrow", label: "" });
  check("an arrow with a box in its way turns", corners(around) > 2, true);
  check("...and every turn is a right angle", axial(around), true);

  const through = around.points.some((point, index) => index > 0
    && Math.min(around.points[index - 1][0], point[0]) < blocked.C.x + blocked.C.w
    && Math.max(around.points[index - 1][0], point[0]) > blocked.C.x
    && Math.min(around.points[index - 1][1], point[1]) < blocked.C.y + blocked.C.h
    && Math.max(around.points[index - 1][1], point[1]) > blocked.C.y);
  check("...so the box it went round is not crossed", through, false);

  // There and back again is most of what a loop in a flowchart is, and two
  // arrows drawn down the same line are one arrow.
  const spread = DD.lanes([
    { from: "A", to: "B", kind: "arrow", label: "" },
    { from: "B", to: "A", kind: "arrow", label: "" }
  ]);
  check("two arrows between the same boxes get their own lanes", spread[0] !== spread[1], true);
  check("...and one arrow does not need one", DD.lanes([{ from: "A", to: "B" }]), [0]);

  // A box that points at itself has nowhere to route to, so it goes out and
  // comes back.
  const loop = DD.routeEdge(layout, { from: "A", to: "A", kind: "arrow", label: "" });
  check("a box can point at itself", corners(loop) > 2, true);

  // The drawing is written as markup, so anything written in a box is text
  // rather than markup.
  const drawn = DD.render({
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", text: "<script>alert(1)</script>" }],
    edges: [],
    layout: { A: square(0, 0) }
  });
  check("a label is drawn as text, not as markup", drawn.includes("<script>"), false);
  check("...with the characters that made it dangerous still readable",
    drawn.includes("&lt;script&gt;"), true);
  check("a drawing is sized to what is in it", /viewBox="0 0 130 90"/.test(drawn), true);
}

console.log("=== ...for every diagram in the real library ===");
{
  // The same argument as the block splitter's library pass: fixtures cover what
  // someone thought of. What is actually on this machine covers the rest — and
  // a diagram the builder opens and then writes back differently is a diagram
  // it has damaged, which is the only failure here that matters.
  const files = walkDocuments(path.join(ROOT, "docs"));
  const drifted = [];
  let diagrams = 0;
  let buildable = 0;

  for (const file of files) {
    for (const block of VE.splitBlocks(fs.readFileSync(file, "utf8"))) {
      if (block.type !== "fence") {
        continue;
      }

      const fence = VE.parseFence(block.source);
      if (!/^mermaid\b/i.test(fence.info)) {
        continue;
      }

      diagrams += 1;
      const model = DM.parseFlowchart(fence.body);
      if (!model.ok) {
        continue;
      }

      buildable += 1;
      if (JSON.stringify(DM.parseFlowchart(DM.serializeFlowchart(model))) !== JSON.stringify(model)) {
        drifted.push(path.relative(ROOT, file));
      }
    }
  }

  console.log(`  (${diagrams} diagrams, ${buildable} of them the builder will open)`);
  check("no diagram the builder opens comes back different", drifted.slice(0, 5), []);
}

console.log("=== a new step needs an id nothing is using ===");
{
  check("the first id on an empty diagram", DM.nextNodeId({ nodes: [] }), "n1");
  check("...skips the ones already taken",
    DM.nextNodeId({ nodes: [{ id: "n1" }, { id: "n2" }, { id: "n4" }] }), "n3");
  check("...and does not care what else is in the diagram",
    DM.nextNodeId({ nodes: [{ id: "Start" }, { id: "End" }] }), "n1");
}

console.log("=== the previews are actually on the screen ===");
{
  // A source preview carries .markdown-body, and it carries it deliberately: it
  // is what makes an equation, a code block or a diagram inside it look the way
  // it will look once it is in the document.
  //
  // What comes with it is the article's own rules, which are about the article.
  // `.markdown-body { display: none }` waits for a document to be loaded, and
  // `.app-shell .markdown-body` adds the phone tier's 96px of dock clearance at
  // the bottom of the page. Applied to a preview a few hundred pixels up inside
  // that page, the first makes it invisible and the second hangs an empty
  // half-screen under it — so this is computed from the real stylesheet rather
  // than asserted as a string, because the bug is in the cascade and a regex
  // cannot see a cascade.
  //
  // The builder's canvas is deliberately not one of these. It is a drawing we
  // make ourselves rather than rendered markdown, so it has no reason to carry
  // the article's class and nothing to inherit from it.
  const stylesheet = fs.readFileSync(path.join(ROOT, "css", "app.css"), "utf8");
  const page = new JSDOM(`<style>${stylesheet}</style>
    <div class="app-shell"><article class="markdown-body doc-editing visible">
      <div class="ve-embed">
        <div class="ve-embed-preview markdown-body" id="source">x</div>
        <div class="ve-diagram-canvas" id="canvas">y</div>
        <div class="ve-embed-preview markdown-body" id="blank"></div>
      </div>
    </article></div>`);

  const styleOf = (id) => page.window.getComputedStyle(page.window.document.getElementById(id));

  check("a source preview is visible", styleOf("source").display, "block");
  check("a source preview keeps its own padding, not the document's",
    styleOf("source").paddingBottom, "10px");
  check("the canvas the diagram is drawn on is visible", styleOf("canvas").display, "block");
  check("...and scrolls its own paper rather than the page",
    styleOf("canvas").overflow, "auto");
  check("a preview of markdown that renders to nothing stays hidden",
    styleOf("blank").display, "none");
}

console.log(failures === 0 ? "\nALL VISUAL CHECKS PASSED" : `\n${failures} VISUAL CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
