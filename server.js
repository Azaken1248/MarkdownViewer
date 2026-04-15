const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const MARKDOWN_DIR = path.join(PUBLIC_DIR, "docs");
const MAX_DOC_BYTES = 2 * 1024 * 1024;
const ALLOWED_DOC_EXTENSIONS = new Set([".md", ".markdown", ".mmd", ".mermaid"]);

app.use(express.json({ limit: "2mb" }));
app.use(express.static(PUBLIC_DIR));

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

async function ensureMarkdownDir() {
  await fsp.mkdir(MARKDOWN_DIR, { recursive: true });
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

async function ensureUniqueFilename(fileName) {
  const parsed = path.parse(fileName);
  let index = 1;
  let candidate = fileName;

  while (await fileExists(path.join(MARKDOWN_DIR, candidate))) {
    candidate = `${parsed.name}-${index}${parsed.ext}`;
    index += 1;
  }

  return candidate;
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

ensureMarkdownDir()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Markdown viewer running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start server", error);
    process.exit(1);
  });
