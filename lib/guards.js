/* The guards: who is asking, and may they.
 *
 * Every request gets `req.auth` from attachSession; nothing is refused there.
 * Refusing is the job of the guards below, one per requirement, so what a route
 * demands is visible at the route rather than buried in a middleware chain.
 *
 * Sessions are server-side and carried in an httpOnly SameSite=Strict cookie;
 * lib/auth.js says why each of those was chosen. Roles are viewer / editor /
 * admin.
 *
 * The store and the configuration are injected rather than imported, because a
 * guard that reaches for a module-level singleton cannot be exercised on its
 * own — and these are the functions most worth being able to exercise on their
 * own.
 */

const crypto = require("crypto");
const {
  parseCookies,
  sessionCookieOptions,
  publicUser,
  permissionsFor,
  roleCan,
  SESSION_COOKIE,
  SESSION_TTL_MS
} = require("./auth");

// CSRF. SameSite=Strict already stops the browser sending the session cookie
// from another site, so this is the second lock: a token the page has to read
// out of its own session and echo back, which cross-origin script cannot do.
// The Origin check catches anything that gets past both.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function createGuards({
  authStore,
  publicReads = false,
  trustProxy = "",
  cookiesSecure = false,
  getBaseUrl
}) {
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

    if (publicReads || req.auth) {
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
      const expected = getBaseUrl(req);
      let sameOrigin = false;
      try {
        sameOrigin = new URL(origin).origin === new URL(expected).origin;
      } catch {
        sameOrigin = false;
      }

      // Behind a proxy the public origin and the request origin can legitimately
      // differ, so a mismatch only fails when the token also fails, below.
      if (!sameOrigin && !trustProxy) {
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
        publicReads: publicReads,
        user: null,
        permissions: [],
        csrfToken: null
      };
    }

    return {
      authenticated: true,
      publicReads: publicReads,
      user: publicUser(req.auth.user),
      permissions: permissionsFor(req.auth.user.role),
      csrfToken: req.auth.session.csrfToken
    };
  }

  function issueSessionCookie(res, token) {
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions({
      secure: cookiesSecure,
      maxAgeMs: SESSION_TTL_MS
    }));
  }

  function clearSessionCookie(res) {
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions({ secure: cookiesSecure }));
  }

  return {
    currentSession,
    attachSession,
    requireAuth,
    requireRead,
    requirePermission,
    requireCsrf,
    sessionPayload,
    issueSessionCookie,
    clearSessionCookie
  };
}

module.exports = { createGuards, SAFE_METHODS };
