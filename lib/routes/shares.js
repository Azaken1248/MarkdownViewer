/* Publishing one document by link.
 *
 * A share token is a credential, so the read route takes no session, no cookie
 * and no CSRF check — the token is the whole authorisation. It is stored
 * hashed, which is why creating a share is the only moment the full token is
 * ever returned, and why re-creating one rotates it: rotation is the only way
 * to revoke a URL that has already leaked.
 *
 * The response is deliberately minimal. A shared document says nothing about
 * the library it came from: no folder, no neighbours, no user.
 */

const express = require("express");
const path = require("path");
const { toAbsoluteUrl } = require("../http/urls");

function createSharesRoutes({
  markdownDir,
  shareStore,
  requirePermission,
  getBaseUrl,
  fileExists,
  readCachedTextFile,
  paramDocPath,
  toDocTitle
}) {
  const router = express.Router();

  function shareUrlFor(req, token) {
    return toAbsoluteUrl(getBaseUrl(req), `/s/${token}`);
  }

  router.get("/api/shares", requirePermission("share:manage"), (req, res) => {
    res.json({ shares: shareStore.listShares() });
  });

  // Creating a share for a document that already has one rotates the token, which
  // is the only way to revoke a URL that has leaked.
  router.post("/api/docs/*file/share", requirePermission("share:manage"), async (req, res, next) => {
    try {
      const fileName = paramDocPath(req);
      if (!fileName) {
        res.status(400).json({ error: "Invalid markdown file name" });
        return;
      }

      if (!(await fileExists(path.join(markdownDir, fileName)))) {
        res.status(404).json({ error: "Markdown file not found" });
        return;
      }

      const rotated = Boolean(shareStore.findByFile(fileName));
      const token = await shareStore.withLock(() => shareStore.create(fileName, {
        createdBy: req.auth.user.username
      }));

      // The only time the full token is ever returned. It is stored hashed, so
      // there is no way to show it again later.
      res.status(201).json({
        file: fileName,
        rotated,
        url: shareUrlFor(req, token),
        share: shareStore.describe(fileName)
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/api/docs/*file/share", requirePermission("share:manage"), async (req, res, next) => {
    try {
      const fileName = paramDocPath(req);
      if (!fileName) {
        res.status(400).json({ error: "Invalid markdown file name" });
        return;
      }

      const revoked = await shareStore.withLock(() => shareStore.revoke(fileName));
      res.json({ file: fileName, revoked });
    } catch (error) {
      next(error);
    }
  });

  // Public: the share token is the credential. No session, no cookie, no CSRF.
  router.get("/api/share/:token", async (req, res, next) => {
    try {
      const share = shareStore.findByToken(String(req.params.token || ""));
      if (!share) {
        res.status(404).json({ error: "This share link is not valid." });
        return;
      }

      const fullPath = path.join(markdownDir, share.file);
      if (!(await fileExists(fullPath))) {
        res.status(404).json({ error: "The shared document no longer exists." });
        return;
      }

      const { content, stat } = await readCachedTextFile(fullPath);
      await shareStore.withLock(() => shareStore.recordView(share.file));

      // Deliberately minimal: the document and nothing about the library it came
      // from — no folder, no neighbours, no user.
      res.json({
        file: share.file,
        title: toDocTitle(share.file),
        content,
        updatedAt: stat.mtime.toISOString()
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createSharesRoutes };
