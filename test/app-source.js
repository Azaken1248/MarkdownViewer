// The client is app.js plus the modules it is assembled from, and index.html is
// the one place that says which those are and in what order the page loads
// them. Tests read that order out of the page rather than keeping a second copy
// of it here that would have to agree — a script added to the page and not to
// the list would otherwise be a script no test ever evaluates.

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const DEFAULT_PUBLIC_DIR = path.join(__dirname, "..", "public");

// Every script the page loads from our own /js, in page order, as absolute
// paths. The CDN tags are not ours and are not included.
function clientScriptPaths(publicDir = DEFAULT_PUBLIC_DIR) {
  const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
  return [...html.matchAll(/<script[^>]*\ssrc="\/js\/([^"?]+)/g)]
    .map(([, file]) => path.join(publicDir, "js", file));
}

// Only the ones app.js is made of: the modules under js/app/, then app.js.
function appScriptPaths(publicDir = DEFAULT_PUBLIC_DIR) {
  const jsDir = path.join(publicDir, "js");
  return clientScriptPaths(publicDir).filter((file) => {
    const rel = path.relative(jsDir, file);
    return rel === "app.js" || rel.startsWith(`app${path.sep}`);
  });
}

// Their source, joined. A check that greps "the app source" is asking what the
// client does, not which file it ended up in, so it gets all of it.
function appSource(publicDir = DEFAULT_PUBLIC_DIR) {
  return appScriptPaths(publicDir)
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
}

// The render engine: the modules under js/md, then markdown-core.js, in page
// order. Same reasoning as above — the page says which files it is made of, so
// a test that evaluates "the engine" gets whatever the page would have loaded.
function coreScriptPaths(publicDir = DEFAULT_PUBLIC_DIR) {
  const jsDir = path.join(publicDir, "js");
  return clientScriptPaths(publicDir).filter((file) => {
    const rel = path.relative(jsDir, file);
    // doc-kinds.js is the engine's too: md/text.js takes its answers about a
    // name from it, so it has to be there before the engine is.
    return rel === "doc-kinds.js" || rel === "markdown-core.js" || rel.startsWith(`md${path.sep}`);
  });
}

function coreSource(publicDir = DEFAULT_PUBLIC_DIR) {
  return coreScriptPaths(publicDir)
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
}

// The flowchart model: the modules under js/dm, then diagram-model.js. Same
// reasoning again — the page decides which files the model is made of.
function modelScriptPaths(publicDir = DEFAULT_PUBLIC_DIR) {
  const jsDir = path.join(publicDir, "js");
  return clientScriptPaths(publicDir).filter((file) => {
    const rel = path.relative(jsDir, file);
    return rel === "diagram-model.js" || rel.startsWith(`dm${path.sep}`);
  });
}

function modelSource(publicDir = DEFAULT_PUBLIC_DIR) {
  return modelScriptPaths(publicDir)
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
}

// The drawing: the modules under js/dd, then diagram-draw.js.
function drawScriptPaths(publicDir = DEFAULT_PUBLIC_DIR) {
  const jsDir = path.join(publicDir, "js");
  return clientScriptPaths(publicDir).filter((file) => {
    const rel = path.relative(jsDir, file);
    return rel === "diagram-draw.js" || rel.startsWith(`dd${path.sep}`);
  });
}

function drawSource(publicDir = DEFAULT_PUBLIC_DIR) {
  return drawScriptPaths(publicDir)
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
}

// Every stylesheet the page links from our own /css, in page order. The
// cascade is the order of these tags, so a check that greps "the stylesheet"
// has to read them joined and in that order — the same reasoning as the
// scripts above, and the same failure if a file is added to one and not the
// other.
function styleSheetPaths(publicDir = DEFAULT_PUBLIC_DIR) {
  const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
  return [...html.matchAll(/<link[^>]*\shref="\/css\/([^"?]+)/g)]
    .map(([, file]) => path.join(publicDir, "css", file));
}

function styleSource(publicDir = DEFAULT_PUBLIC_DIR) {
  return styleSheetPaths(publicDir)
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("");
}

/* Evaluate one of the page's scripts in a jsdom window, as the file it is.
 *
 * window.eval of a string is a script with no name, and a script with no name
 * is one the coverage map (`npm run coverage`) cannot put anywhere: V8 records
 * what ran in it under an empty URL and c8 drops it. The sourceURL comment is
 * the one thing a script can say about where it came from, so with it, what
 * the DOM suites exercise in the client counts as exercised — which is most of
 * what they do.
 */
function loadScript(window, file) {
  const source = fs.readFileSync(file, "utf8");
  window.eval(`${source}\n//# sourceURL=${pathToFileURL(file).href}`);
}

module.exports = {
  loadScript,
  clientScriptPaths, appScriptPaths, appSource,
  coreScriptPaths, coreSource, modelScriptPaths, modelSource,
  drawScriptPaths, drawSource, styleSheetPaths, styleSource
};
