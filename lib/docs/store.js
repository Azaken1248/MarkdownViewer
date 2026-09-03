/* The library as it exists on disk.
 *
 * A document is identified by its path relative to the documents directory —
 * "Notes/README.md", POSIX separators, always — and that path is the whole
 * record of where it lives. There is no side table mapping files to folders,
 * which is the point: the directory a file sits in *is* the answer, so the two
 * can never disagree. The recycle bin mirrors the same shape, which is what
 * lets a restore put a document back without anything having been written down.
 *
 * The organizer is injected rather than imported. This module needs to read the
 * folder tree to name a directory, and the organizer needs nothing from here;
 * keeping the arrow pointing one way is what stops the two becoming one.
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { HttpError } = require("../http/errors");
const {
  ALLOWED_DOC_EXTENSIONS,
  MAX_FOLDER_DEPTH,
  sanitizeFilename,
  sanitizePathSegment,
  resolveDocPath,
  resolveRecyclePath,
  parseOriginalFilenameFromRecycleEntry,
  createRecycleEntryFilename,
  docDirOf,
  docBaseOf,
  joinDocPath,
  toDocTitle
} = require("./paths");
const {
  normalizeFolderId,
  folderDirFor,
  resolveFolderInfo,
  buildFolderSortKeys,
  compareNames
} = require("./organizer");

function createDocumentStore({
  markdownDir,
  softDeletedDir,
  hardDeletedDir,
  dataDir,
  readOrganizerState,
  mutateOrganizerState,
  invalidateCachedContent
}) {
  async function ensureStorageDirs() {
    await fsp.mkdir(markdownDir, { recursive: true });
    await fsp.mkdir(softDeletedDir, { recursive: true });
    await fsp.mkdir(hardDeletedDir, { recursive: true });
    await fsp.mkdir(dataDir, { recursive: true });
  }

  /* Move a flat library into directories.
   *
   * Documents used to be a single directory with a filename→folder map. Folders
   * are real directories now, so every file the map placed in a folder has to be
   * moved into it, once, at boot.
   *
   * Written to be safe to run repeatedly and safe to interrupt: it only ever
   * moves a file that is at the top level and is mapped somewhere else, so a
   * half-finished run resumes on the next boot. Nothing is deleted, and a file
   * whose destination is somehow occupied is left exactly where it is and
   * reported rather than renamed — a migration that quietly invents README-1.md
   * would be repeating the very bug this is here to remove.
   */
  async function migrateFlatLibraryToDirectories() {
    const organizer = await readOrganizerState();
    const mapping = organizer.fileFolders || {};

    if (Object.keys(mapping).length === 0) {
      return { moved: 0, folders: 0, skipped: [] };
    }

    let moved = 0;
    const skipped = [];

    // Every folder gets its directory, including empty ones — a folder that
    // exists in the tree but nowhere on disk would vanish on the next boot.
    const folderDirs = new Set();
    for (const folder of organizer.folders) {
      const dir = folderDirFor(organizer, folder.id);
      if (dir) {
        folderDirs.add(dir);
      }
    }

    for (const dir of folderDirs) {
      await fsp.mkdir(path.join(markdownDir, dir), { recursive: true });
    }

    for (const [fileName, folderId] of Object.entries(mapping)) {
      // Only a bare filename can be a leftover from the flat layout; anything
      // with a directory in it has already been moved.
      if (fileName.includes("/") || !sanitizeFilename(fileName)) {
        continue;
      }

      const dir = folderDirFor(organizer, folderId);
      if (!dir) {
        continue;   // folder is gone; the file stays at the top level, unfiled
      }

      const from = path.join(markdownDir, fileName);
      const to = path.join(markdownDir, dir, fileName);

      if (!(await fileExists(from))) {
        continue;
      }

      if (await fileExists(to)) {
        skipped.push(`${fileName} -> ${dir}/ (destination already exists)`);
        continue;
      }

      await moveFile(from, to);
      moved += 1;
    }

    // The map was the old source of truth and is now a stale copy of what the
    // directory layout says. Dropping it is what makes the migration finished.
    await mutateOrganizerState((state) => {
      state.fileFolders = {};
      return state;
    });

    return { moved, folders: folderDirs.size, skipped };
  }

  async function fileExists(filePath) {
    try {
      await fsp.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async function ensureUniqueFilenameInDir(dirPath, fileName) {
    const parsed = path.parse(fileName);
    let index = 1;
    let candidate = fileName;

    while (await fileExists(path.join(dirPath, candidate))) {
      candidate = `${parsed.name}-${index}${parsed.ext}`;
      index += 1;
    }

    return candidate;
  }

  // Unique within the document's own directory, which is the only place a name
  // has to be unique now. Two folders may each hold a README.md.
  async function ensureUniqueFilename(filePath) {
    const dir = docDirOf(filePath);
    const unique = await ensureUniqueFilenameInDir(path.join(markdownDir, dir), docBaseOf(filePath));
    return joinDocPath(dir, unique);
  }

  async function moveFile(sourcePath, targetPath) {
    try {
      await fsp.rename(sourcePath, targetPath);
    } catch (error) {
      if (error?.code !== "EXDEV") {
        throw error;
      }

      await fsp.copyFile(sourcePath, targetPath);
      await fsp.unlink(sourcePath);
    }
  }

  async function moveDocToRecycle(fileName, mode) {
    const sourcePath = path.join(markdownDir, fileName);
    const recycleDir = mode === "hard" ? hardDeletedDir : softDeletedDir;

    // Same folder path inside the bin, so Restore knows where it came from.
    const relativeDir = docDirOf(fileName);
    const targetDir = path.join(recycleDir, relativeDir);
    await fsp.mkdir(targetDir, { recursive: true });

    const baseEntryName = createRecycleEntryFilename(docBaseOf(fileName));
    const entryName = joinDocPath(relativeDir, await ensureUniqueFilenameInDir(targetDir, baseEntryName));
    const targetPath = path.join(recycleDir, entryName);
    await moveFile(sourcePath, targetPath);
    invalidateCachedContent(sourcePath);

    const stat = await fsp.stat(targetPath);
    return {
      file: entryName,
      originalFile: fileName,
      mode,
      size: stat.size,
      deletedAt: stat.mtime.toISOString()
    };
  }

  async function getRecycleDocs(organizerState = null, sourceDir = softDeletedDir) {
    const organizer = organizerState || await readOrganizerState();
    const recycleEntries = (await walkDocs(sourceDir)).map((relative) => ({ name: relative }));

    const docs = await Promise.all(
      recycleEntries.map(async (entry) => {
        const fullPath = path.join(sourceDir, entry.name);
        const stat = await fsp.stat(fullPath);
        const originalFile = parseOriginalFilenameFromRecycleEntry(entry.name);
        const folderInfo = resolveFolderInfo(organizer, originalFile);
        return {
          file: entry.name,
          originalFile,
          title: toDocTitle(originalFile),
          size: stat.size,
          deletedAt: stat.mtime.toISOString(),
          updatedAt: stat.mtime.toISOString(),
          folderId: folderInfo.folderId,
          folderName: folderInfo.folderName,
          folderOrder: folderInfo.folderOrder
        };
      })
    );

    docs.sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt));
    return docs;
  }

  /* Every document under a directory, as paths relative to it.
   *
   * Depth-limited to the folder limit, and symlinked directories are not
   * followed: withFileTypes reports a symlink as neither a file nor a directory,
   * so a link pointing at / is simply not descended into. That matters because
   * this walk decides what the API will serve.
   */
  async function walkDocs(baseDir, relativeDir = "", depth = 0) {
    if (depth > MAX_FOLDER_DEPTH) {
      return [];
    }

    let entries;
    try {
      entries = await fsp.readdir(path.join(baseDir, relativeDir), { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const found = [];

    for (const entry of entries) {
      // Anything the app would refuse to create, it also refuses to list, so a
      // document can never appear that cannot then be addressed.
      if (entry.name.startsWith(".") || !sanitizePathSegment(entry.name)) {
        continue;
      }

      const relative = joinDocPath(relativeDir, entry.name);

      if (entry.isDirectory()) {
        found.push(...await walkDocs(baseDir, relative, depth + 1));
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (ALLOWED_DOC_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        found.push(relative);
      }
    }

    return found;
  }

  async function getDocs(organizerState = null) {
    const organizer = organizerState || await readOrganizerState();
    const markdownEntries = (await walkDocs(markdownDir)).map((relative) => ({ name: relative }));

    // Sorting on a folder's depth-first position keeps the flat list in the same
    // order the nested tree draws it; a bare `order` would interleave levels.
    const folderSortKeys = buildFolderSortKeys(organizer.folders);

    const docs = await Promise.all(
      markdownEntries.map(async (entry) => {
        const fullPath = path.join(markdownDir, entry.name);
        const stat = await fsp.stat(fullPath);
        const folderInfo = resolveFolderInfo(organizer, entry.name);
        return {
          file: entry.name,
          title: toDocTitle(entry.name),
          size: stat.size,
          updatedAt: stat.mtime.toISOString(),
          folderId: folderInfo.folderId,
          folderName: folderInfo.folderName,
          folderPath: folderInfo.folderPath,
          folderOrder: folderInfo.folderOrder,
          // Unfiled documents sort last, which is where Ungrouped renders.
          folderSortKey: folderInfo.folderId ? (folderSortKeys.get(folderInfo.folderId) || "") : "~"
        };
      })
    );

    docs.sort((a, b) => {
      if (a.folderSortKey !== b.folderSortKey) {
        return compareNames(a.folderSortKey, b.folderSortKey);
      }

      // By name, not by when it was last touched. Editing a document used to
      // teleport it to the top of its folder, which is the opposite of what a
      // list you navigate by eye should do.
      return compareNames(toDocTitle(a.file), toDocTitle(b.file)) || compareNames(a.file, b.file);
    });
    return docs;
  }

  /* Put a document back where it was deleted from.
   *
   * The folder comes from the entry's own path inside the bin, so nothing has to
   * be recorded anywhere and a folder deleted in the meantime is simply
   * recreated. The name only has to be free within that folder — the point of
   * the whole change — so a restore collides far less often than it used to.
   */
  async function restoreFromBin(sourceDir, entryName) {
    const sourcePath = resolveRecyclePath(entryName, sourceDir);
    if (!sourcePath || !(await fileExists(sourcePath))) {
      return null;
    }

    const originalFile = parseOriginalFilenameFromRecycleEntry(entryName);
    const targetDir = path.join(markdownDir, docDirOf(originalFile));
    await fsp.mkdir(targetDir, { recursive: true });

    const restoreFileName = await ensureUniqueFilename(originalFile);
    const targetPath = resolveDocPath(restoreFileName, markdownDir);
    if (!targetPath) {
      return null;
    }

    await moveFile(sourcePath, targetPath);
    invalidateCachedContent(sourcePath);
    invalidateCachedContent(targetPath);

    const organizer = await readOrganizerState();
    const folderInfo = resolveFolderInfo(organizer, restoreFileName);
    const stat = await fsp.stat(targetPath);

    return {
      file: restoreFileName,
      title: toDocTitle(restoreFileName),
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
      restoredFrom: entryName,
      folderId: folderInfo.folderId,
      folderName: folderInfo.folderName
    };
  }

  // Where a newly created document should be written. An unknown or absent
  // folder means the top level, which is what Ungrouped shows.
  async function resolveNewDocumentPath(fileName, rawFolderId) {
    const folderId = normalizeFolderId(rawFolderId);
    if (!folderId) {
      return { file: fileName, folderId: null, folderName: null };
    }

    const organizer = await readOrganizerState();
    const folder = organizer.folders.find((entry) => entry.id === folderId);
    if (!folder) {
      throw new HttpError(404, "Folder not found");
    }

    const dir = folderDirFor(organizer, folder.id);
    return { file: joinDocPath(dir, fileName), folderId: folder.id, folderName: folder.name };
  }

  return {
    ensureStorageDirs,
    migrateFlatLibraryToDirectories,
    fileExists,
    ensureUniqueFilenameInDir,
    ensureUniqueFilename,
    moveFile,
    moveDocToRecycle,
    getRecycleDocs,
    walkDocs,
    getDocs,
    restoreFromBin,
    resolveNewDocumentPath
  };
}

module.exports = { createDocumentStore };
