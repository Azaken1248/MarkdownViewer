/* How many times, per minute, per who — and that it cannot be made to grow.
 *
 * The factory is checked on its own, with a clock it is handed rather than the
 * real one, because what can go wrong in a limiter is arithmetic: the window
 * turning over, the Retry-After being right, and above all the map of keys
 * staying bounded when an attacker presents as many keys as they like. Then
 * the buckets as the server mounts them are checked against a real server,
 * which is the only way to know that a read is not counted and an upload is.
 */

const { createLimiter, bySession, byAddress, isRead } = require("../lib/http/limiter");
const { startTestServer, SEED_USERNAME, SEED_PASSWORD, TEST_PASSWORD } = require("./helpers/server");
const { createChecker } = require("./helpers/check.js");

const { check, finish } = createChecker("LIMITER");

console.log("=== a window is a window ===");
{
  const limiter = createLimiter({ name: "t", windowMs: 60_000, max: 3, keyOf: (req) => req.k });
  let now = 1_000_000;
  const take = (key) => limiter.take(`t:${key}`, 3, now);

  check("the budget is the budget", [take("a"), take("a"), take("a")].map((r) => r.allowed), [true, true, true]);
  const fourth = take("a");
  check("...and one more is refused", fourth.allowed, false);
  check("...saying when the window turns", fourth.retryAfterMs, 60_000);
  check("another key has its own budget", take("b").allowed, true);

  now += 30_000;
  check("halfway through, still refused", take("a").allowed, false);
  now += 30_001;
  check("a new window, a new budget", take("a").allowed, true);
}

console.log("=== the map of keys cannot be made to grow ===");
{
  // The trap the review named: a map keyed by whatever a request says it is
  // grows by however many of those an attacker cares to present. This holds
  // it at the cap, forgetting expired keys first and the oldest after that.
  const limiter = createLimiter({ name: "t", windowMs: 60_000, max: 100, keyOf: (req) => req.k, maxKeys: 50 });
  let now = 1_000_000;
  for (let i = 0; i < 500; i += 1) {
    limiter.take(`t:attacker-${i}`, 100, now);
  }
  check("five hundred keys presented, fifty kept", limiter.size(), 50);

  // An honest key in use is young and survives; the oldest attacker keys are
  // the ones forgotten.
  limiter.take("t:honest", 100, now);
  for (let i = 500; i < 600; i += 1) {
    limiter.take(`t:attacker-${i}`, 100, now);
    limiter.take("t:honest", 100, now); // kept in use
  }
  check("still fifty", limiter.size(), 50);

  // Expired keys go before live ones.
  now += 60_001;
  limiter.take("t:fresh", 100, now);
  check("a fresh window swept the expired ones out", limiter.size() <= 50, true);
}

console.log("=== who is who ===");
{
  check("a session is counted as its account", bySession({ auth: { user: { id: "u1" } }, ip: "1.2.3.4" }), "user:u1");
  check("no session is counted as its address", bySession({ auth: null, ip: "1.2.3.4" }), "ip:1.2.3.4");
  check("no address at all is not counted", bySession({}), null);
  check("the public bucket is always by address", byAddress({ auth: { user: { id: "u1" } }, ip: "1.2.3.4" }), "ip:1.2.3.4");
  check("a read is a read", ["GET", "HEAD", "OPTIONS"].map((method) => isRead({ method })), [true, true, true]);
  check("...and a write is not", ["POST", "PUT", "PATCH", "DELETE"].map((method) => isRead({ method })), [false, false, false, false]);
}

(async () => {
  console.log("=== the buckets as the server mounts them ===");
  const server = await startTestServer();
  try {
    const login = await server.request("POST", "/api/auth/login", { username: SEED_USERNAME, password: SEED_PASSWORD });
    let cookie = login.headers["set-cookie"].map((c) => c.split(";")[0]).join("; ");
    const changed = await server.request("POST", "/api/auth/password",
      { currentPassword: SEED_PASSWORD, newPassword: TEST_PASSWORD },
      { Cookie: cookie, "X-CSRF-Token": login.body.csrfToken });
    cookie = (changed.headers["set-cookie"] || []).map((c) => c.split(";")[0]).join("; ") || cookie;
    const csrf = (await server.request("GET", "/api/session", undefined, { Cookie: cookie })).body.csrfToken;
    const headers = { Cookie: cookie, "X-CSRF-Token": csrf };

    // Reads are not counted by the wide ceiling: four hundred of them in a
    // row, which is what warming the search cache on a big library looks like.
    const readStatuses = new Set();
    for (let i = 0; i < 400; i += 1) {
      readStatuses.add((await server.request("GET", "/api/docs", undefined, headers)).status);
    }
    check("four hundred reads in a minute are all answered", [...readStatuses], [200]);

    // Writes are. The write bucket is the tighter of the two that apply, so it
    // is the one that answers first.
    const statuses = new Map();
    let firstRefusal = null;
    for (let i = 0; i < 130; i += 1) {
      const res = await server.request("PUT", "/api/docs/beta.md", { content: `# beta ${i}\n` }, headers);
      statuses.set(res.status, (statuses.get(res.status) || 0) + 1);
      if (res.status === 429 && !firstRefusal) {
        firstRefusal = res;
      }
    }
    check("a hundred and twenty saves in a minute are answered", statuses.get(200), 120);
    check("...and the rest are refused", statuses.get(429), 10);
    check("...saying so", firstRefusal.body.error, "Too many saves just now. Wait a minute and try again.");
    check("...and when to come back", Number(firstRefusal.headers["retry-after"]) > 0, true);

    // The refusal cost nothing: the document is what the last accepted save
    // wrote, not something half-applied.
    const after = await server.request("GET", "/api/docs/beta.md", undefined, headers);
    check("a refused save changed nothing", after.body.content, "# beta 119\n");

    // The public bucket, keyed by address, for the one endpoint anyone may ask.
    const healthStatuses = new Set();
    for (let i = 0; i < 70; i += 1) {
      healthStatuses.add((await server.request("GET", "/healthz")).status);
    }
    check("the health check has a ceiling of its own", [...healthStatuses].sort(), [200, 429]);
  } finally {
    await server.stop();
  }

  process.exit(finish());
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
