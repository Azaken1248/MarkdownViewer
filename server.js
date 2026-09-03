const express = require("express");
const path = require("path");

const {
  AuthStore,
  ROLES,
  SEED_ADMIN_USERNAME,
  SEED_ADMIN_PASSWORD
} = require("./lib/auth");
const { ShareStore } = require("./lib/shares");
const { LinkStore } = require("./lib/links");
const {
  MAX_FOLDER_DEPTH,
  paramDocPath,
  paramEntryPath,
  toDocTitle
} = require("./lib/docs/paths");
const { securityHeaders } = require("./lib/http/headers");
const { requestLogger } = require("./lib/http/logging");
const { templateReader } = require("./lib/http/html");
const { createBaseUrlResolver } = require("./lib/http/urls");
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

const {
  buildEmbedMeta,
  renderIndexWithEmbedMeta,
  renderShareHtml
} = createEmbed({ getBaseUrl: getBaseUrlFromRequest });

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

app.use(createMetaRoutes({
  buildEmbedMeta,
  getDocs,
  enableIntrospection: process.env.ENABLE_GRAPHQL_INTROSPECTION === "true"
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

app.use(createPagesRoutes({
  publicDir: PUBLIC_DIR,
  markdownDir: MARKDOWN_DIR,
  diagramTemplatePath: DIAGRAM_TEMPLATE_PATH,
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
