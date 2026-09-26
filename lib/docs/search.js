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
/* What a whole-query match is worth, per field.
 *
 * The name of a thing beats the folder it is in, and the beginning of a name
 * beats the middle of one — somebody typing "read" means README before they
 * mean the document that mentions reading. The numbers are only meaningful
 * against each other.
 */
/** @type {[string, "startsWith" | "includes", number][]} */
const QUERY_SCORES = [
  ["title", "startsWith", 1200],
  ["file", "startsWith", 1000],
  ["folderName", "startsWith", 880],
  ["title", "includes", 850],
  ["file", "includes", 760],
  ["folderName", "includes", 620]
];

// And what one word of it is worth, when the whole query did not match.
/** @type {[string, number][]} */
const TOKEN_SCORES = [["title", 4], ["file", 4], ["folderName", 3]];

function scoreSearchDoc(doc, normalizedQuery, tokens, normalizedContent) {
  const fields = {
    title: normalizeSearchText(doc.title),
    file: normalizeSearchText(doc.originalFile || doc.file),
    folderName: normalizeSearchText(doc.folderName || "")
  };

  let score = 0;
  let matched = false;

  for (const [field, how, worth] of QUERY_SCORES) {
    if (fields[field][how](normalizedQuery)) {
      score += worth;
      matched = true;
    }
  }

  // The text of the document, where a match near the top is worth more than
  // one at the bottom: the first mention is usually what it is about.
  const contentIndex = normalizedContent.indexOf(normalizedQuery);
  if (contentIndex >= 0) {
    score += 520 + Math.max(0, 140 - (contentIndex / 11));
    matched = true;
  }

  let tokenHits = 0;
  for (const token of tokens.filter(Boolean)) {
    for (const [field, worth] of TOKEN_SCORES) {
      if (fields[field].includes(token)) {
        tokenHits += worth;
      }
    }

    // A word found only in the text is still a match; a word found only in a
    // name is not, because the name matches are already scored above.
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

function prepare(db) {
  return db ? {
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
}

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
function plan(index, scope, docs) {
  const known = new Map(index.statements.known.all(scope).map((row) => [row.file, row]));
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

/* The writing half of the reconcile, under one immediate transaction so two
 * processes reconciling at once do not both index the same file.
 */
function prepareApply(db, statements) {
  return db ? db.transaction((scope, changed, gone, contents) => {
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
}

async function reconcile(index, scope, scopeDir, docs) {
  const { changed, gone } = plan(index, scope, docs);
  if (changed.length === 0 && gone.length === 0) {
    return;
  }

  const contents = new Map();
  await Promise.all(changed.map(async ({ doc }) => {
    try {
      contents.set(doc.file, await index.readContent(path.join(scopeDir, doc.file)));
    } catch {
      // Listed a moment ago and gone now. It is left out of the index; the
      // next walk will not list it at all.
    }
  }));

  index.apply.immediate(scope, changed, gone, contents);
}

async function candidatesFromIndex(index, { scope, scopeDir, docs, tokens }) {
  await reconcile(index, scope, scopeDir, docs);

  const byFile = new Map(docs.map((doc) => [doc.file, doc]));
  const rows = index.statements.candidates.all(scope, ftsMatchExpression(tokens));
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
async function candidatesFromScan(index, { scopeDir, docs }) {
  return Promise.all(docs.map(async (doc) => {
    const indexEntry = await index.readSearchIndexEntry(path.join(scopeDir, doc.file));
    return {
      doc,
      normalizedContent: indexEntry.normalizedContent,
      content: indexEntry.content,
      stat: indexEntry.stat,
      fromIndex: false
    };
  }));
}

async function searchDocuments(index, { query, docs, scopeDir, scope = "docs", limit: wanted = 0 }) {
  const normalizedQuery = normalizeSearchText(query).trim();
  if (!normalizedQuery) {
    return {
      matches: [],
      searchTerms: [],
      total: 0,
      limit: Math.min(wanted || index.resultLimit, index.resultLimit)
    };
  }

  const tokens = tokenizeSearchQuery(normalizedQuery);
  const searchTerms = [...new Set([normalizedQuery, ...tokens].filter(Boolean))];

  // Every token, not any: the scorer counts a document that contains any one
  // of the words, and a word too short for trigrams is one the index cannot
  // ask about. Mixing one in means the scan, which is rare and is right.
  const indexed = Boolean(index.db) && tokens.every((token) => token.length >= FTS_MIN_QUERY);
  const candidates = indexed
    ? await candidatesFromIndex(index, { scope, scopeDir, docs, tokens })
    : await candidatesFromScan(index, { scopeDir, docs });

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

  /* Snippets are cut only for the results that survive the limit, instead of
   * for every document that happened to match.
   *
   * `limit` is the caller's when it asks — the graph advertises up to a
   * thousand and used to get two hundred whatever it said — and the server's
   * ceiling otherwise.
   */
  const limit = Math.min(wanted || index.resultLimit, index.resultLimit);
  const limited = await Promise.all(
    scoredMatches.slice(0, limit).map(async ({ candidate, ...match }) => {
      // From the index the text is already in hand; from the scan it is
      // read through the snippet cache as before.
      const snippetSource = candidate.fromIndex
        ? collapseForSnippet(candidate.content)
        : await index.readSnippetSource(path.join(scopeDir, match.file), candidate.content, candidate.stat);

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

  /* `total` is how many matched, not how many came back.
   *
   * A ceiling that changes the answer without saying so is the worst thing a
   * search box can do: two hundred results looks like an answer, and there is
   * nothing in it to say the two hundred and first existed. So the count is
   * the real one and the caller can see it was cut.
   */
  return {
    matches: limited,
    searchTerms,
    total: scoredMatches.length,
    limit
  };
}

/* The index this server searches through.
 *
 * `db` is a handle and the prepared statements belong to it, which is why
 * there is a factory here at all — but nothing above closes over it: every
 * function takes the index as its first argument, so each can be read on its
 * own, and the reconcile can be reasoned about without reading the search
 * that calls it.
 */
function createSearch({ db, readSearchIndexEntry, readSnippetSource, readContent, resultLimit }) {
  const statements = prepare(db);
  const index = {
    db,
    statements,
    apply: prepareApply(db, statements),
    readSearchIndexEntry,
    readSnippetSource,
    readContent,
    resultLimit
  };

  return { searchDocuments: (options) => searchDocuments(index, options) };
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
