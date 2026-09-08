/* The version in an asset's URL, taken from the asset.
 *
 * Every page here loads its scripts and stylesheets as `/js/app.js?v=...`. The
 * query string is not decoration: it is the cache key. A file whose URL never
 * changes is a file a browser is entitled to keep, and a file whose URL changes
 * on every deploy is a file nobody can keep at all — so the number has to be
 * the content, and nothing else.
 *
 * It used to be a number typed into four HTML files by hand. That is an
 * invariant a person has to remember, and the failure it produces is the worst
 * kind: the fix works for whoever wrote it, whose browser had nothing cached,
 * and does not exist for the person who reported the bug. A test could check
 * that the four files agreed with each other; nothing could check that they
 * agreed with the file they were versioning.
 *
 * So the pages no longer carry a version at all. They name the file, this
 * hashes it, and the hash is stamped in on the way out. Bumping a number is not
 * something anyone can now forget to do, because there is no number.
 *
 * The hash is also what lets the file be served `immutable` — see the static
 * route in lib/routes/pages.js. The two halves only work together: a URL that
 * carries the content's own hash can be kept for a year, and one that does not
 * has to be revalidated every time.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// Long enough that two of this project's files will not collide, short enough
// to read in a network panel. Truncated SHA-256, not a counter: two deploys of
// identical bytes produce identical URLs, which is what keeps a rebuild from
// evicting caches that were still correct.
const VERSION_LENGTH = 8;

// Only the app's own static assets. Anything else on the page is a CDN URL with
// its own integrity hash, and rewriting those would break it.
const VERSIONED_URL = /^\/(?:css|js)\/[A-Za-z0-9._/-]+\.(?:css|js)$/;

// src="/js/app.js" or href="/css/app/base.css", with or without a query already
// on it. The quote is captured so a rewrite cannot escape the attribute.
const REFERENCE = /(\s(?:src|href)=")(\/(?:css|js)\/[^"?<>]+)(\?[^"<>]*)?(")/g;

function createAssetVersions({ publicDir }) {
  const root = path.resolve(publicDir);
  // urlPath -> { version, mtimeMs, size }. Held against mtime and size rather
  // than for the life of the process, so editing a file in place is picked up
  // without a restart — the same bargain templateReader makes next door.
  const cache = new Map();

  function versionOf(urlPath) {
    if (!VERSIONED_URL.test(urlPath)) {
      return null;
    }

    const full = path.resolve(root, `.${urlPath}`);
    // `.${urlPath}` cannot climb out on its own, but resolve() is where that
    // would show up if the pattern above were ever loosened.
    if (full !== root && !full.startsWith(root + path.sep)) {
      return null;
    }

    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      // A page naming a file that is not there is a broken page, but it is not
      // this function's business to say so: it leaves the URL alone and the
      // 404 speaks for itself.
      return null;
    }

    if (!stat.isFile()) {
      return null;
    }

    const known = cache.get(urlPath);
    if (known && known.mtimeMs === stat.mtimeMs && known.size === stat.size) {
      return known.version;
    }

    const version = crypto.createHash("sha256")
      .update(fs.readFileSync(full))
      .digest("hex")
      .slice(0, VERSION_LENGTH);

    cache.set(urlPath, { version, mtimeMs: stat.mtimeMs, size: stat.size });
    return version;
  }

  /* Put the current version on every asset a page names.
   *
   * Synchronous on purpose. It is a stat per reference against a warm cache,
   * and the pages it runs on are all `no-cache` — they are rendered per
   * request anyway, and an async version would only move the same work behind
   * a promise per file.
   */
  function stamp(html) {
    return String(html).replace(REFERENCE, (whole, opening, urlPath, query, closing) => {
      const version = versionOf(urlPath);
      return version
        ? `${opening}${urlPath}?v=${version}${closing}`
        : `${opening}${urlPath}${query || ""}${closing}`;
    });
  }

  // Does this request carry the version the file actually has? Only then is the
  // answer safe to call immutable.
  function isCurrent(urlPath, asked) {
    if (!asked || typeof asked !== "string") {
      return false;
    }

    const version = versionOf(urlPath);
    return version !== null && version === asked;
  }

  return { versionOf, stamp, isCurrent, VERSION_LENGTH };
}

module.exports = { createAssetVersions, VERSION_LENGTH, VERSIONED_URL };
