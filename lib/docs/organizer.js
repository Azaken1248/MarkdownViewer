/* The folder tree, and the file that records it.
 *
 * Two things live here, and the split matters. Above the factory is the tree
 * itself: pure functions over an array of folder records — ancestry, depth,
 * paths, the sort keys the flat document list is ordered by. They take the
 * state as an argument and could not care less where it came from.
 *
 * Below is the one file that state is stored in, and everything that makes
 * storing it safe: an atomic write, a mutation lock, and the quarantine rule.
 * That file is the only record of which document lives in which folder, so a
 * file that will not parse is treated as "damaged, hands off" rather than
 * "start fresh" — a copy is kept, reads degrade to no folder info, and every
 * write is refused until a person fixes it.
 *
 * The directory a folder's documents live in is *derived* from the tree
 * (folderDirFor), never stored alongside it. That is why renaming a folder is
 * one rename on disk and no rewriting of paths anywhere else.
 */

const path = require("path");
const fsp = require("fs/promises");
const crypto = require("crypto");
const { HttpError } = require("../http/errors");
const {
  UNSAFE_FILENAME_CHARS,
  MAX_FOLDER_DEPTH,
  sanitizeFilename,
  docDirOf
} = require("./paths");

// The virtual group unfiled documents are shown under. It is not a folder, so
// a real folder may not take the name.
const ROOT_FOLDER_LABEL = "Ungrouped";
// Unfiled documents are a catch-all, not a priority group, so they sort after
// every folder the user actually created rather than being pinned to the top.
const UNFILED_FOLDER_ORDER = Number.MAX_SAFE_INTEGER;

// v1 folders were a flat list. v2 adds `parentId`, and a v1 file loads cleanly
// because a missing parentId normalizes to null, which is exactly "top level".
const ORGANIZER_VERSION = 2;
function createDefaultOrganizerState() {
  return {
    version: ORGANIZER_VERSION,
    folders: [],
    fileFolders: {}
  };
}

// `allowRootLabel` exists so loading state off disk never silently discards a
// folder (and every file mapped into it) that an older build let through.
// New names coming from a request are always validated strictly.
function normalizeFolderName(rawName, { allowRootLabel = false } = {}) {
  const value = String(rawName || "").normalize("NFC").trim().replace(/\s+/g, " ");
  if (!value || value.length > 80) {
    return null;
  }

  // Folder names are never used as path segments, so the only hard limits are
  // control characters and the dot names.
  if (UNSAFE_FILENAME_CHARS.test(value)) {
    return null;
  }

  if (value === "." || value === "..") {
    return null;
  }

  // "Ungrouped" is the virtual group unfiled documents are shown under. A real
  // folder by that name renders as a second, identical-looking heading.
  if (!allowRootLabel && value.toLowerCase() === ROOT_FOLDER_LABEL.toLowerCase()) {
    return null;
  }

  return value;
}

function normalizeFolderId(rawId) {
  const value = String(rawId || "").trim();
  if (!value) {
    return null;
  }

  if (value === "." || value === "..") {
    return null;
  }

  if (!/^[A-Za-z0-9._-]+$/i.test(value)) {
    return null;
  }

  return value;
}

function createFolderId() {
  return `folder_${crypto.randomUUID().replace(/-/g, "")}`;
}

function normalizeOrganizerState(rawState) {
  const folders = Array.isArray(rawState?.folders)
    ? rawState.folders.map((folder, index) => {
      const id = normalizeFolderId(folder?.id);
      const name = normalizeFolderName(folder?.name, { allowRootLabel: true });
      if (!id || !name) {
        return null;
      }

      const createdAt = typeof folder?.createdAt === "string" && folder.createdAt
        ? folder.createdAt
        : new Date().toISOString();
      const updatedAt = typeof folder?.updatedAt === "string" && folder.updatedAt
        ? folder.updatedAt
        : createdAt;

      return {
        id,
        name,
        // Absent on v1 state, which is correct: those folders were all top level.
        parentId: normalizeFolderId(folder?.parentId),
        order: Number.isFinite(Number(folder?.order)) ? Number(folder.order) : index,
        createdAt,
        updatedAt
      };
    }).filter(Boolean)
    : [];

  sanitizeFolderHierarchy(folders);

  folders.sort((left, right) => {
    if (left.order !== right.order) {
      return left.order - right.order;
    }

    return left.name.localeCompare(right.name);
  });

  const folderIds = new Set(folders.map((folder) => folder.id));
  const fileFolders = {};

  if (rawState && typeof rawState.fileFolders === "object") {
    for (const [fileName, folderIdRaw] of Object.entries(rawState.fileFolders)) {
      const sanitizedFileName = sanitizeFilename(fileName);
      const folderId = normalizeFolderId(folderIdRaw);

      if (!sanitizedFileName || !folderId || !folderIds.has(folderId)) {
        continue;
      }

      fileFolders[sanitizedFileName] = folderId;
    }
  }

  return {
    version: ORGANIZER_VERSION,
    folders,
    fileFolders
  };
}

// --- Folder hierarchy -----------------------------------------------------
// A parent reference is only ever dropped, never the folder itself: a folder
// whose parent vanished becomes top level rather than disappearing along with
// every document filed inside it.
function sanitizeFolderHierarchy(folders) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));

  for (const folder of folders) {
    if (folder.parentId && (folder.parentId === folder.id || !byId.has(folder.parentId))) {
      folder.parentId = null;
    }
  }

  // Break cycles by detaching whichever folder closes the loop. Hand-edited
  // state is the realistic source of these, and a cycle would hang the walk.
  for (const folder of folders) {
    const seen = new Set([folder.id]);
    let current = folder.parentId ? byId.get(folder.parentId) : null;

    while (current) {
      if (seen.has(current.id)) {
        current.parentId = null;
        break;
      }

      seen.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : null;
    }
  }

  // Anything nested past the cap is lifted to the top rather than rejected.
  for (const folder of folders) {
    let depth = 0;
    let current = folder.parentId ? byId.get(folder.parentId) : null;

    while (current && depth <= MAX_FOLDER_DEPTH) {
      depth += 1;
      current = current.parentId ? byId.get(current.parentId) : null;
    }

    if (depth > MAX_FOLDER_DEPTH) {
      folder.parentId = null;
    }
  }

  return folders;
}

function getFolderAncestry(folders, folderId) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const chain = [];
  let current = byId.get(folderId) || null;

  while (current && chain.length <= MAX_FOLDER_DEPTH + 1) {
    chain.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : null;
  }

  return chain;
}

function getFolderDepth(folders, folderId) {
  return Math.max(getFolderAncestry(folders, folderId).length - 1, 0);
}

function getFolderPath(folders, folderId) {
  return getFolderAncestry(folders, folderId).map((folder) => folder.name).join(" / ");
}

// True when `candidateId` is `ancestorId` or sits anywhere beneath it. This is
// what stops a folder being dragged into its own subtree.
function isFolderWithinSubtree(folders, candidateId, ancestorId) {
  if (!candidateId || !ancestorId) {
    return false;
  }

  return getFolderAncestry(folders, candidateId).some((folder) => folder.id === ancestorId);
}

function collectFolderSubtreeIds(folders, rootId) {
  const childrenByParent = new Map();
  for (const folder of folders) {
    const key = folder.parentId || "__root__";
    if (!childrenByParent.has(key)) {
      childrenByParent.set(key, []);
    }
    childrenByParent.get(key).push(folder);
  }

  const ids = [];
  const queue = [rootId];

  while (queue.length) {
    const current = queue.shift();
    ids.push(current);
    for (const child of childrenByParent.get(current) || []) {
      queue.push(child.id);
    }
  }

  return ids;
}

// Documents are sorted by their folder's position in a depth-first walk, so a
// flat list still comes back in the order the tree displays.
/* Alphabetical, case-insensitively, and numbers compared as numbers so
 * "page-2" comes before "page-10" rather than after it. Used for folders and
 * for documents, on both sides, so the tree and the flat list agree.
 */
function compareNames(left, right) {
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
}

/* A key that sorts a flat list of documents into the order the nested tree
 * draws them: each ancestor's name in turn, so a folder's documents follow it
 * and its subfolders sort among themselves.
 *
 * Keyed on names rather than on the stored `order`, because the tree is
 * alphabetical now. \u0000 separates the levels: it cannot appear in a folder
 * name, so "A" and "A B" cannot run together into the same key.
 */
function buildFolderSortKeys(folders) {
  const keys = new Map();

  for (const folder of folders) {
    const key = getFolderAncestry(folders, folder.id)
      .map((entry) => entry.name.toLowerCase())
      .join("\u0000");
    keys.set(folder.id, key);
  }

  return keys;
}

function getFolderRecordById(organizerState, folderId) {
  const normalizedFolderId = normalizeFolderId(folderId);
  if (!normalizedFolderId) {
    return null;
  }

  return organizerState.folders.find((folder) => folder.id === normalizedFolderId) || null;
}

/* Which folder a document is in.
 *
 * Read off the path now, not out of a map. The directory a file sits in *is*
 * the answer, so the two can no longer disagree — the old fileFolders map was a
 * second source of truth that a rename outside the app silently invalidated.
 */
function resolveFolderInfo(organizerState, filePath) {
  const folderId = folderIdForDir(organizerState, docDirOf(filePath));
  if (!folderId) {
    return {
      folderId: null,
      folderName: null,
      folderPath: null,
      folderOrder: UNFILED_FOLDER_ORDER
    };
  }

  const folder = getFolderRecordById(organizerState, folderId);
  if (!folder) {
    return {
      folderId: null,
      folderName: null,
      folderPath: null,
      folderOrder: UNFILED_FOLDER_ORDER
    };
  }

  return {
    folderId: folder.id,
    folderName: folder.name,
    folderPath: getFolderPath(organizerState.folders, folder.id),
    folderOrder: Number.isFinite(Number(folder.order)) ? Number(folder.order) : Number.MAX_SAFE_INTEGER
  };
}

function serializeFolders(folders, allFolders = folders) {
  // Sorted here rather than only in the client, so the API's own answer is in
  // the order the tree draws it. Depth-first by path, so a folder's children
  // follow it instead of the whole list being flat-sorted by name.
  const sorted = [...folders].sort((left, right) =>
    compareNames(getFolderPath(allFolders, left.id), getFolderPath(allFolders, right.id)));

  return sorted.map((folder) => ({
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId || null,
    depth: getFolderDepth(allFolders, folder.id),
    path: getFolderPath(allFolders, folder.id),
    order: Number.isFinite(Number(folder.order)) ? Number(folder.order) : 0,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt
  }));
}

// The directory a folder's documents live in, relative to MARKDOWN_DIR. The
// folder tree in the organizer is still what carries ordering and stable ids
// across a rename; the directory is derived from it rather than the other way
// round, so renaming a folder is one rename on disk and no rewriting of paths
// in any other file.
function folderDirFor(organizerState, folderId) {
  if (!folderId) {
    return "";
  }

  const ancestry = getFolderAncestry(organizerState.folders, folderId);
  if (ancestry.length === 0) {
    return "";
  }

  return ancestry.map((folder) => folder.name).join("/");
}

// The reverse: which folder, if any, owns a directory. Matched on the path the
// folder tree implies, so a directory created by hand outside the app shows its
// documents as unfiled rather than inventing a folder.
function folderIdForDir(organizerState, dirPath) {
  if (!dirPath) {
    return null;
  }

  for (const folder of organizerState.folders) {
    if (folderDirFor(organizerState, folder.id) === dirPath) {
      return folder.id;
    }
  }

  return null;
}

/* Everything that touches the file on disk. The data directory is the one the
 * file sits in — there is no second place to configure, and no way for the two
 * to disagree.
 */
function createOrganizerFile({ filePath }) {
  const dataDir = path.dirname(filePath);

  // The organizer file is the only record of which document lives in which
  // folder. Losing it is unrecoverable, so a file we cannot parse is treated as
  // "damaged, hands off" rather than "start fresh": we keep a copy, keep serving
  // reads without folder info, and refuse every write until a human intervenes.
  let organizerDamage = null;

  async function quarantineOrganizerFile(reason) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${filePath}.corrupt-${stamp}`;

    try {
      await fsp.copyFile(filePath, backupPath);
    } catch (copyError) {
      console.error("Could not preserve damaged organizer file", copyError);
      return null;
    }

    console.error(
      `Organizer file could not be parsed (${reason}). A copy was preserved at ${backupPath}. `
      + "Folder writes are disabled until data/document-organizer.json is valid JSON again."
    );

    return backupPath;
  }

  async function readOrganizerState({ forWrite = false } = {}) {
    let raw;

    try {
      raw = await fsp.readFile(filePath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        // No file yet is a legitimate first run - not damage.
        organizerDamage = null;
        return createDefaultOrganizerState();
      }

      throw error;
    }

    try {
      const parsed = normalizeOrganizerState(JSON.parse(raw));
      organizerDamage = null;
      return parsed;
    } catch (parseError) {
      if (!organizerDamage) {
        const backupPath = await quarantineOrganizerFile(parseError.message);
        // Worst case two concurrent readers each write a backup, which is
        // harmless; the original file is never touched either way.
        // eslint-disable-next-line require-atomic-updates
        organizerDamage = { backupPath, message: parseError.message };
      }

      if (forWrite) {
        throw new HttpError(
          503,
          `Folder data on disk is damaged and was not overwritten${organizerDamage.backupPath ? ` (copy kept at ${path.basename(organizerDamage.backupPath)})` : ""}. Fix data/document-organizer.json, then retry.`
        );
      }

      // Reads degrade to "no folder info" so documents stay browsable.
      return createDefaultOrganizerState();
    }
  }

  async function writeOrganizerStateUnsafe(organizerState) {
    const normalized = normalizeOrganizerState(organizerState);
    await fsp.mkdir(dataDir, { recursive: true });

    // Write to a sibling temp file, flush it, then rename. rename(2) is atomic
    // within a filesystem, so a crash leaves either the old file or the new one
    // intact - never a truncated one.
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    const payload = `${JSON.stringify(normalized, null, 2)}\n`;

    let handle;
    try {
      handle = await fsp.open(tempPath, "w");
      await handle.writeFile(payload, "utf8");
      await handle.sync();
    } finally {
      await handle?.close();
    }

    try {
      await fsp.rename(tempPath, filePath);
    } catch (error) {
      await fsp.unlink(tempPath).catch(() => {});
      throw error;
    }

    return normalized;
  }

  // Folder mutations are read-modify-write cycles. Without serialization two
  // concurrent requests both read the old state and the second write silently
  // discards the first one's change.
  let organizerMutationChain = Promise.resolve();

  function withOrganizerLock(task) {
    const result = organizerMutationChain.then(task, task);
    organizerMutationChain = result.then(() => undefined, () => undefined);
    return result;
  }

  async function mutateOrganizerState(mutator) {
    return withOrganizerLock(async () => {
      const organizer = await readOrganizerState({ forWrite: true });
      const mutatorResult = await mutator(organizer);
      const saved = await writeOrganizerStateUnsafe(organizer);
      return { organizer: saved, result: mutatorResult };
    });
  }

  return { readOrganizerState, mutateOrganizerState, withOrganizerLock };
}

module.exports = {
  ROOT_FOLDER_LABEL,
  UNFILED_FOLDER_ORDER,
  ORGANIZER_VERSION,
  createDefaultOrganizerState,
  normalizeFolderName,
  normalizeFolderId,
  createFolderId,
  normalizeOrganizerState,
  sanitizeFolderHierarchy,
  getFolderAncestry,
  getFolderDepth,
  getFolderPath,
  isFolderWithinSubtree,
  collectFolderSubtreeIds,
  compareNames,
  buildFolderSortKeys,
  getFolderRecordById,
  resolveFolderInfo,
  serializeFolders,
  folderDirFor,
  folderIdForDir,
  createOrganizerFile
};
