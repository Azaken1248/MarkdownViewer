/* What every route does when the library underneath it will not answer.
 *
 * Each API router is built from a bag of dependencies the server hands it —
 * read the organizer, move a file, find a share. Every one of those can fail
 * for reasons that have nothing to do with the request: a full disk, a
 * database locked by another process, a file somebody removed between the
 * check and the read. The routes are written for it; every handler is a try
 * around its body and a `next(error)` under it, and that line was unreached
 * in ten route files.
 *
 * What it is worth checking is not the line but the promise it makes: a
 * request whose dependencies fail gets an answer. The alternative is not a
 * wrong answer, it is no answer at all — a fetch that never settles, a
 * spinner that spins until the tab is closed, and a server holding the
 * connection open for a request it stopped working on.
 *
 * So each router is mounted on an app of its own with every dependency
 * replaced by one that throws, and every route it registers is asked for.
 * The routes come from the router rather than from a list kept here: a list
 * would go stale the first time somebody adds a handler, and the handler
 * added without a try around it is exactly the one this suite is for.
 */

const express = require("express");
const http = require("http");

const { createChecker } = require("./helpers/check.js");

/* Every router that is built from a bag of dependencies, by name.
 *
 * pages.js is not here: its routes serve the pages themselves, mounted as
 * patterns and static middleware rather than as one path each, and what it
 * does when a template will not read is the error-page suite's question.
 */
/** @type {Array<[string, (deps: any) => import("express").Router]>} */
const ROUTERS = [
  ["documents", require("../lib/routes/docs.js").createDocsRoutes],
  ["the recycle bin and the archive", require("../lib/routes/recycle.js").createRecycleRoutes],
  ["folders", require("../lib/routes/folders.js").createFoldersRoutes],
  ["shares", require("../lib/routes/shares.js").createSharesRoutes],
  ["assets", require("../lib/routes/assets.js").createAssetRoutes],
  ["folder upload", require("../lib/routes/upload.js").createUploadRoutes],
  ["users", require("../lib/routes/users.js").createUserRoutes],
  ["sessions", require("../lib/routes/auth.js").createAuthRoutes],
  ["export", require("../lib/routes/export.js").createExportRoutes]
];

const { check, finish } = createChecker("FAULTS");

// The one failure every dependency produces, so an answer can be traced back
// to it rather than to something the test did by accident.
const THE_FAULT = "the library did not answer";

// No status at all: the request ran out of its deadline without being
// answered, which is the failure this suite exists to catch.
const NOTHING_CAME_BACK = 0;

/* A dependency bag where everything fails.
 *
 * Values the routers read rather than call are given real values: a path has
 * to be a string or `path.join` throws before the handler reaches anything,
 * and the failure under test would be a TypeError in the test's own setup.
 * The guards are let through, because "may this person do this" is answered
 * before the library is touched and is not what is being broken here.
 */
function aLibraryThatWillNotAnswer(overrides = {}) {
  /* The guards are let through, and they are also what says who is asking:
   * the real ones put the signed-in account on the request, and a handler
   * that reads it would fall over on the way to the library if this did not.
   */
  const pass = (req, res, next) => {
    req.auth = {
      user: { id: "someone", username: "someone", role: "admin", disabled: false },
      session: { id: "a-session" },
      token: "a-token"
    };
    next();
  };
  const refusesToAnswer = () => {
    throw new Error(THE_FAULT);
  };

  // An object whose every method fails: the stores are reached through one.
  const storeThatFails = new Proxy({}, {
    get: (target, name) => (name === "then" ? undefined : refusesToAnswer)
  });

  const values = {
    markdownDir: "/nowhere/docs",
    softDeletedDir: "/nowhere/deleted/soft",
    hardDeletedDir: "/nowhere/deleted/hard",
    assetsDir: "/nowhere/assets",
    publicDir: "/nowhere/public",
    maxDocBytes: 2 * 1024 * 1024,
    maxAssetBytes: 5 * 1024 * 1024,
    maxFolderDepth: 8,
    requireRead: pass,
    requireAuth: pass,
    requireAdmin: pass,
    requirePermission: () => pass,
    limit: pass,
    // Not under test: the audit log is written beside the answer, and a
    // throwing recorder would be a second fault in the same request.
    audit: new Proxy({}, { get: () => () => {} }),
    roles: storeThatFails,
    authStore: storeThatFails,
    shareStore: storeThatFails,
    renderer: storeThatFails,
    ...overrides
  };

  return new Proxy(values, {
    get: (target, name) => (name in target ? target[name] : refusesToAnswer),
    has: () => true
  });
}

/* The routes a router registers, as the router itself knows them.
 *
 * Express keeps one layer per route, each carrying the path it was mounted
 * at and the methods it answers. Reading them is what makes this suite total:
 * a route nobody thought to list is still asked for.
 */
function routesOf(router) {
  return router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) => Object.keys(layer.route.methods)
      .filter((method) => method !== "_all")
      .map((method) => ({ method: method.toUpperCase(), path: layer.route.path })));
}

// A path with its parameters filled in with things that are valid, so the
// request reaches the handler's body rather than one of its refusals.
function addressFor(routePath) {
  return routePath
    .replace("*file", "notes.md")
    .replace("*entry", "20260101000000-abcdef--notes.md")
    .replace(":token", "a".repeat(32))
    .replace(":folderId", "folder-1")
    .replace(":name", "image.png")
    .replace(":id", "1");
}

async function listening(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(null));
  });
  const { port } = /** @type {import("net").AddressInfo} */ (server.address());
  return { origin: `http://127.0.0.1:${port}`, stop: () => new Promise((done) => server.close(done)) };
}

/* One request, with a deadline.
 *
 * The failure this suite is looking for is a request that never answers, and
 * a test that waits for one of those does not fail — it hangs, and takes the
 * whole run with it. So every request carries a ceiling, and running out of
 * it is the answer "nothing came back".
 */
/* The two routes that take a file rather than a document.
 *
 * They are behind multer, which refuses a request with no file in it before
 * the handler runs — so without a real multipart body these are the routes
 * this suite would never actually ask anything of.
 */
const CARRIES_A_FILE = {
  // Each file in a folder upload is accompanied by the path it had on the
  // other machine, and the route refuses a file with no path for it.
  "POST /api/upload/folder": {
    field: "files", name: "notes.md", type: "text/markdown", body: "# A document\n",
    fields: { paths: JSON.stringify(["Folder/notes.md"]) }
  },
  "POST /api/docs/upload": {
    field: "markdownFile", name: "notes.md", type: "text/markdown", body: "# A document\n"
  },
  // Real PNG magic bytes: the store sniffs the file rather than trusting the
  // name or the declared type, so anything else is refused before the disk.
  "POST /api/assets": {
    field: "image", name: "picture.png", type: "image/png",
    body: "\u0089PNG\r\n\u001a\n"
  }
};

function asMultipart({ field, name, type, body, fields = {} }) {
  const boundary = `----faults${Math.random().toString(16).slice(2)}`;
  const parts = [];

  for (const [key, value] of Object.entries(fields)) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`
    ));
  }

  parts.push(
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${name}"\r\n`),
    Buffer.from(`Content-Type: ${type}\r\n\r\n`),
    Buffer.from(body, "binary"),
    Buffer.from(`\r\n--${boundary}--\r\n`)
  );

  return { type: `multipart/form-data; boundary=${boundary}`, body: Buffer.concat(parts) };
}

async function ask(origin, { method, path: routePath }) {
  const stop = AbortSignal.timeout(5000);
  const sendsABody = method === "POST" || method === "PUT" || method === "PATCH";
  const file = CARRIES_A_FILE[`${method} ${routePath}`];

  if (file) {
    const { type, body } = asMultipart(file);
    try {
      const response = await fetch(`${origin}${addressFor(routePath)}`, {
        method, signal: stop, headers: { "Content-Type": type }, body
      });
      return { status: response.status, body: await response.text() };
    } catch (error) {
      return { status: NOTHING_CAME_BACK, body: String(error && error.message) };
    }
  }

  try {
    const response = await fetch(`${origin}${addressFor(routePath)}`, {
      method,
      signal: stop,
      headers: sendsABody ? { "Content-Type": "application/json" } : {},
      // Enough of a body that a reader's own refusals are not what answers.
      body: sendsABody ? JSON.stringify({
        content: "# A document\n",
        fileName: "notes.md",
        name: "A folder",
        mode: "soft",
        username: "someone",
        password: "a-password-that-is-long-enough",
        currentPassword: "a-password-that-is-long-enough",
        newPassword: "another-password-that-is-long",
        role: "reader",
        permissions: { read: true },
        // What the PDF route draws; without it the route has nothing to do
        // and answers before it reaches the renderer.
        html: "<h1>A document</h1>"
      }) : undefined
    });

    return { status: response.status, body: await response.text() };
  } catch (error) {
    return { status: NOTHING_CAME_BACK, body: String(error && error.message) };
  }
}

(async () => {
  /* Each router on an app of its own, under an error handler that records
   * what reached it. The real one renders a page; what matters here is
   * whether the failure arrived at all, and which failure it was.
   */
  for (const [what, factory] of ROUTERS) {
    const router = factory(aLibraryThatWillNotAnswer());

    const reached = [];
    const app = express();
    /* The body reader is mounted in front of every router in server.js, so a
     * router without it refuses for the wrong reason: "username is required"
     * rather than anything about the library.
     */
    app.use(express.json({ limit: "2mb" }));
    app.use(router);
    app.use((error, req, res, _next) => {
      reached.push(error && error.message);
      res.status(500).json({ error: "Something went wrong" });
    });

    const server = await listening(app);
    const routes = routesOf(router);

    console.log(`=== ${what}: ${routes.length} route(s), and a library that will not answer ===`);
    check(`(${what} registers some routes)`, routes.length > 0, true);

    const neverAnswered = [];
    const handedOn = [];
    const refusedFirst = [];
    const keptToItself = [];
    const pretendedToSucceed = [];

    try {
      for (const route of routes) {
        const before = reached.length;
        const answer = await ask(server.origin, route);
        const where = `${route.method} ${route.path}`;

        if (answer.status === NOTHING_CAME_BACK) {
          neverAnswered.push(where);
        } else if (reached.length > before) {
          // The case under test: the failure became an answer by way of the
          // error handler. Whose words it arrives in — the injected fault, or
          // the filesystem's own ENOENT further down — is not the point.
          handedOn.push(`${where} (${reached[reached.length - 1]})`);
        } else if (answer.status >= 200 && answer.status < 300) {
          /* The worst of the three answers: the library failed and the route
           * said it went fine. A person is then told their document was
           * saved, and it was not.
           */
          pretendedToSucceed.push(`${where} answered ${answer.status}`);
        } else if (answer.status >= 400 && answer.status < 500) {
          // A refusal the handler reached before it touched the library: this
          // request never got far enough to be the case under test.
          refusedFirst.push(`${where} refused first with ${answer.status}`);
        } else {
          // Its own 5xx rather than the error handler's. Still an answer, and
          // still an honest one.
          keptToItself.push(`${where} answered ${answer.status} itself`);
        }
      }
    } finally {
      await server.stop();
    }

    console.log(`  (${handedOn.length} handed the failure on, ${refusedFirst.length} refused`
      + ` the request first, ${keptToItself.length} answered it themselves)`);
    for (const one of [...refusedFirst, ...keptToItself, ...pretendedToSucceed]) {
      console.log(`    ${one}`);
    }

    check(`no ${what} route leaves the request hanging`, neverAnswered, []);
    check("...and none of them says a failure went fine", pretendedToSucceed, []);
    check("...and every one of them was asked",
      handedOn.length + refusedFirst.length + keptToItself.length + pretendedToSucceed.length,
      routes.length);
    /* At least one route has to get as far as the library. A router whose
     * every route refuses first is one this suite never actually asked
     * anything of, which is worth knowing rather than reading as a pass.
     */
    check("...with the library reached by at least one of them", handedOn.length > 0, true);
  }

  process.exit(finish());
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
