#!/usr/bin/env node
/* One bundle per page, for the pages that load a lot of scripts.
 *
 * There is no build step in development and there does not need to be: the
 * source in the browser is the source in the repository, which is worth more
 * day to day than the bytes this saves. What it costs is requests. The app
 * shell names 86 deferred scripts, and over HTTP/1.1 that is 86 round trips
 * behind six connections before the interface draws.
 *
 * So this is optional and additive. It reads each page for the scripts it
 * already loads, in the order it already loads them, concatenates and minifies
 * them, and writes a manifest saying which tags a bundle stands in for. If the
 * manifest is absent — a fresh clone, a developer who has not run it — the
 * server serves the individual files exactly as before. Nothing here is a
 * prerequisite for the app working.
 *
 * The scripts are all self-closing IIFEs that hang a namespace off window, so
 * concatenation is the whole of the "bundling": there is no import graph to
 * resolve and no module wrapper to add. Order is the page's order, because
 * that order is the dependency order.
 *
 * theme-boot.js is deliberately left out. It is the one script that is not
 * deferred — it settles the theme before the stylesheet paints — and folding
 * it into a deferred bundle would reintroduce the flash it exists to prevent.
 *
 *   npm run build
 */

const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const ROOT = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const BUILD_DIR = path.join(PUBLIC_DIR, "build");

const PAGES = ["index", "share", "diagram", "error"];

// Only a run worth replacing. Below this the tag juggling costs more clarity
// than it saves round trips.
const MIN_SCRIPTS = 4;

// <script src="/js/..." defer>, in page order. Anything without defer is left
// alone: it runs at a moment the page has chosen for it.
function deferredScripts(html) {
  return [...html.matchAll(/<script[^>]*\ssrc="(\/js\/[^"?]+)"([^>]*)>/g)]
    .filter(([, , rest]) => /\bdefer\b/.test(rest))
    .map(([, src]) => src);
}

// The app's own stylesheets, in page order — which is the cascade, so the
// concatenation has to keep it exactly. The CDN links are somebody else's and
// are left where they are.
function ownStylesheets(html) {
  return [...html.matchAll(/<link[^>]*\shref="(\/css\/[^"?]+)"[^>]*>/g)].map(([, href]) => href);
}

async function buildPage(page, { publicDir = PUBLIC_DIR, buildDir = BUILD_DIR } = {}) {
  const htmlPath = path.join(publicDir, `${page}.html`);
  if (!fs.existsSync(htmlPath)) {
    return null;
  }

  const html = fs.readFileSync(htmlPath, "utf8");
  const scripts = deferredScripts(html);
  const styles = ownStylesheets(html);
  if (scripts.length < MIN_SCRIPTS && styles.length < MIN_SCRIPTS) {
    return null;
  }

  fs.mkdirSync(buildDir, { recursive: true });
  const entry = { page, replaces: [], styleReplaces: [], bytes: 0, styleBytes: 0 };

  if (scripts.length >= MIN_SCRIPTS) {
    // A semicolon between files, not a newline. Every one of them ends in `);`
    // already, but a file that ever does not would otherwise take the next one
    // with it — and that failure appears as a syntax error a hundred thousand
    // characters away from its cause.
    const source = scripts
      .map((src) => fs.readFileSync(path.join(publicDir, src.slice(1)), "utf8"))
      .join("\n;\n");

    const { code } = await esbuild.transform(source, {
      minify: true,
      // The oldest thing this app already expects: optional chaining and
      // `??` are used throughout the source unbundled.
      target: "es2020",
      legalComments: "none"
    });

    fs.writeFileSync(path.join(buildDir, `${page}.js`), code);
    entry.bundle = `/build/${page}.js`;
    entry.replaces = scripts;
    entry.bytes = code.length;
  }

  if (styles.length >= MIN_SCRIPTS) {
    const source = styles
      .map((href) => fs.readFileSync(path.join(publicDir, href.slice(1)), "utf8"))
      .join("\n");

    const { code } = await esbuild.transform(source, {
      loader: "css",
      minify: true,
      legalComments: "none"
    });

    fs.writeFileSync(path.join(buildDir, `${page}.css`), code);
    entry.styleBundle = `/build/${page}.css`;
    entry.styleReplaces = styles;
    entry.styleBytes = code.length;
  }

  return entry;
}

async function build(options = {}) {
  const buildDir = options.buildDir || BUILD_DIR;
  const built = [];
  for (const page of PAGES) {
    const result = await buildPage(page, options);
    if (result) {
      built.push(result);
    }
  }

  const manifest = {};
  for (const { page, bundle, replaces, styleBundle, styleReplaces } of built) {
    manifest[page] = { bundle, replaces, styleBundle, styleReplaces };
  }

  fs.mkdirSync(buildDir, { recursive: true });
  fs.writeFileSync(path.join(buildDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return built;
}

if (require.main === module) {
  build()
    .then((built) => {
      const size = (list) => list.reduce(
        (total, href) => total + fs.statSync(path.join(PUBLIC_DIR, href.slice(1))).size, 0);
      for (const { page, replaces, bytes, styleReplaces, styleBytes } of built) {
        if (replaces.length) {
          console.log(`  ${page.padEnd(8)} ${String(replaces.length).padStart(3)} scripts      `
            + `${size(replaces).toLocaleString().padStart(10)} -> ${bytes.toLocaleString().padStart(9)}`);
        }
        if (styleReplaces.length) {
          console.log(`  ${page.padEnd(8)} ${String(styleReplaces.length).padStart(3)} stylesheets  `
            + `${size(styleReplaces).toLocaleString().padStart(10)} -> ${styleBytes.toLocaleString().padStart(9)}`);
        }
      }
      console.log("\nWritten to public/build. Delete it to serve the individual files again.");
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { build, buildPage, deferredScripts, ownStylesheets, PAGES, MIN_SCRIPTS };
