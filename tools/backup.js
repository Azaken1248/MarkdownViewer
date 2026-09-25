#!/usr/bin/env node
/* A backup of everything a running instance cannot regenerate.
 *
 * The four directories under MDVIEWER_STATE_DIR are the product: every
 * document, every folder assignment, every account, every share token, every
 * uploaded image. They are correctly not in git, and until this file nothing
 * else took responsibility for them either. Atomic writes survive a crash
 * mid-write; they do nothing about a lost disk, a deleted volume or an rm -rf
 * in the wrong terminal. The recycle bin is a user-facing undo on the same
 * disk, which is not a backup of anything.
 *
 * Runnable while the app is running, which is the only kind anybody actually
 * runs on a schedule:
 *
 *   - The database is copied with SQLite's own online backup, so what lands is
 *     a consistent snapshot of a live WAL database rather than a file that was
 *     being written to. No quiescing, no stopping the container.
 *   - Everything else is plain files written atomically, so a copy gets the
 *     old one or the new one and never half of one.
 *
 * What is still possible is skew: a document saved between the database
 * snapshot and the file copy is on disk with no row, or the other way round.
 * The app treats the directory as the truth and the database as an index it
 * rebuilds from, so that resolves itself — but it is the reason this copies
 * the database first and the documents second, rather than the reverse.
 *
 *   node tools/backup.js --out /var/backups/mdviewer
 *   node tools/backup.js --out /var/backups/mdviewer --keep 30
 *
 * Writing the archive somewhere else is the important half and is not this
 * script's job: a copy on the same disk is not a backup. Point --out at a
 * mount, or rsync what it writes.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

const DB_NAME = "azadocs.db";

// The WAL and shared-memory files belong to the live database and are already
// folded into the snapshot. Copying them would put a second, older opinion
// about the same data into the archive.
const NOT_COPIED = new Set([DB_NAME, `${DB_NAME}-wal`, `${DB_NAME}-shm`]);

function options(argv) {
  const read = (name, fallback) => {
    const at = argv.indexOf(`--${name}`);
    return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
  };

  return {
    stateDir: path.resolve(read("state", process.env.MDVIEWER_STATE_DIR || ".")),
    outDir: path.resolve(read("out", ".")),
    keep: Number(read("keep", "0")) || 0
  };
}

function stamp() {
  // Sortable, and legal in a filename on every system this might land on.
  return new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");
}

/* The database, snapshotted while it is being used.
 *
 * db.backup() is SQLite's online backup: it copies pages under a read lock it
 * takes and releases as it goes, so a writer is never blocked out and what is
 * written is one consistent point in time. A plain file copy of a WAL database
 * is the thing this exists to avoid.
 */
async function snapshotDatabase(from, to) {
  const db = new Database(from, { readonly: true });
  try {
    await db.backup(to);
  } finally {
    db.close();
  }
}

async function stage(stateDir, into) {
  const dataDir = path.join(stateDir, "data");
  const dbPath = path.join(dataDir, DB_NAME);

  fs.mkdirSync(path.join(into, "data"), { recursive: true });

  if (fs.existsSync(dbPath)) {
    await snapshotDatabase(dbPath, path.join(into, "data", DB_NAME));
  }

  // The rest of data/ is the audit log and the organizer file: plain files,
  // written atomically.
  for (const entry of fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : []) {
    if (NOT_COPIED.has(entry)) {
      continue;
    }

    fs.cpSync(path.join(dataDir, entry), path.join(into, "data", entry), { recursive: true });
  }

  // ...and then the documents, the recycle bin and the uploads, which is most
  // of the bytes and none of the difficulty.
  for (const name of ["docs", "assets", "deleted_markdowns"]) {
    const from = path.join(stateDir, name);
    if (fs.existsSync(from)) {
      fs.cpSync(from, path.join(into, name), { recursive: true });
    }
  }
}

// Oldest first, so keeping the newest N is dropping the front of the list.
function archivesIn(dir) {
  return fs.readdirSync(dir)
    .filter((name) => /^azadocs-.*\.tar\.gz$/.test(name))
    .sort();
}

function prune(outDir, keep) {
  if (keep <= 0) {
    return [];
  }

  const dropped = archivesIn(outDir).slice(0, -keep);
  for (const name of dropped) {
    fs.rmSync(path.join(outDir, name));
  }

  return dropped;
}

async function main(argv) {
  const { stateDir, outDir, keep } = options(argv);

  if (!fs.existsSync(stateDir)) {
    console.error(`No state directory at ${stateDir}.`);
    return 1;
  }

  fs.mkdirSync(outDir, { recursive: true });
  const archive = path.join(outDir, `azadocs-${stamp()}.tar.gz`);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "azadocs-backup-"));

  try {
    await stage(stateDir, staging);
    // gzip rather than zstd: this has to run inside the image as well as on a
    // host, and tar with -z is everywhere that tar is.
    execFileSync("tar", ["-czf", archive, "-C", staging, "."], { stdio: ["ignore", "ignore", "pipe"] });
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }

  const size = fs.statSync(archive).size;
  console.log(`${archive}  ${(size / 1024 / 1024).toFixed(1)} MB`);

  for (const dropped of prune(outDir, keep)) {
    console.log(`removed ${dropped}`);
  }

  /* The sentence somebody needs to read, every time, until it is true.
   *
   * Two of the three things that make this a backup rather than a ritual are
   * not this script's to do: getting the archive off the machine, and having
   * restored one at least once. `npm test restore` is the third.
   */
  if (path.resolve(outDir).startsWith(path.resolve(stateDir))) {
    console.log("\nThis archive is inside the directory it is a backup of. "
      + "Point --out somewhere else.");
  }

  return 0;
}

main(process.argv.slice(2)).then((code) => process.exit(code)).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
