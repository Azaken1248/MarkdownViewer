/* Drawing an export that the page has already laid out.
 *
 * The one thing a browser tab cannot do for itself. Everything about how the
 * document looks was decided in the reader's browser — where the pages break,
 * what each sheet is, how the diagrams are fitted, where the ink sits — and
 * arrives here as one self-contained HTML file. This hands it to Chromium and
 * sends back the PDF.
 *
 * Who may ask:
 *   - anyone signed in, for a document they can already read;
 *   - anyone holding a share link that was published with exporting allowed.
 *
 * The second is the reason this is rate limited rather than merely
 * authenticated: a share link is a credential anybody may have, and starting a
 * browser is the most expensive thing this server does.
 */

const express = require("express");

// Big, because a document carries its fonts and its pictures with it: a
// hundred pages of notes with the whole of Inter embedded is a few megabytes.
// Small enough that it is a limit rather than a licence.
const MAX_DOCUMENT_BYTES = 48 * 1024 * 1024;

function createExportRoutes({ renderer, shareStore, requireRead, limit = null, audit = null }) {
  const router = express.Router();
  const body = express.json({ limit: MAX_DOCUMENT_BYTES, type: "application/json" });

  /* Either a session or a share link that allows it.
   *
   * requireRead answers the first. The second is checked here rather than
   * delegated, because "this token may export" is a different question from
   * "this token may read", and it is the one the owner of the document
   * answered when they published the link.
   */
  function mayExport(req, res, next) {
    const token = String(req.body?.share || "");
    const share = token ? shareStore.findByToken(token) : null;

    if (share && share.allowExport) {
      req.exporting = { share: share.file };
      next();
      return;
    }

    /* A link that does not allow exporting is a refusal for a stranger, not
     * for whoever is signed in. The owner reading their own share page is
     * still somebody who may read the document, and refusing them because
     * the link they happen to be looking at forbids it for everybody else
     * is a rule applied to the wrong person.
     */
    requireRead(req, res, next);
  }

  const steps = [limit, body, mayExport].filter(Boolean);

  router.post("/api/export/pdf", ...steps, async (req, res, next) => {
    try {
      const html = String(req.body?.html || "");
      if (!html) {
        res.status(400).json({ error: "Nothing to draw." });
        return;
      }

      if (!(await renderer.available())) {
        // Not an error the caller can fix, and one it has an answer for: the
        // page writes its own PDF when this is not here.
        res.status(503).json({ error: "No PDF renderer on this server.", code: "no_renderer" });
        return;
      }

      const pdf = await renderer.render(html);
      audit?.("export.pdf", {
        ...(req.auth?.user ? { actor: req.auth.user.username } : {}),
        ...(req.exporting?.share ? { file: req.exporting.share } : {}),
        bytes: pdf.length
      });

      res.set("Content-Type", "application/pdf");
      res.set("Content-Disposition", "attachment");
      // A document is one request's answer and nobody else's.
      res.set("Cache-Control", "no-store");
      res.send(pdf);
    } catch (error) {
      next(error);
    }
  });

  // Asked before the menu is built, so a deployment with no browser offers the
  // export the page can write instead of one that will fail.
  router.get("/api/export/able", async (req, res, next) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json({ pdf: await renderer.available() });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createExportRoutes, MAX_DOCUMENT_BYTES };
