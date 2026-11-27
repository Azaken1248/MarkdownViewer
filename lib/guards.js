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
const { actorOf, noAudit } = require("./audit");
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

function currentSession(authStore, req) {
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
function attachSession(authStore, req, res, next) {
  const found = currentSession(authStore, req);
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

function requireRead(publicReads, req, res, next) {
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

function requirePermission(audit, permission) {
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
      // A signed-in account asking for what its role does not allow is the
      // event an incident review looks for first: a viewer trying to write
      // is either a bug in the client or somebody probing.
      audit("permission.denied", {
        ...actorOf(req), role: req.auth.user.role, permission, method: req.method, path: req.path
      });
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

/* PUBLIC_READS, as a statement rather than as a branch.
 *
 * The variable is the operator saying the whole library is readable without an
 * account, which is exactly `allow read to public at the root`. Handed to the
 * decision for the request rather than written to the database, because it is
 * not the owner's policy — it goes away when the variable does — and said as a
 * statement rather than as an exception so the one algorithm still explains the
 * answer. Which also means a space with an explicit `deny read public` on it
 * stays closed: a deny beats everything, PUBLIC_READS included.
 */
const PUBLIC_READS_STATEMENT = {
  id: "implicit_public_reads",
  effect: "allow",
  subject: { kind: "public" },
  space: null,
  prefix: null,
  level: "read",
  expires: null
};

/* One place the questions are asked from.
 *
 * Every request carries `req.access`, built once from the one store, so the
 * guard below and the handlers that filter a list are asking the same thing in
 * the same way. A second copy of this is a second answer to "may they", and
 * the two would not stay the same for long.
 */
function attachAccess(accessStore, publicReads, req, res, next) {
  const user = req.auth ? req.auth.user : null;
  const extra = publicReads && !user ? [PUBLIC_READS_STATEMENT] : [];

  req.access = {
    decide: (docPath, action) => accessStore.decide(user, docPath, action, { extra }),
    // A predicate, because a collection is filtered rather than refused: a
    // library with one unreadable document in it is still a library.
    filter: (action = "doc:read") => accessStore.allowFilter(user, action, { extra }),
    level: (docPath) => accessStore.effectiveLevel(user, docPath, { extra }),
    visibleSpaces: () => accessStore.visibleSpaces(user, { extra }),
    /* And the one for a request that arrives holding a share token.
     *
     * Named here rather than left to the routes that read a shared document,
     * because "the token is the whole authorisation" is exactly the
     * assumption it replaces — and four routes read one.
     */
    forShare: (share) => accessStore.decideShare(share, user, { extra })
  };

  next();
}

/* The guard for a route that names one document.
 *
 * `locate` says where in the request the document is — a wildcard path, a
 * recycle-bin entry, the name and folder a new document is being created
 * under — and may answer with a promise, because some of those have to read
 * the folder tree to know.
 *
 * The refusal is deliberately two different answers:
 *
 *   * **404 for something you may not read.** Telling somebody a document
 *     exists but is not theirs is telling them something about a space they
 *     have no access to. This is the same choice a private repository makes.
 *   * **403 for something you may read but not do.** You already know it is
 *     there, so the useful answer is that the action is refused.
 *
 * Neither says *which* statement refused. That belongs in the audit log, and
 * to an admin through explain — a refusal that recites the policy to the
 * person it refused is a policy that leaks.
 */
function requireAccess({ audit, publicReads }, action, locate) {
  return async function accessGuard(req, res, next) {
    try {
      if (!req.auth && !publicReads) {
        res.status(401).json({ error: "Sign in to continue.", code: "auth_required" });
        return;
      }

      if (passwordChangePending(req)) {
        refusePendingPasswordChange(res);
        return;
      }

      const docPath = await locate(req);
      const answer = req.access.decide(docPath, action);
      if (answer.allowed) {
        next();
        return;
      }

      /* A refusal the role is responsible for is the event it always was, with
       * the fields it always had: an incident review asks "did somebody probe
       * above their role" and "did somebody reach into a space" as two
       * different questions, and they are two different lines.
       */
      const byRole = answer.reason.startsWith("role boundary");
      audit(byRole ? "permission.denied" : "access.denied", {
        ...actorOf(req),
        role: req.auth ? req.auth.user.role : "public",
        permission: action,
        file: docPath,
        reason: byRole ? undefined : answer.reason,
        method: req.method,
        path: req.path
      });

      const mayRead = action === "doc:read"
        ? answer
        : req.access.decide(docPath, "doc:read");

      if (!mayRead.allowed) {
        res.status(404).json({ error: "Document not found" });
        return;
      }

      res.status(403).json({
        error: "Your account does not have permission to do that.",
        code: "forbidden",
        required: action
      });
    } catch (error) {
      next(error);
    }
  };
}

function requireCsrf(allowedOrigins, req, res, next) {
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

  /* Drawing a PDF is a POST that changes nothing, for the same reasons.
   *
   * What comes back is a drawing of the document the caller posted, so there
   * is nothing of the victim's in the answer and nothing cross-origin can
   * read it anyway. What a page on another site could do is make the
   * victim's session start a browser, and that is the rate limiter's job —
   * ten a minute by address, which is the tightest bucket here.
   *
   * It has to be exempt rather than merely allowed, because the page that
   * needs it most is the share page: it knows nothing about sessions and
   * carries no token, while the owner reading their own link carries the
   * cookie for that origin. Demanding a token there refuses the one person
   * who published the thing.
   */
  if (req.path === "/api/export/pdf") {
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
      // An Origin that is not a URL is not an origin this deployment
      // answers on, which is what the null above already says.
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

function sessionPayload(publicReads, req) {
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

function issueSessionCookie(cookiesSecure, res, token) {
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions({
    secure: cookiesSecure,
    maxAgeMs: SESSION_TTL_MS
  }));
}

function clearSessionCookie(cookiesSecure, res) {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions({ secure: cookiesSecure }));
}

/* The guards this deployment will use, each bound to its own settings.
 *
 * Every one of them is a function above rather than a closure over this call:
 * what they share is configuration, which is named where each of them takes
 * it, so a guard can be read — and reasoned about — without knowing how it
 * was wired up.
 */
function createGuards({
  authStore,
  accessStore = null,
  publicReads = false,
  allowedOrigins = new Set(),
  cookiesSecure = false,
  audit = noAudit
}) {
  return {
    currentSession: (req) => currentSession(authStore, req),
    attachSession: (req, res, next) => attachSession(authStore, req, res, next),
    attachAccess: (req, res, next) => attachAccess(accessStore, publicReads, req, res, next),
    requireAuth,
    requireRead: (req, res, next) => requireRead(publicReads, req, res, next),
    requirePermission: (permission) => requirePermission(audit, permission),
    requireAccess: (action, locate) => requireAccess({ audit, publicReads }, action, locate),
    requireCsrf: (req, res, next) => requireCsrf(allowedOrigins, req, res, next),
    sessionPayload: (req) => sessionPayload(publicReads, req),
    issueSessionCookie: (res, token) => issueSessionCookie(cookiesSecure, res, token),
    clearSessionCookie: (res) => clearSessionCookie(cookiesSecure, res)
  };
}

module.exports = { createGuards, SAFE_METHODS, PUBLIC_READS_STATEMENT };
