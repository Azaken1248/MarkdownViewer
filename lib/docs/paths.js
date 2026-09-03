/* Where a document is allowed to be.
 *
 * Every path in this app arrives from outside — a URL, an upload, a rename —
 * and this module is the one place that decides whether a string may become a
 * filesystem path at all. It is deliberately a leaf: it requires `path` and
 * nothing else, holds no state, touches no disk, and knows nothing about
 * requests or storage directories. That is what makes it the piece worth
 * reading on its own when the question is "can this get out of the library?".
 *
 * The rule throughout is reject, never repair. "../../etc/passwd.md" quietly
 * becoming "passwd.md" is a surprising success; a refusal says what happened.
 * (The one exception lives elsewhere: folder upload repairs the *folder* names
 * around a document, because there the document is the thing worth keeping.)
 */

const path = require("path");

const ALLOWED_DOC_EXTENSIONS = new Set([".md", ".markdown", ".mmd", ".mermaid", ".ipynb"]);
// Characters that are unsafe in a path segment on the platforms this can run on,
// plus C0/C1 control characters. Everything else — accents, CJK, parentheses,
// ampersands, plus signs — is a perfectly ordinary thing to call a document.
// Matching control characters is the entire point of this guard.
// eslint-disable-next-line no-control-regex
const UNSAFE_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f-\u009f]/;
// The same class with /g, for stripping rather than detecting.
// eslint-disable-next-line no-control-regex
const UNSAFE_FILENAME_CHARS_GLOBAL = /[\\/:*?"<>|\u0000-\u001f\u007f-\u009f]/g;
// Reserved device names on Windows, which are illegal with or without an extension.
const RESERVED_DEVICE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_FILENAME_LENGTH = 180;

// Depth is bounded so a pathological hierarchy cannot make rendering or path
// computation quadratic, and so the tree stays navigable in a 280px sidebar.
const MAX_FOLDER_DEPTH = 8;

function sanitizeFilename(rawName) {
  // NFC keeps "café.md" a single spelling, so the organizer and the filesystem agree.
  const candidate = String(rawName || "").normalize("NFC").trim();

  // Reject anything with a path separator rather than quietly taking the basename.
  // Both are safe, but "../../etc/passwd.md" silently becoming "passwd.md" is a
  // surprising success; a 400 tells the caller what actually happened.
  if (candidate.includes("/") || candidate.includes("\\")) {
    return null;
  }

  const baseName = path.basename(candidate);
  if (!baseName || baseName.length > MAX_FILENAME_LENGTH) {
    return null;
  }

  if (baseName === "." || baseName === ".." || baseName.includes("..")) {
    return null;
  }

  if (UNSAFE_FILENAME_CHARS.test(baseName)) {
    return null;
  }

  // A leading dot hides the file; a trailing dot or space is silently trimmed by
  // some filesystems, which would make the stored name differ from the requested one.
  if (baseName.startsWith(".") || /[. ]$/.test(baseName)) {
    return null;
  }

  const ext = path.extname(baseName).toLowerCase();
  if (!ALLOWED_DOC_EXTENSIONS.has(ext)) {
    return null;
  }

  if (RESERVED_DEVICE_NAMES.test(path.basename(baseName, path.extname(baseName)))) {
    return null;
  }

  return baseName;
}

// Creation and upload accept a bare name and default it to markdown. Lookups do not:
// letting "/api/docs/foo" resolve to "foo.md" gives one file two URLs and makes
// .mmd and .ipynb files unaddressable by their real names.
function sanitizeNewFilename(rawName) {
  const trimmed = String(rawName || "").normalize("NFC").trim();
  if (!trimmed) {
    return null;
  }

  const hasKnownExtension = /\.(md|markdown|mmd|mermaid|ipynb)$/i.test(trimmed);
  return sanitizeFilename(hasKnownExtension ? trimmed : `${trimmed}.md`);
}

/* Documents live in real directories, and a document is identified by its path
 * relative to MARKDOWN_DIR — "docs/README.md", POSIX separators, always.
 *
 * They used to be a single flat directory with folders existing only as a
 * filename→folder map in the organizer, which meant the filename was the
 * identity and had to be unique across the whole library. Two READMEs in two
 * folders was not expressible: the second became README-1.md.
 *
 * Everything below exists because that path arrives from outside. A path is
 * only ever accepted after sanitizeDocPath has rebuilt it segment by segment
 * from characters known to be safe, and resolveDocPath then confirms the result
 * is still inside the documents directory — belt and braces, because the cost
 * of being wrong here is reading and writing arbitrary files.
 */

// One segment of a path: a directory name, or the filename before its own
// checks. Rejects rather than repairs — a lookup that quietly turns
// "../../etc" into "etc" is a surprising success.
function sanitizePathSegment(rawSegment) {
  const value = String(rawSegment || "").normalize("NFC").trim();

  if (!value || value.length > MAX_FILENAME_LENGTH) {
    return null;
  }

  // "." and ".." are the traversal primitives; anything containing ".." is
  // refused outright rather than reasoned about.
  if (value === "." || value === ".." || value.includes("..")) {
    return null;
  }

  if (UNSAFE_FILENAME_CHARS.test(value)) {
    return null;
  }

  // A leading dot hides the entry; a trailing dot or space is silently trimmed
  // by some filesystems, so the name stored would differ from the name asked
  // for, and the two would never match again.
  if (value.startsWith(".") || /[. ]$/.test(value)) {
    return null;
  }

  if (RESERVED_DEVICE_NAMES.test(path.basename(value, path.extname(value)))) {
    return null;
  }

  return value;
}

/* A document path: zero or more directory segments, then a filename.
 *
 * Backslashes are normalised to "/" first, so a Windows-style path is
 * understood rather than treated as a filename containing backslashes — which
 * sanitizeFilename would refuse and which would be a confusing failure.
 */
function sanitizeDocPath(rawPath) {
  const value = String(rawPath || "").normalize("NFC").replace(/\\/g, "/").trim();

  if (!value || value.startsWith("/")) {
    return null;
  }

  const segments = value.split("/");
  // An empty segment means "//" or a trailing slash. Neither is a document.
  if (segments.some((segment) => segment.trim() === "")) {
    return null;
  }

  // A path deeper than the folder limit cannot correspond to a real folder, and
  // unbounded depth is a way to make the tree unusable.
  if (segments.length > MAX_FOLDER_DEPTH + 1) {
    return null;
  }

  const fileName = sanitizeFilename(segments.pop());
  if (!fileName) {
    return null;
  }

  const dirs = [];
  for (const segment of segments) {
    const safe = sanitizePathSegment(segment);
    if (!safe) {
      return null;
    }
    dirs.push(safe);
  }

  return [...dirs, fileName].join("/");
}

/* The absolute path, or null.
 *
 * sanitizeDocPath has already rebuilt the path from safe segments, so this
 * should never be the thing that catches an attack — but it is the check that
 * does not depend on having enumerated every trick, so it stays.
 */
function resolveDocPath(relativePath, baseDir) {
  const safe = sanitizeDocPath(relativePath);
  if (!safe) {
    return null;
  }

  const resolved = path.resolve(baseDir, safe);
  if (resolved !== baseDir && !resolved.startsWith(baseDir + path.sep)) {
    return null;
  }

  return resolved;
}

/* The document path out of a request.
 *
 * The routes use a wildcard (`/api/docs/*file`) rather than `:file` with the
 * path percent-encoded into one segment. Both work in Express, but %2F is the
 * kind of thing a reverse proxy normalises on the way through — and a library
 * that stops resolving its own URLs depending on what is in front of it is not
 * worth the tidier route pattern.
 */
function paramDocPath(req) {
  const raw = req.params.file;
  const joined = Array.isArray(raw) ? raw.join("/") : String(raw || "");
  return sanitizeDocPath(joined);
}

// Same wildcard treatment for recycle-bin and archive entries, which carry the
// folder they were deleted from.
function paramEntryPath(req) {
  const raw = req.params.entry;
  const joined = Array.isArray(raw) ? raw.join("/") : String(raw || "");
  return sanitizeRecycleEntryName(joined);
}

function docDirOf(relativePath) {
  const index = String(relativePath).lastIndexOf("/");
  return index === -1 ? "" : relativePath.slice(0, index);
}

function docBaseOf(relativePath) {
  const index = String(relativePath).lastIndexOf("/");
  return index === -1 ? String(relativePath) : relativePath.slice(index + 1);
}

function joinDocPath(dir, name) {
  return dir ? `${dir}/${name}` : name;
}

// The title shown for a document is about the file, not where it sits.
function toDocTitle(fileName) {
  return docBaseOf(fileName)
    .replace(/\.(md|markdown|mmd|mermaid|ipynb)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/* A recycle-bin entry, which is now a path too.
 *
 * The bin mirrors the folder tree, so a document deleted from "Azalea" is at
 * "Azalea/<stamp>--README.md" inside it. That is what lets Restore put it back
 * where it came from without a side table recording where each file used to
 * live — the bin describes itself, the way the library does.
 */
function sanitizeRecycleEntryName(rawName) {
  const value = String(rawName || "").normalize("NFC").replace(/\\/g, "/").trim();
  if (!value || value.startsWith("/")) {
    return null;
  }

  const segments = value.split("/");
  if (segments.some((segment) => segment.trim() === "") || segments.length > MAX_FOLDER_DEPTH + 1) {
    return null;
  }

  const baseName = segments.pop();
  if (!baseName || baseName.includes("..")) {
    return null;
  }

  const ext = path.extname(baseName).toLowerCase();
  if (!ALLOWED_DOC_EXTENSIONS.has(ext)) {
    return null;
  }

  // The stamped name this app generates, and nothing else.
  if (!/^[A-Za-z0-9 _.-]+$/i.test(baseName)) {
    return null;
  }

  const dirs = [];
  for (const segment of segments) {
    const safe = sanitizePathSegment(segment);
    if (!safe) {
      return null;
    }
    dirs.push(safe);
  }

  return [...dirs, baseName].join("/");
}

function resolveRecyclePath(entryPath, baseDir) {
  const safe = sanitizeRecycleEntryName(entryPath);
  if (!safe) {
    return null;
  }

  const resolved = path.resolve(baseDir, safe);
  if (!resolved.startsWith(baseDir + path.sep)) {
    return null;
  }

  return resolved;
}

function parseOriginalFilenameFromRecycleEntry(entryName) {
  const value = String(entryName || "");
  const dir = docDirOf(value);
  const base = docBaseOf(value);

  const delimiterIndex = base.indexOf("--");
  const maybeOriginal = delimiterIndex >= 0
    ? base.slice(delimiterIndex + 2)
    : base;

  const sanitized = sanitizeFilename(maybeOriginal) || maybeOriginal;
  return joinDocPath(dir, sanitized);
}

function createRecycleEntryFilename(fileName) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  const random = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${random}--${fileName}`;
}

module.exports = {
  ALLOWED_DOC_EXTENSIONS,
  UNSAFE_FILENAME_CHARS,
  UNSAFE_FILENAME_CHARS_GLOBAL,
  RESERVED_DEVICE_NAMES,
  MAX_FILENAME_LENGTH,
  MAX_FOLDER_DEPTH,
  sanitizeFilename,
  sanitizeNewFilename,
  sanitizePathSegment,
  sanitizeDocPath,
  resolveDocPath,
  paramDocPath,
  paramEntryPath,
  docDirOf,
  docBaseOf,
  joinDocPath,
  toDocTitle,
  sanitizeRecycleEntryName,
  resolveRecyclePath,
  parseOriginalFilenameFromRecycleEntry,
  createRecycleEntryFilename
};
