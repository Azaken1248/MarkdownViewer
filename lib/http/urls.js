/* Which origin this app believes it is served from.
 *
 * Canonical, og:*, oEmbed and share URLs are all built from this rather than
 * from the request, because a Host header is something a client sends. The
 * order below is the whole point: a configured origin beats a compiled-in
 * default, which beats anything derived from the request.
 */

function isAbsoluteHttpUrl(value) {
  if (!value) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function toAbsoluteUrl(baseUrl, routePath) {
  return new URL(routePath, `${baseUrl}/`).toString();
}

// The default origin and the port are the server's own configuration, so they
// are passed in once here rather than read from the environment at every call.
function createBaseUrlResolver({ defaultBaseUrl, port }) {
  return function getBaseUrlFromRequest(req) {
    const configuredBaseUrl = String(process.env.PUBLIC_BASE_URL || "").trim();
    if (isAbsoluteHttpUrl(configuredBaseUrl)) {
      return configuredBaseUrl.replace(/\/+$/, "");
    }

    // A known public origin beats anything derived from the request. This is the
    // strongest form of the host-header defence: there is no header to spoof.
    if (isAbsoluteHttpUrl(defaultBaseUrl)) {
      return defaultBaseUrl.replace(/\/+$/, "");
    }

    if (!req) {
      return `http://localhost:${port}`;
    }

    // req.protocol/req.hostname already honour X-Forwarded-* only when the
    // "trust proxy" setting says the hop is trusted, so read them instead of
    // the raw headers. Untrusted clients can still send a Host header, so the
    // result is only used when PUBLIC_BASE_URL is not configured.
    const protocol = req.protocol || "http";
    const host = req.get("host") || `localhost:${port}`;

    return `${protocol}://${host}`;
  };
}

module.exports = { isAbsoluteHttpUrl, toAbsoluteUrl, createBaseUrlResolver };
