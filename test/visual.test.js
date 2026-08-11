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

console.log(failures === 0 ? "\nALL VISUAL CHECKS PASSED" : `\n${failures} VISUAL CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
