/* Accounts, administered by somebody who already has one.
 *
 * Every route here is behind user:manage, and two rules are enforced at this
 * layer rather than in the store because they are about the *caller*, not about
 * the record: you cannot delete your own account, and you cannot demote or
 * disable yourself. Locking yourself out of your own library is not a state
 * worth being able to reach by mistake.
 */

const express = require("express");

function createUserRoutes({
  authStore,
  roles,
  requirePermission
}) {
  const router = express.Router();

  router.get("/api/users", requirePermission("user:manage"), (req, res) => {
    res.json({ users: authStore.listUsers(), roles });
  });

  router.post("/api/users", requirePermission("user:manage"), async (req, res, next) => {
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

  router.patch("/api/users/:id", requirePermission("user:manage"), async (req, res, next) => {
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

  router.post("/api/users/:id/password", requirePermission("user:manage"), async (req, res, next) => {
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

  router.delete("/api/users/:id", requirePermission("user:manage"), async (req, res, next) => {
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

  return router;
}

module.exports = { createUserRoutes };
