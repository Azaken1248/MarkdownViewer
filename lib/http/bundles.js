/* Serving one script tag where the page names eighty-six.
 *
 * The pages are the source of truth about what they load and in what order,
 * and they stay that way: this does not rewrite them. `npm run build`
 * concatenates what a page already names and leaves a manifest saying which
 * tags the bundle stands in for, and this swaps them on the way out.
 *
 * The point of doing it here rather than in the file is that both paths stay
 * real. With no build, every request serves the individual scripts and the
 * source in the browser is the source in the repository, which is what makes
 * this app debuggable without a toolchain. With a build, a visitor gets one
 * request instead of eighty-six. Neither is a special "dev mode" that rots
 * from disuse — the same HTML drives both.
 *
 * The manifest is read per call and held against its mtime, so building while
 * the server is up takes effect on the next request, and deleting the build
 * directory goes back to the individual files without a restart.
 */

const fs = require("fs");
const path = require("path");

function createBundles({ publicDir }) {
  const manifestPath = path.join(publicDir, "build", "manifest.json");
  let cached = null;
  let cachedMtimeMs = 0;

  function manifest() {
    let stat;
    try {
      stat = fs.statSync(manifestPath);
    } catch {
      // No build. Every page serves the scripts it names.
      cached = null;
      cachedMtimeMs = 0;
      return null;
    }

    if (cached && cachedMtimeMs === stat.mtimeMs) {
      return cached;
    }

    try {
      cached = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      cachedMtimeMs = stat.mtimeMs;
    } catch {
      // A half-written manifest is a build in progress, not a reason to stop
      // serving. The individual scripts are still there and still correct.
      cached = null;
      cachedMtimeMs = 0;
    }

    return cached;
  }

  /* The transform for one page.
   *
   * The first tag of the run becomes the bundle and the rest are dropped, so
   * the bundle lands exactly where the scripts it replaces were — before
   * anything that was written to come after them.
   */
  function has(bundle) {
    // A manifest naming a bundle that is not there would otherwise serve a page
    // with no script, or no styling, at all.
    return typeof bundle === "string" && fs.existsSync(path.join(publicDir, bundle.replace(/^\//, "")));
  }

  /* Collapse a run of tags into the one that stands in for them.
   *
   * The first of the run becomes the bundle and the rest are dropped, so the
   * bundle lands exactly where the tags it replaces were — before anything
   * written to come after them, and for the stylesheets in the position the
   * cascade expects.
   */
  function collapse(html, pattern, replaces, tagFor) {
    const wanted = new Set(replaces);
    let placed = false;

    return String(html).replace(pattern, (whole, href) => {
      if (!wanted.has(href)) {
        return whole;
      }

      if (placed) {
        return "";
      }

      placed = true;
      return `${whole.match(/^[ \t]*/)[0]}${tagFor()}\n`;
    });
  }

  const SCRIPT_TAG = /^[ \t]*<script[^>]*\ssrc="(\/js\/[^"?]+)"[^>]*><\/script>\n/gm;
  const STYLE_TAG = /^[ \t]*<link[^>]*\shref="(\/css\/[^"?]+)"[^>]*>\n/gm;

  function forPage(page) {
    return function replaceWithBundles(html) {
      const entry = manifest()?.[page];
      if (!entry) {
        return html;
      }

      let out = String(html);

      if (Array.isArray(entry.replaces) && entry.replaces.length > 0 && has(entry.bundle)) {
        out = collapse(out, SCRIPT_TAG, entry.replaces,
          () => `<script src="${entry.bundle}" defer></script>`);
      }

      if (Array.isArray(entry.styleReplaces) && entry.styleReplaces.length > 0
        && has(entry.styleBundle)) {
        out = collapse(out, STYLE_TAG, entry.styleReplaces,
          () => `<link rel="stylesheet" href="${entry.styleBundle}" />`);
      }

      return out;
    };
  }

  return { forPage, manifest };
}

module.exports = { createBundles };
