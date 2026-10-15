/* Part of the LINKS suite. See links.test.js, which loads this.
 *
 * The half of lib/link-preview.js that is a network: one request, the
 * redirects it follows, the DNS lookup it is given, and every way a site can
 * answer that is not an answer.
 *
 * The suite above drives the pure half — what a URL is allowed to be, which
 * addresses are refused, what is read out of a page's <head>. None of this
 * could be reached from there, and not because it is hard: it is because the
 * guard works. `guardedLookup` refuses every private address, loopback
 * included, so a test server on 127.0.0.1 is exactly what the module exists to
 * refuse.
 *
 * So the transport is stood in for. `sendRequest` reads `http.request` off the
 * module at call time, and the stand-in is handed the same options Node would
 * be — including the `lookup` function, which it calls, so the guard is driven
 * for real rather than skipped.
 */
const http = require("http");
const https = require("https");
const { EventEmitter } = require("events");
const dns = require("dns");

module.exports = async (check) => {
  const preview = require("../../lib/link-preview");

  /* --- the network, as a table of what each host answers with ------------ */

  /* Keyed by host and path, because a page and its icon come from the same
   * host and are not the same answer.
   */
  /** @type {Map<string, any>} */
  const answers = new Map();
  const asked = [];

  const serves = (where, answer) => answers.set(where, answer);

  const answerFor = (url) => {
    const at = new URL(String(url));
    return answers.get(at.host + at.pathname) || answers.get(at.host) || { status: 404 };
  };

  const realRequest = http.request;
  const realHttpsRequest = https.request;
  const realLookup = dns.lookup;

  /** @type {any} */
  let lookupAnswer = { addresses: [{ address: "93.184.216.34", family: 4 }] };

  // Node's own, stood in for: whatever this approves is what the socket would
  // connect to, which is the whole reason the module hands its own in.
  Object.assign(dns, {
    lookup: (hostname, options, callback) => {
      if (lookupAnswer.error) {
        callback(lookupAnswer.error);
        return;
      }

      callback(null, lookupAnswer.addresses);
    }
  });

  const fakeRequest = (url, options, onResponse) => {
    asked.push({ url: String(url), accept: options.headers.Accept, timeout: options.timeout });
    const request = new EventEmitter();

    Object.assign(request, {
      end: () => {
        const answer = answerFor(url);

        /* The lookup Node would do before it connected. Called here because
         * the guard is the point: a hostname that resolves inside a private
         * network must never reach a socket.
         */
        const proceed = () => {
          if (answer.timesOut) {
            request.emit("timeout");
            return;
          }

          if (answer.failsWith) {
            request.emit("error", Object.assign(new Error("no"), { code: answer.failsWith }));
            return;
          }

          const response = new EventEmitter();
          Object.assign(response, {
            statusCode: answer.status || 200,
            headers: {
              ...(answer.location ? { location: answer.location } : {}),
              ...(answer.type ? { "content-type": answer.type } : {})
            },
            setEncoding: () => {},
            destroy: () => response.emit("close")
          });

          onResponse(response);

          for (const chunk of answer.chunks || (answer.body === undefined ? [] : [answer.body])) {
            response.emit("data", chunk);
          }

          if (!answer.neverEnds) {
            response.emit("end");
          }
        };

        options.lookup(new URL(String(url)).hostname, { all: true }, (error) => {
          if (error) {
            request.emit("error", error);
            return;
          }

          proceed();
        });
      },
      destroy: (error) => {
        if (error) {
          request.emit("error", error);
        }
      },
      setTimeout: () => {}
    });

    return request;
  };

  Object.assign(http, { request: fakeRequest });
  Object.assign(https, { request: fakeRequest });

  const page = (body, over = {}) => ({
    status: 200, type: "text/html; charset=utf-8", body, ...over
  });

  console.log("=== one page, fetched ===");
  {
    asked.splice(0);
    serves("example.test", page("<title>A page</title>"));
    const got = await preview.fetchPage(new URL("https://example.test/"));

    check("the page comes back", got.body, "<title>A page</title>");
    check("...from the address that was asked for", got.url.href, "https://example.test/");
    // No cookies, no auth, and no hint about who asked — and a timeout, so a
    // site that never answers is not waited on forever.
    check("...asked for as HTML, with a ceiling on the wait",
      [asked[0].accept.includes("text/html"), asked[0].timeout, preview.REQUEST_TIMEOUT_MS],
      [true, preview.REQUEST_TIMEOUT_MS, preview.REQUEST_TIMEOUT_MS]);
  }

  console.log("=== and the ways a site answers that are not an answer ===");
  {
    const refused = async (host, answer, expected) => {
      serves(host, answer);
      let said = "";
      try {
        await preview.fetchPage(new URL(`https://${host}/`));
      } catch (error) {
        said = error.message;
      }

      check(expected.label, said.includes(expected.says), true);
    };

    await refused("gone.test", { status: 404 },
      { label: "a site that answers 404 says so", says: "answered 404" });
    await refused("broken.test", { status: 500 },
      { label: "...and one that answers 500 too", says: "answered 500" });
    await refused("slow.test", { timesOut: true },
      { label: "a site that never answers is not waited on", says: "took too long" });
    await refused("missing.test", { failsWith: "ENOTFOUND" },
      { label: "a domain that does not exist says that", says: "could not be found" });
    await refused("flaky.test", { failsWith: "EAI_AGAIN" },
      { label: "...as does one the resolver cannot reach", says: "could not be found" });
    await refused("closed.test", { failsWith: "ECONNREFUSED" },
      { label: "...and anything else is simply unreachable", says: "could not be reached" });

    /* Something that is not a page. Stopping at the header also means an
     * archive or a video is never pulled into memory.
     */
    serves("video.test", page("not html at all", { type: "video/mp4" }));
    check("something that is not a page comes back empty rather than in memory",
      (await preview.fetchPage(new URL("https://video.test/"))).body, "");

    // A page with no type at all is read, because plenty of servers send none.
    serves("untyped.test", { status: 200, body: "<title>Untyped</title>" });
    check("...while a page with no type on it is read anyway",
      (await preview.fetchPage(new URL("https://untyped.test/"))).body, "<title>Untyped</title>");

    /* Everything worth reading is in <head>, so the read stops at a ceiling —
     * a response with no end is not worth waiting for.
     */
    serves("endless.test", {
      status: 200, type: "text/html",
      chunks: [`${"x".repeat(preview.MAX_BYTES)}`, "and more"],
      neverEnds: true
    });
    const capped = await preview.fetchPage(new URL("https://endless.test/"));
    check("a page with no end is read as far as the ceiling and no further",
      capped.body.length <= preview.MAX_BYTES + "and more".length, true);
  }

  console.log("=== the redirects it follows, and the gate each one goes through ===");
  {
    serves("hop1.test", { status: 301, location: "https://hop2.test/" });
    serves("hop2.test", page("<title>Arrived</title>"));

    const arrived = await preview.fetchPage(new URL("https://hop1.test/"));
    check("a redirect is followed", arrived.body, "<title>Arrived</title>");
    check("...and the address it arrived at is the one it reports",
      arrived.url.href, "https://hop2.test/");

    // A relative Location is resolved against where it came from.
    serves("rel.test", { status: 302, location: "/elsewhere" });
    serves("rel.test/elsewhere", page("x"));
    answers.set("rel.test", { status: 302, location: "/elsewhere" });
    let hops = 0;
    const counting = async (url) => {
      hops += 1;
      return hops === 1
        ? { redirectTo: "/elsewhere" }
        : { body: `at ${url.pathname}` };
    };

    check("a relative redirect is resolved against the page it came from",
      (await preview.fetchPage(new URL("https://rel.test/here"), counting)).body,
      "at /elsewhere");

    /* Each hop goes through exactly the same gate as the address that was
     * typed. Without that, any public URL is a way to reach anything.
     */
    let said = "";
    try {
      await preview.fetchPage(new URL("https://start.test/"),
        async () => ({ redirectTo: "http://127.0.0.1/" }));
    } catch (error) {
      said = error.message;
    }

    check("a redirect into a private network is refused like any other",
      said.includes("private network") || said.includes("not allowed"), true);

    said = "";
    try {
      await preview.fetchPage(new URL("https://start.test/"),
        async () => ({ redirectTo: "http://[" }));
    } catch (error) {
      said = error.message;
    }

    check("...and a redirect to something that is not an address says so",
      said.includes("somewhere invalid"), true);

    // Round and round. A chain that never arrives is a chain to give up on.
    said = "";
    try {
      await preview.fetchPage(new URL("https://loop.test/"),
        async () => ({ redirectTo: "https://loop.test/" }));
    } catch (error) {
      said = error.message;
    }

    check("a chain that never arrives is given up on",
      said.includes("too many times"), true);
  }

  console.log("=== the lookup the request is given ===");
  {
    /* Node calls this instead of dns.lookup, so whatever it approves is what
     * the socket connects to. There is no window between the check and the
     * connection for the answer to change.
     */
    serves("public.test", page("<title>Fine</title>"));
    lookupAnswer = { addresses: [{ address: "93.184.216.34", family: 4 }] };
    check("a host that resolves somewhere public is fetched",
      (await preview.fetchPage(new URL("https://public.test/"))).body, "<title>Fine</title>");

    // One name, several addresses, one of them private: the private one is
    // dropped rather than the whole name being refused.
    lookupAnswer = {
      addresses: [{ address: "10.0.0.5", family: 4 }, { address: "93.184.216.34", family: 4 }]
    };
    check("...and one that resolves to both keeps only the public address",
      (await preview.fetchPage(new URL("https://public.test/"))).body, "<title>Fine</title>");

    // Every address private is a name that cannot be fetched at all, which is
    // the DNS rebinding case this exists for.
    lookupAnswer = { addresses: [{ address: "127.0.0.1", family: 4 }] };
    let said = "";
    try {
      await preview.fetchPage(new URL("https://private.test/"));
    } catch (error) {
      said = error.message;
    }

    check("a host that resolves only inside a private network is refused",
      said.includes("private network"), true);

    lookupAnswer = { addresses: [{ address: "::1", family: 6 }] };
    said = "";
    try {
      await preview.fetchPage(new URL("https://localsix.test/"));
    } catch (error) {
      said = error.message;
    }

    check("...and so is one that resolves to loopback over IPv6",
      said.includes("private network"), true);

    // A resolver that cannot answer is a host that cannot be reached.
    lookupAnswer = { error: Object.assign(new Error("nope"), { code: "ENOTFOUND" }) };
    said = "";
    try {
      await preview.fetchPage(new URL("https://nodns.test/"));
    } catch (error) {
      said = error.message;
    }

    check("a name the resolver cannot answer for is not fetched",
      said.includes("could not be found"), true);
    lookupAnswer = { addresses: [{ address: "93.184.216.34", family: 4 }] };
  }

  // The eight bytes that say "this is a PNG", which is what the sniffer reads.
  const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(16)
  ]);

  console.log("=== and the icon, which is bytes rather than words ===");
  {

    asked.splice(0);
    serves("icons.test", page('<link rel="icon" href="/favicon.png">'));
    serves("icons.test/favicon.png", { status: 200, type: "image/png", body: PNG });

    const found = await preview.fetchIcon(new URL("https://icons.test/"),
      '<link rel="icon" href="/favicon.png">');
    check("an icon the page names is fetched", found.startsWith("data:image/png;base64,"), true);
    /* Servers hand out .ico as everything from image/x-icon to
     * application/octet-stream, so the header is not the decision — the bytes
     * are, once they are here.
     */
    check("...asked for as an image, with its own shorter ceiling",
      [asked[0].accept.includes("image/"), asked[0].timeout < preview.REQUEST_TIMEOUT_MS],
      [true, true]);

    // Bytes that are not an image are not an icon, whatever the header said.
    serves("icons.test/favicon.png",
      { status: 200, type: "image/png", body: Buffer.from("not an icon at all") });
    check("bytes that are not a picture are not an icon",
      await preview.fetchIcon(new URL("https://icons.test/"),
        '<link rel="icon" href="/favicon.png">'), "");

    /* Never throws: a refused address, a dead host or a page with no icon are
     * all the same answer — this link has been asked, and there is nothing to
     * show. That answer is worth storing, or it is asked again every visit.
     */
    check("a whole page that cannot be read is simply no icon",
      await preview.iconForUrl("http://127.0.0.1/"), "");
    check("...as is an address that is not one", await preview.iconForUrl("not a url"), "");

    serves("plain.test", page("<title>No icon here</title>"));
    check("...and a page with no icon on it", await preview.iconForUrl("https://plain.test/"), "");

    /* The page's own list of candidates, and the ones that are not candidates
     * at all: a <link> with no href, and a <link> that is not an icon.
     */
    check("a link tag with no address is not an icon",
      preview.iconCandidates('<link rel="icon">', new URL("https://x.test/"))
        .some((one) => one.includes("undefined")), false);
    check("...and a link tag that is not an icon is not one either",
      preview.iconCandidates('<link rel="stylesheet" href="/s.css">', new URL("https://x.test/"))
        .some((one) => one.endsWith("/s.css")), false);
    // An apple-touch-icon is, though: it is the one a phone would use.
    check("...while a touch icon is", preview.iconCandidates(
      '<link rel="apple-touch-icon" href="/t.png">', new URL("https://x.test/"))
      .some((one) => one.endsWith("/t.png")), true);

    /* An address the page gave that cannot be resolved is kept as it was
     * rather than dropped: it may still be an icon somewhere.
     */
    check("an icon address that will not resolve is kept as it was",
      preview.iconCandidates('<link rel="icon" href="http://[">', new URL("https://x.test/"))
        .some((one) => one === "http://["), true);

    /* A data: URI is left alone — there is nothing to resolve, and resolving
     * it against anything would only mangle it.
     */
    const inline = '<link rel="icon" href="data:image/png;base64,'
      + `${PNG.toString("base64")}">`;
    check("an icon written into the page is used without asking for anything",
      (await preview.fetchIcon(new URL("https://x.test/"), inline))
        .startsWith("data:image/png;base64,"), true);
    // And one that is not decodable is not an icon.
    check("...unless it does not decode",
      await preview.fetchIcon(new URL("https://x.test/"),
        '<link rel="icon" href="data:image/png;base64,!!!not base64!!!">'), "");
    check("...or is not a data URI at all",
      preview.decodeDataUri("https://x.test/i.png"), null);

    /* Only so many candidates are tried, and only for so long: the href comes
     * off a page a stranger asked us to preview, and a page naming forty icons
     * must not become forty requests.
     */
    const many = Array.from({ length: preview.ICON_CANDIDATES + 6 },
      (_, at) => `<link rel="icon" href="/none-${at}.png">`).join("");
    asked.splice(0);
    serves("many.test", page(many));
    check("a page naming more icons than will be tried is not all tried",
      (await preview.fetchIcon(new URL("https://many.test/"), many), asked.length)
      <= preview.ICON_CANDIDATES, true);

    serves("withicon.test", page('<link rel="icon" href="/i.png">'));
    serves("withicon.test/i.png", { status: 200, type: "image/png", body: PNG });
    const sniffed = await preview.iconForUrl("https://withicon.test/");
    check("a page with one gives it", sniffed.startsWith("data:image/png"), true);
  }

  console.log("=== and the four small refusals under all of it ===");
  {
    /* An address that is not four numbers is not an address, and the safe
     * answer to "is this allowed" for something that is not an address at all
     * is no.
     */
    check("something shaped like an address but not one is refused",
      [preview.isBlockedIPv4("1.2.3"), preview.isBlockedIPv4("1.2.3.999"),
        preview.isBlockedIPv4("a.b.c.d")], [true, true, true]);

    /* A <base> the page cannot be resolved against is no base: the page's own
     * address is still the honest answer.
     */
    serves("based.test", page('<base href="http://["><link rel="icon" href="/i.png">'));
    serves("based.test/i.png", { status: 200, type: "image/png", body: PNG });
    check("a base tag that will not resolve leaves the page as its own base",
      (await preview.fetchIcon(new URL("https://based.test/"),
        '<base href="http://["><link rel="icon" href="/i.png">'))
        .startsWith("data:image/png"), true);

    // A data: URI whose payload is not decodable is not a picture.
    check("a data URI that will not decode is nothing",
      preview.decodeDataUri("data:image/png,%zz"), null);

    /* And the lookup asked for one address rather than all of them, which is
     * the shape Node uses when it is not told otherwise.
     */
    const single = await new Promise((done) => {
      serves("single.test", page("<title>x</title>"));
      let seen = null;
      const was = http.request;
      Object.assign(http, {
        request: (url, options) => {
          options.lookup(new URL(String(url)).hostname, {}, (error, address, family) => {
            seen = { error, address, family };
          });

          Object.assign(http, { request: was });
          done(seen);
          return Object.assign(new EventEmitter(), {
            end: () => {}, destroy: () => {}, setTimeout: () => {}
          });
        }
      });

      void preview.fetchPage(new URL("http://single.test/")).catch(() => {});
    });

    check("a lookup that asked for one address is given one",
      [single.error, single.address, single.family], [null, "93.184.216.34", 4]);
  }

  console.log("=== and the whole job, which never refuses to save a link ===");
  {

    serves("whole.test", page([
      "<title>The title</title>",
      '<meta property="og:description" content="What it is about">',
      '<meta property="og:site_name" content="A site">',
      '<link rel="icon" href="/i.png">'
    ].join("")));
    serves("whole.test/i.png", { status: 200, type: "image/png", body: PNG });

    const described = await preview.describeUrl("https://whole.test/page");
    check("a page that reads is described by what it says",
      [described.title, described.description, described.siteName],
      ["The title", "What it is about", "A site"]);
    check("...and is marked as having been read", described.fetched, true);
    check("...with the address that was typed, not the one it ended at",
      described.url, "https://whole.test/page");

    /* A page that cannot be read is not an error: the link is still worth
     * keeping, so the card says what it knows — the hostname — rather than
     * refusing to save anything.
     */
    serves("dead.test", { status: 500 });
    const dead = await preview.describeUrl("https://dead.test/");
    check("a page that will not read is still a link worth keeping",
      [dead.fetched, dead.title], [false, "dead.test"]);
    check("...saying what went wrong", dead.error.includes("answered 500"), true);

    // Except an address that should never have been fetched at all, which the
    // person needs to hear about rather than have quietly saved.
    let said = "";
    try {
      await preview.describeUrl("http://169.254.169.254/latest/meta-data/");
    } catch (error) {
      said = error.message;
    }

    check("...while an address that should never be fetched is refused outright",
      said.length > 0, true);

    /* Including one that only turns out to be private once it has been looked
     * up, which is the rebinding case: that refusal happens inside the fetch
     * and still has to reach the person rather than being saved as a card
     * saying the site could not be read.
     */
    lookupAnswer = { addresses: [{ address: "192.168.1.10", family: 4 }] };
    serves("rebind.test", page("<title>Never read</title>"));
    said = "";
    try {
      await preview.describeUrl("https://rebind.test/");
    } catch (error) {
      said = error.message;
    }

    check("...as is one that only turns out to be private when it is looked up",
      said.includes("private network"), true);
    lookupAnswer = { addresses: [{ address: "93.184.216.34", family: 4 }] };

    // A redirect is how the page was reached, not what the person meant to
    // save — so both are kept and the typed one is the link.
    serves("short.test", { status: 301, location: "https://whole.test/page" });
    const moved = await preview.describeUrl("https://short.test/");
    check("a link that redirects keeps both addresses",
      [moved.url, moved.resolvedUrl], ["https://short.test/", "https://whole.test/page"]);
    check("...and one that does not keeps only its own",
      (await preview.describeUrl("https://whole.test/page")).resolvedUrl, null);
  }

  Object.assign(http, { request: realRequest });
  Object.assign(https, { request: realHttpsRequest });
  Object.assign(dns, { lookup: realLookup });
};
