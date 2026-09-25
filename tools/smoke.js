#!/usr/bin/env node
/* Is this deployment actually serving?
 *
 * The suites prove the code is right against a server they start themselves.
 * This asks a different question of a server somebody else started: that it
 * booted, that the pages come back, and — the part nothing else checked —
 * that every asset the HTML asks for is actually there at the address it asks
 * for it at.
 *
 * That last one has bitten this project before. The pages name a file and
 * lib/http/asset-versions.js stamps a hash of that file into the URL on the
 * way out, so a page and its assets cannot disagree about a version. What
 * nothing verified was the other half: that the stamped URL resolves. A
 * mis-stamped or unbuilt asset is a page that loads and does nothing, and it
 * is invisible to a health check.
 *
 *   node tools/smoke.js http://127.0.0.1:4321
 *
 * Run against the production-mode boot in CI, and by the `production` suite
 * against a server it starts with NODE_ENV=production.
 */

function report(results) {
  let failed = 0;
  for (const { ok, label, detail } of results) {
    failed += ok ? 0 : 1;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  }

  return failed;
}

async function get(origin, pathname, options = {}) {
  const response = await fetch(new URL(pathname, origin), { redirect: "manual", ...options });
  return { status: response.status, headers: response.headers, body: await response.text() };
}

/* Every asset the page asks for, at the address it asks for it at.
 *
 * Taken out of the served HTML rather than off disk, because the stamp is
 * applied as the page is written and the whole question is whether what was
 * written resolves.
 */
function assetsIn(html) {
  return [...html.matchAll(/\s(?:src|href)="(\/(?:css|js|build)\/[^"]+)"/g)]
    .map(([, url]) => url)
    .filter((url, index, all) => all.indexOf(url) === index);
}

async function checkPage(origin, pathname, wanted, results) {
  const page = await get(origin, pathname, { headers: { Accept: "text/html" } });
  results.push({
    ok: page.status === wanted,
    label: `${pathname} answers ${wanted}`,
    detail: page.status === wanted ? "" : `status ${page.status}`
  });

  if (page.status !== wanted) {
    return page;
  }

  const assets = assetsIn(page.body);
  results.push({
    ok: assets.length > 0,
    label: `...and names assets`,
    detail: `${assets.length} of them`
  });

  const stamped = assets.filter((url) => /\?v=[^&"]+/.test(url));
  results.push({
    ok: stamped.length === assets.length,
    label: "...every one of them stamped with its version",
    detail: stamped.length === assets.length
      ? ""
      : `unstamped: ${assets.filter((url) => !stamped.includes(url)).join(", ")}`
  });

  const missing = [];
  for (const url of assets) {
    const asset = await get(origin, url);
    if (asset.status !== 200) {
      missing.push(`${url} (${asset.status})`);
    }
  }

  results.push({
    ok: missing.length === 0,
    label: "...and every one of them is actually served at that address",
    detail: missing.join(", ")
  });

  return page;
}

/* Every check, as data.
 *
 * Returned rather than printed so the `production` suite can run the same
 * ones against a server it starts itself and report them as its own checks,
 * instead of keeping a second copy that drifts from this one.
 */
async function smoke(origin) {
  const results = [];

  const health = await get(origin, "/healthz");
  let healthy = false;
  try {
    healthy = JSON.parse(health.body).status === "ok";
  } catch {
    healthy = false;
  }

  results.push({
    ok: health.status === 200 && healthy,
    label: "/healthz says storage is readable",
    detail: health.status === 200 ? "" : `status ${health.status}`
  });

  /* The app shell, and the error page, which is a page with its own
   * stylesheet and its own chance to reference an asset that is not there.
   *
   * /diagram is the error page's address here because it is a reserved prefix
   * with no route of its own: every other path that is not reserved is handed
   * the shell with a 200, on purpose, so the client can route it and say
   * itself that the document is missing.
   */
  await checkPage(origin, "/", 200, results);
  const errorPage = await checkPage(origin, "/diagram", 404, results);

  // The headers that make the rest of the app's defences work. If the CSP is
  // missing, every other thing this project does about injected markup is
  // being done without its backstop.
  const page = await get(origin, "/");

  /** @type {[string, RegExp][]} */
  const HEADERS = [
    ["content-security-policy", /script-src/],
    ["x-content-type-options", /nosniff/],
    ["referrer-policy", /./],
    ["x-request-id", /^[A-Za-z0-9_.:-]+$/]
  ];

  for (const [header, wanted] of HEADERS) {
    const value = page.headers.get(header) || "";
    results.push({
      ok: wanted.test(value),
      label: `every response carries ${header}`,
      detail: value ? "" : "missing"
    });
  }

  /* A 404 is the app's own error page, not Express's.
   *
   * Express's default handler prints a stack trace, and the whole point of
   * booting with NODE_ENV=production is that the difference between the two
   * shows up here rather than on a deployment.
   */
  const leaked = /at \S+ \(.*:\d+:\d+\)|node_modules\/|ENOENT|\bError:/;
  results.push({
    ok: !leaked.test(errorPage?.body || ""),
    label: "...and the 404 page carries no stack trace",
    detail: ""
  });

  // And a client that asked for JSON is given JSON, not a web page.
  const api = await get(origin, "/api/definitely-not-a-route");
  let json = null;
  try {
    json = JSON.parse(api.body);
  } catch {
    json = null;
  }

  results.push({
    ok: api.status === 404 && typeof json?.error === "string",
    label: "an unknown /api route answers 404 as JSON",
    detail: api.status === 404 ? "" : `status ${api.status}`
  });
  results.push({
    ok: !leaked.test(api.body),
    label: "...also without one",
    detail: ""
  });

  return results;
}

async function main(origin) {
  console.log(`=== ${origin} ===`);
  const results = await smoke(origin);
  const failed = report(results);

  console.log(failed === 0
    ? `\n${results.length} checks passed.`
    : `\n${failed} of ${results.length} checks FAILED.`);
  return failed === 0 ? 0 : 1;
}

module.exports = { smoke };

if (require.main === module) {
  const origin = process.argv[2];
  if (!origin) {
    console.error("usage: node tools/smoke.js <origin>");
    process.exit(2);
  }

  main(origin).then((code) => process.exit(code)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
