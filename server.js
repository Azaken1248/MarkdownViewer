const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const { createHandler } = require("graphql-http/lib/use/express");
const { buildSchema } = require("graphql");

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const MARKDOWN_DIR = path.join(PUBLIC_DIR, "docs");
const DELETED_MARKDOWN_DIR = path.join(ROOT_DIR, "deleted_markdowns");
const DELETED_SOFT_DIR = path.join(DELETED_MARKDOWN_DIR, "soft");
const DELETED_HARD_DIR = path.join(DELETED_MARKDOWN_DIR, "hard");
const MAX_DOC_BYTES = 2 * 1024 * 1024;
const ALLOWED_DOC_EXTENSIONS = new Set([".md", ".markdown", ".mmd", ".mermaid"]);
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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOC_BYTES },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (!ALLOWED_DOC_EXTENSIONS.has(ext)) {
      cb(new Error("Only .md, .markdown, .mmd, or .mermaid files are supported"));
      return;
    }
    cb(null, true);
  }
});

async function ensureStorageDirs() {
  await fsp.mkdir(MARKDOWN_DIR, { recursive: true });
  await fsp.mkdir(DELETED_SOFT_DIR, { recursive: true });
  await fsp.mkdir(DELETED_HARD_DIR, { recursive: true });
}

function sanitizeFilename(rawName) {
  const baseName = path.basename(String(rawName || "").trim());
  if (!baseName) {
    return null;
  }

  let candidate = baseName;
  const hasKnownExtension = /\.(md|markdown|mmd|mermaid)$/i.test(candidate);
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
    .replace(/\.md$/i, "")
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

  const stat = await fsp.stat(targetPath);
  return {
    file: entryName,
    originalFile: fileName,
    mode,
    size: stat.size,
    deletedAt: stat.mtime.toISOString()
  };
}

async function getRecycleDocs() {
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
      return {
        file: entry.name,
        originalFile,
        title: toDocTitle(originalFile),
        size: stat.size,
        deletedAt: stat.mtime.toISOString(),
        updatedAt: stat.mtime.toISOString()
      };
    })
  );

  docs.sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt));
  return docs;
}

async function getDocs() {
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
      return {
        file: entry.name,
        title: toDocTitle(entry.name),
        size: stat.size,
        updatedAt: stat.mtime.toISOString()
      };
    })
  );

  docs.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return docs;
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
  if (indexTemplateCache !== null) {
    return indexTemplateCache;
  }

  indexTemplateCache = await fsp.readFile(INDEX_TEMPLATE_PATH, "utf8");
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
    const docs = await getDocs();
    res.json({ docs });
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

    const content = await fsp.readFile(fullPath, "utf8");
    res.json({ file: fileName, content });
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
    if (!["soft", "hard"].includes(mode)) {
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
    const docs = await getRecycleDocs();
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

    const content = await fsp.readFile(fullPath, "utf8");
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

    await moveFile(sourcePath, targetPath);
    const stat = await fsp.stat(targetPath);

    res.json({
      file: restoreFileName,
      title: toDocTitle(restoreFileName),
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
      restoredFrom: entryName
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
      res.status(400).json({ error: "Invalid markdown file name" });
      return;
    }

    if (Buffer.byteLength(content, "utf8") > MAX_DOC_BYTES) {
      res.status(413).json({ error: "File content exceeds 2MB limit" });
      return;
    }

    const fullPath = path.join(MARKDOWN_DIR, fileName);
    if (!overwrite && (await fileExists(fullPath))) {
      res.status(409).json({ error: "A markdown file with that name already exists" });
      return;
    }

    await fsp.writeFile(fullPath, content, "utf8");
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
      res.status(400).json({ error: "Invalid markdown file name" });
      return;
    }

    if (Buffer.byteLength(content, "utf8") > MAX_DOC_BYTES) {
      res.status(413).json({ error: "File content exceeds 2MB limit" });
      return;
    }

    const fullPath = path.join(MARKDOWN_DIR, fileName);
    if (!(await fileExists(fullPath))) {
      res.status(404).json({ error: "Markdown file not found" });
      return;
    }

    await fsp.writeFile(fullPath, content, "utf8");
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
      res.status(400).json({ error: "No markdown file uploaded" });
      return;
    }

    const requestedName = req.body.fileName || req.file.originalname;
    const sanitizedName = sanitizeFilename(requestedName);
    if (!sanitizedName) {
      res.status(400).json({ error: "Invalid markdown file name" });
      return;
    }

    const finalName = await ensureUniqueFilename(sanitizedName);
    const fullPath = path.join(MARKDOWN_DIR, finalName);
    await fsp.writeFile(fullPath, req.file.buffer);

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

  if (error && error.message === "Only .md, .markdown, .mmd, or .mermaid files are supported") {
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
