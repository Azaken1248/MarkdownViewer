/* The security events, and that the log never holds what it must not.
 *
 * A server is walked through the things an incident review asks about — a
 * sign-in, a wrong password, a lockout, a viewer trying to write, a share
 * made and rotated and revoked, a password changed, an account disabled, a
 * document erased — and the audit log is read back and checked line by
 * line. Then the other half: the log is searched for the password, the share
 * token, the session cookie, a document's text and a search term, and every
 * one of them has to be absent. A log that held any of those would be worth
 * stealing, and then it would be the incident.
 */

const fs = require("fs");
const path = require("path");
const { startTestServer, SEED_USERNAME, SEED_PASSWORD, TEST_PASSWORD } = require("./helpers/server");
const { makeClient } = require("./helpers/client");

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

(async () => {
  const server = await startTestServer();
  const logPath = path.join(server.stateDir, "data", "audit.jsonl");
  const lines = () => fs.readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const events = (name) => lines().filter((l) => l.event === name);

  try {
    const admin = makeClient(server.origin);
    const login = await admin.post("/api/auth/login", { username: SEED_USERNAME, password: SEED_PASSWORD },
      { "User-Agent": "audit-suite/1.0 (a browser, for the purposes of this line)" });
    await admin.post("/api/auth/password", { currentPassword: SEED_PASSWORD, newPassword: TEST_PASSWORD });

    console.log("=== signing in is written down ===");
    {
      const ok = events("login.ok");
      check("a successful sign-in is one line", ok.length, 1);
      check("...naming the account", ok[0].username, SEED_USERNAME);
      check("...and where it came from", typeof ok[0].ip, "string");
      check("...and what with, cut short", ok[0].userAgent.startsWith("audit-suite/1.0"), true);
      check("...with a timestamp", /^\d{4}-\d{2}-\d{2}T/.test(ok[0].ts), true);

      await makeClient(server.origin).post("/api/auth/login", { username: SEED_USERNAME, password: "not-it" });
      await makeClient(server.origin).post("/api/auth/login", { username: "nobody-here", password: "not-it" });
      const failed = events("login.failed");
      check("a wrong password is a line", failed.some((l) => l.username === SEED_USERNAME && l.reason === "bad-password"), true);
      check("...and so is a guess at an account that does not exist, which the response never says",
        failed.some((l) => l.username === "nobody-here" && l.reason === "no-such-user"), true);
    }

    console.log("=== a lockout is written down ===");
    {
      const guesser = makeClient(server.origin);
      for (let i = 0; i < 9; i += 1) {
        await guesser.post("/api/auth/login", { username: "lockout-me", password: "wrong" });
      }
      const locked = events("login.locked");
      check("the eighth failure locks the account, and says so", locked.some((l) => l.key === "user:lockout-me"), true);
      check("...for how long", locked[0].lockoutMs > 0, true);
      check("a guess made while locked is refused as locked, not as wrong",
        events("login.refused").some((l) => l.username === "lockout-me" && l.reason === "locked"), true);
    }

    console.log("=== a viewer asking to write is written down ===");
    {
      await admin.post("/api/users", { username: "reader", password: "kettle-drum-forty", role: "viewer", mustChangePassword: false });
      check("making the account is a line", events("user.created").some((l) => l.target === "reader" && l.role === "viewer" && l.user === SEED_USERNAME), true);

      const reader = makeClient(server.origin);
      await reader.post("/api/auth/login", { username: "reader", password: "kettle-drum-forty" });
      const tried = await reader.post("/api/docs", { fileName: "sneaky.md", content: "x" });
      check("the write is refused", tried.status, 403);
      const denied = events("permission.denied");
      check("...and written down, naming who, what and where",
        denied.some((l) => l.user === "reader" && l.permission === "doc:write" && l.path === "/api/docs"), true);
    }

    console.log("=== a share's life is written down ===");
    {
      const file = server.docPaths["beta.md"];
      const made = await admin.post(`/api/docs/${file}/share`);
      check("(a share was made)", made.status, 201);
      const rotated = await admin.post(`/api/docs/${file}/share`);
      check("(and rotated)", rotated.status, 201);
      await admin.del(`/api/docs/${file}/share`);

      check("made, rotated, revoked: three lines, in that order",
        lines().filter((l) => l.event.startsWith("share.") && l.file === file).map((l) => l.event),
        ["share.created", "share.rotated", "share.revoked"]);
      check("...each naming who", lines().filter((l) => l.event.startsWith("share.")).every((l) => l.user === SEED_USERNAME), true);

      // The token is the last segment of the share URL and is the credential.
      const token = String(made.body.url).split("/").pop();
      check("(the token is real)", typeof token === "string" && token.length > 20, true);
      check("the token is nowhere in the log", fs.readFileSync(logPath, "utf8").includes(token), false);
    }

    console.log("=== passwords and accounts are written down ===");
    {
      check("the admin's own change at first login is a line",
        events("password.changed").some((l) => l.user === SEED_USERNAME && l.by === "self"), true);

      const wrong = await admin.post("/api/auth/password", { currentPassword: "not-the-one", newPassword: "kettle-drum-forty-one" });
      check("(a wrong current password is refused)", wrong.status, 400);
      check("...and is a line, since a guess from inside a session is a guess", events("password.change.failed").length >= 1, true);

      const users = (await admin.get("/api/users")).body.users;
      const reader = users.find((u) => u.username === "reader");
      await admin.post(`/api/users/${reader.id}/password`, { password: "kettle-drum-forty-two" });
      check("an admin resetting someone's password is a line saying so",
        events("password.changed").some((l) => l.by === "admin" && l.target === "reader"), true);

      await admin.patch(`/api/users/${reader.id}`, { role: "editor" });
      check("a role change is a line", events("user.role").some((l) => l.target === "reader" && l.role === "editor"), true);
      await admin.patch(`/api/users/${reader.id}`, { disabled: true });
      check("disabling is a line", events("user.disabled").some((l) => l.target === "reader"), true);
      await admin.del(`/api/users/${reader.id}`);
      check("deleting is a line, naming the account that is gone", events("user.deleted").some((l) => l.target === "reader"), true);
    }

    console.log("=== erasing a document is written down ===");
    {
      const file = server.docPaths["epsilon.md"];
      await admin.post(`/api/docs/${file}/delete`, { mode: "hard" });
      const archived = (await admin.get("/api/archive")).body.docs.find((d) => d.originalFile === file);
      check("(the document is in the archive)", Boolean(archived), true);
      const erased = await admin.del(`/api/archive/${archived.file}`, { confirmFile: file });
      check("(and was erased)", erased.status, 200);
      check("erasing is a line, naming the file and who",
        events("doc.erased").some((l) => l.file === file && l.user === SEED_USERNAME), true);
    }

    console.log("=== and what the log must never hold ===");
    {
      const text = fs.readFileSync(logPath, "utf8");
      await admin.get("/api/docs/search?q=a-search-term-nobody-should-log");
      await admin.put(`/api/docs/${server.docPaths["beta.md"]}`, { content: "the text of a document, which is nobody's business" });
      const after = fs.readFileSync(logPath, "utf8");

      check("no password", [SEED_PASSWORD, TEST_PASSWORD, "kettle-drum-forty"].some((p) => after.includes(p)), false);
      check("no session cookie", after.includes(login.headers["set-cookie"][0].split("=")[1].split(";")[0]), false);
      check("no search term", after.includes("a-search-term-nobody-should-log"), false);
      check("no document text", after.includes("nobody's business"), false);
      check("no password hash", /scrypt\$/.test(after), false);
      check("reads and saves write no line at all: the log did not grow", after.length, text.length);

      const mode = fs.statSync(logPath).mode & 0o777;
      check("the file is readable by its owner and nobody else", mode.toString(8), "600");
      check("every line is one JSON object", after.trim().split("\n").every((l) => { try { JSON.parse(l); return true; } catch { return false; } }), true);
    }
  } finally {
    await server.stop();
  }

  console.log(failures === 0 ? "\nALL AUDIT CHECKS PASSED" : `\n${failures} AUDIT CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
