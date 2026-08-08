/* Fetching a page the user typed the address of, and reading its title and
 * description off it.
 *
 * This is the only place in the app where the server makes a request to an
 * address someone else chose, which makes it the only place server-side request
 * forgery is possible. The server sits inside a network the person typing the
 * URL does not otherwise reach: other services on localhost, other machines on
 * the LAN, and — on a cloud host — the instance metadata endpoint at
 * 169.254.169.254, which hands out credentials to anything that asks. "Add a
 * link to http://169.254.169.254/latest/meta-data/iam/" must not become a way
 * to read them, and neither must "add a link to http://192.168.1.1/".
 *
 * So the address is checked, not the hostname. Four things follow from that:
 *
 *   Every candidate address is resolved and inspected before anything connects,
 *   and the inspection covers IPv6 and the IPv4-mapped forms of it, because
 *   ::ffff:127.0.0.1 is loopback written differently.
 *
 *   The check happens inside the socket lookup, not before it. Checking a
 *   hostname and then handing the same hostname to the HTTP client leaves a gap:
 *   a DNS server that answers with a public address and then a private one on
 *   the second query passes the check and connects somewhere else (DNS
 *   rebinding). Validating in `lookup` means the address that is approved is the
 *   address the socket gets.
 *
 *   Redirects are followed by hand, one hop at a time, each re-validated. A
 *   public URL that 302s to http://127.0.0.1:6379/ is the same attack with an
 *   extra step, and every HTTP client follows redirects by default.
 *
 *   Ports are restricted to 80 and 443. The address checks already cover the
 *   network, but this removes any use as a port scanner of the public internet:
 *   the difference between a refused connection and a timeout is information.
 *
 * Nothing here is a substitute for the request being authenticated — only an
 * account with doc:write can reach it — but an app that lets any signed-in user
 * fetch arbitrary URLs from inside the network is still handing out a proxy.
 */

const dns = require("dns");
const http = require("http");
const https = require("https");
const net = require("net");

const MAX_REDIRECTS = 4;
const REQUEST_TIMEOUT_MS = 8000;
// Metadata lives in <head>. A megabyte is far more than enough to reach it, and
// stopping there means a link to a 4GB file cannot exhaust memory.
const MAX_BYTES = 1024 * 1024;
const ALLOWED_PORTS = new Set([80, 443]);
const USER_AGENT = "AzaDocs link preview (+https://md.azaken.com)";

// A browser-shaped Accept, because some sites serve a different (or no) page to
// something that does not look like it wants HTML.
const ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

class LinkPreviewError extends Error {
  constructor(message, { status = 400 } = {}) {
    super(message);
    this.name = "LinkPreviewError";
    this.status = status;
  }
}

/* Everything that is not the public internet.
 *
 * Expressed as prefixes rather than a list of addresses, because the ranges are
 * what matter: 10.0.0.0/8 is a network, not an address.
 */
function isBlockedIPv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = parts;

  if (a === 0) return true;                                  // "this network"
  if (a === 10) return true;                                 // private
  if (a === 127) return true;                                // loopback
  if (a === 100 && b >= 64 && b <= 127) return true;         // carrier NAT
  if (a === 169 && b === 254) return true;                   // link-local, and
  //                                                            cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;          // private
  if (a === 192 && b === 0) return true;                     // protocol assign.
  if (a === 192 && b === 168) return true;                   // private
  if (a === 198 && (b === 18 || b === 19)) return true;       // benchmarking
  if (a === 198 && b === 51) return true;                    // documentation
  if (a === 203 && b === 0) return true;                     // documentation
  if (a >= 224) return true;                                 // multicast, and
  //                                                            everything
  //                                                            reserved above it
  return false;
}

function isBlockedIPv6(address) {
  const value = address.toLowerCase().split("%")[0];

  // ::ffff:127.0.0.1 and ::ffff:7f00:1 are loopback wearing a different hat.
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) {
    return isBlockedIPv4(mapped[1]);
  }

  if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(value)) {
    const [, high, low] = value.split(":").slice(-3);
    const packed = (parseInt(high, 16) << 16) | parseInt(low, 16);
    return isBlockedIPv4([packed >>> 24, (packed >>> 16) & 255, (packed >>> 8) & 255, packed & 255].join("."));
  }

  if (value === "::" || value === "::1") return true;         // unspecified, loopback
  if (value.startsWith("fe8") || value.startsWith("fe9")
    || value.startsWith("fea") || value.startsWith("feb")) return true;   // fe80::/10 link-local
  if (/^f[cd]/.test(value)) return true;                      // fc00::/7 unique-local
  if (value.startsWith("ff")) return true;                    // ff00::/8 multicast
  if (value.startsWith("64:ff9b:")) return true;              // NAT64, reaches v4
  if (value.startsWith("2002:")) return true;                 // 6to4, reaches v4
  if (value.startsWith("2001:0:") || value.startsWith("2001::")) return true;  // Teredo

  return false;
}

function isBlockedAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return isBlockedIPv4(address);
  if (family === 6) return isBlockedIPv6(address);
  return true;   // not an address at all: refuse rather than guess
}

/* The DNS lookup the request is given.
 *
 * Node calls this instead of dns.lookup, so whatever it approves is what the
 * socket connects to. That is the whole point: there is no window between the
 * check and the connection for the answer to change.
 */
function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) {
      callback(error);
      return;
    }

    const usable = addresses.filter((entry) => !isBlockedAddress(entry.address));

    if (usable.length === 0) {
      callback(new LinkPreviewError(
        "That address resolves inside a private network, so it cannot be fetched.",
        { status: 400 }
      ));
      return;
    }

    if (options && options.all) {
      callback(null, usable);
      return;
    }

    callback(null, usable[0].address, usable[0].family);
  });
}

/* Parse and vet one URL. Returns the parsed URL or throws. */
function parseTarget(rawUrl) {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) {
    throw new LinkPreviewError("Enter a URL.");
  }

  // A bare "example.com" is what people type, so assume https rather than
  // rejecting it. Anything with a scheme is taken at its word.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new LinkPreviewError("That is not a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    // file: reads the disk, and there is no shortage of other schemes that do
    // something surprising in a URL parser.
    throw new LinkPreviewError("Only http and https addresses can be added.");
  }

  if (url.username || url.password) {
    // Credentials in a URL are either a mistake or an attempt to get the server
    // to authenticate somewhere on the user's behalf. Neither is worth storing.
    throw new LinkPreviewError("Remove the username and password from the URL.");
  }

  const port = url.port ? Number(url.port) : (url.protocol === "https:" ? 443 : 80);
  if (!ALLOWED_PORTS.has(port)) {
    throw new LinkPreviewError("Only the standard web ports (80 and 443) can be fetched.");
  }

  // A literal address is checked here as well as in the lookup, because no DNS
  // query happens for one.
  if (net.isIP(url.hostname.replace(/^\[|\]$/g, "")) && isBlockedAddress(url.hostname.replace(/^\[|\]$/g, ""))) {
    throw new LinkPreviewError("That address is inside a private network, so it cannot be fetched.");
  }

  return url;
}

/* One hop. Resolves to either a redirect target or a body. */
function requestOnce(url) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;

    const request = transport.request(url, {
      method: "GET",
      lookup: guardedLookup,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: ACCEPT,
        // No cookies, no auth, and no hint about who asked.
        "Accept-Language": "en",
        Connection: "close"
      },
      timeout: REQUEST_TIMEOUT_MS
    }, (response) => {
      const status = response.statusCode || 0;
      const location = response.headers.location;

      if (status >= 300 && status < 400 && location) {
        response.destroy();
        resolve({ redirectTo: location });
        return;
      }

      if (status < 200 || status >= 300) {
        response.destroy();
        reject(new LinkPreviewError(`That site answered ${status}.`, { status: 502 }));
        return;
      }

      const type = String(response.headers["content-type"] || "");
      if (type && !/^\s*(text\/html|application\/xhtml\+xml|text\/plain)/i.test(type)) {
        // Not a page. Stopping here also means an image or an archive is never
        // pulled into memory.
        response.destroy();
        resolve({ body: "", contentType: type });
        return;
      }

      let body = "";
      let bytes = 0;

      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        bytes += Buffer.byteLength(chunk, "utf8");
        body += chunk;

        if (bytes >= MAX_BYTES) {
          // Everything worth reading is in <head>; the rest is not worth the
          // memory, and a response with no end is not worth waiting for.
          response.destroy();
        }
      });

      response.on("end", () => resolve({ body, contentType: type }));
      response.on("close", () => resolve({ body, contentType: type }));
      response.on("error", reject);
    });

    request.on("timeout", () => {
      request.destroy(new LinkPreviewError("That site took too long to answer.", { status: 504 }));
    });

    request.on("error", (error) => {
      if (error instanceof LinkPreviewError) {
        reject(error);
        return;
      }

      if (error.code === "ENOTFOUND" || error.code === "EAI_AGAIN") {
        reject(new LinkPreviewError("That domain could not be found.", { status: 400 }));
        return;
      }

      reject(new LinkPreviewError("That site could not be reached.", { status: 502 }));
    });

    request.end();
  });
}

/* Follow up to MAX_REDIRECTS hops, vetting each one.
 *
 * `request` is a parameter so the redirect rules can be tested without a
 * network: what matters here is that every hop goes back through parseTarget,
 * and that is worth proving rather than reading.
 */
async function fetchPage(startUrl, request = requestOnce) {
  let url = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const result = await request(url);

    if (!result.redirectTo) {
      return { url, body: result.body || "" };
    }

    let next;
    try {
      next = new URL(result.redirectTo, url);
    } catch {
      throw new LinkPreviewError("That site redirected somewhere invalid.", { status: 502 });
    }

    // The hop goes through exactly the same gate as the address that was typed.
    // Without this, any public URL is a way to reach anything.
    url = parseTarget(next.href);
  }

  throw new LinkPreviewError("That site redirected too many times.", { status: 502 });
}

function decodeEntities(value) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z0-9#]+);/gi, (whole, name) => named[name.toLowerCase()] ?? whole);
}

function collapse(value) {
  return decodeEntities(String(value || "")).replace(/\s+/g, " ").trim();
}

/* Pull one meta tag's content.
 *
 * Attribute order is not fixed — `<meta content="..." property="og:title">` is
 * as valid as the other way round — so both orders are tried rather than
 * assuming the common one.
 */
function metaContent(html, attribute, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+${attribute}=["']${escaped}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*${attribute}=["']${escaped}["']`, "i")
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && collapse(match[1])) {
      return collapse(match[1]);
    }
  }

  return "";
}

/* Title and description, in the order of preference a link unfurler uses.
 *
 * og: first because it is what the author wrote for exactly this purpose, then
 * twitter:, then the ordinary <title> and description, then the host — so a page
 * with no metadata at all still produces a usable card rather than a blank one.
 */
function extractMetadata(html, url) {
  const head = html.slice(0, 400000);

  const title = metaContent(head, "property", "og:title")
    || metaContent(head, "name", "og:title")
    || metaContent(head, "name", "twitter:title")
    || collapse((head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "")
    || url.hostname;

  const description = metaContent(head, "property", "og:description")
    || metaContent(head, "name", "og:description")
    || metaContent(head, "name", "twitter:description")
    || metaContent(head, "name", "description")
    || "";

  const siteName = metaContent(head, "property", "og:site_name")
    || metaContent(head, "name", "og:site_name")
    || "";

  return {
    title: title.slice(0, 300),
    description: description.slice(0, 600),
    siteName: siteName.slice(0, 120)
  };
}

/* The whole job: vet, fetch, parse.
 *
 * A page that cannot be read is not an error — the link is still worth keeping.
 * The caller gets a record with the hostname as the title and `fetched: false`,
 * so the card says what it knows instead of refusing to save anything. Only a
 * URL that should never be fetched at all throws.
 */
async function describeUrl(rawUrl) {
  const url = parseTarget(rawUrl);

  let page;
  try {
    page = await fetchPage(url);
  } catch (error) {
    if (error instanceof LinkPreviewError && error.status === 400) {
      throw error;   // refused on purpose; the user needs to hear why
    }

    return {
      url: url.href,
      title: url.hostname,
      description: "",
      siteName: "",
      fetched: false,
      error: error instanceof LinkPreviewError ? error.message : "That site could not be read.",
      fetchedAt: new Date().toISOString()
    };
  }

  const metadata = extractMetadata(page.body, page.url);

  return {
    url: url.href,
    // The address that was typed is what is stored and shown. A redirect chain
    // is how the page was reached, not what the person meant to save.
    resolvedUrl: page.url.href !== url.href ? page.url.href : null,
    ...metadata,
    fetched: true,
    error: null,
    fetchedAt: new Date().toISOString()
  };
}

module.exports = {
  describeUrl,
  parseTarget,
  fetchPage,
  extractMetadata,
  isBlockedAddress,
  isBlockedIPv4,
  isBlockedIPv6,
  LinkPreviewError,
  MAX_REDIRECTS,
  MAX_BYTES,
  REQUEST_TIMEOUT_MS
};
