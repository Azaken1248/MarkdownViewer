// Authentication, RBAC and share links, against a real server over real HTTP.
//
// Nothing here is mocked: every check goes through the actual routes, the
// actual cookie handling and the actual on-disk stores, because the parts most
// worth testing (a guard that does not run, a cookie without httpOnly, a
// session that survives a password change) only exist at that level.

const fsp = require("fs/promises");
const path = require("path");
const { makeClient } = require("./helpers/client");
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

  // Documents are identified by their path now, so the fixture reports where it
  // actually put each one. alpha.md sits six folders deep; beta.md is unfiled
  // and stays at the top level.
  const ALPHA = server.docPaths["alpha.md"];
  const admin = makeClient(server.origin);

  /* The checks themselves, in three files beside this one.
   *
   * Order matters: the first signs the admin client in, and the two after it
   * work through that session. What they share is handed over rather than
   * reached for.
   */
  const ctx = {
    check, server, anon, admin, ALPHA, fsp, path, makeClient, passwords, excerpt,
    // A few checks below print their own line for each case in a loop, so they
    // need to say a failure happened without going through check().
    fail: () => { failures += 1; }
  };

  await require("./auth/sessions.js")(ctx);
  await require("./auth/library.js")(ctx);
  await require("./auth/pages.js")(ctx);

}
