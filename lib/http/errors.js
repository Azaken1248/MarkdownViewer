/* Error responses.
 *
 * One place decides what an error looks like, and it depends on who is asking.
 * An API client wants JSON; a person who mistyped a URL wants a page. Express's
 * default for the second case is a bare `Cannot GET /nope` in Times New Roman.
 *
 * Nothing here reveals more than the reader already knows. A 500 says a 500
 * happened; the stack goes to the log, not the page.
 */

const multer = require("multer");
const { templateReader, fillTemplate } = require("./html");
const { toAbsoluteUrl } = require("./urls");

// Thrown anywhere, answered in one place: a route that knows the status it
// wants throws this instead of writing the response itself.
class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const ERROR_PRESETS = {
  400: { icon: "ph-warning-circle", heading: "That request did not make sense", message: "Something about the address or the data sent with it was malformed." },
  401: { icon: "ph-lock-simple", heading: "You need to sign in", message: "This library is private. Sign in to continue." },
  403: { icon: "ph-prohibit", heading: "Not allowed", message: "Your account does not have permission to do that." },
  404: { icon: "ph-compass", heading: "There is nothing here", message: "The page you asked for does not exist, or the link that brought you here is no longer valid." },
  413: { icon: "ph-file-x", heading: "That file is too large", message: "Documents are limited to 2MB." },
  429: { icon: "ph-hourglass-medium", heading: "Too many attempts", message: "Wait a little while before trying again." },
  500: { icon: "ph-bug", heading: "Something went wrong on our side", message: "The error has been logged. Trying again is usually worth a shot." },
  503: { icon: "ph-plugs", heading: "Temporarily unavailable", message: "The server is up but something it depends on is not. Try again shortly." }
};

// Does this look like a browser navigating, or a program calling an API?
// Anything under /api is always JSON regardless of what it claims to accept —
// a fetch() with a default Accept header would otherwise be handed a web page.
function wantsHtmlError(req) {
  if (req.path.startsWith("/api/") || req.path === "/healthz" || req.path === "/graphql" || req.path === "/oembed") {
    return false;
  }

  if (req.xhr) {
    return false;
  }

  return req.accepts(["html", "json"]) === "html";
}

/* Everything an error page needs that this module cannot know on its own —
 * where the template is, what the site is called, which origin to build links
 * against — arrives once, here. The three middlewares handed back share it.
 */
function createErrorPages({
  templatePath,
  siteName,
  faviconPath,
  themeColor,
  getBaseUrl,
  maxDocBytes,
  maxAssetBytes
}) {
  const readErrorTemplate = templateReader(templatePath);

  function renderErrorHtml(template, { status, heading, message, detail, icon, baseUrl }) {
    return fillTemplate(template, {
      __ERROR_STATUS__: String(status),
      __ERROR_TITLE__: `${status} · ${heading} | ${siteName}`,
      __ERROR_HEADING__: heading,
      __ERROR_MESSAGE__: message,
      __ERROR_DETAIL__: detail || "",
      __ERROR_ICON__: icon,
      __ERROR_FAVICON_URL__: toAbsoluteUrl(baseUrl, faviconPath),
      __ERROR_THEME_COLOR__: themeColor
    });
  }

  async function sendError(req, res, status, { heading, message, detail, code } = {}) {
    const preset = ERROR_PRESETS[status] || ERROR_PRESETS[500];
    const resolved = {
      status,
      icon: preset.icon,
      heading: heading || preset.heading,
      message: message || preset.message,
      detail
    };

    if (res.headersSent) {
      return;
    }

    if (!wantsHtmlError(req)) {
      res.status(status).json({
        error: resolved.message,
        ...(code ? { code } : {})
      });
      return;
    }

    try {
      const template = await readErrorTemplate();
      res.status(status).type("html").send(renderErrorHtml(template, {
        ...resolved,
        baseUrl: getBaseUrl(req)
      }));
    } catch (templateError) {
      // The error page itself failed. Say so in plain text rather than recursing.
      console.error("Failed to render the error page", templateError);
      res.status(status).type("text/plain").send(`${status} ${resolved.heading}`);
    }
  }

  // Nothing matched. Without this, Express answers a mistyped URL with a bare
  // "Cannot GET /nope" in the browser's default serif.
  function notFound() {
    return (req, res, next) => {
      sendError(req, res, 404, {
        detail: `No route for ${req.method} ${req.path}`
      }).catch(next);
    };
  }

  // Four parameters is how Express recognises error middleware, so `_next` has
  // to stay in the signature even though nothing calls it.
  function errorHandler() {
    return (error, req, res, _next) => {
      if (error instanceof HttpError) {
        void sendError(req, res, error.statusCode, { message: error.message });
        return;
      }

      // express.json() rejects oversized bodies before our own size check runs.
      if (error?.type === "entity.too.large") {
        void sendError(req, res, 413, { message: "File content exceeds the 2MB limit" });
        return;
      }

      if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") {
          // Two limits share this handler: documents and pasted images. Quoting
          // the wrong one at somebody is worse than quoting none.
          const limit = req.path === "/api/assets" ? maxAssetBytes : maxDocBytes;
          void sendError(req, res, 413, {
            message: `Uploaded file exceeds ${Math.round(limit / (1024 * 1024))}MB limit`
          });
          return;
        }

        void sendError(req, res, 400, { message: error.message || "Upload failed" });
        return;
      }

      if (error && (error.message === "Only .md, .markdown, .mmd, .mermaid, or .ipynb files are supported"
        || error.message === "Only PNG, JPEG, GIF, WebP and AVIF images can be attached")) {
        void sendError(req, res, 400, { message: error.message });
        return;
      }

      // The stack goes to the log. The reader gets a status and nothing else: an
      // error page is not the place to publish internals.
      console.error(error);
      void sendError(req, res, 500);
    };
  }

  return { sendError, notFound, errorHandler };
}

module.exports = { HttpError, ERROR_PRESETS, wantsHtmlError, createErrorPages };
