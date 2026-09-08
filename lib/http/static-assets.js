/* The app's own scripts and stylesheets, compressed.
 *
 * Nothing here was compressed at all: the shell names 106 files and they went
 * out as 1.1MB of raw text. Brotli takes that to about 240KB, which is the
 * largest single saving available to this app and costs no build step and no
 * dependency — node has had zlib.brotliCompress since 10.
 *
 * Compressed once and kept, not compressed per request. Brotli at full quality
 * is slow enough that doing it per response would be a worse trade than not
 * doing it at all; doing it once per file and holding the result makes every
 * later request a buffer write. The cache is held against mtime and size, the
 * same bargain asset-versions.js and templateReader make, so editing a file in
 * place is still picked up without a restart.
 *
 * Only /css and /js. Images and fonts are already compressed formats, and
 * running deflate over a PNG spends CPU to make it slightly bigger.
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// Below this, the framing costs more than the compression saves and the
// round trip is dominated by latency anyway.
const MIN_COMPRESS_BYTES = 512;

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

const SERVED = /^\/(?:css|js)\/[A-Za-z0-9._/-]+\.(?:css|js)$/;

/* Which encoding the client asked for, in our order of preference.
 *
 * Deliberately simple: an `identity;q=0` that forbids the plain file is the
 * only q-value that would change the answer, and a client that sends it while
 * also refusing br and gzip has asked for nothing we can send. Everything else
 * is a preference we are free to ignore in favour of the smallest we have.
 */
function pickEncoding(header) {
  const accepted = String(header || "").toLowerCase();
  if (accepted.includes("br")) {
    return "br";
  }

  if (accepted.includes("gzip")) {
    return "gzip";
  }

  return "identity";
}

function createStaticAssets({ publicDir, assetVersions }) {
  const root = path.resolve(publicDir);
  const cache = new Map();

  function encodedFor(urlPath) {
    const full = path.resolve(root, `.${urlPath}`);
    if (full !== root && !full.startsWith(root + path.sep)) {
      return null;
    }

    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      return null;
    }

    if (!stat.isFile()) {
      return null;
    }

    const known = cache.get(urlPath);
    if (known && known.mtimeMs === stat.mtimeMs && known.size === stat.size) {
      return known;
    }

    const identity = fs.readFileSync(full);
    const worthIt = identity.length >= MIN_COMPRESS_BYTES;
    const entry = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      type: CONTENT_TYPES[path.extname(full)] || "application/octet-stream",
      identity,
      // Full quality, because this happens once per file per edit and the
      // result is what every visitor downloads.
      br: worthIt ? zlib.brotliCompressSync(identity) : null,
      gzip: worthIt ? zlib.gzipSync(identity, { level: 9 }) : null
    };

    cache.set(urlPath, entry);
    return entry;
  }

  // Every .css and .js under the two directories this serves.
  function servedPaths() {
    const found = [];
    for (const top of ["css", "js"]) {
      const base = path.join(root, top);
      let entries;
      try {
        entries = fs.readdirSync(base, { recursive: true, withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isFile()) {
          continue;
        }

        const full = path.join(entry.parentPath || entry.path, entry.name);
        found.push(`/${path.relative(root, full).split(path.sep).join("/")}`);
      }
    }

    return found;
  }

  /* Compress everything the pages name, before anyone asks for it.
   *
   * Full-quality brotli over this app's 106 files is about two seconds of CPU.
   * Paid lazily that lands on the first visitor after every restart, one file
   * at a time, serialized behind each other on a single thread. Paid here it
   * happens once while the port is already open, and the first request finds
   * everything ready.
   *
   * Yielding between files so a request arriving mid-warm is answered rather
   * than queued behind the rest of the loop. A file the warm has not reached
   * is compressed on demand and then found here, so this is an optimisation
   * and never a correctness requirement.
   */
  async function warm(urlPaths = servedPaths()) {
    for (const urlPath of urlPaths) {
      if (SERVED.test(urlPath)) {
        encodedFor(urlPath);
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    return cache.size;
  }

  function serveStaticAsset(req, res, next) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return next();
    }

    const urlPath = req.path;
    if (!SERVED.test(urlPath)) {
      return next();
    }

    const entry = encodedFor(urlPath);
    if (!entry) {
      // Not ours to answer. express.static behind this one will 404 it in the
      // ordinary way, which keeps one story about missing files.
      return next();
    }

    const wanted = pickEncoding(req.headers["accept-encoding"]);
    const body = (wanted !== "identity" && entry[wanted]) || entry.identity;
    const encoding = body === entry.identity ? null : wanted;

    res.set("Content-Type", entry.type);
    // The response body depends on a request header, so any cache in between
    // has to key on it too. Without this a proxy can hand brotli to a client
    // that cannot read it.
    res.set("Vary", "Accept-Encoding");
    // Per encoding: the same file compressed two ways is two different bodies,
    // and one ETag for both is how a 304 delivers the wrong bytes.
    res.set("ETag", `W/"${entry.size.toString(16)}-${entry.mtimeMs.toString(16)}-${encoding || "id"}"`);

    if (assetVersions.isCurrent(urlPath, req.query?.v)) {
      res.set("Cache-Control", "public, max-age=31536000, immutable");
    } else {
      res.set("Cache-Control", "public, max-age=0");
    }

    if (encoding) {
      res.set("Content-Encoding", encoding);
    }

    if (req.fresh) {
      return res.status(304).end();
    }

    return res.status(200).send(req.method === "HEAD" ? undefined : body);
  }

  serveStaticAsset.warm = warm;
  serveStaticAsset.servedPaths = servedPaths;
  return serveStaticAsset;
}

module.exports = { createStaticAssets, pickEncoding, MIN_COMPRESS_BYTES };
