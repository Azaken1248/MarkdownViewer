// Per-document public share links.
//
// With PUBLIC_READS off, the whole app sits behind a login. A share link is the
// deliberate exception: one document, published at an unguessable URL, rendered
// on its own page with no explorer, no editor and no way to reach anything else.
//
// The share id is a 32-byte random token, so the URL *is* the credential. That
// means:
//   * it is stored hashed, so a leak of the database does not publish anything;
//   * the full token is returned exactly once, when the link is created;
//   * revoking is deleting the record, and rotating is revoke-then-create.
//
// Share pages are marked noindex, because "unguessable" stops being true the
// moment a crawler files it.

const crypto = require("crypto");
const path = require("path");
const { importJsonOnce } = require("./db");

const SHARE_TOKEN_BYTES = 32;

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

// A row as the rest of the app expects to see it. The column names are the
// database's; the field names are the ones every caller already uses.
function toShare(row) {
  return row
    ? {
      file: row.file,
      tokenHash: row.token_hash,
      createdAt: row.created_at,
      createdBy: row.created_by,
      views: row.views,
      lastViewedAt: row.last_viewed_at
    }
    : null;
}

class ShareStore {
  /* `db` is optional. The server opens one database and hands the same handle
   * to every store, which is what makes them one transactional world. Given
   * only a dataDir this opens its own — the same contract the constructor had
   * when the store owned a file, and what lets it be used on its own.
   */
  constructor({ dataDir, db = null }) {
    this.db = db || require("./db").open(dataDir);
    this.filePath = path.join(dataDir, "shares.json");
  }

  /* Kept because every caller still says `await store.withLock(...)`, and
   * because the shape it guaranteed is now guaranteed better. A read-modify-
   * write no longer needs a lock held across an await: each mutation below is
   * a single statement or a single SQLite transaction, which is atomic against
   * other processes as well as against this one — which the old in-process
   * promise chain never was.
   */
  async withLock(fn) {
    return fn();
  }

  async load() {
    importJsonOnce(this.db, {
      filePath: this.filePath,
      isEmpty: () => this.db.prepare("SELECT COUNT(*) AS n FROM shares").get().n === 0,
      load: (parsed) => {
        const shares = Array.isArray(parsed.shares) ? parsed.shares : [];
        const insert = this.db.prepare(
          `INSERT OR REPLACE INTO shares
             (file, token_hash, created_at, created_by, views, last_viewed_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        );
        this.db.transaction((rows) => {
          for (const share of rows) {
            insert.run(share.file, share.tokenHash, share.createdAt,
              share.createdBy ?? null, share.views || 0, share.lastViewedAt ?? null);
          }
        })(shares);
        return shares.length;
      }
    });
  }

  findByFile(file) {
    return toShare(this.db.prepare("SELECT * FROM shares WHERE file = ?").get(file));
  }

  findByToken(token) {
    if (!token) {
      return null;
    }

    return toShare(
      this.db.prepare("SELECT * FROM shares WHERE token_hash = ?").get(hashToken(token)));
  }

  // A document's share state as the API reports it. Never includes the token —
  // that is only ever returned by create().
  describe(file) {
    const share = this.findByFile(file);
    if (!share) {
      return { shared: false };
    }

    return {
      shared: true,
      createdAt: share.createdAt,
      createdBy: share.createdBy || null,
      views: share.views || 0,
      lastViewedAt: share.lastViewedAt || null
    };
  }

  // Creating a share for a document that already has one rotates it: the old
  // URL stops working immediately. That is the only way to "un-leak" a link.
  async create(file, { createdBy = null } = {}) {
    const token = crypto.randomBytes(SHARE_TOKEN_BYTES).toString("base64url");

    // One statement, so rotating a share cannot leave a document briefly
    // unshared or briefly holding two tokens.
    this.db.prepare(
      `INSERT INTO shares (file, token_hash, created_at, created_by, views, last_viewed_at)
       VALUES (?, ?, ?, ?, 0, NULL)
       ON CONFLICT(file) DO UPDATE SET
         token_hash = excluded.token_hash,
         created_at = excluded.created_at,
         created_by = excluded.created_by,
         views = 0,
         last_viewed_at = NULL`
    ).run(file, hashToken(token), new Date().toISOString(), createdBy);

    return token;
  }

  async revoke(file) {
    return this.db.prepare("DELETE FROM shares WHERE file = ?").run(file).changes > 0;
  }

  // Renaming a document must carry its share across, or the link 404s with no
  // explanation. Deleting one must revoke it, or a soft-deleted document stays
  // readable by anyone holding the URL.
  async rename(fromFile, toFile) {
    return this.db.prepare("UPDATE shares SET file = ? WHERE file = ?")
      .run(toFile, fromFile).changes > 0;
  }

  // Renaming or moving a folder moves every document under it in one operation
  // on disk. Shares are keyed by path, so they have to be re-keyed the same
  // way — one at a time would mean listing the directory just to find them.
  async renamePrefix(fromPrefix, toPrefix) {
    // LIKE would need the prefix escaped for % and _, both of which are legal
    // in a filename. substr/length is exactly the slice the loop used to do.
    return this.db.prepare(
      `UPDATE shares
          SET file = ? || substr(file, ?)
        WHERE substr(file, 1, ?) = ?`
    ).run(toPrefix, fromPrefix.length + 1, fromPrefix.length, fromPrefix).changes;
  }

  async recordView(file) {
    // A counter incremented in SQL rather than read, added to and written back,
    // so two readers at once are two views rather than one.
    this.db.prepare(
      "UPDATE shares SET views = views + 1, last_viewed_at = ? WHERE file = ?"
    ).run(new Date().toISOString(), file);
  }

  listShares() {
    // Ordered here rather than in SQL: localeCompare is what the list was
    // sorted by and it is not SQLite's collation.
    return this.db.prepare("SELECT * FROM shares").all()
      .map(toShare)
      .sort((left, right) => String(left.file).localeCompare(String(right.file)))
      .map((share) => ({
        file: share.file,
        createdAt: share.createdAt,
        createdBy: share.createdBy || null,
        views: share.views || 0,
        lastViewedAt: share.lastViewedAt || null
      }));
  }
}

module.exports = { ShareStore, hashToken };
