/* The one database the metadata lives in.
 *
 * The documents themselves stay on disk as ordinary Markdown files — that is
 * what makes this library greppable, inspectable and backed up by copying a
 * directory, and it does not change. What moves in here is only the metadata:
 * accounts, sessions, share links, saved links and the folder assignments.
 *
 * Why at all: each of those used to be a whole JSON file, rewritten under an
 * in-process lock. The write mechanics were correct — temp file, fsync, atomic
 * rename — and within one process they were genuinely safe. Across two they
 * were not, and the failure was silent: both processes read, both mutated their
 * own copy, both renamed, and the last one to finish quietly threw the other's
 * work away. So the app could not be run under `cluster`, under PM2 in cluster
 * mode, or as two containers behind a load balancer. Not because anyone had
 * decided that, but because nothing said otherwise.
 *
 * better-sqlite3 rather than a driver with callbacks, for one reason that
 * decides the whole shape of this change: it is synchronous. `getSession()` is
 * called on every request and is synchronous today; `findByUsername()` and
 * `list()` are synchronous today. A promise-based driver would have made all of
 * them async and rippled through every caller. A synchronous driver means the
 * stores keep the interface they already had, and a SELECT sits where a lookup
 * through an in-memory array used to.
 *
 * WAL, because it is what lets a reader and a writer coexist rather than
 * blocking each other, and `busy_timeout` so a writer waiting on another
 * process's transaction waits instead of failing.
 */

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

// Bumped when the schema below changes shape. The migrations are applied in
// order and each one is expected to be safe to run against a database that has
// already had the ones before it.
const SCHEMA_VERSION = 1;

// How long a write waits for another process's transaction before giving up.
// Generous: the alternative to waiting is SQLITE_BUSY, which surfaces as a
// failed request for something that would have succeeded a moment later.
const BUSY_TIMEOUT_MS = 5000;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS shares (
    file          TEXT PRIMARY KEY,
    token_hash    TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    created_by    TEXT,
    views         INTEGER NOT NULL DEFAULT 0,
    last_viewed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS shares_token_hash ON shares (token_hash);

  CREATE TABLE IF NOT EXISTS links (
    id            TEXT PRIMARY KEY,
    url           TEXT NOT NULL,
    -- The URL reduced the way canonicalKey() reduces it, written on every
    -- insert and update. "Is this already saved?" is a lookup rather than a
    -- scan that has to run JavaScript over every row.
    canonical_key TEXT NOT NULL,
    resolved_url  TEXT,
    title         TEXT NOT NULL DEFAULT '',
    description   TEXT NOT NULL DEFAULT '',
    site_name     TEXT NOT NULL DEFAULT '',
    -- Nullable on purpose, and it carries three states. NULL means the link
    -- has never been asked for an icon at all — links saved before icons
    -- existed. '' means it was asked and the page offered nothing usable,
    -- which is a settled answer and stops it being asked again. A default of
    -- '' here would quietly turn every never-asked link into an answered one.
    icon          TEXT,
    note          TEXT NOT NULL DEFAULT '',
    -- A JSON array. Groups are a property of a link and are only ever read and
    -- written whole; a join table would buy nothing and cost a migration.
    groups_json   TEXT NOT NULL DEFAULT '[]',
    fetched       INTEGER NOT NULL DEFAULT 0,
    fetch_error   TEXT,
    created_at    TEXT NOT NULL,
    created_by    TEXT,
    refreshed_at  TEXT
  );
  CREATE INDEX IF NOT EXISTS links_canonical_key ON links (canonical_key);

  CREATE TABLE IF NOT EXISTS users (
    id                  TEXT PRIMARY KEY,
    username            TEXT NOT NULL UNIQUE,
    password_hash       TEXT NOT NULL,
    role                TEXT NOT NULL,
    disabled            INTEGER NOT NULL DEFAULT 0,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT,
    updated_at          TEXT,
    password_changed_at TEXT,
    last_login_at       TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    -- The hash of the token, never the token. A leak of this table does not
    -- hand anybody a session, which is why it was hashed in the file too.
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    csrf_token TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    user_agent TEXT NOT NULL DEFAULT '',
    ip         TEXT NOT NULL DEFAULT '',
    -- Deleting an account takes its sessions with it, in the same transaction,
    -- rather than depending on somebody remembering to sweep them.
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions (user_id);
  CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions (expires_at);

  -- The folder tree and which document lives in which folder, as one JSON
  -- document in one row. Deliberately not normalised: every mutation reads the
  -- whole state, changes it and writes it back, and lib/docs/organizer.js has
  -- five hundred lines of logic over that shape. What this row buys is that
  -- the read-modify-write is now a transaction — two processes cannot
  -- interleave it — which is the property this whole database exists for.
  -- Breaking it into folders and assignments tables would be a later refactor
  -- for a cost (O(state) per write) that is nothing at this app's size.
  CREATE TABLE IF NOT EXISTS organizer (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    state_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

function open(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, "azadocs.db"));

  // NORMAL rather than FULL: with WAL this still cannot corrupt the database,
  // and it does not fsync on every commit. The thing being protected here is
  // metadata that is rebuilt or re-entered, not the documents.
  //
  // Set before the journal mode, not after. The switch to WAL on a brand-new
  // file is itself a write, and under the default FULL it fsyncs its way
  // through — measured at 500ms on an ordinary disk, which was most of the
  // server's boot. It is a one-time cost per database, but a test server boots
  // a fresh one every suite, and half a second moved every later request into
  // the window where the asset warm is competing for the loop.
  db.pragma("synchronous = NORMAL");
  // WAL survives a reopen, so this is a no-op after the first boot. Set anyway:
  // it is the property everything else here assumes, and a database that lost
  // it should get it back rather than quietly serialise every reader.
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = " + BUSY_TIMEOUT_MS);
  db.pragma("foreign_keys = ON");

  // One transaction, so the tables are one fsync rather than one each — and
  // an immediate one. IF NOT EXISTS reads the schema before it writes, and
  // several processes opening the same new database at once (a cluster
  // starting its workers) would each read "not there", each try to create,
  // and all but one fail with BUSY_SNAPSHOT. Taking the write lock first makes
  // the second one wait and then find the tables already there.
  db.transaction(() => db.exec(SCHEMA)).immediate();
  db.pragma(`user_version = ${SCHEMA_VERSION}`);

  return db;
}

/* The JSON file that used to hold this table, imported once and then set aside.
 *
 * This is the upgrade path for a library that already exists, and it is also
 * how the tests lay out a starting state: they write the JSON a server is about
 * to read. So it runs on every boot rather than once ever — if the file is
 * there and the table is empty, it is a state somebody meant.
 *
 * The file is renamed rather than deleted afterwards. Nothing here is clever
 * enough to be trusted with the only copy of somebody's accounts, and a
 * `.imported` file beside the database is a rollback that needs no backup
 * anyone remembered to take.
 */
function importJsonOnce(db, { filePath, isEmpty, load }) {
  if (!fs.existsSync(filePath) || !isEmpty()) {
    return 0;
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    // Damaged JSON is left exactly where it is, under its own name, for a
    // person to look at. Importing half of it would be worse than importing
    // none, and renaming it would hide the evidence.
    return 0;
  }

  const imported = load(parsed);
  if (imported > 0) {
    fs.renameSync(filePath, `${filePath}.imported`);
  }

  return imported;
}

module.exports = { open, importJsonOnce, SCHEMA_VERSION, BUSY_TIMEOUT_MS };
