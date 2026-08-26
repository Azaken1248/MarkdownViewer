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

console.log("=== finding a diagram again after the document moved under it ===");
{
  /* A diagram is edited on a page of its own, and the way back to the block it
   * came from is a line in the address bar. A block index alone will not do it:
   * insert a paragraph above while the editor is open and the index now points
   * at something else, and saving would write the diagram over a block nobody
   * touched. So the address carries the index and a hash of what was in the
   * fence, and the index is only believed while the hash still agrees.
   */
  const doc = [
    "# Title",
    "",
    "```mermaid",
    "flowchart TD",
    "  A --> B",
    "```",
    "",
    "Some prose.",
    "",
    "```mermaid",
    "flowchart LR",
    "  C --> D",
    "```",
    "",
    "```js",
    "notADiagram();",
    "```",
    ""
  ].join("\n");

  const found = VE.diagramFences(doc);
  check("every diagram in a document, and only the diagrams",
    found.map((one) => one.body.split("\n")[0]), ["flowchart TD", "flowchart LR"]);
  check("...each one saying where in the document it is",
    found.map((one) => one.index), [2, 6]);

  const second = VE.diagramAddress(found[1]);
  check("an address is the index and what was in the fence", /^6-[0-9a-z]+$/.test(second), true);

  check("the address finds the diagram it was made from",
    VE.findDiagram(doc, second).body, "flowchart LR\n  C --> D");

  // The dangerous case, and the reason the hash is there at all.
  const shifted = doc.replace("Some prose.\n", "Some prose.\n\nAnd more of it.\n");
  check("...and still finds it after something was inserted above it",
    VE.findDiagram(shifted, second).body, "flowchart LR\n  C --> D");
  check("...at its new index rather than its old one",
    VE.findDiagram(shifted, second).index, 8);

  // Two diagrams that happen to say the same thing are the same diagram as far
  // as a hash can tell, so the index has to break the tie.
  const twins = "```mermaid\nflowchart TD\n  A --> B\n```\n\n```mermaid\nflowchart TD\n  A --> B\n```\n";
  const both = VE.diagramFences(twins);
  check("two diagrams that say the same thing still have different addresses",
    VE.diagramAddress(both[0]) !== VE.diagramAddress(both[1]), true);
  check("...and each address finds its own",
    [VE.findDiagram(twins, VE.diagramAddress(both[0])).index,
      VE.findDiagram(twins, VE.diagramAddress(both[1])).index], [0, 2]);

  // A block that has been edited to something else is not the block that was
  // opened, and writing over it would be the exact accident this prevents.
  const gone = doc.replace("flowchart LR\n  C --> D", "flowchart LR\n  C --> Z");
  check("a diagram that has been changed underneath is not found",
    VE.findDiagram(gone, second), null);
  check("...and a document it is not in cannot be written to",
    VE.replaceDiagram(gone, second, "flowchart TD\n  X --> Y"), null);
  check("...nor can one whose block was deleted",
    VE.replaceDiagram("# Title\n", second, "flowchart TD\n  X --> Y"), null);
  check("a malformed address finds nothing", VE.findDiagram(doc, "not-an-address"), null);

  // And the whole point: one block changes and the document is otherwise the
  // document, byte for byte.
  const written = VE.replaceDiagram(doc, second, "flowchart LR\n  C --> E");
  check("writing one diagram back changes that diagram",
    VE.findDiagram(written, VE.diagramAddress(VE.diagramFences(written)[1])).body,
    "flowchart LR\n  C --> E");
  check("...and nothing else in the document",
    written.replace("C --> E", "C --> D"), doc);

  // The fence's own shape is not the diagram's business either: a tilde fence
  // with an info string comes back a tilde fence with an info string.
  const tilded = "~~~~mermaid render\nflowchart TD\n  A --> B\n~~~~\n";
  const address = VE.diagramAddress(VE.diagramFences(tilded)[0]);
  check("a diagram keeps the fence it was written in",
    VE.replaceDiagram(tilded, address, "flowchart TD\n  A --> C"),
    "~~~~mermaid render\nflowchart TD\n  A --> C\n~~~~\n");
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

console.log("=== a box lines itself up with the ones already there ===");
{
  /* Six lines matter on any box: left, centre, right, top, middle, bottom.
   * When one of the six on the box being moved comes close to one of the six
   * on a box that is not, the moving box goes exactly on it. That is the whole
   * of the difference between a diagram that looks arranged and one that looks
   * nearly arranged.
   */
  const anchor = { x: 100, y: 100, w: 80, h: 40 };
  const guide = (moving, others = [anchor], within = 6) => DM.alignGuides(moving, others, within);

  check("a box three pixels off another box's left edge is put on it",
    guide({ x: 103, y: 300, w: 80, h: 40 }).x, 100);
  check("...and says which line it went to",
    guide({ x: 103, y: 300, w: 80, h: 40 }).guides.map((one) => [one.axis, one.at]), [["x", 100]]);
  check("...with a line long enough to reach both boxes",
    guide({ x: 103, y: 300, w: 80, h: 40 }).guides[0], { axis: "x", at: 100, from: 100, to: 340 });
  // And from the other side, where the box that is not moving is the far end:
  // a line that stops at the box under the hand explains nothing.
  check("...whichever of the two is further along",
    guide({ x: 103, y: 20, w: 80, h: 40 }).guides[0], { axis: "x", at: 100, from: 20, to: 140 });

  check("a box seven pixels off is left where it is",
    guide({ x: 107, y: 300, w: 80, h: 40 }).x, 107);
  check("...with nothing to explain", guide({ x: 107, y: 300, w: 80, h: 40 }).guides, []);

  // Centres and far edges count as much as near ones, which is what lets a
  // wide box be centred under a narrow one.
  check("a box can line up by its centre",
    guide({ x: 85, y: 300, w: 120, h: 40 }).x, 80);
  check("...or by its right edge against another's right edge",
    guide({ x: 22, y: 300, w: 160, h: 40 }).x, 20);
  check("...or by its left edge against another's right edge",
    guide({ x: 178, y: 300, w: 60, h: 40 }).x, 180);

  // Both axes at once, and they are decided independently: a box can be level
  // with one thing and in line with another.
  const corner = guide({ x: 103, y: 97, w: 80, h: 40 });
  check("a box can line up both ways at once", [corner.x, corner.y], [100, 100]);
  check("...and says so twice", corner.guides.map((one) => one.axis), ["x", "y"]);

  const two = guide({ x: 103, y: 138, w: 80, h: 40 }, [anchor, { x: 400, y: 140, w: 80, h: 40 }]);
  check("...against different boxes on each axis", [two.x, two.y], [100, 140]);

  // The nearest wins, so a box between two others does not flicker between
  // them while the hand shakes.
  const between = guide({ x: 104, y: 300, w: 80, h: 40 }, [anchor, { x: 108, y: 500, w: 80, h: 40 }]);
  check("the nearest line wins", between.x, 104 - 4);

  check("a box with nothing to line up against stays put",
    [guide({ x: 103, y: 300, w: 80, h: 40 }, []).x, guide({ x: 103, y: 300, w: 80, h: 40 }, []).guides.length],
    [103, 0]);

  // How close counts is the caller's business, because on screen it depends on
  // the zoom: at half size, six pixels of file is three pixels of hand.
  check("how close counts can be widened",
    guide({ x: 112, y: 300, w: 80, h: 40 }, [anchor], 20).x, 100);
  check("...and narrowed", guide({ x: 103, y: 300, w: 80, h: 40 }, [anchor], 1).x, 103);
}

console.log("=== a diagram is a place, not a picture ===");
{
  /* On the page a diagram has no edges: it is somewhere you are looking at part
   * of, and the part you are looking at is one transform. That matters more
   * than it sounds — it is what makes panning and zooming cost the same at six
   * boxes and at six hundred, because neither one redraws anything.
   */
  const model = DM.parseFlowchart([
    "flowchart TD",
    "    %% layout v1",
    "    %% @ A 100,100 120x60",
    "    %% @ B 100,300 120x60",
    "    A[One]",
    "    B[Two]",
    "    A --> B"
  ].join("\n"));

  const drawn = DD.render(model, {
    layout: model.layout,
    viewport: true,
    view: { x: 40, y: -25, scale: 1.5 },
    grid: true
  });

  check("a viewport fills whatever it is given",
    /<svg[^>]*width="100%"[^>]*height="100%"/.test(drawn), true);
  // A viewBox would be a second scale to undo, and two scales is one too many
  // for "a pixel on the screen is this point in the diagram" to stay simple.
  check("...with no viewBox, so one unit is one pixel",
    /viewBox/.test(drawn.slice(0, drawn.indexOf(">"))), false);
  check("...and says it is somewhere to work rather than a picture",
    /role="application"/.test(drawn), true);

  check("everything in the diagram moves together",
    /<g class="dd-view" transform="translate\(40,-25\) scale\(1.5\)">/.test(drawn), true);
  // Inside it, not merely after it: a group that moves with nothing in it moves
  // nothing, and the difference is invisible in the text of the file.
  const parsed = new JSDOM(`<!doctype html><body>${drawn}</body>`).window.document;
  check("...and every box and arrow is inside that one group",
    ["dd-nodes", "dd-edges", "dd-marks"].map((part) =>
      Boolean(parsed.querySelector(`.dd-view > .${part}`)) || !parsed.querySelector(`.${part}`)),
    [true, true, true]);
  check("...so moving it is the whole of moving the diagram",
    parsed.querySelectorAll(".dd-view .dd-node").length, 2);

  // The grid is the one thing that must not be inside it: a rectangle big
  // enough to be under an endless canvas is a rectangle of no particular size.
  // So the paper stays still and the pattern on it moves.
  check("the paper is the whole window and stays there",
    /<rect class="dd-paper" x="0" y="0" width="100%" height="100%"/.test(drawn), true);
  check("...while the grid on it moves with the diagram",
    /<pattern[^>]*patternTransform="translate\(40,-25\) scale\(1.5\)"/.test(drawn), true);
  check("...so nothing had to decide how big an endless canvas is",
    /dd-paper[^>]*width="\d+"/.test(drawn), false);

  // A view nobody has set is the diagram at its own size at the origin, which
  // is also what a broken one has to come out as rather than NaN.
  for (const [what, bad] of Object.entries({
    "no view at all": undefined,
    "a scale of zero": { x: 0, y: 0, scale: 0 },
    "a scale that is not a number": { x: 1, y: 2, scale: "wide" },
    "positions that are not numbers": { x: "left", y: null, scale: 2 }
  })) {
    const view = DD.viewOf(bad);
    check(`${what} is still somewhere to look from`,
      Number.isFinite(view.x) && Number.isFinite(view.y) && view.scale > 0, true);
  }

  check("a scale that is not a number is life size", DD.viewOf({ scale: "wide" }).scale, 1);
  check("...and a position that is not a number is the origin",
    [DD.viewOf({ x: "left" }).x, DD.viewOf({ y: null }).y], [0, 0]);

  // And the old way still works, because the editor inside a document still
  // uses it and this phase was not supposed to touch that.
  const inPage = DD.render(model, { layout: model.layout, natural: true, grid: true, pad: 200 });
  check("a diagram drawn at its own size still is",
    /<svg[^>]*viewBox="0 0 \d+ \d+"[^>]* width="\d+" height="\d+"/.test(inPage), true);
  check("...with nothing moved out from under it",
    /class="dd-view"/.test(inPage), false);
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

  /* --- a colour is a classDef, and a classDef is drawn --------------------- */

  const coloured = {
    direction: "TD",
    classes: { hot: { fill: "#fbdedc", stroke: "#c0453c", color: "#4a1512" } },
    nodes: [
      { id: "A", shape: "rect", text: "Hot", classes: ["hot"] },
      { id: "B", shape: "rect", text: "Plain" }
    ],
    edges: [],
    layout: { A: square(0, 0), B: square(200, 0) }
  };

  const painted = DD.render(coloured, { layout: coloured.layout });
  const groupOf = (id) => new RegExp(`<g class="dd-node"[^>]*data-id="${id}"[^>]*>`).exec(painted)[0];

  check("a box wearing a class is drawn in its colours",
    /--dd-fill:#fbdedc;--dd-stroke:#c0453c;--dd-text:#4a1512;/.test(groupOf("A")), true);
  check("...and a box wearing none is left to the theme",
    /style=/.test(groupOf("B")), false);

  // Inline `style A fill:#f00` is about that one box, so it wins over the class.
  const over = DD.render({
    ...coloured,
    nodes: [{ id: "A", shape: "rect", text: "Hot", classes: ["hot"], style: { fill: "#00ff00" } }]
  }, { layout: { A: square(0, 0) } });
  check("a box's own style beats the class it wears",
    /--dd-fill:#00ff00;/.test(over), true);

  /* What arrives is whatever somebody wrote, and it is about to go into a style
   * attribute. A value that is not plainly a colour is dropped rather than
   * escaped-and-hoped-for: there is no legitimate diagram it costs.
   */
  const nasty = DD.render({
    direction: "TD",
    classes: { bad: { fill: "red;} body { display: none } .x {", stroke: "url(#evil)", color: "#0a0a0a" } },
    nodes: [{ id: "A", shape: "rect", text: "x", classes: ["bad"] }],
    edges: [],
    layout: { A: square(0, 0) }
  }, { layout: { A: square(0, 0) } });
  check("a fill that is not a colour is not drawn", /display/.test(nasty), false);
  check("...nor is a stroke that fetches something", /url\(/.test(nasty), false);
  check("...while the colour beside them is kept", /--dd-text:#0a0a0a;/.test(nasty), true);

  check("a colour of every shape is allowed through", [
    DD.paintOf({ style: { fill: "#abc" } }, {}),
    DD.paintOf({ style: { fill: "rebeccapurple" } }, {}),
    DD.paintOf({ style: { fill: "rgba(1, 2, 3, 0.5)" } }, {}),
    DD.paintOf({ style: { "stroke-width": "2px" } }, {}),
    DD.paintOf({ style: { "stroke-dasharray": "6 4" } }, {})
  ], [
    "--dd-fill:#abc;",
    "--dd-fill:rebeccapurple;",
    "--dd-fill:rgba(1, 2, 3, 0.5);",
    "--dd-stroke-width:2px;",
    "--dd-dash:6 4;"
  ]);

  check("...and anything else is not", [
    DD.paintOf({ style: { fill: "expression(alert(1))" } }, {}),
    DD.paintOf({ style: { "stroke-width": "2px;fill:red" } }, {}),
    DD.paintOf({ style: { fill: "" } }, {})
  ], ["", "", ""]);

  /* A document shows its diagrams without an editor anywhere near them, and a
   * colour that only appeared once you opened the editor would be a colour
   * nobody reading the document ever saw.
   */
  const fromFile = DD.renderSource([
    "flowchart TD",
    "    %% layout v1",
    "    %% @ A 40,40 90x50",
    "    classDef hot fill:#fbdedc,stroke:#c0453c",
    "    A[Hot]",
    "    class A hot"
  ].join("\n"));
  check("a diagram read straight from a file is drawn in its colours",
    /--dd-fill:#fbdedc;--dd-stroke:#c0453c;/.test(fromFile), true);

  // The round trip the whole scheme rests on: a colour written as a classDef is
  // a colour the file still has after being read and written again.
  const round = DM.parseFlowchart(DM.serializeFlowchart(coloured));
  check("a classDef survives being written and read back",
    round.classes.hot, coloured.classes.hot);
  check("...and so does the box that wears it", round.nodes[0].classes, ["hot"]);

  /* The canvas has no edges, so a box can be to the left of the origin or above
   * it. A drawing that always began at 0,0 would cut such a box off — which is
   * what made the editor forbid the position in the first place, and what left
   * a diagram unable to be moved into the space beside it.
   */
  const out = DD.render({
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", text: "Out" }],
    edges: [],
    layout: { A: { x: -300, y: -200, w: 80, h: 40 } }
  }, { natural: true });
  const seen = /viewBox="(-?\d+) (-?\d+) (\d+) (\d+)"/.exec(out);
  check("a drawing begins where the diagram does, not at the origin",
    [Number(seen[1]), Number(seen[2])], [-300, -200]);
  check("...and is large enough to hold it", [Number(seen[3]), Number(seen[4])], [110, 70]);

  // The grid is painted onto the paper, and paper that starts at the origin
  // leaves a box out to the left of it on no paper at all.
  const gridded = DD.render({
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", text: "Out" }],
    edges: [],
    layout: { A: { x: -300, y: -200, w: 80, h: 40 } }
  }, { natural: true, grid: true });
  const sheet = /<rect class="dd-paper" x="(-?\d+)" y="(-?\d+)"/.exec(gridded);
  check("...and the paper under it starts there too",
    [Number(sheet[1]), Number(sheet[2])], [-300, -200]);

  const bounds = DM.layoutBounds({ A: { x: 40, y: 40, w: 80, h: 40 } });
  check("a diagram laid out the usual way still starts at the origin",
    [bounds.x, bounds.y], [0, 0]);
  check("...and is the size it always was", [bounds.w, bounds.h], [150, 110]);
}

console.log("=== a line has two ends, and the file says so in real Mermaid ===");
{
  /* Mermaid can spell four endings: nothing, an arrow, a circle, a cross. UML
   * and ERD want five more it has no words for.
   *
   * So the ends are read off the kind — the thing every other renderer acts on
   * — and `ends` in a layout comment is the refinement on top. The kind stays
   * the nearest real link, which is why a triangle-headed line is still an
   * arrow on GitHub rather than nothing at all.
   */
  check("an arrow has a head and no tail", DD.endsOf({ kind: "arrow" }), ["none", "arrow"]);
  check("a plain line has neither", DD.endsOf({ kind: "open" }), ["none", "none"]);
  check("a dotted line has neither either", DD.endsOf({ kind: "dotted-open" }), ["none", "none"]);
  check("a both-ways link has a head at each end", DD.endsOf({ kind: "both" }), ["arrow", "arrow"]);
  check("...however it is drawn", DD.endsOf({ kind: "thick-both" }), ["arrow", "arrow"]);
  check("Mermaid's own circle ending is drawn as one", DD.endsOf({ kind: "circle" }), ["none", "circle"]);
  check("...and so is its cross", DD.endsOf({ kind: "cross" }), ["none", "cross"]);

  check("what the comment says wins over what the kind implies",
    DD.endsOf({ kind: "arrow", ends: ["diamond", "triangle"] }), ["diamond", "triangle"]);
  check("...but a name nothing draws falls back to the kind",
    DD.endsOf({ kind: "arrow", ends: ["nonsense", "alsonot"] }), ["none", "arrow"]);

  // One definition per ending actually used. A diagram of ordinary arrows costs
  // one marker however many arrows are in it.
  const plain = DD.render({
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", text: "A" }, { id: "B", shape: "rect", text: "B" },
      { id: "C", shape: "rect", text: "C" }],
    edges: [{ from: "A", to: "B", kind: "arrow", label: "" },
      { from: "B", to: "C", kind: "arrow", label: "" }],
    layout: { A: { x: 0, y: 0, w: 80, h: 40 }, B: { x: 0, y: 120, w: 80, h: 40 },
      C: { x: 0, y: 240, w: 80, h: 40 } }
  }, { natural: true });
  check("two arrows share one marker", (plain.match(/<marker /g) || []).length, 1);
  check("...which the line points at with its end and not its start",
    /marker-end="url\(#dd-end-arrow-\d+\)"/.test(plain) && !plain.includes("marker-start"), true);

  const uml = DD.render({
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", text: "A" }, { id: "B", shape: "rect", text: "B" }],
    edges: [{ from: "A", to: "B", kind: "arrow", ends: ["diamond", "triangle"], label: "" }],
    layout: { A: { x: 0, y: 0, w: 80, h: 40 }, B: { x: 0, y: 120, w: 80, h: 40 } }
  }, { natural: true });
  check("a line with a shape at each end defines both", (uml.match(/<marker /g) || []).length, 2);
  check("...and points at each from the right end",
    /marker-start="url\(#dd-end-diamond-\d+\)"/.test(uml)
    && /marker-end="url\(#dd-end-triangle-\d+\)"/.test(uml), true);
  check("...and neither of them is an arrow", uml.includes("dd-end-arrow-"), false);
  // A hollow head has to be drawn hollow, or "is a" and "is made of" are the
  // same picture.
  check("a hollow ending is drawn hollow", (uml.match(/dd-head dd-head-hollow/g) || []).length, 2);

  /* Boxes are drawn after arrows, so an arrowhead that reaches the box it
   * points at is an arrowhead with its tip painted over — and a box's border is
   * centred on its edge, so half of it is outside the box doing exactly that.
   * The line stops short instead.
   */
  const meeting = { A: { x: 100, y: 100, w: 80, h: 40 }, B: { x: 100, y: 300, w: 80, h: 40 } };
  const headed = DD.routeEdge(meeting, { from: "A", to: "B", kind: "arrow" }, 0);
  check("a line with a head on it stops short of the box",
    headed.d, "M140,140 L140,298");
  check("...though the route it took still reaches it",
    headed.points[headed.points.length - 1], [140, 300]);
  check("...and the head is anchored at its own far edge, wholly behind that",
    /refX="10"/.test(plain) && !/refX="9"/.test(plain), true);

  // Only where there is something to clear. A plain line held two pixels off
  // the box would be a gap in every diagram, for arrowheads that are not there.
  check("a line with nothing on it still meets the box",
    DD.routeEdge(meeting, { from: "A", to: "B", kind: "open" }, 0).d, "M140,140 L140,300");
  check("a line with a head at each end stops short at each end",
    DD.routeEdge(meeting, { from: "A", to: "B", kind: "both" }, 0).d, "M140,142 L140,298");

  /* Two boxes touching leave the line no length to be shortened by. Taking two
   * pixels off a segment that has none would point the arrow backwards, and off
   * a route that is a single point would be arithmetic on a segment that is not
   * there.
   */
  const touching = { A: { x: 100, y: 100, w: 80, h: 40 }, B: { x: 100, y: 140, w: 80, h: 40 } };
  check("a line with no length at all is left where it is",
    DD.routeEdge(touching, { from: "A", to: "B", kind: "arrow" }, 0).d, "M140,140");
  const hair = { A: { x: 100, y: 100, w: 80, h: 40 }, B: { x: 100, y: 141, w: 80, h: 40 } };
  check("...and so is one with less length than the clearance",
    DD.routeEdge(hair, { from: "A", to: "B", kind: "arrow" }, 0).d, "M140,140 L140,141");

  const shut = DD.render({
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", text: "A" }, { id: "B", shape: "rect", text: "B" }],
    edges: [{ from: "A", to: "B", kind: "open", label: "" }],
    layout: { A: { x: 0, y: 0, w: 80, h: 40 }, B: { x: 0, y: 120, w: 80, h: 40 } }
  }, { natural: true });
  check("a line with nothing on either end defines no markers", shut.includes("<marker "), false);
  check("...and points at none", shut.includes("marker-"), false);

  /* The line style, which is the other half of a link and the half Mermaid can
   * always say.
   */
  check("a dotted kind is drawn dotted", DM.lineStyleOf("dotted-both"), "dotted");
  check("a thick kind is drawn thick", DM.lineStyleOf("thick-open"), "thick");
  check("everything else is a solid line", [DM.lineStyleOf("arrow"), DM.lineStyleOf("circle")],
    ["solid", "solid"]);

  /* And the rule that keeps the file honest: whatever ends are asked for, what
   * is written down is the nearest link Mermaid actually has.
   */
  check("a solid line with an arrow is an arrow", DM.linkFor("solid", ["none", "arrow"]), "arrow");
  check("...with nothing on it, a line", DM.linkFor("solid", ["none", "none"]), "open");
  check("...with heads both ways, a both-ways link", DM.linkFor("solid", ["arrow", "arrow"]), "both");
  check("Mermaid's own circle is used when it fits", DM.linkFor("solid", ["none", "circle"]), "circle");
  check("...and so is its cross", DM.linkFor("solid", ["none", "cross"]), "cross");
  check("a dotted line with a UML triangle is written as a dotted arrow",
    DM.linkFor("dotted", ["none", "triangle"]), "dotted");
  check("a thick line with nothing on it is a thick line",
    DM.linkFor("thick", ["none", "none"]), "thick-open");
  check("anything at the back makes it a both-ways link",
    DM.linkFor("dotted", ["diamond", "crow"]), "dotted-both");
  // Dotted has no circle of its own, so it lands on the nearest thing it does
  // have rather than on nothing.
  check("a style with no circle of its own falls back to its arrow",
    DM.linkFor("dotted", ["none", "circle"]), "dotted");

  // Written to the file and read back: the kind is real Mermaid and the exact
  // ends are beside it, or a saved diagram loses its UML the moment it is
  // reopened.
  const uml2 = {
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", text: "A", label: "A" },
      { id: "B", shape: "rect", text: "B", label: "B" }],
    edges: [{ from: "A", to: "B", kind: "arrow", label: "", ends: ["diamond", "triangle"] }],
    layout: { A: { x: 0, y: 0, w: 80, h: 40 }, B: { x: 0, y: 120, w: 80, h: 40 } }
  };
  const written = DM.serializeFlowchart(uml2);
  check("the file carries a link Mermaid can read", /A\s+-->\s+B/.test(written), true);
  check("...and the exact ends in a comment above it",
    /%% edge 0 [^\n]*ends=diamond,triangle/.test(written), true);
  check("...which come back the same way round",
    DM.parseFlowchart(written).edges[0].ends, ["diamond", "triangle"]);
}

console.log("=== a box inside a box is drawn inside it, not under it ===");
{
  /* Boxes used to be drawn in the order the file lists them, which is fine
   * until one is inside another: the outer one is opaque, so whichever of the
   * two the file happens to mention second wins, and half the time the box you
   * put inside vanishes the moment the drawing is made again. So does the arrow
   * pointing at it, which has to cross the outer box to get there.
   *
   * Drawn from the outside in instead: a box that holds another is background
   * to it, and so is any arrow that stops outside it.
   */
  const nested = {
    direction: "TD",
    nodes: [{ id: "Inner", shape: "rect", text: "in" },
      { id: "Outer", shape: "rect", text: "out" },
      { id: "C", shape: "rect", text: "C" }],
    edges: [{ from: "C", to: "Inner", kind: "arrow", label: "" },
      { from: "C", to: "Outer", kind: "arrow", label: "" }],
    layout: { Outer: { x: 100, y: 100, w: 300, h: 200 },
      Inner: { x: 180, y: 180, w: 100, h: 50 },
      C: { x: 500, y: 180, w: 80, h: 40 } }
  };

  const depths = DD.nestingDepths(nested.nodes, nested.layout);
  check("a box inside a bigger one is a layer deeper", depths.get("Inner"), 1);
  check("...and the one holding it is not", depths.get("Outer"), 0);
  check("...nor is one standing on its own", depths.get("C"), 0);

  // Same size and place: neither is inside the other, or two boxes drawn on
  // top of each other would each count as being in the other. It is the same
  // rule that stops a box counting itself.
  const twins = DD.nestingDepths(
    [{ id: "A" }, { id: "B" }],
    { A: { x: 0, y: 0, w: 80, h: 40 }, B: { x: 0, y: 0, w: 80, h: 40 } });
  check("two boxes the same size and place are neither inside the other",
    [twins.get("A"), twins.get("B")], [0, 0]);

  /* And it goes as deep as it is drawn. A box in a box in a box is three
   * layers, or the two inner ones share one and whichever the file mentions
   * second paints over the other.
   */
  const russian = DD.nestingDepths(
    [{ id: "Big" }, { id: "Middle" }, { id: "Small" }],
    { Big: { x: 0, y: 0, w: 400, h: 400 }, Middle: { x: 50, y: 50, w: 200, h: 200 },
      Small: { x: 80, y: 80, w: 60, h: 60 } });
  check("a box in a box in a box is three layers deep",
    [russian.get("Big"), russian.get("Middle"), russian.get("Small")], [0, 1, 2]);

  // Overlapping is not containing. Half in and half out is still beside.
  const overlapping = DD.nestingDepths(
    [{ id: "A" }, { id: "B" }],
    { A: { x: 0, y: 0, w: 200, h: 100 }, B: { x: 150, y: 50, w: 100, h: 100 } });
  check("a box hanging over the edge of another is not inside it",
    [overlapping.get("A"), overlapping.get("B")], [0, 0]);

  const painted = new JSDOM(`<!doctype html><body>${DD.render(nested,
    { layout: nested.layout, natural: true })}</body>`).window.document;
  const order = [...painted.querySelectorAll(".dd-node, .dd-edge")]
    .map((one) => one.dataset.id || `edge ${one.dataset.edge}`);

  check("the outer box and what stops at it come first, then what is inside",
    order, ["edge 1", "Outer", "C", "edge 0", "Inner"]);

  /* An arrow keeps the number it has in the file whatever order it is drawn in,
   * because that number is how everything else refers to it.
   */
  check("...and an arrow drawn out of turn keeps its own number",
    [...painted.querySelectorAll(".dd-edge")].map((one) => one.dataset.from),
    ["C", "C"]);

  const deep = new JSDOM(`<!doctype html><body>${DD.render({
    direction: "TD",
    nodes: [{ id: "Small", shape: "rect", text: "s" }, { id: "Big", shape: "rect", text: "b" },
      { id: "Middle", shape: "rect", text: "m" }],
    edges: [],
    layout: { Big: { x: 0, y: 0, w: 400, h: 400 }, Middle: { x: 50, y: 50, w: 200, h: 200 },
      Small: { x: 80, y: 80, w: 60, h: 60 } }
  }, { natural: true })}</body>`).window.document;
  check("...and it is drawn that way round however the file lists them",
    [...deep.querySelectorAll(".dd-node")].map((one) => one.dataset.id),
    ["Big", "Middle", "Small"]);

  // A diagram with nothing inside anything is the one layer of arrows and one
  // of boxes it always was.
  const flat = new JSDOM(`<!doctype html><body>${DD.render({
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", text: "A" }, { id: "B", shape: "rect", text: "B" }],
    edges: [{ from: "A", to: "B", kind: "arrow", label: "" }],
    layout: { A: { x: 0, y: 0, w: 80, h: 40 }, B: { x: 0, y: 200, w: 80, h: 40 } }
  }, { natural: true })}</body>`).window.document;
  check("a diagram with nothing nested is drawn in one layer as before",
    [flat.querySelectorAll(".dd-edges").length, flat.querySelectorAll(".dd-nodes").length],
    [1, 1]);

  // And an empty one still has the places those things go, or the editor has
  // nothing to put the first box into.
  const empty = new JSDOM(`<!doctype html><body>${DD.render({
    direction: "TD", nodes: [], edges: [], layout: {}
  }, { natural: true })}</body>`).window.document;
  check("...and an empty diagram still has both places to draw into",
    [empty.querySelectorAll(".dd-edges").length, empty.querySelectorAll(".dd-nodes").length],
    [1, 1]);
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
