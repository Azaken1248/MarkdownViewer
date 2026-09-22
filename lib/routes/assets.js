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
function sniffImageType(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    return null;
  }

  // Each format knows how many bytes it needs to be sure; there is no one
  // minimum. A file that is exactly the PNG signature is PNG-typed content,
  // and this decides type, not whether a picture will decode.

  // PNG: an eight-byte signature chosen so that a text transfer would mangle it.
  if (buffer.length >= 8
    && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
    && buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a) {
    return "image/png";
  }

  // JPEG: SOI marker, then any other marker.
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  // GIF: "GIF87a" or "GIF89a".
  if (buffer.length >= 6 && /^GIF8[79]a$/.test(buffer.toString("latin1", 0, 6))) {
    return "image/gif";
  }

  // WebP: a RIFF container whose form type is WEBP.
  if (buffer.length >= 12
    && buffer.toString("latin1", 0, 4) === "RIFF" && buffer.toString("latin1", 8, 12) === "WEBP") {
    return "image/webp";
  }

  // AVIF: an ISO base media file whose first box is ftyp, with an AVIF brand
  // either as the major brand or among the compatible ones.
  if (buffer.length >= 12 && buffer.toString("latin1", 4, 8) === "ftyp") {
    const boxSize = buffer.readUInt32BE(0);
    const end = Math.min(buffer.length, boxSize > 8 ? boxSize : 32);
    for (let at = 8; at + 4 <= end; at += 4) {
      const brand = buffer.toString("latin1", at, at + 4);
      if (brand === "avif" || brand === "avis") {
        return "image/avif";
      }
    }
  }

  return null;
}

function createAssetRoutes({
  assetsDir,
  markdownDir,
  requireRead,
  requirePermission,
  shareStore,
  fileExists,
  readCachedTextFile
}) {
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

  function assetPath(name) {
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
  async function storeAsset(buffer, mimetype) {
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
  async function sendAsset(res, name) {
    const fullPath = assetPath(name);
    if (!fullPath || !(await fileExists(fullPath))) {
      return false;
    }

    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.type(assetContentType(name));
    res.sendFile(fullPath);
    return true;
  }

  router.post("/api/assets", requirePermission("doc:write"), uploadAsset.single("image"), async (req, res, next) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No image uploaded" });
        return;
      }

      const stored = await storeAsset(req.file.buffer, req.file.mimetype);
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
  });

  router.get("/api/assets/:name", requireRead, async (req, res, next) => {
    try {
      if (!(await sendAsset(res, req.params.name))) {
        res.status(404).json({ error: "That image is not here." });
      }
    } catch (error) {
      next(error);
    }
  });

  // An image inside a shared document has to load for someone who has the link
  // and nothing else. The token is not a key to the whole store, though: the
  // image has to actually appear in the document that was shared, so a link to
  // one document cannot be used to read images attached to another.
  router.get("/api/share/:token/assets/:name", async (req, res, next) => {
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

      if (!(await sendAsset(res, name))) {
        res.status(404).json({ error: "That image is not here." });
      }
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createAssetRoutes, sniffImageType, MAX_ASSET_BYTES };
