/* Finding a document by what is in it.
 *
 * Everything above the factory is pure: normalising, tokenising, scoring and
 * cutting a snippet are all string work over text somebody else read. The
 * factory exists only to be handed the two cache-backed readers and the result
 * limit, so which documents are in scope stays the caller's decision — this
 * module decides which of them match, and in what order.
 */

const path = require("path");

function normalizeSearchText(value) {
  return String(value || "").toLowerCase();
}

function tokenizeSearchQuery(query) {
  return normalizeSearchText(query)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

// `raw` is the whitespace-collapsed document and `normalizedContent` its
// lowercased form; both come from the snippet cache so this no longer rescans
// the source text on every request.
function buildSearchSnippet(raw, normalizedContent, query, tokens) {
  if (!raw) {
    return "No preview available.";
  }

  const searchTerms = [...new Set([normalizeSearchText(query).trim(), ...(tokens || [])]
    .map((token) => normalizeSearchText(token).trim())
    .filter(Boolean))];

  let matchIndex = -1;
  let matchToken = "";

  for (const token of searchTerms) {
    const index = normalizedContent.indexOf(token);
    if (index >= 0 && (matchIndex === -1 || index < matchIndex)) {
      matchIndex = index;
      matchToken = token;
    }
  }

  if (matchIndex === -1) {
    return raw.length > 140 ? `${raw.slice(0, 140)}...` : raw;
  }

  const focusLength = Math.max(matchToken.length, 18);
  const start = Math.max(0, matchIndex - 56);
  const end = Math.min(raw.length, matchIndex + focusLength + 72);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < raw.length ? "..." : "";
  return `${prefix}${raw.slice(start, end)}${suffix}`;
}

// `normalizedContent` arrives already lowercased from the search index; this
// used to lowercase the entire document on every request.
function scoreSearchDoc(doc, normalizedQuery, tokens, normalizedContent) {
  const title = normalizeSearchText(doc.title);
  const file = normalizeSearchText(doc.originalFile || doc.file);
  const folderName = normalizeSearchText(doc.folderName || "");

  let score = 0;
  let matched = false;

  if (title.startsWith(normalizedQuery)) {
    score += 1200;
    matched = true;
  }

  if (file.startsWith(normalizedQuery)) {
    score += 1000;
    matched = true;
  }

  if (folderName.startsWith(normalizedQuery)) {
    score += 880;
    matched = true;
  }

  if (title.includes(normalizedQuery)) {
    score += 850;
    matched = true;
  }

  if (file.includes(normalizedQuery)) {
    score += 760;
    matched = true;
  }

  if (folderName.includes(normalizedQuery)) {
    score += 620;
    matched = true;
  }

  const contentIndex = normalizedContent.indexOf(normalizedQuery);
  if (contentIndex >= 0) {
    score += 520 + Math.max(0, 140 - (contentIndex / 11));
    matched = true;
  }

  let tokenHits = 0;
  for (const token of tokens) {
    if (!token) {
      continue;
    }

    if (title.includes(token)) {
      tokenHits += 4;
    }

    if (file.includes(token)) {
      tokenHits += 4;
    }

    if (folderName.includes(token)) {
      tokenHits += 3;
    }

    if (normalizedContent.includes(token)) {
      tokenHits += 2;
      matched = true;
    }
  }

  if (tokenHits > 0) {
    score += tokenHits * 35;
  }

  return matched ? score : null;
}

function createSearch({ readSearchIndexEntry, readSnippetSource, resultLimit }) {
  async function searchDocuments({ query, docs, scopeDir }) {
    const normalizedQuery = normalizeSearchText(query).trim();
    if (!normalizedQuery) {
      return {
        matches: [],
        searchTerms: []
      };
    }

    const tokens = tokenizeSearchQuery(normalizedQuery);
    const searchTerms = [...new Set([normalizedQuery, ...tokens].filter(Boolean))];
    const matches = await Promise.all(docs.map(async (doc) => {
      const fullPath = path.join(scopeDir, doc.file);
      const indexEntry = await readSearchIndexEntry(fullPath);
      const score = scoreSearchDoc(doc, normalizedQuery, tokens, indexEntry.normalizedContent);
      if (score === null) {
        return null;
      }

      return { ...doc, score, indexEntry };
    }));

    // Drop non-matching docs before sorting; the comparator dereferences .score.
    const scoredMatches = matches.filter(Boolean);

    scoredMatches.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      const rightTime = Date.parse(right.updatedAt || right.deletedAt || "") || 0;
      const leftTime = Date.parse(left.updatedAt || left.deletedAt || "") || 0;
      if (rightTime !== leftTime) {
        return rightTime - leftTime;
      }

      return left.file.localeCompare(right.file);
    });

    // Snippets are cut only for the results that survive the limit, instead of for
    // every document that happened to match.
    const limited = await Promise.all(
      scoredMatches.slice(0, resultLimit).map(async ({ indexEntry, ...match }) => {
        const snippetSource = await readSnippetSource(
          path.join(scopeDir, match.file),
          indexEntry.content,
          indexEntry.stat
        );

        return {
          ...match,
          snippet: buildSearchSnippet(
            snippetSource.collapsed,
            snippetSource.normalizedCollapsed,
            normalizedQuery,
            searchTerms
          )
        };
      })
    );

    return {
      matches: limited,
      searchTerms
    };
  }

  return { searchDocuments };
}

module.exports = {
  normalizeSearchText,
  tokenizeSearchQuery,
  buildSearchSnippet,
  scoreSearchDoc,
  createSearch
};
