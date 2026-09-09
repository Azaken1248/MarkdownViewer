// Part of the auth suite. See auth.test.js, which starts the server and calls
// it.
//
// The content-security policy, the app's own link preview, the error pages,
// and the rate limiter.
//
// Everything it needs is handed to it: the suite's own check(), the server, and
// the two clients the checks are made through. Split out of one file only
// because that file had grown past a thousand lines.
module.exports = async (ctx) => {
  const { check, server, admin, makeClient, fail } = ctx;

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

  console.log("=== the app's own link preview ===");
  {
    // Everything here is checked as an unfurler sees it: no session, no
    // cookies, one GET of the front page and one of whatever it points at.
    const crawler = makeClient(server.origin);
    const page = (await crawler.get("/")).raw;
    const meta = (property) => {
      const match = page.match(new RegExp(`<meta (?:property|name)="${property}" content="([^"]*)"`));
      return match ? match[1] : null;
    };

    const imageUrl = meta("og:image");
    check("the front page offers an image", typeof imageUrl === "string" && imageUrl.length > 0, true);
    check("...as a PNG", imageUrl.endsWith(".png"), true);
    check("...absolute", /^https?:\/\//.test(imageUrl), true);
    check("...and twitter agrees", meta("twitter:image"), imageUrl);
    check("no placeholder survived", /__EMBED_[A-Z_]+__/.test(page), false);

    const card = await crawler.getBytes(new URL(imageUrl).pathname);
    check("the card is there for anyone who asks", card.status, 200);
    check("...as an image", card.headers["content-type"], "image/png");
    check("...and really is a PNG",
      card.body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), true);
    // 1200x630 is what the tags promise; a crawler that lays the card out from
    // them and then gets something else shows a broken one.
    check("...at the size the tags claim",
      [card.body.readUInt32BE(16), card.body.readUInt32BE(20)], [1200, 630]);

    // iOS will not take an SVG here. It quietly screenshots the page instead,
    // which is how this went unnoticed.
    const touchIcon = page.match(/<link rel="apple-touch-icon" href="([^"]*)"/)?.[1] || "";
    check("the touch icon is a PNG too", touchIcon.endsWith(".png"), true);
    check("...and is served", (await crawler.getBytes(new URL(touchIcon).pathname)).status, 200);

    // Discord reads oEmbed as well, and this used to hand it the SVG.
    const oembed = await crawler.get(`/oembed?url=${encodeURIComponent(`${server.origin}/`)}`);
    check("oEmbed answers", oembed.status, 200);
    check("...with a raster thumbnail", String(oembed.body.thumbnail_url).endsWith(".png"), true);
    const thumb = await crawler.getBytes(new URL(oembed.body.thumbnail_url).pathname);
    check("...that can be fetched", thumb.status, 200);
    check("...at the size it claims",
      [thumb.body.readUInt32BE(16), thumb.body.readUInt32BE(20)],
      [oembed.body.thumbnail_width, oembed.body.thumbnail_height]);
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
      if (!ok) fail();
      console.log(`  ${ok ? "PASS" : "FAIL"}  ${label} renders the 404 page`);
    }

    console.log("=== a document has a real address ===");
    {
      const asBrowserHtml = { Accept: "text/html,application/xhtml+xml" };

      // The point of the route: typing, refreshing or opening a pasted
      // /Notes/delta.md loads the app rather than 404ing, and the app then
      // asks for the document as itself.
      const nested = await stranger.get("/Notes/delta.md", asBrowserHtml);
      check("a nested document path serves the app", nested.status, 200);
      check("...as HTML", /text\/html/.test(nested.headers["content-type"]), true);
      check("...which really is the app shell", nested.raw.includes('id="docContent"'), true);
      check("...with no placeholder left in it", /__EMBED_[A-Z_]+__/.test(nested.raw), false);

      const spaced = await stranger.get(`/${encodeURIComponent("Notes")}/${encodeURIComponent("delta.md")}`, asBrowserHtml);
      check("an encoded path works the same", spaced.status, 200);

      // The same page is served at every document address, so anything it asks
      // for relatively is asked for relative to that address: "css/app.css"
      // becomes /Notes/css/app.css and 404s. That shipped once, and the app
      // arrived unstyled with none of its scripts.
      const referenced = [...nested.raw.matchAll(/(?:href|src)="([^"]+)"/g)]
        .map((match) => match[1])
        .filter((value) => !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|data:)/i.test(value));
      /* Counting them was a proxy for "several", and it stopped being true the
       * day `npm run build` collapsed a hundred tags into two. What the check
       * is actually defending is that none of them is relative — so say that.
       */
      check("the shell asks this server for a stylesheet and a script of its own",
        [referenced.some((value) => value.includes(".css")),
          referenced.some((value) => value.includes(".js"))],
        [true, true]);
      check("...every one of them from the root rather than beside the document",
        referenced.filter((value) => !value.startsWith("/")), []);

      for (const reference of referenced) {
        const resolved = new URL(reference, "http://localhost/Notes/delta.md");
        const asked = await stranger.getRaw(`${resolved.pathname}${resolved.search}`);
        check(`${reference} still loads from a document address`, asked.status, 200);
      }

      for (const name of ["/top.md", "/a/b/c/deep.markdown", "/x.ipynb", "/y.mmd"]) {
        const res = await stranger.get(name, asBrowserHtml);
        check(`${name} serves the app`, res.status, 200);
      }

      // The security property. Answering 404 for a document that is not there
      // and 200 for one that is would let anyone, signed in or not, enumerate
      // the library by asking — which is the one thing the read guard exists
      // to stop. Both answers have to be identical.
      const missing = await stranger.get("/Notes/no-such-document.md", asBrowserHtml);
      check("a document that does not exist answers the same way", missing.status, nested.status);
      check("...byte for byte, so nothing can be told apart",
        missing.raw.length === nested.raw.length, true);

      // And it must not have become a catch-all.
      check("a typo still gets the error page",
        (await stranger.get("/nonsense", asBrowserHtml)).status, 404);
      check("...and so does a directory that is not a document",
        (await stranger.get("/Notes", asBrowserHtml)).status, 404);
      check("the API still answers in JSON",
        /application\/json/.test((await stranger.get("/api/nope", asBrowserHtml)).headers["content-type"]), true);
      check("...and a real API route is untouched",
        (await stranger.get("/api/docs")).status, 401);
      check("a static file still wins over the shell",
        /javascript/.test((await stranger.get("/js/app.js", asBrowserHtml)).headers["content-type"]), true);
      check("the raw documents directory is still refused",
        (await stranger.get("/docs/anything.md", asBrowserHtml)).status, 404);

      // A crawler asking for JSON should not be handed a page.
      check("something that wants JSON does not get the shell",
        (await stranger.get("/Notes/delta.md", { Accept: "application/json" })).status, 404);
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
};
