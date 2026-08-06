const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const crypto = require("crypto");
const { createHandler } = require("graphql-http/lib/use/express");
const { buildSchema } = require("graphql");

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
const ROOT_FOLDER_LABEL = "Ungrouped";
const SEARCH_RESULT_LIMIT = 200;
const INDEX_TEMPLATE_PATH = path.join(PUBLIC_DIR, "index.html");
const SITE_NAME = "Markdown Docs Viewer";
const EMBED_TITLE = "Markdown Docs Viewer | Cart Knowledge Hub";
const EMBED_DESCRIPTION = "Browse, search, and share cart documentation with live markdown editing and Mermaid diagrams.";
const EMBED_THEME_COLOR = "#89b4fa";
const EMBED_IMAGE_PATH = "/social-card.svg";
const FAVICON_PATH = "/favicon.svg";

app.set("trust proxy", true);
app.use(express.json({ limit: "2mb" }));

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

function normalizeFolderName(rawName) {
  const value = String(rawName || "").trim().replace(/\s+/g, " ");
  if (!value || value.length > 80) {
    return null;
  }

  if (!/^[A-Za-z0-9 _.-]+$/i.test(value)) {
    return null;
  }

  if (value === "." || value === "..") {
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
      const name = normalizeFolderName(folder?.name);
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

async function readOrganizerState() {
  try {
    const raw = await fsp.readFile(ORGANIZER_FILE_PATH, "utf8");
    return normalizeOrganizerState(JSON.parse(raw));
  } catch {
    return createDefaultOrganizerState();
  }
}

async function writeOrganizerState(organizerState) {
  const normalized = normalizeOrganizerState(organizerState);
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.writeFile(ORGANIZER_FILE_PATH, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
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
      folderOrder: -1
    };
  }

  const folder = getFolderRecordById(organizerState, folderId);
  if (!folder) {
    return {
      folderId: null,
      folderName: null,
      folderOrder: -1
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

function buildSearchSnippet(content, query, tokens) {
  const raw = String(content || "").replace(/\s+/g, " ").trim();
  if (!raw) {
    return "No preview available.";
  }

  const normalizedContent = normalizeSearchText(raw);
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

function scoreSearchDoc(doc, normalizedQuery, tokens, content) {
  const title = normalizeSearchText(doc.title);
  const file = normalizeSearchText(doc.originalFile || doc.file);
  const folderName = normalizeSearchText(doc.folderName || "");
  const normalizedContent = normalizeSearchText(content);

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

const docContentCache = new Map();

function invalidateCachedContent(fullPath) {
  docContentCache.delete(fullPath);
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
  });

  return {
    content,
    stat,
    cached: false
  };
}

function sanitizeFilename(rawName) {
  const baseName = path.basename(String(rawName || "").trim());
  if (!baseName) {
    return null;
  }

  let candidate = baseName;
  const hasKnownExtension = /\.(md|markdown|mmd|mermaid|ipynb)$/i.test(candidate);
  if (!hasKnownExtension) {
    candidate = `${candidate}.md`;
  }

  if (candidate.includes("..")) {
    return null;
  }

  const ext = path.extname(candidate).toLowerCase();
  if (!ALLOWED_DOC_EXTENSIONS.has(ext)) {
    return null;
  }

  if (!/^[A-Za-z0-9 _.-]+$/i.test(candidate)) {
    return null;
  }

  return candidate;
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

async function getRecycleDocs(organizerState = null) {
  const organizer = organizerState || await readOrganizerState();
  const dirEntries = await fsp.readdir(DELETED_SOFT_DIR, { withFileTypes: true });
  const recycleEntries = dirEntries.filter((entry) => {
    if (!entry.isFile()) {
      return false;
    }

    const ext = path.extname(entry.name).toLowerCase();
    return ALLOWED_DOC_EXTENSIONS.has(ext);
  });

  const docs = await Promise.all(
    recycleEntries.map(async (entry) => {
      const fullPath = path.join(DELETED_SOFT_DIR, entry.name);
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

async function setDocumentFolder(fileName, folderId) {
  const organizer = await readOrganizerState();
  const sanitizedFileName = sanitizeFilename(fileName);

  if (!sanitizedFileName) {
    return null;
  }

  const normalizedFolderId = normalizeFolderId(folderId);
  if (normalizedFolderId) {
    const folder = getFolderRecordById(organizer, normalizedFolderId);
    if (!folder) {
      return null;
    }

    organizer.fileFolders[sanitizedFileName] = folder.id;
  } else {
    delete organizer.fileFolders[sanitizedFileName];
  }

  return writeOrganizerState(organizer);
}

async function createFolder(name) {
  const folderName = normalizeFolderName(name);
  if (!folderName) {
    return null;
  }

  const organizer = await readOrganizerState();
  const existing = organizer.folders.find((folder) => folder.name.toLowerCase() === folderName.toLowerCase());
  if (existing) {
    return null;
  }

  const now = new Date().toISOString();
  const folder = {
    id: createFolderId(),
    name: folderName,
    order: organizer.folders.length,
    createdAt: now,
    updatedAt: now
  };

  organizer.folders.push(folder);
  await writeOrganizerState(organizer);
  return folder;
}

async function renameFolder(folderId, name) {
  const normalizedFolderId = normalizeFolderId(folderId);
  const folderName = normalizeFolderName(name);

  if (!normalizedFolderId || !folderName) {
    return null;
  }

  const organizer = await readOrganizerState();
  const folder = organizer.folders.find((entry) => entry.id === normalizedFolderId);
  if (!folder) {
    return null;
  }

  const existing = organizer.folders.find((entry) => entry.id !== normalizedFolderId && entry.name.toLowerCase() === folderName.toLowerCase());
  if (existing) {
    return null;
  }

  folder.name = folderName;
  folder.updatedAt = new Date().toISOString();
  await writeOrganizerState(organizer);
  return folder;
}

async function deleteFolder(folderId) {
  const normalizedFolderId = normalizeFolderId(folderId);
  if (!normalizedFolderId) {
    return null;
  }

  const organizer = await readOrganizerState();
  const folderIndex = organizer.folders.findIndex((entry) => entry.id === normalizedFolderId);
  if (folderIndex < 0) {
    return null;
  }

  organizer.folders.splice(folderIndex, 1);
  for (const [fileName, assignedFolderId] of Object.entries(organizer.fileFolders)) {
    if (assignedFolderId === normalizedFolderId) {
      delete organizer.fileFolders[fileName];
    }
  }

  await writeOrganizerState(organizer);
  return true;
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
  const docs = scope === "recycle-bin"
    ? await getRecycleDocs(organizer)
    : await getDocs(organizer);

  const matches = await Promise.all(docs.map(async (doc) => {
    const fullPath = scope === "recycle-bin"
      ? path.join(DELETED_SOFT_DIR, doc.file)
      : path.join(MARKDOWN_DIR, doc.file);
    const { content } = await readCachedTextFile(fullPath);
    const score = scoreSearchDoc(doc, normalizedQuery, tokens, content);
    if (score === null) {
      return null;
    }

    return {
      ...doc,
      score,
      snippet: buildSearchSnippet(content, normalizedQuery, searchTerms)
    };
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

  return {
    matches: scoredMatches.slice(0, SEARCH_RESULT_LIMIT),
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

  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = forwardedProto || req.protocol || "http";
  const forwardedHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const host = forwardedHost || req.get("host") || `localhost:${PORT}`;

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

app.all(
  "/graphql",
  createHandler({
    schema: graphQLSchema,
    rootValue: graphQLRootValue,
    graphiql: true,
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
    const scope = String(req.query.scope || "docs").trim().toLowerCase() === "recycle-bin"
      ? "recycle-bin"
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

app.put("/api/docs/:file/folder", async (req, res, next) => {
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
    const organizer = await readOrganizerState();
    const normalizedFolderId = normalizeFolderId(folderId);

    if (folderId && !normalizedFolderId) {
      res.status(400).json({ error: "Invalid folder id" });
      return;
    }

    if (normalizedFolderId && !getFolderRecordById(organizer, normalizedFolderId)) {
      res.status(404).json({ error: "Folder not found" });
      return;
    }

    if (normalizedFolderId) {
      organizer.fileFolders[fileName] = normalizedFolderId;
    } else {
      delete organizer.fileFolders[fileName];
    }

    const savedOrganizer = await writeOrganizerState(organizer);
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

app.post("/api/folders", async (req, res, next) => {
  try {
    const folderName = normalizeFolderName(req.body?.name);
    if (!folderName) {
      res.status(400).json({ error: "Invalid folder name" });
      return;
    }

    const organizer = await readOrganizerState();
    const existing = organizer.folders.find((folder) => folder.name.toLowerCase() === folderName.toLowerCase());
    if (existing) {
      res.status(409).json({ error: "A folder with that name already exists" });
      return;
    }

    const now = new Date().toISOString();
    const folder = {
      id: createFolderId(),
      name: folderName,
      order: organizer.folders.length,
      createdAt: now,
      updatedAt: now
    };

    organizer.folders.push(folder);
    const savedOrganizer = await writeOrganizerState(organizer);

    res.status(201).json({
      folder: serializeFolders([folder])[0],
      folders: serializeFolders(savedOrganizer.folders)
    });
  } catch (error) {
    next(error);
  }
});

app.put("/api/folders/:folderId", async (req, res, next) => {
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

    const organizer = await readOrganizerState();
    const folder = organizer.folders.find((entry) => entry.id === normalizedFolderId);
    if (!folder) {
      res.status(404).json({ error: "Folder not found" });
      return;
    }

    const duplicate = organizer.folders.find((entry) => entry.id !== normalizedFolderId && entry.name.toLowerCase() === folderName.toLowerCase());
    if (duplicate) {
      res.status(409).json({ error: "A folder with that name already exists" });
      return;
    }

    folder.name = folderName;
    folder.updatedAt = new Date().toISOString();
    const savedOrganizer = await writeOrganizerState(organizer);

    res.json({
      folder: serializeFolders([folder])[0],
      folders: serializeFolders(savedOrganizer.folders)
    });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/folders/:folderId", async (req, res, next) => {
  try {
    const normalizedFolderId = normalizeFolderId(req.params.folderId);
    if (!normalizedFolderId) {
      res.status(400).json({ error: "Invalid folder id" });
      return;
    }

    const organizer = await readOrganizerState();
    const folderIndex = organizer.folders.findIndex((entry) => entry.id === normalizedFolderId);
    if (folderIndex < 0) {
      res.status(404).json({ error: "Folder not found" });
      return;
    }

    organizer.folders.splice(folderIndex, 1);
    for (const [fileName, assignedFolderId] of Object.entries(organizer.fileFolders)) {
      if (assignedFolderId === normalizedFolderId) {
        delete organizer.fileFolders[fileName];
      }
    }

    const savedOrganizer = await writeOrganizerState(organizer);
    res.json({
      message: "Folder deleted",
      folders: serializeFolders(savedOrganizer.folders)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/docs/:file/delete", async (req, res, next) => {
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
        : `${fileName} moved to deleted archive`
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

app.post("/api/recycle-bin/:entry/restore", async (req, res, next) => {
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

    const organizer = await readOrganizerState();
    const folderInfo = resolveFolderInfo(organizer, originalFile);

    await moveFile(sourcePath, targetPath);
    invalidateCachedContent(sourcePath);
    invalidateCachedContent(targetPath);

    if (restoreFileName !== originalFile) {
      if (folderInfo.folderId) {
        organizer.fileFolders[restoreFileName] = folderInfo.folderId;
      }

      delete organizer.fileFolders[originalFile];
      await writeOrganizerState(organizer);
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

app.post("/api/recycle-bin/:entry/hard-delete", async (req, res, next) => {
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
      mode: "hard"
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/docs", async (req, res, next) => {
  try {
    const fileName = sanitizeFilename(req.body.fileName);
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

    res.status(201).json({
      file: fileName,
      title: toDocTitle(fileName),
      size: stat.size,
      updatedAt: stat.mtime.toISOString()
    });
  } catch (error) {
    next(error);
  }
});

app.put("/api/docs/:file", async (req, res, next) => {
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

app.post("/api/docs/upload", upload.single("markdownFile"), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No document file uploaded" });
      return;
    }

    const requestedName = req.body.fileName || req.file.originalname;
    const sanitizedName = sanitizeFilename(requestedName);
    if (!sanitizedName) {
      res.status(400).json({ error: "Invalid document file name" });
      return;
    }

    const finalName = await ensureUniqueFilename(sanitizedName);
    const fullPath = path.join(MARKDOWN_DIR, finalName);
    await fsp.writeFile(fullPath, req.file.buffer);
    invalidateCachedContent(fullPath);

    const stat = await fsp.stat(fullPath);

    res.status(201).json({
      file: finalName,
      title: toDocTitle(finalName),
      size: stat.size,
      updatedAt: stat.mtime.toISOString()
    });
  } catch (error) {
    next(error);
  }
});

app.use(express.static(PUBLIC_DIR, { index: false }));

app.use((error, req, res, next) => {
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
    });
  })
  .catch((error) => {
    console.error("Failed to start server", error);
    process.exit(1);
  });
