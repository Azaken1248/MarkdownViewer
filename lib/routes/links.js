/* Saved links
 *
 * Reading the list is a read; adding, editing and removing are writes, so they
 * sit behind doc:write like everything else that changes the library.
 *
 * Adding and refreshing also make the server fetch a URL someone else chose,
 * which is the one outbound request this app makes. lib/link-preview.js decides
 * what may be fetched; the limit below decides how often, so an account cannot
 * use this as a general-purpose proxy or a scanner.
 */

const express = require("express");
const crypto = require("crypto");
const linkPreview = require("../link-preview");

function createLinksRoutes({
  linkStore,
  requireRead,
  requirePermission
}) {
  const router = express.Router();

  const LINK_FETCH_WINDOW_MS = 60_000;
  const LINK_FETCH_MAX_PER_WINDOW = 20;
  const linkFetchLog = new Map();

  /* Claim up to `wanted` fetches from this account's budget.
   *
   * Returns how many were actually available, which is how the batch route
   * decides how much work to do rather than starting more than it is allowed to
   * finish and collecting a 429 half way through.
   */
  function takeLinkFetchSlots(req, wanted) {
    const key = req.auth?.user?.id || req.ip || "anonymous";
    const now = Date.now();
    const recent = (linkFetchLog.get(key) || []).filter((at) => now - at < LINK_FETCH_WINDOW_MS);
    const granted = Math.max(0, Math.min(wanted, LINK_FETCH_MAX_PER_WINDOW - recent.length));

    for (let taken = 0; taken < granted; taken += 1) {
      recent.push(now);
    }

    linkFetchLog.set(key, recent);

    // The map is keyed by account, so it cannot grow without bound in normal use,
    // but a long-running process should not keep dead entries either.
    if (linkFetchLog.size > 500) {
      for (const [id, times] of linkFetchLog) {
        if (times.every((at) => now - at >= LINK_FETCH_WINDOW_MS)) {
          linkFetchLog.delete(id);
        }
      }
    }

    return granted;
  }

  function throttleLinkFetch(req, res) {
    if (takeLinkFetchSlots(req, 1) === 1) {
      return true;
    }

    res.status(429).json({
      error: "Too many links fetched just now. Wait a minute and try again."
    });
    return false;
  }

  /* A link as the client sees it.
   *
   * The icon is stored with the link but is not sent with it. Favicons are
   * mostly a couple of kilobytes and occasionally a hundred — one site here uses
   * a full illustration as its icon — and carrying them inside the list meant a
   * five-kilobyte answer became a two-hundred-kilobyte one, downloaded again
   * every time the pane was opened for the first time in a tab, before a single
   * card could be drawn.
   *
   * So the list carries an address instead, and the browser fetches and caches
   * the pictures as pictures. The address ends in a hash of the bytes, which is
   * what makes it safe to cache them for a long time: re-read a page, get a
   * different icon, get a different address.
   *
   * Still this server's own address. The reason the icon is stored at all is so
   * that opening this pane does not announce itself to every site in the list.
   */
  /* Remembered per link, because listing them would otherwise hash every icon
   * on every request: a full library is a couple of hundred megabytes of hashing
   * to answer a question whose answer has not changed. Keyed by id and checked
   * against the icon it was computed from, so a re-read that brings back a
   * different picture gets a different tag. Bounded by the store's own limit on
   * how many links there can be. */
  const iconTags = new Map();

  function iconTag(link) {
    const cached = iconTags.get(link.id);
    if (cached && cached.icon === link.icon) {
      return cached.tag;
    }

    const tag = crypto.createHash("sha1").update(link.icon).digest("base64url").slice(0, 12);
    iconTags.set(link.id, { icon: link.icon, tag });
    return tag;
  }

  function publicLink(link) {
    // undefined means no icon has ever been fetched for this link, and the
    // client tells that apart from "" — fetched, and the site had none — to
    // decide what still needs asking. A record with no icon key is already the
    // first of those, so it goes through untouched.
    if (link.icon === undefined) {
      return link;
    }

    return {
      ...link,
      icon: link.icon ? `/api/links/${encodeURIComponent(link.id)}/icon?v=${iconTag(link)}` : ""
    };
  }

  function publicLinks(links) {
    return links.map(publicLink);
  }

  /* The bytes themselves.
   *
   * Behind requireRead like everything else: the addresses someone keeps are as
   * much a part of a private library as the documents are.
   */
  router.get("/api/links/:id/icon", requireRead, (req, res, next) => {
    try {
      const link = linkStore.find(String(req.params.id || ""));
      if (!link || !link.icon) {
        res.status(404).json({ error: "No icon for that link." });
        return;
      }

      const match = /^data:([a-z0-9/+.-]+);base64,(.*)$/i.exec(link.icon);
      if (!match) {
        res.status(404).json({ error: "No icon for that link." });
        return;
      }

      // The tag is ours rather than one derived from the response body, so it
      // is the same value the address already carries. Answering a matching
      // If-None-Match with a 304 is then res.send()'s own job, which it does
      // once an ETag is set.
      res.setHeader("ETag", `"${iconTag(link)}"`);
      // Private, because the library is. A year is safe because the address
      // carries the hash: different bytes are a different address.
      res.setHeader("Cache-Control", "private, max-age=31536000, immutable");

      const body = Buffer.from(match[2], "base64");
      res.type(match[1]).send(body);
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/links", requireRead, (req, res) => {
    // Groups travel with the list rather than on their own route: the chip bar is
    // derived from the links, so a second request could only ever disagree.
    res.json({ links: publicLinks(linkStore.list()), groups: linkStore.groups() });
  });

  router.post("/api/links", requirePermission("doc:write"), async (req, res, next) => {
    try {
      if (!throttleLinkFetch(req, res)) {
        return;
      }

      const preview = await linkPreview.describeUrl(req.body?.url);
      const link = await linkStore.withLock(() => linkStore.create(preview, {
        createdBy: req.auth?.user?.username || null,
        note: req.body?.note,
        groups: req.body?.groups
      }));

      res.status(201).json({ link: publicLink(link), groups: linkStore.groups() });
    } catch (error) {
      if (error instanceof linkPreview.LinkPreviewError || error.status) {
        res.status(error.status || 400).json({ error: error.message, existingId: error.existingId });
        return;
      }

      next(error);
    }
  });

  // Editing the card by hand, and re-reading the page, are the same route: both
  // are "change what this card says". `refresh: true` asks for the second.
  router.patch("/api/links/:id", requirePermission("doc:write"), async (req, res, next) => {
    try {
      const link = linkStore.find(String(req.params.id || ""));
      if (!link) {
        res.status(404).json({ error: "No such link." });
        return;
      }

      let changes = {
        title: req.body?.title,
        description: req.body?.description,
        note: req.body?.note,
        groups: req.body?.groups
      };

      if (req.body?.refresh) {
        if (!throttleLinkFetch(req, res)) {
          return;
        }

        // Re-reading the page replaces what the page said. It must not touch how
        // the link was filed, so the groups are carried across explicitly.
        const preview = await linkPreview.describeUrl(link.url);
        changes = { ...preview, groups: req.body?.groups };
      }

      const updated = await linkStore.withLock(() => linkStore.update(link.id, changes));
      res.json({ link: publicLink(updated), groups: linkStore.groups() });
    } catch (error) {
      if (error instanceof linkPreview.LinkPreviewError || error.status) {
        res.status(error.status || 400).json({ error: error.message });
        return;
      }

      next(error);
    }
  });

  /* Icons for the links that have never had one fetched.
   *
   * A route rather than the client doing this a link at a time. Seven PATCHes
   * meant seven round trips, seven page reads and seven whole rewrites of
   * links.json with an fsync each, in a strict queue — the icons trickled in over
   * about ten seconds. Here the pages are read a few at a time and the file is
   * written once.
   *
   * It touches nothing but the icon. Re-reading a page also replaces its title
   * and description, which would quietly undo a title someone had corrected by
   * hand — and correcting a title is the one thing editing a card is for.
   */
  const ICON_BATCH_CONCURRENCY = 4;

  router.post("/api/links/icons", requirePermission("doc:write"), async (req, res, next) => {
    try {
      const pending = linkStore.needingIcons();

      // Bounded by what this account may still fetch this minute, so a large
      // library comes in over a few visits rather than half-failing on one.
      const budget = takeLinkFetchSlots(req, pending.length);
      const batch = pending.slice(0, budget);

      if (batch.length === 0) {
        res.json({ links: publicLinks(linkStore.list()), groups: linkStore.groups(), fetched: 0, remaining: pending.length });
        return;
      }

      const queue = [...batch];
      const answers = [];

      const worker = async () => {
        for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
          const link = linkStore.find(id);
          if (!link) {
            continue;
          }

          answers.push({ id, icon: await linkPreview.iconForUrl(link.url) });
        }
      };

      await Promise.all(Array.from({ length: ICON_BATCH_CONCURRENCY }, worker));
      await linkStore.withLock(() => linkStore.setIcons(answers));

      res.json({
        links: publicLinks(linkStore.list()),
        groups: linkStore.groups(),
        fetched: answers.filter((answer) => answer.icon).length,
        remaining: linkStore.needingIcons().length
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/api/links/:id", requirePermission("doc:write"), async (req, res, next) => {
    try {
      const removed = await linkStore.withLock(() => linkStore.remove(String(req.params.id || "")));
      if (!removed) {
        res.status(404).json({ error: "No such link." });
        return;
      }

      res.json({ removed: true, groups: linkStore.groups() });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createLinksRoutes };
