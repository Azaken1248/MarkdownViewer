/* The documents themselves: list, search, read, write, rename, move, upload.
 *
 * Every one of these starts by turning what arrived in the URL into a path
 * this app is willing to touch (lib/docs/paths.js) and ends by leaving the
 * caches and the shares consistent with what is now on disk. Those two
 * bookends are why the routes look repetitive: a write that forgets either one
 * leaves the library serving something that is no longer true.
 *
 * A rename is a move, a move is a rename, and both are "put the file where its
 * path says it should be" — which is why the folder change and the rename read
 * so similarly.
 */

const express = require("express");
const path = require("path");
const fsp = require("fs/promises");
const multer = require("multer");
const {
  ALLOWED_DOC_EXTENSIONS,
  resolveDocPath,
  sanitizeNewFilename,
  docDirOf,
  docBaseOf,
  joinDocPath,
  toDocTitle
} = require("../docs/paths");
const {
  normalizeFolderId,
  getFolderRecordById,
  resolveFolderInfo,
  serializeFolders,
  folderDirFor,
  ROOT_FOLDER_LABEL
} = require("../docs/organizer");

function createDocsRoutes({
  markdownDir,
  maxDocBytes,
  requireRead,
  requirePermission,
  shareStore,
  readOrganizerState,
  getDocs,
  searchDocuments,
  resolveNewDocumentPath,
  fileExists,
  moveFile,
  ensureUniqueFilename,
  readCachedTextFile,
  invalidateCachedContent,
  paramDocPath
}) {
  const router = express.Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxDocBytes },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase();
      if (!ALLOWED_DOC_EXTENSIONS.has(ext)) {
        cb(new Error("Only .md, .markdown, .mmd, .mermaid, or .ipynb files are supported"));
        return;
      }
      cb(null, true);
    }
  });

  router.get("/api/docs", requireRead, async (req, res, next) => {
    try {
      const organizer = await readOrganizerState();
      const docs = await getDocs(organizer);
      res.json({
        docs,
        folders: serializeFolders(organizer.folders),
        rootFolderLabel: ROOT_FOLDER_LABEL
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/docs/search", requireRead, async (req, res, next) => {
    try {
      const query = String(req.query.q || req.query.query || "");
      const requestedScope = String(req.query.scope || "docs").trim().toLowerCase();
      const scope = requestedScope === "recycle-bin" || requestedScope === "archive"
        ? requestedScope
        : "docs";
      const payload = await searchDocuments(query, scope);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/docs/*file", requireRead, async (req, res, next) => {
    try {
      const fileName = paramDocPath(req);
      if (!fileName) {
        res.status(400).json({ error: "Invalid markdown file name" });
        return;
      }

      const fullPath = path.join(markdownDir, fileName);
      if (!(await fileExists(fullPath))) {
        res.status(404).json({ error: "Markdown file not found" });
        return;
      }

      const organizer = await readOrganizerState();
      const { content, stat } = await readCachedTextFile(fullPath);
      const folderInfo = resolveFolderInfo(organizer, fileName);

      res.json({
        file: fileName,
        content,
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
        folderId: folderInfo.folderId,
        folderName: folderInfo.folderName
      });
    } catch (error) {
      next(error);
    }
  });

  router.put("/api/docs/*file/folder", requirePermission("doc:write"), async (req, res, next) => {
    try {
      const fileName = paramDocPath(req);
      if (!fileName) {
        res.status(400).json({ error: "Invalid markdown file name" });
        return;
      }

      const fullPath = path.join(markdownDir, fileName);
      if (!(await fileExists(fullPath))) {
        res.status(404).json({ error: "Markdown file not found" });
        return;
      }

      const folderId = req.body?.folderId === undefined ? null : req.body.folderId;
      const normalizedFolderId = normalizeFolderId(folderId);

      if (folderId && !normalizedFolderId) {
        res.status(400).json({ error: "Invalid folder id" });
        return;
      }

      // Moving a document is now a move on disk. The organizer is only consulted
      // for where the target folder lives.
      const organizer = await readOrganizerState();
      if (normalizedFolderId && !getFolderRecordById(organizer, normalizedFolderId)) {
        res.status(404).json({ error: "Folder not found" });
        return;
      }

      const targetDir = normalizedFolderId ? folderDirFor(organizer, normalizedFolderId) : "";
      const targetFile = joinDocPath(targetDir, docBaseOf(fileName));

      if (targetFile === fileName) {
        const unchanged = resolveFolderInfo(organizer, fileName);
        res.json({ file: fileName, folderId: unchanged.folderId, folderName: unchanged.folderName });
        return;
      }

      const targetPath = resolveDocPath(targetFile, markdownDir);
      if (!targetPath) {
        res.status(400).json({ error: "That folder cannot hold a file with this name." });
        return;
      }

      // Same name already in the destination. Refused rather than renamed: the
      // whole point of directories is that you keep the name you chose, and a
      // silent README-1.md here would be the old behaviour creeping back.
      if (await fileExists(targetPath)) {
        res.status(409).json({
          error: `"${docBaseOf(fileName)}" already exists in that folder. Rename one of them first.`
        });
        return;
      }

      await fsp.mkdir(path.dirname(targetPath), { recursive: true });
      await moveFile(fullPath, targetPath);
      invalidateCachedContent(fullPath);

      // The share link is keyed by path, so it has to follow the document or the
      // link 404s with no explanation.
      await shareStore.withLock(() => shareStore.rename(fileName, targetFile));

      const folderInfo = resolveFolderInfo(organizer, targetFile);

      res.json({
        file: targetFile,
        previousFile: fileName,
        folderId: folderInfo.folderId,
        folderName: folderInfo.folderName
      });
    } catch (error) {
      next(error);
    }
  });

  // Both creation paths accept an optional folderId so a new document can land
  // where it belongs instead of always appearing in Ungrouped and needing a
  // second Move action. Returns the resolved folder info for the response.
  router.post("/api/docs", requirePermission("doc:write"), async (req, res, next) => {
    try {
      const fileName = sanitizeNewFilename(req.body.fileName);
      const content = String(req.body.content || "");
      const overwrite = Boolean(req.body.overwrite);

      if (!fileName) {
        res.status(400).json({ error: "Invalid document file name" });
        return;
      }

      if (Buffer.byteLength(content, "utf8") > maxDocBytes) {
        res.status(413).json({ error: "File content exceeds 2MB limit" });
        return;
      }

      const placement = await resolveNewDocumentPath(fileName, req.body.folderId);
      const fullPath = resolveDocPath(placement.file, markdownDir);
      if (!fullPath) {
        res.status(400).json({ error: "Invalid document file name" });
        return;
      }

      // Unique within its folder, not across the library.
      if (!overwrite && (await fileExists(fullPath))) {
        res.status(409).json({ error: "A document with that name already exists in this folder" });
        return;
      }

      await fsp.mkdir(path.dirname(fullPath), { recursive: true });
      await fsp.writeFile(fullPath, content, "utf8");
      invalidateCachedContent(fullPath);
      const stat = await fsp.stat(fullPath);
      const folderInfo = { folderId: placement.folderId, folderName: placement.folderName };

      res.status(201).json({
        file: placement.file,
        title: toDocTitle(placement.file),
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
        folderId: folderInfo.folderId,
        folderName: folderInfo.folderName
      });
    } catch (error) {
      next(error);
    }
  });

  router.put("/api/docs/*file", requirePermission("doc:write"), async (req, res, next) => {
    try {
      const fileName = paramDocPath(req);
      const content = String(req.body.content || "");

      if (!fileName) {
        res.status(400).json({ error: "Invalid document file name" });
        return;
      }

      if (Buffer.byteLength(content, "utf8") > maxDocBytes) {
        res.status(413).json({ error: "File content exceeds 2MB limit" });
        return;
      }

      const fullPath = path.join(markdownDir, fileName);
      if (!(await fileExists(fullPath))) {
        res.status(404).json({ error: "Document not found" });
        return;
      }

      await fsp.writeFile(fullPath, content, "utf8");
      invalidateCachedContent(fullPath);
      const stat = await fsp.stat(fullPath);

      res.json({
        file: fileName,
        title: toDocTitle(fileName),
        size: stat.size,
        updatedAt: stat.mtime.toISOString()
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/docs/*file/rename", requirePermission("doc:write"), async (req, res, next) => {
    try {
      const fileName = paramDocPath(req);
      const targetName = sanitizeNewFilename(req.body?.fileName);

      if (!fileName || !targetName) {
        res.status(400).json({ error: "Invalid document file name" });
        return;
      }

      const sourcePath = path.join(markdownDir, fileName);
      if (!(await fileExists(sourcePath))) {
        res.status(404).json({ error: "Document not found" });
        return;
      }

      // A rename changes the name, never the folder: the new name is resolved
      // inside the directory the document already sits in. Moving between folders
      // is a different endpoint.
      const targetFile = joinDocPath(docDirOf(fileName), targetName);

      if (targetFile === fileName) {
        const unchanged = await fsp.stat(sourcePath);
        const folderInfo = resolveFolderInfo(await readOrganizerState(), fileName);
        res.json({
          file: fileName,
          previousFile: fileName,
          title: toDocTitle(fileName),
          size: unchanged.size,
          updatedAt: unchanged.mtime.toISOString(),
          folderId: folderInfo.folderId,
          folderName: folderInfo.folderName
        });
        return;
      }

      const targetPath = resolveDocPath(targetFile, markdownDir);
      if (!targetPath) {
        res.status(400).json({ error: "Invalid document file name" });
        return;
      }

      if (await fileExists(targetPath)) {
        res.status(409).json({ error: "A document with that name already exists in this folder" });
        return;
      }

      await moveFile(sourcePath, targetPath);
      invalidateCachedContent(sourcePath);
      invalidateCachedContent(targetPath);

      // Nothing to re-file: the document has not left its directory, so its
      // folder is the same one the path already said it was.
      const folderInfo = resolveFolderInfo(await readOrganizerState(), targetFile);

      await shareStore.withLock(() => shareStore.rename(fileName, targetFile));

      const stat = await fsp.stat(targetPath);
      res.json({
        file: targetFile,
        previousFile: fileName,
        title: toDocTitle(targetName),
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
        folderId: folderInfo.folderId,
        folderName: folderInfo.folderName
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/docs/upload", requirePermission("doc:write"), upload.single("markdownFile"), async (req, res, next) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No document file uploaded" });
        return;
      }

      const requestedName = req.body.fileName || req.file.originalname;
      const sanitizedName = sanitizeNewFilename(requestedName);
      if (!sanitizedName) {
        res.status(400).json({ error: "Invalid document file name" });
        return;
      }

      // Single-file upload lands in the chosen folder's directory, and only has
      // to avoid names already in that one folder.
      const placement = await resolveNewDocumentPath(sanitizedName, req.body.folderId);
      const finalName = await ensureUniqueFilename(placement.file);
      const fullPath = resolveDocPath(finalName, markdownDir);
      if (!fullPath) {
        res.status(400).json({ error: "Invalid document file name" });
        return;
      }

      await fsp.mkdir(path.dirname(fullPath), { recursive: true });
      await fsp.writeFile(fullPath, req.file.buffer);
      invalidateCachedContent(fullPath);

      const stat = await fsp.stat(fullPath);
      const folderInfo = { folderId: placement.folderId, folderName: placement.folderName };

      res.status(201).json({
        file: finalName,
        title: toDocTitle(finalName),
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
        folderId: folderInfo.folderId,
        folderName: folderInfo.folderName
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createDocsRoutes };
