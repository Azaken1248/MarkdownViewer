/* Folder upload
 *
 * The browser knows each picked file's path within the chosen folder
 * (webkitRelativePath). Those paths are sent as an explicit `paths` field —
 * a JSON array, index-aligned with the files — rather than smuggled in as the
 * multipart filename, because whether a filename survives with its slashes
 * intact varies by client and is not worth depending on.
 *
 * Every segment is attacker-controlled. This rebuilds the tree from sanitised
 * names only and never joins a client string onto a filesystem path. Documents
 * stay flat on disk — the folder tree lives in the organizer — so a traversal
 * attempt has nowhere to go even if it got through. It is rejected anyway, on
 * the principle that the second lock is the one that matters.
 */

const express = require("express");
const path = require("path");
const fsp = require("fs/promises");
const multer = require("multer");
const {
  ALLOWED_DOC_EXTENSIONS,
  UNSAFE_FILENAME_CHARS_GLOBAL,
  sanitizeNewFilename,
  resolveDocPath,
  docBaseOf,
  joinDocPath
} = require("../docs/paths");
const {
  ROOT_FOLDER_LABEL,
  normalizeFolderName,
  normalizeFolderId,
  createFolderId,
  getFolderDepth,
  getFolderPath,
  folderDirFor
} = require("../docs/organizer");

function createUploadRoutes({
  markdownDir,
  maxDocBytes,
  maxFolderDepth,
  requirePermission,
  readOrganizerState,
  mutateOrganizerState,
  ensureUniqueFilenameInDir,
  invalidateCachedContent
}) {
  const router = express.Router();

  const MAX_FOLDER_UPLOAD_FILES = 200;

  const uploadFolder = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxDocBytes, files: MAX_FOLDER_UPLOAD_FILES },
    // Same strict filter as the single-file upload. The client drops the images
    // and .DS_Store entries out of a picked folder before sending, so anything
    // unsupported arriving here means a broken or hand-rolled request, and a
    // clear rejection beats silently skipping it — a skipped file would also
    // misalign the path array below.
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase();
      if (!ALLOWED_DOC_EXTENSIONS.has(ext)) {
        cb(new Error("Only .md, .markdown, .mmd, .mermaid, or .ipynb files are supported"));
        return;
      }

      cb(null, true);
    }
  });


  const MAX_FOLDER_NAME_LENGTH = 80;

  // One path segment of an uploaded folder.
  //
  // The document is the thing worth keeping; the folder name is decoration. So a
  // name this app will not accept verbatim gets repaired rather than costing the
  // file — an over-long directory or one called "Ungrouped" is an ordinary thing
  // to find on disk, and dropping someone's document over it would be absurd.
  //
  // Only ".." is refused outright, because that is not an awkward name, it is an
  // attempt at something.
  //
  // Returns { name } to use it, { drop: true } to skip the level and file into
  // the parent, or { unsafe: true } to reject the path.
  function repairPathSegment(segment) {
    const raw = String(segment || "").normalize("NFC");

    if (raw.trim() === "..") {
      return { unsafe: true };
    }

    // Control characters and path punctuation come out; they are never part of
    // what the folder is called.
    let value = raw
      .replace(UNSAFE_FILENAME_CHARS_GLOBAL, "")
      .trim()
      .replace(/\s+/g, " ");

    // "." and an empty segment both mean "this directory", so there is no level
    // here to create.
    if (!value || value === ".") {
      return { drop: true };
    }

    if (value.length > MAX_FOLDER_NAME_LENGTH) {
      value = value.slice(0, MAX_FOLDER_NAME_LENGTH).trim();
    }

    // A real folder called "Ungrouped" would render as a second heading identical
    // to the virtual one unfiled documents live under.
    if (value.toLowerCase() === ROOT_FOLDER_LABEL.toLowerCase()) {
      value = `${value} (uploaded)`;
    }

    const normalized = normalizeFolderName(value);
    if (!normalized) {
      // Nothing recognisable survived; file into the parent rather than lose it.
      return { drop: true };
    }

    return { name: normalized, changed: normalized !== raw.trim() };
  }

  // Splits "Notes/2026/q3.md" into the folder names above it and the file itself.
  function parseUploadPath(rawPath) {
    // Both separators: a Windows browser can report backslashes.
    const parts = String(rawPath || "")
      .split(/[\\/]+/)
      .filter((part) => part.length > 0);

    if (parts.length === 0) {
      return { error: "empty path" };
    }

    const fileName = sanitizeNewFilename(parts.pop());
    if (!fileName) {
      return { error: "invalid file name" };
    }

    const folderNames = [];
    const adjusted = [];

    for (const part of parts) {
      const repaired = repairPathSegment(part);

      if (repaired.unsafe) {
        return { error: `unsafe folder name "${part}"` };
      }

      if (repaired.drop) {
        continue;
      }

      if (repaired.changed) {
        adjusted.push({ from: part, to: repaired.name });
      }

      folderNames.push(repaired.name);
    }

    return { fileName, folderNames, adjusted };
  }

  router.post(
    "/api/upload/folder",
    requirePermission("doc:write"),
    uploadFolder.array("files", MAX_FOLDER_UPLOAD_FILES),
    async (req, res, next) => {
      try {
        const files = Array.isArray(req.files) ? req.files : [];
        const skipped = [];

        if (files.length === 0) {
          res.status(400).json({ error: "No files were uploaded." });
          return;
        }

        let paths = null;
        try {
          paths = JSON.parse(String(req.body?.paths || "[]"));
        } catch {
          paths = null;
        }

        if (!Array.isArray(paths) || paths.length !== files.length) {
          res.status(400).json({
            error: "Each uploaded file needs a matching entry in `paths`."
          });
          return;
        }

        // Where the picked folder is dropped: null means top level.
        const parentId = req.body?.parentId ? normalizeFolderId(req.body.parentId) : null;
        if (req.body?.parentId && !parentId) {
          res.status(400).json({ error: "Invalid destination folder id" });
          return;
        }

        const planned = [];
        // Folder names this app had to adjust to accept — reported so the change
        // is visible rather than mysterious.
        const renamedFolders = [];
        for (const [index, file] of files.entries()) {
          // Fall back to the part's own filename when the path entry is unusable,
          // so one bad entry costs its folder placement rather than the file.
          const parsed = parseUploadPath(paths[index] || file.originalname);
          if (parsed.error) {
            skipped.push({ name: String(paths[index] || file.originalname || "(unnamed)"), reason: parsed.error });
            continue;
          }

          for (const change of parsed.adjusted || []) {
            renamedFolders.push(change);
          }

          planned.push({ file, fileName: parsed.fileName, folderNames: parsed.folderNames });
        }

        if (planned.length === 0) {
          res.status(400).json({ error: "Nothing in that folder could be uploaded.", skipped });
          return;
        }

        // Depth is checked before anything is written, so an upload cannot leave
        // half its files on disk with nowhere to file them.
        const organizerBefore = await readOrganizerState();
        const baseDepth = parentId ? getFolderDepth(organizerBefore.folders, parentId) + 1 : 0;
        const deepest = planned.reduce((max, entry) => Math.max(max, entry.folderNames.length), 0);

        if (baseDepth + deepest > maxFolderDepth) {
          res.status(400).json({
            error: `That folder nests deeper than ${maxFolderDepth} levels. Upload a subfolder instead.`,
            skipped
          });
          return;
        }

        // Folders first now, then the files into them. The order is reversed from
        // how this used to work because a file's directory decides where it is,
        // so the directory has to exist before there is anywhere to write.
        const createdFolderPaths = [];

        const { organizer: savedOrganizer } = await mutateOrganizerState((organizer) => {
          // Find-or-create, so uploading into a tree that already has a "Notes"
          // folder adds to it rather than making a second one.
          const resolveFolder = (names) => {
            let currentParent = parentId;

            for (const name of names) {
              const existing = organizer.folders.find((folder) =>
                (folder.parentId || null) === currentParent
                && folder.name.toLowerCase() === name.toLowerCase());

              if (existing) {
                currentParent = existing.id;
                continue;
              }

              const siblingCount = organizer.folders
                .filter((folder) => (folder.parentId || null) === currentParent).length;
              const now = new Date().toISOString();
              const created = {
                id: createFolderId(),
                name,
                parentId: currentParent,
                order: siblingCount,
                createdAt: now,
                updatedAt: now
              };

              organizer.folders.push(created);
              createdFolderPaths.push(getFolderPath(organizer.folders, created.id));
              currentParent = created.id;
            }

            return currentParent;
          };

          for (const entry of planned) {
            entry.folderId = resolveFolder(entry.folderNames);
          }

          return null;
        });

        const written = [];
        for (const entry of planned) {
          const dir = entry.folderId ? folderDirFor(savedOrganizer, entry.folderId) : "";
          const targetDir = path.join(markdownDir, dir);
          await fsp.mkdir(targetDir, { recursive: true });

          // Unique within its own folder. Two READMEs from two uploaded folders
          // both keep their names — which is the point of the whole layout.
          const finalName = joinDocPath(dir, await ensureUniqueFilenameInDir(targetDir, entry.fileName));
          const fullPath = resolveDocPath(finalName, markdownDir);
          if (!fullPath) {
            skipped.push({ name: entry.fileName, reason: "unsafe path" });
            continue;
          }

          await fsp.writeFile(fullPath, entry.file.buffer);
          invalidateCachedContent(fullPath);

          written.push({
            file: finalName,
            renamedFrom: docBaseOf(finalName) === entry.fileName ? null : entry.fileName,
            folderNames: entry.folderNames,
            folderId: entry.folderId
          });
        }

        res.status(201).json({
          uploaded: written.map((entry) => ({
            file: entry.file,
            renamedFrom: entry.renamedFrom,
            folderPath: entry.folderId ? getFolderPath(savedOrganizer.folders, entry.folderId) : null
          })),
          foldersCreated: createdFolderPaths,
          skipped,
          // De-duplicated: the same awkward directory shows up once per file in it.
          renamedFolders: [...new Map(renamedFolders.map((r) => [`${r.from}->${r.to}`, r])).values()],
          counts: {
            uploaded: written.length,
            foldersCreated: createdFolderPaths.length,
            skipped: skipped.length
          }
        });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

module.exports = { createUploadRoutes };
