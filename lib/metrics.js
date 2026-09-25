/* What this process has done, in the format a scraper reads.
 *
 * Prometheus text, by hand: the whole of it is a counter map, a set of latency
 * buckets and a walk over three caches, which is less code than a dependency
 * would be and has no version to keep up with.
 *
 * The three caches are the reason this exists at all. Their budgets are
 * constants — 32MB, 48MB, 16MB — chosen once by somebody with no data, and
 * "was 32MB right" is not answerable from the source. A hit rate answers it.
 *
 * Cardinality is the thing to be careful about: a label with a request path in
 * it is a label with one value per document, and a scraper that keeps every
 * series forever will hold every document title this app has ever served. So
 * requests are counted by method and by status class, and never by path.
 */

// Seconds, and the shape of the thing being measured: this app answers most
// requests from memory in single-digit milliseconds, and the interesting tail
// is a search over a large corpus or a document read from disk.
const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

// An unrecognised method is counted as "other" rather than as itself, for the
// same reason paths are not labels: the method comes off the wire.
function methodOf(req) {
  return METHODS.has(req.method) ? req.method : "other";
}

function classOf(statusCode) {
  return `${Math.floor(statusCode / 100)}xx`;
}

function escapeLabel(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function labels(pairs) {
  const written = Object.entries(pairs)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}="${escapeLabel(value)}"`)
    .join(",");

  return written ? `{${written}}` : "";
}

function createMetrics({ startedAt = Date.now() } = {}) {
  // method|statusClass -> count, and the same keys for the duration sum.
  const requests = new Map();
  const durationSum = new Map();
  const buckets = DURATION_BUCKETS.map(() => 0);
  let durationCount = 0;
  let durationTotal = 0;

  /* One finished request. Called for every one, including the static assets
   * that are not worth a log line — a request nobody logged still happened,
   * and the rate is the point.
   */
  function observe({ req, res, ms }) {
    const key = `${methodOf(req)}|${classOf(res.statusCode)}`;
    requests.set(key, (requests.get(key) || 0) + 1);

    const seconds = ms / 1000;
    durationSum.set(key, (durationSum.get(key) || 0) + seconds);
    durationCount += 1;
    durationTotal += seconds;

    for (let index = 0; index < DURATION_BUCKETS.length; index += 1) {
      if (seconds <= DURATION_BUCKETS[index]) {
        buckets[index] += 1;
      }
    }
  }

  /* The scrape.
   *
   * `cacheStats` is passed in rather than imported, so this module knows
   * nothing about documents and the caches stay answerable from one place.
   */
  function render({ cacheStats = () => ({}) } = {}) {
    const lines = [];
    const metric = (name, help, type) => {
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    };

    metric("mdviewer_uptime_seconds", "Seconds since this process started.", "gauge");
    lines.push(`mdviewer_uptime_seconds ${((Date.now() - startedAt) / 1000).toFixed(0)}`);

    metric("mdviewer_requests_total", "Requests answered, by method and status class.", "counter");
    for (const [key, count] of [...requests].sort()) {
      const [method, status] = key.split("|");
      lines.push(`mdviewer_requests_total${labels({ method, status })} ${count}`);
    }

    metric("mdviewer_request_duration_seconds",
      "How long a request took, end to end.", "histogram");
    for (let index = 0; index < DURATION_BUCKETS.length; index += 1) {
      lines.push(`mdviewer_request_duration_seconds_bucket${labels({ le: DURATION_BUCKETS[index] })}`
        + ` ${buckets[index]}`);
    }
    lines.push(`mdviewer_request_duration_seconds_bucket${labels({ le: "+Inf" })} ${durationCount}`);
    lines.push(`mdviewer_request_duration_seconds_sum ${durationTotal.toFixed(6)}`);
    lines.push(`mdviewer_request_duration_seconds_count ${durationCount}`);

    const caches = cacheStats();
    if (Object.keys(caches).length > 0) {
      metric("mdviewer_cache_entries", "Entries held in each in-memory cache.", "gauge");
      for (const [name, stats] of Object.entries(caches)) {
        lines.push(`mdviewer_cache_entries${labels({ cache: name })} ${stats.count}`);
      }

      metric("mdviewer_cache_bytes", "Bytes held in each in-memory cache.", "gauge");
      for (const [name, stats] of Object.entries(caches)) {
        lines.push(`mdviewer_cache_bytes${labels({ cache: name })} ${stats.usedBytes}`);
      }

      metric("mdviewer_cache_bytes_max", "The budget each cache is held under.", "gauge");
      for (const [name, stats] of Object.entries(caches)) {
        lines.push(`mdviewer_cache_bytes_max${labels({ cache: name })} ${stats.maxBytes}`);
      }

      // The three that answer "is the budget right": a cache that never
      // evicts is larger than it needs to be, and one that misses constantly
      // is smaller.
      for (const [suffix, help] of [
        ["hits_total", "Reads answered from each cache."],
        ["misses_total", "Reads that had to go to disk."],
        ["evictions_total", "Entries dropped to stay under budget."]
      ]) {
        metric(`mdviewer_cache_${suffix}`, help, "counter");
        for (const [name, stats] of Object.entries(caches)) {
          const value = { hits_total: stats.hits, misses_total: stats.misses,
            evictions_total: stats.evictions }[suffix];
          lines.push(`mdviewer_cache_${suffix}${labels({ cache: name })} ${value}`);
        }
      }
    }

    return `${lines.join("\n")}\n`;
  }

  return { observe, render, DURATION_BUCKETS };
}

module.exports = { createMetrics, DURATION_BUCKETS };
