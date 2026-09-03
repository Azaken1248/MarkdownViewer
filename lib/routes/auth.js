/* Signing in, signing out, and changing your own password.
 *
 * Every one of these ends by answering with the session payload, so the client
 * never has to guess what changed underneath it. The store does the deciding —
 * lockout, timing, hashing all live in lib/auth.js — and these three routes are
 * only the HTTP shape around it.
 */

const express = require("express");

function createAuthRoutes({
  authStore,
  requireAuth,
  sessionPayload,
  issueSessionCookie,
  clearSessionCookie
}) {
  const router = express.Router();

  router.get("/api/session", (req, res) => {
    res.json(sessionPayload(req));
  });

  router.post("/api/auth/login", async (req, res, next) => {
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

  router.post("/api/auth/logout", async (req, res, next) => {
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
  router.post("/api/auth/password", requireAuth, async (req, res, next) => {
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

  return router;
}

module.exports = { createAuthRoutes };
