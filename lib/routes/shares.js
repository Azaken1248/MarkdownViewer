/* Publishing one document by link.
 *
 * A share token is a credential, so the read route takes no session, no cookie
 * and no CSRF check — the token is the whole authorisation. It is stored
 * hashed, which is why creating a share is the only moment the full token is
 * ever returned, and why re-creating one rotates it: rotation is the only way
 * to revoke a URL that has already leaked.
 *
 * The response is deliberately minimal. A shared document says nothing about
 * the library it came from: no folder, no neighbours, no user.
 */

const express = require("express");
const { actorOf, noAudit } = require("../audit");
const path = require("path");
const { toAbsoluteUrl } = require("../http/urls");
const { shareRefusal, NOT_VALID } = require("../share-access");
const { PUBLIC_AUDIENCE, GROUP_AUDIENCE_PREFIX } = require("../access");

/* Changing what a link allows.
 *
 * Its own function rather than another handler inside createSharesRoutes,
 * which the complexity budget had already filled: see docs/TESTING.md on the
 * budget, and the other route files for the same shape.
 */
function setWhatTheLinkAllows({ shareStore, audit, paramDocPath }) {
  return async (req, res, next) => {
    try {
      const fileName = paramDocPath(req);
      if (!fileName) {
        res.status(400).json({ error: "Invalid markdown file name" });
        return;
      }

      /* Three switches, each optional, at least one required. Exporting
       * hands the file over; the other two are about the reader's own copy of
       * the page and never reach the document. They are set in one request
       * because they are one dialog.
       */
      const asked = {
        allowExport: req.body?.allowExport,
        allowTicks: req.body?.allowTicks,
        allowInk: req.body?.allowInk
      };

      const named = Object.entries(asked).filter(([, value]) => value !== undefined);
      if (named.length === 0) {
        res.status(400).json({
          error: "Say which of allowExport, allowTicks or allowInk to change"
        });
        return;
      }

      const notBoolean = named.find(([, value]) => typeof value !== "boolean");
      if (notBoolean) {
        res.status(400).json({ error: `${notBoolean[0]} must be true or false` });
        return;
      }

      const changed = await shareStore.withLock(async () => {
        let touched = false;

        if (typeof asked.allowExport === "boolean") {
          touched = await shareStore.setExport(fileName, asked.allowExport) || touched;
        }

        if (typeof asked.allowTicks === "boolean" || typeof asked.allowInk === "boolean") {
          touched = await shareStore.setInteraction(fileName, {
            allowTicks: asked.allowTicks,
            allowInk: asked.allowInk
          }) || touched;
        }

        return touched;
      });

      if (!changed) {
        res.status(404).json({ error: "This document is not shared." });
        return;
      }

      /* One line per switch that was asked for, because the audit log is read
       * to answer "who opened this up", and a single "share.changed" would
       * mean reading the row beside it to find out what changed.
       */
      if (typeof asked.allowExport === "boolean") {
        audit(asked.allowExport ? "share.export.allowed" : "share.export.denied",
          { ...actorOf(req), file: fileName });
      }

      if (typeof asked.allowTicks === "boolean") {
        audit(asked.allowTicks ? "share.ticks.allowed" : "share.ticks.denied",
          { ...actorOf(req), file: fileName });
      }

      if (typeof asked.allowInk === "boolean") {
        audit(asked.allowInk ? "share.ink.allowed" : "share.ink.denied",
          { ...actorOf(req), file: fileName });
      }

      res.json({ file: fileName, share: shareStore.describe(fileName) });
    } catch (error) {
      next(error);
    }
  };
}

/* The audience a request is asking for, or a reason it cannot have one.
 *
 * Absent is not the same as `public`: it means the caller said nothing, and a
 * rotation that says nothing keeps the audience the link already had. So this
 * answers `null` for "unchanged" and leaves the store to decide what that is.
 */
function audienceAsked(req, accessStore) {
  const asked = req.body?.audience;
  if (asked === undefined) {
    return { audience: null };
  }

  if (typeof asked !== "string" || !accessStore.audienceExists(asked)) {
    return {
      // Spelled from the vocabulary rather than beside it, so the message
      // cannot drift from what is actually accepted.
      error: `audience must be "${PUBLIC_AUDIENCE}" or `
        + `"${GROUP_AUDIENCE_PREFIX}<name>" naming a group that exists`
    };
  }

  return { audience: asked };
}

function createSharesRoutes({
  markdownDir,
  shareStore,
  accessStore,
  audit = noAudit,
  requirePermission,
  requireAccess,
  getBaseUrl,
  fileExists,
  readCachedTextFile,
  paramDocPath,
  toDocTitle
}) {
  const router = express.Router();

  function shareUrlFor(req, token) {
    return toAbsoluteUrl(getBaseUrl(req), `/s/${token}`);
  }

  /* The links that exist, as far as the person asking can see.
   *
   * Filtered rather than refused, like any other collection: a list of links
   * to documents somebody cannot read would name those documents, which is
   * the one thing a closed space is for.
   */
  router.get("/api/shares", requirePermission("share:manage"), (req, res) => {
    const mayManage = req.access.filter("share:manage");
    res.json({ shares: shareStore.listShares().filter((share) => mayManage(share.file)) });
  });

  // Creating a share for a document that already has one rotates the token, which
  // is the only way to revoke a URL that has leaked.
  router.post("/api/docs/*file/share", requireAccess("share:manage", paramDocPath), async (req, res, next) => {
    try {
      const fileName = paramDocPath(req);
      if (!fileName) {
        res.status(400).json({ error: "Invalid markdown file name" });
        return;
      }

      if (!(await fileExists(path.join(markdownDir, fileName)))) {
        res.status(404).json({ error: "Markdown file not found" });
        return;
      }

      const asked = audienceAsked(req, accessStore);
      if (asked.error) {
        res.status(400).json({ error: asked.error });
        return;
      }

      // Who the link will be for once this has been applied: what the request
      // asked for, or what the link already said, or the world.
      const existing = shareStore.findByFile(fileName);
      const rotated = Boolean(existing);
      const audience = asked.audience || existing?.audience || PUBLIC_AUDIENCE;

      /* A space whose public links are switched off cannot have one made.
       *
       * The serving path asks this too, as a statement, so refusing here
       * changes no answer — it is so that nobody is handed a URL that was
       * never going to work. Read from the same place, because two copies of
       * the switch would be two answers to whether a space is published.
       */
      if (audience === PUBLIC_AUDIENCE && accessStore.publicLinkBlock(fileName).length > 0) {
        res.status(403).json({
          error: "This space does not allow links to be published publicly.",
          code: "public_links_closed"
        });
        return;
      }

      /* The event, not the token: the token is the credential and the audit
       * log is not where credentials go. Rotation is worth its own name,
       * because it is how a leaked link is revoked.
       *
       * With the audience, because "who was this published to" is the
       * question the line is read to answer, and `public` is a different
       * answer from a group.
       */
      audit(rotated ? "share.rotated" : "share.created",
        { ...actorOf(req), file: fileName, audience });
      const token = await shareStore.withLock(() => shareStore.create(fileName, {
        createdBy: req.auth.user.username,
        audience: asked.audience
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

  /* Whether the link lets a reader take a copy away.
   *
   * Its own route and its own setting: reading a document on a page and
   * carrying the file off are different decisions, and only the second one
   * leaves the library. Nothing turns it on but this.
   */
  /* What the link allows, changed. Exporting hands the file over; the other
   * two are about the reader's own copy of the page.
   */
  router.patch("/api/docs/*file/share", requireAccess("share:manage", paramDocPath),
    setWhatTheLinkAllows({ shareStore, audit, paramDocPath }));

  router.delete("/api/docs/*file/share", requireAccess("share:manage", paramDocPath), async (req, res, next) => {
    try {
      const fileName = paramDocPath(req);
      if (!fileName) {
        res.status(400).json({ error: "Invalid markdown file name" });
        return;
      }

      const revoked = await shareStore.withLock(() => shareStore.revoke(fileName));
      if (revoked) {
        audit("share.revoked", { ...actorOf(req), file: fileName });
      }

      res.json({ file: fileName, revoked });
    } catch (error) {
      next(error);
    }
  });

  // Public: the share token is the credential. No session, no cookie, no CSRF.
  router.get("/api/share/:token", async (req, res, next) => {
    try {
      const share = shareStore.findByToken(String(req.params.token || ""));
      if (!share) {
        res.status(NOT_VALID.status).json(NOT_VALID.json);
        return;
      }

      /* The token said which document and which audience; this is the part
       * that authorises. A link can stop working without being revoked — a
       * deny above it, a space closed to public links, an account that left
       * the group it was for — and the refusal a stranger gets is word for
       * word the one a made-up token gets, because anything else would
       * confirm the document is there.
       *
       * Before the disk is consulted, so that a closed link answers the same
       * way whatever is or is not on it: the message below says the document
       * was deleted, which is not something to tell somebody the policy has
       * just refused.
       */
      const refused = shareRefusal(req, share);
      if (refused) {
        res.status(refused.status).json(refused.json);
        return;
      }

      const fullPath = path.join(markdownDir, share.file);
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
        updatedAt: stat.mtime.toISOString(),
        /* What the page may offer, decided by whoever published the link. The
         * page asks; it does not assume — a control hidden by the client is a
         * permission enforced by the client.
         *
         * Exporting is enforced on the route as well, because it is a request
         * for the file. Ticks and ink are not requests at all: they happen in
         * the reader's own browser and there is nothing to enforce on a
         * server. What this says is what the owner chose to offer.
         */
        allowExport: share.allowExport,
        allowTicks: share.allowTicks,
        allowInk: share.allowInk
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createSharesRoutes };
