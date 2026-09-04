// Finding a document by typing part of its name.
//
// The whole corpus is in memory, so this is a scorer rather than an index: a
// query is tokenized, every document is scored against it, and the best few are
// shown. Exact beats prefix beats a loose subsequence, a title match beats a
// body match, and a recent document breaks a tie.

(function (global) {
  const { normalize, escapeHtml, escapeRegExp } = global.AppText;
  const { state } = global.AppState;
  const { getCurrentDocsCollection } = global.AppLibrary;

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

  function scoreDocForQuery(doc, normalizedQuery, tokens) {
    const title = normalize(doc.title);
    const file = normalize(doc.originalFile || doc.file);
    const folderName = normalize(doc.folderName || "");
    const content = normalize(state.contentCache.get(doc.file)?.content || "");

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

    if (title.includes(normalizedQuery)) {
      score += 850;
      matched = true;
    }

    if (file.includes(normalizedQuery)) {
      score += 760;
      matched = true;
    }

    if (folderName.startsWith(normalizedQuery)) {
      score += 680;
      matched = true;
    }

    if (folderName.includes(normalizedQuery)) {
      score += 560;
      matched = true;
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
      if (title.includes(token)) {
        score += 220;
        tokenHits += 1;
        continue;
      }

      if (file.includes(token)) {
        score += 190;
        tokenHits += 1;
        continue;
      }

      if (folderName.includes(token)) {
        score += 150;
        tokenHits += 1;
        continue;
      }

      if (content.includes(token)) {
        score += 110;
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

  global.AppSearch = {
    SUPERSEARCH_LIMIT,
    SUPERSEARCH_PAGE_SIZE,
    tokenizeSearchQuery,
    highlightMatches,
    buildSuperSearchMatches,
    buildJumpSearchTerms
  };
})(typeof window === "undefined" ? globalThis : window);
