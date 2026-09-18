/* The headers every response carries — every response, which is the point.
 *
 * A policy that covers the pages somebody remembered to cover is not a
 * policy, so this asks for the shell, a document address, an API answer, a
 * static file, a compressed one, a 404 and a 401, and requires the same set
 * on each. Then the one header that depends on how the app is deployed:
 * HSTS goes out from a server whose public origin is HTTPS and not from one
 * whose origin is plain HTTP, because a plain-HTTP box that sends HSTS has
 * told the browser never to come back the way it can.
 */

const { startTestServer, SEED_USERNAME, SEED_PASSWORD } = require("./helpers/server");
const { CSP_DIRECTIVES, PERMISSIONS_POLICY, HSTS } = require("../lib/http/headers");

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

const EXPECTED = {
  "content-security-policy": CSP_DIRECTIVES,
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "SAMEORIGIN",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": PERMISSIONS_POLICY
};

function carried(headers) {
  return Object.fromEntries(Object.keys(EXPECTED).map((name) => [name, headers[name]]));
}

(async () => {
  console.log("=== every response, on a deployment reached over HTTPS ===");
  const secure = await startTestServer({ env: { PUBLIC_BASE_URL: "https://docs.example.test" } });
  try {
    const login = await secure.request("POST", "/api/auth/login", { username: SEED_USERNAME, password: SEED_PASSWORD });
    const cookie = login.headers["set-cookie"].map((c) => c.split(";")[0]).join("; ");

    const answers = [
      ["the app shell", await secure.request("GET", "/", undefined, { Accept: "text/html" })],
      ["a document address", await secure.request("GET", "/Notes/anything.md", undefined, { Accept: "text/html" })],
      ["an API answer", await secure.request("GET", "/api/session", undefined, { Cookie: cookie })],
      ["a refused API call", await secure.request("GET", "/api/docs")],
      ["a stylesheet", await secure.request("GET", "/css/app/tokens.css")],
      ["a script, compressed", await secure.request("GET", "/js/app.js", undefined, { "Accept-Encoding": "br" })],
      ["the health check", await secure.request("GET", "/healthz")],
      ["a 404 page", await secure.request("GET", "/no/such/thing", undefined, { Accept: "text/html" })]
    ];

    for (const [what, res] of answers) {
      check(`${what} carries the set`, carried(res.headers), EXPECTED);
    }

    check("the CSP keeps frame-ancestors, which X-Frame-Options is the fallback for",
      CSP_DIRECTIVES.includes("frame-ancestors 'self'"), true);
    check("nothing here may ask for a camera, a microphone, a location, a device or a payment",
      ["camera=()", "microphone=()", "geolocation=()", "usb=()", "payment=()"].every((p) => PERMISSIONS_POLICY.includes(p)), true);

    console.log("=== HSTS, only where it is true ===");
    for (const [what, res] of answers) {
      check(`${what} says to stay on HTTPS`, res.headers["strict-transport-security"], HSTS);
    }
    check("for a year, and the subdomains too", HSTS, "max-age=31536000; includeSubDomains");
    check("...and does not preload, which is a decision to make on purpose", HSTS.includes("preload"), false);
    check("the session cookie is Secure on the same deployment",
      /;\s*Secure/i.test(login.headers["set-cookie"].join(";")), true);
  } finally {
    await secure.stop();
  }

  console.log("=== and not on a deployment that is plain HTTP ===");
  const plain = await startTestServer({ env: { PUBLIC_BASE_URL: "http://localhost:4321" } });
  try {
    const res = await plain.request("GET", "/healthz");
    check("a plain-HTTP server does not pin the browser to HTTPS",
      res.headers["strict-transport-security"], undefined);
    check("...but carries everything else", carried(res.headers), EXPECTED);
    const login = await plain.request("POST", "/api/auth/login", { username: SEED_USERNAME, password: SEED_PASSWORD });
    check("...and its cookie is not marked Secure, or the browser would drop it",
      /;\s*Secure/i.test(login.headers["set-cookie"].join(";")), false);
  } finally {
    await plain.stop();
  }

  console.log(failures === 0 ? "\nALL HEADER CHECKS PASSED" : `\n${failures} HEADER CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
