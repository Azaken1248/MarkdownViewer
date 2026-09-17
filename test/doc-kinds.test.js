/* What a document is, by its name — decided once, for both sides.
 *
 * The server refuses what it will not store and the client offers what it
 * will open, and those used to be five separate spellings of one list. Now
 * there is one file, loaded by both, and this suite holds that arrangement in
 * place: the server's set is that list and nothing else, the client's helpers
 * answer through it, and no other file spells the list out again.
 */

const fs = require("fs");
const path = require("path");
const { appScriptPaths, coreScriptPaths } = require("./app-source.js");

const ROOT = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

const DocKinds = require("../public/js/doc-kinds.js");
const paths = require("../lib/docs/paths.js");

console.log("=== the server's list is the shared one ===");
check("the same five extensions", [...paths.ALLOWED_DOC_EXTENSIONS], DocKinds.DOC_EXTENSIONS);
check("...and the server takes each of them",
  DocKinds.DOC_EXTENSIONS.map((ext) => paths.sanitizeNewFilename(`note${ext}`).ok ?? Boolean(paths.sanitizeNewFilename(`note${ext}`))),
  DocKinds.DOC_EXTENSIONS.map(() => true));
check("...and refuses what is not on it",
  [".txt", ".html", ".md.bak", ""].map((ext) => Boolean(paths.sanitizeNewFilename(`note${ext}`)?.ok)),
  [false, false, false, false]);

console.log("=== what a name means ===");
{
  const cases = [
    ["notes.md", ".md", true, false, false],
    ["NOTES.MD", ".md", true, false, false],
    ["a/b/plan.markdown", ".markdown", true, false, false],
    ["flow.mmd", ".mmd", true, false, true],
    ["flow.mermaid", ".mermaid", true, false, true],
    ["data.ipynb", ".ipynb", true, true, false],
    ["README", "", false, false, false],
    ["archive.tar.gz", ".gz", false, false, false],
    ["notes.md.bak", ".bak", false, false, false],
    [".hidden", "", false, false, false]
  ];
  for (const [name, ext, doc, notebook, diagram] of cases) {
    check(`${JSON.stringify(name)} -> ${ext || "no extension"}`,
      [DocKinds.extensionOf(name), DocKinds.isDocFile(name), DocKinds.isNotebookFile(name), DocKinds.isDiagramFile(name)],
      [ext, doc, notebook, diagram]);
  }

  check("a title drops the document extension and nothing else",
    ["notes.md", "x.ipynb", "README", "a.txt", "v1.2.md"].map(DocKinds.stripDocExtension),
    ["notes", "x", "README", "a.txt", "v1.2"]);
}

console.log("=== the editor's own rule is written down ===");
{
  check("the editor can write everything but a notebook",
    DocKinds.TEXT_DOC_EXTENSIONS, [".md", ".markdown", ".mmd", ".mermaid"]);
  check("a bare name gets .md", DocKinds.ensureDocFilename("notes"), "notes.md");
  check("a text document keeps its extension", DocKinds.ensureDocFilename("flow.mmd"), "flow.mmd");
  check("a name typed as a notebook is not taken as one, because the editor writes text",
    DocKinds.ensureDocFilename("notes.ipynb"), "notes.ipynb.md");
  check("nothing is nothing", DocKinds.ensureDocFilename("  "), "");
}

console.log("=== nobody spells the list out a second time ===");
{
  // The pin. A regular expression or an array that names these extensions
  // anywhere but doc-kinds.js is a second copy, and a second copy is what this
  // whole file exists to prevent.
  const spelled = /\.?\(?md\|markdown|"\.md",\s*"\.markdown"|\\\.\(mmd\|mermaid\)|\\\.ipynb\$/;
  const client = [...appScriptPaths(PUBLIC_DIR), ...coreScriptPaths(PUBLIC_DIR)]
    .filter((file) => path.basename(file) !== "doc-kinds.js")
    .flatMap((file) => fs.readFileSync(file, "utf8").split("\n")
      .filter((line) => spelled.test(line))
      .map((line) => `${path.relative(PUBLIC_DIR, file)}: ${line.trim()}`));
  check("the client has no second copy", client, []);

  const server = fs.readdirSync(path.join(ROOT, "lib"), { recursive: true })
    .filter((name) => String(name).endsWith(".js"))
    .flatMap((name) => fs.readFileSync(path.join(ROOT, "lib", String(name)), "utf8").split("\n")
      .filter((line) => spelled.test(line))
      .map((line) => `${name}: ${line.trim()}`));
  check("and neither has the server", server, []);

  // Not even the sentence a refused upload is told. It is built from the list.
  check("the message to a person is built from the list, not typed beside it",
    DocKinds.DOC_EXTENSIONS_SENTENCE, ".md, .markdown, .mmd, .mermaid, or .ipynb");
  const typed = fs.readdirSync(path.join(ROOT, "lib", "routes"))
    .flatMap((name) => fs.readFileSync(path.join(ROOT, "lib", "routes", name), "utf8").split("\n")
      .filter((line) => /Only \.md, \.markdown/.test(line)));
  check("...and no route types it out", typed, []);
}

console.log(failures === 0 ? "\nALL DOC-KINDS CHECKS PASSED" : `\n${failures} DOC-KINDS CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
