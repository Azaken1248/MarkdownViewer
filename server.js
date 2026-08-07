const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const crypto = require("crypto");
const { createHandler } = require("graphql-http/lib/use/express");
const { buildSchema, NoSchemaIntrospectionCustomRule } = require("graphql");

const {
  AuthStore,
  parseCookies,
  sessionCookieOptions,
  publicUser,
  permissionsFor,
  roleCan,
  ROLES,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  SEED_ADMIN_USERNAME,
  SEED_ADMIN_PASSWORD
} = require("./lib/auth");
const { ShareStore } = require("./lib/shares");
const excerpt = require("./lib/excerpt");

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
const DATA_DIR = path.join(STATE_DIR, "data");
const ORGANIZER_FILE_PATH = path.join(DATA_DIR, "document-organizer.json");
const DELETED_SOFT_DIR = path.join(DELETED_MARKDOWN_DIR, "soft");
const DELETED_HARD_DIR = path.join(DELETED_MARKDOWN_DIR, "hard");
const MAX_DOC_BYTES = 2 * 1024 * 1024;
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
const SHARE_TEMPLATE_PATH = path.join(PUBLIC_DIR, "share.html");
const ERROR_TEMPLATE_PATH = path.join(PUBLIC_DIR, "error.html");
const SITE_NAME = "AzaDocs";
const EMBED_TITLE = "AzaDocs";
const EMBED_DESCRIPTION = "A personal markdown library: browse, search and edit documents, with Mermaid diagrams and Jupyter notebooks rendered inline.";
// The dark canvas, which is the default theme. The old value was Catppuccin
// blue, left over from a palette the app no longer uses.
const EMBED_THEME_COLOR = "#06090a";
const EMBED_IMAGE_PATH = "/social-card.svg";
const FAVICON_PATH = "/favicon.svg";
const EMBED_AUTHOR_NAME = "Azaken1248";
// Where this actually lives. Canonical, og:*, and oEmbed URLs are built from
// this rather than from the request, so a spoofed Host header cannot redirect
// a link preview somewhere else. PUBLIC_BASE_URL overrides it — set it to
// http://localhost:4321 when working locally if you need the previews to point
// at your own machine.
const DEFAULT_PUBLIC_BASE_URL = "https://md.azaken.com";

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
//
// Running Python in notebooks costs three more allowances, all of them narrow:
//
//   'wasm-unsafe-eval'  lets WebAssembly be compiled. It does NOT enable
//                       eval() or new Function() — that would be
//                       'unsafe-eval', which is still refused.
//   connect-src cdn     Pyodide fetches its ~10MB runtime and any packages a
//                       cell imports at run time, over fetch() rather than
//                       <script>, so script-src does not cover it.
//   worker-src 'self'   the Python worker is our own file.
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://fonts.googleapis.com",
  "font-src 'self' data: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://cdn.jsdelivr.net",
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

// Request logging. One line per request, written when the response finishes so
// the status and duration are real rather than assumed.
//
// Static assets are skipped by default: they are the overwhelming majority of
// requests and drown out everything worth reading. LOG_STATIC=true includes
// them. LOG_REQUESTS=false turns logging off entirely, which is what the test
// suite uses to keep its output clean.
const LOG_REQUESTS = String(process.env.LOG_REQUESTS || "true").toLowerCase() !== "false";
const LOG_STATIC = String(process.env.LOG_STATIC || "").toLowerCase() === "true";
const STATIC_ASSET_PATTERN = /\.(?:css|js|svg|png|jpe?g|gif|ico|woff2?|map)$/i;

if (LOG_REQUESTS) {
  app.use((req, res, next) => {
    const startedAt = process.hrtime.bigint();

    res.on("finish", () => {
      if (!LOG_STATIC && STATIC_ASSET_PATTERN.test(req.path)) {
        return;
      }

      const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
      // Query strings can carry search terms, which are the contents of the
      // user's own documents. Log the path only.
      console.log(
        `${new Date().toISOString()} ${req.method} ${req.path} ${res.statusCode} ${ms.toFixed(1)}ms`
      );
    });

    next();
  });
}

// The envelope limit has to sit above MAX_DOC_BYTES, not equal it: JSON escaping
// inflates the payload, so a legal 2MB document arrives as a larger body. When the
// two were equal, express rejected the request before the app's own size check ran
// and the client saw a 500 instead of a 413. The doubled headroom covers escaping
// while still bounding how much a single request can buffer.
const JSON_BODY_LIMIT = MAX_DOC_BYTES * 2 + 64 * 1024;
app.use(express.json({ limit: JSON_BODY_LIMIT }));

// Every request learns who it is from before any route runs; the guards decide
// what that means. CSRF is checked globally so a new route cannot forget it.
app.use(attachSession);
app.use(requireCsrf);

let indexTemplateCache = null;
let indexTemplateCacheMtimeMs = 0;

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

// Cookies must be Secure in production or the session travels in clear text on
// the first plain-HTTP request. Derived from the public base URL rather than
// from the request, which an attacker controls.
const COOKIES_SECURE = String(process.env.PUBLIC_BASE_URL || DEFAULT_PUBLIC_BASE_URL)
  .startsWith("https://");

function currentSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (!token) {
    return null;
  }

  const session = authStore.getSession(token);
  if (!session) {
    return null;
  }

  const user = authStore.findById(session.userId);
  if (!user || user.disabled) {
    return null;
  }

  return { token, session, user };
}

// Populates req.auth for every request. Does not reject anything — that is the
// job of the guards below, so a route's requirements are visible at the route.
function attachSession(req, res, next) {
  const found = currentSession(req);
  req.auth = found
    ? { user: found.user, session: found.session, token: found.token }
    : null;
  next();
}

function requireAuth(req, res, next) {
  if (req.auth) {
    next();
    return;
  }

  res.status(401).json({ error: "Sign in to continue.", code: "auth_required" });
}

// A forced password change has to actually block things, or it is a suggestion.
// Everything except signing out, reading the session, and setting the new
// password is refused until it is done.
function passwordChangePending(req) {
  return Boolean(req.auth?.user?.mustChangePassword);
}

function refusePendingPasswordChange(res) {
  res.status(403).json({
    error: "Set a new password before continuing.",
    code: "password_change_required"
  });
}

function requireRead(req, res, next) {
  if (passwordChangePending(req)) {
    refusePendingPasswordChange(res);
    return;
  }

  if (PUBLIC_READS || req.auth) {
    next();
    return;
  }

  res.status(401).json({ error: "Sign in to continue.", code: "auth_required" });
}

function requirePermission(permission) {
  return function permissionGuard(req, res, next) {
    if (!req.auth) {
      res.status(401).json({ error: "Sign in to continue.", code: "auth_required" });
      return;
    }

    if (passwordChangePending(req)) {
      refusePendingPasswordChange(res);
      return;
    }

    if (!roleCan(req.auth.user.role, permission)) {
      // 403, not 401: the request was authenticated and is still not allowed,
      // and re-authenticating will not change that.
      res.status(403).json({
        error: "Your account does not have permission to do that.",
        code: "forbidden",
        required: permission
      });
      return;
    }

    next();
  };
}

// CSRF. SameSite=Strict already stops the browser sending the session cookie
// from another site, so this is the second lock: a token the page has to read
// out of its own session and echo back, which cross-origin script cannot do.
// The Origin check catches anything that gets past both.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function requireCsrf(req, res, next) {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  if (!req.auth) {
    // Unauthenticated writes are rejected by the auth guards; there is no
    // session-riding to protect against yet.
    next();
    return;
  }

  const origin = req.get("origin");
  if (origin) {
    const expected = getBaseUrlFromRequest(req);
    let sameOrigin = false;
    try {
      sameOrigin = new URL(origin).origin === new URL(expected).origin;
    } catch {
      sameOrigin = false;
    }

    // Behind a proxy the public origin and the request origin can legitimately
    // differ, so a mismatch only fails when the token also fails, below.
    if (!sameOrigin && !TRUST_PROXY) {
      res.status(403).json({ error: "Cross-origin request refused.", code: "csrf" });
      return;
    }
  }

  const provided = String(req.get("x-csrf-token") || "");
  const expected = String(req.auth.session.csrfToken || "");
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);

  if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    res.status(403).json({ error: "Session token missing or stale. Reload and try again.", code: "csrf" });
    return;
  }

  next();
}

function sessionPayload(req) {
  if (!req.auth) {
    return {
      authenticated: false,
      publicReads: PUBLIC_READS,
      user: null,
      permissions: [],
      csrfToken: null
    };
  }

  return {
    authenticated: true,
    publicReads: PUBLIC_READS,
    user: publicUser(req.auth.user),
    permissions: permissionsFor(req.auth.user.role),
    csrfToken: req.auth.session.csrfToken
  };
}


// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------

function issueSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions({
    secure: COOKIES_SECURE,
    maxAgeMs: SESSION_TTL_MS
  }));
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions({ secure: COOKIES_SECURE }));
}

app.get("/api/session", (req, res) => {
  res.json(sessionPayload(req));
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const username = String(req.body?.username || "");
    const password = String(req.body?.password || "");

    if (!username || !password) {
      res.status(400).json({ error: "Username and password are required." });
      return;
    }

    const result = await authStore.withLock(() => authStore.login(username, password, {
      userAgent: req.get("user-agent") || "",
      ip: req.ip || ""
    }));

    if (!result.ok) {
      if (result.retryAfterMs) {
        res.set("Retry-After", String(Math.ceil(result.retryAfterMs / 1000)));
      }

      res.status(result.status || 401).json({ error: result.error });
      return;
    }

    issueSessionCookie(res, result.token);
    // Per-request object, no other holder; the rule cannot see that.
    // eslint-disable-next-line require-atomic-updates
    req.auth = { user: authStore.findById(result.user.id), session: result.session, token: result.token };
    res.json(sessionPayload(req));
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", async (req, res, next) => {
  try {
    if (req.auth) {
      await authStore.withLock(() => authStore.destroySession(req.auth.token));
    }

    clearSessionCookie(res);
    // Per-request object, no other holder; the rule cannot see that.
    // eslint-disable-next-line require-atomic-updates
    req.auth = null;
    res.json(sessionPayload(req));
  } catch (error) {
    next(error);
  }
});

// Changing your own password revokes every session for the account, including
// this one, so a fresh session is issued for the browser that did it. Anything
// else would either log you out of your own tab or leave the old sessions live.
app.post("/api/auth/password", requireAuth, async (req, res, next) => {
  try {
    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "");

    const result = await authStore.withLock(async () => {
      const changed = await authStore.changeOwnPassword(req.auth.user.id, currentPassword, newPassword);
      if (!changed.ok) {
        return changed;
      }

      const issued = await authStore.createSession(authStore.findById(req.auth.user.id), {
        userAgent: req.get("user-agent") || "",
        ip: req.ip || ""
      });

      return { ok: true, token: issued.token, session: issued.session };
    });

    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }

    issueSessionCookie(res, result.token);
    req.auth = { user: authStore.findById(req.auth.user.id), session: result.session, token: result.token };
    res.json(sessionPayload(req));
  } catch (error) {
    next(error);
  }
});

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
app.post("/api/docs/:file/share", requirePermission("share:manage"), async (req, res, next) => {
  try {
    const fileName = sanitizeFilename(req.params.file);
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

app.delete("/api/docs/:file/share", requirePermission("share:manage"), async (req, res, next) => {
  try {
    const fileName = sanitizeFilename(req.params.file);
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
// User administration
// ---------------------------------------------------------------------------

app.get("/api/users", requirePermission("user:manage"), (req, res) => {
  res.json({ users: authStore.listUsers(), roles: ROLES });
});

app.post("/api/users", requirePermission("user:manage"), async (req, res, next) => {
  try {
    const result = await authStore.withLock(() => authStore.createUser({
      username: req.body?.username,
      password: String(req.body?.password || ""),
      role: req.body?.role || "viewer",
      // A password chosen by someone else is a password the account owner has
      // to replace before it means anything.
      mustChangePassword: req.body?.mustChangePassword !== false
    }));

    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.status(201).json({ user: result.user });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/users/:id", requirePermission("user:manage"), async (req, res, next) => {
  try {
    const targetId = String(req.params.id);

    // Self-demotion and self-disabling are how an admin locks themselves out
    // one click at a time. The last-admin guard in the store covers the case
    // where they are alone; this covers the case where they are not.
    if (targetId === req.auth.user.id && req.body?.role !== undefined && req.body.role !== "admin") {
      res.status(400).json({ error: "You cannot change your own role. Ask another admin." });
      return;
    }

    if (targetId === req.auth.user.id && req.body?.disabled === true) {
      res.status(400).json({ error: "You cannot disable your own account." });
      return;
    }

    const result = await authStore.withLock(() => authStore.updateUser(targetId, {
      role: req.body?.role,
      disabled: req.body?.disabled
    }));

    if (!result.ok) {
      res.status(result.error === "No such user." ? 404 : 400).json({ error: result.error });
      return;
    }

    res.json({ user: result.user });
  } catch (error) {
    next(error);
  }
});

app.post("/api/users/:id/password", requirePermission("user:manage"), async (req, res, next) => {
  try {
    const result = await authStore.withLock(() => authStore.resetPassword(
      String(req.params.id),
      String(req.body?.password || "")
    ));

    if (!result.ok) {
      res.status(result.error === "No such user." ? 404 : 400).json({ error: result.error });
      return;
    }

    res.json({ user: result.user });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/users/:id", requirePermission("user:manage"), async (req, res, next) => {
  try {
    if (String(req.params.id) === req.auth.user.id) {
      res.status(400).json({ error: "You cannot delete your own account." });
      return;
    }

    const result = await authStore.withLock(() => authStore.deleteUser(String(req.params.id)));
    if (!result.ok) {
      res.status(result.error === "No such user." ? 404 : 400).json({ error: result.error });
      return;
    }

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

async function ensureStorageDirs() {
  await fsp.mkdir(MARKDOWN_DIR, { recursive: true });
  await fsp.mkdir(DELETED_SOFT_DIR, { recursive: true });
  await fsp.mkdir(DELETED_HARD_DIR, { recursive: true });
  await fsp.mkdir(DATA_DIR, { recursive: true });
}

// v1 folders were a flat list. v2 adds `parentId`, and a v1 file loads cleanly
// because a missing parentId normalizes to null, which is exactly "top level".
const ORGANIZER_VERSION = 2;
// Depth is bounded so a pathological hierarchy cannot make rendering or path
// computation quadratic, and so the tree stays navigable in a 280px sidebar.
const MAX_FOLDER_DEPTH = 8;

function createDefaultOrganizerState() {
  return {
    version: ORGANIZER_VERSION,
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
        // Absent on v1 state, which is correct: those folders were all top level.
        parentId: normalizeFolderId(folder?.parentId),
        order: Number.isFinite(Number(folder?.order)) ? Number(folder.order) : index,
        createdAt,
        updatedAt
      };
    }).filter(Boolean)
    : [];

  sanitizeFolderHierarchy(folders);

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
    version: ORGANIZER_VERSION,
    folders,
    fileFolders
  };
}

// --- Folder hierarchy -----------------------------------------------------
// A parent reference is only ever dropped, never the folder itself: a folder
// whose parent vanished becomes top level rather than disappearing along with
// every document filed inside it.
function sanitizeFolderHierarchy(folders) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));

  for (const folder of folders) {
    if (folder.parentId && (folder.parentId === folder.id || !byId.has(folder.parentId))) {
      folder.parentId = null;
    }
  }

  // Break cycles by detaching whichever folder closes the loop. Hand-edited
  // state is the realistic source of these, and a cycle would hang the walk.
  for (const folder of folders) {
    const seen = new Set([folder.id]);
    let current = folder.parentId ? byId.get(folder.parentId) : null;

    while (current) {
      if (seen.has(current.id)) {
        current.parentId = null;
        break;
      }

      seen.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : null;
    }
  }

  // Anything nested past the cap is lifted to the top rather than rejected.
  for (const folder of folders) {
    let depth = 0;
    let current = folder.parentId ? byId.get(folder.parentId) : null;

    while (current && depth <= MAX_FOLDER_DEPTH) {
      depth += 1;
      current = current.parentId ? byId.get(current.parentId) : null;
    }

    if (depth > MAX_FOLDER_DEPTH) {
      folder.parentId = null;
    }
  }

  return folders;
}

function getFolderAncestry(folders, folderId) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const chain = [];
  let current = byId.get(folderId) || null;

  while (current && chain.length <= MAX_FOLDER_DEPTH + 1) {
    chain.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : null;
  }

  return chain;
}

function getFolderDepth(folders, folderId) {
  return Math.max(getFolderAncestry(folders, folderId).length - 1, 0);
}

function getFolderPath(folders, folderId) {
  return getFolderAncestry(folders, folderId).map((folder) => folder.name).join(" / ");
}

// True when `candidateId` is `ancestorId` or sits anywhere beneath it. This is
// what stops a folder being dragged into its own subtree.
function isFolderWithinSubtree(folders, candidateId, ancestorId) {
  if (!candidateId || !ancestorId) {
    return false;
  }

  return getFolderAncestry(folders, candidateId).some((folder) => folder.id === ancestorId);
}

function collectFolderSubtreeIds(folders, rootId) {
  const childrenByParent = new Map();
  for (const folder of folders) {
    const key = folder.parentId || "__root__";
    if (!childrenByParent.has(key)) {
      childrenByParent.set(key, []);
    }
    childrenByParent.get(key).push(folder);
  }

  const ids = [];
  const queue = [rootId];

  while (queue.length) {
    const current = queue.shift();
    ids.push(current);
    for (const child of childrenByParent.get(current) || []) {
      queue.push(child.id);
    }
  }

  return ids;
}

// Documents are sorted by their folder's position in a depth-first walk, so a
// flat list still comes back in the order the tree displays.
function buildFolderSortKeys(folders) {
  const keys = new Map();

  for (const folder of folders) {
    const key = getFolderAncestry(folders, folder.id)
      .map((entry) => String(entry.order ?? 0).padStart(6, "0"))
      .join(".");
    keys.set(folder.id, key);
  }

  return keys;
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
      // Worst case two concurrent readers each write a backup, which is
      // harmless; the original file is never touched either way.
      // eslint-disable-next-line require-atomic-updates
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
      folderPath: null,
      folderOrder: UNFILED_FOLDER_ORDER
    };
  }

  const folder = getFolderRecordById(organizerState, folderId);
  if (!folder) {
    return {
      folderId: null,
      folderName: null,
      folderPath: null,
      folderOrder: UNFILED_FOLDER_ORDER
    };
  }

  return {
    folderId: folder.id,
    folderName: folder.name,
    folderPath: getFolderPath(organizerState.folders, folder.id),
    folderOrder: Number.isFinite(Number(folder.order)) ? Number(folder.order) : Number.MAX_SAFE_INTEGER
  };
}

function serializeFolders(folders, allFolders = folders) {
  return folders.map((folder) => ({
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId || null,
    depth: getFolderDepth(allFolders, folder.id),
    path: getFolderPath(allFolders, folder.id),
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
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
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

  // Sorting on a folder's depth-first position keeps the flat list in the same
  // order the nested tree draws it; a bare `order` would interleave levels.
  const folderSortKeys = buildFolderSortKeys(organizer.folders);

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
        folderPath: folderInfo.folderPath,
        folderOrder: folderInfo.folderOrder,
        // Unfiled documents sort last, which is where Ungrouped renders.
        folderSortKey: folderInfo.folderId ? (folderSortKeys.get(folderInfo.folderId) || "") : "~"
      };
    })
  );

  docs.sort((a, b) => {
    if (a.folderSortKey !== b.folderSortKey) {
      return a.folderSortKey < b.folderSortKey ? -1 : 1;
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
    .replace(/"/g, "&quot;")
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

  // A known public origin beats anything derived from the request. This is the
  // strongest form of the host-header defence: there is no header to spoof.
  if (isAbsoluteHttpUrl(DEFAULT_PUBLIC_BASE_URL)) {
    return DEFAULT_PUBLIC_BASE_URL.replace(/\/+$/, "");
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

  // An idempotent read-through cache: concurrent misses both read the same
  // file and store the same string.
  // eslint-disable-next-line require-atomic-updates
  indexTemplateCache = await fsp.readFile(INDEX_TEMPLATE_PATH, "utf8");
  // eslint-disable-next-line require-atomic-updates
  indexTemplateCacheMtimeMs = stat.mtimeMs;
  return indexTemplateCache;
}

/* ---------------------------------------------------------------------------
   Error responses

   One place decides what an error looks like, and it depends on who is asking.
   An API client wants JSON; a person who mistyped a URL wants a page. Express's
   default for the second case is a bare `Cannot GET /nope` in Times New Roman.

   Nothing here reveals more than the reader already knows. A 500 says a 500
   happened; the stack goes to the log, not the page.
   --------------------------------------------------------------------------- */

const ERROR_PRESETS = {
  400: { icon: "ph-warning-circle", heading: "That request did not make sense", message: "Something about the address or the data sent with it was malformed." },
  401: { icon: "ph-lock-simple", heading: "You need to sign in", message: "This library is private. Sign in to continue." },
  403: { icon: "ph-prohibit", heading: "Not allowed", message: "Your account does not have permission to do that." },
  404: { icon: "ph-compass", heading: "There is nothing here", message: "The page you asked for does not exist, or the link that brought you here is no longer valid." },
  413: { icon: "ph-file-x", heading: "That file is too large", message: "Documents are limited to 2MB." },
  429: { icon: "ph-hourglass-medium", heading: "Too many attempts", message: "Wait a little while before trying again." },
  500: { icon: "ph-bug", heading: "Something went wrong on our side", message: "The error has been logged. Trying again is usually worth a shot." },
  503: { icon: "ph-plugs", heading: "Temporarily unavailable", message: "The server is up but something it depends on is not. Try again shortly." }
};

let errorTemplateCache = null;
let errorTemplateCacheMtimeMs = 0;

async function getErrorTemplate() {
  const stat = await fsp.stat(ERROR_TEMPLATE_PATH);
  if (errorTemplateCache !== null && errorTemplateCacheMtimeMs === stat.mtimeMs) {
    return errorTemplateCache;
  }

  // eslint-disable-next-line require-atomic-updates
  errorTemplateCache = await fsp.readFile(ERROR_TEMPLATE_PATH, "utf8");
  // eslint-disable-next-line require-atomic-updates
  errorTemplateCacheMtimeMs = stat.mtimeMs;
  return errorTemplateCache;
}

function renderErrorHtml(template, { status, heading, message, detail, icon, baseUrl }) {
  const replacements = {
    __ERROR_STATUS__: String(status),
    __ERROR_TITLE__: `${status} · ${heading} | ${SITE_NAME}`,
    __ERROR_HEADING__: heading,
    __ERROR_MESSAGE__: message,
    __ERROR_DETAIL__: detail || "",
    __ERROR_ICON__: icon,
    __ERROR_FAVICON_URL__: toAbsoluteUrl(baseUrl, FAVICON_PATH),
    __ERROR_THEME_COLOR__: EMBED_THEME_COLOR
  };

  let rendered = template;
  for (const [token, value] of Object.entries(replacements)) {
    rendered = rendered.split(token).join(escapeHtml(value));
  }

  return rendered;
}

// Does this look like a browser navigating, or a program calling an API?
// Anything under /api is always JSON regardless of what it claims to accept —
// a fetch() with a default Accept header would otherwise be handed a web page.
function wantsHtmlError(req) {
  if (req.path.startsWith("/api/") || req.path === "/healthz" || req.path === "/graphql" || req.path === "/oembed") {
    return false;
  }

  if (req.xhr) {
    return false;
  }

  return req.accepts(["html", "json"]) === "html";
}

async function sendError(req, res, status, { heading, message, detail, code } = {}) {
  const preset = ERROR_PRESETS[status] || ERROR_PRESETS[500];
  const resolved = {
    status,
    icon: preset.icon,
    heading: heading || preset.heading,
    message: message || preset.message,
    detail
  };

  if (res.headersSent) {
    return;
  }

  if (!wantsHtmlError(req)) {
    res.status(status).json({
      error: resolved.message,
      ...(code ? { code } : {})
    });
    return;
  }

  try {
    const template = await getErrorTemplate();
    res.status(status).type("html").send(renderErrorHtml(template, {
      ...resolved,
      baseUrl: getBaseUrlFromRequest(req)
    }));
  } catch (templateError) {
    // The error page itself failed. Say so in plain text rather than recursing.
    console.error("Failed to render the error page", templateError);
    res.status(status).type("text/plain").send(`${status} ${resolved.heading}`);
  }
}

let shareTemplateCache = null;
let shareTemplateCacheMtimeMs = 0;

async function getShareTemplate() {
  const stat = await fsp.stat(SHARE_TEMPLATE_PATH);
  if (shareTemplateCache !== null && shareTemplateCacheMtimeMs === stat.mtimeMs) {
    return shareTemplateCache;
  }

  // eslint-disable-next-line require-atomic-updates
  shareTemplateCache = await fsp.readFile(SHARE_TEMPLATE_PATH, "utf8");
  // eslint-disable-next-line require-atomic-updates
  shareTemplateCacheMtimeMs = stat.mtimeMs;
  return shareTemplateCache;
}

function renderShareHtml(template, {
  title,
  description,
  baseUrl,
  shareUrl = "",
  imageUrl = "",
  imageAlt = "",
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
    __SHARE_IMAGE_URL__: imageUrl || toAbsoluteUrl(baseUrl, EMBED_IMAGE_PATH),
    __SHARE_IMAGE_ALT__: imageAlt || `${SITE_NAME} share card`,
    __SHARE_MODIFIED__: modifiedAt,
    __SHARE_FAVICON_URL__: toAbsoluteUrl(baseUrl, FAVICON_PATH),
    __SHARE_THEME_COLOR__: EMBED_THEME_COLOR
  };

  let rendered = template;
  for (const [token, value] of Object.entries(replacements)) {
    rendered = rendered.split(token).join(escapeHtml(value));
  }

  return rendered;
}

// A share card carrying the document's own title, so an unfurl shows what was
// shared rather than the same generic app card every time.
//
// SVG rather than a rasteriser: this app has no image toolchain and adding one
// for a preview would be a poor trade. The cost is that some unfurlers (Slack,
// Discord, X) will not render an SVG og:image and fall back to showing no
// picture — the title, description and site name still come through.
function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// SVG has no text wrapping, so the lines are measured and broken here.
function wrapForCard(text, maxCharsPerLine, maxLines) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      line = candidate;
      continue;
    }

    if (line) {
      lines.push(line);
    }

    line = word;

    if (lines.length === maxLines) {
      break;
    }
  }

  if (line && lines.length < maxLines) {
    lines.push(line);
  }

  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[\s.,;:!?-]+$/, "")}…`;
  }

  return lines;
}

function renderShareCardSvg({ title, subtitle }) {
  const titleLines = wrapForCard(title, 26, 3);
  const fontSize = titleLines.length > 2 ? 62 : 74;
  const startY = 300 - ((titleLines.length - 1) * fontSize * 0.62);

  const titleMarkup = titleLines
    .map((line, index) => `<tspan x="122" y="${Math.round(startY + index * fontSize * 1.24)}">${escapeXml(line)}</tspan>`)
    .join("\n    ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${escapeXml(title)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#06090a" />
      <stop offset="55%" stop-color="#0a1113" />
      <stop offset="100%" stop-color="#101b1e" />
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#8ed9cf" />
      <stop offset="100%" stop-color="#5fb8ae" />
    </linearGradient>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)" />
  <rect x="64" y="62" width="1072" height="506" rx="30" fill="#0c1214" stroke="#2e3d42" stroke-width="2" />
  <rect x="122" y="96" width="72" height="6" rx="3" fill="url(#accent)" />

  <text fill="#dce7e5" font-size="${fontSize}" font-weight="700" font-family="Inter, Segoe UI, Arial, sans-serif">
    ${titleMarkup}
  </text>

  <text x="122" y="470" fill="#86a09d" font-size="28" font-family="Inter, Segoe UI, Arial, sans-serif">${escapeXml(subtitle)}</text>

  <g transform="translate(122,502)" fill="none" stroke="#8ed9cf" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <g transform="scale(1.5)">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </g>
  </g>
  <text x="168" y="527" fill="#8ed9cf" font-size="24" font-family="Inter, Segoe UI, Arial, sans-serif">${escapeXml(SITE_NAME)}</text>
</svg>
`;
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
    thumbnail_url: embedMeta.faviconUrl,
    thumbnail_width: 256,
    thumbnail_height: 256,
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
      imageUrl: `${shareUrl}/card.svg`,
      imageAlt: `Share card for "${meta.title}"`,
      modifiedAt: meta.updatedAt
    }));
  } catch (error) {
    next(error);
  }
});

// The og:image for a shared document. Public for the same reason the share is:
// the token is the credential, and an unfurler fetches this without a session.
app.get("/s/:token/card.svg", async (req, res, next) => {
  try {
    const share = shareStore.findByToken(String(req.params.token || ""));
    if (!share || !(await fileExists(path.join(MARKDOWN_DIR, share.file)))) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const meta = await buildShareMeta(req, share);

    res.set("X-Robots-Tag", "noindex, nofollow");
    // Short cache: the title tracks the document's own heading, so it changes
    // when the document does.
    res.set("Cache-Control", "public, max-age=300");
    res.type("image/svg+xml").send(renderShareCardSvg({
      title: meta.title,
      subtitle: share.file
    }));
  } catch (error) {
    next(error);
  }
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

app.get("/api/docs/:file", requireRead, async (req, res, next) => {
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

app.put("/api/docs/:file/folder", requirePermission("doc:write"), async (req, res, next) => {
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

app.post("/api/folders", requirePermission("doc:write"), async (req, res, next) => {
  try {
    const folderName = normalizeFolderName(req.body?.name);
    if (!folderName) {
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
app.put("/api/folders/reorder", requirePermission("doc:write"), async (req, res, next) => {
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

      // Order is per sibling group now, so a reorder request has to describe one
      // group. Mixing levels would make the resulting indices meaningless.
      const parents = new Set(ordered.map((folder) => folder.parentId || null));
      if (parents.size > 1) {
        throw new HttpError(400, "All folders in a reorder must share the same parent");
      }

      const targetParent = ordered.length ? (ordered[0].parentId || null) : null;

      // Siblings the caller left out keep their relative order after the listed
      // ones, so a partial list can never drop or shuffle an unmentioned folder.
      for (const folder of organizer.folders) {
        if (!seen.has(folder.id) && (folder.parentId || null) === targetParent) {
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
    });

    res.json({ folders: serializeFolders(savedOrganizer.folders) });
  } catch (error) {
    next(error);
  }
});

// Renames a folder, moves it under a new parent, or both. `parentId` is only
// touched when the key is present, so a rename never silently reparents.
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
    if (wantsRename && !folderName) {
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
    // Documents are never deleted — they fall back to Ungrouped, and the files
    // on disk are not touched at all.
    const { organizer: savedOrganizer, result: summary } = await mutateOrganizerState((organizer) => {
      if (!organizer.folders.some((entry) => entry.id === normalizedFolderId)) {
        throw new HttpError(404, "Folder not found");
      }

      const removedIds = new Set(collectFolderSubtreeIds(organizer.folders, normalizedFolderId));
      organizer.folders = organizer.folders.filter((entry) => !removedIds.has(entry.id));

      let unfiledCount = 0;
      for (const [fileName, assignedFolderId] of Object.entries(organizer.fileFolders)) {
        if (removedIds.has(assignedFolderId)) {
          delete organizer.fileFolders[fileName];
          unfiledCount += 1;
        }
      }

      return { removedFolders: removedIds.size, unfiledDocuments: unfiledCount };
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

app.post("/api/docs/:file/delete", requirePermission("doc:write"), async (req, res, next) => {
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

app.get("/api/recycle-bin/:entry/content", requireRead, async (req, res, next) => {
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

app.post("/api/recycle-bin/:entry/restore", requirePermission("doc:write"), async (req, res, next) => {
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

app.post("/api/recycle-bin/:entry/hard-delete", requirePermission("doc:write"), async (req, res, next) => {
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

app.get("/api/archive", requireRead, async (req, res, next) => {
  try {
    const organizer = await readOrganizerState();
    const docs = await getRecycleDocs(organizer, DELETED_HARD_DIR);
    res.json({ docs });
  } catch (error) {
    next(error);
  }
});

app.get("/api/archive/:entry/content", requireRead, async (req, res, next) => {
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

app.post("/api/archive/:entry/restore", requirePermission("doc:write"), async (req, res, next) => {
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

app.delete("/api/archive/:entry", requirePermission("doc:erase"), async (req, res, next) => {
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

app.put("/api/docs/:file", requirePermission("doc:write"), async (req, res, next) => {
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

app.post("/api/docs/:file/rename", requirePermission("doc:write"), async (req, res, next) => {
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

    await shareStore.withLock(() => shareStore.rename(fileName, targetName));

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

      // Write first, so a name collision is resolved against the real directory,
      // then record every mapping in a single organizer mutation.
      const written = [];
      for (const entry of planned) {
        const finalName = await ensureUniqueFilename(entry.fileName);
        const fullPath = path.join(MARKDOWN_DIR, finalName);
        await fsp.writeFile(fullPath, entry.file.buffer);
        invalidateCachedContent(fullPath);

        written.push({
          file: finalName,
          renamedFrom: finalName === entry.fileName ? null : entry.fileName,
          folderNames: entry.folderNames
        });
      }

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

        for (const entry of written) {
          const folderId = resolveFolder(entry.folderNames);
          if (folderId) {
            organizer.fileFolders[entry.file] = folderId;
          }
          entry.folderId = folderId;
        }

        return null;
      });

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

// Nothing matched. Without this, Express answers a mistyped URL with a bare
// "Cannot GET /nope" in the browser's default serif.
app.use((req, res, next) => {
  sendError(req, res, 404, {
    detail: `No route for ${req.method} ${req.path}`
  }).catch(next);
});

// Four parameters is how Express recognises error middleware, so `_next` has to
// stay in the signature even though nothing calls it.
app.use((error, req, res, _next) => {
  if (error instanceof HttpError) {
    void sendError(req, res, error.statusCode, { message: error.message });
    return;
  }

  // express.json() rejects oversized bodies before our own size check runs.
  if (error?.type === "entity.too.large") {
    void sendError(req, res, 413, { message: "File content exceeds the 2MB limit" });
    return;
  }

  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      void sendError(req, res, 413, { message: "Uploaded file exceeds 2MB limit" });
      return;
    }

    void sendError(req, res, 400, { message: error.message || "Upload failed" });
    return;
  }

  if (error && error.message === "Only .md, .markdown, .mmd, .mermaid, or .ipynb files are supported") {
    void sendError(req, res, 400, { message: error.message });
    return;
  }

  // The stack goes to the log. The reader gets a status and nothing else: an
  // error page is not the place to publish internals.
  console.error(error);
  void sendError(req, res, 500);
});

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
  await authStore.load();
  await shareStore.load();

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
