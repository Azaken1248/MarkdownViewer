/* Pasted images
 *
 * A picture pasted into a document has to live somewhere. It does not live in
 * the static root: everything under PUBLIC_DIR is served by express.static with
 * no idea who is asking, and the whole point of the routes below is that an
 * image is read under the same rule as the document that embeds it.
 *
 * The stored name is the SHA-256 of the bytes, so the same screenshot pasted
 * into four documents is written once, a re-upload is idempotent, and the name
 * says nothing about who uploaded it or what it was called on their disk.
 *
 * SVG is deliberately not accepted. It is a document format that can carry
 * script, and serving one inline from this origin would hand an author a way to
 * run code in every reader's session. Clipboard images are never SVG anyway.
 */

const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const fsp = require("fs/promises");
const path = require("path");

const MAX_ASSET_BYTES = 10 * 1024 * 1024;
const ASSET_TYPES = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"],
  ["image/avif", ".avif"]
]);
const ASSET_NAME_RE = /^[0-9a-f]{64}\.(png|jpg|gif|webp|avif)$/;

/* What the bytes say they are.
 *
 * The type used to be whatever the client wrote in the multipart header, and
 * nothing looked at the content: anything at all, declared image/png, was
 * stored as <sha256>.png and served back as image/png. The reasons that was
 * not a live hole were real — nosniff, no SVG, the CSP, a name that is a hash
 * — but they were defence in depth around a store that would accumulate
 * arbitrary bytes under names that claimed to be pictures.
 *
 * So the bytes decide. Every format this app accepts announces itself in its
 * first few bytes, and the extension is derived from what is found there, not
 * from the header — the two can then never diverge. The header still has to
 * agree, because a client that says PNG and sends JPEG is confused at best,
 * and a refusal that names the disagreement is more useful than a silent
 * correction. No dependency: five formats, five signatures.
 */
/* What a picture is, by the bytes it starts with.
 *
 * Each format knows how many bytes it needs to be sure; there is no one
 * minimum. A file that is exactly the PNG signature is PNG-typed content, and
 * this decides type, not whether a picture will decode.
 */
/** @type {[string, number, (bytes: Buffer) => boolean][]} */
const IMAGE_SIGNATURES = [
  // PNG: an eight-byte signature chosen so that a text transfer would mangle it.
  ["image/png", 8, (bytes) => bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e
    && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a
    && bytes[7] === 0x0a],

  // JPEG: SOI marker, then any other marker.
  ["image/jpeg", 3, (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff],

  // GIF: "GIF87a" or "GIF89a".
  ["image/gif", 6, (bytes) => /^GIF8[79]a$/.test(bytes.toString("latin1", 0, 6))],

  // WebP: a RIFF container whose form type is WEBP.
  ["image/webp", 12, (bytes) => bytes.toString("latin1", 0, 4) === "RIFF"
    && bytes.toString("latin1", 8, 12) === "WEBP"],

  // AVIF: an ISO base media file whose first box is ftyp, with an AVIF brand
  // either as the major brand or among the compatible ones.
  ["image/avif", 12, (bytes) => bytes.toString("latin1", 4, 8) === "ftyp" && hasAvifBrand(bytes)]
];

function hasAvifBrand(buffer) {
  const boxSize = buffer.readUInt32BE(0);
  const end = Math.min(buffer.length, boxSize > 8 ? boxSize : 32);

  for (let at = 8; at + 4 <= end; at += 4) {
    const brand = buffer.toString("latin1", at, at + 4);
    if (brand === "avif" || brand === "avis") {
      return true;
    }
  }

  return false;
}

function sniffImageType(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    return null;
  }

  const known = IMAGE_SIGNATURES.find(([, least, looksLike]) =>
    buffer.length >= least && looksLike(buffer));

  return known ? known[0] : null;
}

function postAssets(deps) {
  return async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No image uploaded" });
      return;
    }

    const stored = await storeAsset(req.file.buffer, req.file.mimetype, deps);
    if (!stored) {
      res.status(400).json({ error: "Only PNG, JPEG, GIF, WebP and AVIF images can be attached" });
      return;
    }

    if (stored.mismatch) {
      res.status(400).json({
        error: `That file is ${stored.mismatch.actual}, not ${stored.mismatch.declared || "the type it was sent as"}.`
      });
      return;
    }

    res.status(201).json({
      name: stored.name,
      url: `/api/assets/${stored.name}`,
      size: req.file.size,
      // What the bytes are, which is now also what the client said.
      type: sniffImageType(req.file.buffer)
    });
  } catch (error) {
    next(error);
  }
  };
}

function getAssetsName(deps) {
  return async (req, res, next) => {
  try {
    if (!(await sendAsset(res, req.params.name, deps))) {
      res.status(404).json({ error: "That image is not here." });
    }
  } catch (error) {
    next(error);
  }
  };
}

function getShareTokenAssetsName(deps) {
  const { markdownDir, shareStore, fileExists, readCachedTextFile } = deps;

  return async (req, res, next) => {
  try {
    const share = shareStore.findByToken(String(req.params.token || ""));
    const name = String(req.params.name || "");

    if (!share || !ASSET_NAME_RE.test(name)) {
      res.status(404).json({ error: "That image is not here." });
      return;
    }

    const fullPath = path.join(markdownDir, share.file);
    if (!(await fileExists(fullPath))) {
      res.status(404).json({ error: "That image is not here." });
      return;
    }

    const { content } = await readCachedTextFile(fullPath);
    if (!content.includes(name)) {
      res.status(404).json({ error: "That image is not here." });
      return;
    }

    if (!(await sendAsset(res, name, deps))) {
      res.status(404).json({ error: "That image is not here." });
    }
  } catch (error) {
    next(error);
  }
  };
}

function assetPath(name, assetsDir) {
  // The name is the only thing a caller controls, so it is matched against the
  // exact shape this writes rather than sanitized into one.
  return ASSET_NAME_RE.test(String(name || "")) ? path.join(assetsDir, String(name)) : null;
}

function assetContentType(name) {
  const ext = path.extname(String(name || "")).toLowerCase();
  for (const [type, candidate] of ASSET_TYPES) {
    if (candidate === ext) {
      return type;
    }
  }

  return "application/octet-stream";
}

/** Store the bytes under their hash, with the extension the bytes earn.
 *
 * Answers the stored name, or a reason not to: `null` when the bytes are
 * not an image this app takes, and a `{ mismatch }` when they are one but
 * not the one the client said. The route turns each into its own message.
 *
 * @param {Buffer} buffer
 * @param {string} mimetype
 * @returns {Promise<{ name?: string, mismatch?: { declared: string, actual: string } } | null>}
 */
async function storeAsset(buffer, mimetype, { assetsDir, fileExists }) {
  const declared = String(mimetype || "").toLowerCase();
  const actual = sniffImageType(buffer);
  if (!actual) {
    return null;
  }

  if (declared !== actual) {
    return { mismatch: { declared, actual } };
  }


  const ext = ASSET_TYPES.get(actual);
  const name = `${crypto.createHash("sha256").update(buffer).digest("hex")}${ext}`;
  const fullPath = path.join(assetsDir, name);

  await fsp.mkdir(assetsDir, { recursive: true });

  // Same bytes, same name: already there is already correct. Writing again
  // would only risk truncating a file something else is reading.
  if (!(await fileExists(fullPath))) {
    await fsp.writeFile(fullPath, buffer);
  }

  return { name };
}

// The bytes are immutable — the name is their hash — so this is one of the few
// things in the app that can be cached hard.
async function sendAsset(res, name, { assetsDir, fileExists }) {
  const fullPath = assetPath(name, assetsDir);
  if (!fullPath || !(await fileExists(fullPath))) {
    return false;
  }

  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.type(assetContentType(name));
  res.sendFile(fullPath);
  return true;
}

/* The routes themselves: what this module is, in one screen. Each handler is
 * a function beside this one, taking the same injected dependencies.
 */
function createAssetRoutes(deps) {
  const { requireRead, requirePermission } = deps;

  const router = express.Router();

  const uploadAsset = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_ASSET_BYTES, files: 1 },
    fileFilter: (req, file, cb) => {
      if (!ASSET_TYPES.has(String(file.mimetype || "").toLowerCase())) {
        cb(new Error("Only PNG, JPEG, GIF, WebP and AVIF images can be attached"));
        return;
      }

      cb(null, true);
    }
  });

  router.post("/api/assets", requirePermission("doc:write"), uploadAsset.single("image"), postAssets(deps));

  router.get("/api/assets/:name", requireRead, getAssetsName(deps));

  // An image inside a shared document has to load for someone who has the link
  // and nothing else. The token is not a key to the whole store, though: the
  // image has to actually appear in the document that was shared, so a link to
  // one document cannot be used to read images attached to another.
  router.get("/api/share/:token/assets/:name", getShareTokenAssetsName(deps));

  return router;
}

module.exports = { createAssetRoutes, sniffImageType, MAX_ASSET_BYTES };
