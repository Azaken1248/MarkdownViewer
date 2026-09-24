/* Creating, renaming, moving and deleting a folder.
 *
 * A folder is a real directory, so each of these is a directory operation
 * first and a change to the tree second — and the order matters: the disk moves
 * while the organizer lock is held, so a crash leaves a folder whose directory
 * is where the tree says it is.
 *
 * Deleting is the interesting one. Subfolders go the way a filesystem does, but
 * documents are never deleted: they are rescued to the top level one at a time,
 * and a name collision there is resolved with a suffix rather than a refusal.
 * It is the one place in this app where renaming beats refusing, because the
 * alternative is refusing to delete a folder at all.
 */

const express = require("express");
const path = require("path");
const fsp = require("fs/promises");
const { HttpError } = require("../http/errors");
const { sanitizePathSegment, docBaseOf } = require("../docs/paths");
const {
  normalizeFolderName,
  normalizeFolderId,
  createFolderId,
  getFolderDepth,
  isFolderWithinSubtree,
  collectFolderSubtreeIds,
  folderDirFor,
  serializeFolders
} = require("../docs/organizer");
const { readBody } = require("../http/body");

function postFolders(deps) {
  const { markdownDir, maxFolderDepth, mutateOrganizerState } = deps;

  return async (req, res, next) => {
  try {
    const body = readBody(req, {
      name: { type: "string", default: "" },
      parentId: { type: "string", nullable: true }
    });
    const folderName = normalizeFolderName(body.name);
    if (!folderName || !sanitizePathSegment(folderName)) {
      // A folder is a directory now, so its name has to survive being one:
      // no leading dot, no trailing dot or space, not a reserved device name.
      res.status(400).json({ error: "Invalid folder name" });
      return;
    }

    // An absent parentId means top level, which keeps the old request shape working.
    const parentId = body.parentId === undefined || body.parentId === null
      ? null
      : normalizeFolderId(body.parentId);

    if (body.parentId && !parentId) {
      res.status(400).json({ error: "Invalid parent folder id" });
      return;
    }

    const { organizer: savedOrganizer, result: folder } = await mutateOrganizerState((organizer) => {
      if (parentId && !organizer.folders.some((entry) => entry.id === parentId)) {
        throw new HttpError(404, "Parent folder not found");
      }

      if (parentId && getFolderDepth(organizer.folders, parentId) + 1 > maxFolderDepth) {
        throw new HttpError(400, `Folders cannot nest deeper than ${maxFolderDepth} levels`);
      }

      // Names only have to be unique among siblings now, the way a filesystem
      // works — two different projects can each have a "Design" folder.
      const existing = organizer.folders.find((entry) =>
        (entry.parentId || null) === parentId
        && entry.name.toLowerCase() === folderName.toLowerCase());
      if (existing) {
        throw new HttpError(409, "A folder with that name already exists here");
      }

      const siblingCount = organizer.folders.filter((entry) => (entry.parentId || null) === parentId).length;
      const now = new Date().toISOString();
      const created = {
        id: createFolderId(),
        name: folderName,
        parentId,
        order: siblingCount,
        createdAt: now,
        updatedAt: now
      };

      organizer.folders.push(created);
      return created;
    });

    // The directory is the folder. Created here rather than lazily on first
    // upload, so an empty folder still exists on disk and survives a restart.
    await fsp.mkdir(path.join(markdownDir, folderDirFor(savedOrganizer, folder.id)), { recursive: true });

    res.status(201).json({
      folder: serializeFolders([folder], savedOrganizer.folders)[0],
      folders: serializeFolders(savedOrganizer.folders)
    });
  } catch (error) {
    next(error);
  }
  };
}

function putFoldersFolderD(deps) {
  const { markdownDir, maxFolderDepth, shareStore, readOrganizerState, mutateOrganizerState, fileExists } = deps;

  return async (req, res, next) => {
  try {
    const asked = folderChangeAsked(req);
    if (asked.error) {
      res.status(400).json({ error: asked.error });
      return;
    }

    const { normalizedFolderId, wantsRename, wantsReparent, folderName, nextParentId } = asked;

    // Captured before the mutation: once the tree changes, the old directory
    // path can no longer be derived from it.
    const beforeOrganizer = await readOrganizerState();
    const previousDir = folderDirFor(beforeOrganizer, normalizedFolderId);

    const { organizer: savedOrganizer, result: folder } = await mutateOrganizerState((organizer) => {
      const target = organizer.folders.find((entry) => entry.id === normalizedFolderId);
      if (!target) {
        throw new HttpError(404, "Folder not found");
      }

      const parentId = wantsReparent ? nextParentId : (target.parentId || null);

      if (wantsReparent && parentId) {
        if (!organizer.folders.some((entry) => entry.id === parentId)) {
          throw new HttpError(404, "Parent folder not found");
        }

        // The whole point of the guard: a folder cannot become its own descendant.
        if (isFolderWithinSubtree(organizer.folders, parentId, normalizedFolderId)) {
          throw new HttpError(400, "A folder cannot be moved inside itself");
        }

        const subtreeDepth = Math.max(
          ...collectFolderSubtreeIds(organizer.folders, normalizedFolderId)
            .map((id) => getFolderDepth(organizer.folders, id))
        ) - getFolderDepth(organizer.folders, normalizedFolderId);

        if (getFolderDepth(organizer.folders, parentId) + 1 + subtreeDepth > maxFolderDepth) {
          throw new HttpError(400, `Folders cannot nest deeper than ${maxFolderDepth} levels`);
        }
      }

      const name = wantsRename ? folderName : target.name;
      const duplicate = organizer.folders.find((entry) =>
        entry.id !== normalizedFolderId
        && (entry.parentId || null) === parentId
        && entry.name.toLowerCase() === name.toLowerCase());
      if (duplicate) {
        throw new HttpError(409, "A folder with that name already exists here");
      }

      if (wantsReparent && parentId !== (target.parentId || null)) {
        target.parentId = parentId;
        target.order = organizer.folders.filter((entry) =>
          entry.id !== normalizedFolderId && (entry.parentId || null) === parentId).length;
      }

      target.name = name;
      target.updatedAt = new Date().toISOString();
      return target;
    });

    // Renaming or reparenting a folder moves its directory, and every document
    // inside it comes along without any of their paths being rewritten
    // anywhere — which is the reason the tree, not the path, is what the
    // organizer stores.
    const nextDir = folderDirFor(savedOrganizer, folder.id);
    if (nextDir !== previousDir && previousDir) {
      const from = path.join(markdownDir, previousDir);
      const to = path.join(markdownDir, nextDir);

      if (await fileExists(from)) {
        await fsp.mkdir(path.dirname(to), { recursive: true });
        await fsp.rename(from, to);
      } else {
        await fsp.mkdir(to, { recursive: true });
      }

      // Share links are keyed by path, so every published document under the
      // folder has to be re-keyed or its link stops resolving.
      await shareStore.withLock(() => shareStore.renamePrefix(`${previousDir}/`, `${nextDir}/`));
    }

    res.json({
      folder: serializeFolders([folder], savedOrganizer.folders)[0],
      folders: serializeFolders(savedOrganizer.folders)
    });
  } catch (error) {
    next(error);
  }
  };
}

function deleteFoldersFolderD(deps) {
  const { markdownDir, shareStore, readOrganizerState, mutateOrganizerState, walkDocs, moveFile, ensureUniqueFilenameInDir, invalidateCachedContent } = deps;

  return async (req, res, next) => {
  try {
    const normalizedFolderId = normalizeFolderId(req.params.folderId);
    if (!normalizedFolderId) {
      res.status(400).json({ error: "Invalid folder id" });
      return;
    }

    // Deleting a folder deletes its subfolders too, the way a filesystem does.
    // Documents are never deleted — they move back to the top level, which is
    // what Ungrouped shows.
    const beforeOrganizer = await readOrganizerState();
    if (!beforeOrganizer.folders.some((entry) => entry.id === normalizedFolderId)) {
      res.status(404).json({ error: "Folder not found" });
      return;
    }

    const removedIds = collectFolderSubtreeIds(beforeOrganizer.folders, normalizedFolderId);
    const rootDir = folderDirFor(beforeOrganizer, normalizedFolderId);

    // Rescued before the directory goes, and one at a time rather than moving
    // the directory itself: they are being flattened to the top level, and two
    // documents from different subfolders can share a name. A collision keeps
    // the document safe under a suffixed name rather than losing it — this is
    // the one place a rename is better than a refusal, because the alternative
    // is refusing to delete a folder at all.
    const rescued = [];
    // walkDocs returns paths relative to the directory it was given as its
    // base, which is markdownDir here — so these already carry the folder.
    for (const from of await walkDocs(markdownDir, rootDir)) {
      const wanted = docBaseOf(from);
      const targetName = await ensureUniqueFilenameInDir(markdownDir, wanted);

      await moveFile(path.join(markdownDir, from), path.join(markdownDir, targetName));
      invalidateCachedContent(path.join(markdownDir, from));
      await shareStore.withLock(() => shareStore.rename(from, targetName));
      rescued.push(targetName);
    }

    if (rootDir) {
      await fsp.rm(path.join(markdownDir, rootDir), { recursive: true, force: true });
    }

    const { organizer: savedOrganizer, result: summary } = await mutateOrganizerState((organizer) => {
      const ids = new Set(removedIds);
      organizer.folders = organizer.folders.filter((entry) => !ids.has(entry.id));
      return { removedFolders: ids.size, unfiledDocuments: rescued.length };
    });

    res.json({
      message: "Folder deleted",
      removedFolders: summary.removedFolders,
      unfiledDocuments: summary.unfiledDocuments,
      folders: serializeFolders(savedOrganizer.folders)
    });
  } catch (error) {
    next(error);
  }
  };
}

/* The routes themselves: what this module is, in one screen. Each handler is
 * a function beside this one, taking the same injected dependencies.
 */
// position after the listed ones, so a partial list can never drop a folder.
/* There is no reorder endpoint any more.
 *
 * Folders and documents are listed alphabetically, so a stored position cannot
 * change what anyone sees. `order` is still written when a folder is created,
 * because the organizer's shape is otherwise unchanged and a field nothing
 * reads is cheaper than another format change so soon after the last one.
 */

/* What this request is asking to change, and whether it makes sense.
 *
 * A parentId that is present and null means "to the top level"; one that is
 * absent means "leave it where it is". The reader keeps that distinction:
 * null comes through as null, absent is not a key at all.
 */
function folderChangeAsked(req) {
  const normalizedFolderId = normalizeFolderId(req.params.folderId);
  if (!normalizedFolderId) {
    return { error: "Invalid folder id" };
  }

  const body = readBody(req, {
    name: { type: "string" },
    parentId: { type: "string", nullable: true }
  });

  const wantsRename = body.name !== undefined;
  const wantsReparent = Object.prototype.hasOwnProperty.call(body, "parentId");
  if (!wantsRename && !wantsReparent) {
    return { error: "Provide a name, a parentId, or both" };
  }

  const folderName = wantsRename ? normalizeFolderName(body.name) : null;
  if (wantsRename && (!folderName || !sanitizePathSegment(folderName))) {
    return { error: "Invalid folder name" };
  }

  const nextParentId = wantsReparent && body.parentId
    ? normalizeFolderId(body.parentId)
    : null;

  if (wantsReparent && body.parentId && !nextParentId) {
    return { error: "Invalid parent folder id" };
  }

  return { normalizedFolderId, wantsRename, wantsReparent, folderName, nextParentId };
}

function createFoldersRoutes(deps) {
  const { requirePermission } = deps;

  const router = express.Router();

  router.post("/api/folders", requirePermission("doc:write"), postFolders(deps));

  // Folder order was previously write-once at creation time. This lets the caller
  // hand back the ids in the order it wants; any folder omitted keeps its relative

  router.put("/api/folders/:folderId", requirePermission("doc:write"), putFoldersFolderD(deps));

  router.delete("/api/folders/:folderId", requirePermission("doc:write"), deleteFoldersFolderD(deps));

  return router;
}

module.exports = { createFoldersRoutes };
