/* How many times, per minute, per who.
 *
 * Two things were rate limited before this and they were the two that were
 * obviously dangerous: signing in, and fetching a link from somewhere else.
 * Nothing else was, and the rest is not free either — a document write is up
 * to two megabytes and an index update, an asset upload is ten megabytes held
 * in memory and hashed, a folder upload is two hundred files, and /healthz
 * walks the whole library and is by design the one address anyone may ask.
 *
 * The threat is not the open internet; most of these need a session. It is a
 * low-privilege account, a borrowed session, and the two endpoints that need
 * nothing at all. A limiter is a ceiling against a runaway, not a security
 * boundary — the guards are the boundary — so it is deliberately simple.
 *
 * Fixed windows rather than sliding ones, and a count rather than a list of
 * timestamps. The link-fetch throttle this generalises kept an array of times
 * per key, which is fine at twenty a minute and is thirty kilobytes a key at
 * three hundred. A fixed window lets a client take two windows' worth across a
 * boundary, which for a ceiling does not matter.
 *
 * Bounded, which is the trap the review named. A map keyed by whatever a
 * request says it is — an address, a session — grows by however many of those
 * an attacker cares to present. So there is a cap on how many keys are kept,
 * expired ones go first, and past that the oldest go, whether or not they are
 * still in their window: a limiter that runs out of room forgets rather than
 * grows, and forgetting an attacker's key costs one extra window of requests.
 *
 * Per process, and knowingly. Under two processes every ceiling here is twice
 * as high, which for a ceiling is fine; the login lockout is the one limit
 * that is a security boundary and it is the one that does not live here.
 */

const DEFAULT_MAX_KEYS = 10_000;

function createLimiter({ name, windowMs, max, keyOf, skip = null, maxKeys = DEFAULT_MAX_KEYS, message }) {
  if (!name || !windowMs || !max || typeof keyOf !== "function") {
    throw new Error("createLimiter: name, windowMs, max and keyOf are required");
  }

  // key -> { count, resetAt }. Insertion order is age, which is what the
  // eviction below leans on: a Map's first entry is its oldest.
  const buckets = new Map();

  const limitFor = typeof max === "function" ? max : () => max;

  function sweep(now) {
    if (buckets.size <= maxKeys) {
      return;
    }

    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) {
        buckets.delete(key);
      }
    }

    // Still over: forget the oldest, live or not. See the note above.
    while (buckets.size > maxKeys) {
      buckets.delete(buckets.keys().next().value);
    }
  }

  /* Take one from the key's budget. Answers whether it was there to take, and
   * when the window turns over, which becomes Retry-After.
   */
  function take(key, limit, now = Date.now()) {
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      // Delete first so the re-insert lands at the end: a key in use is a
      // young key, and a young key is the last to be forgotten.
      buckets.delete(key);
      buckets.set(key, bucket);
      sweep(now);
    }

    bucket.count += 1;
    return {
      allowed: bucket.count <= limit,
      remaining: Math.max(0, limit - bucket.count),
      retryAfterMs: bucket.resetAt - now
    };
  }

  function middleware(req, res, next) {
    if (skip && skip(req)) {
      return next();
    }

    const key = keyOf(req);
    if (!key) {
      return next();
    }

    const limit = limitFor(req);
    const answer = take(`${name}:${key}`, limit);
    if (answer.allowed) {
      return next();
    }

    const seconds = Math.max(1, Math.ceil(answer.retryAfterMs / 1000));
    res.set("Retry-After", String(seconds));
    return res.status(429).json({
      error: message || `Too many requests. Try again in ${seconds} second${seconds === 1 ? "" : "s"}.`
    });
  }

  /* Take up to `wanted` from the key's budget and say how many there were.
   *
   * For a batch that would rather do less than start more than it may finish
   * and collect a refusal halfway through — the icon fetch asks for one slot
   * per link and does that many.
   */
  function takeUpTo(key, wanted, limit, now = Date.now()) {
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.delete(key);
      buckets.set(key, bucket);
      sweep(now);
    }

    const granted = Math.max(0, Math.min(wanted, limit - bucket.count));
    bucket.count += granted;
    return granted;
  }

  middleware.take = take;
  middleware.takeUpTo = takeUpTo;
  middleware.limitFor = limitFor;
  middleware.name = name;
  middleware.size = () => buckets.size;
  middleware.reset = () => buckets.clear();
  return middleware;
}

/* The two ways a request is told apart.
 *
 * By account when there is one, so a household behind one address is not one
 * budget. By address when there is not — which is also the only key a request
 * with no session can offer, and a limiter keyed by nothing limits nothing.
 */
function bySession(req) {
  return req.auth?.user?.id ? `user:${req.auth.user.id}` : (req.ip ? `ip:${req.ip}` : null);
}

function byAddress(req) {
  return req.ip ? `ip:${req.ip}` : null;
}

/* A read. GET, HEAD and OPTIONS change nothing, and the app reads a great
 * deal: warming the client's search cache fetches every document, paced but
 * not slowly, and that grows with the library. A ceiling on reads low enough
 * to mean anything would break that; one high enough to allow it would mean
 * nothing. The reads that cost something — a search, the health check — get a
 * bucket of their own. The rest is served from a cache and is not the
 * runaway the wide ceiling is for.
 */
function isRead(req) {
  return req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS";
}

module.exports = { createLimiter, bySession, byAddress, isRead, DEFAULT_MAX_KEYS };
