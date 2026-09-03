const express = require("express");
const multer = require("multer");
const path = require("path");
const fsp = require("fs/promises");
const crypto = require("crypto");
const { createHandler } = require("graphql-http/lib/use/express");
const { buildSchema, NoSchemaIntrospectionCustomRule } = require("graphql");

const {
  AuthStore,
  ROLES,
  SEED_ADMIN_USERNAME,
  SEED_ADMIN_PASSWORD
} = require("./lib/auth");
const { ShareStore } = require("./lib/shares");
const { LinkStore } = require("./lib/links");
const linkPreview = require("./lib/link-preview");
const excerpt = require("./lib/excerpt");
const {
  ALLOWED_DOC_EXTENSIONS,
  UNSAFE_FILENAME_CHARS_GLOBAL,
  MAX_FOLDER_DEPTH,
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
  parseOriginalFilenameFromRecycleEntry
} = require("./lib/docs/paths");
const { securityHeaders } = require("./lib/http/headers");
const { requestLogger } = require("./lib/http/logging");
const { templateReader, fillTemplate } = require("./lib/http/html");
const { isAbsoluteHttpUrl, toAbsoluteUrl, createBaseUrlResolver } = require("./lib/http/urls");
const { HttpError, createErrorPages } = require("./lib/http/errors");
const { createGuards } = require("./lib/guards");
const {
  ROOT_FOLDER_LABEL,
  normalizeFolderName,
  normalizeFolderId,
  createFolderId,
  getFolderDepth,
  getFolderPath,
  isFolderWithinSubtree,
  collectFolderSubtreeIds,
  getFolderRecordById,
  resolveFolderInfo,
  serializeFolders,
  folderDirFor,
  createOrganizerFile
} = require("./lib/docs/organizer");
const { createSearch } = require("./lib/docs/search");
const { createDocumentCache } = require("./lib/docs/content");
const { createDocumentStore } = require("./lib/docs/store");
const { createAssetRoutes, MAX_ASSET_BYTES } = require("./lib/routes/assets");
const { createAuthRoutes } = require("./lib/routes/auth");
const { createUserRoutes } = require("./lib/routes/users");

const app = express();
const PORT = process.env.PORT || 4321;
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");

// Where runtime state lives: the documents themselves, the recycle bin and the
// folder organizer. Defaults to the checkout, which is the layout this has
// always used. MDVIEWER_STATE_DIR moves all three together — the test suite
// points it at a throwaway directory so a test run can never touch real
// documents, and a deployment can use it to keep state outside the checkout.
const STATE_DIR = process.env.MDVIEWER_STATE_DIR
  ? path.resolve(process.env.MDVIEWER_STATE_DIR)
  : ROOT_DIR;
const MARKDOWN_DIR = process.env.MDVIEWER_STATE_DIR
  ? path.join(STATE_DIR, "docs")
  : path.join(PUBLIC_DIR, "docs");
const DELETED_MARKDOWN_DIR = path.join(STATE_DIR, "deleted_markdowns");
const ASSETS_DIR = path.join(STATE_DIR, "assets");
const DATA_DIR = path.join(STATE_DIR, "data");
const ORGANIZER_FILE_PATH = path.join(DATA_DIR, "document-organizer.json");
const {
  readOrganizerState,
  mutateOrganizerState
} = createOrganizerFile({ filePath: ORGANIZER_FILE_PATH });
const DELETED_SOFT_DIR = path.join(DELETED_MARKDOWN_DIR, "soft");
const DELETED_HARD_DIR = path.join(DELETED_MARKDOWN_DIR, "hard");
const MAX_DOC_BYTES = 2 * 1024 * 1024;
const SEARCH_RESULT_LIMIT = 200;
// Both caches are bounded so a large corpus cannot pin the whole thing in RSS
// forever. Entries are re-derived from disk on a miss, so a small budget costs
// time, never correctness.
const CONTENT_CACHE_MAX_BYTES = 32 * 1024 * 1024;
const SEARCH_INDEX_MAX_BYTES = 48 * 1024 * 1024;
const SNIPPET_CACHE_MAX_BYTES = 16 * 1024 * 1024;

const {
  readCachedTextFile,
  readSearchIndexEntry,
  readSnippetSource,
  invalidateCachedContent
} = createDocumentCache({
  contentMaxBytes: CONTENT_CACHE_MAX_BYTES,
  indexMaxBytes: SEARCH_INDEX_MAX_BYTES,
  snippetMaxBytes: SNIPPET_CACHE_MAX_BYTES
});

const {
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
} = createDocumentStore({
  markdownDir: MARKDOWN_DIR,
  softDeletedDir: DELETED_SOFT_DIR,
  hardDeletedDir: DELETED_HARD_DIR,
  dataDir: DATA_DIR,
  readOrganizerState,
  mutateOrganizerState,
  invalidateCachedContent
});

const { searchDocuments: searchIn } = createSearch({
  readSearchIndexEntry,
  readSnippetSource,
  resultLimit: SEARCH_RESULT_LIMIT
});
const INDEX_TEMPLATE_PATH = path.join(PUBLIC_DIR, "index.html");
const SHARE_TEMPLATE_PATH = path.join(PUBLIC_DIR, "share.html");
const ERROR_TEMPLATE_PATH = path.join(PUBLIC_DIR, "error.html");
const DIAGRAM_TEMPLATE_PATH = path.join(PUBLIC_DIR, "diagram.html");
const SITE_NAME = "AzaDocs";
const EMBED_TITLE = "AzaDocs";
const EMBED_DESCRIPTION = "A personal markdown library: browse, search and edit documents, with Mermaid diagrams and Jupyter notebooks rendered inline.";
// The dark canvas, which is the default theme. The old value was Catppuccin
// blue, left over from a palette the app no longer uses.
const EMBED_THEME_COLOR = "#06090a";
const FAVICON_PATH = "/favicon.svg";
// The picture a link preview shows. It is a PNG, and that is the whole point:
// the app's only image used to be favicon.svg, and no embed crawler renders
// SVG — not Discord, not Slack, not X — so every link to this app came out with
// an empty space where the picture should be. iOS will not take an SVG for
// apple-touch-icon either, hence the raster icon beside it.
//
// 1200x630 is the size the crawlers document, and the one that earns a
// full-width card rather than a thumbnail. Both are built by
// tools/make-embed-images.js from the same shapes as the favicon.
const EMBED_IMAGE_PATH = "/img/embed-card.png";
const EMBED_IMAGE_WIDTH = "1200";
const EMBED_IMAGE_HEIGHT = "630";
const EMBED_IMAGE_ALT = "AzaDocs";
const APPLE_TOUCH_ICON_PATH = "/img/icon-180.png";
const ICON_PATH = "/img/icon-512.png";
const EMBED_AUTHOR_NAME = "Azaken1248";
// Where this actually lives. Canonical, og:*, and oEmbed URLs are built from
// this rather than from the request, so a spoofed Host header cannot redirect
// a link preview somewhere else. PUBLIC_BASE_URL overrides it — set it to
// http://localhost:4321 when working locally if you need the previews to point
// at your own machine.
const DEFAULT_PUBLIC_BASE_URL = "https://md.azaken.com";

// Built once, from the two facts only this file has.
const getBaseUrlFromRequest = createBaseUrlResolver({
  defaultBaseUrl: DEFAULT_PUBLIC_BASE_URL,
  port: PORT
});

// Only trust X-Forwarded-* when we are actually behind a reverse proxy.
// Trusting them unconditionally lets any client spoof the host/protocol used
// to build canonical, og:image and oEmbed URLs.
const TRUST_PROXY = process.env.TRUST_PROXY || "";
if (TRUST_PROXY) {
  app.set("trust proxy", TRUST_PROXY === "true" ? true : TRUST_PROXY);
} else {
  app.set("trust proxy", false);
}

app.use(securityHeaders());

// Logging is off entirely in the test suite (LOG_REQUESTS=false) to keep its
// output readable, and skips static assets unless LOG_STATIC=true.
const LOG_REQUESTS = String(process.env.LOG_REQUESTS || "true").toLowerCase() !== "false";
const LOG_STATIC = String(process.env.LOG_STATIC || "").toLowerCase() === "true";

if (LOG_REQUESTS) {
  app.use(requestLogger({ logStatic: LOG_STATIC }));
}

// The envelope limit has to sit above MAX_DOC_BYTES, not equal it: JSON escaping
// inflates the payload, so a legal 2MB document arrives as a larger body. When the
// two were equal, express rejected the request before the app's own size check ran
// and the client saw a 500 instead of a 413. The doubled headroom covers escaping
// while still bounding how much a single request can buffer.
const JSON_BODY_LIMIT = MAX_DOC_BYTES * 2 + 64 * 1024;
app.use(express.json({ limit: JSON_BODY_LIMIT }));

// ---------------------------------------------------------------------------
// Authentication and access control
//
// Accounts, not a shared token. Sessions are server-side and carried in an
// httpOnly SameSite=Strict cookie; see lib/auth.js for why each of those was
// chosen. Roles are viewer / editor / admin.
//
// Reads require a session by default. PUBLIC_READS=true restores the old
// behaviour where anyone could read every document. Individual documents can be
// published regardless, via a share link (lib/shares.js).
// ---------------------------------------------------------------------------

const PUBLIC_READS = String(process.env.PUBLIC_READS || "").toLowerCase() === "true";

const authStore = new AuthStore({ dataDir: DATA_DIR });
const shareStore = new ShareStore({ dataDir: DATA_DIR });
const linkStore = new LinkStore({ dataDir: DATA_DIR });

// Cookies must be Secure in production or the session travels in clear text on
// the first plain-HTTP request. Derived from the public base URL rather than
// from the request, which an attacker controls.
const COOKIES_SECURE = String(process.env.PUBLIC_BASE_URL || DEFAULT_PUBLIC_BASE_URL)
  .startsWith("https://");

const {
  attachSession,
  requireAuth,
  requireRead,
  requirePermission,
  requireCsrf,
  sessionPayload,
  issueSessionCookie,
  clearSessionCookie
} = createGuards({
  authStore,
  publicReads: PUBLIC_READS,
  trustProxy: TRUST_PROXY,
  cookiesSecure: COOKIES_SECURE,
  getBaseUrl: getBaseUrlFromRequest
});

// Every request learns who it is from before any route runs; the guards decide
// what that means. CSRF is checked globally so a new route cannot forget it.
app.use(attachSession);
app.use(requireCsrf);

const getIndexTemplate = templateReader(INDEX_TEMPLATE_PATH);

// A folder upload is capped by count as well as by per-file size: 200 files at
// 2MB each is already 400MB of request body in the worst case.
const MAX_FOLDER_UPLOAD_FILES = 200;

const uploadFolder = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOC_BYTES, files: MAX_FOLDER_UPLOAD_FILES },
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
// Auth routes
// ---------------------------------------------------------------------------



app.use(createAuthRoutes({
  authStore,
  requireAuth,
  sessionPayload,
  issueSessionCookie,
  clearSessionCookie
}));

// ---------------------------------------------------------------------------
// Share links
// ---------------------------------------------------------------------------

function shareUrlFor(req, token) {
  return toAbsoluteUrl(getBaseUrlFromRequest(req), `/s/${token}`);
}

app.get("/api/shares", requirePermission("share:manage"), (req, res) => {
  res.json({ shares: shareStore.listShares() });
});

// Creating a share for a document that already has one rotates the token, which
// is the only way to revoke a URL that has leaked.
app.post("/api/docs/*file/share", requirePermission("share:manage"), async (req, res, next) => {
  try {
    const fileName = paramDocPath(req);
    if (!fileName) {
      res.status(400).json({ error: "Invalid markdown file name" });
      return;
    }

    if (!(await fileExists(path.join(MARKDOWN_DIR, fileName)))) {
      res.status(404).json({ error: "Markdown file not found" });
      return;
    }

    const rotated = Boolean(shareStore.findByFile(fileName));
    const token = await shareStore.withLock(() => shareStore.create(fileName, {
      createdBy: req.auth.user.username
    }));

    // The only time the full token is ever returned. It is stored hashed, so
    // there is no way to show it again later.
    res.status(201).json({
      file: fileName,
      rotated,
      url: shareUrlFor(req, token),
      share: shareStore.describe(fileName)
    });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/docs/*file/share", requirePermission("share:manage"), async (req, res, next) => {
  try {
    const fileName = paramDocPath(req);
    if (!fileName) {
      res.status(400).json({ error: "Invalid markdown file name" });
      return;
    }

    const revoked = await shareStore.withLock(() => shareStore.revoke(fileName));
    res.json({ file: fileName, revoked });
  } catch (error) {
    next(error);
  }
});

// Public: the share token is the credential. No session, no cookie, no CSRF.
app.get("/api/share/:token", async (req, res, next) => {
  try {
    const share = shareStore.findByToken(String(req.params.token || ""));
    if (!share) {
      res.status(404).json({ error: "This share link is not valid." });
      return;
    }

    const fullPath = path.join(MARKDOWN_DIR, share.file);
    if (!(await fileExists(fullPath))) {
      res.status(404).json({ error: "The shared document no longer exists." });
      return;
    }

    const { content, stat } = await readCachedTextFile(fullPath);
    await shareStore.withLock(() => shareStore.recordView(share.file));

    // Deliberately minimal: the document and nothing about the library it came
    // from — no folder, no neighbours, no user.
    res.json({
      file: share.file,
      title: toDocTitle(share.file),
      content,
      updatedAt: stat.mtime.toISOString()
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Saved links
//
// Reading the list is a read; adding, editing and removing are writes, so they
// sit behind doc:write like everything else that changes the library.
//
// Adding and refreshing also make the server fetch a URL someone else chose,
// which is the one outbound request this app makes. lib/link-preview.js decides
// what may be fetched; the limit below decides how often, so an account cannot
// use this as a general-purpose proxy or a scanner.
// ---------------------------------------------------------------------------

const LINK_FETCH_WINDOW_MS = 60_000;
const LINK_FETCH_MAX_PER_WINDOW = 20;
const linkFetchLog = new Map();

/* Claim up to `wanted` fetches from this account's budget.
 *
 * Returns how many were actually available, which is how the batch route
 * decides how much work to do rather than starting more than it is allowed to
 * finish and collecting a 429 half way through.
 */
function takeLinkFetchSlots(req, wanted) {
  const key = req.auth?.user?.id || req.ip || "anonymous";
  const now = Date.now();
  const recent = (linkFetchLog.get(key) || []).filter((at) => now - at < LINK_FETCH_WINDOW_MS);
  const granted = Math.max(0, Math.min(wanted, LINK_FETCH_MAX_PER_WINDOW - recent.length));

  for (let taken = 0; taken < granted; taken += 1) {
    recent.push(now);
  }

  linkFetchLog.set(key, recent);

  // The map is keyed by account, so it cannot grow without bound in normal use,
  // but a long-running process should not keep dead entries either.
  if (linkFetchLog.size > 500) {
    for (const [id, times] of linkFetchLog) {
      if (times.every((at) => now - at >= LINK_FETCH_WINDOW_MS)) {
        linkFetchLog.delete(id);
      }
    }
  }

  return granted;
}

function throttleLinkFetch(req, res) {
  if (takeLinkFetchSlots(req, 1) === 1) {
    return true;
  }

  res.status(429).json({
    error: "Too many links fetched just now. Wait a minute and try again."
  });
  return false;
}

/* A link as the client sees it.
 *
 * The icon is stored with the link but is not sent with it. Favicons are
 * mostly a couple of kilobytes and occasionally a hundred — one site here uses
 * a full illustration as its icon — and carrying them inside the list meant a
 * five-kilobyte answer became a two-hundred-kilobyte one, downloaded again
 * every time the pane was opened for the first time in a tab, before a single
 * card could be drawn.
 *
 * So the list carries an address instead, and the browser fetches and caches
 * the pictures as pictures. The address ends in a hash of the bytes, which is
 * what makes it safe to cache them for a long time: re-read a page, get a
 * different icon, get a different address.
 *
 * Still this server's own address. The reason the icon is stored at all is so
 * that opening this pane does not announce itself to every site in the list.
 */
/* Remembered per link, because listing them would otherwise hash every icon
 * on every request: a full library is a couple of hundred megabytes of hashing
 * to answer a question whose answer has not changed. Keyed by id and checked
 * against the icon it was computed from, so a re-read that brings back a
 * different picture gets a different tag. Bounded by the store's own limit on
 * how many links there can be. */
const iconTags = new Map();

function iconTag(link) {
  const cached = iconTags.get(link.id);
  if (cached && cached.icon === link.icon) {
    return cached.tag;
  }

  const tag = crypto.createHash("sha1").update(link.icon).digest("base64url").slice(0, 12);
  iconTags.set(link.id, { icon: link.icon, tag });
  return tag;
}

function publicLink(link) {
  // undefined means no icon has ever been fetched for this link, and the
  // client tells that apart from "" — fetched, and the site had none — to
  // decide what still needs asking. A record with no icon key is already the
  // first of those, so it goes through untouched.
  if (link.icon === undefined) {
    return link;
  }

  return {
    ...link,
    icon: link.icon ? `/api/links/${encodeURIComponent(link.id)}/icon?v=${iconTag(link)}` : ""
  };
}

function publicLinks(links) {
  return links.map(publicLink);
}

/* The bytes themselves.
 *
 * Behind requireRead like everything else: the addresses someone keeps are as
 * much a part of a private library as the documents are.
 */
app.get("/api/links/:id/icon", requireRead, (req, res, next) => {
  try {
    const link = linkStore.find(String(req.params.id || ""));
    if (!link || !link.icon) {
      res.status(404).json({ error: "No icon for that link." });
      return;
    }

    const match = /^data:([a-z0-9/+.-]+);base64,(.*)$/i.exec(link.icon);
    if (!match) {
      res.status(404).json({ error: "No icon for that link." });
      return;
    }

    // The tag is ours rather than one derived from the response body, so it
    // is the same value the address already carries. Answering a matching
    // If-None-Match with a 304 is then res.send()'s own job, which it does
    // once an ETag is set.
    res.setHeader("ETag", `"${iconTag(link)}"`);
    // Private, because the library is. A year is safe because the address
    // carries the hash: different bytes are a different address.
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");

    const body = Buffer.from(match[2], "base64");
    res.type(match[1]).send(body);
  } catch (error) {
    next(error);
  }
});

app.get("/api/links", requireRead, (req, res) => {
  // Groups travel with the list rather than on their own route: the chip bar is
  // derived from the links, so a second request could only ever disagree.
  res.json({ links: publicLinks(linkStore.list()), groups: linkStore.groups() });
});

app.post("/api/links", requirePermission("doc:write"), async (req, res, next) => {
  try {
    if (!throttleLinkFetch(req, res)) {
      return;
    }

    const preview = await linkPreview.describeUrl(req.body?.url);
    const link = await linkStore.withLock(() => linkStore.create(preview, {
      createdBy: req.auth?.user?.username || null,
      note: req.body?.note,
      groups: req.body?.groups
    }));

    res.status(201).json({ link: publicLink(link), groups: linkStore.groups() });
  } catch (error) {
    if (error instanceof linkPreview.LinkPreviewError || error.status) {
      res.status(error.status || 400).json({ error: error.message, existingId: error.existingId });
      return;
    }

    next(error);
  }
});

// Editing the card by hand, and re-reading the page, are the same route: both
// are "change what this card says". `refresh: true` asks for the second.
app.patch("/api/links/:id", requirePermission("doc:write"), async (req, res, next) => {
  try {
    const link = linkStore.find(String(req.params.id || ""));
    if (!link) {
      res.status(404).json({ error: "No such link." });
      return;
    }

    let changes = {
      title: req.body?.title,
      description: req.body?.description,
      note: req.body?.note,
      groups: req.body?.groups
    };

    if (req.body?.refresh) {
      if (!throttleLinkFetch(req, res)) {
        return;
      }

      // Re-reading the page replaces what the page said. It must not touch how
      // the link was filed, so the groups are carried across explicitly.
      const preview = await linkPreview.describeUrl(link.url);
      changes = { ...preview, groups: req.body?.groups };
    }

    const updated = await linkStore.withLock(() => linkStore.update(link.id, changes));
    res.json({ link: publicLink(updated), groups: linkStore.groups() });
  } catch (error) {
    if (error instanceof linkPreview.LinkPreviewError || error.status) {
      res.status(error.status || 400).json({ error: error.message });
      return;
    }

    next(error);
  }
});

/* Icons for the links that have never had one fetched.
 *
 * A route rather than the client doing this a link at a time. Seven PATCHes
 * meant seven round trips, seven page reads and seven whole rewrites of
 * links.json with an fsync each, in a strict queue — the icons trickled in over
 * about ten seconds. Here the pages are read a few at a time and the file is
 * written once.
 *
 * It touches nothing but the icon. Re-reading a page also replaces its title
 * and description, which would quietly undo a title someone had corrected by
 * hand — and correcting a title is the one thing editing a card is for.
 */
const ICON_BATCH_CONCURRENCY = 4;

app.post("/api/links/icons", requirePermission("doc:write"), async (req, res, next) => {
  try {
    const pending = linkStore.needingIcons();

    // Bounded by what this account may still fetch this minute, so a large
    // library comes in over a few visits rather than half-failing on one.
    const budget = takeLinkFetchSlots(req, pending.length);
    const batch = pending.slice(0, budget);

    if (batch.length === 0) {
      res.json({ links: publicLinks(linkStore.list()), groups: linkStore.groups(), fetched: 0, remaining: pending.length });
      return;
    }

    const queue = [...batch];
    const answers = [];

    const worker = async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        const link = linkStore.find(id);
        if (!link) {
          continue;
        }

        answers.push({ id, icon: await linkPreview.iconForUrl(link.url) });
      }
    };

    await Promise.all(Array.from({ length: ICON_BATCH_CONCURRENCY }, worker));
    await linkStore.withLock(() => linkStore.setIcons(answers));

    res.json({
      links: publicLinks(linkStore.list()),
      groups: linkStore.groups(),
      fetched: answers.filter((answer) => answer.icon).length,
      remaining: linkStore.needingIcons().length
    });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/links/:id", requirePermission("doc:write"), async (req, res, next) => {
  try {
    const removed = await linkStore.withLock(() => linkStore.remove(String(req.params.id || "")));
    if (!removed) {
      res.status(404).json({ error: "No such link." });
      return;
    }

    res.json({ removed: true, groups: linkStore.groups() });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// User administration
// ---------------------------------------------------------------------------

app.use(createUserRoutes({ authStore, roles: ROLES, requirePermission }));

/* Which documents a search covers. Scoring them is lib/docs/search.js; picking
 * the corpus is here, because it is the storage layout that decides it.
 */
async function searchDocuments(query, scope = "docs") {
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

  return searchIn({ query, docs, scopeDir });
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
    faviconUrl: toAbsoluteUrl(baseUrl, FAVICON_PATH),
    appleTouchIconUrl: toAbsoluteUrl(baseUrl, APPLE_TOUCH_ICON_PATH),
    iconUrl: toAbsoluteUrl(baseUrl, ICON_PATH),
    // Absolute, because a crawler resolves og:image against nothing.
    imageUrl: toAbsoluteUrl(baseUrl, EMBED_IMAGE_PATH),
    imageWidth: EMBED_IMAGE_WIDTH,
    imageHeight: EMBED_IMAGE_HEIGHT,
    imageAlt: EMBED_IMAGE_ALT,
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
    __EMBED_FAVICON_URL__: embedMeta.faviconUrl,
    __EMBED_APPLE_TOUCH_ICON_URL__: embedMeta.appleTouchIconUrl,
    __EMBED_IMAGE_URL__: embedMeta.imageUrl,
    __EMBED_IMAGE_WIDTH__: embedMeta.imageWidth,
    __EMBED_IMAGE_HEIGHT__: embedMeta.imageHeight,
    __EMBED_IMAGE_ALT__: embedMeta.imageAlt,
    __EMBED_THEME_COLOR__: embedMeta.themeColor,
    __EMBED_OEMBED_URL__: embedMeta.oEmbedUrl
  };

  return fillTemplate(htmlTemplate, replacements);
}

/* What an error looks like is decided in lib/http/errors.js. Everything it
   cannot know on its own — where the template is, what the site is called,
   which origin to build links against, which of the two upload limits a 413
   is about — is handed over once, here.
   --------------------------------------------------------------------------- */

const { sendError, notFound, errorHandler } = createErrorPages({
  templatePath: ERROR_TEMPLATE_PATH,
  siteName: SITE_NAME,
  faviconPath: FAVICON_PATH,
  themeColor: EMBED_THEME_COLOR,
  getBaseUrl: getBaseUrlFromRequest,
  maxDocBytes: MAX_DOC_BYTES,
  maxAssetBytes: MAX_ASSET_BYTES
});

const getShareTemplate = templateReader(SHARE_TEMPLATE_PATH);

function renderShareHtml(template, {
  title,
  description,
  baseUrl,
  shareUrl = "",
  modifiedAt = ""
}) {
  const replacements = {
    // The browser tab keeps the site name for context; og:title does not,
    // because the unfurl already shows og:site_name on its own line.
    __SHARE_TITLE__: `${title} | ${SITE_NAME}`,
    __SHARE_OG_TITLE__: title,
    __SHARE_DESCRIPTION__: description,
    __SHARE_URL__: shareUrl || toAbsoluteUrl(baseUrl, "/"),
    __SHARE_SITE_NAME__: SITE_NAME,
    __SHARE_AUTHOR__: EMBED_AUTHOR_NAME,
    __SHARE_MODIFIED__: modifiedAt,
    __SHARE_FAVICON_URL__: toAbsoluteUrl(baseUrl, FAVICON_PATH),
    __SHARE_APPLE_TOUCH_ICON_URL__: toAbsoluteUrl(baseUrl, APPLE_TOUCH_ICON_PATH),
    __SHARE_IMAGE_URL__: toAbsoluteUrl(baseUrl, EMBED_IMAGE_PATH),
    __SHARE_IMAGE_WIDTH__: EMBED_IMAGE_WIDTH,
    __SHARE_IMAGE_HEIGHT__: EMBED_IMAGE_HEIGHT,
    __SHARE_IMAGE_ALT__: EMBED_IMAGE_ALT,
    __SHARE_THEME_COLOR__: EMBED_THEME_COLOR
  };

  return fillTemplate(template, replacements);
}

const graphQLSchema = buildSchema(`
  type EmbedMeta {
    title: String!
    description: String!
    siteName: String!
    canonicalUrl: String!
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

// A health check a process manager or uptime monitor can actually use. The
// GraphQL `health` field returns a constant string and so only proves the
// process is up; this proves the storage the app depends on is readable, which
// is the failure that matters. Returns 503 when it is not, so a monitor sees a
// failure rather than a cheerful 200.
app.get("/healthz", async (req, res) => {
  const startedAt = Date.now();

  try {
    const docs = await getDocs();
    res.json({
      status: "ok",
      uptimeSeconds: Math.round(process.uptime()),
      documents: docs.length,
      checkMs: Date.now() - startedAt
    });
  } catch (error) {
    console.error("Health check failed", error);
    res.status(503).json({
      status: "unhealthy",
      error: "Document storage is not readable",
      checkMs: Date.now() - startedAt
    });
  }
});

app.get("/oembed", (req, res) => {
  const requestedUrl = typeof req.query.url === "string" ? req.query.url.trim() : "";
  const embedMeta = buildEmbedMeta(req, requestedUrl);

  res.json({
    version: "1.0",
    type: "link",
    provider_name: embedMeta.siteName,
    provider_url: embedMeta.baseUrl,
    author_name: EMBED_AUTHOR_NAME,
    author_url: embedMeta.baseUrl,
    title: embedMeta.title,
    url: embedMeta.canonicalUrl,
    // The raster icon, not the favicon: a consumer of this is an unfurler, and
    // an unfurler that is handed an SVG shows nothing.
    thumbnail_url: embedMeta.iconUrl,
    thumbnail_width: 512,
    thumbnail_height: 512,
    cache_age: 3600
  });
});

// The standalone share view. One document, no explorer, no editor, no way back
// into the library. noindex because "unguessable URL" stops being a control the
// moment a crawler files it.
// Everything a link preview needs about a shared document, derived from the
// document itself rather than from the app.
async function buildShareMeta(req, share) {
  const baseUrl = getBaseUrlFromRequest(req);
  const fullPath = path.join(MARKDOWN_DIR, share.file);
  const { content, stat } = await readCachedTextFile(fullPath);

  const fallbackTitle = toDocTitle(share.file);
  const title = excerpt.extractTitle(share.file, content, fallbackTitle);
  const description = excerpt.extractDescription(share.file, content, {
    title,
    siteName: SITE_NAME
  });

  return {
    title,
    description,
    baseUrl,
    content,
    updatedAt: stat.mtime.toISOString()
  };
}

app.get("/s/:token", async (req, res, next) => {
  try {
    const token = String(req.params.token || "");
    const share = shareStore.findByToken(token);

    if (!share || !(await fileExists(path.join(MARKDOWN_DIR, share.file)))) {
      // A revoked link must not keep describing what used to be behind it, so
      // this is the generic page — no title, no excerpt, no card.
      await sendError(req, res, 404, {
        heading: "This share link is not valid",
        message: "It may have been revoked, or the document behind it may have been deleted.",
        detail: "Ask whoever sent it for a new link."
      });
      return;
    }

    const template = await getShareTemplate();
    const meta = await buildShareMeta(req, share);
    const shareUrl = toAbsoluteUrl(meta.baseUrl, `/s/${token}`);

    res.set("X-Robots-Tag", "noindex, nofollow");
    res.type("html").send(renderShareHtml(template, {
      title: meta.title,
      description: meta.description,
      baseUrl: meta.baseUrl,
      shareUrl,
      modifiedAt: meta.updatedAt
    }));
  } catch (error) {
    next(error);
  }
});

/* The app shell.
 *
 * /links is here beside the root because the saved links are a place in this
 * app, not a mode it can be put into: typing the address, refreshing it or
 * opening a bookmark has to land there. Documents get their own shell route
 * further down, after the static files.
 */
app.get(["/", "/index.html", "/links"], async (req, res, next) => {
  try {
    const htmlTemplate = await getIndexTemplate();
    const embedMeta = buildEmbedMeta(req);
    const renderedHtml = renderIndexWithEmbedMeta(htmlTemplate, embedMeta);

    res.set("Cache-Control", "no-cache").type("html").send(renderedHtml);
  } catch (error) {
    next(error);
  }
});

app.get("/api/docs", requireRead, async (req, res, next) => {
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

app.get("/api/docs/search", requireRead, async (req, res, next) => {
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

app.get("/api/docs/*file", requireRead, async (req, res, next) => {
  try {
    const fileName = paramDocPath(req);
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

app.put("/api/docs/*file/folder", requirePermission("doc:write"), async (req, res, next) => {
  try {
    const fileName = paramDocPath(req);
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

    const targetPath = resolveDocPath(targetFile, MARKDOWN_DIR);
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
});

app.post("/api/folders", requirePermission("doc:write"), async (req, res, next) => {
  try {
    const folderName = normalizeFolderName(req.body?.name);
    if (!folderName || !sanitizePathSegment(folderName)) {
      // A folder is a directory now, so its name has to survive being one:
      // no leading dot, no trailing dot or space, not a reserved device name.
      res.status(400).json({ error: "Invalid folder name" });
      return;
    }

    // An absent parentId means top level, which keeps the old request shape working.
    const parentId = req.body?.parentId === undefined || req.body?.parentId === null
      ? null
      : normalizeFolderId(req.body.parentId);

    if (req.body?.parentId && !parentId) {
      res.status(400).json({ error: "Invalid parent folder id" });
      return;
    }

    const { organizer: savedOrganizer, result: folder } = await mutateOrganizerState((organizer) => {
      if (parentId && !organizer.folders.some((entry) => entry.id === parentId)) {
        throw new HttpError(404, "Parent folder not found");
      }

      if (parentId && getFolderDepth(organizer.folders, parentId) + 1 > MAX_FOLDER_DEPTH) {
        throw new HttpError(400, `Folders cannot nest deeper than ${MAX_FOLDER_DEPTH} levels`);
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
    await fsp.mkdir(path.join(MARKDOWN_DIR, folderDirFor(savedOrganizer, folder.id)), { recursive: true });

    res.status(201).json({
      folder: serializeFolders([folder], savedOrganizer.folders)[0],
      folders: serializeFolders(savedOrganizer.folders)
    });
  } catch (error) {
    next(error);
  }
});

// Folder order was previously write-once at creation time. This lets the caller
// hand back the ids in the order it wants; any folder omitted keeps its relative
// position after the listed ones, so a partial list can never drop a folder.
/* There is no reorder endpoint any more.
 *
 * Folders and documents are listed alphabetically, so a stored position cannot
 * change what anyone sees. `order` is still written when a folder is created,
 * because the organizer's shape is otherwise unchanged and a field nothing
 * reads is cheaper than another format change so soon after the last one.
 */

app.put("/api/folders/:folderId", requirePermission("doc:write"), async (req, res, next) => {
  try {
    const normalizedFolderId = normalizeFolderId(req.params.folderId);
    if (!normalizedFolderId) {
      res.status(400).json({ error: "Invalid folder id" });
      return;
    }

    const wantsRename = req.body?.name !== undefined;
    const wantsReparent = Object.prototype.hasOwnProperty.call(req.body || {}, "parentId");

    if (!wantsRename && !wantsReparent) {
      res.status(400).json({ error: "Provide a name, a parentId, or both" });
      return;
    }

    const folderName = wantsRename ? normalizeFolderName(req.body.name) : null;
    if (wantsRename && (!folderName || !sanitizePathSegment(folderName))) {
      res.status(400).json({ error: "Invalid folder name" });
      return;
    }

    const nextParentId = wantsReparent && req.body.parentId
      ? normalizeFolderId(req.body.parentId)
      : null;

    if (wantsReparent && req.body.parentId && !nextParentId) {
      res.status(400).json({ error: "Invalid parent folder id" });
      return;
    }

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

        if (getFolderDepth(organizer.folders, parentId) + 1 + subtreeDepth > MAX_FOLDER_DEPTH) {
          throw new HttpError(400, `Folders cannot nest deeper than ${MAX_FOLDER_DEPTH} levels`);
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
      const from = path.join(MARKDOWN_DIR, previousDir);
      const to = path.join(MARKDOWN_DIR, nextDir);

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
});

app.delete("/api/folders/:folderId", requirePermission("doc:write"), async (req, res, next) => {
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
    // base, which is MARKDOWN_DIR here — so these already carry the folder.
    for (const from of await walkDocs(MARKDOWN_DIR, rootDir)) {
      const wanted = docBaseOf(from);
      const targetName = await ensureUniqueFilenameInDir(MARKDOWN_DIR, wanted);

      await moveFile(path.join(MARKDOWN_DIR, from), path.join(MARKDOWN_DIR, targetName));
      invalidateCachedContent(path.join(MARKDOWN_DIR, from));
      await shareStore.withLock(() => shareStore.rename(from, targetName));
      rescued.push(targetName);
    }

    if (rootDir) {
      await fsp.rm(path.join(MARKDOWN_DIR, rootDir), { recursive: true, force: true });
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
});

app.post("/api/docs/*file/delete", requirePermission("doc:write"), async (req, res, next) => {
  try {
    const fileName = paramDocPath(req);
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

    // A deleted document must stop being publicly readable. Leaving the share
    // alive would keep it served to anyone holding the URL.
    await shareStore.withLock(() => shareStore.revoke(fileName));

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

app.get("/api/recycle-bin", requireRead, async (req, res, next) => {
  try {
    const organizer = await readOrganizerState();
    const docs = await getRecycleDocs(organizer);
    res.json({ docs });
  } catch (error) {
    next(error);
  }
});

app.get("/api/recycle-bin/*entry/content", requireRead, async (req, res, next) => {
  try {
    const entryName = paramEntryPath(req);
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

app.post("/api/recycle-bin/*entry/restore", requirePermission("doc:write"), async (req, res, next) => {
  try {
    const entryName = paramEntryPath(req);
    if (!entryName) {
      res.status(400).json({ error: "Invalid recycle bin entry" });
      return;
    }

    const restored = await restoreFromBin(DELETED_SOFT_DIR, entryName);
    if (!restored) {
      res.status(404).json({ error: "Recycle bin document not found" });
      return;
    }

    res.json({
      ...restored
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/recycle-bin/*entry/hard-delete", requirePermission("doc:write"), async (req, res, next) => {
  try {
    const entryName = paramEntryPath(req);
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

app.get("/api/archive", requireRead, async (req, res, next) => {
  try {
    const organizer = await readOrganizerState();
    const docs = await getRecycleDocs(organizer, DELETED_HARD_DIR);
    res.json({ docs });
  } catch (error) {
    next(error);
  }
});

app.get("/api/archive/*entry/content", requireRead, async (req, res, next) => {
  try {
    const entryName = paramEntryPath(req);
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

app.post("/api/archive/*entry/restore", requirePermission("doc:write"), async (req, res, next) => {
  try {
    const entryName = paramEntryPath(req);
    if (!entryName) {
      res.status(400).json({ error: "Invalid archive entry" });
      return;
    }

    const restored = await restoreFromBin(DELETED_HARD_DIR, entryName);
    if (!restored) {
      res.status(404).json({ error: "Archived document not found" });
      return;
    }

    res.json(restored);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/archive/*entry", requirePermission("doc:erase"), async (req, res, next) => {
  try {
    const entryName = paramEntryPath(req);
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
app.post("/api/docs", requirePermission("doc:write"), async (req, res, next) => {
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

    const placement = await resolveNewDocumentPath(fileName, req.body.folderId);
    const fullPath = resolveDocPath(placement.file, MARKDOWN_DIR);
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
});

app.put("/api/docs/*file", requirePermission("doc:write"), async (req, res, next) => {
  try {
    const fileName = paramDocPath(req);
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

app.post("/api/docs/*file/rename", requirePermission("doc:write"), async (req, res, next) => {
  try {
    const fileName = paramDocPath(req);
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

    const targetPath = resolveDocPath(targetFile, MARKDOWN_DIR);
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
});

app.post("/api/docs/upload", requirePermission("doc:write"), upload.single("markdownFile"), async (req, res, next) => {
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

    // Single-file upload lands in the chosen folder's directory, and only has
    // to avoid names already in that one folder.
    const placement = await resolveNewDocumentPath(sanitizedName, req.body.folderId);
    const finalName = await ensureUniqueFilename(placement.file);
    const fullPath = resolveDocPath(finalName, MARKDOWN_DIR);
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
});

app.use(createAssetRoutes({
  assetsDir: ASSETS_DIR,
  markdownDir: MARKDOWN_DIR,
  requireRead,
  requirePermission,
  shareStore,
  fileExists,
  readCachedTextFile
}));

/* ---------------------------------------------------------------------------
   Folder upload

   The browser knows each picked file's path within the chosen folder
   (webkitRelativePath). Those paths are sent as an explicit `paths` field —
   a JSON array, index-aligned with the files — rather than smuggled in as the
   multipart filename, because whether a filename survives with its slashes
   intact varies by client and is not worth depending on.

   Every segment is attacker-controlled. This rebuilds the tree from sanitised
   names only and never joins a client string onto a filesystem path. Documents
   stay flat on disk — the folder tree lives in the organizer — so a traversal
   attempt has nowhere to go even if it got through. It is rejected anyway, on
   the principle that the second lock is the one that matters.
   --------------------------------------------------------------------------- */

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

app.post(
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

      if (baseDepth + deepest > MAX_FOLDER_DEPTH) {
        res.status(400).json({
          error: `That folder nests deeper than ${MAX_FOLDER_DEPTH} levels. Upload a subfolder instead.`,
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
        const targetDir = path.join(MARKDOWN_DIR, dir);
        await fsp.mkdir(targetDir, { recursive: true });

        // Unique within its own folder. Two READMEs from two uploaded folders
        // both keep their names — which is the point of the whole layout.
        const finalName = joinDocPath(dir, await ensureUniqueFilenameInDir(targetDir, entry.fileName));
        const fullPath = resolveDocPath(finalName, MARKDOWN_DIR);
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

// public/docs sits inside the static root, so express.static would happily
// serve every document as a plain file — straight past requireRead and past the
// share system. Documents are only ever available through the API.
app.use("/docs", (req, res, next) => {
  sendError(req, res, 404).catch(next);
});

// share.html is a template, not a page: served directly it is a shell full of
// __SHARE_*__ placeholders with no document behind it. It is only ever rendered
// by the /s/:token route.
// Both of these are templates, not pages: served directly they are shells full
// of __SHARE_*__ / __ERROR_*__ placeholders. They are only ever rendered by the
// routes that fill them in.
app.get(["/share.html", "/error.html"], (req, res, next) => {
  sendError(req, res, 404).catch(next);
});

app.use(express.static(PUBLIC_DIR, { index: false }));

/* The diagram editor, which is a page rather than a document.
 *
 * /diagram/doc/<path>#<block> is one mermaid fence inside a document, and
 * /diagram/file/<path> is a .mmd file that is all diagram. Both get the same
 * shell, and it goes and asks the API for the document as whoever is asking —
 * so this route, like the document shell below it, deliberately does not check
 * whether the document exists. Answering differently for a real path and an
 * imaginary one would tell anyone who asked exactly what is in the library.
 */
app.get(/^\/diagram\/(?:doc|file)\/.+$/, (req, res, next) => {
  res.set("Cache-Control", "no-cache").sendFile(DIAGRAM_TEMPLATE_PATH, (error) => {
    if (error) {
      next(error);
    }
  });
});

/* A document has a real address.
 *
 * Opening one used to put it in the fragment — /#Notes/day-one.md — which meant
 * the address bar showed something no server ever saw, and a link pasted to
 * someone else worked only because the client picked the fragment back up. Now
 * the URL is the path: /Notes/day-one.md, pushed as you navigate and served
 * here when it is typed, refreshed or opened from a link.
 *
 * This sits after express.static so a real file always wins, and it answers
 * with the app shell rather than the document: which documents exist, and what
 * is in them, is the API's business and stays behind the session.
 *
 * It deliberately does NOT check whether the document exists. Serving the shell
 * for a real path and a 404 for an imaginary one would tell anyone who asked —
 * signed in or not — exactly which documents are in the library, which is the
 * one thing the whole read guard exists to prevent. So every document-shaped
 * path gets the same answer, and the client says "not found" after it asks the
 * API as itself.
 */
const SHELL_RESERVED_PREFIXES = ["/api", "/s/", "/docs", "/oembed", "/graphql", "/healthz", "/diagram"];

function wantsDocumentShell(req) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return false;
  }

  // An unfurler or a fetch() asking for JSON should not be handed a page.
  if (!req.accepts("html")) {
    return false;
  }

  const pathname = req.path;
  if (SHELL_RESERVED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix))) {
    return false;
  }

  let decoded = "";
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // A malformed escape is not a document name.
    return false;
  }

  const wanted = decoded.replace(/^\/+/, "");

  // Only what this app could actually be holding. Anything else is a typo and
  // deserves the error page rather than an app shell that will not find it.
  if (!ALLOWED_DOC_EXTENSIONS.has(path.extname(wanted).toLowerCase())) {
    return false;
  }

  // And only a name the API could serve. A path with traversal, an empty
  // segment or a hidden directory in it is not a document this app will ever
  // open, so it should not get a shell that goes looking for one — one rule
  // for what a document path is, not two.
  return sanitizeDocPath(wanted) === wanted;
}

app.use(async (req, res, next) => {
  if (!wantsDocumentShell(req)) {
    next();
    return;
  }

  try {
    const htmlTemplate = await getIndexTemplate();
    res.set("Cache-Control", "no-cache")
      .type("html")
      .send(renderIndexWithEmbedMeta(htmlTemplate, buildEmbedMeta(req)));
  } catch (error) {
    next(error);
  }
});

app.use(notFound());
app.use(errorHandler());

// Shutdown has to be graceful because organizer writes are read-modify-write
// behind a lock: killing the process mid-write is exactly the corruption that
// used to wipe every folder assignment. Stop accepting connections, let the
// in-flight requests finish, then exit.
const SHUTDOWN_GRACE_MS = 10000;

function attachGracefulShutdown(server) {
  let shuttingDown = false;

  const shutdown = (signal) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.log(`${signal} received, finishing in-flight requests...`);

    // Anything already connected gets to finish; nothing new is accepted.
    server.close((error) => {
      if (error) {
        console.error("Error while closing the server", error);
        process.exit(1);
      }

      console.log("Shutdown complete.");
      process.exit(0);
    });

    // A hung request must not hold the process open forever. Unref so this
    // timer is not itself a reason to stay alive.
    setTimeout(() => {
      console.error(`Did not shut down within ${SHUTDOWN_GRACE_MS}ms, exiting anyway.`);
      process.exit(1);
    }, SHUTDOWN_GRACE_MS).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

async function bootstrap() {
  await ensureStorageDirs();

  const migration = await migrateFlatLibraryToDirectories();
  if (migration.moved > 0 || migration.skipped.length > 0) {
    console.log(`  Moved ${migration.moved} document(s) into ${migration.folders} folder director${migration.folders === 1 ? "y" : "ies"}.`);
    for (const note of migration.skipped) {
      console.log(`  Left in place: ${note}`);
    }
  }

  await authStore.load();
  await shareStore.load();
  await linkStore.load();

  const seeded = await authStore.seedAdminIfEmpty();

  const server = app.listen(PORT, () => {
    console.log(`AzaDocs running on http://localhost:${PORT}`);
    console.log(PUBLIC_READS
      ? "  Reads are PUBLIC (PUBLIC_READS=true). Anyone can read every document."
      : "  Reads require a session. Individual documents can still be shared by link.");

    if (seeded) {
      console.log("");
      console.log("  No accounts existed, so an admin was created:");
      console.log("");
      console.log(`      username: ${SEED_ADMIN_USERNAME}`);
      console.log(`      password: ${SEED_ADMIN_PASSWORD}`);
      console.log("");
      console.log("  This password is in the source and the README, so it is public");
      console.log("  knowledge. You will be required to change it at first login.");
      console.log("");
    }
  });

  attachGracefulShutdown(server);
}

bootstrap()
  .catch((error) => {
    console.error("Failed to start server", error);
    process.exit(1);
  });
