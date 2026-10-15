/* Part of the LINKS suite. See links.test.js, which loads this.
 *
 * The three endpoints that make the server fetch something: adding a link,
 * re-reading one, and the sweep that fills in the icons of links that never
 * had one.
 *
 * The suite above drives these over HTTP against a real server, and can only
 * drive the refusals — a successful add needs the page to be fetched, and
 * nothing here touches the internet. So the router is mounted in this process
 * instead, with the preview stood in for. What is being checked is the route:
 * what it asks of the store, what it answers with, and the budget it spends,
 * none of which is about the network.
 */
const express = require("express");
const http = require("http");
const path = require("path");
const os = require("os");
const fs = require("fs");

module.exports = async (check) => {
  const linkPreview = require("../../lib/link-preview");
  const { createLinksRoutes } = require("../../lib/routes/links");
  const { LinkStore } = require("../../lib/links");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "azadocs-link-routes-"));
  const linkStore = new LinkStore({ dataDir: dir });
  await linkStore.load();

  /* The preview, stood in for. `describeUrl` and `iconForUrl` are the two
   * things in here that reach the network, and both are covered to the line in
   * fetching.js beside this.
   */
  const realDescribe = linkPreview.describeUrl;
  const realIcon = linkPreview.iconForUrl;

  const described = [];
  const iconsAsked = [];
  /** @type {any} */
  let describeAnswer = null;
  /** @type {string} */
  let iconAnswer = "";

  Object.assign(linkPreview, {
    describeUrl: async (url) => {
      described.push(url);
      if (describeAnswer instanceof Error) {
        throw describeAnswer;
      }

      /* No `icon` key: a link whose icon column is NULL is one that has
        * never been asked, which is what the sweep looks for. Adding a link
        * and fetching its icon are deliberately two requests.
        */
      return {
        url, title: "A page", description: "What it is about", siteName: "A site",
        fetched: true, error: null, fetchedAt: new Date().toISOString(),
        ...(describeAnswer || {})
      };
    },
    iconForUrl: async (url) => {
      iconsAsked.push(url);
      return iconAnswer;
    }
  });

  /* The app, with the gates open. Who may do what is the auth suite's
   * question and is answered there against the real middleware; what is left
   * here is the handler.
   */
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = /** @type {any} */ ({ user: { username: "aza" }, session: { id: "a-session" } });
    next();
  });
  app.use(createLinksRoutes({
    linkStore,
    requireRead: (_req, _res, next) => next(),
    requirePermission: () => (_req, _res, next) => next()
  }));
  /* Anything that reaches here is this server's fault. Turning a preview's
   * own refusal into its own status is the route's job, so a handler that
   * passed the status through would hide a route that stopped doing it.
   */
  app.use((error, _req, res, _next) => {
    res.status(500).json({ error: error.message });
  });

  const server = http.createServer(app);
  await new Promise((ready) => server.listen(0, "127.0.0.1", () => ready(undefined)));
  const origin = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`;

  const ask = (method, pathname, body) => new Promise((done, fail) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const request = http.request(`${origin}${pathname}`, {
      method,
      headers: payload
        ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
        : {}
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const bytes = Buffer.concat(chunks);
        // One of these endpoints answers with a picture, so the body is only
        // read as JSON when it says it is JSON.
        const json = String(response.headers["content-type"] || "").includes("json");
        done({
          status: response.statusCode,
          headers: response.headers,
          bytes,
          body: json && bytes.length ? JSON.parse(bytes.toString("utf8")) : null
        });
      });
    });

    request.on("error", fail);
    if (payload) {
      request.write(payload);
    }

    request.end();
  });

  console.log("=== adding a link, which is the one outbound request this app makes ===");
  {
    const made = await ask("POST", "/api/links",
      { url: "https://example.test/one", note: "worth keeping", groups: ["Reading"] });

    check("a link is created", made.status, 201);
    check("...from what the page said", [made.body.link.title, made.body.link.description],
      ["A page", "What it is about"]);
    // The note and the filing are the person's, not the page's.
    check("...with the note and the group it was filed under",
      [made.body.link.note, made.body.link.groups], ["worth keeping", ["Reading"]]);
    check("...recorded as added by whoever asked", made.body.link.createdBy, "aza");
    // With how many links are in each, since that is what the pane draws.
    check("...and the groups list comes back with it",
      made.body.groups, [{ name: "Reading", count: 1 }]);
    check("the page was read once", described, ["https://example.test/one"]);

    // The same address twice is the same link: adding it again says which one
    // it already is, so the pane can go to it.
    const again = await ask("POST", "/api/links", { url: "https://example.test/one" });
    check("the same address again is refused", again.status >= 400, true);
    check("...naming the link it already is", again.body.existingId, made.body.link.id);

    /* A page that will not read is still a link worth keeping, so the refusal
     * only happens for an address that should never have been fetched — and
     * then it is the preview's own status and wording that answer.
     */
    describeAnswer = Object.assign(new Error("That address is not allowed."), { status: 400 });
    const refused = await ask("POST", "/api/links", { url: "http://127.0.0.1/" });
    check("an address the preview refuses is refused with its reason",
      [refused.status, refused.body.error], [400, "That address is not allowed."]);

    // And anything else that goes wrong is a 500 through the error handler
    // rather than a 400 blaming the person who asked.
    describeAnswer = new Error("the disk fell over");
    const broke = await ask("POST", "/api/links", { url: "https://example.test/two" });
    check("...while something going wrong at this end is not their fault",
      broke.status, 500);
    describeAnswer = null;
  }

  console.log("=== and re-reading one, which is the same fetch again ===");
  {
    const made = await ask("POST", "/api/links",
      { url: "https://example.test/three", groups: ["Reading"] });
    const id = made.body.link.id;

    // An edit with no refresh asked for changes what the person typed and
    // nothing else: no request is made.
    described.splice(0);
    const edited = await ask("PATCH", `/api/links/${id}`,
      { title: "My own title", note: "mine" });
    check("an edit changes what the person typed", edited.body.link.title, "My own title");
    check("...and asks the site nothing", described, []);

    /* Re-reading replaces what the page said. It must not touch how the link
     * was filed, so the groups are carried across explicitly — otherwise a
     * refresh quietly unfiles it.
     */
    describeAnswer = { title: "The new title", description: "Different now" };
    const refreshed = await ask("PATCH", `/api/links/${id}`,
      { refresh: true, groups: ["Reading", "Later"] });
    check("a refresh reads the page again", described, ["https://example.test/three"]);
    check("...and takes the page's word for the title now",
      refreshed.body.link.title, "The new title");
    /* The filing is the person's and the metadata is the page's, so a refresh
     * carries the groups across rather than letting the page's answer stand in
     * for them — which would quietly unfile the link.
     */
    check("...while the filing is still whatever was sent with it",
      refreshed.body.link.groups, ["Reading", "Later"]);
    describeAnswer = null;

    // A link that is not there is not an edit.
    const missing = await ask("PATCH", "/api/links/not-a-link", { title: "x" });
    check("editing a link that is not there says so",
      [missing.status, missing.body.error], [404, "No such link."]);

    // And a refresh the preview refuses answers with the preview's reason.
    describeAnswer = Object.assign(new Error("That site is gone."), { status: 502 });
    const dead = await ask("PATCH", `/api/links/${id}`, { refresh: true });
    check("a refresh the preview refuses says why",
      [dead.status, dead.body.error], [502, "That site is gone."]);
    describeAnswer = null;
  }

  console.log("=== and the sweep that fills in the icons ===");
  {
    /* A link added now already has its icon: describeUrl fetches it. What the
     * sweep is for is the rows that were written before there was a column to
     * put one in, which come back with it NULL — "never asked" — rather than
     * empty, which means "asked, and there was none".
     *
     * So the legacy row is what is modelled here, by nulling the column the
     * way a migration left it.
     */
    const legacy = await ask("POST", "/api/links", { url: "https://old.test/" });
    const olderThanIcons = (id) => linkStore.db
      .prepare("UPDATE links SET icon = NULL WHERE id = ?").run(id);
    olderThanIcons(legacy.body.link.id);

    iconsAsked.splice(0);
    iconAnswer = "data:image/png;base64,iVBORw0KGgo=";
    const pending = await ask("POST", "/api/links/icons");

    check("the sweep reads the links that never had an icon asked for",
      iconsAsked, ["https://old.test/"]);
    check("...and says how many it found one for", pending.body.fetched, 1);
    check("...with nothing left to do afterwards", pending.body.remaining, 0);
    // The list comes back with it, so the pane does not have to ask again.
    check("...handing back the list it has just changed",
      Array.isArray(pending.body.links), true);

    // Asked again with nothing pending, it is a list and no requests.
    iconsAsked.splice(0);
    const nothing = await ask("POST", "/api/links/icons");
    check("asked again with nothing to do, it asks nothing",
      [iconsAsked, nothing.body.fetched, nothing.body.remaining], [[], 0, 0]);

    /* A site with no icon is still answered: the link has been asked, and that
     * answer is worth storing as an empty string, or it is asked again every
     * visit for the rest of the library's life.
     */
    const bare = await ask("POST", "/api/links", { url: "https://noicon.test/" });
    olderThanIcons(bare.body.link.id);
    iconAnswer = "";
    const swept = await ask("POST", "/api/links/icons");
    check("a site with no icon is marked as asked rather than left pending",
      [swept.body.fetched, swept.body.remaining], [0, 0]);
  }

  console.log("=== the icon itself, served as a picture ===");
  {
    const made = await ask("POST", "/api/links", { url: "https://pictured.test/" });
    const id = made.body.link.id;
    linkStore.db.prepare("UPDATE links SET icon = NULL WHERE id = ?").run(id);
    iconAnswer = "data:image/png;base64,iVBORw0KGgo=";
    await ask("POST", "/api/links/icons");

    const icon = await ask("GET", `/api/links/${id}/icon`);
    check("the icon comes back as a picture",
      [icon.status, icon.headers["content-type"]], [200, "image/png"]);
    check("...as the bytes themselves rather than as a data URI",
      icon.bytes.subarray(0, 4).toString("latin1"), "\x89PNG");
    /* With a tag of its own, so re-reading a page and getting a different
     * picture gets a different address — which is what makes it safe to let a
     * browser keep it for a long time.
     */
    check("...with an entity tag of its own", String(icon.headers.etag || "").length > 2, true);
    check("...and a long life, since the address changes when the bytes do",
      String(icon.headers["cache-control"] || "").includes("max-age"), true);

    const none = await ask("GET", "/api/links/not-a-link/icon");
    check("a link that is not there has no icon",
      [none.status, none.body.error], [404, "No icon for that link."]);
  }

  console.log("=== and removing one ===");
  {
    const made = await ask("POST", "/api/links", { url: "https://temporary.test/" });
    const gone = await ask("DELETE", `/api/links/${made.body.link.id}`);
    check("a link can be removed", [gone.status, gone.body.removed], [200, true]);
    check("...and the groups list comes back with it",
      Array.isArray(gone.body.groups), true);

    const again = await ask("DELETE", `/api/links/${made.body.link.id}`);
    check("removing it twice says it is not there",
      [again.status, again.body.error], [404, "No such link."]);
  }

  console.log("=== and the budget, which is what stops this being a scanner ===");
  {
    /* Every preview is a request to a server that did not ask for it, so there
     * is a ceiling: twenty a minute per account. Past it the answer is a 429
     * rather than another outbound request.
     */
    let refused = null;
    for (let at = 0; at < 30 && !refused; at += 1) {
      const answer = await ask("POST", "/api/links", { url: `https://budget-${at}.test/` });
      if (answer.status === 429) {
        refused = answer;
      }
    }

    check("past the ceiling, adding a link is refused", Boolean(refused), true);
    check("...saying to wait rather than saying nothing",
      refused.body.error.includes("Wait a minute"), true);

    /* And the sweep spends the same budget, so a large library comes in over a
     * few visits rather than half-failing on one — with something waiting, so
     * "it did nothing" is a decision rather than an empty list.
     */
    const waiting = linkStore.list()[0];
    linkStore.db.prepare("UPDATE links SET icon = NULL WHERE id = ?").run(waiting.id);
    iconsAsked.splice(0);
    const swept = await ask("POST", "/api/links/icons");
    check("the icon sweep spends the same budget",
      [iconsAsked, swept.body.fetched], [[], 0]);
    check("...and says how much is still waiting", swept.body.remaining > 0, true);

    // A refresh does too, since it is the same outbound fetch.
    const some = linkStore.list()[0];
    const blocked = await ask("PATCH", `/api/links/${some.id}`, { refresh: true });
    check("...and so does a refresh", blocked.status, 429);
  }

  console.log("=== a row the database cannot quite answer for ===");
  {
    /* Rows are written by this app and read back by it, so these are the
     * shapes an older version — or somebody with the file open — could leave:
     * groups that will not parse, and a link that is not there.
     */
    const made = linkStore.list()[0];
    linkStore.db.prepare("UPDATE links SET groups_json = ? WHERE id = ?")
      .run("{not json", made.id);

    const listed = await ask("GET", "/api/links");
    const back = listed.body.links.find((one) => one.id === made.id);
    check("a row whose groups will not parse is a link with no groups",
      back.groups, []);
    check("...rather than a request that fails", listed.status, 200);

    // An icon column holding something that is not a data URI is no icon.
    linkStore.db.prepare("UPDATE links SET icon = ? WHERE id = ?")
      .run("not a data uri", made.id);
    const icon = await ask("GET", `/api/links/${made.id}/icon`);
    check("an icon that is not a picture is no icon",
      [icon.status, icon.body.error], [404, "No icon for that link."]);
  }

  console.log("=== and the four places something at this end can go wrong ===");
  {
    /* Each handler has a last branch for an error that is nobody's fault but
     * this server's: a 500 through the error handler rather than a 400 that
     * blames the person who asked. The store is made to fall over to reach
     * them, which is the only way — there is no request that causes this.
     */
    const falls = () => {
      throw new Error("the database went away");
    };

    const real = {
      list: linkStore.list, find: linkStore.find, needingIcons: linkStore.needingIcons,
      remove: linkStore.remove
    };

    Object.assign(linkStore, { list: falls });
    check("a list the store cannot give is this server's fault",
      (await ask("GET", "/api/links")).status, 500);
    Object.assign(linkStore, { list: real.list });

    Object.assign(linkStore, { needingIcons: falls });
    check("...as is a sweep it cannot start",
      (await ask("POST", "/api/links/icons")).status, 500);
    Object.assign(linkStore, { needingIcons: real.needingIcons });

    Object.assign(linkStore, { remove: falls });
    check("...a removal it cannot do",
      (await ask("DELETE", "/api/links/anything")).status, 500);
    Object.assign(linkStore, { remove: real.remove });

    Object.assign(linkStore, { find: falls });
    check("...and an edit it cannot look up",
      (await ask("PATCH", "/api/links/anything", { title: "x" })).status, 500);
    check("...or an icon it cannot look up",
      (await ask("GET", "/api/links/anything/icon")).status, 500);
    Object.assign(linkStore, { find: real.find });
  }

  console.log("=== and the store's own three refusals ===");
  {
    /* An address that is not one has no canonical form, so it is its own key:
     * two of the same unparseable string are still the same link.
     */
    const { canonicalKey } = require("../../lib/links");
    check("an address that cannot be parsed is its own key",
      canonicalKey("not an address at all"), "not an address at all");

    // Editing a link that is not there is nothing to edit.
    check("updating a link that is not there is nothing",
      await linkStore.update("not-a-link", { title: "x" }), null);

    /* And a library has a ceiling. Not because the file could not hold more,
     * but because a list nobody can read is not a feature.
     */
    const { MAX_LINKS } = require("../../lib/links");
    const rows = linkStore.db.prepare("SELECT COUNT(*) AS n FROM links").get().n;
    const filler = linkStore.db.prepare(
      "INSERT INTO links (id, url, canonical_key, title, description, site_name, note,"
      + " groups_json, fetched, created_at) VALUES (?, ?, ?, '', '', '', '', '[]', 1, ?)");

    for (let at = rows; at < MAX_LINKS; at += 1) {
      filler.run(`filler-${at}`, `https://filler-${at}.test/`,
        `https://filler-${at}.test/`, new Date().toISOString());
    }

    let said = "";
    try {
      await linkStore.create({ url: "https://one-too-many.test/" });
    } catch (error) {
      said = error.message;
    }

    check(`a library of ${MAX_LINKS} links will not take another`,
      said.includes(`at most ${MAX_LINKS}`), true);

    /* And an icon answered for a link that has gone between the sweep reading
     * the list and the answers coming back is dropped rather than written to
     * nothing.
     */
    await linkStore.setIcons([{ id: "not-a-link", icon: "data:image/png;base64,AA" }]);
    check("an icon answered for a link that has gone is dropped",
      linkStore.find("not-a-link"), null);
  }

  await new Promise((closed) => server.close(() => closed(undefined)));
  Object.assign(linkPreview, { describeUrl: realDescribe, iconForUrl: realIcon });
  fs.rmSync(dir, { recursive: true, force: true });
};
