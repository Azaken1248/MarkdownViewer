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

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

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
      const before = handle.prepare("SELECT COUNT(*) AS n FROM login_attempts").get().n;
      const aged = Date.now() - 16 * 60 * 1000;
      handle.prepare("UPDATE login_attempts SET locked_until = 0, last_attempt_at = ?").run(aged);
      await first.login("nobody", "wrong-guess", { ip: "10.0.0.11" });
      const after = handle.prepare("SELECT COUNT(*) AS n FROM login_attempts").get().n;
      check("rows that have aged out of the window are swept by the next failure",
        [before > 2, after <= 2], [true, true]);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  }

  console.log(failures === 0 ? "\nALL DB CHECKS PASSED" : `\n${failures} DB CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
