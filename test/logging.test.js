/* What a request leaves behind: an id, a line, and a number.
 *
 * The three things this covers were each missing for the same reason — the
 * log was prose written for a person reading a terminal, and nothing else
 * could use it. A 500 could not be tied to the stack trace printed beside it,
 * the volume could not be turned down without a deploy, and nothing counted
 * anything.
 *
 * The privacy rule is the part worth guarding hardest, so it is checked as a
 * rule rather than as an example: no query string, no body, no header, in
 * either format. A search term is the contents of somebody's document.
 */

const { createLog, requestIds, requestLogger, newRequestId } = require("../lib/http/logging.js");
const { createMetrics } = require("../lib/metrics.js");
const { createLruCache } = require("../lib/lru.js");
const { startTestServer } = require("./helpers/server.js");
const { createChecker } = require("./helpers/check.js");

const { check, finish } = createChecker("LOGGING");

// A logger writing into an array, which is the whole of the test harness this
// needs: `out` and `errorOut` are streams only in that they have write().
function captured(options = {}) {
  const out = [];
  const errorOut = [];
  const log = createLog({
    ...options,
    out: { write: (line) => out.push(line) },
    errorOut: { write: (line) => errorOut.push(line) }
  });

  return { log, out, errorOut };
}

(async () => {
  console.log("=== a request gets a name, and the name comes back ===");

  const ids = new Set(Array.from({ length: 500 }, () => newRequestId()));
  check("ids are not reused", ids.size, 500);
  check("...and are safe to put in a log line",
    [...ids].every((id) => /^[0-9a-f]{16}$/.test(id)), true);

  /* The inbound header is honoured exactly as far as X-Forwarded-* is, which
   * is the same trust decision and so the same switch. With no proxy, a client
   * that names its own request does not get to — otherwise it chooses what the
   * log says, and can put a newline in it.
   */
  const ran = (middleware, headers = {}) => {
    const req = { get: (name) => headers[name.toLowerCase()] };
    const res = { headers: {}, setHeader(name, value) { this.headers[name] = value; } };
    middleware(req, res, () => {});
    return { req, res };
  };

  const trusted = ran(requestIds({ trustProxy: true }), { "x-request-id": "from-the-proxy" });
  check("behind a proxy, the id the proxy gave it is kept", trusted.req.id, "from-the-proxy");

  const untrusted = ran(requestIds({ trustProxy: false }), { "x-request-id": "from-the-proxy" });
  check("with no proxy, a client does not get to name its own request",
    untrusted.req.id === "from-the-proxy", false);

  const forged = ran(requestIds({ trustProxy: true }),
    { "x-request-id": "ok\nts=2020-01-01 level=info msg=\"nothing happened\"" });
  check("...and a proxy cannot pass on an id with a newline in it",
    /[\n\r]/.test(forged.req.id), false);

  check("the id is echoed, so somebody can quote it",
    trusted.res.headers["X-Request-Id"], "from-the-proxy");

  console.log("=== the volume comes down without a deploy ===");

  const quiet = captured({ level: "warn" });
  quiet.log.debug("a");
  quiet.log.info("b");
  quiet.log.warn("c");
  quiet.log.error("d");
  check("below the level, nothing is written", quiet.out, []);
  check("...at or above it, everything is", quiet.errorOut.length, 2);

  const loud = captured({ level: "debug" });
  loud.log.debug("a");
  check("debug says something when asked for", loud.out.length, 1);

  const normal = captured();
  normal.log.info("a");
  normal.log.warn("b");
  check("info and above is the default", [normal.out.length, normal.errorOut.length], [1, 1]);
  check("warnings and errors go to stderr, so a pipeline can split them",
    normal.errorOut[0].includes("WARN"), true);

  console.log("=== and the line can be data ===");

  const json = captured({ format: "json" });
  json.log.info("GET /api/docs", { status: 200, ms: "3.4", id: "abc", user: "aza" });
  const parsed = JSON.parse(json.out[0]);
  check("json is one object per line",
    [parsed.level, parsed.msg, parsed.status, parsed.id, parsed.user],
    ["info", "GET /api/docs", 200, "abc", "aza"]);
  check("...with a timestamp that parses", Number.isFinite(Date.parse(parsed.ts)), true);

  const text = captured();
  text.log.info("GET /api/docs", { status: 200, id: "abc", user: undefined });
  check("text is still one line a person can read",
    /GET \/api\/docs status=200 id=abc$/.test(text.out[0].trim()), true);
  check("...and a field with nothing in it is left out entirely",
    text.out[0].includes("user="), false);

  console.log("=== what a line may never carry ===");

  /* The middleware, given a request with the things that must not be logged
   * on it. Everything here is either somebody's document or their credential.
   */
  const secrets = captured({ format: "json" });
  const req = {
    method: "GET",
    path: "/api/docs/search",
    url: "/api/docs/search?q=my+private+search+term",
    query: { q: "my private search term" },
    body: { content: "# The contents of a document" },
    headers: { cookie: "session=super-secret-token", authorization: "Bearer another-secret" },
    get: () => undefined,
    id: "abc",
    auth: { user: { username: "aza", id: "user_1" } }
  };

  let finished = () => {};
  const res = { statusCode: 200, on: (event, fn) => { if (event === "finish") finished = fn; } };
  requestLogger({ log: secrets.log })(req, res, () => {});
  finished();

  const written = secrets.out.join("");
  check("(a line was written)", written.length > 0, true);
  for (const [what, secret] of [
    ["the query string", "my+private+search+term"],
    ["the search terms", "my private search term"],
    ["the document", "The contents of a document"],
    ["the session cookie", "super-secret-token"],
    ["the authorization header", "another-secret"]
  ]) {
    check(`${what} is not in it`, written.includes(secret), false);
  }

  check("who did it is, because that is the question being asked",
    JSON.parse(written).user, "aza");

  console.log("=== a static asset is counted and not written ===");

  const quietStatic = captured();
  const counted = [];
  const assetReq = { method: "GET", path: "/js/app.js", get: () => undefined, id: "x" };
  let assetFinished = () => {};
  const assetRes = { statusCode: 200, on: (event, fn) => { if (event === "finish") assetFinished = fn; } };
  requestLogger({
    log: quietStatic.log,
    onFinished: (one) => counted.push(one)
  })(assetReq, assetRes, () => {});
  assetFinished();

  check("no line for an asset", quietStatic.out, []);
  check("...but it happened, and was counted", counted.length, 1);

  console.log("=== the caches say whether their budgets were right ===");

  const cache = createLruCache(100);
  cache.get("a");
  cache.set("a", { v: 1 }, 40);
  cache.get("a");
  cache.get("a");
  cache.set("b", { v: 2 }, 40);
  cache.set("c", { v: 3 }, 40);

  const stats = cache.stats();
  check("hits are counted", stats.hits, 2);
  check("...and misses", stats.misses, 1);
  check("...and what had to be dropped to stay under budget", stats.evictions > 0, true);
  check("...alongside what is held now",
    [stats.count, stats.usedBytes <= stats.maxBytes], [2, true]);

  console.log("=== and the scrape is Prometheus text ===");

  const metrics = createMetrics();
  metrics.observe({ req: { method: "GET" }, res: { statusCode: 200 }, ms: 3 });
  metrics.observe({ req: { method: "GET" }, res: { statusCode: 404 }, ms: 1 });
  metrics.observe({ req: { method: "POST" }, res: { statusCode: 500 }, ms: 900 });

  const scrape = metrics.render({ cacheStats: () => ({ content: cache.stats() }) });

  check("every metric declares its type",
    scrape.split("\n").filter((line) => line.startsWith("# TYPE")).length > 4, true);
  check("requests are counted by status class",
    scrape.includes('mdviewer_requests_total{method="GET",status="2xx"} 1')
    && scrape.includes('mdviewer_requests_total{method="POST",status="5xx"} 1'), true);
  check("the histogram is cumulative, and its last bucket is every request",
    scrape.includes('mdviewer_request_duration_seconds_bucket{le="+Inf"} 3'), true);
  check("...and a slow request lands above a fast one",
    scrape.includes('mdviewer_request_duration_seconds_bucket{le="0.005"} 2'), true);
  check("the caches are in it, budget and all",
    scrape.includes('mdviewer_cache_bytes_max{cache="content"} 100'), true);

  /* No path anywhere. A label with a request path in it is a label with one
   * value per document, and a scraper keeps every series it ever saw — so
   * that is how a metrics endpoint ends up holding every document title this
   * app has served.
   */
  check("nothing is labelled by path", /path=|route=|url=/.test(scrape), false);

  // A method off the wire is not a label either.
  metrics.observe({ req: { method: "BREW" }, res: { statusCode: 418 }, ms: 1 });
  check("...nor by a method somebody invented",
    metrics.render().includes('method="other"'), true);

  console.log("=== /metrics, on a running server ===");

  const server = await startTestServer({ env: { METRICS_TOKEN: "a-token-for-the-suite" } });
  try {
    const health = await server.request("GET", "/healthz");
    check("(the server is up)", health.status, 200);
    check("every response carries its request id",
      /^[0-9a-f]{16}$/.test(health.headers["x-request-id"] || ""), true);

    const anonymous = await server.request("GET", "/metrics");
    check("a scrape with no token is refused", anonymous.status, 401);

    const wrong = await server.request("GET", "/metrics", undefined,
      { Authorization: "Bearer not-the-token" });
    check("...and so is one with the wrong token", wrong.status, 401);

    // Same length as the real one, so this is the comparison and not the
    // length check in front of it.
    const near = await server.request("GET", "/metrics", undefined,
      { Authorization: "Bearer a-token-for-the-suitX" });
    check("...including one that is almost right", near.status, 401);

    const scraped = await server.request("GET", "/metrics", undefined,
      { Authorization: "Bearer a-token-for-the-suite" });
    check("with the token, it answers", scraped.status, 200);
    check("...as Prometheus text", String(scraped.headers["content-type"]).includes("text/plain"), true);

    // .raw, because a scrape is Prometheus text and the helper only parses JSON.
    const body = scraped.raw;
    check("...and the requests this suite made are in it",
      /mdviewer_requests_total\{method="GET",status="2xx"\} [1-9]/.test(body), true);
    check("...with the caches beside them", body.includes("mdviewer_cache_bytes"), true);
  } finally {
    await server.stop();
  }

  console.log("=== and a server with no token has no /metrics at all ===");

  const closed = await startTestServer();
  try {
    const off = await closed.request("GET", "/metrics", undefined,
      { Authorization: "Bearer a-token-for-the-suite" });
    check("off by default, and not merely unauthorized", off.status, 404);
  } finally {
    await closed.stop();
  }

  process.exit(finish());
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
