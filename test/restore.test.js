/* A backup nobody has restored is a hypothesis.
 *
 * So this is the restore, performed: a real server is seeded and left running,
 * an archive is taken while it is running, the archive is unpacked into a
 * directory of its own, and a second server is booted against that — with
 * /healthz, which reads the document directory, as the assertion. Then the
 * things that would actually be lost are checked one at a time: the documents,
 * the accounts, a share link handed out before the backup was taken.
 *
 * It runs on every CI run, which is the point. "We have backups" is a claim
 * that is either checked or believed, and believed is how people find out.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");
const {
  startTestServer, SEED_USERNAME, SEED_PASSWORD, TEST_PASSWORD
} = require("./helpers/server.js");
const { makeClient } = require("./helpers/client.js");
const { WANTED_TABLES, REBUILDABLE_TABLES } = require("../tools/restore.js");
const { createChecker } = require("./helpers/check.js");

const { check, finish } = createChecker("RESTORE");
const ROOT = path.join(__dirname, "..");

const run = (script, args) => execFileSync(process.execPath,
  [path.join(ROOT, "tools", script), ...args], { encoding: "utf8" });

(async () => {
  console.log("=== the tables a restore must have are the tables there are ===");

  /* The first version of this list named a `folders` table this app has never
   * had, written from memory, and the restore check passed nothing and said
   * the archive was broken. So the list is checked against the schema.
   */
  const schema = fs.readFileSync(path.join(ROOT, "lib", "db.js"), "utf8");
  const created = [...schema.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)/g)]
    .map(([, name]) => name).sort();

  check("every table the restore insists on is one the app creates",
    WANTED_TABLES.filter((table) => !created.includes(table)), []);
  check("...and every table the app creates is either insisted on or named rebuildable",
    created.filter((table) => !WANTED_TABLES.includes(table)
      && !REBUILDABLE_TABLES.includes(table)), []);

  console.log("=== a backup taken while the app is running ===");

  const server = await startTestServer();
  const outDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "azadocs-backup-out-"));
  const restoreDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "azadocs-restored-"));
  let restored = null;

  try {
    /* A session and a share link, so there is something in the database worth
     * losing rather than only files on disk. The cookie-aware client is the
     * same one every other suite signs in with.
     */
    const admin = makeClient(server.origin);
    const signedIn = await admin.post("/api/auth/login",
      { username: SEED_USERNAME, password: SEED_PASSWORD });
    check("(signed in)", signedIn.status, 200);
    // The seeded admin must change its password before it may write anything,
    // which is the same thing a scripted first deploy runs into.
    await admin.post("/api/auth/password",
      { currentPassword: SEED_PASSWORD, newPassword: TEST_PASSWORD });
    await admin.get("/api/session");

    const before = await server.request("GET", "/healthz");
    check("(the server is up, with documents)", before.body.documents > 0, true);

    const made = await admin.post("/api/docs",
      { fileName: "survives-a-restore.md", content: "# Kept\n\nAcross the archive." });
    check("(a document written just before the backup)", made.status, 201);

    const shared = await admin.post("/api/docs/survives-a-restore.md/share");
    check("(and a link handed out)", shared.status, 201);
    const shareToken = shared.body.url.split("/").pop();

    // Nothing is stopped, quiesced or locked: the database is copied with
    // SQLite's own online backup and the rest are atomic files.
    const output = run("backup.js", ["--state", server.stateDir, "--out", outDir]);
    const archive = output.trim().split(/\s+/)[0];
    check("the archive was written", fs.existsSync(archive), true);
    check("...while the server carried on answering",
      (await server.request("GET", "/healthz")).status, 200);

    console.log("=== ...unpacks into something the app can boot against ===");

    // Into a directory of its own, never over the live one.
    const refused = (() => {
      try {
        run("restore.js", [archive, "--state", server.stateDir]);
        return false;
      } catch {
        return true;
      }
    })();
    check("restoring over a directory with something in it is refused", refused, true);

    const report = run("restore.js", [archive, "--state", restoreDir]);
    check("...and into an empty one it is not",
      report.includes("has the tables the app expects"), true);

    const db = new Database(path.join(restoreDir, "data", "azadocs.db"), { readonly: true });
    const tables = /** @type {{ name: string }[]} */ (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
    ).map((row) => row.name);
    const users = /** @type {{ n: number }} */ (
      db.prepare("SELECT COUNT(*) AS n FROM users").get()).n;
    db.close();

    check("the restored database has the tables",
      WANTED_TABLES.filter((table) => !tables.includes(table)), []);
    check("...and the accounts in them", users > 0, true);

    /* The end of the proof: a second server, against the restored copy,
     * answering the health check that reads the document directory.
     */
    restored = await startTestServer({ stateDir: restoreDir });
    const health = await restored.request("GET", "/healthz");
    check("a server boots against the restored state", health.status, 200);
    check("...and finds the documents", health.body.documents, before.body.documents + 1);

    // A fresh client against the restored server: the session cookie from the
    // first one is in the restored database too, but signing in again is the
    // stronger check and the login below makes it.
    const reader = makeClient(restored.origin);
    await reader.post("/api/auth/login",
      { username: SEED_USERNAME, password: TEST_PASSWORD });
    const document = await reader.get("/api/docs/survives-a-restore.md");
    check("the document written before the backup is in it",
      document.body.content.includes("Across the archive."), true);

    // The token was handed out before the backup and is stored only as a hash,
    // so this is the round trip that proves the shares table came across.
    const visitor = await restored.request("GET",
      `/api/share/${encodeURIComponent(shareToken)}`);
    check("a share link handed out before the backup still opens", visitor.status, 200);
    check("...onto the same document", visitor.body.file, "survives-a-restore.md");

    // Signing in against the restored copy proves the password hashes came
    // across, not just that the rows are countable.
    const login = await makeClient(restored.origin).post("/api/auth/login",
      { username: SEED_USERNAME, password: TEST_PASSWORD });
    check("and the account can still sign in with the password it had", login.status, 200);

    console.log("=== and what it does not carry ===");

    const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).split("\n");
    check("the live database's write-ahead log is not in it, only the snapshot",
      entries.some((one) => one.endsWith("-wal") || one.endsWith("-shm")), false);
    check("...and the documents are", entries.some((one) => one.includes("/docs/")), true);
  } finally {
    await restored?.stop();
    await server.stop();
    await fs.promises.rm(outDir, { recursive: true, force: true });
    await fs.promises.rm(restoreDir, { recursive: true, force: true });
  }

  process.exit(finish());
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
