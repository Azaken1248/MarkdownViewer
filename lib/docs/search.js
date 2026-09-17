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

/* Trigrams match three characters or more. A shorter query gets the scan it
 * always had, which is cheap at that length anyway: one or two characters
 * match most of the library, and the cost of a scan is in the documents that
 * have to be read to be ruled out.
 */
const FTS_MIN_QUERY = 3;

/* A query as FTS5 wants it: each whitespace-separated term quoted, so nothing
 * in it is read as an operator, ORed together.
 *
 * OR, because the index only has to say which documents could match; the
 * scorer decides. And the scorer counts a document that contains any one of
 * the words — "deploy kube" finds a document that says deploy and never says
 * kube, ranked below one that says both. An AND here would have quietly
 * dropped it, which is the kind of disagreement the comparison in
 * test/search.test.js exists to catch.
 */
function ftsMatchExpression(tokens) {
  return tokens
    .filter((token) => token.length >= FTS_MIN_QUERY)
    .map((token) => `"${token.replace(/"/g, '""')}"`)
    .join(" OR ");
}

function createSearch({ db, readSearchIndexEntry, readSnippetSource, readContent, resultLimit }) {
  const statements = db ? {
    known: db.prepare("SELECT id, file, mtime_ms, size FROM document_index WHERE scope = ?"),
    forget: db.prepare("DELETE FROM document_index WHERE id = ?"),
    // By rowid, never by scope and file: see the note on document_index.
    forgetFts: db.prepare("DELETE FROM documents_fts WHERE rowid = ?"),
    remember: db.prepare(
      `INSERT INTO document_index (scope, file, mtime_ms, size) VALUES (?, ?, ?, ?)
       ON CONFLICT(scope, file) DO UPDATE SET mtime_ms = excluded.mtime_ms, size = excluded.size
       RETURNING id`),
    index: db.prepare(
      `INSERT INTO documents_fts (rowid, scope, file, title, folder_name, body)
       VALUES (?, ?, ?, ?, ?, ?)`),
    candidates: db.prepare(
      `SELECT file, body FROM documents_fts
        WHERE scope = ? AND documents_fts MATCH ?`)
  } : null;

  /* Bring the index up to date with what the walk just found.
   *
   * Zero I/O for a library that has not changed: the walk already carries
   * every document's mtime and size, and those are compared against the rows.
   * Only a document that is new or different is read, and only a row whose
   * document is gone is dropped.
   *
   * In two steps because better-sqlite3 cannot hold a transaction across an
   * await, and a transaction should not wait on a disk anyway: `plan` decides
   * what has changed, the changed documents are read, and `apply` writes them
   * under one immediate transaction so two processes reconciling at once do
   * not both index the same file.
   */
  function plan(scope, docs) {
    const known = new Map(statements.known.all(scope).map((row) => [row.file, row]));
    const changed = [];
    const seen = new Set();

    for (const doc of docs) {
      seen.add(doc.file);
      const mtimeMs = Date.parse(doc.updatedAt || doc.deletedAt || "") || 0;
      const row = known.get(doc.file);
      if (!row || row.mtime_ms !== mtimeMs || row.size !== doc.size) {
        changed.push({ doc, mtimeMs, row });
      }
    }

    const gone = [...known.entries()].filter(([file]) => !seen.has(file)).map(([, row]) => row);
    return { changed, gone };
  }

  const apply = db ? db.transaction((scope, changed, gone, contents) => {
    for (const { doc, mtimeMs, row } of changed) {
      const content = contents.get(doc.file);
      if (content === undefined) {
        continue;
      }

      if (row) {
        statements.forgetFts.run(row.id);
      }

      const { id } = statements.remember.get(scope, doc.file, mtimeMs, doc.size);
      // Stored as written, not lowercased. The trigram tokenizer matches
      // case-insensitively on its own, and a snippet has to show the text the
      // way the document has it.
      statements.index.run(id, scope, doc.file, doc.title || "", doc.folderName || "", content);
    }

    for (const row of gone) {
      statements.forgetFts.run(row.id);
      statements.forget.run(row.id);
    }
  }) : null;

  async function reconcile(scope, scopeDir, docs) {
    const { changed, gone } = plan(scope, docs);
    if (changed.length === 0 && gone.length === 0) {
      return;
    }

    const contents = new Map();
    await Promise.all(changed.map(async ({ doc }) => {
      try {
        contents.set(doc.file, await readContent(path.join(scopeDir, doc.file)));
      } catch {
        // Listed a moment ago and gone now. It is left out of the index; the
        // next walk will not list it at all.
      }
    }));

    apply.immediate(scope, changed, gone, contents);
  }

  async function candidatesFromIndex({ scope, scopeDir, docs, tokens }) {
    await reconcile(scope, scopeDir, docs);

    const byFile = new Map(docs.map((doc) => [doc.file, doc]));
    const rows = statements.candidates.all(scope, ftsMatchExpression(tokens));
    return rows
      .filter((row) => byFile.has(row.file))
      .map((row) => ({
        doc: byFile.get(row.file),
        content: row.body,
        // Lowercased here, per candidate, rather than for every document in
        // the library: the scorer needs it, and only the matches are scored.
        normalizedContent: normalizeSearchText(row.body),
        fromIndex: true
      }));
  }

  // The scan, kept for queries too short for trigrams and for a store with no
  // database behind it. Reads every document; that is what it always did.
  async function candidatesFromScan({ scopeDir, docs }) {
    return Promise.all(docs.map(async (doc) => {
      const indexEntry = await readSearchIndexEntry(path.join(scopeDir, doc.file));
      return {
        doc,
        normalizedContent: indexEntry.normalizedContent,
        content: indexEntry.content,
        stat: indexEntry.stat,
        fromIndex: false
      };
    }));
  }

  async function searchDocuments({ query, docs, scopeDir, scope = "docs" }) {
    const normalizedQuery = normalizeSearchText(query).trim();
    if (!normalizedQuery) {
      return {
        matches: [],
        searchTerms: []
      };
    }

    const tokens = tokenizeSearchQuery(normalizedQuery);
    const searchTerms = [...new Set([normalizedQuery, ...tokens].filter(Boolean))];

    // Every token, not any: the scorer counts a document that contains any one
    // of the words, and a word too short for trigrams is one the index cannot
    // ask about. Mixing one in means the scan, which is rare and is right.
    const indexed = Boolean(db) && tokens.every((token) => token.length >= FTS_MIN_QUERY);
    const candidates = indexed
      ? await candidatesFromIndex({ scope, scopeDir, docs, tokens })
      : await candidatesFromScan({ scopeDir, docs });

    // The order is the scorer's, not the index's. FTS5 says which documents
    // contain the words; what it would rank by (term frequency) is not what
    // this box ranks by, which is "the name first, then the folder, then the
    // text" — the same ladder it always had, now run over the matches alone.
    const scoredMatches = [];
    for (const candidate of candidates) {
      const score = scoreSearchDoc(candidate.doc, normalizedQuery, tokens, candidate.normalizedContent);
      if (score !== null) {
        scoredMatches.push({ ...candidate.doc, score, candidate });
      }
    }

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
      scoredMatches.slice(0, resultLimit).map(async ({ candidate, ...match }) => {
        // From the index the text is already in hand; from the scan it is
        // read through the snippet cache as before.
        const snippetSource = candidate.fromIndex
          ? collapseForSnippet(candidate.content)
          : await readSnippetSource(path.join(scopeDir, match.file), candidate.content, candidate.stat);

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

// What the snippet cache would have made of a document, made here from the
// text the index handed back — so a result from the index opens no file.
function collapseForSnippet(content) {
  const collapsed = String(content || "").replace(/\s+/g, " ").trim();
  return { collapsed, normalizedCollapsed: normalizeSearchText(collapsed) };
}

module.exports = {
  normalizeSearchText,
  tokenizeSearchQuery,
  buildSearchSnippet,
  scoreSearchDoc,
  ftsMatchExpression,
  createSearch,
  FTS_MIN_QUERY
};
