/* Everything this app answers with a page rather than with JSON.
 *
 * Three of them: the app shell, the standalone share view, and the diagram
 * editor. Plus the static files, and the two guards around them — public/docs
 * would otherwise be served as plain files straight past the read guard, and
 * the templates would be served as the placeholder-filled shells they are.
 *
 * The shell routes deliberately do NOT check whether the document exists.
 * Serving a shell for a real path and a 404 for an imaginary one would tell
 * anyone who asked — signed in or not — exactly which documents are in the
 * library, which is the one thing the read guard exists to prevent. Every
 * document-shaped path gets the same answer and the client says "not found"
 * after it asks the API as itself.
 */

const express = require("express");
const path = require("path");
const { toAbsoluteUrl } = require("../http/urls");
const { ALLOWED_DOC_EXTENSIONS, sanitizeDocPath, toDocTitle } = require("../docs/paths");
const excerpt = require("../excerpt");
const { SITE_NAME } = require("../site");

function createPagesRoutes({
  publicDir,
  markdownDir,
  diagramTemplatePath,
  shareStore,
  fileExists,
  readCachedTextFile,
  getBaseUrl,
  getIndexTemplate,
  getShareTemplate,
  buildEmbedMeta,
  renderIndexWithEmbedMeta,
  renderShareHtml,
  sendError
}) {
  const router = express.Router();

  // The standalone share view. One document, no explorer, no editor, no way back
  // into the library. noindex because "unguessable URL" stops being a control the
  // moment a crawler files it.
  // Everything a link preview needs about a shared document, derived from the
  // document itself rather than from the app.
  async function buildShareMeta(req, share) {
    const baseUrl = getBaseUrl(req);
    const fullPath = path.join(markdownDir, share.file);
    const { content, stat } = await readCachedTextFile(fullPath);

    const fallbackTitle = toDocTitle(share.file);
    const title = excerpt.extractTitle(share.file, content, fallbackTitle);
    const description = excerpt.extractDescription(share.file, content, {
      title,
      siteName: SITE_NAME
    });

    return {
      title,
      description,
      baseUrl,
      content,
      updatedAt: stat.mtime.toISOString()
    };
  }

  router.get("/s/:token", async (req, res, next) => {
    try {
      const token = String(req.params.token || "");
      const share = shareStore.findByToken(token);

      if (!share || !(await fileExists(path.join(markdownDir, share.file)))) {
        // A revoked link must not keep describing what used to be behind it, so
        // this is the generic page — no title, no excerpt, no card.
        await sendError(req, res, 404, {
          heading: "This share link is not valid",
          message: "It may have been revoked, or the document behind it may have been deleted.",
          detail: "Ask whoever sent it for a new link."
        });
        return;
      }

      const template = await getShareTemplate();
      const meta = await buildShareMeta(req, share);
      const shareUrl = toAbsoluteUrl(meta.baseUrl, `/s/${token}`);

      res.set("X-Robots-Tag", "noindex, nofollow");
      res.type("html").send(renderShareHtml(template, {
        title: meta.title,
        description: meta.description,
        baseUrl: meta.baseUrl,
        shareUrl,
        modifiedAt: meta.updatedAt
      }));
    } catch (error) {
      next(error);
    }
  });

  /* The app shell.
   *
   * /links is here beside the root because the saved links are a place in this
   * app, not a mode it can be put into: typing the address, refreshing it or
   * opening a bookmark has to land there. Documents get their own shell route
   * further down, after the static files.
   */
  router.get(["/", "/index.html", "/links"], async (req, res, next) => {
    try {
      const htmlTemplate = await getIndexTemplate();
      const embedMeta = buildEmbedMeta(req);
      const renderedHtml = renderIndexWithEmbedMeta(htmlTemplate, embedMeta);

      res.set("Cache-Control", "no-cache").type("html").send(renderedHtml);
    } catch (error) {
      next(error);
    }
  });

  // public/docs sits inside the static root, so express.static would happily
  // serve every document as a plain file — straight past requireRead and past the
  // share system. Documents are only ever available through the API.
  router.use("/docs", (req, res, next) => {
    sendError(req, res, 404).catch(next);
  });

  // share.html is a template, not a page: served directly it is a shell full of
  // __SHARE_*__ placeholders with no document behind it. It is only ever rendered
  // by the /s/:token route.
  // Both of these are templates, not pages: served directly they are shells full
  // of __SHARE_*__ / __ERROR_*__ placeholders. They are only ever rendered by the
  // routes that fill them in.
  router.get(["/share.html", "/error.html"], (req, res, next) => {
    sendError(req, res, 404).catch(next);
  });

  router.use(express.static(publicDir, { index: false }));

  /* The diagram editor, which is a page rather than a document.
   *
   * /diagram/doc/<path>#<block> is one mermaid fence inside a document, and
   * /diagram/file/<path> is a .mmd file that is all diagram. Both get the same
   * shell, and it goes and asks the API for the document as whoever is asking —
   * so this route, like the document shell below it, deliberately does not check
   * whether the document exists. Answering differently for a real path and an
   * imaginary one would tell anyone who asked exactly what is in the library.
   */
  router.get(/^\/diagram\/(?:doc|file)\/.+$/, (req, res, next) => {
    res.set("Cache-Control", "no-cache").sendFile(diagramTemplatePath, (error) => {
      if (error) {
        next(error);
      }
    });
  });

  /* A document has a real address.
   *
   * Opening one used to put it in the fragment — /#Notes/day-one.md — which meant
   * the address bar showed something no server ever saw, and a link pasted to
   * someone else worked only because the client picked the fragment back up. Now
   * the URL is the path: /Notes/day-one.md, pushed as you navigate and served
   * here when it is typed, refreshed or opened from a link.
   *
   * This sits after express.static so a real file always wins, and it answers
   * with the app shell rather than the document: which documents exist, and what
   * is in them, is the API's business and stays behind the session.
   *
   * It deliberately does NOT check whether the document exists. Serving the shell
   * for a real path and a 404 for an imaginary one would tell anyone who asked —
   * signed in or not — exactly which documents are in the library, which is the
   * one thing the whole read guard exists to prevent. So every document-shaped
   * path gets the same answer, and the client says "not found" after it asks the
   * API as itself.
   */
  const SHELL_RESERVED_PREFIXES = ["/api", "/s/", "/docs", "/oembed", "/graphql", "/healthz", "/diagram"];

  function wantsDocumentShell(req) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return false;
    }

    // An unfurler or a fetch() asking for JSON should not be handed a page.
    if (!req.accepts("html")) {
      return false;
    }

    const pathname = req.path;
    if (SHELL_RESERVED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix))) {
      return false;
    }

    let decoded = "";
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      // A malformed escape is not a document name.
      return false;
    }

    const wanted = decoded.replace(/^\/+/, "");

    // Only what this app could actually be holding. Anything else is a typo and
    // deserves the error page rather than an app shell that will not find it.
    if (!ALLOWED_DOC_EXTENSIONS.has(path.extname(wanted).toLowerCase())) {
      return false;
    }

    // And only a name the API could serve. A path with traversal, an empty
    // segment or a hidden directory in it is not a document this app will ever
    // open, so it should not get a shell that goes looking for one — one rule
    // for what a document path is, not two.
    return sanitizeDocPath(wanted) === wanted;
  }

  router.use(async (req, res, next) => {
    if (!wantsDocumentShell(req)) {
      next();
      return;
    }

    try {
      const htmlTemplate = await getIndexTemplate();
      res.set("Cache-Control", "no-cache")
        .type("html")
        .send(renderIndexWithEmbedMeta(htmlTemplate, buildEmbedMeta(req)));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createPagesRoutes };
