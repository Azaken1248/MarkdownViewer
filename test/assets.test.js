// Pasted images: what may be uploaded, who may upload it, and who may read it
// back.
//
// The interesting behaviour here is all refusals and scoping. An attachment
// endpoint is a way to put arbitrary bytes on somebody else's server and then
// hand out URLs to them, so this suite is mostly about the ways that is not
// allowed to happen: only images, only up to a size, only for accounts that may
// write, and readable only under the same rule as the document that embeds
// them.
//
// The share-scoped route is the one worth reading twice. A share token is a
// capability for one document, so it must serve that document's pictures and
// nothing else in the store.

const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { makeClient } = require("./helpers/client");
const { startTestServer, SEED_USERNAME, SEED_PASSWORD, TEST_PASSWORD } = require("./helpers/server");

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

// A real PNG, small enough to write out by hand: an 8-byte signature and an
// IHDR. Nothing parses it, but "actual image bytes" beats "the word png".
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0, 0, 0, 13]),
  Buffer.from("IHDR"),
  Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
  Buffer.from([0x1f, 0x15, 0xc4, 0x89])
]);
const OTHER_PNG = Buffer.concat([PNG, Buffer.from("different")]);

const image = (content, name = "shot.png", type = "image/png") => ({
  field: "image", name, type, content
});

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

(async () => {
  const server = await startTestServer();

  try {
    const admin = makeClient(server.origin);
    await admin.post("/api/auth/login", { username: SEED_USERNAME, password: SEED_PASSWORD });
    await admin.post("/api/auth/password", { currentPassword: SEED_PASSWORD, newPassword: TEST_PASSWORD });

    let uploaded = null;

    console.log("=== an image can be attached and read back ===");
    {
      const res = await admin.postMultipart("/api/assets", [image(PNG)]);
      uploaded = res.body;

      check("the upload is accepted", res.status, 201);
      check("...and answers with a URL to use in the markdown",
        uploaded.url, `/api/assets/${uploaded.name}`);
      check("...named after the bytes, not after the file it came from",
        uploaded.name, `${sha256(PNG)}.png`);
      check("...with the extension the type implies", uploaded.name.endsWith(".png"), true);
      check("...and nothing of the original name is in it",
        uploaded.name.includes("shot"), false);

      const fetched = await admin.getBytes(uploaded.url);
      check("the image comes back", fetched.status, 200);
      check("...byte for byte", fetched.body.equals(PNG), true);
      check("...as an image", fetched.headers["content-type"], "image/png");
      // The name is the hash of the content, so the bytes behind a URL can
      // never change and the answer can be cached for good.
      check("...cacheable forever, because the name is the content",
        fetched.headers["cache-control"], "public, max-age=31536000, immutable");
    }

    console.log("=== the same picture twice is stored once ===");
    {
      const again = await admin.postMultipart("/api/assets", [image(PNG, "screenshot-2.png")]);
      check("pasting it again is accepted", again.status, 201);
      check("...and lands on the same name", again.body.name, uploaded.name);

      const different = await admin.postMultipart("/api/assets", [image(OTHER_PNG)]);
      check("a different picture gets a different name",
        different.body.name === uploaded.name, false);

      const stored = fs.readdirSync(path.join(server.stateDir, "assets"));
      check("...and only two files exist on disk", stored.length, 2);
      check("the assets live outside the documents",
        fs.existsSync(path.join(server.stateDir, "docs", "assets")), false);
    }

    console.log("=== only images, and only so large ===");
    {
      const script = await admin.postMultipart("/api/assets",
        [image(Buffer.from("<script>alert(1)</script>"), "x.js", "text/javascript")]);
      check("a script is not an image", script.status, 400);

      // SVG is a document that can carry script. Serving one from this origin
      // would let an author run code in a reader's session.
      const svg = await admin.postMultipart("/api/assets",
        [image(Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"/>"), "x.svg", "image/svg+xml")]);
      check("an SVG is refused, whatever it claims to be", svg.status, 400);

      const markdown = await admin.postMultipart("/api/assets",
        [image(Buffer.from("# hello"), "notes.md", "text/markdown")]);
      check("a document is not an image either", markdown.status, 400);

      const huge = await admin.postMultipart("/api/assets",
        [image(Buffer.alloc(11 * 1024 * 1024, 1), "big.png")]);
      check("an image over the limit is refused", huge.status, 413);
      check("...and says what the limit is",
        /10MB/.test(huge.raw || ""), true);
    }

    console.log("=== a name that is not one of ours is not a path ===");
    {
      const traversals = [
        "/api/assets/..%2f..%2fserver.js",
        "/api/assets/....//server.js",
        "/api/assets/notes.md",
        `/api/assets/${sha256(PNG)}.svg`,
        `/api/assets/${sha256(PNG).slice(0, 20)}.png`
      ];

      for (const url of traversals) {
        const res = await admin.get(url);
        check(`${url} is refused`, res.status === 404 || res.status === 400, true);
      }
    }

    console.log("=== attaching is a write, reading is a read ===");
    {
      const stranger = makeClient(server.origin);
      check("signed out, nothing can be attached",
        (await stranger.postMultipart("/api/assets", [image(PNG)])).status, 401);
      check("...and nothing can be read", (await stranger.get(uploaded.url)).status, 401);

      const created = await admin.post("/api/users", {
        username: "scout", password: "kettle-drum-fourteen", role: "viewer"
      });
      check("a viewer account is created", created.status, 201);

      const viewer = makeClient(server.origin);
      await viewer.post("/api/auth/login", { username: "scout", password: "kettle-drum-fourteen" });
      await viewer.post("/api/auth/password", {
        currentPassword: "kettle-drum-fourteen", newPassword: "trumpet-lantern-nine"
      });

      check("a viewer can see the pictures in what they read",
        (await viewer.get(uploaded.url)).status, 200);
      check("...but cannot attach one",
        (await viewer.postMultipart("/api/assets", [image(PNG)])).status, 403);

      const noToken = makeClient(server.origin);
      await noToken.post("/api/auth/login", { username: SEED_USERNAME, password: TEST_PASSWORD });
      noToken.csrf = "";
      check("attaching without the CSRF token is refused",
        (await noToken.postMultipart("/api/assets", [image(PNG)])).status, 403);
    }

    console.log("=== a shared document shows its pictures, and only its own ===");
    {
      const withImage = await admin.post("/api/docs", {
        fileName: "illustrated.md",
        content: `# Illustrated\n\n![a shot](${uploaded.url})\n`
      });
      check("a document embedding the image is created", withImage.status, 201);

      const plain = await admin.post("/api/docs", {
        fileName: "plain.md", content: "# Plain\n\nNo pictures here.\n"
      });
      check("...and one without it", plain.status, 201);

      // The full token is only ever handed back once, inside the link itself.
      const tokenFrom = (res) => String(res.body?.url || "").split("/s/")[1] || "";

      const share = await admin.post("/api/docs/illustrated.md/share");
      check("it can be shared", share.status, 201);
      const token = tokenFrom(share);
      check("...and the link has a token", token.length > 0, true);

      // Whoever opens a share link has no session at all.
      const guest = makeClient(server.origin);
      check("a guest cannot read the image directly",
        (await guest.get(uploaded.url)).status, 401);

      const viaShare = await guest.getBytes(`/api/share/${token}/assets/${uploaded.name}`);
      check("but can read it through the share link", viaShare.status, 200);
      check("...and gets the actual picture", viaShare.body.equals(PNG), true);

      // The token is a capability for one document, not for the whole store.
      const otherToken = tokenFrom(await admin.post("/api/docs/plain.md/share"));
      check("the other document is shared too", otherToken.length > 0, true);
      const leak = await guest.get(`/api/share/${otherToken}/assets/${uploaded.name}`);
      check("a link to another document will not serve this image", leak.status, 404);

      const nonsense = await guest.get(`/api/share/not-a-token/assets/${uploaded.name}`);
      check("nor will a token that is not a share", nonsense.status, 404);
    }
  } finally {
    await server.stop();
  }

  console.log(failures === 0 ? "\nALL ASSET CHECKS PASSED" : `\n${failures} ASSET CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
