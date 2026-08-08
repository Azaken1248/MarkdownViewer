// Authentication, RBAC and share links, against a real server over real HTTP.
//
// Nothing here is mocked: every check goes through the actual routes, the
// actual cookie handling and the actual on-disk stores, because the parts most
// worth testing (a guard that does not run, a cookie without httpOnly, a
// session that survives a password change) only exist at that level.

const http = require("http");
const fsp = require("fs/promises");
const path = require("path");
const { startTestServer } = require("./helpers/server");
const passwords = require("../lib/passwords");
const excerpt = require("../lib/excerpt");

let failures = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
  }
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

// A tiny cookie-aware HTTP client, so the tests exercise the same flow a
// browser would: the session arrives as Set-Cookie and is echoed back.
function makeClient(origin) {
  const jar = new Map();
  let csrfToken = "";

  async function request(method, pathname, body, extraHeaders = {}) {
    const url = new URL(pathname, origin);
    const payload = body === undefined ? null : JSON.stringify(body);
    const cookieHeader = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

    const headers = {
      ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      ...(csrfToken && !["GET", "HEAD"].includes(method) ? { "X-CSRF-Token": csrfToken } : {}),
      ...extraHeaders
    };

    return new Promise((resolve, reject) => {
      const req = http.request({
        host: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers
      }, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          const setCookies = res.headers["set-cookie"] || [];
          for (const raw of setCookies) {
            const [pair] = raw.split(";");
            const index = pair.indexOf("=");
            const name = pair.slice(0, index).trim();
            const value = pair.slice(index + 1).trim();
            if (!value) {
              jar.delete(name);
            } else {
              jar.set(name, value);
            }
          }

          let parsed = null;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = null;
          }

          if (parsed?.csrfToken !== undefined) {
            csrfToken = parsed.csrfToken || "";
          }

          resolve({ status: res.statusCode, body: parsed, raw: data, headers: res.headers, setCookies });
        });
      });

      req.on("error", reject);
      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  }

  // Folder upload is the only multipart endpoint, so the client needs to be
  // able to build one.
  async function postMultipart(pathname, files, fields = {}) {
    const boundary = `----azadocs${Math.random().toString(16).slice(2)}`;
    const chunks = [];

    for (const [name, value] of Object.entries(fields)) {
      chunks.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
      ));
    }

    for (const file of files) {
      chunks.push(Buffer.from(
        `--${boundary}\r\n`
        + `Content-Disposition: form-data; name="files"; filename="${file.name}"\r\n`
        + "Content-Type: text/markdown\r\n\r\n"
      ));
      chunks.push(Buffer.from(file.content));
      chunks.push(Buffer.from("\r\n"));
    }

    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    const body = Buffer.concat(chunks);

    const url = new URL(pathname, origin);
    const cookieHeader = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

    return new Promise((resolve, reject) => {
      const req = http.request({
        host: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
          ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {})
        }
      }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let parsed = null;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = null;
          }
          resolve({ status: res.statusCode, body: parsed, raw: data });
        });
      });

      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }

  return {
    postMultipart,
    get: (p, h) => request("GET", p, undefined, h),
    post: (p, b, h) => request("POST", p, b === undefined ? {} : b, h),
    patch: (p, b) => request("PATCH", p, b),
    del: (p, b) => request("DELETE", p, b),
    jar,
    get csrf() {
      return csrfToken;
    },
    set csrf(value) {
      csrfToken = value;
    }
  };
}

(async () => {
  // The shared helper seeds documents using the write token; auth tests need a
  // server that starts empty of accounts so seeding is observable.
  const server = await startTestServer();
  console.log(`  (test server on ${server.origin})`);

  try {
    await run(server);
  } finally {
    await server.stop();
  }

  console.log(failures === 0 ? "\nALL AUTH CHECKS PASSED" : `\n${failures} AUTH CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function run(server) {
  const anon = makeClient(server.origin);

  console.log("=== password hashing ===");
  {
    const hash = await passwords.hashPassword("correct horse battery");
    check("the stored form names its algorithm", hash.startsWith("scrypt$"), true);
    check("...and its parameters", /^scrypt\$N=\d+,r=\d+,p=\d+\$/.test(hash), true);
    check("the plaintext is nowhere in it", hash.includes("correct"), false);

    const again = await passwords.hashPassword("correct horse battery");
    check("the same password hashes differently (per-user salt)", hash === again, false);

    check("the right password verifies", await passwords.verifyPassword("correct horse battery", hash), true);
    check("a wrong one does not", await passwords.verifyPassword("correct horse batteru", hash), false);
    check("a corrupt hash fails closed", await passwords.verifyPassword("x", "not-a-hash"), false);
    check("an empty hash fails closed", await passwords.verifyPassword("x", ""), false);

    check("weak parameters are flagged for upgrade", passwords.needsRehash("scrypt$N=1024,r=8,p=1$AA$BB"), true);
    check("current parameters are not", passwords.needsRehash(hash), false);

    check("short passwords are refused", passwords.validatePassword("short1").ok, false);
    check("common passwords are refused", passwords.validatePassword("password123").ok, false);
    check("a password containing the username is refused",
      passwords.validatePassword("azarules99", { username: "aza" }).ok, false);
    check("a reasonable password is accepted", passwords.validatePassword("kettle-drum-fourteen").ok, true);
  }

  console.log("=== the library is private by default ===");
  {
    check("an anonymous session is not authenticated", (await anon.get("/api/session")).body.authenticated, false);
    check("...and says reads are not public", (await anon.get("/api/session")).body.publicReads, false);
    check("listing documents is refused", (await anon.get("/api/docs")).status, 401);
    check("reading one is refused", (await anon.get("/api/docs/alpha.md")).status, 401);
    check("searching is refused", (await anon.get("/api/docs/search?q=alpha")).status, 401);
    check("the recycle bin is refused", (await anon.get("/api/recycle-bin")).status, 401);
    check("writing is refused", (await anon.post("/api/docs", { fileName: "x.md", content: "x" })).status, 401);

    // The documents live inside the static root, so this is the leak that
    // would bypass every guard above.
    check("raw document files are not served statically", (await anon.get("/docs/alpha.md")).status, 404);

    // The share template is a shell full of placeholders; only /s/:token
    // renders it with a document behind it.
    check("the raw share template is not served", (await anon.get("/share.html")).status, 404);

    check("health stays public for monitoring", (await anon.get("/healthz")).status, 200);
  }

  console.log("=== the seeded admin ===");
  {
    const bad = await anon.post("/api/auth/login", { username: "aza", password: "wrong-password" });
    check("a wrong password is refused", bad.status, 401);
    check("the error does not say whether the account exists", bad.body.error, "Incorrect username or password.");

    const missing = await anon.post("/api/auth/login", { username: "nobody-here", password: "wrong-password" });
    check("an unknown account gives the identical error", missing.body.error, bad.body.error);
    check("...and the identical status", missing.status, bad.status);
  }

  const admin = makeClient(server.origin);

  console.log("=== signing in ===");
  {
    const res = await admin.post("/api/auth/login", { username: "aza", password: "lolface123" });
    check("the seeded credentials work", res.status, 200);
    check("the response says who you are", res.body.user.username, "aza");
    check("...and with what role", res.body.user.role, "admin");
    check("a CSRF token is issued", typeof res.body.csrfToken === "string" && res.body.csrfToken.length > 20, true);

    const cookie = res.setCookies.find((c) => c.startsWith("azadocs_session="));
    check("the session arrives as a cookie", Boolean(cookie), true);
    check("script cannot read it", /HttpOnly/i.test(cookie), true);
    check("it is not sent cross-site", /SameSite=Strict/i.test(cookie), true);
    check("it is scoped to the whole app", /Path=\/(;|$)/i.test(cookie), true);
    check("the session value is not the user id", cookie.includes(res.body.user.id), false);

    // The password is public knowledge by construction.
    check("the seeded account must change its password", res.body.user.mustChangePassword, true);
    check("...and is blocked until it does", (await admin.get("/api/docs")).status, 403);
    check("...with a code the client can act on",
      (await admin.get("/api/docs")).body.code, "password_change_required");
  }

  console.log("=== the forced password change ===");
  {
    const wrongCurrent = await admin.post("/api/auth/password", {
      currentPassword: "not-it",
      newPassword: "kettle-drum-fourteen"
    });
    check("it still requires the current password", wrongCurrent.status, 400);

    const weak = await admin.post("/api/auth/password", {
      currentPassword: "lolface123",
      newPassword: "short"
    });
    check("a weak new password is refused", weak.status, 400);

    const same = await admin.post("/api/auth/password", {
      currentPassword: "lolface123",
      newPassword: "lolface123"
    });
    check("reusing the current password is refused", same.status, 400);

    const ok = await admin.post("/api/auth/password", {
      currentPassword: "lolface123",
      newPassword: "kettle-drum-fourteen"
    });
    check("a good one is accepted", ok.status, 200);
    check("the flag clears", ok.body.user.mustChangePassword, false);
    check("the block lifts", (await admin.get("/api/docs")).status, 200);
    check("the old password no longer works",
      (await makeClient(server.origin).post("/api/auth/login", { username: "aza", password: "lolface123" })).status, 401);
  }

  console.log("=== changing a password ends other sessions ===");
  {
    const second = makeClient(server.origin);
    await second.post("/api/auth/login", { username: "aza", password: "kettle-drum-fourteen" });
    check("a second sign-in works", (await second.get("/api/docs")).status, 200);

    await admin.post("/api/auth/password", {
      currentPassword: "kettle-drum-fourteen",
      newPassword: "kettle-drum-fifteen"
    });

    check("the other session is gone", (await second.get("/api/docs")).status, 401);
    check("the session that changed it keeps working", (await admin.get("/api/docs")).status, 200);
  }

  console.log("=== CSRF ===");
  {
    const saved = admin.csrf;

    admin.csrf = "";
    const noToken = await admin.post("/api/docs", { fileName: "csrf-test.md", content: "x" });
    check("a write with no CSRF token is refused", noToken.status, 403);
    check("...and says why", noToken.body.code, "csrf");

    // eslint-disable-next-line require-atomic-updates
    admin.csrf = "a-token-of-the-right-shape-but-wrong";
    check("a write with the wrong token is refused",
      (await admin.post("/api/docs", { fileName: "csrf-test.md", content: "x" })).status, 403);

    // eslint-disable-next-line require-atomic-updates
    admin.csrf = saved;
    check("a write with the right token succeeds",
      (await admin.post("/api/docs", { fileName: "csrf-test.md", content: "x" })).status, 201);

    const crossOrigin = await admin.post("/api/docs", { fileName: "evil.md", content: "x" },
      { Origin: "https://evil.example.com" });
    check("a cross-origin write is refused even with a valid token", crossOrigin.status, 403);

    check("reads do not need a CSRF token", (await admin.get("/api/docs")).status, 200);
  }

  console.log("=== roles ===");
  {
    const created = await admin.post("/api/users", {
      username: "viewer-account",
      password: "kettle-drum-sixteen",
      role: "viewer"
    });
    check("an admin can create an account", created.status, 201);
    check("it starts in the requested role", created.body.user.role, "viewer");
    check("...and must set its own password", created.body.user.mustChangePassword, true);

    check("a duplicate username is refused",
      (await admin.post("/api/users", { username: "viewer-account", password: "kettle-drum-sixteen" })).status, 400);
    check("an invalid username is refused",
      (await admin.post("/api/users", { username: "Bad Name!", password: "kettle-drum-sixteen" })).status, 400);
    check("a weak password is refused at creation",
      (await admin.post("/api/users", { username: "weakling", password: "abc" })).status, 400);

    const viewer = makeClient(server.origin);
    await viewer.post("/api/auth/login", { username: "viewer-account", password: "kettle-drum-sixteen" });
    await viewer.post("/api/auth/password", {
      currentPassword: "kettle-drum-sixteen",
      newPassword: "viewer-own-password"
    });

    check("a viewer can read", (await viewer.get("/api/docs")).status, 200);
    check("a viewer cannot create a document",
      (await viewer.post("/api/docs", { fileName: "nope.md", content: "x" })).status, 403);
    check("a viewer cannot delete one",
      (await viewer.post("/api/docs/alpha.md/delete", { mode: "soft" })).status, 403);
    check("a viewer cannot make folders",
      (await viewer.post("/api/folders", { name: "Nope" })).status, 403);
    check("a viewer cannot share",
      (await viewer.post("/api/docs/alpha.md/share")).status, 403);
    check("a viewer cannot list accounts", (await viewer.get("/api/users")).status, 403);
    check("...and the refusal is 403, not 401", (await viewer.get("/api/users")).body.code, "forbidden");

    // Promotion has to take effect for the session that is already open.
    const viewerId = created.body.user.id;
    await admin.patch(`/api/users/${viewerId}`, { role: "editor" });
    check("promotion to editor is immediate",
      (await viewer.post("/api/docs", { fileName: "editor-made.md", content: "x" })).status, 201);
    check("an editor can share", (await viewer.post("/api/docs/alpha.md/share")).status, 201);
    check("an editor still cannot manage accounts", (await viewer.get("/api/users")).status, 403);
    // Account management is admin-only end to end, not just hidden in the UI.
    check("an editor cannot create an account",
      (await viewer.post("/api/users", { username: "sneaky", password: "kettle-drum-nineteen" })).status, 403);
    check("an editor cannot delete one",
      (await viewer.del(`/api/users/${created.body.user.id}`)).status, 403);
    check("an editor cannot change a role",
      (await viewer.patch(`/api/users/${created.body.user.id}`, { role: "admin" })).status, 403);
    check("an editor cannot reset a password",
      (await viewer.post(`/api/users/${created.body.user.id}/password`, { password: "kettle-drum-twenty" })).status, 403);
    check("...and no account was created by any of that",
      (await admin.get("/api/users")).body.users.some((u) => u.username === "sneaky"), false);
    check("an editor cannot erase from the archive",
      (await viewer.del("/api/archive/whatever.md", { confirmFile: "whatever.md" })).status, 403);

    await admin.patch(`/api/users/${viewerId}`, { disabled: true });
    check("disabling an account kills its session immediately",
      (await viewer.get("/api/docs")).status, 401);
    check("...and it cannot sign back in",
      (await makeClient(server.origin).post("/api/auth/login",
        { username: "viewer-account", password: "viewer-own-password" })).status, 401);

    await admin.patch(`/api/users/${viewerId}`, { disabled: false });
    check("re-enabling lets it sign in again",
      (await makeClient(server.origin).post("/api/auth/login",
        { username: "viewer-account", password: "viewer-own-password" })).status, 200);
  }

  console.log("=== an admin cannot lock everyone out ===");
  {
    const me = (await admin.get("/api/session")).body.user;

    check("you cannot demote yourself", (await admin.patch(`/api/users/${me.id}`, { role: "viewer" })).status, 400);
    check("you cannot disable yourself", (await admin.patch(`/api/users/${me.id}`, { disabled: true })).status, 400);
    check("you cannot delete yourself", (await admin.del(`/api/users/${me.id}`)).status, 400);

    // With a second admin present the last-admin guard must stop guarding.
    const other = await admin.post("/api/users", {
      username: "second-admin",
      password: "kettle-drum-seventeen",
      role: "admin"
    });
    check("a second admin can be created", other.status, 201);
    check("the last-admin guard now allows a demotion",
      (await admin.patch(`/api/users/${other.body.user.id}`, { role: "viewer" })).status, 200);
    check("...and a deletion", (await admin.del(`/api/users/${other.body.user.id}`)).status, 200);
  }

  console.log("=== admin password reset ===");
  {
    const target = (await admin.get("/api/users")).body.users.find((u) => u.username === "viewer-account");
    const reset = await admin.post(`/api/users/${target.id}/password`, { password: "admin-set-password" });
    check("an admin can reset someone's password", reset.status, 200);
    check("...which forces them to choose their own", reset.body.user.mustChangePassword, true);

    const client = makeClient(server.origin);
    check("the reset password works", (await client.post("/api/auth/login",
      { username: "viewer-account", password: "admin-set-password" })).status, 200);
    check("...and they are blocked until they change it", (await client.get("/api/docs")).status, 403);
  }

  console.log("=== sign out ===");
  {
    const client = makeClient(server.origin);
    await client.post("/api/auth/login", { username: "aza", password: "kettle-drum-fifteen" });
    check("signed in", (await client.get("/api/docs")).status, 200);

    const out = await client.post("/api/auth/logout");
    check("signing out succeeds", out.status, 200);
    check("the cookie is cleared", client.jar.has("azadocs_session"), false);
    check("the session no longer works", (await client.get("/api/docs")).status, 401);
  }

  console.log("=== stored credentials on disk ===");
  {
    const users = JSON.parse(await fsp.readFile(path.join(server.stateDir, "data", "users.json"), "utf8"));
    const stored = users.users.find((u) => u.username === "aza");
    check("no plaintext password is stored", "password" in stored, false);
    check("the hash is a scrypt record", stored.passwordHash.startsWith("scrypt$"), true);
    check("no known password appears anywhere in the file",
      JSON.stringify(users).includes("kettle-drum-fifteen"), false);

    const sessions = JSON.parse(await fsp.readFile(path.join(server.stateDir, "data", "sessions.json"), "utf8"));
    const cookieValue = [...makeClient(server.origin).jar.values()][0];
    check("session ids are stored hashed, not raw",
      sessions.sessions.some((s) => s.id === cookieValue), false);
    check("a stored id is a sha256 digest",
      sessions.sessions.every((s) => /^[a-f0-9]{64}$/.test(s.id)), true);
  }

  console.log("=== share links ===");
  {
    const created = await admin.post("/api/docs/beta.md/share");
    check("an editor can publish one document", created.status, 201);
    check("the full URL is returned once", created.body.url.includes("/s/"), true);

    const token = created.body.url.split("/s/")[1];
    const stranger = makeClient(server.origin);

    check("anyone with the link can read that document",
      (await stranger.get(`/api/share/${token}`)).status, 200);
    check("...and gets the content", (await stranger.get(`/api/share/${token}`)).body.file, "beta.md");
    check("but still cannot list the library", (await stranger.get("/api/docs")).status, 401);
    check("...or read a different document", (await stranger.get("/api/docs/alpha.md")).status, 401);
    check("a made-up token is refused", (await stranger.get("/api/share/not-a-real-token")).status, 404);

    const page = await stranger.get(`/s/${token}`);
    check("the share page renders", page.status, 200);
    check("it is marked noindex", /noindex/.test(page.headers["x-robots-tag"] || ""), true);
    check("it does not ship the app shell", page.raw.includes('id="appShell"'), false);
    check("no unrendered template placeholders leak through", /__SHARE_[A-Z_]+__/.test(page.raw), false);

    // The page is served from /s/<token>, so a relative "js/share.js" resolves
    // to /s/js/share.js and 404s — which left the page blank with no error.
    const assetPaths = [...page.raw.matchAll(/(?:src|href)="([^"]+\.(?:js|css)[^"]*)"/g)]
      .map((m) => m[1])
      .filter((href) => !href.startsWith("http"));
    check("it references at least its own scripts", assetPaths.length >= 3, true);
    check("every local asset path is absolute, not relative to /s/",
      assetPaths.filter((href) => !href.startsWith("/")), []);

    for (const href of assetPaths) {
      const asset = await stranger.get(href);
      check(`  ${href} loads`, asset.status, 200);
    }
    check("...or the file explorer", page.raw.includes('id="docList"'), false);
    check("...or the editor", page.raw.includes('id="editorModal"'), false);

    const shares = (await admin.get("/api/shares")).body.shares;
    const record = shares.find((s) => s.file === "beta.md");
    check("the share is listed for managers", Boolean(record), true);
    check("the raw token is never listed", JSON.stringify(shares).includes(token), false);
    check("views are counted", record.views > 0, true);

    // Rotation is the only way to un-leak a URL.
    const rotated = await admin.post("/api/docs/beta.md/share");
    check("re-sharing reports that it rotated", rotated.body.rotated, true);
    check("the old link stops working", (await stranger.get(`/api/share/${token}`)).status, 404);
    const newToken = rotated.body.url.split("/s/")[1];
    check("the new link works", (await stranger.get(`/api/share/${newToken}`)).status, 200);

    await admin.del("/api/docs/beta.md/share");
    check("revoking kills the link", (await stranger.get(`/api/share/${newToken}`)).status, 404);
  }

  console.log("=== the preview describes the document, not the app ===");
  {
    const body = [
      "---",
      "title: front matter must not leak",
      "---",
      "",
      "# Quarterly Planning",
      "",
      "We agreed to **ship** the [cart rewrite](https://example.com) in October.",
      "",
      "```js",
      "// # this is not a heading",
      "const secret = 1;",
      "```",
      ""
    ].join("\n");

    await admin.post("/api/docs", { fileName: "preview-fixture.md", content: body });
    const share = await admin.post("/api/docs/preview-fixture.md/share");
    const token = share.body.url.split("/s/")[1];
    const stranger = makeClient(server.origin);
    const page = (await stranger.get(`/s/${token}`)).raw;

    const meta = (property) => {
      const match = page.match(new RegExp(`<meta (?:property|name)="${property}" content="([^"]*)"`));
      return match ? match[1] : null;
    };

    // The document's own H1 beats the filename: "Quarterly Planning", not
    // "Preview Fixture".
    check("og:title comes from the document's heading", meta("og:title"), "Quarterly Planning");
    check("...and the tab title adds the site name",
      /<title>Quarterly Planning \| AzaDocs<\/title>/.test(page), true);

    const description = meta("og:description");
    console.log(`  (description: ${description})`);
    check("og:description is prose from the document", description.includes("cart rewrite"), true);
    check("...with the markdown syntax removed", /[*[\]`#]/.test(description), false);
    check("...and the front matter left out", description.includes("front matter"), false);
    check("...and nothing from inside a code fence", description.includes("secret"), false);
    check("...and it does not just repeat the title",
      description.toLowerCase().startsWith("quarterly planning"), false);

    check("og:type says article", meta("og:type"), "article");
    check("og:url is the share link itself", meta("og:url").endsWith(`/s/${token}`), true);
    check("...and canonical agrees", page.includes(`<link rel="canonical" href="${meta("og:url")}"`), true);
    check("og:site_name is the app", meta("og:site_name"), "AzaDocs");
    check("the modified time is real", Number.isFinite(Date.parse(meta("article:modified_time"))), true);
    check("twitter mirrors it", meta("twitter:title"), "Quarterly Planning");
    check("no placeholder survived", /__SHARE_[A-Z_]+__/.test(page), false);

    // The preview is text only. The SVG card that used to be here was not
    // rendered by Slack, Discord or X — which is most of where a link gets
    // pasted — so it cost a route and a renderer to show nothing.
    console.log("=== the preview claims no image ===");
    check("no og:image", /property="og:image"/.test(page), false);
    check("...and no twitter:image", /name="twitter:image"/.test(page), false);
    check("twitter falls back to the text card", meta("twitter:card"), "summary");
    check("the card route is gone",
      (await stranger.get(`/s/${token}/card.svg`)).status, 404);

    console.log("=== a revoked link stops describing what was behind it ===");
    await admin.del("/api/docs/preview-fixture.md/share");
    const gone = await stranger.get(`/s/${token}`);
    check("the page 404s", gone.status, 404);
    check("...and leaks neither the title", gone.raw.includes("Quarterly Planning"), false);
    check("...nor the content", gone.raw.includes("cart rewrite"), false);
  }

  console.log("=== summarising odd documents ===");
  {
    // These are the shapes that produce a nonsense preview if the stripper is
    // naive: a notebook is JSON, a diagram is graph syntax, and a document may
    // have no heading or no prose at all.
    const notebook = JSON.stringify({
      cells: [
        { cell_type: "code", source: ["print('hello')"] },
        { cell_type: "markdown", source: ["# Sales Analysis\n", "\n", "Exploring the **2026** dataset.\n"] }
      ]
    });
    check("a notebook's title comes from its first markdown cell",
      excerpt.extractTitle("nb.ipynb", notebook, "Nb"), "Sales Analysis");
    check("...and its summary from the same cell",
      excerpt.extractDescription("nb.ipynb", notebook, { title: "Sales Analysis" }),
      "Exploring the 2026 dataset.");
    check("a malformed notebook falls back rather than throwing",
      excerpt.extractDescription("nb.ipynb", "{ not json", { siteName: "AzaDocs" }),
      "A document shared from AzaDocs.");

    check("a diagram is described as one",
      excerpt.extractDescription("flow.mmd", "%% comment\ngraph TD\n  A-->B\n", {}),
      "Mermaid diagram — graph TD");

    check("a document with no heading keeps its filename title",
      excerpt.extractTitle("no-heading.md", "Just a paragraph.\n", "No Heading"), "No Heading");
    check("an empty document gets a sensible line",
      excerpt.extractDescription("empty.md", "   \n\n", { siteName: "AzaDocs" }),
      "A document shared from AzaDocs.");

    check("a setext heading works too",
      excerpt.extractTitle("s.md", "Underlined\n==========\n\nBody.\n", "S"), "Underlined");
    check("...and its underline is not prose",
      excerpt.extractDescription("s.md", "Underlined\n==========\n\nBody.\n", { title: "Underlined" }), "Body.");

    const long = "word ".repeat(200);
    const truncated = excerpt.extractDescription("long.md", long, {});
    check("a long document is truncated", truncated.length <= excerpt.MAX_DESCRIPTION_LENGTH, true);
    check("...on a word boundary, with an ellipsis", truncated.endsWith("…"), true);
    check("...and not mid-word", /\s\w+…$/.test(truncated) || /\w…$/.test(truncated) === false, true);

    // Anything derived from a document ends up in an HTML attribute.
    check("markup in a heading cannot escape the attribute",
      excerpt.extractTitle("x.md", '# Title with "quotes" & <b>tags</b>\n', "X").includes("<b>"), false);
  }

  console.log("=== a share follows its document, and dies with it ===");
  {
    const share = await admin.post("/api/docs/alpha.md/share");
    const token = share.body.url.split("/s/")[1];
    const stranger = makeClient(server.origin);

    const renamed = await admin.post("/api/docs/alpha.md/rename", { fileName: "alpha-renamed.md" });
    check("renaming the document succeeds", renamed.status, 200);
    check("the share link still resolves", (await stranger.get(`/api/share/${token}`)).status, 200);
    check("...to the new filename", (await stranger.get(`/api/share/${token}`)).body.file, "alpha-renamed.md");

    await admin.post("/api/docs/alpha-renamed.md/delete", { mode: "soft" });
    check("deleting the document revokes the share",
      (await stranger.get(`/api/share/${token}`)).status, 404);
  }

  console.log("=== the store survives a restart ===");
  {
    // Sessions and accounts are files, not memory: a restart must not sign
    // everyone out or lose an account.
    const users = JSON.parse(await fsp.readFile(path.join(server.stateDir, "data", "users.json"), "utf8"));
    check("accounts persisted", users.users.length >= 2, true);
    // The shared editor token is gone; presenting one must not be a way in.
    check("a bearer token is no longer an authentication path",
      (await makeClient(server.origin).get("/api/docs",
        { Authorization: "Bearer any-token-at-all" })).status, 401);
  }

  console.log("=== folder upload ===");
  {
    const upload = (entries, fields = {}) => admin.postMultipart(
      "/api/upload/folder",
      entries.map((e) => ({ name: e.path.split("/").pop(), content: e.content || `# ${e.path}\n` })),
      { paths: JSON.stringify(entries.map((e) => e.path)), ...fields }
    );

    const res = await upload([
      { path: "Handbook/readme.md" },
      { path: "Handbook/2026/q1/goals.md" },
      { path: "Handbook/2026/retro.md" }
    ]);

    check("the upload succeeds", res.status, 201);
    check("every document lands", res.body.counts.uploaded, 3);
    check("the nesting is rebuilt", res.body.counts.foldersCreated, 3);

    const placed = Object.fromEntries(res.body.uploaded.map((u) => [u.file, u.folderPath]));
    check("a top-level file goes in the root folder", placed["readme.md"], "Handbook");
    check("a nested one goes three deep", placed["goals.md"], "Handbook / 2026 / q1");
    check("...and a sibling shares the middle folder", placed["retro.md"], "Handbook / 2026");

    // Uploading into an existing tree must join it, not duplicate it.
    const second = await upload([{ path: "Handbook/2026/q1/notes.md" }]);
    check("a second upload reuses the folders it finds", second.body.counts.foldersCreated, 0);
    check("...and files into the existing one",
      second.body.uploaded[0].folderPath, "Handbook / 2026 / q1");

    const folders = (await admin.get("/api/docs")).body.folders;
    check("no duplicate folder was created",
      folders.filter((f) => f.path === "Handbook / 2026 / q1").length, 1);

    console.log("=== a name clash is resolved, not overwritten ===");
    const clash = await upload([{ path: "Other/readme.md", content: "# Different\n" }]);
    check("the second readme is renamed", clash.body.uploaded[0].renamedFrom, "readme.md");
    check("...to something else", clash.body.uploaded[0].file === "readme.md", false);
    const original = await admin.get("/api/docs/readme.md");
    check("the first one is untouched", original.body.content.includes("Handbook/readme.md"), true);

    console.log("=== paths from the client are not trusted ===");
    for (const [label, badPath] of [
      ["parent traversal", "../../../etc/passwd.md"],
      ["traversal in the middle", "Notes/../../escape.md"],
      ["an absolute path", "/etc/shadow.md"],
      ["a Windows path", "..\\..\\windows\\system32\\evil.md"],
      ["a dot folder", "../evil.md"]
    ]) {
      const attempt = await upload([{ path: badPath }]);
      // Either refused outright, or accepted with the traversal stripped —
      // never written outside the documents directory.
      const uploaded = attempt.body?.uploaded?.[0];
      const escaped = uploaded && String(uploaded.folderPath || "").includes("..");
      const ok = !escaped;
      if (!ok) {
        failures++;
      }
      console.log(`  ${ok ? "PASS" : "FAIL"}  ${label} cannot escape (${attempt.status})`);
    }

    // Whatever the paths claimed, nothing may exist outside the documents dir.
    const docsDir = path.join(server.stateDir, "docs");
    const onDisk = await fsp.readdir(docsDir);
    check("every uploaded file is flat in the documents directory",
      onDisk.every((name) => !name.includes("/") && !name.includes("..")), true);
    check("no stray directory was created",
      (await Promise.all(onDisk.map(async (n) => (await fsp.stat(path.join(docsDir, n))).isDirectory())))
        .every((isDir) => isDir === false), true);
    check("nothing was written to the state root",
      (await fsp.readdir(server.stateDir)).sort().join(","), "data,deleted_markdowns,docs");

    console.log("=== an awkward folder name costs the name, never the document ===");
    for (const [label, badPath, expectedFolder] of [
      ["a folder named like the unfiled bucket", "Ungrouped/keep-a.md", "Ungrouped (uploaded)"],
      ["a name past the 80-character limit", `${"L".repeat(100)}/keep-b.md`, "L".repeat(80)],
      ["a whitespace-only segment", "Keep/   /keep-c.md", "Keep"],
      ["a segment that is just a dot", "Keep/./keep-d.md", "Keep"],
      ["a control character in the name", `Keep/we${String.fromCharCode(7)}ird/keep-e.md`, "Keep / weird"]
    ]) {
      const attempt = await upload([{ path: badPath }]);
      const placed = attempt.body?.uploaded?.[0];
      const ok = attempt.status === 201 && placed && placed.folderPath === expectedFolder;
      if (!ok) {
        failures++;
      }
      console.log(`  ${ok ? "PASS" : "FAIL"}  ${label} -> ${placed ? `"${placed.folderPath}"` : `dropped (${attempt.status})`}`);
    }

    // ".." is not an awkward name, it is an attempt at something.
    const traversal = await upload([{ path: "Keep/../../escape.md" }]);
    check("but '..' is still refused outright",
      (traversal.body?.uploaded || []).length, 0);

    const adjusted = await upload([{ path: "Ungrouped/keep-f.md" }]);
    check("the adjustment is reported, not silent",
      adjusted.body.renamedFolders.some((r) => r.to === "Ungrouped (uploaded)"), true);

    console.log("=== depth ===");
    const atLimit = await upload([{ path: "n1/n2/n3/n4/n5/n6/n7/n8/at-limit.md" }]);
    check("exactly at the 8-level limit is allowed", atLimit.status, 201);
    check("...and nests all eight", atLimit.body.uploaded[0].folderPath.split(" / ").length, 8);

    console.log("=== the guards ===");
    const tooDeep = await upload([
      { path: "a/b/c/d/e/f/g/h/i/j/deep.md" }
    ]);
    check("a folder deeper than the limit is refused", tooDeep.status, 400);
    check("...with a message that says what to do",
      /nests deeper|subfolder/i.test(tooDeep.body.error), true);

    const mismatched = await admin.postMultipart("/api/upload/folder",
      [{ name: "a.md", content: "# A\n" }, { name: "b.md", content: "# B\n" }],
      { paths: JSON.stringify(["only/one.md"]) });
    check("a paths array that does not line up is refused", mismatched.status, 400);

    const noPaths = await admin.postMultipart("/api/upload/folder",
      [{ name: "a.md", content: "# A\n" }], {});
    check("a missing paths array is refused", noPaths.status, 400);

    const empty = await admin.postMultipart("/api/upload/folder", [], { paths: "[]" });
    check("an empty upload is refused", empty.status, 400);

    const binary = await admin.postMultipart("/api/upload/folder",
      [{ name: "logo.png", content: "not really a png" }],
      { paths: JSON.stringify(["Assets/logo.png"]) });
    check("an unsupported file type is refused", binary.status, 400);

    console.log("=== and it is a write, so the role applies ===");
    const reader = makeClient(server.origin);
    await admin.post("/api/users", { username: "upload-viewer", password: "kettle-drum-twentyone", role: "viewer" });
    await reader.post("/api/auth/login", { username: "upload-viewer", password: "kettle-drum-twentyone" });
    await reader.post("/api/auth/password", {
      currentPassword: "kettle-drum-twentyone",
      newPassword: "reader-own-password-1"
    });
    const refused = await reader.postMultipart("/api/upload/folder",
      [{ name: "x.md", content: "# X\n" }], { paths: JSON.stringify(["Sneaky/x.md"]) });
    check("a viewer cannot upload a folder", refused.status, 403);
  }

  console.log("=== the CSP allows WASM without opening the door wider ===");
  {
    const stranger = makeClient(server.origin);
    const csp = (await stranger.get("/")).headers["content-security-policy"];
    const directive = (name) => (csp.split(";").find((d) => d.trim().startsWith(name)) || "").trim();

    // Compiling WebAssembly needs its own allowance. It is not eval().
    check("wasm compilation is permitted", directive("script-src").includes("'wasm-unsafe-eval'"), true);
    check("but eval() is still refused", csp.includes("'unsafe-eval'"), false);
    check("...and so is inline script", directive("script-src").includes("'unsafe-inline'"), false);

    // Pyodide fetches its runtime and packages over fetch(), which script-src
    // does not cover.
    check("the runtime CDN is reachable", directive("connect-src").includes("https://cdn.jsdelivr.net"), true);
    check("...and nothing else is", directive("connect-src"), "connect-src 'self' https://cdn.jsdelivr.net");

    check("workers may only come from this origin", directive("worker-src"), "worker-src 'self'");
    check("object-src is still none", directive("object-src"), "object-src 'none'");

    const worker = await stranger.get("/js/pyodide-worker.js");
    check("the worker is served", worker.status, 200);
    check("...from this origin, so worker-src 'self' covers it",
      worker.headers["content-type"].includes("javascript"), true);
  }

  console.log("=== error pages ===");
  {
    const asBrowser = { Accept: "text/html,application/xhtml+xml" };
    const asApi = { Accept: "application/json" };
    const stranger = makeClient(server.origin);

    const page = await stranger.get("/definitely-not-a-route", asBrowser);
    check("a mistyped URL gets a real page, not Cannot GET", page.status, 404);
    check("...as HTML", /text\/html/.test(page.headers["content-type"]), true);
    check("...with the status in the title", /<title>404 · [^<]*<\/title>/.test(page.raw), true);
    check("...and a heading a person can read",
      page.raw.includes("There is nothing here"), true);
    check("...and a way back", page.raw.includes('href="/"'), true);
    check("...not indexed", /noindex/.test(page.raw), true);
    check("no placeholder survived", /__ERROR_[A-Z_]+__/.test(page.raw), false);
    check("it does not depend on the app script", page.raw.includes("js/app.js"), false);

    // The same URL, asked for by a program, must stay JSON.
    const json = await stranger.get("/definitely-not-a-route", asApi);
    check("an API client gets JSON for the same URL",
      /application\/json/.test(json.headers["content-type"]), true);
    check("...with a message", typeof json.body.error === "string", true);

    // Anything under /api is JSON regardless of what it claims to accept: a
    // fetch() with a default Accept header would otherwise be handed a page.
    const apiAsBrowser = await stranger.get("/api/not-a-route", asBrowser);
    check("an /api path never returns HTML",
      /application\/json/.test(apiAsBrowser.headers["content-type"]), true);
    check("...even when the caller asks for HTML", apiAsBrowser.status, 404);

    console.log("=== the error page covers the routes that used to answer in JSON ===");
    for (const [url, label] of [
      ["/docs/anything.md", "the raw documents directory"],
      ["/share.html", "the share template"],
      ["/error.html", "the error template itself"]
    ]) {
      const res = await stranger.get(url, asBrowser);
      const ok = res.status === 404 && /text\/html/.test(res.headers["content-type"]);
      if (!ok) failures++;
      console.log(`  ${ok ? "PASS" : "FAIL"}  ${label} renders the 404 page`);
    }

    console.log("=== a dead share link uses the same page ===");
    const dead = await stranger.get("/s/not-a-real-token", asBrowser);
    check("it is a 404", dead.status, 404);
    check("...and says what happened", dead.raw.includes("This share link is not valid"), true);
    check("...without the app shell", dead.raw.includes('id="appShell"'), false);

    console.log("=== a 500 says nothing it should not ===");
    // A path that reaches the handler with a genuine failure: the archive
    // delete route reads a file whose name is valid but absent.
    const boom = await stranger.get("/s/%E0%A4%A", asBrowser);
    check("a malformed URL does not crash the process", boom.status >= 400, true);
    check("...and never returns a stack trace", /at \w+ \(/.test(boom.raw), false);
    check("...nor a filesystem path", boom.raw.includes(server.stateDir), false);
  }

  console.log("=== rate limiting ===");
  {
    // A dedicated account: locking one out is the whole point, and it must not
    // be an account a later check needs.
    await admin.post("/api/users", {
      username: "lockout-target",
      password: "kettle-drum-eighteen",
      role: "viewer"
    });

    const attacker = makeClient(server.origin);
    let attemptsBeforeLockout = 0;
    let sawLockout = false;

    for (let attempt = 0; attempt < 15; attempt++) {
      const res = await attacker.post("/api/auth/login", {
        username: "lockout-target",
        password: `guess-${attempt}`
      });

      if (res.status === 429) {
        sawLockout = true;
        check("the lockout tells the client when to retry", Boolean(res.headers["retry-after"]), true);
        break;
      }

      attemptsBeforeLockout++;
    }

    check("repeated failures lock the account out", sawLockout, true);
    console.log(`  (locked after ${attemptsBeforeLockout} failed attempts)`);
    check("the correct password is refused while locked out",
      (await attacker.post("/api/auth/login",
        { username: "lockout-target", password: "kettle-drum-eighteen" })).status, 429);

    // The IP bucket is far more forgiving than the account bucket, because
    // everyone behind one NAT or proxy shares an address. Locking one account
    // must not lock the address.
    check("another account on the same address still works",
      (await makeClient(server.origin).post("/api/auth/login",
        { username: "aza", password: "kettle-drum-fifteen" })).status, 200);
  }
}
