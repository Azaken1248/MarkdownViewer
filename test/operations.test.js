/* The deployment documentation, checked against the thing it describes.
 *
 * A Dockerfile and a page of operations notes are the two files in this
 * repository nobody runs, so they are the two that rot without anybody
 * noticing — and they are read by somebody at 2am who has no way to tell that
 * the variable they are setting was renamed a year ago.
 *
 * So the parts that can be checked are: every environment variable the code
 * reads is in the README's table, the paths the Dockerfile promises are the
 * paths the server actually uses, and the operations page names them too.
 */

const fs = require("fs");
const path = require("path");
const { createChecker } = require("./helpers/check.js");

const { check, finish } = createChecker("OPERATIONS");
const ROOT = path.join(__dirname, "..");

const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

const dockerfile = read("Dockerfile");
const dockerignore = read(".dockerignore");
const operations = read("docs", "OPERATIONS.md");
const readme = read("README.md");
const compose = read("docker-compose.yml");

/* Every variable the code reads, from the code.
 *
 * TEST_ONLY is the suite runner's own (`npm test dom -- --only …`) and is not
 * a deployment setting, so it is the one exclusion and it is named here rather
 * than filtered by a pattern that could quietly grow.
 */
const NOT_A_SETTING = new Set(["TEST_ONLY"]);

function variablesUsedIn(dir) {
  const found = new Set();
  const walk = (at) => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".js")) {
        for (const [, name] of fs.readFileSync(full, "utf8").matchAll(/process\.env\.([A-Z_0-9]+)/g)) {
          if (!NOT_A_SETTING.has(name)) {
            found.add(name);
          }
        }
      }
    }
  };

  walk(path.join(ROOT, dir));
  return found;
}

console.log("=== every setting the code reads is written down ===");

const used = new Set([
  ...variablesUsedIn("lib"),
  ...[...read("server.js").matchAll(/process\.env\.([A-Z_0-9]+)/g)].map(([, name]) => name)
].filter((name) => !NOT_A_SETTING.has(name)));

const undocumented = [...used].filter((name) => !readme.includes(`\`${name}\``)).sort();
check("the README's table names all of them", undocumented, []);

/* The other direction: a row for a variable nothing reads any more is worse
 * than no row, because somebody will set it and believe it did something.
 *
 * Scoped to the Configuration section, because the README has other tables
 * with capitalised words in backticks in the first column — the rate limits
 * are listed by method.
 */
const configuration = readme.slice(readme.indexOf("## Configuration"));
const table = [...configuration.slice(0, configuration.indexOf("\n### "))
  .matchAll(/^\| `([A-Z_0-9]+)` \|/gm)].map(([, name]) => name);
check("(the table was found)", table.length > 5, true);
const stale = table.filter((name) => !used.has(name)).sort();
check("...and names nothing it does not read", stale, []);

console.log("=== the image promises what the server actually does ===");

const server = read("server.js");

check("the Dockerfile sets the state directory the server reads",
  dockerfile.includes("MDVIEWER_STATE_DIR=/state"), true);
check("...and the volume is that directory", dockerfile.includes('VOLUME ["/state"]'), true);
check("...and the port it exposes is the port the server defaults to",
  dockerfile.includes("EXPOSE 4321") && server.includes("process.env.PORT || 4321"), true);
check("it runs as a user, not as root", /^USER (?!root)\w+/m.test(dockerfile), true);
check("...the one the operations page names", dockerfile.includes("USER node")
  && operations.includes("uid 1000 (`node`"), true);

/* The healthcheck has to call something that exists and means something. The
 * GraphQL `health` field returns a constant and would say "fine" with the
 * volume unmounted; /healthz reads the document directory.
 */
check("the healthcheck asks /healthz", dockerfile.includes("/healthz"), true);
check("...which is a route", read("lib", "routes", "meta.js").includes('router.get("/healthz"'), true);
check("...and answers 503 when storage is not readable",
  read("lib", "routes", "meta.js").includes("res.status(503)"), true);

console.log("=== and the image carries nothing it should not ===");

// State and working documents. An image is pushed somewhere; these are the
// entries whose absence is the point rather than a size optimisation.
for (const kept of ["data", "assets", "deleted_markdowns", "REVIEW-*.md", ".git", "node_modules"]) {
  check(`.dockerignore excludes ${kept}`, dockerignore.includes(kept), true);
}

console.log("=== the operations page is about this deployment ===");

check("it names the state directory the image uses", operations.includes("/state"), true);
check("...the documents directory the server writes to",
  operations.includes("`docs/`") && server.includes('path.join(STATE_DIR, "docs")'), true);
check("...and the database file that is actually there",
  operations.includes("azadocs.db"), true);
check("it explains what PUBLIC_BASE_URL decides",
  /PUBLIC_BASE_URL.{0,400}Secure/s.test(operations), true);
check("...and what TRUST_PROXY decides", /TRUST_PROXY.{0,400}req\.ip/s.test(operations), true);

// The claim that TRUST_PROXY no longer gates CSRF is only worth making while
// it stays true.
check("...and that the CSRF check no longer depends on it",
  read("lib", "guards.js").includes("used to be compared against the request's own idea"), true);

check("the README points at it", readme.includes("docs/OPERATIONS.md"), true);

/* And the backup section describes commands that exist.
 *
 * The state directory is what nothing else takes responsibility for, so a
 * backup page naming a script that was renamed is worse than no page.
 */
const scripts = JSON.parse(read("package.json")).scripts;
check("the backup command it names is a script", Boolean(scripts.backup), true);
check("...and so is the restore", Boolean(scripts.restore), true);
check("...and both files are there",
  [fs.existsSync(path.join(ROOT, "tools", "backup.js")),
    fs.existsSync(path.join(ROOT, "tools", "restore.js"))], [true, true]);
check("it says the restore is tested rather than asserted",
  operations.includes("npm test restore"), true);
check("...and that suite is one the runner runs",
  read("test", "run.js").includes('"restore.test.js"'), true);

console.log("=== the repository says who may use it, and how to report a hole ===");

const license = read("LICENSE");
check("there is a licence", license.includes("MIT License"), true);
check("...naming a copyright holder", /Copyright \(c\) \d{4} \S/.test(license), true);
check("...and requiring the notice to travel with the code",
  license.includes("shall be included in all"), true);
check("package.json agrees with it", JSON.parse(read("package.json")).license, "MIT");
check("...and the README says the same", /## License[\s\S]{0,200}MIT/.test(readme), true);

const security = read("SECURITY.md");
check("there is a way to report a vulnerability privately",
  security.includes("Report a vulnerability"), true);
check("...that says not to open a public issue", /do not open a public issue/i.test(security), true);
check("the README points at it", readme.includes("SECURITY.md"), true);

/* The contributing guide is the one that rots quietest: it describes commands
 * and conventions, and nothing breaks when it stops being true. So the parts
 * of it that can be checked are.
 */
const contributing = read("CONTRIBUTING.md");
for (const script of ["npm test", "npm run lint", "npm run typecheck"]) {
  check(`CONTRIBUTING names \`${script}\`, which exists`,
    contributing.includes(script)
    && Boolean(scripts[script.replace(/^npm (run )?/, "")]), true);
}

check("...and the zero budget it describes is the budget",
  contributing.includes("budget for those warnings is **zero**")
  && read("test", "limits.test.js").includes('complexity: 0'), true);
check("...and the escaping helper it points at is where it says",
  contributing.includes("public/js/dom-html.js")
  && fs.existsSync(path.join(ROOT, "public", "js", "dom-html.js")), true);
check("...and the history really has no attribution trailers, as it claims",
  contributing.includes("No attribution trailers"), true);

console.log("=== the pipeline is pinned, bounded, and boots what gets deployed ===");

/* The workflow is the one file here that nothing else runs, so a claim in it
 * is checked by being merged rather than by being true. These are the parts
 * that can be read without a runner.
 */
const workflow = read(".github", "workflows", "ci.yml");

// A tag is mutable: actions/checkout@v4 is whatever that tag points at today,
// and "pin your actions" means pin to something that cannot move.
const uses = [...workflow.matchAll(/uses:\s*(\S+)/g)].map(([, one]) => one);
check("(the workflow uses some actions)", uses.length > 0, true);
check("every action is pinned to a commit, not to a tag",
  uses.filter((one) => !/@[0-9a-f]{40}$/.test(one)), []);
check("...each with the version it is, in a comment beside it",
  uses.every((one) => new RegExp(`${one}\\s*#\\s*v\\d`).test(workflow)), true);

check("a second push does not run a second pipeline against the same branch",
  /concurrency:[\s\S]{0,200}cancel-in-progress:\s*true/.test(workflow), true);
check("...and a hung run cannot burn the six-hour default",
  (workflow.match(/timeout-minutes:/g) || []).length >= 2, true);
check("...and the token is not granted more than is used",
  /permissions:\s*\n\s*contents:\s*read/.test(workflow), true);

/* The boot check exists to catch "it passes its tests and will not start".
 * Under NODE_ENV=production, because that is the mode a deployment runs in
 * and Express does not behave the same way under it.
 */
check("CI boots the server the way a deployment runs it",
  /NODE_ENV=production/.test(workflow), true);
check("...and asks it for more than a health check",
  workflow.includes("tools/smoke.js"), true);
check("...which is a tool that exists and a script that names it",
  fs.existsSync(path.join(ROOT, "tools", "smoke.js")) && Boolean(scripts.smoke), true);
check("...and the same checks run in the suite, not a second copy of them",
  read("test", "production.test.js").includes('require("../tools/smoke.js")'), true);

console.log("=== and every document it points at exists ===");

// A README full of links to pages that were renamed is worse than a long
// README, because the reader finds out one click at a time.
const pages = ["README.md", "CONTRIBUTING.md", "SECURITY.md",
  "docs/USAGE.md", "docs/OPERATIONS.md", "docs/ARCHITECTURE.md",
  "docs/API.md", "docs/TESTING.md"];

const broken = [];
for (const page of pages) {
  // Code spans and fenced blocks first: `![alt](/api/assets/…)` is an example
  // of markdown, not a link to anywhere.
  const body = read(...page.split("/"))
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]*`/g, "");
  const from = path.dirname(path.join(ROOT, page));
  for (const [, target] of body.matchAll(/\]\((?!https?:|#|mailto:)([^)#]+)(?:#[^)]*)?\)/g)) {
    if (!fs.existsSync(path.resolve(from, target))) {
      broken.push(`${page} -> ${target}`);
    }
  }
}

check("no link in the documentation points at a file that is not there", broken, []);
check("(and there was something to check)", pages.every((page) =>
  fs.existsSync(path.join(ROOT, page))), true);

/* And `docker compose up -d`, which the page opens with, has something to
 * run. A worked example in prose is a worked example somebody retypes wrong.
 */
check("the compose file it tells you to run exists", compose.includes("services:"), true);
check("...mounts the volume at the directory the image uses",
  compose.includes("state:/state"), true);
check("...and does not quietly expose the port to the world",
  compose.includes('"127.0.0.1:4321:4321"'), true);

process.exit(finish());
