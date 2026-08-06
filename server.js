const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const crypto = require("crypto");
const { createHandler } = require("graphql-http/lib/use/express");
const { buildSchema, NoSchemaIntrospectionCustomRule } = require("graphql");

const app = express();
const PORT = process.env.PORT || 4321;
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const MARKDOWN_DIR = path.join(PUBLIC_DIR, "docs");
const DELETED_MARKDOWN_DIR = path.join(ROOT_DIR, "deleted_markdowns");
const DATA_DIR = path.join(ROOT_DIR, "data");
const ORGANIZER_FILE_PATH = path.join(DATA_DIR, "document-organizer.json");
const DELETED_SOFT_DIR = path.join(DELETED_MARKDOWN_DIR, "soft");
const DELETED_HARD_DIR = path.join(DELETED_MARKDOWN_DIR, "hard");
const MAX_DOC_BYTES = 2 * 1024 * 1024;
const ALLOWED_DOC_EXTENSIONS = new Set([".md", ".markdown", ".mmd", ".mermaid", ".ipynb"]);
// Characters that are unsafe in a path segment on the platforms this can run on,
// plus C0/C1 control characters. Everything else — accents, CJK, parentheses,
// ampersands, plus signs — is a perfectly ordinary thing to call a document.
const UNSAFE_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f-\u009f]/;
// Reserved device names on Windows, which are illegal with or without an extension.
const RESERVED_DEVICE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_FILENAME_LENGTH = 180;
const ROOT_FOLDER_LABEL = "Ungrouped";
// Unfiled documents are a catch-all, not a priority group, so they sort after
// every folder the user actually created rather than being pinned to the top.
const UNFILED_FOLDER_ORDER = Number.MAX_SAFE_INTEGER;
const SEARCH_RESULT_LIMIT = 200;
// Both caches are bounded so a large corpus cannot pin the whole thing in RSS
// forever. Entries are re-derived from disk on a miss, so a small budget costs
// time, never correctness.
const CONTENT_CACHE_MAX_BYTES = 32 * 1024 * 1024;
const SEARCH_INDEX_MAX_BYTES = 48 * 1024 * 1024;
const SNIPPET_CACHE_MAX_BYTES = 16 * 1024 * 1024;
const INDEX_TEMPLATE_PATH = path.join(PUBLIC_DIR, "index.html");
const SITE_NAME = "Markdown Docs Viewer";
const EMBED_TITLE = "Markdown Docs Viewer | Cart Knowledge Hub";
const EMBED_DESCRIPTION = "Browse, search, and share cart documentation with live markdown editing and Mermaid diagrams.";
const EMBED_THEME_COLOR = "#89b4fa";
const EMBED_IMAGE_PATH = "/social-card.svg";
const FAVICON_PATH = "/favicon.svg";

// Only trust X-Forwarded-* when we are actually behind a reverse proxy.
// Trusting them unconditionally lets any client spoof the host/protocol used
// to build canonical, og:image and oEmbed URLs.
const TRUST_PROXY = process.env.TRUST_PROXY || "";
if (TRUST_PROXY) {
  app.set("trust proxy", TRUST_PROXY === "true" ? true : TRUST_PROXY);
} else {
  app.set("trust proxy", false);
}

// Content Security Policy.
//
// script-src is the part that matters: it pins executable code to this origin
// plus the two CDNs we load pinned, SRI-checked bundles from, so an injected
// <script src> or inline payload cannot run.
//
// 'unsafe-inline' is required for style-src because KaTeX sets inline style
// attributes and Mermaid injects <style> blocks into rendered SVG. Styles are
// a far weaker vector than scripts, so this is a deliberate trade.
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://fonts.googleapis.com",
  "font-src 'self' data: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'"
].join("; ");

app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", CSP_DIRECTIVES);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

// The envelope limit has to sit above MAX_DOC_BYTES, not equal it: JSON escaping
// inflates the payload, so a legal 2MB document arrives as a larger body. When the
// two were equal, express rejected the request before the app's own size check ran
// and the client saw a 500 instead of a 413. The doubled headroom covers escaping
// while still bounding how much a single request can buffer.
const JSON_BODY_LIMIT = MAX_DOC_BYTES * 2 + 64 * 1024;
app.use(express.json({ limit: JSON_BODY_LIMIT }));

let indexTemplateCache = null;
let indexTemplateCacheMtimeMs = 0;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOC_BYTES },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (!ALLOWED_DOC_EXTENSIONS.has(ext)) {
      cb(new Error("Only .md, .markdown, .mmd, .mermaid, or .ipynb files are supported"));
      return;
    }
    cb(null, true);
  }
});

// ---------------------------------------------------------------------------
// Write authentication
//
// Reads stay public so shared links, social cards and oEmbed unfurls keep
// working. Everything that mutates disk state requires a bearer token.
// Set MDVIEWER_TOKEN to a stable secret; if it is unset a random one is
// generated at boot and logged, so the app never starts in an open state.
// ---------------------------------------------------------------------------
const CONFIGURED_WRITE_TOKEN = String(process.env.MDVIEWER_TOKEN || "").trim();
const WRITE_TOKEN = CONFIGURED_WRITE_TOKEN || crypto.randomBytes(24).toString("base64url");

function extractRequestToken(req) {
  const authHeader = String(req.get("authorization") || "");
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch) {
    return bearerMatch[1].trim();
  }

  return String(req.get("x-mdviewer-token") || "").trim();
}

function isValidWriteToken(candidate) {
  const expected = Buffer.from(WRITE_TOKEN, "utf8");
  const provided = Buffer.from(String(candidate || ""), "utf8");

  // timingSafeEqual throws on length mismatch, so compare lengths separately.
  if (expected.length !== provided.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, provided);
}

function requireWriteAuth(req, res, next) {
  if (isValidWriteToken(extractRequestToken(req))) {
    next();
    return;
  }

  res.status(401).json({ error: "This action requires the editor token. Unlock editing to continue." });
}

app.get("/api/session", (req, res) => {
  res.json({
    canWrite: isValidWriteToken(extractRequestToken(req)),
    tokenConfigured: Boolean(CONFIGURED_WRITE_TOKEN)
  });
});

async function ensureStorageDirs() {
  await fsp.mkdir(MARKDOWN_DIR, { recursive: true });
  await fsp.mkdir(DELETED_SOFT_DIR, { recursive: true });
  await fsp.mkdir(DELETED_HARD_DIR, { recursive: true });
  await fsp.mkdir(DATA_DIR, { recursive: true });
}

function createDefaultOrganizerState() {
  return {
    version: 1,
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
        order: Number.isFinite(Number(folder?.order)) ? Number(folder.order) : index,
        createdAt,
        updatedAt
      };
    }).filter(Boolean)
    : [];

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
    version: 1,
    folders,
    fileFolders
  };
}

// The organizer file is the only record of which document lives in which
// folder. Losing it is unrecoverable, so a file we cannot parse is treated as
// "damaged, hands off" rather than "start fresh": we keep a copy, keep serving
// reads without folder info, and refuse every write until a human intervenes.
let organizerDamage = null;

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

async function quarantineOrganizerFile(reason) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${ORGANIZER_FILE_PATH}.corrupt-${stamp}`;

  try {
    await fsp.copyFile(ORGANIZER_FILE_PATH, backupPath);
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
    raw = await fsp.readFile(ORGANIZER_FILE_PATH, "utf8");
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
  await fsp.mkdir(DATA_DIR, { recursive: true });

  // Write to a sibling temp file, flush it, then rename. rename(2) is atomic
  // within a filesystem, so a crash leaves either the old file or the new one
  // intact - never a truncated one.
  const tempPath = `${ORGANIZER_FILE_PATH}.tmp-${process.pid}-${Date.now()}`;
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
    await fsp.rename(tempPath, ORGANIZER_FILE_PATH);
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

async function writeOrganizerState(organizerState) {
  return withOrganizerLock(() => writeOrganizerStateUnsafe(organizerState));
}

function getFolderRecordById(organizerState, folderId) {
  const normalizedFolderId = normalizeFolderId(folderId);
  if (!normalizedFolderId) {
    return null;
  }

  return organizerState.folders.find((folder) => folder.id === normalizedFolderId) || null;
}

function resolveFolderInfo(organizerState, fileName) {
  const folderId = organizerState.fileFolders[fileName] || null;
  if (!folderId) {
    return {
      folderId: null,
      folderName: null,
      folderOrder: UNFILED_FOLDER_ORDER
    };
  }

  const folder = getFolderRecordById(organizerState, folderId);
  if (!folder) {
    return {
      folderId: null,
      folderName: null,
      folderOrder: UNFILED_FOLDER_ORDER
    };
  }

  return {
    folderId: folder.id,
    folderName: folder.name,
    folderOrder: Number.isFinite(Number(folder.order)) ? Number(folder.order) : Number.MAX_SAFE_INTEGER
  };
}

function serializeFolders(folders) {
  return folders.map((folder) => ({
    id: folder.id,
    name: folder.name,
    order: Number.isFinite(Number(folder.order)) ? Number(folder.order) : 0,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt
  }));
}

function normalizeSearchText(value) {
  return String(value || "").toLowerCase();
}

function tokenizeSearchQuery(query) {
  return normalizeSearchText(query)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

// `raw` is the whitespace-collapsed document and `normalizedContent` its
// lowercased form; both come from the snippet cache so this no longer rescans
// the source text on every request.
function buildSearchSnippet(raw, normalizedContent, query, tokens) {
  if (!raw) {
    return "No preview available.";
  }

  const searchTerms = [...new Set([normalizeSearchText(query).trim(), ...(tokens || [])]
    .map((token) => normalizeSearchText(token).trim())
    .filter(Boolean))];

  let matchIndex = -1;
  let matchToken = "";

  for (const token of searchTerms) {
    const index = normalizedContent.indexOf(token);
    if (index >= 0 && (matchIndex === -1 || index < matchIndex)) {
      matchIndex = index;
      matchToken = token;
    }
  }

  if (matchIndex === -1) {
    return raw.length > 140 ? `${raw.slice(0, 140)}...` : raw;
  }

  const focusLength = Math.max(matchToken.length, 18);
  const start = Math.max(0, matchIndex - 56);
  const end = Math.min(raw.length, matchIndex + focusLength + 72);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < raw.length ? "..." : "";
  return `${prefix}${raw.slice(start, end)}${suffix}`;
}

// `normalizedContent` arrives already lowercased from the search index; this
// used to lowercase the entire document on every request.
function scoreSearchDoc(doc, normalizedQuery, tokens, normalizedContent) {
  const title = normalizeSearchText(doc.title);
  const file = normalizeSearchText(doc.originalFile || doc.file);
  const folderName = normalizeSearchText(doc.folderName || "");

  let score = 0;
  let matched = false;

  if (title.startsWith(normalizedQuery)) {
    score += 1200;
    matched = true;
  }

  if (file.startsWith(normalizedQuery)) {
    score += 1000;
    matched = true;
  }

  if (folderName.startsWith(normalizedQuery)) {
    score += 880;
    matched = true;
  }

  if (title.includes(normalizedQuery)) {
    score += 850;
    matched = true;
  }

  if (file.includes(normalizedQuery)) {
    score += 760;
    matched = true;
  }

  if (folderName.includes(normalizedQuery)) {
    score += 620;
    matched = true;
  }

  const contentIndex = normalizedContent.indexOf(normalizedQuery);
  if (contentIndex >= 0) {
    score += 520 + Math.max(0, 140 - (contentIndex / 11));
    matched = true;
  }

  let tokenHits = 0;
  for (const token of tokens) {
    if (!token) {
      continue;
    }

    if (title.includes(token)) {
      tokenHits += 4;
    }

    if (file.includes(token)) {
      tokenHits += 4;
    }

    if (folderName.includes(token)) {
      tokenHits += 3;
    }

    if (normalizedContent.includes(token)) {
      tokenHits += 2;
      matched = true;
    }
  }

  if (tokenHits > 0) {
    score += tokenHits * 35;
  }

  return matched ? score : null;
}

// A plain Map grew to the size of the entire corpus and never gave any of it
// back. This is a byte-budgeted LRU: Map preserves insertion order, so the
// oldest key is always the first one iteration yields, and re-reading a key
// moves it to the back.
function createLruCache(maxBytes) {
  const entries = new Map();
  let usedBytes = 0;

  function evictUntilUnder(limit) {
    for (const key of entries.keys()) {
      if (usedBytes <= limit) {
        return;
      }

      usedBytes -= entries.get(key).bytes;
      entries.delete(key);
    }
  }

  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) {
        return null;
      }

      entries.delete(key);
      entries.set(key, entry);
      return entry;
    },
    set(key, value, bytes) {
      const existing = entries.get(key);
      if (existing) {
        usedBytes -= existing.bytes;
        entries.delete(key);
      }

      // A single file larger than the whole budget is simply not cached,
      // rather than evicting everything else to make room for it.
      if (bytes > maxBytes) {
        evictUntilUnder(maxBytes);
        return;
      }

      entries.set(key, { ...value, bytes });
      usedBytes += bytes;
      evictUntilUnder(maxBytes);
    },
    delete(key) {
      const entry = entries.get(key);
      if (!entry) {
        return;
      }

      usedBytes -= entry.bytes;
      entries.delete(key);
    },
    stats() {
      return { count: entries.size, usedBytes, maxBytes };
    }
  };
}

const docContentCache = createLruCache(CONTENT_CACHE_MAX_BYTES);
// Search reads the lowercased form of every document on every keystroke.
// Keeping that derived form next to the raw text turns the per-request cost
// from "lowercase the whole corpus" into "walk strings already in memory".
const docSearchIndex = createLruCache(SEARCH_INDEX_MAX_BYTES);
const docSnippetCache = createLruCache(SNIPPET_CACHE_MAX_BYTES);

function invalidateCachedContent(fullPath) {
  docContentCache.delete(fullPath);
  docSearchIndex.delete(fullPath);
  docSnippetCache.delete(fullPath);
}

async function readCachedTextFile(fullPath) {
  const stat = await fsp.stat(fullPath);
  const cached = docContentCache.get(fullPath);

  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return {
      content: cached.content,
      stat,
      cached: true
    };
  }

  const content = await fsp.readFile(fullPath, "utf8");
  docContentCache.set(fullPath, {
    content,
    mtimeMs: stat.mtimeMs,
    size: stat.size
  }, Buffer.byteLength(content, "utf8"));

  return {
    content,
    stat,
    cached: false
  };
}

// Only the lowercased full text is indexed, because scoring needs it for every
// document on every request. The whitespace-collapsed form a snippet is cut from
// is derived on demand instead: snippets are built for at most a page of results,
// so caching that too would roughly triple the index for no gain.
async function readSearchIndexEntry(fullPath) {
  const { content, stat } = await readCachedTextFile(fullPath);
  const cached = docSearchIndex.get(fullPath);

  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return { ...cached, content, stat };
  }

  const normalizedContent = normalizeSearchText(content);
  const entry = {
    normalizedContent,
    mtimeMs: stat.mtimeMs,
    size: stat.size
  };

  docSearchIndex.set(fullPath, entry, Buffer.byteLength(normalizedContent, "utf8"));

  return { ...entry, content, stat };
}

// Snippet inputs are needed only for results that survive the limit, so they get
// their own much smaller budget rather than riding along in the main index.
async function readSnippetSource(fullPath, content, stat) {
  const cached = docSnippetCache.get(fullPath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached;
  }

  const collapsed = String(content || "").replace(/\s+/g, " ").trim();
  const entry = {
    collapsed,
    normalizedCollapsed: normalizeSearchText(collapsed),
    mtimeMs: stat.mtimeMs,
    size: stat.size
  };

  docSnippetCache.set(
    fullPath,
    entry,
    Buffer.byteLength(collapsed, "utf8") + Buffer.byteLength(entry.normalizedCollapsed, "utf8")
  );

  return entry;
}

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

function toDocTitle(fileName) {
  return fileName
    .replace(/\.(md|markdown|mmd|mermaid|ipynb)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
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

async function ensureUniqueFilename(fileName) {
  return ensureUniqueFilenameInDir(MARKDOWN_DIR, fileName);
}

function sanitizeRecycleEntryName(rawName) {
  const baseName = path.basename(String(rawName || "").trim());
  if (!baseName) {
    return null;
  }

  if (baseName.includes("..")) {
    return null;
  }

  const ext = path.extname(baseName).toLowerCase();
  if (!ALLOWED_DOC_EXTENSIONS.has(ext)) {
    return null;
  }

  if (!/^[A-Za-z0-9 _.-]+$/i.test(baseName)) {
    return null;
  }

  return baseName;
}

function parseOriginalFilenameFromRecycleEntry(entryName) {
  const value = String(entryName || "");
  const delimiterIndex = value.indexOf("--");
  const maybeOriginal = delimiterIndex >= 0
    ? value.slice(delimiterIndex + 2)
    : value;

  const sanitized = sanitizeFilename(maybeOriginal);
  return sanitized || maybeOriginal;
}

function createRecycleEntryFilename(fileName) {
  const stamp = new Date().toISOString().replace(/[\-:.TZ]/g, "");
  const random = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${random}--${fileName}`;
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
  const sourcePath = path.join(MARKDOWN_DIR, fileName);
  const recycleDir = mode === "hard" ? DELETED_HARD_DIR : DELETED_SOFT_DIR;

  const baseEntryName = createRecycleEntryFilename(fileName);
  const entryName = await ensureUniqueFilenameInDir(recycleDir, baseEntryName);
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

async function getRecycleDocs(organizerState = null, sourceDir = DELETED_SOFT_DIR) {
  const organizer = organizerState || await readOrganizerState();
  const dirEntries = await fsp.readdir(sourceDir, { withFileTypes: true });
  const recycleEntries = dirEntries.filter((entry) => {
    if (!entry.isFile()) {
      return false;
    }

    const ext = path.extname(entry.name).toLowerCase();
    return ALLOWED_DOC_EXTENSIONS.has(ext);
  });

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

async function getDocs(organizerState = null) {
  const organizer = organizerState || await readOrganizerState();
  const dirEntries = await fsp.readdir(MARKDOWN_DIR, { withFileTypes: true });
  const markdownEntries = dirEntries.filter((entry) => {
    if (!entry.isFile()) {
      return false;
    }

    const ext = path.extname(entry.name).toLowerCase();
    return ALLOWED_DOC_EXTENSIONS.has(ext);
  });

  const docs = await Promise.all(
    markdownEntries.map(async (entry) => {
      const fullPath = path.join(MARKDOWN_DIR, entry.name);
      const stat = await fsp.stat(fullPath);
      const folderInfo = resolveFolderInfo(organizer, entry.name);
      return {
        file: entry.name,
        title: toDocTitle(entry.name),
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
        folderId: folderInfo.folderId,
        folderName: folderInfo.folderName,
        folderOrder: folderInfo.folderOrder
      };
    })
  );

  docs.sort((a, b) => {
    if (a.folderOrder !== b.folderOrder) {
      return a.folderOrder - b.folderOrder;
    }

    const rightTime = Date.parse(b.updatedAt) || 0;
    const leftTime = Date.parse(a.updatedAt) || 0;
    if (rightTime !== leftTime) {
      return rightTime - leftTime;
    }

    return a.file.localeCompare(b.file);
  });
  return docs;
}

async function searchDocuments(query, scope = "docs") {
  const normalizedQuery = normalizeSearchText(query).trim();
  if (!normalizedQuery) {
    return {
      matches: [],
      searchTerms: []
    };
  }

  const tokens = tokenizeSearchQuery(normalizedQuery);
  const searchTerms = [...new Set([normalizedQuery, ...tokens].filter(Boolean))];
  const organizer = await readOrganizerState();
  // Each scope reads a different directory, so resolve it once and reuse it below.
  const scopeDir = scope === "recycle-bin"
    ? DELETED_SOFT_DIR
    : scope === "archive"
      ? DELETED_HARD_DIR
      : MARKDOWN_DIR;
  const docs = scope === "docs"
    ? await getDocs(organizer)
    : await getRecycleDocs(organizer, scopeDir);

  const matches = await Promise.all(docs.map(async (doc) => {
    const fullPath = path.join(scopeDir, doc.file);
    const indexEntry = await readSearchIndexEntry(fullPath);
    const score = scoreSearchDoc(doc, normalizedQuery, tokens, indexEntry.normalizedContent);
    if (score === null) {
      return null;
    }

    return { ...doc, score, indexEntry };
  }));

  // Drop non-matching docs before sorting; the comparator dereferences .score.
  const scoredMatches = matches.filter(Boolean);

  scoredMatches.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    const rightTime = Date.parse(right.updatedAt || right.deletedAt || "") || 0;
    const leftTime = Date.parse(left.updatedAt || left.deletedAt || "") || 0;
    if (rightTime !== leftTime) {
      return rightTime - leftTime;
    }

    return left.file.localeCompare(right.file);
  });

  // Snippets are cut only for the results that survive the limit, instead of for
  // every document that happened to match.
  const limited = await Promise.all(
    scoredMatches.slice(0, SEARCH_RESULT_LIMIT).map(async ({ indexEntry, ...match }) => {
      const snippetSource = await readSnippetSource(
        path.join(scopeDir, match.file),
        indexEntry.content,
        indexEntry.stat
      );

      return {
        ...match,
        snippet: buildSearchSnippet(
          snippetSource.collapsed,
          snippetSource.normalizedCollapsed,
          normalizedQuery,
          searchTerms
        )
      };
    })
  );

  return {
    matches: limited,
    searchTerms
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isAbsoluteHttpUrl(value) {
  if (!value) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function getBaseUrlFromRequest(req) {
  const configuredBaseUrl = String(process.env.PUBLIC_BASE_URL || "").trim();
  if (isAbsoluteHttpUrl(configuredBaseUrl)) {
    return configuredBaseUrl.replace(/\/+$/, "");
  }

  if (!req) {
    return `http://localhost:${PORT}`;
  }

  // req.protocol/req.hostname already honour X-Forwarded-* only when the
  // "trust proxy" setting says the hop is trusted, so read them instead of
  // the raw headers. Untrusted clients can still send a Host header, so the
  // result is only used when PUBLIC_BASE_URL is not configured.
  const protocol = req.protocol || "http";
  const host = req.get("host") || `localhost:${PORT}`;

  return `${protocol}://${host}`;
}

function toAbsoluteUrl(baseUrl, routePath) {
  return new URL(routePath, `${baseUrl}/`).toString();
}

function buildEmbedMeta(req, requestedUrl) {
  const baseUrl = getBaseUrlFromRequest(req);
  const canonicalUrl = isAbsoluteHttpUrl(requestedUrl)
    ? requestedUrl
    : toAbsoluteUrl(baseUrl, "/");

  return {
    title: EMBED_TITLE,
    description: EMBED_DESCRIPTION,
    siteName: SITE_NAME,
    canonicalUrl,
    imageUrl: toAbsoluteUrl(baseUrl, EMBED_IMAGE_PATH),
    faviconUrl: toAbsoluteUrl(baseUrl, FAVICON_PATH),
    themeColor: EMBED_THEME_COLOR,
    oEmbedUrl: `${toAbsoluteUrl(baseUrl, "/oembed")}?url=${encodeURIComponent(canonicalUrl)}`,
    baseUrl
  };
}

function renderIndexWithEmbedMeta(htmlTemplate, embedMeta) {
  const replacements = {
    __EMBED_TITLE__: embedMeta.title,
    __EMBED_DESCRIPTION__: embedMeta.description,
    __EMBED_CANONICAL_URL__: embedMeta.canonicalUrl,
    __EMBED_SITE_NAME__: embedMeta.siteName,
    __EMBED_IMAGE_URL__: embedMeta.imageUrl,
    __EMBED_FAVICON_URL__: embedMeta.faviconUrl,
    __EMBED_THEME_COLOR__: embedMeta.themeColor,
    __EMBED_OEMBED_URL__: embedMeta.oEmbedUrl
  };

  let rendered = htmlTemplate;
  for (const [token, value] of Object.entries(replacements)) {
    rendered = rendered.split(token).join(escapeHtml(value));
  }

  return rendered;
}

async function getIndexTemplate() {
  const stat = await fsp.stat(INDEX_TEMPLATE_PATH);
  if (indexTemplateCache !== null && indexTemplateCacheMtimeMs === stat.mtimeMs) {
    return indexTemplateCache;
  }

  indexTemplateCache = await fsp.readFile(INDEX_TEMPLATE_PATH, "utf8");
  indexTemplateCacheMtimeMs = stat.mtimeMs;
  return indexTemplateCache;
}

const graphQLSchema = buildSchema(`
  type EmbedMeta {
    title: String!
    description: String!
    siteName: String!
    canonicalUrl: String!
    imageUrl: String!
    faviconUrl: String!
    themeColor: String!
    oEmbedUrl: String!
  }

  type Query {
    embedMeta(url: String): EmbedMeta!
    docsCount: Int!
    health: String!
  }
`);

const graphQLRootValue = {
  embedMeta: ({ url }, context) => buildEmbedMeta(context?.request, url),
  docsCount: async () => (await getDocs()).length,
  health: () => "ok"
};

// Schema introspection is on by default and lets anyone enumerate the API.
// graphql-http serves no GraphiQL UI, so blocking introspection is the actual
// control here; enable it explicitly when working on the schema locally.
const ENABLE_GRAPHQL_INTROSPECTION = process.env.ENABLE_GRAPHQL_INTROSPECTION === "true";

app.all(
  "/graphql",
  createHandler({
    schema: graphQLSchema,
    rootValue: graphQLRootValue,
    validationRules: ENABLE_GRAPHQL_INTROSPECTION ? [] : [NoSchemaIntrospectionCustomRule],
    context: (request) => ({ request: request.raw || request })
  })
);

app.get("/oembed", (req, res) => {
  const requestedUrl = typeof req.query.url === "string" ? req.query.url.trim() : "";
  const embedMeta = buildEmbedMeta(req, requestedUrl);

  res.json({
    version: "1.0",
    type: "link",
    provider_name: embedMeta.siteName,
    provider_url: embedMeta.baseUrl,
    author_name: "7-Eleven, Inc.",
    author_url: embedMeta.baseUrl,
    title: embedMeta.title,
    url: embedMeta.canonicalUrl,
    thumbnail_url: embedMeta.faviconUrl,
    thumbnail_width: 256,
    thumbnail_height: 256,
    cache_age: 3600
  });
});

app.get(["/", "/index.html"], async (req, res, next) => {
  try {
    const htmlTemplate = await getIndexTemplate();
    const embedMeta = buildEmbedMeta(req);
    const renderedHtml = renderIndexWithEmbedMeta(htmlTemplate, embedMeta);

    res.type("html").send(renderedHtml);
  } catch (error) {
    next(error);
  }
});

app.get("/api/docs", async (req, res, next) => {
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

app.get("/api/docs/search", async (req, res, next) => {
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

app.get("/api/docs/:file", async (req, res, next) => {
  try {
    const fileName = sanitizeFilename(req.params.file);
    if (!fileName) {
      res.status(400).json({ error: "Invalid markdown file name" });
      return;
    }

    const fullPath = path.join(MARKDOWN_DIR, fileName);
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

app.put("/api/docs/:file/folder", requireWriteAuth, async (req, res, next) => {
  try {
    const fileName = sanitizeFilename(req.params.file);
    if (!fileName) {
      res.status(400).json({ error: "Invalid markdown file name" });
      return;
    }

    const fullPath = path.join(MARKDOWN_DIR, fileName);
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

    const { organizer: savedOrganizer } = await mutateOrganizerState((organizer) => {
      if (normalizedFolderId && !getFolderRecordById(organizer, normalizedFolderId)) {
        throw new HttpError(404, "Folder not found");
      }

      if (normalizedFolderId) {
        organizer.fileFolders[fileName] = normalizedFolderId;
      } else {
        delete organizer.fileFolders[fileName];
      }
    });

    const folderInfo = resolveFolderInfo(savedOrganizer, fileName);

    res.json({
      file: fileName,
      folderId: folderInfo.folderId,
      folderName: folderInfo.folderName
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/folders", requireWriteAuth, async (req, res, next) => {
  try {
    const folderName = normalizeFolderName(req.body?.name);
    if (!folderName) {
      res.status(400).json({ error: "Invalid folder name" });
      return;
    }

    const { organizer: savedOrganizer, result: folder } = await mutateOrganizerState((organizer) => {
      const existing = organizer.folders.find((entry) => entry.name.toLowerCase() === folderName.toLowerCase());
      if (existing) {
        throw new HttpError(409, "A folder with that name already exists");
      }

      const now = new Date().toISOString();
      const created = {
        id: createFolderId(),
        name: folderName,
        order: organizer.folders.length,
        createdAt: now,
        updatedAt: now
      };

      organizer.folders.push(created);
      return created;
    });

    res.status(201).json({
      folder: serializeFolders([folder])[0],
      folders: serializeFolders(savedOrganizer.folders)
    });
  } catch (error) {
    next(error);
  }
});

// Folder order was previously write-once at creation time. This lets the caller
// hand back the ids in the order it wants; any folder omitted keeps its relative
// position after the listed ones, so a partial list can never drop a folder.
app.put("/api/folders/reorder", requireWriteAuth, async (req, res, next) => {
  try {
    const requestedIds = Array.isArray(req.body?.folderIds) ? req.body.folderIds : null;
    if (!requestedIds) {
      res.status(400).json({ error: "folderIds must be an array of folder ids" });
      return;
    }

    const { organizer: savedOrganizer } = await mutateOrganizerState((organizer) => {
      const byId = new Map(organizer.folders.map((folder) => [folder.id, folder]));
      const seen = new Set();
      const ordered = [];

      for (const rawId of requestedIds) {
        const folderId = normalizeFolderId(rawId);
        if (!folderId || seen.has(folderId)) {
          continue;
        }

        const folder = byId.get(folderId);
        if (!folder) {
          throw new HttpError(404, `Folder not found: ${folderId}`);
        }

        seen.add(folderId);
        ordered.push(folder);
      }

      for (const folder of organizer.folders) {
        if (!seen.has(folder.id)) {
          ordered.push(folder);
        }
      }

      const now = new Date().toISOString();
      ordered.forEach((folder, index) => {
        if (folder.order !== index) {
          folder.order = index;
          folder.updatedAt = now;
        }
      });

      organizer.folders = ordered;
    });

    res.json({ folders: serializeFolders(savedOrganizer.folders) });
  } catch (error) {
    next(error);
  }
});

app.put("/api/folders/:folderId", requireWriteAuth, async (req, res, next) => {
  try {
    const normalizedFolderId = normalizeFolderId(req.params.folderId);
    const folderName = normalizeFolderName(req.body?.name);

    if (!normalizedFolderId) {
      res.status(400).json({ error: "Invalid folder id" });
      return;
    }

    if (!folderName) {
      res.status(400).json({ error: "Invalid folder name" });
      return;
    }

    const { organizer: savedOrganizer, result: folder } = await mutateOrganizerState((organizer) => {
      const target = organizer.folders.find((entry) => entry.id === normalizedFolderId);
      if (!target) {
        throw new HttpError(404, "Folder not found");
      }

      const duplicate = organizer.folders.find((entry) => entry.id !== normalizedFolderId && entry.name.toLowerCase() === folderName.toLowerCase());
      if (duplicate) {
        throw new HttpError(409, "A folder with that name already exists");
      }

      target.name = folderName;
      target.updatedAt = new Date().toISOString();
      return target;
    });

    res.json({
      folder: serializeFolders([folder])[0],
      folders: serializeFolders(savedOrganizer.folders)
    });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/folders/:folderId", requireWriteAuth, async (req, res, next) => {
  try {
    const normalizedFolderId = normalizeFolderId(req.params.folderId);
    if (!normalizedFolderId) {
      res.status(400).json({ error: "Invalid folder id" });
      return;
    }

    const { organizer: savedOrganizer } = await mutateOrganizerState((organizer) => {
      const folderIndex = organizer.folders.findIndex((entry) => entry.id === normalizedFolderId);
      if (folderIndex < 0) {
        throw new HttpError(404, "Folder not found");
      }

      organizer.folders.splice(folderIndex, 1);
      for (const [fileName, assignedFolderId] of Object.entries(organizer.fileFolders)) {
        if (assignedFolderId === normalizedFolderId) {
          delete organizer.fileFolders[fileName];
        }
      }
    });

    res.json({
      message: "Folder deleted",
      folders: serializeFolders(savedOrganizer.folders)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/docs/:file/delete", requireWriteAuth, async (req, res, next) => {
  try {
    const fileName = sanitizeFilename(req.params.file);
    if (!fileName) {
      res.status(400).json({ error: "Invalid markdown file name" });
      return;
    }

    const mode = String(req.body?.mode || "").trim().toLowerCase();
    if (!['soft', 'hard'].includes(mode)) {
      res.status(400).json({ error: "Delete mode must be either 'soft' or 'hard'" });
      return;
    }

    const sourcePath = path.join(MARKDOWN_DIR, fileName);
    if (!(await fileExists(sourcePath))) {
      res.status(404).json({ error: "Markdown file not found" });
      return;
    }

    const deletedDoc = await moveDocToRecycle(fileName, mode);
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

app.get("/api/recycle-bin", async (req, res, next) => {
  try {
    const organizer = await readOrganizerState();
    const docs = await getRecycleDocs(organizer);
    res.json({ docs });
  } catch (error) {
    next(error);
  }
});

app.get("/api/recycle-bin/:entry/content", async (req, res, next) => {
  try {
    const entryName = sanitizeRecycleEntryName(req.params.entry);
    if (!entryName) {
      res.status(400).json({ error: "Invalid recycle bin entry" });
      return;
    }

    const fullPath = path.join(DELETED_SOFT_DIR, entryName);
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

app.post("/api/recycle-bin/:entry/restore", requireWriteAuth, async (req, res, next) => {
  try {
    const entryName = sanitizeRecycleEntryName(req.params.entry);
    if (!entryName) {
      res.status(400).json({ error: "Invalid recycle bin entry" });
      return;
    }

    const sourcePath = path.join(DELETED_SOFT_DIR, entryName);
    if (!(await fileExists(sourcePath))) {
      res.status(404).json({ error: "Recycle bin document not found" });
      return;
    }

    const originalFile = parseOriginalFilenameFromRecycleEntry(entryName);
    const restoreFileName = await ensureUniqueFilename(originalFile);
    const targetPath = path.join(MARKDOWN_DIR, restoreFileName);

    const folderInfo = resolveFolderInfo(await readOrganizerState(), originalFile);

    await moveFile(sourcePath, targetPath);
    invalidateCachedContent(sourcePath);
    invalidateCachedContent(targetPath);

    if (restoreFileName !== originalFile) {
      // Re-read inside the lock so a concurrent folder edit is not clobbered.
      await mutateOrganizerState((organizer) => {
        const currentFolderId = organizer.fileFolders[originalFile] || null;
        if (currentFolderId) {
          organizer.fileFolders[restoreFileName] = currentFolderId;
        }

        delete organizer.fileFolders[originalFile];
      });
    }

    const stat = await fsp.stat(targetPath);

    res.json({
      file: restoreFileName,
      title: toDocTitle(restoreFileName),
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
      restoredFrom: entryName,
      folderId: folderInfo.folderId,
      folderName: folderInfo.folderName
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/recycle-bin/:entry/hard-delete", requireWriteAuth, async (req, res, next) => {
  try {
    const entryName = sanitizeRecycleEntryName(req.params.entry);
    if (!entryName) {
      res.status(400).json({ error: "Invalid recycle bin entry" });
      return;
    }

    const sourcePath = path.join(DELETED_SOFT_DIR, entryName);
    if (!(await fileExists(sourcePath))) {
      res.status(404).json({ error: "Recycle bin document not found" });
      return;
    }

    const targetName = await ensureUniqueFilenameInDir(DELETED_HARD_DIR, entryName);
    const targetPath = path.join(DELETED_HARD_DIR, targetName);
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

app.get("/api/archive", async (req, res, next) => {
  try {
    const organizer = await readOrganizerState();
    const docs = await getRecycleDocs(organizer, DELETED_HARD_DIR);
    res.json({ docs });
  } catch (error) {
    next(error);
  }
});

app.get("/api/archive/:entry/content", async (req, res, next) => {
  try {
    const entryName = sanitizeRecycleEntryName(req.params.entry);
    if (!entryName) {
      res.status(400).json({ error: "Invalid archive entry" });
      return;
    }

    const fullPath = path.join(DELETED_HARD_DIR, entryName);
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

app.post("/api/archive/:entry/restore", requireWriteAuth, async (req, res, next) => {
  try {
    const entryName = sanitizeRecycleEntryName(req.params.entry);
    if (!entryName) {
      res.status(400).json({ error: "Invalid archive entry" });
      return;
    }

    const sourcePath = path.join(DELETED_HARD_DIR, entryName);
    if (!(await fileExists(sourcePath))) {
      res.status(404).json({ error: "Archived document not found" });
      return;
    }

    const originalFile = parseOriginalFilenameFromRecycleEntry(entryName);
    const restoreFileName = await ensureUniqueFilename(originalFile);
    const targetPath = path.join(MARKDOWN_DIR, restoreFileName);

    await moveFile(sourcePath, targetPath);
    invalidateCachedContent(sourcePath);
    invalidateCachedContent(targetPath);

    if (restoreFileName !== originalFile) {
      await mutateOrganizerState((organizer) => {
        const currentFolderId = organizer.fileFolders[originalFile] || null;
        if (currentFolderId) {
          organizer.fileFolders[restoreFileName] = currentFolderId;
        }

        delete organizer.fileFolders[originalFile];
      });
    }

    const organizer = await readOrganizerState();
    const folderInfo = resolveFolderInfo(organizer, restoreFileName);
    const stat = await fsp.stat(targetPath);

    res.json({
      file: restoreFileName,
      title: toDocTitle(restoreFileName),
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
      restoredFrom: entryName,
      folderId: folderInfo.folderId,
      folderName: folderInfo.folderName
    });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/archive/:entry", requireWriteAuth, async (req, res, next) => {
  try {
    const entryName = sanitizeRecycleEntryName(req.params.entry);
    if (!entryName) {
      res.status(400).json({ error: "Invalid archive entry" });
      return;
    }

    const fullPath = path.join(DELETED_HARD_DIR, entryName);
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

    // Drop the folder mapping too; nothing will ever restore this file again.
    await mutateOrganizerState((organizer) => {
      delete organizer.fileFolders[originalFile];
    });

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

// Both creation paths accept an optional folderId so a new document can land
// where it belongs instead of always appearing in Ungrouped and needing a
// second Move action. Returns the resolved folder info for the response.
async function fileNewDocumentIntoFolder(fileName, rawFolderId) {
  const folderId = normalizeFolderId(rawFolderId);
  if (!folderId) {
    return { folderId: null, folderName: null };
  }

  const { result } = await mutateOrganizerState((organizer) => {
    const folder = organizer.folders.find((entry) => entry.id === folderId);
    if (!folder) {
      throw new HttpError(404, "Folder not found");
    }

    organizer.fileFolders[fileName] = folder.id;
    return { folderId: folder.id, folderName: folder.name };
  });

  return result;
}

app.post("/api/docs", requireWriteAuth, async (req, res, next) => {
  try {
    const fileName = sanitizeNewFilename(req.body.fileName);
    const content = String(req.body.content || "");
    const overwrite = Boolean(req.body.overwrite);

    if (!fileName) {
      res.status(400).json({ error: "Invalid document file name" });
      return;
    }

    if (Buffer.byteLength(content, "utf8") > MAX_DOC_BYTES) {
      res.status(413).json({ error: "File content exceeds 2MB limit" });
      return;
    }

    const fullPath = path.join(MARKDOWN_DIR, fileName);
    if (!overwrite && (await fileExists(fullPath))) {
      res.status(409).json({ error: "A document with that name already exists" });
      return;
    }

    await fsp.writeFile(fullPath, content, "utf8");
    invalidateCachedContent(fullPath);
    const stat = await fsp.stat(fullPath);
    const folderInfo = await fileNewDocumentIntoFolder(fileName, req.body.folderId);

    res.status(201).json({
      file: fileName,
      title: toDocTitle(fileName),
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
      folderId: folderInfo.folderId,
      folderName: folderInfo.folderName
    });
  } catch (error) {
    next(error);
  }
});

app.put("/api/docs/:file", requireWriteAuth, async (req, res, next) => {
  try {
    const fileName = sanitizeFilename(req.params.file);
    const content = String(req.body.content || "");

    if (!fileName) {
      res.status(400).json({ error: "Invalid document file name" });
      return;
    }

    if (Buffer.byteLength(content, "utf8") > MAX_DOC_BYTES) {
      res.status(413).json({ error: "File content exceeds 2MB limit" });
      return;
    }

    const fullPath = path.join(MARKDOWN_DIR, fileName);
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

app.post("/api/docs/:file/rename", requireWriteAuth, async (req, res, next) => {
  try {
    const fileName = sanitizeFilename(req.params.file);
    const targetName = sanitizeNewFilename(req.body?.fileName);

    if (!fileName || !targetName) {
      res.status(400).json({ error: "Invalid document file name" });
      return;
    }

    const sourcePath = path.join(MARKDOWN_DIR, fileName);
    if (!(await fileExists(sourcePath))) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    if (targetName === fileName) {
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

    const targetPath = path.join(MARKDOWN_DIR, targetName);
    if (await fileExists(targetPath)) {
      res.status(409).json({ error: "A document with that name already exists" });
      return;
    }

    await moveFile(sourcePath, targetPath);
    invalidateCachedContent(sourcePath);
    invalidateCachedContent(targetPath);

    // The organizer is keyed by filename, so the folder assignment has to follow
    // the rename or the document silently falls back into Ungrouped.
    const { result: folderInfo } = await mutateOrganizerState((organizer) => {
      const folderId = organizer.fileFolders[fileName] || null;
      delete organizer.fileFolders[fileName];

      if (!folderId) {
        return { folderId: null, folderName: null };
      }

      organizer.fileFolders[targetName] = folderId;
      const folder = organizer.folders.find((entry) => entry.id === folderId);
      return { folderId, folderName: folder?.name || null };
    });

    const stat = await fsp.stat(targetPath);
    res.json({
      file: targetName,
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

app.post("/api/docs/upload", requireWriteAuth, upload.single("markdownFile"), async (req, res, next) => {
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

    const finalName = await ensureUniqueFilename(sanitizedName);
    const fullPath = path.join(MARKDOWN_DIR, finalName);
    await fsp.writeFile(fullPath, req.file.buffer);
    invalidateCachedContent(fullPath);

    const stat = await fsp.stat(fullPath);
    const folderInfo = await fileNewDocumentIntoFolder(finalName, req.body.folderId);

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

app.use(express.static(PUBLIC_DIR, { index: false }));

app.use((error, req, res, next) => {
  if (error instanceof HttpError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }

  // express.json() rejects oversized bodies before our own size check runs.
  if (error?.type === "entity.too.large") {
    res.status(413).json({ error: "File content exceeds the 2MB limit" });
    return;
  }

  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "Uploaded file exceeds 2MB limit" });
      return;
    }

    res.status(400).json({ error: error.message || "Upload failed" });
    return;
  }

  if (error && error.message === "Only .md, .markdown, .mmd, .mermaid, or .ipynb files are supported") {
    res.status(400).json({ error: error.message });
    return;
  }

  console.error(error);
  res.status(500).json({ error: "Internal server error" });
});

ensureStorageDirs()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Markdown viewer running on http://localhost:${PORT}`);

      if (CONFIGURED_WRITE_TOKEN) {
        console.log("Editing is locked behind MDVIEWER_TOKEN.");
        return;
      }

      console.log("");
      console.log("  MDVIEWER_TOKEN is not set, so a temporary editor token was generated:");
      console.log("");
      console.log(`      ${WRITE_TOKEN}`);
      console.log("");
      console.log("  Reads are public; creating, editing and deleting require this token.");
      console.log("  It changes on every restart - set MDVIEWER_TOKEN to keep it stable.");
      console.log("");
    });
  })
  .catch((error) => {
    console.error("Failed to start server", error);
    process.exit(1);
  });
