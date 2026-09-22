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
const vm = require("vm");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..", "public");
const { modelScriptPaths, drawScriptPaths, styleSource } = require("./app-source.js");
const { createChecker } = require("./helpers/check.js");

// The modules are plain scripts whose top-level `var` is the namespace, the
// same way the browser loads them. require() would wrap each in a function
// and keep that var to itself, so they are run as the scripts they are, in
// this process's global scope.
global.window = /** @type {any} */ (globalThis);
const loadScript = (file) => vm.runInThisContext(fs.readFileSync(file, "utf8"), { filename: file });
loadScript(path.join(ROOT, "js", "visual-editor.js"));
const VE = globalThis.VisualEditor;

// The flowchart builder's model, loaded the same way and tested here for the
// same reason: it is the other half of "edit this without retyping it".
for (const file of modelScriptPaths(ROOT)) {
  loadScript(file);
}
const DM = globalThis.DiagramModel;

// And the drawing, which is what makes writing the layout down worth doing: a
// diagram that says where its boxes are is one this app can draw itself.
loadScript(path.join(ROOT, "js", "diagram-icons.js"));
for (const file of drawScriptPaths(ROOT)) {
  loadScript(file);
}
const DD = globalThis.DiagramDraw;

const { check, finish } = createChecker("VISUAL");

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

/* The checks themselves, in five files beside this one.
 *
 * What they share is handed over rather than reached for: the check() that
 * counts failures, the three modules under test, and the walk over the real
 * library's documents.
 */
const ctx = {
  check, VE, DM, DD, roundTrips, walkDocuments, fs, path, ROOT, JSDOM, styleSource
};

require("./visual/blocks.js")(ctx);
require("./visual/model.js")(ctx);
require("./visual/lines.js")(ctx);
require("./visual/boxes.js")(ctx);
require("./visual/measuring.js")(ctx);


process.exit(finish());
