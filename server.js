const express = require("express");
const path = require("path");
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
const excerpt = require("./lib/excerpt");
const {
  ALLOWED_DOC_EXTENSIONS,
  MAX_FOLDER_DEPTH,
  sanitizeDocPath,
  paramDocPath,
  paramEntryPath,
  toDocTitle
} = require("./lib/docs/paths");
const { securityHeaders } = require("./lib/http/headers");
const { requestLogger } = require("./lib/http/logging");
const { templateReader, fillTemplate } = require("./lib/http/html");
const { isAbsoluteHttpUrl, toAbsoluteUrl, createBaseUrlResolver } = require("./lib/http/urls");
const { createErrorPages } = require("./lib/http/errors");
const { createGuards } = require("./lib/guards");
const {
  createOrganizerFile
} = require("./lib/docs/organizer");
const { createSearch } = require("./lib/docs/search");
const { createDocumentCache } = require("./lib/docs/content");
const { createDocumentStore } = require("./lib/docs/store");
const { createAssetRoutes, MAX_ASSET_BYTES } = require("./lib/routes/assets");
const { createAuthRoutes } = require("./lib/routes/auth");
const { createUserRoutes } = require("./lib/routes/users");
const { createSharesRoutes } = require("./lib/routes/shares");
const { createLinksRoutes } = require("./lib/routes/links");
const { createFoldersRoutes } = require("./lib/routes/folders");
const { createRecycleRoutes } = require("./lib/routes/recycle");
const { createDocsRoutes } = require("./lib/routes/docs");
const { createUploadRoutes } = require("./lib/routes/upload");

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

app.use(createSharesRoutes({
  markdownDir: MARKDOWN_DIR,
  shareStore,
  requirePermission,
  getBaseUrl: getBaseUrlFromRequest,
  fileExists,
  readCachedTextFile,
  paramDocPath,
  toDocTitle
}));

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

app.use(createLinksRoutes({ linkStore, requireRead, requirePermission }));

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

app.use(createDocsRoutes({
  markdownDir: MARKDOWN_DIR,
  maxDocBytes: MAX_DOC_BYTES,
  requireRead,
  requirePermission,
  shareStore,
  readOrganizerState,
  getDocs,
  searchDocuments,
  resolveNewDocumentPath,
  fileExists,
  moveFile,
  ensureUniqueFilename,
  ensureUniqueFilenameInDir,
  readCachedTextFile,
  invalidateCachedContent,
  paramDocPath
}));

app.use(createFoldersRoutes({
  markdownDir: MARKDOWN_DIR,
  maxFolderDepth: MAX_FOLDER_DEPTH,
  requirePermission,
  shareStore,
  readOrganizerState,
  mutateOrganizerState,
  walkDocs,
  moveFile,
  ensureUniqueFilenameInDir,
  invalidateCachedContent,
  fileExists
}));

app.use(createRecycleRoutes({
  markdownDir: MARKDOWN_DIR,
  softDeletedDir: DELETED_SOFT_DIR,
  hardDeletedDir: DELETED_HARD_DIR,
  requireRead,
  requirePermission,
  shareStore,
  readOrganizerState,
  fileExists,
  moveFile,
  moveDocToRecycle,
  getRecycleDocs,
  restoreFromBin,
  ensureUniqueFilenameInDir,
  readCachedTextFile,
  invalidateCachedContent,
  paramDocPath,
  paramEntryPath
}));



app.use(createAssetRoutes({
  assetsDir: ASSETS_DIR,
  markdownDir: MARKDOWN_DIR,
  requireRead,
  requirePermission,
  shareStore,
  fileExists,
  readCachedTextFile
}));

app.use(createUploadRoutes({
  markdownDir: MARKDOWN_DIR,
  maxDocBytes: MAX_DOC_BYTES,
  maxFolderDepth: MAX_FOLDER_DEPTH,
  requirePermission,
  readOrganizerState,
  mutateOrganizerState,
  ensureUniqueFilenameInDir,
  invalidateCachedContent
}));

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
