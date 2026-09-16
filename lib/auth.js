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
const path = require("path");
const { importJsonOnce } = require("./db");

const passwords = require("./passwords");


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

// A row as the rest of this file expects a user to look.
function toUser(row) {
  return row
    ? {
      id: row.id,
      username: row.username,
      passwordHash: row.password_hash,
      role: row.role,
      disabled: Boolean(row.disabled),
      mustChangePassword: Boolean(row.must_change_password),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      passwordChangedAt: row.password_changed_at,
      lastLoginAt: row.last_login_at
    }
    : null;
}

function toSession(row) {
  return row
    ? {
      id: row.id,
      userId: row.user_id,
      csrfToken: row.csrf_token,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      userAgent: row.user_agent,
      ip: row.ip
    }
    : null;
}

const USER_COLUMNS = `id, username, password_hash, role, disabled,
  must_change_password, created_at, updated_at, password_changed_at, last_login_at`;
const USER_PLACEHOLDERS = new Array(10).fill("?").join(", ");

function userValues(user) {
  return [
    user.id, user.username, user.passwordHash, user.role,
    user.disabled ? 1 : 0, user.mustChangePassword ? 1 : 0,
    user.createdAt ?? null, user.updatedAt ?? null,
    user.passwordChangedAt ?? null, user.lastLoginAt ?? null
  ];
}

class AuthStore {
  // `db` is optional; see ShareStore. The server hands every store the same
  // handle so they are one transactional world.
  constructor({ dataDir, sessionTtlMs = SESSION_TTL_MS, db = null }) {
    this.db = db || require("./db").open(dataDir);
    this.usersPath = path.join(dataDir, "users.json");
    this.sessionsPath = path.join(dataDir, "sessions.json");
    this.sessionTtlMs = sessionTtlMs;
    this.limiter = new LoginLimiter();
  }

  // See ShareStore.withLock: what this stood for is the database's job now.
  async withLock(fn) {
    return fn();
  }

  async load() {
    importJsonOnce(this.db, {
      filePath: this.usersPath,
      isEmpty: () => this.db.prepare("SELECT COUNT(*) AS n FROM users").get().n === 0,
      load: (parsed) => {
        const users = Array.isArray(parsed.users) ? parsed.users : [];
        const insert = this.db.prepare(
          `INSERT OR REPLACE INTO users (${USER_COLUMNS}) VALUES (${USER_PLACEHOLDERS})`);
        this.db.transaction((rows) => {
          for (const user of rows) {
            insert.run(userValues(user));
          }
        })(users);
        return users.length;
      }
    });

    importJsonOnce(this.db, {
      filePath: this.sessionsPath,
      isEmpty: () => this.db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n === 0,
      load: (parsed) => {
        const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
        const insert = this.db.prepare(
          `INSERT OR REPLACE INTO sessions
             (id, user_id, csrf_token, created_at, expires_at, user_agent, ip)
           VALUES (?, ?, ?, ?, ?, ?, ?)`);
        const now = Date.now();
        return this.db.transaction((rows) => {
          let kept = 0;
          for (const session of rows) {
            // Expired sessions were dropped on load before and are dropped
            // here, so importing does not resurrect one.
            if (!session?.id || new Date(session.expiresAt).getTime() <= now) {
              continue;
            }

            // A session whose user did not survive the import would fail the
            // foreign key; it is dead either way.
            if (!this.db.prepare("SELECT 1 FROM users WHERE id = ?").get(session.userId)) {
              continue;
            }

            insert.run(session.id, session.userId, session.csrfToken, session.createdAt,
              session.expiresAt, session.userAgent || "", session.ip || "");
            kept += 1;
          }

          // The file is set aside once it has been read, even if every session
          // in it had expired — it has been dealt with.
          return kept || (rows.length > 0 ? 1 : 0);
        })(sessions);
      }
    });

    this.sweepExpired();
  }

  // -- users ---------------------------------------------------------------

  findByUsername(username) {
    return toUser(this.db.prepare("SELECT * FROM users WHERE username = ?")
      .get(normalizeUsername(username)));
  }

  findById(id) {
    return toUser(this.db.prepare("SELECT * FROM users WHERE id = ?").get(id));
  }

  listUsers() {
    return this.db.prepare("SELECT * FROM users").all()
      .map(toUser)
      .sort((left, right) => left.username.localeCompare(right.username))
      .map(publicUser);
  }

  adminCount() {
    return this.db.prepare(
      "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0").get().n;
  }

  async seedAdminIfEmpty() {
    if (this.db.prepare("SELECT COUNT(*) AS n FROM users").get().n > 0) {
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

    this.db.prepare(`INSERT INTO users (${USER_COLUMNS}) VALUES (${USER_PLACEHOLDERS})`)
      .run(userValues(user));
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
    }

    user.updatedAt = new Date().toISOString();
    // A disabled account must not keep working until its cookie expires, and
    // the row and its dead sessions land in one transaction.
    this.writeUser(user, { revokeSessions: user.disabled });
    return { ok: true, user: publicUser(user) };
  }

  /* The whole row, because the caller above has been editing a copy of it and
   * this is where that copy becomes the record.
   *
   * UPDATE, emphatically not INSERT OR REPLACE. The latter is a delete
   * followed by an insert, so ON DELETE CASCADE takes the account's sessions
   * with it — every write to a user row, including recording a login time,
   * would have signed that user out everywhere. Revoking sessions is something
   * this does when asked, not a side effect of saving a name.
   */
  writeUser(user, { revokeSessions = false } = {}) {
    this.db.transaction(() => {
      this.db.prepare(
        `UPDATE users SET
           username = ?, password_hash = ?, role = ?, disabled = ?,
           must_change_password = ?, created_at = ?, updated_at = ?,
           password_changed_at = ?, last_login_at = ?
         WHERE id = ?`
      ).run(
        user.username, user.passwordHash, user.role, user.disabled ? 1 : 0,
        user.mustChangePassword ? 1 : 0, user.createdAt ?? null, user.updatedAt ?? null,
        user.passwordChangedAt ?? null, user.lastLoginAt ?? null, user.id
      );

      if (revokeSessions) {
        this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
      }
    })();
  }

  async deleteUser(id) {
    const user = this.findById(id);
    if (!user) {
      return { ok: false, error: "No such user." };
    }

    if (user.role === "admin" && this.adminCount() <= 1) {
      return { ok: false, error: "This is the only admin. Promote another account first." };
    }

    // The sessions go with it: the foreign key cascades, in the same statement.
    this.db.prepare("DELETE FROM users WHERE id = ?").run(id);
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
    this.writeUser(user, { revokeSessions: true });
    return { ok: true, user: publicUser(user) };
  }

  // -- sessions ------------------------------------------------------------

  revokeUserSessions(userId) {
    return this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId).changes;
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

    this.db.prepare(
      `INSERT INTO sessions (id, user_id, csrf_token, created_at, expires_at, user_agent, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(session.id, session.userId, session.csrfToken, session.createdAt,
      session.expiresAt, session.userAgent, session.ip);
    this.sweepExpired();

    return { token, session };
  }

  getSession(token) {
    if (!token) {
      return null;
    }

    const session = toSession(
      this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(hashToken(token)));
    if (!session) {
      return null;
    }

    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      this.db.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
      return null;
    }

    return session;
  }

  async destroySession(token) {
    const session = this.getSession(token);
    if (!session) {
      return false;
    }

    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
    return true;
  }

  sweepExpired() {
    // ISO-8601 strings compare in the same order as the instants they name,
    // which is the whole reason they are stored as text.
    return this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?")
      .run(new Date().toISOString()).changes;
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
    this.writeUser(user);

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
