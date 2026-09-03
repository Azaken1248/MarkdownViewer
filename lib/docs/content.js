/* The documents this process is currently holding in memory.
 *
 * Three caches, three budgets, one invalidation. They are bounded so a large
 * corpus cannot pin the whole library in RSS forever; an evicted entry is
 * re-derived from disk on the next miss, so a small budget costs time, never
 * correctness. Every entry is checked against the file's mtime and size before
 * it is trusted, which is what makes editing a document outside the app safe.
 */

const fsp = require("fs/promises");
const { createLruCache } = require("../lru");
const { normalizeSearchText } = require("./search");

function createDocumentCache({ contentMaxBytes, indexMaxBytes, snippetMaxBytes }) {
  const docContentCache = createLruCache(contentMaxBytes);
  // Search reads the lowercased form of every document on every keystroke.
  // Keeping that derived form next to the raw text turns the per-request cost
  // from "lowercase the whole corpus" into "walk strings already in memory".
  const docSearchIndex = createLruCache(indexMaxBytes);
  const docSnippetCache = createLruCache(snippetMaxBytes);

  function invalidateCachedContent(fullPath) {
    docContentCache.delete(fullPath);
    docSearchIndex.delete(fullPath);
    docSnippetCache.delete(fullPath);
  }

  async function readCachedTextFile(fullPath) {
    const stat = await fsp.stat(fullPath);
    const cached = docContentCache.get(fullPath);

    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return {
        content: cached.content,
        stat,
        cached: true
      };
    }

    const content = await fsp.readFile(fullPath, "utf8");
    docContentCache.set(fullPath, {
      content,
      mtimeMs: stat.mtimeMs,
      size: stat.size
    }, Buffer.byteLength(content, "utf8"));

    return {
      content,
      stat,
      cached: false
    };
  }

  // Only the lowercased full text is indexed, because scoring needs it for every
  // document on every request. The whitespace-collapsed form a snippet is cut from
  // is derived on demand instead: snippets are built for at most a page of results,
  // so caching that too would roughly triple the index for no gain.
  async function readSearchIndexEntry(fullPath) {
    const { content, stat } = await readCachedTextFile(fullPath);
    const cached = docSearchIndex.get(fullPath);

    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return { ...cached, content, stat };
    }

    const normalizedContent = normalizeSearchText(content);
    const entry = {
      normalizedContent,
      mtimeMs: stat.mtimeMs,
      size: stat.size
    };

    docSearchIndex.set(fullPath, entry, Buffer.byteLength(normalizedContent, "utf8"));

    return { ...entry, content, stat };
  }

  // Snippet inputs are needed only for results that survive the limit, so they get
  // their own much smaller budget rather than riding along in the main index.
  async function readSnippetSource(fullPath, content, stat) {
    const cached = docSnippetCache.get(fullPath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached;
    }

    const collapsed = String(content || "").replace(/\s+/g, " ").trim();
    const entry = {
      collapsed,
      normalizedCollapsed: normalizeSearchText(collapsed),
      mtimeMs: stat.mtimeMs,
      size: stat.size
    };

    docSnippetCache.set(
      fullPath,
      entry,
      Buffer.byteLength(collapsed, "utf8") + Buffer.byteLength(entry.normalizedCollapsed, "utf8")
    );

    return entry;
  }

  return {
    readCachedTextFile,
    readSearchIndexEntry,
    readSnippetSource,
    invalidateCachedContent
  };
}

module.exports = { createDocumentCache };
