/* The metadata database, and the one property it exists for.
 *
 * Every store used to be a whole JSON file rewritten under an in-process lock.
 * That was safe in one process and silently lossy in two: both read, both
 * changed their own copy, both renamed, and the last one to finish threw the
 * other's work away. This suite runs three real processes against one data
 * directory at once and requires that nothing any of them wrote is missing.
 * It is the check that says the app may now be run as more than one process.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { fork } = require("child_process");
const db = require("../lib/db");
const { ShareStore } = require("../lib/shares");
const { LinkStore } = require("../lib/links");
const { AuthStore } = require("../lib/auth");
const { createOrganizerFile } = require("../lib/docs/organizer");
const { createChecker } = require("./helpers/check.js");

const { check, finish } = createChecker("DB");

const PER_PROCESS = 60;
const TAGS = ["alpha", "beta", "gamma"];

function runChild(dataDir, tag) {
  return new Promise((resolve) => {
    const child = fork(path.join(__dirname, "helpers", "many-processes.js"),
      [dataDir, tag, String(PER_PROCESS)], { stdio: "inherit" });
    child.on("exit", (code) => resolve(code));
  });
}

(async () => {
  console.log("=== many processes open one new database at the same instant ===");
  {
    /* A cluster starts all its workers at once, and every one of them opens
     * the same file that does not exist yet. The switch into WAL takes a lock
     * that SQLite will not wait for, and one boot in a thousand used to die
     * on it before reaching the schema. Eight at once, ten times: eighty
     * chances, and none of them may be refused.
     */
    const opener = path.join(__dirname, "helpers", "open-once.js");
    let refused = 0;
    for (let round = 0; round < 10; round += 1) {
      const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "azadocs-open-"));
      const codes = await Promise.all(Array.from({ length: 8 }, () => new Promise((resolve) => {
        fork(opener, [dataDir], { stdio: "ignore" }).on("exit", resolve);
      })));
      refused += codes.filter((code) => code !== 0).length;
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
    check("eighty simultaneous first opens, none refused", refused, 0);
  }

  console.log("=== three processes write to one database at once ===");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "azadocs-db-"));
  try {
    const codes = await Promise.all(TAGS.map((tag) => runChild(dataDir, tag)));
    check("every process finished cleanly", codes, [0, 0, 0]);

    const handle = db.open(dataDir);
    const shares = new ShareStore({ dataDir, db: handle }).listShares();
    const perTag = (rows, of) => Object.fromEntries(
      TAGS.map((tag) => [tag, rows.filter((row) => of(row).startsWith(tag)).length]));

    check(`every share is there: ${TAGS.length} x ${PER_PROCESS}`,
      perTag(shares, (share) => share.file),
      Object.fromEntries(TAGS.map((tag) => [tag, PER_PROCESS])));

    const links = new LinkStore({ dataDir, db: handle }).list();
    check("...and every link", perTag(links, (link) => link.title),
      Object.fromEntries(TAGS.map((tag) => [tag, PER_PROCESS])));

    const organizer = createOrganizerFile({
      filePath: path.join(dataDir, "document-organizer.json"), db: handle });
    const state = await organizer.readOrganizerState();
    check("...and every folder, which is the read-modify-write case that used to lose work",
      perTag(state.folders, (folder) => folder.name),
      Object.fromEntries(TAGS.map((tag) => [tag, PER_PROCESS])));
    check("...with no folder id written twice",
      new Set(state.folders.map((folder) => folder.id)).size, TAGS.length * PER_PROCESS);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  console.log("=== a JSON file from before is imported once, and set aside ===");
  {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "azadocs-import-"));
    try {
      fs.writeFileSync(path.join(dataDir, "shares.json"), JSON.stringify({
        version: 1,
        shares: [{ file: "old.md", tokenHash: "a".repeat(64), createdAt: "2026-01-01T00:00:00.000Z",
          createdBy: "aza", views: 3, lastViewedAt: null }]
      }));

      const first = new ShareStore({ dataDir });
      await first.load();
      check("the old share is there after the first boot", first.describe("old.md").shared, true);
      check("...with its view count", first.describe("old.md").views, 3);
      check("the file was set aside rather than deleted",
        fs.existsSync(path.join(dataDir, "shares.json.imported")), true);
      check("...and is no longer where a second boot would find it",
        fs.existsSync(path.join(dataDir, "shares.json")), false);

      await first.revoke("old.md");
      const second = new ShareStore({ dataDir });
      await second.load();
      check("a second boot does not resurrect what was revoked", second.describe("old.md").shared, false);

      // A damaged file is left exactly where it is, for a person.
      fs.writeFileSync(path.join(dataDir, "links.json"), "{ not json");
      const links = new LinkStore({ dataDir });
      await links.load();
      check("a damaged file imports nothing", links.list(), []);
      check("...and is left in place under its own name",
        fs.existsSync(path.join(dataDir, "links.json")), true);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  }

  console.log("=== and the accounts and sessions a boot before this one left ===");
  {
    /* The one import nothing had driven, and the one with a rule in it: an
     * expired session was dropped on load before the database existed, and has
     * to be dropped on the way in too, or importing resurrects a session
     * somebody's logout had ended.
     */
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "azadocs-auth-import-"));
    try {
      const hour = 60 * 60 * 1000;
      const future = new Date(Date.now() + hour).toISOString();
      const past = new Date(Date.now() - hour).toISOString();

      fs.writeFileSync(path.join(dataDir, "users.json"), JSON.stringify({
        version: 1,
        users: [
          { id: "u1", username: "aza", passwordHash: "x", role: "admin",
            createdAt: past, updatedAt: past },
          { id: "u2", username: "reader", passwordHash: "y", role: "viewer",
            disabled: true, mustChangePassword: true, createdAt: past, updatedAt: past }
        ]
      }));

      fs.writeFileSync(path.join(dataDir, "sessions.json"), JSON.stringify({
        version: 1,
        sessions: [
          { id: "live", userId: "u1", csrfToken: "t1", createdAt: past, expiresAt: future },
          { id: "expired", userId: "u1", csrfToken: "t2", createdAt: past, expiresAt: past },
          { id: "orphan", userId: "nobody", csrfToken: "t3", createdAt: past, expiresAt: future },
          { id: "", userId: "u1", csrfToken: "t4", createdAt: past, expiresAt: future }
        ]
      }));

      const auth = new AuthStore({ dataDir });
      await auth.load();

      check("the accounts from before are there",
        auth.listUsers().map((one) => one.username).sort(), ["aza", "reader"]);
      check("...with what each of them was, not a default",
        auth.listUsers().find((one) => one.username === "reader").disabled, true);

      /* Asked of the rows rather than through getSession, because a session's
       * id in the database is a hash of its token and these ids came out of a
       * file written by an older build.
       */
      const landed = auth.db.prepare("SELECT id FROM sessions").all().map((row) => row.id);

      check("a session that had not expired is still a session", landed, ["live"]);
      // Dropped on load before the database existed, and dropped on the way in
      // now: importing must not resurrect a session somebody's logout ended.
      check("...one that had expired is not", landed.includes("expired"), false);
      // A session whose account did not survive would fail the foreign key,
      // and is dead either way.
      check("...nor one whose account is not there", landed.includes("orphan"), false);
      check("...nor one with no id at all", landed.includes(""), false);

      check("both files were set aside rather than deleted",
        [fs.existsSync(path.join(dataDir, "users.json.imported")),
          fs.existsSync(path.join(dataDir, "sessions.json.imported"))], [true, true]);

      // A second boot reads the database rather than the files, which are no
      // longer where it would look.
      const again = new AuthStore({ dataDir });
      await again.load();
      check("a second boot does not import them twice",
        again.listUsers().length, 2);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  }

  console.log("=== a file of sessions where every one of them had expired ===");
  {
    /* Still set aside: it has been dealt with, and leaving it would mean
     * reading it again on every boot for the life of the install.
     */
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "azadocs-stale-import-"));
    try {
      const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      fs.writeFileSync(path.join(dataDir, "sessions.json"), JSON.stringify({
        version: 1,
        sessions: [{ id: "old", userId: "u1", csrfToken: "t", createdAt: past, expiresAt: past }]
      }));

      const auth = new AuthStore({ dataDir });
      await auth.load();
      check("a file of nothing but expired sessions imports none of them",
        auth.db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 0);
      check("...and is still set aside, because it has been dealt with",
        fs.existsSync(path.join(dataDir, "sessions.json.imported")), true);

      // And a file with no sessions array in it at all is nothing to import,
      // so there is nothing to set aside either.
      fs.writeFileSync(path.join(dataDir, "users.json"), JSON.stringify({ version: 1 }));
      const second = new AuthStore({ dataDir });
      await second.load();
      check("a file with no accounts in it is left where it is",
        fs.existsSync(path.join(dataDir, "users.json")), true);

      /* And a session that expires while it is open: asked for once, it is
       * gone — and the row goes with it rather than sitting in the table
       * until something else happens to notice.
       */
      const user = await auth.createUser({
        username: "expiring", password: "a-long-enough-password", role: "admin"
      });
      const { token } = await auth.createSession(user.user || user);
      check("a session just made is a session", Boolean(auth.getSession(token)), true);

      auth.db.prepare("UPDATE sessions SET expires_at = ?")
        .run(new Date(Date.now() - 1000).toISOString());
      check("...and one that has expired is not", auth.getSession(token), null);
      check("...with its row gone rather than left to be tripped over",
        auth.db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 0);
      check("...and asking with no token at all is no session",
        auth.getSession(""), null);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  }

  console.log("=== a user row is updated in place, never replaced ===");
  {
    // INSERT OR REPLACE is a delete and an insert, and the sessions table
    // cascades on delete — so a store that wrote users that way signed every
    // account out on every save, including the save that records a login.
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "azadocs-users-"));
    try {
      const auth = new AuthStore({ dataDir });
      await auth.load();
      const made = await auth.createUser({ username: "aza", password: "kettle-drum-fifteen", role: "admin", skipPasswordPolicy: true });
      const { token } = await auth.createSession(auth.findById(made.user.id));
      check("a session is issued", Boolean(auth.getSession(token)), true);

      await auth.updateUser(made.user.id, { role: "admin" });
      check("editing the account leaves its session alive", Boolean(auth.getSession(token)), true);

      const login = await auth.login("aza", "kettle-drum-fifteen");
      check("logging in again leaves the first session alive too", Boolean(auth.getSession(token)), true);
      check("...alongside the new one", Boolean(auth.getSession(login.token)), true);

      // A second account, because the store rightly refuses to disable the
      // only admin — which is what the first draft of this check tripped on.
      const viewer = await auth.createUser({ username: "guest", password: "kettle-drum-sixteen", role: "viewer", skipPasswordPolicy: true });
      const { token: guestToken } = await auth.createSession(auth.findById(viewer.user.id));
      check("a viewer's session is issued", Boolean(auth.getSession(guestToken)), true);
      const disabled = await auth.updateUser(viewer.user.id, { disabled: true });
      check("the account can be disabled", disabled.ok, true);
      check("...and that is what ends its sessions", auth.getSession(guestToken), null);
      check("...leaving the admin's alone", Boolean(auth.getSession(token)), true);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  }

  console.log("=== the login lockout survives a restart and is shared ===");
  {
    // It used to be in memory: a restart reset the count, which turned eight
    // guesses into eight per restart, and two processes each allowed eight.
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "azadocs-lockout-"));
    try {
      const first = new AuthStore({ dataDir });
      await first.load();
      await first.createUser({ username: "target", password: "kettle-drum-twenty", role: "viewer", skipPasswordPolicy: true });

      for (let i = 0; i < 7; i += 1) {
        await first.login("target", "wrong-guess", { ip: "10.0.0.9" });
      }
      check("seven wrong guesses do not lock the account",
        (await first.login("target", "kettle-drum-twenty", { ip: "10.0.0.9" })).ok, true);

      // A success clears the count, so start the eight again from a clean slate.
      for (let i = 0; i < 8; i += 1) {
        await first.login("target", "wrong-guess", { ip: "10.0.0.9" });
      }
      const locked = await first.login("target", "kettle-drum-twenty", { ip: "10.0.0.9" });
      check("the eighth locks it, and the right password is refused", locked.ok, false);
      check("...saying for how long", locked.retryAfterMs > 0, true);

      // "A restart": a second store over the same directory, as a new process
      // would be. The lockout is still there.
      const second = new AuthStore({ dataDir });
      await second.load();
      const stillLocked = await second.login("target", "kettle-drum-twenty", { ip: "10.0.0.9" });
      check("a restart does not lift the lockout", stillLocked.ok, false);

      // "A second process": a third store, the two open at once, counting
      // toward the same eight for a fresh account.
      await first.createUser({ username: "shared", password: "kettle-drum-twenty-one", role: "viewer", skipPasswordPolicy: true });
      const third = new AuthStore({ dataDir });
      await third.load();
      for (let i = 0; i < 4; i += 1) {
        await second.login("shared", "wrong-guess", { ip: "10.0.0.10" });
        await third.login("shared", "wrong-guess", { ip: "10.0.0.10" });
      }
      const eightAcrossTwo = await first.login("shared", "kettle-drum-twenty-one", { ip: "10.0.0.10" });
      check("four guesses from each of two processes are eight, not four and four", eightAcrossTwo.ok, false);

      // Bounded: an attacker presenting a fresh address per guess fills the
      // table only as far as the window, because each failure sweeps what has
      // aged out.
      const handle = db.open(dataDir);
      const before = /** @type {any} */ (handle.prepare("SELECT COUNT(*) AS n FROM login_attempts").get()).n;
      const aged = Date.now() - 16 * 60 * 1000;
      handle.prepare("UPDATE login_attempts SET locked_until = 0, last_attempt_at = ?").run(aged);
      await first.login("nobody", "wrong-guess", { ip: "10.0.0.11" });
      const after = /** @type {any} */ (handle.prepare("SELECT COUNT(*) AS n FROM login_attempts").get()).n;
      check("rows that have aged out of the window are swept by the next failure",
        [before > 2, after <= 2], [true, true]);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  }

  process.exit(finish());
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
