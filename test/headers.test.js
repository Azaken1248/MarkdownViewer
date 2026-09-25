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
const { createChecker } = require("./helpers/check.js");
const path = require("path");
const fs = require("fs");
const { clientScriptPaths, coreScriptPaths, drawScriptPaths } = require("./app-source.js");

const publicDir = path.join(__dirname, "..", "public");

const { check, finish } = createChecker("HEADER");

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

  console.log("=== the one allowance in the CSP, and the reasons it stays ===");
  {
    /* style-src 'unsafe-inline' is an accepted trade, and this is what keeps
     * it an honest one: the reasons are enumerated and checked, so the day
     * none of them holds this fails and says to take it out. A comment alone
     * is read once; this is read every run.
     */
    check("style-src allows inline styles", /style-src [^;]*'unsafe-inline'/.test(CSP_DIRECTIVES), true);
    check("...and script-src does not, which is the one that would matter",
      /script-src [^;]*'unsafe-inline'/.test(CSP_DIRECTIVES), false);

    // Reason 1: this app's own generated markup carries style attributes
    // whose values come from documents — which no hash or nonce can cover.
    const ownSources = [...new Set([...clientScriptPaths(publicDir), ...coreScriptPaths(publicDir), ...drawScriptPaths(publicDir)])];
    const withStyleAttributes = ownSources.filter((file) => /\bstyle="/.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(publicDir, file));
    check("the app's own drawing writes style attributes into its markup",
      withStyleAttributes.length > 0, true);
    console.log(`  (in ${withStyleAttributes.join(", ")})`);

    // Reasons 2 and 3: the two libraries that inject styles they cannot be
    // told a nonce for are still the ones the engine fetches.
    const lazy = fs.readFileSync(path.join(publicDir, "js", "md", "lazy.js"), "utf8");
    check("KaTeX is still loaded, and sets inline style attributes", /katex/i.test(lazy), true);
    check("Mermaid is still loaded, and injects a <style> into every SVG", /mermaid/i.test(lazy), true);

    // If every one of those three checks stopped being true, the allowance
    // would have no reason left, and this is the check that would say so.
    check("so the allowance still has a reason; when this fails, take it out",
      withStyleAttributes.length > 0 || /katex/i.test(lazy) || /mermaid/i.test(lazy), true);
  }

  console.log("=== the markup this app builds is escaped, and the rule says so ===");
  {
    /* The other half of the CSP bargain. script-src has no 'unsafe-inline',
     * so an injected <script> would not run — but an injected onerror= or a
     * javascript: href would, and those come in through the same hole: a
     * value interpolated into a string that is assigned to innerHTML.
     *
     * There are a hundred of those assignments in this app. What keeps them
     * honest is not care, it is eslint-plugin-no-unsanitized, so this checks
     * that the rule is on, that the escaping helper it points people at
     * actually escapes, and that every place that opts out of the rule says
     * why on the line above.
     */
    const vm = require("vm");

    const config = fs.readFileSync(path.join(__dirname, "..", "eslint.config.js"), "utf8");
    check("the rule is on for the browser's code",
      /"no-unsanitized\/property": \["error"/.test(config), true);
    check("...and for the methods that take markup too",
      /"no-unsanitized\/method": \["error"/.test(config), true);
    check("...with the html tag as the one way past it",
      /taggedTemplates: \["html"\]/.test(config), true);

    // The helper itself, loaded the way the page loads it.
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(publicDir, "js", "dom-html.js"), "utf8"), sandbox);
    const { html, trusted, escapeHtml } = sandbox.DomHtml;

    const attack = '"><script>alert(1)</script>';
    check("an interpolated value cannot close the attribute it is in",
      html`<i class="ph ${attack}"></i>`,
      '<i class="ph &quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"></i>');
    check("...nor open a tag of its own in text",
      html`<p>${"<img src=x onerror=alert(1)>"}</p>`,
      "<p>&lt;img src=x onerror=alert(1)&gt;</p>");
    check("...and a list is built from pieces, each of them escaped",
      html`<ul>${["a<b", "c&d"].map((one) => html`<li>${one}</li>`)}</ul>`,
      "<ul><li>a&lt;b</li><li>c&amp;d</li></ul>");
    check("a conditional that chose nothing writes nothing",
      html`<p>${null}${undefined}${false}</p>`, "<p></p>");
    check("...but zero is a number somebody meant", html`<p>${0}</p>`, "<p>0</p>");
    check("trusted() is the one way to put markup inside markup",
      html`<p>${trusted("<mark>x</mark>")}</p>`, "<p><mark>x</mark></p>");
    check("the escape covers the five characters that matter",
      escapeHtml(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");

    /* And the server escapes with the same one, not a copy of it.
     *
     * lib/http/html.js fills the four templates this app serves — the error
     * page, the share page's unfurl tags, the embed tags — and it used to do
     * that with its own six lines. They had drifted: that copy wrote
     * `String(value || "")`, so 0 and false escaped to nothing, while this one
     * writes `?? ""` and escapes them to their text. It now requires this
     * file, the way lib/docs/paths.js requires doc-kinds.js, and these are the
     * inputs the two used to disagree about.
     */
    const serverEscape = require("../lib/http/html.js").escapeHtml;
    const bothSides = ["<>&\"'", "", "a<b", 0, false, NaN, null, undefined, 42, "0"];
    check("the server escapes with the client's function, not a copy",
      bothSides.map(serverEscape), bothSides.map(escapeHtml));
    check("...so a zero is a zero on both sides of the wire",
      [serverEscape(0), escapeHtml(0)], ["0", "0"]);

    /* Every opt-out is a sentence somebody wrote. The rule can be turned off
     * for a line, which is right for markup that was sanitized somewhere else
     * — but an opt-out with no reason on it is the thing this was meant to
     * stop, so each one has to be preceded by a comment.
     */
    const unexplained = [];
    for (const file of [...new Set(clientScriptPaths(publicDir))]) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (!line.includes("eslint-disable-next-line no-unsanitized")) {
          return;
        }

        const before = (lines[index - 1] || "").trim();
        if (!before.startsWith("//") && !before.startsWith("*")) {
          unexplained.push(`${path.relative(publicDir, file)}:${index + 1}`);
        }
      });
    }

    check("every line that turns the rule off says why", unexplained, []);
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

  process.exit(finish());
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
