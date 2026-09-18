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
  allowedOrigins = new Set(),
  cookiesSecure = false
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

    /* /graphql is a POST that changes nothing: its schema has queries and no
     * mutations, which the graphql suite holds in place. CSRF defends state
     * changes — a page on another site making a write ride on the victim's
     * cookie. A read cannot be ridden that way: the other site cannot see
     * the answer, since nothing here sends CORS headers. What it could do is
     * make the victim's session do work, and that is the rate limiter's job.
     * So a script may ask the graph with a session and no token, which is
     * the whole reason to have the graph.
     */
    if (req.path === "/graphql") {
      next();
      return;
    }

    if (!req.auth) {
      // Unauthenticated writes are rejected by the auth guards; there is no
      // session-riding to protect against yet.
      next();
      return;
    }

    /* The Origin header, when the browser sends one, has to name an origin
     * this deployment answers on. Those are configuration — the public base
     * URL, anything listed in ALLOWED_ORIGINS, and loopback on this port —
     * and not something derived from the request, which is the whole reason
     * this cannot lean on the Host header when a proxy is in front.
     *
     * It used to be compared against the request's own idea of its origin,
     * and switched off entirely under TRUST_PROXY because behind a proxy the
     * two could legitimately differ. The effect was that the deployment
     * which most needed the check — the public one, behind a reverse proxy —
     * was the one that did not get it, and localhost, where the risk is
     * nil, did. Comparing against a known list restores it in production and
     * keeps localhost working by naming it.
     *
     * A browser sends Origin on every cross-site POST, so a request with no
     * Origin is a script or a same-site form, and the token below is what
     * decides for it. This is the layer in front of that, not the only lock.
     */
    const origin = req.get("origin");
    if (origin) {
      let sent = null;
      try {
        sent = new URL(origin).origin;
      } catch {
        sent = null;
      }

      if (!sent || !allowedOrigins.has(sent)) {
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
