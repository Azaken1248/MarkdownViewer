/* A byte-budgeted LRU, used for everything this app keeps in memory on purpose.
 *
 * Nothing here knows what it is holding: callers say how many bytes an entry
 * costs, because only they can weigh a string against its derived forms.
 */

// A plain Map grew to the size of the entire corpus and never gave any of it
// back. This is a byte-budgeted LRU: Map preserves insertion order, so the
// oldest key is always the first one iteration yields, and re-reading a key
// moves it to the back.
function createLruCache(maxBytes) {
  const entries = new Map();
  let usedBytes = 0;
  // Counted because the budgets above are constants somebody picked, and
  // "is 32MB the right number" is not a question anybody can answer from the
  // source. A hit rate is the answer; see /metrics.
  let hits = 0;
  let misses = 0;
  let evictions = 0;

  function evictUntilUnder(limit) {
    for (const key of entries.keys()) {
      if (usedBytes <= limit) {
        return;
      }

      usedBytes -= entries.get(key).bytes;
      entries.delete(key);
      evictions += 1;
    }
  }

  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) {
        misses += 1;
        return null;
      }

      hits += 1;
      entries.delete(key);
      entries.set(key, entry);
      return entry;
    },
    set(key, value, bytes) {
      const existing = entries.get(key);
      if (existing) {
        usedBytes -= existing.bytes;
        entries.delete(key);
      }

      // A single file larger than the whole budget is simply not cached,
      // rather than evicting everything else to make room for it.
      if (bytes > maxBytes) {
        evictUntilUnder(maxBytes);
        return;
      }

      entries.set(key, { ...value, bytes });
      usedBytes += bytes;
      evictUntilUnder(maxBytes);
    },
    delete(key) {
      const entry = entries.get(key);
      if (!entry) {
        return;
      }

      usedBytes -= entry.bytes;
      entries.delete(key);
    },
    stats() {
      return { count: entries.size, usedBytes, maxBytes, hits, misses, evictions };
    }
  };
}

module.exports = { createLruCache };
