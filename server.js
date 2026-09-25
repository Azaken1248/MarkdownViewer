/* AzaDocs.
 *
 * This file is the assembly, and nothing else. It reads in one pass:
 *
 *   1. configuration — where state lives, what the limits are, which origin
 *      this is served from. The only place in the app that reads the
 *      environment.
 *   2. what the app is built out of — each module handed that configuration.
 *   3. middleware order, which is the one thing that has to be right here
 *      because it cannot be seen from any of the modules.
 *   4. the routes, mounted in the order a reader would want them.
 *   5. boot, including the migration that must finish before anything serves.
 *
 * Anything that decides something rather than wiring something belongs in
 * lib/: lib/docs for the library on disk, lib/http for the shapes a response
 * can take, lib/routes for the addresses, lib/guards.js for who may.
 */

const express = require("express");
const path = require("path");

const {
  AuthStore,
  ROLES,
  SEED_ADMIN_USERNAME
} = require("./lib/auth");
const { ShareStore } = require("./lib/shares");
const { LinkStore, publicLink } = require("./lib/links");
const {
  MAX_FOLDER_DEPTH,
  paramDocPath,
  paramEntryPath,
  toDocTitle,
  sanitizeDocPath
} = require("./lib/docs/paths");
const { securityHeaders } = require("./lib/http/headers");
const { requestLogger, requestIds, createLog } = require("./lib/http/logging");
const { createMetrics } = require("./lib/metrics");
const { templateReader } = require("./lib/http/html");
const { createBaseUrlResolver } = require("./lib/http/urls");
const { createErrorPages } = require("./lib/http/errors");
const { createLimiter, bySession, byAddress, isRead } = require("./lib/http/limiter");
const db = require("./lib/db");
const { createAssetVersions } = require("./lib/http/asset-versions");
const { createAudit } = require("./lib/audit");
const { createStaticAssets } = require("./lib/http/static-assets");
const { createBundles } = require("./lib/http/bundles");
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
const { createMetaRoutes } = require("./lib/routes/meta");
const { createPagesRoutes } = require("./lib/routes/pages");
const { createEmbed } = require("./lib/http/embed");
const {
  SITE_NAME,
  EMBED_THEME_COLOR,
  FAVICON_PATH
} = require("./lib/site");

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

/* How much of the API one caller may use in a minute. See lib/http/limiter.js
 * for what these are and are not: ceilings against a runaway, not the
 * boundary — that is the guards.
 *
 * The wide one counts state changes — POST, PUT, PATCH, DELETE — per account,
 * or per address for a request with no session. Not reads: the client reads a
 * great deal, including every document once to warm its search cache, and
 * that grows with the library. The reads that cost something get a bucket of
 * their own below; the rest come from a cache. The tight ones sit on the
 * routes that cost something — an upload held in memory, a search over the
 * index, a write that re-indexes — and on the two addresses anyone may ask.
 */
const RATE_WINDOW_MS = 60_000;
const RATE_API_PER_SESSION = 300;
const RATE_API_PER_ADDRESS = 60;
const RATE_UPLOADS_PER_SESSION = 30;
const RATE_WRITES_PER_SESSION = 120;
const RATE_SEARCHES_PER_SESSION = 240;
const RATE_PUBLIC_PER_ADDRESS = 60;

const INDEX_TEMPLATE_PATH = path.join(PUBLIC_DIR, "index.html");
const SHARE_TEMPLATE_PATH = path.join(PUBLIC_DIR, "share.html");
const ERROR_TEMPLATE_PATH = path.join(PUBLIC_DIR, "error.html");
const DIAGRAM_TEMPLATE_PATH = path.join(PUBLIC_DIR, "diagram.html");

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

/* The origins this deployment answers on, for the CSRF origin check.
 *
 * Configuration, not something the request gets a say in. The public base
 * URL is always one; ALLOWED_ORIGINS adds more, comma-separated, for a
 * deployment reached under more than one name; and loopback on this port is
 * always allowed, so working on localhost needs no setting — a page on
 * another site cannot have a loopback origin.
 */
const ALLOWED_ORIGINS = new Set(
  [
    process.env.PUBLIC_BASE_URL || DEFAULT_PUBLIC_BASE_URL,
    ...String(process.env.ALLOWED_ORIGINS || "").split(","),
    `http://localhost:${PORT}`,
    `http://127.0.0.1:${PORT}`
  ]
    .map((one) => {
      try {
        return new URL(String(one).trim()).origin;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
);

// Whether this deployment is reached over HTTPS. Derived from the public base
// URL rather than from the request, which an attacker controls. It decides two
// things: that the session cookie is Secure, so it does not travel in clear
// text on the first plain-HTTP request, and that HSTS is sent, which is what
// stops there being a plain-HTTP request at all after the first.
const COOKIES_SECURE = String(process.env.PUBLIC_BASE_URL || DEFAULT_PUBLIC_BASE_URL)
  .startsWith("https://");

app.use(securityHeaders({ secure: COOKIES_SECURE }));

// Logging is off entirely in the test suite (LOG_REQUESTS=false) to keep its
// output readable, and skips static assets unless LOG_STATIC=true.
const LOG_REQUESTS = String(process.env.LOG_REQUESTS || "true").toLowerCase() !== "false";
const LOG_STATIC = String(process.env.LOG_STATIC || "").toLowerCase() === "true";

/* One logger, made here and handed to whatever writes a line.
 *
 * text for a person reading `docker compose logs`, json for something
 * collecting it; LOG_LEVEL is how the volume comes down without a deploy.
 */
const log = createLog({
  level: String(process.env.LOG_LEVEL || "info").toLowerCase(),
  format: String(process.env.LOG_FORMAT || "text").toLowerCase()
});

/* Every request gets a name, before anything else can fail.
 *
 * First in the stack on purpose: a request that is refused by the rate limiter
 * or the body parser is exactly the one somebody will ask about, and it needs
 * the same id in the log as it got in its X-Request-Id header.
 */
app.use(requestIds({ trustProxy: Boolean(TRUST_PROXY) }));

// Counted whether or not it is logged: a static asset is not worth a line and
// is still worth a number. Scraped at /metrics below.
const metrics = createMetrics();

app.use(requestLogger({
  logStatic: LOG_STATIC,
  log: LOG_REQUESTS ? log : undefined,
  onFinished: (finished) => metrics.observe(finished)
}));

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

/* The metadata database. Opened before the stores, because each of them is a
 * view onto it rather than a file of its own — see lib/db.js for why.
 */
const metadata = db.open(DATA_DIR);

/* Where the security events go: sign-ins and their failures, lockouts,
 * permission denials, share links made and revoked, passwords changed,
 * accounts disabled, documents erased. One JSON line each, to
 * data/audit.jsonl unless AUDIT_LOG says otherwise. See lib/audit.js.
 */
const audit = createAudit({ dataDir: DATA_DIR });

const authStore = new AuthStore({ dataDir: DATA_DIR, db: metadata, audit });
const shareStore = new ShareStore({ dataDir: DATA_DIR, db: metadata });
const linkStore = new LinkStore({ dataDir: DATA_DIR, db: metadata });


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
  allowedOrigins: ALLOWED_ORIGINS,
  cookiesSecure: COOKIES_SECURE,
  audit
});

// Every request learns who it is from before any route runs; the guards decide
// what that means. CSRF is checked globally so a new route cannot forget it.
app.use(attachSession);
app.use(requireCsrf);

/* The ceilings, mounted here so that what is limited is answerable in one
 * place. Each is a path and a budget; the routers below know nothing of them.
 * After attachSession, so a signed-in caller is counted as an account rather
 * than as whichever address a household happens to share.
 */
const limitApi = createLimiter({
  name: "api", windowMs: RATE_WINDOW_MS, keyOf: bySession, skip: isRead,
  max: (req) => (req.auth?.user ? RATE_API_PER_SESSION : RATE_API_PER_ADDRESS)
});
const limitUploads = createLimiter({
  name: "uploads", windowMs: RATE_WINDOW_MS, max: RATE_UPLOADS_PER_SESSION, keyOf: bySession,
  message: "Too many uploads just now. Wait a minute and try again."
});
const limitWrites = createLimiter({
  name: "writes", windowMs: RATE_WINDOW_MS, max: RATE_WRITES_PER_SESSION, keyOf: bySession,
  message: "Too many saves just now. Wait a minute and try again."
});
const limitSearch = createLimiter({
  name: "search", windowMs: RATE_WINDOW_MS, max: RATE_SEARCHES_PER_SESSION, keyOf: bySession,
  message: "Too many searches just now. Wait a minute and try again."
});
// /healthz needs no session and is keyed by the only thing such a request
// has, where it came from; a monitor polling every ten seconds uses a tenth of
// this. /graphql needs a session now, but stays here by address: it is the
// endpoint a script hits in a loop, and a script is one address.
const limitPublic = createLimiter({
  name: "public", windowMs: RATE_WINDOW_MS, max: RATE_PUBLIC_PER_ADDRESS, keyOf: byAddress
});

app.use("/api", limitApi);
app.post(["/api/docs/upload", "/api/upload/folder", "/api/assets"], limitUploads);
app.post("/api/docs", limitWrites);
app.put("/api/docs/*file", limitWrites);
app.get("/api/docs/search", limitSearch);
// /metrics is here too: it wants a token, and a ceiling per address is what
// keeps somebody from guessing at that token as fast as the network allows.
app.use(["/healthz", "/graphql", "/metrics"], limitPublic);

// ---------------------------------------------------------------------------
// What the app is built out of
//
// Each of these is a module handed the configuration above: the folder file,
// the three caches, the library on disk, the scoring, the error pages, the
// embed metadata. None of them reads the environment — everything they need
// was decided at the top of this file — and none of them knows what a route is.
// ---------------------------------------------------------------------------

const {
  readOrganizerState,
  mutateOrganizerState
} = createOrganizerFile({ filePath: ORGANIZER_FILE_PATH, db: metadata });

const {
  readCachedTextFile,
  readSearchIndexEntry,
  readSnippetSource,
  invalidateCachedContent,
  cacheStats
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
  db: metadata,
  readSearchIndexEntry,
  readSnippetSource,
  // What the index reads a changed document with. Through the content cache,
  // so a document just opened is not read a second time to be indexed.
  readContent: async (fullPath) => (await readCachedTextFile(fullPath)).content,
  resultLimit: SEARCH_RESULT_LIMIT
});

/* The `?v=` on every script and stylesheet, taken from the file's own bytes.
 *
 * The pages name their assets without a version; this puts the current one on
 * as they are served, and the static route below trusts a version that matches
 * far enough to call the answer immutable.
 */
const assetVersions = createAssetVersions({ publicDir: PUBLIC_DIR });

// The same files, compressed and kept. Sits in front of express.static and
// answers only for /css and /js; everything else falls through untouched.
const serveStaticAsset = createStaticAssets({ publicDir: PUBLIC_DIR, assetVersions });

/* One script tag in place of the run a page names, when a build exists.
 *
 * Bundling first and stamping second, so what gets a version is the tag that
 * survives: the bundle if there is one, the individual scripts if not.
 */
const bundles = createBundles({ publicDir: PUBLIC_DIR });
const served = (page) => (html) => assetVersions.stamp(bundles.forPage(page)(html));

const getIndexTemplate = templateReader(INDEX_TEMPLATE_PATH, served("index"));
const getDiagramTemplate = templateReader(DIAGRAM_TEMPLATE_PATH, served("diagram"));

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

  return searchIn({ query, docs, scopeDir, scope });
}

const {
  buildEmbedMeta,
  renderIndexWithEmbedMeta,
  renderShareHtml
} = createEmbed({ getBaseUrl: getBaseUrlFromRequest });

/* What an error looks like is decided in lib/http/errors.js. Everything it
 * cannot know on its own — where the template is, what the site is called,
 * which origin to build links against, which of the two upload limits a 413
 * is about — is handed over once, here.
 */

const { sendError, notFound, errorHandler } = createErrorPages({
  log,
  templatePath: ERROR_TEMPLATE_PATH,
  stampAssetVersions: served("error"),
  siteName: SITE_NAME,
  faviconPath: FAVICON_PATH,
  themeColor: EMBED_THEME_COLOR,
  getBaseUrl: getBaseUrlFromRequest,
  maxDocBytes: MAX_DOC_BYTES,
  maxAssetBytes: MAX_ASSET_BYTES
});

const getShareTemplate = templateReader(SHARE_TEMPLATE_PATH, served("share"));

// ---------------------------------------------------------------------------
// The routes
//
// Order matters twice, and only twice: the pages come last because they answer
// anything left over, and the two error middlewares come after everything.
// Between the routers the addresses do not overlap, so their order is the order
// a reader would want them in.
// ---------------------------------------------------------------------------

app.use(createAuthRoutes({
  authStore,
  audit,
  requireAuth,
  sessionPayload,
  issueSessionCookie,
  clearSessionCookie
}));

app.use(createSharesRoutes({
  markdownDir: MARKDOWN_DIR,
  shareStore,
  audit,
  requirePermission,
  getBaseUrl: getBaseUrlFromRequest,
  fileExists,
  readCachedTextFile,
  paramDocPath,
  toDocTitle
}));

app.use(createLinksRoutes({ linkStore, requireRead, requirePermission }));

app.use(createUserRoutes({ authStore, roles: ROLES, requirePermission, audit }));

app.use(createMetaRoutes({
  buildEmbedMeta,
  getDocs,
  readOrganizerState,
  searchDocuments,
  requireRead,
  // A document by its path, read the way GET /api/docs/*file reads it — the
  // same sanitiser, the same cache — or null for a path that is not one.
  readDocument: async (file) => {
    const fileName = sanitizeDocPath(file);
    if (!fileName) {
      return null;
    }

    const fullPath = path.join(MARKDOWN_DIR, fileName);
    if (!(await fileExists(fullPath))) {
      return null;
    }

    const { content } = await readCachedTextFile(fullPath);
    return { file: fileName, content };
  },
  listLinks: () => linkStore.list().map(publicLink),
  enableIntrospection: process.env.ENABLE_GRAPHQL_INTROSPECTION === "true",
  // /metrics is 404 until METRICS_TOKEN is set, and then wants it. See
  // docs/OPERATIONS.md.
  metrics,
  metricsToken: String(process.env.METRICS_TOKEN || ""),
  cacheStats
}));

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
  audit,
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

app.use(createPagesRoutes({
  publicDir: PUBLIC_DIR,
  markdownDir: MARKDOWN_DIR,
  getDiagramTemplate,
  assetVersions,
  serveStaticAsset,
  shareStore,
  fileExists,
  readCachedTextFile,
  getBaseUrl: getBaseUrlFromRequest,
  getIndexTemplate,
  getShareTemplate,
  buildEmbedMeta,
  renderIndexWithEmbedMeta,
  renderShareHtml,
  sendError
}));

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

  // A scripted setup may supply the first admin's password; otherwise one is
  // made now and printed once, below, and nowhere else.
  const seeded = await authStore.seedAdminIfEmpty({
    password: process.env.SEED_ADMIN_PASSWORD || null
  });

  const server = app.listen(PORT, () => {
    console.log(`AzaDocs running on http://localhost:${PORT}`);

    /* Compress the scripts and stylesheets now rather than on the first
     * request. The port is already open, so this costs nobody a wait, and the
     * first visitor after a restart finds every file ready instead of paying
     * for full-quality brotli one file at a time.
     */
    void serveStaticAsset.warm().catch(() => {
      // A file that will not compress is served as itself. Not worth a line of
      // output at boot, and certainly not worth failing to start over.
    });
    console.log(PUBLIC_READS
      ? "  Reads are PUBLIC (PUBLIC_READS=true). Anyone can read every document."
      : "  Reads require a session. Individual documents can still be shared by link.");

    if (seeded) {
      console.log("");
      console.log("  No accounts existed, so an admin was created:");
      console.log("");
      console.log(`      username: ${SEED_ADMIN_USERNAME}`);
      if (seeded.password) {
        console.log(`      password: ${seeded.password}`);
        console.log("");
        console.log("  That password was generated just now and is printed here once.");
        console.log("  It is not stored anywhere in the clear. You will be required to");
        console.log("  change it at first login; if this line has gone to a log you do");
        console.log("  not control, do that soon.");
      } else {
        console.log("      password: (from SEED_ADMIN_PASSWORD)");
        console.log("");
        console.log("  You will be required to change it at first login.");
      }
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
