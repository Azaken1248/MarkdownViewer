#!/usr/bin/env node
/* The other half, which is the half that matters.
 *
 * A backup nobody has restored is a hypothesis. This is the command that
 * tests it, and `npm test restore` is that command run against a seeded
 * library on every CI run — so the claim "we have backups" is checked rather
 * than believed.
 *
 *   node tools/restore.js <archive> --state /tmp/check
 *   node tools/restore.js <archive> --state /var/lib/mdviewer --force
 *
 * It refuses a directory that already has something in it unless --force says
 * otherwise, because the obvious use is restoring beside a running instance to
 * see whether the archive is any good, and the obvious accident is typing the
 * live path while doing it.
 *
 * What it checks after unpacking is what a restore has to be right about: the
 * database opens, it has the tables the app expects, and the documents are
 * where the app will look for them. Booting the app against the result is the
 * end of the proof — /healthz reads the document directory and answers 503 if
 * it cannot, which is exactly the assertion wanted.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DB_NAME = "azadocs.db";

/* The tables whose absence means the archive is not a backup.
 *
 * Not every table lib/db.js creates: document_index is a search index the app
 * rebuilds from the documents themselves, and login_attempts is a rate-limit
 * window that is meaningless an hour later. Restoring without those two costs
 * nothing; restoring without these five loses accounts, sessions, share links,
 * saved links or the folder tree.
 *
 * The list is checked against what lib/db.js actually creates by the `restore`
 * suite, because the first version of it was written from memory and named a
 * `folders` table this app has never had.
 */
const WANTED_TABLES = ["users", "sessions", "shares", "links", "organizer"];
const REBUILDABLE_TABLES = ["document_index", "login_attempts"];

function options(argv) {
  const read = (name, fallback) => {
    const at = argv.indexOf(`--${name}`);
    return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
  };

  return {
    archive: argv.find((one) => !one.startsWith("--") && argv[argv.indexOf(one) - 1] !== "--state"),
    stateDir: path.resolve(read("state", "")),
    force: argv.includes("--force")
  };
}

function inspect(stateDir) {
  const dbPath = path.join(stateDir, "data", DB_NAME);
  const found = { documents: 0, tables: [], rows: {} };

  const walk = (dir) => {
    for (const entry of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        found.documents += 1;
      }
    }
  };

  walk(path.join(stateDir, "docs"));

  if (fs.existsSync(dbPath)) {
    const db = new Database(dbPath, { readonly: true });
    try {
      found.tables = /** @type {{ name: string }[]} */ (db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
      ).all()).map((row) => row.name);

      for (const table of WANTED_TABLES) {
        if (found.tables.includes(table)) {
          found.rows[table] = /** @type {{ n: number }} */ (
            db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).n;
        }
      }
    } finally {
      db.close();
    }
  }

  return found;
}

function main(argv) {
  const { archive, stateDir, force } = options(argv);

  if (!archive || !stateDir) {
    console.error("usage: node tools/restore.js <archive.tar.gz> --state <directory> [--force]");
    return 2;
  }

  if (!fs.existsSync(archive)) {
    console.error(`No archive at ${archive}.`);
    return 1;
  }

  const existing = fs.existsSync(stateDir) ? fs.readdirSync(stateDir) : [];
  if (existing.length > 0 && !force) {
    console.error(`${stateDir} is not empty. Restoring would write over ${existing.length} `
      + "entries; pass --force if that is what you meant.");
    return 1;
  }

  fs.mkdirSync(stateDir, { recursive: true });
  execFileSync("tar", ["-xzf", archive, "-C", stateDir], { stdio: ["ignore", "ignore", "pipe"] });

  const found = inspect(stateDir);
  const missing = WANTED_TABLES.filter((table) => !found.tables.includes(table));

  console.log(`restored to ${stateDir}`);
  console.log(`  ${found.documents} document file(s)`);
  for (const [table, count] of Object.entries(found.rows)) {
    console.log(`  ${count} ${table}`);
  }

  if (missing.length > 0) {
    console.error(`\nThe database is missing: ${missing.join(", ")}. `
      + "This archive is not a complete backup.");
    return 1;
  }

  console.log("\nThe database opens and has the tables the app expects. Boot against it with:");
  console.log(`  MDVIEWER_STATE_DIR=${stateDir} PORT=4322 npm start`);
  console.log("  curl -s localhost:4322/healthz");
  return 0;
}

// Required by the restore suite, which checks the list above against the
// schema rather than trusting it.
module.exports = { WANTED_TABLES, REBUILDABLE_TABLES, inspect };

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
