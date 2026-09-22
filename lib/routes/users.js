/* Accounts, administered by somebody who already has one.
 *
 * Every route here is behind user:manage, and two rules are enforced at this
 * layer rather than in the store because they are about the *caller*, not about
 * the record: you cannot delete your own account, and you cannot demote or
 * disable yourself. Locking yourself out of your own library is not a state
 * worth being able to reach by mistake.
 */

const express = require("express");
const { actorOf, noAudit } = require("../audit");
const { readBody } = require("../http/body");

function createUserRoutes({
  authStore,
  roles,
  requirePermission,
  audit = noAudit
}) {
  const router = express.Router();

  router.get("/api/users", requirePermission("user:manage"), (req, res) => {
    res.json({ users: authStore.listUsers(), roles });
  });

  router.post("/api/users", requirePermission("user:manage"), async (req, res, next) => {
    try {
      const body = readBody(req, {
        username: { type: "string", required: true },
        password: { type: "string", default: "" },
        role: { type: "string", default: "viewer" },
        // A password chosen by someone else is a password the account owner has
        // to replace before it means anything.
        mustChangePassword: { type: "boolean", default: true }
      });

      const result = await authStore.withLock(() => authStore.createUser(body));

      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }

      audit("user.created", { ...actorOf(req), target: result.user.username, role: result.user.role });
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
      const body = readBody(req, {
        role: { type: "string" },
        disabled: { type: "boolean" }
      });

      if (targetId === req.auth.user.id && body.role !== undefined && body.role !== "admin") {
        res.status(400).json({ error: "You cannot change your own role. Ask another admin." });
        return;
      }

      if (targetId === req.auth.user.id && body.disabled === true) {
        res.status(400).json({ error: "You cannot disable your own account." });
        return;
      }

      const result = await authStore.withLock(() => authStore.updateUser(targetId, body));

      if (!result.ok) {
        res.status(result.error === "No such user." ? 404 : 400).json({ error: result.error });
        return;
      }

      // Disabling and role changes are the two edits that change what an
      // account can do, and each gets its own name so it can be searched for.
      if (body.disabled !== undefined) {
        audit(body.disabled ? "user.disabled" : "user.enabled", { ...actorOf(req), target: result.user.username });
      }

      if (body.role !== undefined) {
        audit("user.role", { ...actorOf(req), target: result.user.username, role: result.user.role });
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
        readBody(req, { password: { type: "string", default: "" } }).password
      ));

      if (!result.ok) {
        res.status(result.error === "No such user." ? 404 : 400).json({ error: result.error });
        return;
      }

      audit("password.changed", { ...actorOf(req), by: "admin", target: result.user.username });
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

      const target = authStore.findById(String(req.params.id));
      const result = await authStore.withLock(() => authStore.deleteUser(String(req.params.id)));
      if (!result.ok) {
        res.status(result.error === "No such user." ? 404 : 400).json({ error: result.error });
        return;
      }

      audit("user.deleted", { ...actorOf(req), target: target?.username });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createUserRoutes };
