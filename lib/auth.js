// Authentication, sessions and role-based access control.
//
// Design notes, since several of these are deliberate choices rather than the
// first thing that works:
//
//   * Sessions are server-side, not JWTs. A JWT cannot be revoked without
//     server state anyway, and this way "log everyone out" and "disable that
//     account now" are one file write.
//
//   * The session id is sent as an httpOnly cookie and stored *hashed* on
//     disk. httpOnly means script cannot read it, so an XSS bug cannot
//     exfiltrate a session; hashing means a leak of sessions.json does not hand
//     over live sessions.
//
//   * SameSite=Strict blocks the cookie on cross-site requests, which stops
//     CSRF at the source. A double-submit CSRF token and an Origin check are
//     layered on top, because SameSite is one header away from being the only
//     thing standing there.
//
//   * Login is rate limited per account and per IP, because a 350ms password
//     hash is both the defence against offline cracking and a lever for
//     online denial of service.

const crypto = require("crypto");
const fsp = require("fs/promises");
const path = require("path");

const passwords = require("./passwords");

const USERS_VERSION = 1;
const SESSIONS_VERSION = 1;

const SESSION_COOKIE = "azadocs_session";
const SESSION_TOKEN_BYTES = 32;
const CSRF_TOKEN_BYTES = 32;
// Long enough not to be a nuisance on a personal tool, short enough that a
// stolen cookie is not forever.
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const MIN_USERNAME_LENGTH = 2;
const MAX_USERNAME_LENGTH = 32;
// Deliberately narrow: usernames are identifiers here, not display names.
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

const ROLES = ["viewer", "editor", "admin"];

// What each role may do. Higher roles do not silently inherit — the sets are
// written out, so reading this table tells you the whole truth.
const ROLE_PERMISSIONS = {
  viewer: ["doc:read"],
  editor: ["doc:read", "doc:write", "share:manage"],
  admin: ["doc:read", "doc:write", "share:manage", "doc:erase", "user:manage"]
};

const SEED_ADMIN_USERNAME = "aza";
const SEED_ADMIN_PASSWORD = "lolface123";

// ---------------------------------------------------------------------------
// Atomic JSON persistence
// ---------------------------------------------------------------------------

// Same shape as the organizer's writer: temp file, fsync, rename. A half-written
// users file would lock everyone out, and a half-written sessions file would log
// everyone out.
async function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const payload = JSON.stringify(value, null, 2);

  let handle = null;
  try {
    handle = await fsp.open(tempPath, "w");
    await handle.writeFile(payload, "utf8");
    await handle.sync();
  } finally {
    await handle?.close();
  }

  try {
    await fsp.rename(tempPath, filePath);
  } catch (error) {
    await fsp.unlink(tempPath).catch(() => {});
    throw error;
  }
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }

    throw error;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function validateUsername(value) {
  const username = normalizeUsername(value);

  if (username.length < MIN_USERNAME_LENGTH || username.length > MAX_USERNAME_LENGTH) {
    return { ok: false, error: `Username must be ${MIN_USERNAME_LENGTH}-${MAX_USERNAME_LENGTH} characters.` };
  }

  if (!USERNAME_PATTERN.test(username)) {
    return { ok: false, error: "Username may use lowercase letters, numbers, dot, dash and underscore, and must start with a letter or number." };
  }

  return { ok: true, username };
}

function publicUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    username: user.username,
    role: user.role,
    disabled: Boolean(user.disabled),
    mustChangePassword: Boolean(user.mustChangePassword),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    passwordChangedAt: user.passwordChangedAt || null,
    lastLoginAt: user.lastLoginAt || null
  };
}

function permissionsFor(role) {
  return ROLE_PERMISSIONS[role] || [];
}

function roleCan(role, permission) {
  return permissionsFor(role).includes(permission);
}

// ---------------------------------------------------------------------------
// Login rate limiting
// ---------------------------------------------------------------------------

// In memory on purpose: it resets on restart, which is acceptable for a lockout
// window measured in minutes, and it avoids a disk write on every failed guess
// (which would itself be the denial of service).
// Per-account, which is the one that matters for a targeted guess.
const MAX_ATTEMPTS = 8;
// Per-IP, deliberately much higher. Everyone behind a NAT, a VPN or a reverse
// proxy without TRUST_PROXY set shares one address, so an 8-strike IP rule
// hands any passer-by the ability to lock out the whole household. This is
// still low enough to make credential stuffing across many accounts painful.
const MAX_IP_ATTEMPTS = 40;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;

class LoginLimiter {
  constructor() {
    this.buckets = new Map();
  }

  key(scope, value) {
    return `${scope}:${value}`;
  }

  peek(keys) {
    const now = Date.now();

    for (const key of keys) {
      const bucket = this.buckets.get(key);
      if (bucket && bucket.lockedUntil > now) {
        return { blocked: true, retryAfterMs: bucket.lockedUntil - now };
      }
    }

    return { blocked: false, retryAfterMs: 0 };
  }

  fail(keys) {
    const now = Date.now();

    for (const key of keys) {
      const bucket = this.buckets.get(key) || { attempts: [], lockedUntil: 0 };
      bucket.attempts = bucket.attempts.filter((at) => now - at < ATTEMPT_WINDOW_MS);
      bucket.attempts.push(now);

      const limit = key.startsWith("ip:") ? MAX_IP_ATTEMPTS : MAX_ATTEMPTS;
      if (bucket.attempts.length >= limit) {
        bucket.lockedUntil = now + LOCKOUT_MS;
        bucket.attempts = [];
      }

      this.buckets.set(key, bucket);
    }
  }

  succeed(keys) {
    for (const key of keys) {
      this.buckets.delete(key);
    }
  }

  reset() {
    this.buckets.clear();
  }
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

class AuthStore {
  constructor({ dataDir, sessionTtlMs = SESSION_TTL_MS }) {
    this.usersPath = path.join(dataDir, "users.json");
    this.sessionsPath = path.join(dataDir, "sessions.json");
    this.sessionTtlMs = sessionTtlMs;
    this.limiter = new LoginLimiter();

    this.users = [];
    this.sessions = new Map();
    // Serialises read-modify-write cycles the same way the organizer does, so
    // two concurrent user edits cannot lose one another.
    this.writeLock = Promise.resolve();
  }

  async withLock(fn) {
    const run = this.writeLock.then(fn, fn);
    // Keep the chain alive even when a caller rejects.
    this.writeLock = run.then(() => {}, () => {});
    return run;
  }

  async load() {
    const usersFile = await readJson(this.usersPath, { version: USERS_VERSION, users: [] });
    this.users = Array.isArray(usersFile.users) ? usersFile.users : [];

    const sessionsFile = await readJson(this.sessionsPath, { version: SESSIONS_VERSION, sessions: [] });
    const sessions = Array.isArray(sessionsFile.sessions) ? sessionsFile.sessions : [];

    this.sessions = new Map();
    const now = Date.now();
    for (const session of sessions) {
      if (session?.id && new Date(session.expiresAt).getTime() > now) {
        this.sessions.set(session.id, session);
      }
    }
  }

  async saveUsers() {
    await writeJsonAtomic(this.usersPath, { version: USERS_VERSION, users: this.users });
  }

  async saveSessions() {
    await writeJsonAtomic(this.sessionsPath, {
      version: SESSIONS_VERSION,
      sessions: [...this.sessions.values()]
    });
  }

  // -- users ---------------------------------------------------------------

  findByUsername(username) {
    const normalized = normalizeUsername(username);
    return this.users.find((user) => user.username === normalized) || null;
  }

  findById(id) {
    return this.users.find((user) => user.id === id) || null;
  }

  listUsers() {
    return this.users
      .slice()
      .sort((left, right) => left.username.localeCompare(right.username))
      .map(publicUser);
  }

  adminCount() {
    return this.users.filter((user) => user.role === "admin" && !user.disabled).length;
  }

  async seedAdminIfEmpty() {
    if (this.users.length > 0) {
      return null;
    }

    const created = await this.createUser({
      username: SEED_ADMIN_USERNAME,
      password: SEED_ADMIN_PASSWORD,
      role: "admin",
      // The seed password is in the source and in the README, so it is public
      // knowledge by construction. Force it to be replaced at first login.
      mustChangePassword: true,
      skipPasswordPolicy: true
    });

    return created;
  }

  async createUser({ username, password, role = "viewer", mustChangePassword = false, skipPasswordPolicy = false }) {
    const nameCheck = validateUsername(username);
    if (!nameCheck.ok) {
      return { ok: false, error: nameCheck.error };
    }

    if (!ROLES.includes(role)) {
      return { ok: false, error: `Role must be one of: ${ROLES.join(", ")}.` };
    }

    if (this.findByUsername(nameCheck.username)) {
      return { ok: false, error: "That username is already taken." };
    }

    if (!skipPasswordPolicy) {
      const policy = passwords.validatePassword(password, { username: nameCheck.username });
      if (!policy.ok) {
        return { ok: false, error: policy.error };
      }
    }

    const now = new Date().toISOString();
    const user = {
      id: newId("user"),
      username: nameCheck.username,
      passwordHash: await passwords.hashPassword(password),
      role,
      disabled: false,
      mustChangePassword: Boolean(mustChangePassword),
      createdAt: now,
      updatedAt: now,
      passwordChangedAt: now,
      lastLoginAt: null
    };

    this.users.push(user);
    await this.saveUsers();
    return { ok: true, user: publicUser(user) };
  }

  async updateUser(id, { role, disabled }) {
    const user = this.findById(id);
    if (!user) {
      return { ok: false, error: "No such user." };
    }

    if (role !== undefined) {
      if (!ROLES.includes(role)) {
        return { ok: false, error: `Role must be one of: ${ROLES.join(", ")}.` };
      }

      // Losing the last admin means losing the ability to manage users at all,
      // and there is no recovery path short of editing the file by hand.
      if (user.role === "admin" && role !== "admin" && this.adminCount() <= 1) {
        return { ok: false, error: "This is the only admin. Promote another account first." };
      }

      user.role = role;
    }

    if (disabled !== undefined) {
      if (user.role === "admin" && disabled && this.adminCount() <= 1) {
        return { ok: false, error: "This is the only admin. Promote another account first." };
      }

      user.disabled = Boolean(disabled);

      // A disabled account must not keep working until its cookie expires.
      if (user.disabled) {
        this.revokeUserSessionsInMemory(user.id);
      }
    }

    user.updatedAt = new Date().toISOString();
    await this.saveUsers();
    await this.saveSessions();
    return { ok: true, user: publicUser(user) };
  }

  async deleteUser(id) {
    const user = this.findById(id);
    if (!user) {
      return { ok: false, error: "No such user." };
    }

    if (user.role === "admin" && this.adminCount() <= 1) {
      return { ok: false, error: "This is the only admin. Promote another account first." };
    }

    this.users = this.users.filter((candidate) => candidate.id !== id);
    this.revokeUserSessionsInMemory(id);
    await this.saveUsers();
    await this.saveSessions();
    return { ok: true };
  }

  // Changing your own password: proves possession of the current one, which is
  // what stops a walk-up attacker at an unlocked screen from taking the account.
  async changeOwnPassword(id, currentPassword, nextPassword) {
    const user = this.findById(id);
    if (!user) {
      return { ok: false, error: "No such user." };
    }

    if (!(await passwords.verifyPassword(currentPassword, user.passwordHash))) {
      return { ok: false, error: "Current password is incorrect." };
    }

    if (String(currentPassword) === String(nextPassword)) {
      return { ok: false, error: "New password must be different from the current one." };
    }

    const policy = passwords.validatePassword(nextPassword, { username: user.username });
    if (!policy.ok) {
      return { ok: false, error: policy.error };
    }

    return this.applyPassword(user, nextPassword);
  }

  // An admin resetting someone else's password. No current password, because
  // the whole point is that it is not known.
  async resetPassword(id, nextPassword, { mustChangePassword = true } = {}) {
    const user = this.findById(id);
    if (!user) {
      return { ok: false, error: "No such user." };
    }

    const policy = passwords.validatePassword(nextPassword, { username: user.username });
    if (!policy.ok) {
      return { ok: false, error: policy.error };
    }

    return this.applyPassword(user, nextPassword, { mustChangePassword });
  }

  async applyPassword(user, nextPassword, { mustChangePassword = false } = {}) {
    const now = new Date().toISOString();
    user.passwordHash = await passwords.hashPassword(nextPassword);
    user.passwordChangedAt = now;
    user.updatedAt = now;
    user.mustChangePassword = Boolean(mustChangePassword);

    // Every other session belonging to this account is now suspect: if the
    // password was changed because it leaked, leaving those alive defeats the
    // point. The caller re-issues one for the current session.
    this.revokeUserSessionsInMemory(user.id);

    await this.saveUsers();
    await this.saveSessions();
    return { ok: true, user: publicUser(user) };
  }

  // -- sessions ------------------------------------------------------------

  revokeUserSessionsInMemory(userId) {
    for (const [id, session] of this.sessions) {
      if (session.userId === userId) {
        this.sessions.delete(id);
      }
    }
  }

  async createSession(user, { userAgent = "", ip = "" } = {}) {
    const token = crypto.randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
    const csrfToken = crypto.randomBytes(CSRF_TOKEN_BYTES).toString("base64url");
    const now = Date.now();

    const session = {
      id: hashToken(token),
      userId: user.id,
      csrfToken,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.sessionTtlMs).toISOString(),
      // Truncated: enough to recognise a session in a list, not enough to be a
      // meaningful tracking record.
      userAgent: String(userAgent).slice(0, 200),
      ip: String(ip).slice(0, 64)
    };

    this.sessions.set(session.id, session);
    this.sweepExpired();
    await this.saveSessions();

    return { token, session };
  }

  getSession(token) {
    if (!token) {
      return null;
    }

    const session = this.sessions.get(hashToken(token));
    if (!session) {
      return null;
    }

    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      this.sessions.delete(session.id);
      return null;
    }

    return session;
  }

  async destroySession(token) {
    const session = this.getSession(token);
    if (!session) {
      return false;
    }

    this.sessions.delete(session.id);
    await this.saveSessions();
    return true;
  }

  sweepExpired() {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (new Date(session.expiresAt).getTime() <= now) {
        this.sessions.delete(id);
      }
    }
  }

  // -- login ---------------------------------------------------------------

  async login(username, password, { userAgent = "", ip = "" } = {}) {
    const normalized = normalizeUsername(username);
    const keys = [
      this.limiter.key("user", normalized),
      this.limiter.key("ip", ip)
    ];

    const limited = this.limiter.peek(keys);
    if (limited.blocked) {
      return {
        ok: false,
        status: 429,
        retryAfterMs: limited.retryAfterMs,
        error: "Too many failed attempts. Try again later."
      };
    }

    const user = this.findByUsername(normalized);

    // Always burn a hash, even for a username that does not exist, so response
    // time does not reveal which accounts are real.
    const valid = user && !user.disabled
      ? await passwords.verifyPassword(password, user.passwordHash)
      : await passwords.dummyVerify(password);

    if (!valid) {
      this.limiter.fail(keys);
      // One message for every failure mode. "No such user" and "wrong password"
      // as separate errors is a free account enumeration oracle.
      return { ok: false, status: 401, error: "Incorrect username or password." };
    }

    this.limiter.succeed(keys);

    // Opportunistic upgrade: the plaintext is only ever available here.
    if (passwords.needsRehash(user.passwordHash)) {
      user.passwordHash = await passwords.hashPassword(password);
    }

    user.lastLoginAt = new Date().toISOString();
    await this.saveUsers();

    const { token, session } = await this.createSession(user, { userAgent, ip });
    return { ok: true, token, session, user: publicUser(user) };
  }
}

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------

// Express does not parse cookies without cookie-parser, and one header split is
// not worth a dependency.
function parseCookies(header) {
  const out = {};
  if (!header) {
    return out;
  }

  for (const part of String(header).split(";")) {
    const index = part.indexOf("=");
    if (index < 0) {
      continue;
    }

    const name = part.slice(0, index).trim();
    if (!name) {
      continue;
    }

    try {
      out[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      out[name] = part.slice(index + 1).trim();
    }
  }

  return out;
}

function sessionCookieOptions({ secure, maxAgeMs }) {
  return {
    httpOnly: true,
    // Strict rather than Lax: nothing about this app needs to work when
    // entered from someone else's page, and Strict is what makes CSRF a
    // non-issue for the cookie itself.
    sameSite: "strict",
    secure,
    path: "/",
    ...(maxAgeMs === undefined ? {} : { maxAge: maxAgeMs })
  };
}

module.exports = {
  AuthStore,
  parseCookies,
  sessionCookieOptions,
  hashToken,
  normalizeUsername,
  validateUsername,
  publicUser,
  permissionsFor,
  roleCan,
  ROLES,
  ROLE_PERMISSIONS,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  SEED_ADMIN_USERNAME,
  SEED_ADMIN_PASSWORD,
  MAX_ATTEMPTS,
  MAX_IP_ATTEMPTS
};
