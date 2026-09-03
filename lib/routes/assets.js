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

  async function storeAsset(buffer, mimetype) {
    const ext = ASSET_TYPES.get(String(mimetype || "").toLowerCase());
    if (!ext) {
      return null;
    }

    const name = `${crypto.createHash("sha256").update(buffer).digest("hex")}${ext}`;
    const fullPath = path.join(assetsDir, name);

    await fsp.mkdir(assetsDir, { recursive: true });

    // Same bytes, same name: already there is already correct. Writing again
    // would only risk truncating a file something else is reading.
    if (!(await fileExists(fullPath))) {
      await fsp.writeFile(fullPath, buffer);
    }

    return name;
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

      const name = await storeAsset(req.file.buffer, req.file.mimetype);
      if (!name) {
        res.status(400).json({ error: "Only PNG, JPEG, GIF, WebP and AVIF images can be attached" });
        return;
      }

      res.status(201).json({
        name,
        url: `/api/assets/${name}`,
        size: req.file.size,
        type: String(req.file.mimetype || "").toLowerCase()
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

module.exports = { createAssetRoutes, MAX_ASSET_BYTES };
