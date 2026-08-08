// Saved links: what may be fetched, what the page said, and who may add one.
//
// The bulk of this suite is about refusals. Adding a link is the only place the
// server makes an outbound request to an address someone else chose, so the
// interesting behaviour is everything it declines to fetch — private networks,
// cloud metadata, non-web schemes and ports, and redirects into any of those.
//
// Nothing here touches the internet. The address checks need no network by
// construction; the redirect and parsing rules are exercised through the
// request seam in fetchPage; and the API tests use addresses the server refuses
// before it opens a socket. That keeps the suite deterministic on a CI runner
// with no egress, which is the only way these checks are worth having.

const fs = require("fs");
const os = require("os");
const path = require("path");
const preview = require("../lib/link-preview");
const { LinkStore, canonicalKey, normalizeGroups, MAX_GROUPS_PER_LINK, MAX_GROUP_LENGTH } = require("../lib/links");
const { makeClient } = require("./helpers/client");
const { startTestServer, SEED_USERNAME, SEED_PASSWORD, TEST_PASSWORD } = require("./helpers/server");

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

function refuses(label, url) {
  let message = null;
  try {
    preview.parseTarget(url);
  } catch (error) {
    message = error.message;
  }
  check(label, message !== null, true);
}

(async () => {
  console.log("=== the private network is not reachable ===");
  {
    // Each of these is somewhere the server can reach and the person typing the
    // URL cannot. 169.254.169.254 is the one that matters most: on a cloud host
    // it hands out instance credentials to anything that asks.
    const blocked = {
      "loopback": "127.0.0.1",
      "loopback, the whole /8": "127.9.9.9",
      "private 10/8": "10.0.0.5",
      "private 172.16/12": "172.16.0.1",
      "...to the end of the range": "172.31.255.255",
      "private 192.168/16": "192.168.1.1",
      "link-local, and cloud metadata": "169.254.169.254",
      "\"this network\"": "0.0.0.0",
      "carrier-grade NAT": "100.64.0.1",
      "multicast": "224.0.0.1",
      "broadcast": "255.255.255.255",
      "IPv6 loopback": "::1",
      "IPv6 unspecified": "::",
      "IPv6 link-local": "fe80::1",
      "IPv6 unique-local": "fd12:3456::1",
      "IPv6 multicast": "ff02::1",
      "loopback as a mapped v4 address": "::ffff:127.0.0.1",
      "...and in its hex form": "::ffff:7f00:1",
      "6to4, which reaches v4": "2002:7f00:1::",
      "NAT64, which also reaches v4": "64:ff9b::7f00:1"
    };

    for (const [label, address] of Object.entries(blocked)) {
      check(`${label} (${address})`, preview.isBlockedAddress(address), true);
    }

    // Over-blocking would be its own bug: 172.32.0.0 is a perfectly ordinary
    // public address one octet past the private range.
    const allowed = ["8.8.8.8", "1.1.1.1", "172.32.0.1", "172.15.0.1", "2606:4700::1111"];
    for (const address of allowed) {
      check(`a public address is allowed (${address})`, preview.isBlockedAddress(address), false);
    }

    check("something that is not an address at all is refused",
      preview.isBlockedAddress("not-an-address"), true);
  }

  console.log("=== only ordinary web addresses are accepted ===");
  {
    refuses("file: cannot be read", "file:///etc/passwd");
    refuses("...nor ftp:", "ftp://example.com/x");
    refuses("...nor javascript:", "javascript:alert(1)");
    refuses("...nor data:", "data:text/html,<b>x</b>");
    refuses("...nor gopher:, which can speak to other protocols", "gopher://example.com/");
    refuses("credentials in the URL are refused", "http://user:secret@example.com/");
    refuses("a non-web port is refused", "http://example.com:6379/");
    refuses("...including SSH", "http://example.com:22/");
    refuses("a literal private address is refused", "http://127.0.0.1/");
    refuses("...in brackets too", "http://[::1]/");
    refuses("...and the metadata endpoint by name", "http://169.254.169.254/latest/meta-data/");

    check("a bare hostname is assumed to be https",
      preview.parseTarget("example.com").href, "https://example.com/");
    check("an explicit https URL is kept",
      preview.parseTarget("https://pyodide.org/en/stable/").href, "https://pyodide.org/en/stable/");
    check("an explicit web port is fine",
      preview.parseTarget("http://example.com:80/x").href, "http://example.com/x");
    check("an empty URL is refused", (() => {
      try { preview.parseTarget("  "); return null; } catch (error) { return error.message; }
    })(), "Enter a URL.");
  }

  console.log("=== a redirect cannot be used to get somewhere refused ===");
  {
    // Every HTTP client follows redirects by default, so a public URL that 302s
    // to http://127.0.0.1/ is the same attack with one extra step. Each hop goes
    // back through the same gate as the address that was typed.
    const chainTo = (targets) => {
      let hop = 0;
      return async () => (hop < targets.length ? { redirectTo: targets[hop++] } : { body: "<title>Reached</title>" });
    };

    const reached = async (targets) => {
      try {
        const result = await preview.fetchPage(new URL("http://start.example/"), chainTo(targets));
        return result.url.href;
      } catch (error) {
        return `refused: ${error.message}`;
      }
    };

    check("a redirect to loopback is refused",
      (await reached(["http://127.0.0.1/admin"])).startsWith("refused:"), true);
    check("...even at the end of a long chain",
      (await reached(["https://a.example/", "https://b.example/", "http://169.254.169.254/"])).startsWith("refused:"), true);
    check("a redirect to a non-web port is refused",
      (await reached(["http://a.example:22/"])).startsWith("refused:"), true);
    check("a redirect to file: is refused",
      (await reached(["file:///etc/passwd"])).startsWith("refused:"), true);

    check("a chain that stays public is followed",
      await reached(["https://a.example/1", "https://b.example/2"]), "https://b.example/2");

    let hops = 0;
    const loop = async () => { hops++; return { redirectTo: "https://a.example/loop" }; };
    let looped = null;
    try {
      await preview.fetchPage(new URL("https://a.example/"), loop);
    } catch (error) {
      looped = error.message;
    }
    check("a redirect loop stops", looped !== null, true);
    check("...after a bounded number of hops", hops <= preview.MAX_REDIRECTS + 1, true);
  }

  console.log("=== what the page says about itself ===");
  {
    const page = `<!doctype html><html><head>
      <title>Fallback title</title>
      <meta name="description" content="Fallback description" />
      <meta property="og:title" content="Pyodide &amp; friends" />
      <meta property="og:description" content="Python  in\nthe browser" />
      <meta property="og:site_name" content="Pyodide" />
      </head><body>ignored</body></html>`;

    const meta = preview.extractMetadata(page, new URL("https://pyodide.org/"));
    check("og:title wins", meta.title, "Pyodide & friends");
    check("...with entities decoded", meta.title.includes("&amp;"), false);
    check("og:description wins", meta.description, "Python in the browser");
    check("...with whitespace collapsed", /\s{2}|\n/.test(meta.description), false);
    check("og:site_name is kept", meta.siteName, "Pyodide");

    // `<meta content="..." property="og:title">` is as valid as the other order,
    // and plenty of sites emit it.
    const reversed = preview.extractMetadata(
      '<meta content="Backwards" property="og:title">', new URL("https://x.example/"));
    check("attribute order does not matter", reversed.title, "Backwards");

    const twitter = preview.extractMetadata(
      '<title>T</title><meta name="twitter:description" content="From twitter">', new URL("https://x.example/"));
    check("twitter: is the next fallback", twitter.description, "From twitter");

    const plain = preview.extractMetadata(page.replace(/<meta property="og:[^>]*>/g, ""), new URL("https://x.example/"));
    check("then the ordinary title", plain.title, "Fallback title");
    check("...and the ordinary description", plain.description, "Fallback description");

    const bare = preview.extractMetadata("<html><body>nothing</body></html>", new URL("https://bare.example/x"));
    check("a page with no metadata still gets a usable title", bare.title, "bare.example");
    check("...and an empty description rather than a made-up one", bare.description, "");

    const huge = preview.extractMetadata(
      `<meta property="og:description" content="${"x".repeat(5000)}">`, new URL("https://x.example/"));
    check("a runaway description is truncated", huge.description.length <= 600, true);
  }

  console.log("=== the store ===");
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "azadocs-links-"));
    const store = new LinkStore({ dataDir: dir });
    await store.load();
    check("an empty store loads", store.list(), []);

    const link = await store.create({
      url: "https://expressjs.com/",
      title: "Express",
      description: "Fast, unopinionated",
      siteName: "Express.js",
      fetched: true,
      fetchedAt: new Date().toISOString()
    }, { createdBy: "aza", note: "the server framework" });

    check("a link is saved", link.title, "Express");
    check("...with its note", link.note, "the server framework");
    check("...and who saved it", link.createdBy, "aza");
    check("...and it is on disk", JSON.parse(fs.readFileSync(path.join(dir, "links.json"), "utf8")).links.length, 1);

    // Two URLs that differ by a trailing slash are the same page.
    check("the same URL is not saved twice", await (async () => {
      try {
        await store.create({ url: "https://expressjs.com", title: "Express again" });
        return "saved a duplicate";
      } catch (error) {
        return error.status;
      }
    })(), 409);
    check("...and case in the host does not defeat that",
      canonicalKey("https://ExpressJS.com/"), canonicalKey("https://expressjs.com"));

    await store.update(link.id, { title: "Express 5" });
    check("a card can be edited by hand", store.find(link.id).title, "Express 5");

    console.log("=== groups ===");
    // A comma-separated string is what the dialog sends; an array is what the
    // API takes. Both have to work, because both are used.
    check("a comma-separated string becomes a list",
      normalizeGroups(" osu ,  APIs ,, "), ["osu", "APIs"]);
    check("an array is accepted too", normalizeGroups(["osu", "APIs"]), ["osu", "APIs"]);
    check("whitespace inside a name is collapsed",
      normalizeGroups("web   frameworks"), ["web frameworks"]);
    check("the same name twice is one group", normalizeGroups("osu, osu"), ["osu"]);
    // Otherwise "osu" and "OSU" sit next to each other as separate chips, which
    // is never what anyone meant.
    check("case does not start a second group", normalizeGroups("osu, OSU, Osu"), ["osu"]);
    check("...and the spelling first used is kept", normalizeGroups("OSU, osu"), ["OSU"]);
    check("empty entries are dropped", normalizeGroups(", ,  ,"), []);
    check("nothing at all is an empty list", normalizeGroups(undefined), []);
    check("a name is capped", normalizeGroups("x".repeat(200))[0].length, MAX_GROUP_LENGTH);
    check("the number of groups is capped",
      normalizeGroups(Array.from({ length: 40 }, (_, i) => `g${i}`)).length, MAX_GROUPS_PER_LINK);

    await store.update(link.id, { groups: "osu, APIs" });
    check("a link can be filed", store.find(link.id).groups, ["osu", "APIs"]);

    // The bug this guards: refreshing sends new metadata and no groups, and a
    // card must not come home unfiled because its page was re-read.
    await store.update(link.id, { title: "Express 5", fetched: true, fetchedAt: new Date().toISOString() });
    check("re-reading a page leaves the filing alone", store.find(link.id).groups, ["osu", "APIs"]);

    await store.update(link.id, { groups: [] });
    check("...but it can be emptied deliberately", store.find(link.id).groups, []);

    await store.update(link.id, { groups: ["osu"] });
    const second = await store.create({ url: "https://osu.ppy.sh/", title: "osu!" }, { groups: ["osu", "games"] });
    check("groups are counted across links",
      store.groups(), [{ name: "games", count: 1 }, { name: "osu", count: 2 }]);
    check("...in alphabetical order regardless of case",
      store.groups().map((g) => g.name), ["games", "osu"]);

    await store.remove(second.id);
    check("a group disappears when its last link does",
      store.groups().map((g) => g.name), ["osu"]);

    check("a link is removed", await store.remove(link.id), true);
    check("...and removing it twice is not an error", await store.remove(link.id), false);
    check("...and the file reflects it",
      JSON.parse(fs.readFileSync(path.join(dir, "links.json"), "utf8")).links, []);

    // A second store over the same directory sees what the first wrote.
    const reopened = new LinkStore({ dataDir: dir });
    await reopened.load();
    check("state survives a reload", reopened.list(), []);

    fs.rmSync(dir, { recursive: true, force: true });
  }

  const server = await startTestServer();
  console.log(`  (test server on ${server.origin})`);

  try {
    await api(server);
  } finally {
    await server.stop();
  }

  console.log(failures === 0 ? "\nALL LINK CHECKS PASSED" : `\n${failures} LINK CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function api(server) {
  const admin = makeClient(server.origin);
  await admin.post("/api/auth/login", { username: SEED_USERNAME, password: SEED_PASSWORD });
  await admin.post("/api/auth/password", { currentPassword: SEED_PASSWORD, newPassword: TEST_PASSWORD });

  console.log("=== the section is behind the session like everything else ===");
  {
    const stranger = makeClient(server.origin);
    check("signed out, the list is refused", (await stranger.get("/api/links")).status, 401);
    check("...and so is adding one",
      (await stranger.post("/api/links", { url: "https://example.com/" })).status, 401);

    check("signed in, the list is empty to start", (await admin.get("/api/links")).body.links, []);
  }

  console.log("=== the server refuses to fetch what it should not ===");
  {
    // The shapes that matter: the cloud metadata endpoint, the app's own
    // loopback interface, the private LAN, a link-local router, the disk, and a
    // database port. Every one is refused before a socket is opened, which is
    // why this needs no network.
    const cases = [
      ["cloud metadata", "http://169.254.169.254/latest/meta-data/iam/security-credentials/"],
      ["the app's own loopback", "http://127.0.0.1/api/docs"],
      ["a LAN address", "http://192.168.1.1/"],
      ["a router by IPv6 link-local", "http://[fe80::1]/"],
      ["the local disk", "file:///etc/passwd"],
      ["a database port", "http://example.com:6379/"]
    ];

    for (const [label, url] of cases) {
      const res = await admin.post("/api/links", { url });
      check(`${label} is refused`, res.status, 400);
      check("...with a reason", typeof res.body?.error === "string" && res.body.error.length > 0, true);
    }

    check("and nothing was saved", (await admin.get("/api/links")).body.links, []);
  }

  console.log("=== a write still needs the CSRF token ===");
  {
    const noToken = makeClient(server.origin);
    await noToken.post("/api/auth/login", { username: SEED_USERNAME, password: TEST_PASSWORD });
    noToken.csrf = "";
    check("adding without the token is refused",
      (await noToken.post("/api/links", { url: "https://example.com/" })).status, 403);
  }

  console.log("=== a viewer may read the links and change nothing ===");
  {
    const created = await admin.post("/api/users", {
      username: "scout", password: "kettle-drum-fourteen", role: "viewer"
    });
    check("a viewer account is created", created.status, 201);

    const viewer = makeClient(server.origin);
    await viewer.post("/api/auth/login", { username: "scout", password: "kettle-drum-fourteen" });
    // A newly created account is made to choose its own password first.
    await viewer.post("/api/auth/password", {
      currentPassword: "kettle-drum-fourteen", newPassword: "trumpet-lantern-nine"
    });

    check("a viewer can read the list", (await viewer.get("/api/links")).status, 200);
    check("...but cannot add one",
      (await viewer.post("/api/links", { url: "https://example.com/" })).status, 403);
    check("...nor edit one",
      (await viewer.patch("/api/links/anything", { title: "x" })).status, 403);
    check("...nor remove one",
      (await viewer.del("/api/links/anything")).status, 403);
  }

  console.log("=== editing and removing ===");
  {
    check("editing a link that does not exist is a 404",
      (await admin.patch("/api/links/nope", { title: "x" })).status, 404);
    check("...and so is removing one",
      (await admin.del("/api/links/nope")).status, 404);
  }

  console.log("=== the list carries the groups in use ===");
  {
    const list = await admin.get("/api/links");
    check("the response has a groups list", Array.isArray(list.body.groups), true);
    check("...empty while nothing is filed", list.body.groups, []);
  }
}
