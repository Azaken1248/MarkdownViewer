// Finding a document by typing part of its name.
//
// The whole corpus is in memory, so this is a scorer rather than an index: a
// query is tokenized, every document is scored against it, and the best few are
// shown. Exact beats prefix beats a loose subsequence, a title match beats a
// body match, and a recent document breaks a tie.

/* exported AppSearch */
var AppSearch = (function () {
  const { normalize, escapeHtml, escapeRegExp } = AppText;
  const { state } = AppState;
  const { getCurrentDocsCollection } = AppLibrary;

  const SUPERSEARCH_LIMIT = 8;
  // Each "Show more" click in the results panel reveals this many further rows.
  const SUPERSEARCH_PAGE_SIZE = 12;

  function tokenizeSearchQuery(query) {
    return normalize(query)
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2);
  }

  function hasLooseSubsequence(needle, haystack) {
    const compactNeedle = normalize(needle).replace(/\s+/g, "");
    const compactHaystack = normalize(haystack).replace(/\s+/g, "");
    if (!compactNeedle || !compactHaystack) {
      return false;
    }

    let index = 0;
    for (const char of compactHaystack) {
      if (char === compactNeedle[index]) {
        index += 1;
        if (index === compactNeedle.length) {
          return true;
        }
      }
    }

    return false;
  }

  function highlightMatches(text, searchTerms) {
    const raw = String(text || "");
    const tokens = [...new Set((searchTerms || [])
      .map((term) => normalize(term).trim())
      .filter((term) => term.length >= 2))]
      .sort((left, right) => right.length - left.length);

    if (tokens.length === 0) {
      return escapeHtml(raw);
    }

    const pattern = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "ig");
    return raw
      .split(pattern)
      .map((part, index) => (
        index % 2 === 1
          ? `<mark>${escapeHtml(part)}</mark>`
          : escapeHtml(part)
      ))
      .join("");
  }

  function buildSearchSnippet(content, query, tokens) {
    const raw = String(content || "").replace(/\s+/g, " ").trim();
    if (!raw) {
      return "No preview available.";
    }

    const normalizedContent = normalize(raw);
    const searchTerms = [...new Set([normalize(query), ...(tokens || [])]
      .map((token) => normalize(token).trim())
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

  /* What a whole-query match is worth, per field. The same idea as the
   * server's scorer (lib/docs/search.js) and deliberately the same shape, so
   * the offline fallback ranks a library the way the server would.
   */
  /** @type {[string, "startsWith" | "includes", number][]} */
  const QUERY_SCORES = [
    ["title", "startsWith", 1200],
    ["file", "startsWith", 1000],
    ["title", "includes", 850],
    ["file", "includes", 760],
    ["folderName", "startsWith", 680],
    ["folderName", "includes", 560]
  ];

  // And what one word of it is worth, best field first: a word counts once,
  // wherever it is found.
  /** @type {[string, number][]} */
  const TOKEN_SCORES = [["title", 220], ["file", 190], ["folderName", 150], ["content", 110]];

  function scoreDocForQuery(doc, normalizedQuery, tokens) {
    const fields = {
      title: normalize(doc.title),
      file: normalize(doc.originalFile || doc.file),
      folderName: normalize(doc.folderName || ""),
      content: normalize(state.contentCache.get(doc.file)?.content || "")
    };
    const { title, file, content } = fields;

    let score = 0;
    let matched = false;

    for (const [field, how, worth] of QUERY_SCORES) {
      if (fields[field][how](normalizedQuery)) {
        score += worth;
        matched = true;
      }
    }

    const contentIndex = content.indexOf(normalizedQuery);
    if (contentIndex >= 0) {
      score += 520 + Math.max(0, 140 - (contentIndex / 11));
      matched = true;
    }

    if (!matched && hasLooseSubsequence(normalizedQuery, `${title} ${file}`)) {
      score += 240;
      matched = true;
    }

    let tokenHits = 0;
    for (const token of tokens) {
      const where = TOKEN_SCORES.find(([field]) => fields[field].includes(token));
      if (where) {
        score += where[1];
        tokenHits += 1;
        continue;
      }

      score -= 20;
    }

    if (!matched && tokenHits === 0) {
      return null;
    }

    return score + Math.min(180, tokenHits * 45);
  }


  function buildSuperSearchMatches(query, docsCollection = getCurrentDocsCollection()) {
    const normalizedQuery = normalize(query).trim();
    const tokens = tokenizeSearchQuery(normalizedQuery);
    const searchTerms = [...new Set([normalizedQuery, ...tokens].filter(Boolean))];

    if (!normalizedQuery) {
      return { matches: [], searchTerms };
    }

    const matches = [];
    for (const doc of docsCollection) {
      const score = scoreDocForQuery(doc, normalizedQuery, tokens);
      if (score === null) {
        continue;
      }

      const content = String(state.contentCache.get(doc.file)?.content || "");
      matches.push({
        ...doc,
        score,
        snippet: buildSearchSnippet(content, normalizedQuery, searchTerms)
      });
    }

    matches.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      const rightTime = Date.parse(right.updatedAt || "") || 0;
      const leftTime = Date.parse(left.updatedAt || "") || 0;
      if (rightTime !== leftTime) {
        return rightTime - leftTime;
      }

      return left.file.localeCompare(right.file);
    });

    return { matches, searchTerms };
  }

  function buildJumpSearchTerms(query, terms = []) {
    const normalizedSeedTerms = [
      normalize(query).trim(),
      ...tokenizeSearchQuery(query),
      ...(terms || []).map((term) => normalize(term).trim())
    ];

    return [...new Set(normalizedSeedTerms.filter((term) => term.length >= 2))]
      .sort((left, right) => right.length - left.length);
  }

  return {
    SUPERSEARCH_LIMIT,
    SUPERSEARCH_PAGE_SIZE,
    tokenizeSearchQuery,
    highlightMatches,
    buildSuperSearchMatches,
    buildJumpSearchTerms
  };
})();
