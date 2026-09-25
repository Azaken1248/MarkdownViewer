/* The boot nobody was doing: NODE_ENV=production, and the assets it serves.
 *
 * Everything else in this suite starts a server to exercise the code. This
 * one asks whether a deployment works — which is a different question, and
 * the one the answer "all tests pass" does not cover. Two things in
 * particular:
 *
 *   - Express behaves differently under NODE_ENV=production: different error
 *     rendering, different view caching. CI booted without it, so the mode
 *     the real deployment runs in was the one mode nothing ever started.
 *
 *   - The pages name their assets and lib/http/asset-versions.js stamps a
 *     hash of each file into the URL on the way out, so a page and its assets
 *     cannot disagree about a version. Nothing checked the other half: that
 *     the stamped URL resolves. A mis-stamped or unbuilt asset is a page that
 *     loads and does nothing, and a health check cannot see it.
 *
 * The checks themselves live in tools/smoke.js, so the same ones run here and
 * against the production-mode boot in CI rather than being written twice.
 */

const { startTestServer } = require("./helpers/server.js");
const { smoke } = require("../tools/smoke.js");
const { createChecker } = require("./helpers/check.js");

const { check, finish } = createChecker("PRODUCTION");

(async () => {
  // The mode the deployment runs in, which is the point of the suite.
  const server = await startTestServer({ env: { NODE_ENV: "production" } });

  try {
    console.log("=== a production-mode boot serves what its pages ask for ===");

    const results = await smoke(server.origin);
    check("(there were checks to run)", results.length > 10, true);

    for (const { ok, label, detail } of results) {
      check(detail && !ok ? `${label} (${detail})` : label, ok, true);
    }
  } finally {
    await server.stop();
  }

  process.exit(finish());
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
