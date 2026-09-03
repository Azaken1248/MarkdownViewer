/* Deleting a document, and the two places it can go.
 *
 * A soft delete moves it to the recycle bin; a hard delete moves it to the
 * archive. Neither destroys anything, and both keep the folder path the
 * document had, which is what lets a restore put it back where it came from
 * without anything having been written down.
 *
 * Only one route in this file actually destroys a file, and it is behind
 * doc:erase *and* an echo of the original filename, so a stray DELETE cannot
 * take a document with it.
 *
 * Deleting also revokes the document's share. Leaving that alive would keep
 * serving a deleted document to anyone holding the URL.
 */

const express = require("express");
const path = require("path");
const fsp = require("fs/promises");
const { parseOriginalFilenameFromRecycleEntry } = require("../docs/paths");

function createRecycleRoutes({
  markdownDir,
  softDeletedDir,
  hardDeletedDir,
  requireRead,
  requirePermission,
  shareStore,
  readOrganizerState,
  fileExists,
  moveFile,
  moveDocToRecycle,
  getRecycleDocs,
  restoreFromBin,
  ensureUniqueFilenameInDir,
  readCachedTextFile,
  invalidateCachedContent,
  paramDocPath,
  paramEntryPath
}) {
  const router = express.Router();

  router.post("/api/docs/*file/delete", requirePermission("doc:write"), async (req, res, next) => {
    try {
      const fileName = paramDocPath(req);
      if (!fileName) {
        res.status(400).json({ error: "Invalid markdown file name" });
        return;
      }

      const mode = String(req.body?.mode || "").trim().toLowerCase();
      if (!['soft', 'hard'].includes(mode)) {
        res.status(400).json({ error: "Delete mode must be either 'soft' or 'hard'" });
        return;
      }

      const sourcePath = path.join(markdownDir, fileName);
      if (!(await fileExists(sourcePath))) {
        res.status(404).json({ error: "Markdown file not found" });
        return;
      }

      const deletedDoc = await moveDocToRecycle(fileName, mode);

      // A deleted document must stop being publicly readable. Leaving the share
      // alive would keep it served to anyone holding the URL.
      await shareStore.withLock(() => shareStore.revoke(fileName));

      res.json({
        ...deletedDoc,
        message: mode === "soft"
          ? `${fileName} moved to recycle bin`
          : `${fileName} moved to the archive`
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/recycle-bin", requireRead, async (req, res, next) => {
    try {
      const organizer = await readOrganizerState();
      const docs = await getRecycleDocs(organizer);
      res.json({ docs });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/recycle-bin/*entry/content", requireRead, async (req, res, next) => {
    try {
      const entryName = paramEntryPath(req);
      if (!entryName) {
        res.status(400).json({ error: "Invalid recycle bin entry" });
        return;
      }

      const fullPath = path.join(softDeletedDir, entryName);
      if (!(await fileExists(fullPath))) {
        res.status(404).json({ error: "Recycle bin document not found" });
        return;
      }

      const { content } = await readCachedTextFile(fullPath);
      const originalFile = parseOriginalFilenameFromRecycleEntry(entryName);
      res.json({ file: entryName, originalFile, content });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/recycle-bin/*entry/restore", requirePermission("doc:write"), async (req, res, next) => {
    try {
      const entryName = paramEntryPath(req);
      if (!entryName) {
        res.status(400).json({ error: "Invalid recycle bin entry" });
        return;
      }

      const restored = await restoreFromBin(softDeletedDir, entryName);
      if (!restored) {
        res.status(404).json({ error: "Recycle bin document not found" });
        return;
      }

      res.json({
        ...restored
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/recycle-bin/*entry/hard-delete", requirePermission("doc:write"), async (req, res, next) => {
    try {
      const entryName = paramEntryPath(req);
      if (!entryName) {
        res.status(400).json({ error: "Invalid recycle bin entry" });
        return;
      }

      const sourcePath = path.join(softDeletedDir, entryName);
      if (!(await fileExists(sourcePath))) {
        res.status(404).json({ error: "Recycle bin document not found" });
        return;
      }

      const targetName = await ensureUniqueFilenameInDir(hardDeletedDir, entryName);
      const targetPath = path.join(hardDeletedDir, targetName);
      await moveFile(sourcePath, targetPath);
      invalidateCachedContent(sourcePath);
      invalidateCachedContent(targetPath);

      const stat = await fsp.stat(targetPath);
      res.json({
        file: targetName,
        originalFile: parseOriginalFilenameFromRecycleEntry(targetName),
        size: stat.size,
        deletedAt: stat.mtime.toISOString(),
        mode: "hard",
        message: `${parseOriginalFilenameFromRecycleEntry(targetName)} moved to the archive`
      });
    } catch (error) {
      next(error);
    }
  });

  // --- Archive (deleted_markdowns/hard) --------------------------------------
  // Nothing reaches this directory except via an explicit archive action, and
  // DELETE below is the only place in the app that actually removes a file.

  router.get("/api/archive", requireRead, async (req, res, next) => {
    try {
      const organizer = await readOrganizerState();
      const docs = await getRecycleDocs(organizer, hardDeletedDir);
      res.json({ docs });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/archive/*entry/content", requireRead, async (req, res, next) => {
    try {
      const entryName = paramEntryPath(req);
      if (!entryName) {
        res.status(400).json({ error: "Invalid archive entry" });
        return;
      }

      const fullPath = path.join(hardDeletedDir, entryName);
      if (!(await fileExists(fullPath))) {
        res.status(404).json({ error: "Archived document not found" });
        return;
      }

      const { content } = await readCachedTextFile(fullPath);
      const originalFile = parseOriginalFilenameFromRecycleEntry(entryName);
      res.json({ file: entryName, originalFile, content });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/archive/*entry/restore", requirePermission("doc:write"), async (req, res, next) => {
    try {
      const entryName = paramEntryPath(req);
      if (!entryName) {
        res.status(400).json({ error: "Invalid archive entry" });
        return;
      }

      const restored = await restoreFromBin(hardDeletedDir, entryName);
      if (!restored) {
        res.status(404).json({ error: "Archived document not found" });
        return;
      }

      res.json(restored);
    } catch (error) {
      next(error);
    }
  });

  router.delete("/api/archive/*entry", requirePermission("doc:erase"), async (req, res, next) => {
    try {
      const entryName = paramEntryPath(req);
      if (!entryName) {
        res.status(400).json({ error: "Invalid archive entry" });
        return;
      }

      const fullPath = path.join(hardDeletedDir, entryName);
      if (!(await fileExists(fullPath))) {
        res.status(404).json({ error: "Archived document not found" });
        return;
      }

      const originalFile = parseOriginalFilenameFromRecycleEntry(entryName);

      // The caller must echo back the original filename, so a stray DELETE
      // cannot destroy a document by accident.
      const confirmation = String(req.body?.confirmFile || "").trim();
      if (confirmation !== originalFile) {
        res.status(400).json({
          error: `To delete this permanently, confirm with the file name "${originalFile}".`
        });
        return;
      }

      await fsp.unlink(fullPath);
      invalidateCachedContent(fullPath);

      console.log(`Permanently deleted archived document: ${entryName}`);

      res.json({
        file: entryName,
        originalFile,
        message: `${originalFile} was permanently deleted`
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createRecycleRoutes };
