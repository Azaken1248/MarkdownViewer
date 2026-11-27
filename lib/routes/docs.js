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
  ALLOWED_DOC_EXTENSIONS, DOC_EXTENSIONS_SENTENCE,
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
  visibleFolderIds,
  folderDirFor,
  ROOT_FOLDER_LABEL
} = require("../docs/organizer");
const { readBody } = require("../http/body");
const { actorOf } = require("../audit");

function listDocuments(deps) {
  const { readOrganizerState, getDocs, accessStore } = deps;

  return async (req, res, next) => {
  try {
    const organizer = await readOrganizerState();
    const docs = await getDocs(organizer);

    /* A collection is filtered, not refused.
     *
     * A library with one document somebody may not read is still a library,
     * so the answer is the part of it they may read rather than a 403. The
     * predicate comes from req.access, which is the same resolver the guard
     * on a single document uses — asking it a second way here is how the two
     * would come to disagree.
     */
    /* What the walk just saw, so a directory moved in from outside the app
     * is a space somebody can write a statement about without a restart.
     * The library is ordinary files in ordinary directories and is meant to
     * be worked on with ordinary tools; this is where the policy catches up
     * with that, the same way the search index catches up with the disk.
     */
    accessStore.reconcileSpaces(
      docs
        .map((doc) => String(doc.file))
        // A document with no directory is at the library root, which the
        // reserved space owns; only a real directory is a space.
        .filter((file) => file.includes("/"))
        .map((file) => file.split("/")[0]),
      { actor: actorOf(req).user }
    );

    const mayRead = req.access.filter();
    const visible = docs.filter((doc) => mayRead(doc.file));

    /* And the tree over them.
     *
     * A folder is a name, and a name in a space somebody was shut out of is
     * the thing a closed space is for — but an ancestor of a folder they can
     * see has to stay listed, or what they can see hangs off nothing.
     * visibleFolderIds works that out from the documents being answered with,
     * so the tree covers exactly what the list holds; the paths and depths are
     * still computed from the whole tree, which is what keeps a kept
     * ancestor's path right.
     */
    const shown = visibleFolderIds(organizer, { docs: visible, mayRead });

    res.json({
      docs: visible,
      folders: serializeFolders(
        organizer.folders.filter((folder) => shown.has(folder.id)),
        organizer.folders
      ),
      rootFolderLabel: ROOT_FOLDER_LABEL
    });
  } catch (error) {
    next(error);
  }
  };
}

function searchTheLibrary(deps) {
  const { searchDocuments } = deps;

  return async (req, res, next) => {
  try {
    const query = String(req.query.q || req.query.query || "");
    const requestedScope = String(req.query.scope || "docs").trim().toLowerCase();
    const scope = requestedScope === "recycle-bin" || requestedScope === "archive"
      ? requestedScope
      : "docs";
    /* The predicate goes down into the search rather than over its answer.
     *
     * The count and the snippets are worked out in there — `total` is how many
     * matched and the snippets are cut only for the results that survive the
     * limit — so a filter on the way out would both report a number larger
     * than its own list and spend its time cutting snippets nobody is shown.
     */
    const payload = await searchDocuments(query, scope, 0, req.access.filter());
    res.json(payload);
  } catch (error) {
    next(error);
  }
  };
}

function readDocument(deps) {
  const { markdownDir, readOrganizerState, fileExists, readCachedTextFile, paramDocPath } = deps;

  return async (req, res, next) => {
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
  };
}

function fileDocumentInFolder(deps) {
  const { markdownDir, shareStore, readOrganizerState, fileExists, moveFile, invalidateCachedContent, paramDocPath } = deps;

  return async (req, res, next) => {
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

    // null and absent both mean the top level; the store treats them alike.
    const { folderId = null } = readBody(req, { folderId: { type: "string", nullable: true } });
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
  };
}

function createDocument(deps) {
  const { markdownDir, maxDocBytes, resolveNewDocumentPath, fileExists, invalidateCachedContent } = deps;

  return async (req, res, next) => {
  try {
    const body = readBody(req, {
      fileName: { type: "string", default: "" },
      content: { type: "string", default: "" },
      overwrite: { type: "boolean", default: false },
      folderId: { type: "string", nullable: true }
    });
    const fileName = sanitizeNewFilename(body.fileName);
    const { content, overwrite } = body;

    if (!fileName) {
      res.status(400).json({ error: "Invalid document file name" });
      return;
    }

    if (Buffer.byteLength(content, "utf8") > maxDocBytes) {
      res.status(413).json({ error: "File content exceeds 2MB limit" });
      return;
    }

    const placement = await resolveNewDocumentPath(fileName, body.folderId);
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
  };
}

function writeDocument(deps) {
  const { markdownDir, maxDocBytes, fileExists, invalidateCachedContent, paramDocPath } = deps;

  return async (req, res, next) => {
  try {
    const fileName = paramDocPath(req);
    const { content } = readBody(req, { content: { type: "string", default: "" } });

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
  };
}

function renameDocument(deps) {
  const { markdownDir, shareStore, readOrganizerState, fileExists, moveFile, invalidateCachedContent, paramDocPath } = deps;

  return async (req, res, next) => {
  try {
    const fileName = paramDocPath(req);
    const targetName = sanitizeNewFilename(
      readBody(req, { fileName: { type: "string", default: "" } }).fileName);

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
  };
}

function uploadOneDocument(deps) {
  const { markdownDir, resolveNewDocumentPath, ensureUniqueFilename, invalidateCachedContent } = deps;

  return async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No document file uploaded" });
      return;
    }

    // Multipart fields arrive as strings, so the same reader applies.
    const form = readBody(req, {
      fileName: { type: "string", default: "" },
      folderId: { type: "string", nullable: true }
    });
    const requestedName = form.fileName || req.file.originalname;
    const sanitizedName = sanitizeNewFilename(requestedName);
    if (!sanitizedName) {
      res.status(400).json({ error: "Invalid document file name" });
      return;
    }

    // Single-file upload lands in the chosen folder's directory, and only has
    // to avoid names already in that one folder.
    const placement = await resolveNewDocumentPath(sanitizedName, form.folderId);
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
  };
}

/* The routes themselves: what this module is, in one screen.
 *
 * Every handler is a function beside this one, taking the same injected
 * dependencies — so this is the list of addresses and who may use them, and
 * each answer is read on its own.
 */
function createDocsRoutes(deps) {
  const {
    maxDocBytes, requireRead, requirePermission, requireAccess, paramDocPath,
    readOrganizerState, resolveNewDocumentPath
  } = deps;

  // Where the document is, per route. The guard is one; what differs between
  // these routes is only where the name of the thing being asked about lives.
  const theDocumentInThePath = (req) => paramDocPath(req);
  /* ...and where it is going, which is a second question.
   *
   * A move takes a document out of one policy and puts it under another, so
   * write on the source is not enough: the answer has to be yes on both
   * sides, and before anything is renamed on disk — a file that has already
   * moved is under the destination's policy whatever the answer was. The one
   * guard is asked twice rather than a second copy of the rule being written
   * into the handler, which is the whole reason `locate` is a parameter.
   */
  const whereTheDocumentWouldGo = async (req) => {
    const fileName = paramDocPath(req);
    if (!fileName) {
      return "";
    }

    const folderId = normalizeFolderId(req.body?.folderId ?? null);
    if (!folderId) {
      // No folder is the top level, which the reserved space owns.
      return docBaseOf(fileName);
    }

    const organizer = await readOrganizerState();
    if (!getFolderRecordById(organizer, folderId)) {
      // Not a folder, so not a place. The handler answers 404 for it, and a
      // permission question about nowhere has no useful answer.
      return "";
    }

    return joinDocPath(folderDirFor(organizer, folderId), docBaseOf(fileName));
  };

  const theDocumentBeingCreated = async (req) => {
    const asked = sanitizeNewFilename(String(req.body?.fileName || ""));
    if (!asked) {
      // Not a name, so not a place: the handler answers 400 for it, and a
      // permission question about nowhere has no useful answer.
      return "";
    }

    const { file } = await resolveNewDocumentPath(asked, req.body?.folderId ?? null);
    return file;
  };

  const router = express.Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxDocBytes },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase();
      if (!ALLOWED_DOC_EXTENSIONS.has(ext)) {
        cb(new Error(`Only ${DOC_EXTENSIONS_SENTENCE} files are supported`));
        return;
      }
      cb(null, true);
    }
  });

  router.get("/api/docs", requireRead, listDocuments(deps));

  router.get("/api/docs/search", requireRead, searchTheLibrary(deps));

  router.get("/api/docs/*file", requireAccess("doc:read", theDocumentInThePath), readDocument(deps));

  router.put("/api/docs/*file/folder",
    requireAccess("doc:write", theDocumentInThePath),
    requireAccess("doc:write", whereTheDocumentWouldGo),
    fileDocumentInFolder(deps));

  // Both creation paths accept an optional folderId so a new document can land
  // where it belongs instead of always appearing in Ungrouped and needing a
  // second Move action. Returns the resolved folder info for the response.
  router.post("/api/docs", requireAccess("doc:write", theDocumentBeingCreated), createDocument(deps));

  router.put("/api/docs/*file", requireAccess("doc:write", theDocumentInThePath), writeDocument(deps));

  router.post("/api/docs/*file/rename",
    requireAccess("doc:write", theDocumentInThePath), renameDocument(deps));

  /* The role first, then the file, then the space.
   *
   * requirePermission before multer on purpose: an account whose role cannot
   * write has no business having a file read into memory for it. The space is
   * asked about afterwards because the name being uploaded is in the part
   * multer parses.
   */
  router.post("/api/docs/upload",
    requirePermission("doc:write"),
    upload.single("markdownFile"),
    requireAccess("doc:write", async (req) => {
      const asked = sanitizeNewFilename(req.file?.originalname || "");
      if (!asked) {
        return "";
      }

      const { file } = await resolveNewDocumentPath(asked, req.body?.folderId ?? null);
      return file;
    }),
    uploadOneDocument(deps));

  return router;
}

module.exports = { createDocsRoutes };
