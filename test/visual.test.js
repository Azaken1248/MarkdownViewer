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
  const walk = (dir) => {
    let out = [];
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out = out.concat(walk(full));
      else if (/\.(md|markdown|mmd|mermaid)$/i.test(entry.name)) out.push(full);
    }
    return out;
  };

  const files = walk(docsDir);
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

console.log(failures === 0 ? "\nALL VISUAL CHECKS PASSED" : `\n${failures} VISUAL CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
