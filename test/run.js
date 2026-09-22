/* Test runner. Each suite is a standalone script that prints its own checks and
 * exits non-zero on failure, so any one of them can be run directly:
 *
 *   node test/theme.test.js
 *
 * This runs them all and reports which failed.
 *
 *   npm test                       every suite
 *   npm test dom                   one of them
 *   npm test dom -- --only "bin"   print only the checks whose label matches
 *   npm test -- --serial           one at a time, in the order listed below
 *
 * Several at once, because they are separate processes that share nothing: a
 * suite that needs a server starts its own on a free port, against its own
 * temporary state directory. The two longest take about a minute each, and run
 * one after another that was most of the wall clock. Each suite's output is
 * held until it finishes and then printed whole, so the log reads the same as
 * it always did rather than as several suites interleaved.
 */

const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

/** @type {[string, string, string][]} Each suite: what to call it, the file it
 * is, and the line the runner prints above its output. */
const SUITES = [
  ["layout", "layout.test.js", "Shell geometry, scroll ownership and the z-index scale"],
  ["mobile", "mobile.test.js", "Drawer behaviour, touch targets and the dark palette"],
  ["theme", "theme.test.js", "Light/dark tokens, contrast, target size and the print sheet"],
  ["diagrams", "diagrams.test.js", "Mermaid sizing and the per-theme diagram palettes"],
  ["loading", "loading.test.js", "Critical-path budget, lazy libraries and the loading state"],
  ["auth", "auth.test.js", "Passwords, sessions, CSRF, RBAC and share links"],
  ["links", "links.test.js", "Saved links: SSRF refusals, metadata parsing, storage and RBAC"],
  ["assets", "assets.test.js", "Pasted images: type and size limits, RBAC, dedupe and share scoping"],
  ["code", "code.test.js", "Code blocks: copy buttons, the clipboard paths and live highlighting"],
  ["audit", "audit.test.js", "The security events are written down, and the log holds nothing worth stealing"],
  ["headers", "headers.test.js", "The headers on every response, and HSTS only where the deployment is HTTPS"],
  ["graphql", "graphql.test.js", "The graph: behind the read policy, says what /api says, and has limits"],
  ["limiter", "limiter.test.js", "Rate limits: the arithmetic, the bounded map, and the buckets as mounted"],
  ["doc-kinds", "doc-kinds.test.js", "What a document is: one list, loaded by the server and the client alike"],
  ["search", "search.test.js", "The search index: agrees with the scan, keeps up with the disk"],
  ["recycle", "recycle.test.js", "The recycle bin and the archive: the way out of the library and back"],
  ["db", "db.test.js", "The metadata database: three processes at once, the JSON import, sessions"],
  ["build", "build.test.js", "The optional bundles, and that they are the same app unbundled"],
  ["visual", "visual.test.js", "The visual editor: block round trip, classification, serialization"],
  ["dom", "dom.test.js", "The real app in jsdom against a real server"],
  ["diagram-page", "diagram-page.test.js", "The diagram editor page, its address and the document handoff"]
];

const args = process.argv.slice(2);
const serial = args.includes("--serial");
const only = args.find((arg) => !arg.startsWith("-"));

/* `npm test dom -- --only "the bin"` narrows what is printed to the checks
 * whose label matches, which is what to reach for when a suite prints five
 * hundred lines and one of them is the one being worked on. Everything still
 * runs: these suites are sessions, not independent cases, and a check three
 * hundred lines in stands on what the ones before it left behind.
 */
const onlyAt = args.indexOf("--only");
const onlyChecks = onlyAt >= 0 ? args[onlyAt + 1] : "";
const selected = only ? SUITES.filter(([name]) => name === only) : SUITES;

if (selected.length === 0) {
  console.error(`Unknown suite "${only}". Available: ${SUITES.map(([n]) => n).join(", ")}`);
  process.exit(1);
}

/* How many at once.
 *
 * Most of these suites are waiting on a server they started rather than on a
 * core, so one per core is a floor and not a ceiling — but a machine with two
 * cores running six jsdom suites at once is a machine where a suite waiting on
 * a real timeout starts to look flaky. So: cores, within reason.
 */
const LANES = serial ? 1 : Math.max(2, Math.min(6, os.cpus().length));

/* A suite killed by this clock looks exactly like a suite whose checks failed
 * — no status, no output of its own, and a runner that says only which it was.
 * So it says which it was, below.
 *
 * Generously long, because an hour was once spent looking for a broken check
 * that was only a slow machine. The two longest suites take about a minute
 * here, so this is a runner five times slower than this one before anything is
 * cut off.
 */
const SUITE_TIMEOUT_MS = 300000;

function runSuite([name, file, description]) {
  return new Promise((resolve) => {
    const began = Date.now();
    const chunks = [];
    const child = spawn(process.execPath, [path.join(__dirname, file)], {
      stdio: ["ignore", "pipe", "pipe"],
      env: onlyChecks ? { ...process.env, TEST_ONLY: onlyChecks } : process.env
    });

    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));

    const timer = setTimeout(() => child.kill("SIGKILL"), SUITE_TIMEOUT_MS);
    let failure = null;

    child.on("error", (error) => {
      failure = `could not be started: ${error.message}`;
    });

    child.on("close", (status, signal) => {
      clearTimeout(timer);
      const seconds = ((Date.now() - began) / 1000).toFixed(1);
      const cutOff = status === null || signal !== null;

      const lines = [
        `\n${"=".repeat(72)}`,
        `${name}  —  ${description}  (${seconds}s)`,
        "=".repeat(72),
        Buffer.concat(chunks).toString().replace(/\n$/, "")
      ];

      if (cutOff) {
        lines.push(`\n${name} was cut off after ${seconds}s — ${signal || "no exit status"}. `
          + "This is the runner's own clock, not a failing check.");
      } else if (failure) {
        lines.push(`\n${name} ${failure}`);
      }

      console.log(lines.join("\n"));
      resolve(status === 0 && !failure);
    });
  });
}

(async () => {
  const started = Date.now();
  const queue = [...selected];
  const failed = [];

  // One worker per lane, each taking the next suite off the queue. The longest
  // suites are last in the list, which is the wrong order for this, so the
  // queue is walked from both ends: a lane that frees up early picks up a long
  // one rather than leaving it until there is nothing to overlap it with.
  const lanes = Array.from({ length: Math.min(LANES, queue.length) }, async (_, lane) => {
    while (queue.length > 0) {
      const suite = lane % 2 === 0 ? queue.pop() : queue.shift();
      if (!(await runSuite(suite))) {
        failed.push(suite[0]);
      }
    }
  });

  await Promise.all(lanes);

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n${"=".repeat(72)}`);

  if (failed.length === 0) {
    console.log(`All ${selected.length} suite(s) passed in ${seconds}s.`);
    process.exit(0);
  }

  // In the order they are listed, not the order they finished, so a failing
  // run reads the same however the lanes happened to fall.
  const order = SUITES.map(([name]) => name);
  failed.sort((a, b) => order.indexOf(a) - order.indexOf(b));

  console.log(`${failed.length} of ${selected.length} suite(s) FAILED in ${seconds}s: ${failed.join(", ")}`);
  process.exit(1);
})();
