/* Every third-party library the browser loads, and which version it is pinned to.
 *
 * `npm audit` cannot see any of these: they are <script> tags and lazily
 * fetched URLs, not entries in package.json. Subresource integrity pins the
 * bytes, which stops a compromised CDN serving something else — it does
 * nothing at all about a vulnerability in the library itself, and the library
 * doing the most security-relevant work here is the HTML sanitizer.
 *
 * So the versions are read back out of the source rather than written down a
 * second time. A list somebody maintains beside the pins is a list that is
 * wrong the first time somebody bumps one and forgets.
 */

const fs = require("fs");
const path = require("path");

const PUBLIC_DIR = path.join(__dirname, "..", "public");

/* jsDelivr serves npm directly, so the path is the package and the version:
 *   /npm/marked@15.0.12/marked.min.js
 *   /npm/@phosphor-icons/web@2.1.2/src/regular/style.css   (scoped)
 * cdnjs uses its own library names, which happen to match npm for the one
 * library this app takes from there.
 */
const JSDELIVR = /cdn\.jsdelivr\.net\/npm\/((?:@[^/@]+\/)?[^/@]+)@([^/]+)\//g;
const CDNJS = /cdnjs\.cloudflare\.com\/ajax\/libs\/([^/]+)\/([^/]+)\//g;

// The Python runtime is loaded by the worker, from a version it holds as a
// constant rather than as a URL.
const PYODIDE = /const PYODIDE_VERSION = "([^"]+)"/;

function filesToScan(publicDir) {
  const pages = fs.readdirSync(publicDir).filter((name) => name.endsWith(".html"));
  return [
    ...pages.map((name) => path.join(publicDir, name)),
    path.join(publicDir, "js", "md", "lazy.js"),
    path.join(publicDir, "js", "pyodide-worker.js")
  ];
}

function pinsIn(source) {
  const found = [];

  for (const pattern of [JSDELIVR, CDNJS]) {
    for (const [, name, version] of source.matchAll(pattern)) {
      found.push({ name, version });
    }
  }

  const pyodide = source.match(PYODIDE);
  if (pyodide) {
    found.push({ name: "pyodide", version: pyodide[1] });
  }

  return found;
}

/* One entry per package, with every place it is pinned.
 *
 * A package pinned to two different versions in two files is its own finding —
 * KaTeX is three assets that have to agree — so the versions are collected
 * rather than the last one winning.
 */
function cdnPins(publicDir = PUBLIC_DIR) {
  const byName = new Map();

  for (const file of filesToScan(publicDir)) {
    if (!fs.existsSync(file)) {
      continue;
    }

    for (const { name, version } of pinsIn(fs.readFileSync(file, "utf8"))) {
      if (!byName.has(name)) {
        byName.set(name, { name, versions: new Set(), files: new Set() });
      }

      const entry = byName.get(name);
      entry.versions.add(version);
      entry.files.add(path.relative(publicDir, file));
    }
  }

  return [...byName.values()]
    .map((entry) => ({
      name: entry.name,
      versions: [...entry.versions].sort(),
      files: [...entry.files].sort()
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* Every pinned asset with the hash it is checked against.
 *
 * A URL and an integrity attribute sit next to each other in the markup, and
 * bumping a version means changing both. Getting one and not the other is a
 * script the browser refuses to run — silently, from the app's point of view —
 * and it is the easy half of the mistake to make, because the hash is opaque
 * and nothing local can tell you it is wrong. (It was made while writing this:
 * a DOMPurify bump that moved the URL and left the hash.)
 *
 * The pair is matched by position: the integrity is the next one after the URL
 * in the file, which is how both the <script> tags and lazy.js write them.
 */
const ASSET = /(https:\/\/(?:cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)\/[^\s"']+)|integrity[=:]\s*"(sha\d{3}-[^"]+)"/g;

function cdnAssets(publicDir = PUBLIC_DIR) {
  const assets = [];

  for (const file of filesToScan(publicDir)) {
    if (!fs.existsSync(file)) {
      continue;
    }

    let pending = null;
    for (const [, url, integrity] of fs.readFileSync(file, "utf8").matchAll(ASSET)) {
      if (url) {
        pending = url;
        continue;
      }

      if (pending) {
        assets.push({ url: pending, integrity, file: path.relative(publicDir, file) });
        pending = null;
      }
    }
  }

  return assets;
}

module.exports = { cdnPins, cdnAssets, PUBLIC_DIR };
