// The client is app.js plus the modules it is assembled from, and index.html is
// the one place that says which those are and in what order the page loads
// them. Tests read that order out of the page rather than keeping a second copy
// of it here that would have to agree — a script added to the page and not to
// the list would otherwise be a script no test ever evaluates.

const fs = require("fs");
const path = require("path");

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

module.exports = { clientScriptPaths, appScriptPaths, appSource };
