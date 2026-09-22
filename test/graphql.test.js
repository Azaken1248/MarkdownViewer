/* The graph: a read-only view of the library, behind the read policy.
 *
 * It answers with the same functions the REST reads answer with, so the
 * central check is parity: what the graph says about a document, a folder, a
 * search or a link is what /api says. Then the properties an exposed GraphQL
 * endpoint is expected to have — a guard, POST only, a depth limit, a field
 * limit, introspection off — each as a request against a real server.
 *
 * And the one that keeps the CSRF exemption honest: the schema has no
 * mutation type. The exemption exists because a read cannot be ridden
 * cross-site; the day a mutation is added here, this is the check that fails.
 */

const { startTestServer, SEED_USERNAME, SEED_PASSWORD, TEST_PASSWORD } = require("./helpers/server");
const { createChecker } = require("./helpers/check.js");

const { check, finish } = createChecker("GRAPHQL");

(async () => {
  const server = await startTestServer();
  try {
    const gql = (query, headers = {}, variables = undefined) =>
      server.request("POST", "/graphql", variables ? { query, variables } : { query }, headers);

    console.log("=== it is behind the read policy ===");
    {
      const anon = await gql("{ docsCount }");
      check("an anonymous caller is refused", anon.status, 401);
      check("...and learns nothing", anon.body.data, undefined);
      check("a GET is refused", (await server.request("GET", "/graphql?query={docsCount}")).status, 405);
      check("...saying what to use instead",
        (await server.request("GET", "/graphql")).headers.allow, "POST");
    }

    const login = await server.request("POST", "/api/auth/login", { username: SEED_USERNAME, password: SEED_PASSWORD });
    let cookie = login.headers["set-cookie"].map((c) => c.split(";")[0]).join("; ");
    const changed = await server.request("POST", "/api/auth/password",
      { currentPassword: SEED_PASSWORD, newPassword: TEST_PASSWORD },
      { Cookie: cookie, "X-CSRF-Token": login.body.csrfToken });
    cookie = (changed.headers["set-cookie"] || []).map((c) => c.split(";")[0]).join("; ") || cookie;
    const H = { Cookie: cookie };

    console.log("=== a session and no token is enough, because nothing here writes ===");
    {
      const res = await gql("{ docsCount health }", H);
      check("a signed-in caller with no CSRF token is answered", res.status, 200);
      check("...with the count /api/docs would give",
        res.body.data.docsCount, (await server.request("GET", "/api/docs", undefined, H)).body.docs.length);

      // The pin. Introspection is off, so ask the only way left: try to
      // mutate, and expect the schema to say there is no such thing.
      const mutate = await gql('mutation { anything(file: "x") }', H);
      check("the schema has no mutation type",
        mutate.body.errors?.[0]?.message.includes("Schema is not configured to execute mutation"), true);
    }

    console.log("=== it says what /api says ===");
    {
      const rest = (await server.request("GET", "/api/docs", undefined, H)).body;
      const graph = (await gql("{ documents(limit: 1000) { file title size updatedAt folderId folderName folderPath } folders { id name parentId depth path order } }", H)).body.data;
      check("the same documents, in the same order",
        graph.documents.map((d) => d.file), rest.docs.map((d) => d.file));
      check("...with the same facts about each",
        graph.documents[0], (({ file, title, size, updatedAt, folderId, folderName, folderPath }) =>
          ({ file, title, size, updatedAt, folderId, folderName, folderPath }))(rest.docs[0]));
      check("the same folders, in the same order",
        graph.folders.map((f) => f.path), rest.folders.map((f) => f.path));

      const alpha = server.docPaths["alpha.md"];
      const one = (await gql("query($f: String!) { document(file: $f) { file content } }", H, { f: alpha })).body.data.document;
      const viaRest = (await server.request("GET", `/api/docs/${alpha}`, undefined, H)).body;
      check("one document's content is what GET /api/docs gives", one.content, viaRest.content);
      check("a document that is not there is null, not an error",
        (await gql('{ document(file: "nowhere/at-all.md") { file } }', H)).body.data.document, null);
      check("...and so is a path that is not a path",
        (await gql('{ document(file: "../../etc/passwd") { file } }', H)).body.data.document, null);

      const inFolder = (await gql("query($id: String) { documents(folderId: $id) { folderId } }", H,
        { id: rest.docs.find((d) => d.folderId)?.folderId })).body.data.documents;
      check("documents can be asked for by folder", inFolder.length > 0 && inFolder.every((d) => d.folderId === inFolder[0].folderId), true);

      const graphSearch = (await gql('{ search(query: "alpha") { file score snippet } }', H)).body.data.search;
      const restSearch = (await server.request("GET", "/api/docs/search?q=alpha", undefined, H)).body.matches;
      check("a search is the search box's search",
        graphSearch.map((m) => [m.file, m.snippet]), restSearch.map((m) => [m.file, m.snippet]));

      const graphLinks = (await gql("{ links { id url title groups icon } }", H)).body.data.links;
      const restLinks = (await server.request("GET", "/api/links", undefined, H)).body.links;
      check("the links are the links", graphLinks.map((l) => l.id), restLinks.map((l) => l.id));
    }

    console.log("=== content is read only when asked ===");
    {
      // A listing that does not ask for content must not open every file.
      // The proof is indirect but real: the field is a function on the node,
      // and graphql-js calls a field's function only when it is selected.
      const listing = await gql("{ documents(limit: 3) { file } }", H);
      check("a listing without content is answered", listing.status, 200);
      check("...and carries none", "content" in listing.body.data.documents[0], false);
      const withContent = await gql("{ documents(limit: 3) { file content } }", H);
      check("asking for it gets it", withContent.body.data.documents.every((d) => typeof d.content === "string"), true);
    }

    console.log("=== a query has limits ===");
    {
      const many = await gql(`{ ${Array.from({ length: 201 }, (_, i) => `a${i}: docsCount`).join(" ")} }`, H);
      check("two hundred and one aliases are refused",
        many.body.errors?.[0]?.message, "Query names more than 200 fields, aliases included.");
      check("...and nothing was run", many.body.data, undefined);

      const two = await gql("{ a: docsCount b: docsCount }", H);
      check("two are fine", two.body.data, { a: two.body.data.a, b: two.body.data.a });

      let deep = "{ file }";
      for (let i = 0; i < 7; i += 1) {
        deep = `{ documents ${deep} }`;
      }
      const nested = await gql(deep, H);
      check("a query nested past the limit is refused for its depth",
        (nested.body.errors || []).some((e) => /nested \d+ deep; the limit is 6/.test(e.message)), true);

      const intro = await gql("{ __schema { types { name } } }", H);
      check("introspection is off", /introspection has been disabled/.test(intro.body.errors?.[0]?.message || ""), true);

      const capped = await gql("{ documents(limit: 100000) { file } }", H);
      check("a list limit is clamped rather than refused", capped.status, 200);
    }
  } finally {
    await server.stop();
  }

  process.exit(finish());
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
