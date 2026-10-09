#!/usr/bin/env node
/* How many people can use this at once?
 *
 * The suites prove the code is right. `tools/smoke.js` proves a deployment is
 * serving. Neither asks what happens when more than one person asks at the
 * same time, and nothing here ever has: this is a single process on a single
 * event loop, and the two things most likely to block it are the two things it
 * does most — searching, and reading documents.
 *
 * It matters here because of a specific shape. docs/ARCHITECTURE.md says the
 * FTS5 index means "a query used to read every document in the library to find
 * out which ones matched; it now asks the index and reads none". That is very
 * probably true. Nothing had measured either number.
 *
 *   node tools/load.js                       against a server it starts, 60 documents
 *   node tools/load.js --corpus 1000         ...and a thousand of them
 *   node tools/load.js --origin http://host:4321 --cookie "mdv_session=…"
 *
 * Four scenarios, because they stress different things:
 *
 *   shell      the floor — the page itself, which reads a file and stamps it
 *   listing    /api/docs, which reads the organizer and the directory
 *   search     the one that used to be O(corpus)
 *   document   a read, which is the content cache hot and the disk cold
 *
 * Each connection is a different signed-in session, which is what "how many
 * people" means and is also most of what it takes to measure the app rather
 * than its rate limiter.
 *
 * Searching is the exception and is measured differently on purpose. It is
 * capped at 240 a minute *per session*, so throughput is not a fact about the
 * search index — it is the cap, and the first version of this file duly
 * reported 1194 req/s of which 4537 requests out of 4777 were 429s. What is
 * worth knowing about search is what one costs, so it is paced to stay inside
 * the ceiling and only its latency is reported. That is also the number the
 * claim in docs/ARCHITECTURE.md is about: a search should not get slower as
 * the library grows.
 *
 * /healthz is not one of the scenarios for a related reason and without a way
 * around it: it is capped at sixty a minute by address, and every connection
 * here comes from one address. That cap is correct — a monitor polling every
 * ten seconds uses a tenth of it — and it makes /healthz unmeasurable from a
 * single machine. The shell page is the floor instead; nothing rate-limits it.
 *
 * The numbers this prints go in docs/OPERATIONS.md with the machine named.
 * They are not a promise. They are the answer to a question that currently has
 * none, and a slow answer is worth more than no answer.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");

// Long enough that a slow scenario settles, short enough that four of them
// plus two corpora is minutes rather than an afternoon.
const SECONDS = 10;
const CONNECTIONS = 10;

/* The seeded admin's password when this starts its own server.
 *
 * Public by construction, as in the suites: the point is a library to measure
 * against, and it lives in a temporary directory that is deleted afterwards.
 */
const SEED_USERNAME = "aza";
const SEED_PASSWORD = "load-harness-9134";

function parseArguments(argv) {
  const args = { corpus: 60, origin: "", cookie: "", seconds: SECONDS, connections: CONNECTIONS };

  for (let at = 0; at < argv.length; at += 1) {
    const flag = argv[at];
    const value = argv[at + 1];

    if (flag === "--corpus") args.corpus = Number(value);
    else if (flag === "--origin") args.origin = String(value || "");
    else if (flag === "--cookie") args.cookie = String(value || "");
    else if (flag === "--seconds") args.seconds = Number(value);
    else if (flag === "--connections") args.connections = Number(value);
  }

  return args;
}

/* --- A library to measure against ---------------------------------------- */

/* Documents of a realistic size and shape, written straight to disk.
 *
 * The server reads its library from the directory, so seeding is writing
 * files. The text matters: a corpus of identical documents would make the
 * index's job easier than a real library does, and the search scenario below
 * looks for a word that is in roughly a tenth of them.
 */
const WORDS = ("the quick brown fox jumps over a lazy dog while the cart frontend renders "
  + "every component in the design tokens package and the team reviews it before merging")
  .split(" ");

function documentText(index) {
  const lines = [`# Document ${index}`, ""];

  for (let paragraph = 0; paragraph < 12; paragraph += 1) {
    const words = [];
    for (let word = 0; word < 40; word += 1) {
      words.push(WORDS[(index * 7 + paragraph * 13 + word * 3) % WORDS.length]);
    }

    // One document in ten mentions the needle the search scenario looks for.
    if (paragraph === 0 && index % 10 === 0) {
      words.push("nightingale");
    }

    lines.push(words.join(" "), "");
  }

  return lines.join("\n");
}

async function seed(stateDir, count) {
  const docsDir = path.join(stateDir, "docs");
  fs.mkdirSync(docsDir, { recursive: true });
  fs.mkdirSync(path.join(stateDir, "data"), { recursive: true });

  for (let index = 0; index < count; index += 1) {
    fs.writeFileSync(path.join(docsDir, `document-${String(index).padStart(4, "0")}.md`),
      documentText(index));
  }

  return `document-${String(Math.floor(count / 2)).padStart(4, "0")}.md`;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = /** @type {any} */ (probe.address());
      probe.close(() => resolve(port));
    });
  });
}

async function startServer(stateDir) {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;

  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      MDVIEWER_STATE_DIR: stateDir,
      SEED_ADMIN_PASSWORD: SEED_PASSWORD,
      LOG_REQUESTS: "false",
      // Measuring the app, not the logger. Everything else is as deployed.
      LOG_LEVEL: "error"
    },
    stdio: ["ignore", "ignore", "inherit"]
  });

  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      const response = await fetch(`${origin}/healthz`);
      if (response.ok) break;
    } catch {
      // Not up yet.
    }

    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error("the server did not become healthy");
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return { origin, stop: () => child.kill("SIGTERM") };
}

/* Signed in, because every scenario but the shell page is behind a session.
 *
 * The seeded admin has to replace its password before it may do anything,
 * which is the app working as intended and is two requests rather than one.
 * After that this signs in again, once per connection, so each one is its own
 * session — see the note at the top about what measuring one session gets you.
 */
async function signIn(origin, password = SEED_PASSWORD) {
  const first = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: SEED_USERNAME, password })
  });

  const cookie = String(first.headers.get("set-cookie") || "").split(";")[0];
  const session = await first.json();

  if (session?.user?.mustChangePassword) {
    const changed = await fetch(`${origin}/api/auth/password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrfToken,
        Cookie: cookie
      },
      body: JSON.stringify({ currentPassword: SEED_PASSWORD, newPassword: `${SEED_PASSWORD}-own` })
    });

    const after = String(changed.headers.get("set-cookie") || "").split(";")[0];
    return after || cookie;
  }

  return cookie;
}

/* --- The measuring -------------------------------------------------------- */

/* How many searches a second this may ask for, per session.
 *
 * The deployment allows 240 a minute, which is four a second. Two leaves room
 * for the run's own jitter and for the minute it shares with whatever ran just
 * before it — the window is a minute, so two runs back to back are one window.
 * A burst that trips the limiter turns the measurement into a measurement of
 * the limiter, which is why the report below refuses to stay quiet about a
 * single 429.
 */
const SEARCHES_PER_SESSION_PER_SECOND = 2;

function scenarios(document, sessions) {
  return [
    { name: "shell", path: "/", what: "the floor: the page itself" },
    { name: "listing", path: "/api/docs", what: "the organizer and the directory" },
    {
      name: "search",
      path: "/api/docs/search?q=nightingale",
      what: "the one that used to read every document",
      // Paced, so what comes back is what a search costs rather than what the
      // limiter allows. Throughput here would be this number and nothing else.
      rate: Math.max(1, sessions) * SEARCHES_PER_SESSION_PER_SECOND
    },
    {
      name: "document",
      path: `/api/docs/${encodeURIComponent(document)}`,
      what: "a read, through the content cache"
    }
  ];
}

/* One request per session, cycled across the connections.
 *
 * autocannon walks this array, so with as many entries as connections each
 * connection carries a different cookie — which is what makes this N people
 * rather than one person going very fast.
 */
async function measure(autocannon, origin, scenario, cookies, args) {
  const result = await autocannon({
    url: `${origin}${scenario.path}`,
    connections: args.connections,
    duration: args.seconds,
    ...(scenario.rate ? { overallRate: scenario.rate } : {}),
    requests: cookies.length
      ? cookies.map((cookie) => ({ path: scenario.path, headers: { Cookie: cookie } }))
      : [{ path: scenario.path }]
  });

  return {
    name: scenario.name,
    what: scenario.what,
    paced: Boolean(scenario.rate),
    perSecond: Math.round(result.requests.average),
    p50: result.latency.p50,
    p95: result.latency.p97_5,
    max: result.latency.max,
    non2xx: result.non2xx || 0
  };
}

function print(corpus, rows) {
  console.log(`\n=== ${corpus} documents ===\n`);
  console.log("| Scenario | req/s | p50 | p97.5 | max |");
  console.log("| --- | --- | --- | --- | --- |");
  for (const row of rows) {
    // A paced scenario's throughput is the pace, so it says so rather than
    // printing a number somebody might read as a capacity.
    const rate = row.paced ? `paced ${row.perSecond}` : String(row.perSecond);
    console.log(`| \`${row.name}\` | ${rate} | ${row.p50}ms | ${row.p95}ms | ${row.max}ms |`);
  }

  /* A refused request is not a slow request.
   *
   * Anything non-2xx here means the measurement met a ceiling rather than the
   * app, and a number produced that way is worse than none — it reads like
   * throughput and is the limiter's arithmetic.
   */
  const refused = rows.filter((row) => row.non2xx > 0);
  if (refused.length > 0) {
    console.log("");
    for (const row of refused) {
      console.log(`  !! ${row.name}: ${row.non2xx} requests were refused — `
        + "this is the rate limiter, not a measurement");
    }
  }
}

/* A server somebody else started: measure it as it is, seed nothing, stop
 * nothing. One session, because that is all a caller can hand over — so the
 * search row will meet the per-session ceiling and say so.
 */
async function measureSomebodyElses(autocannon, args) {
  const listing = await fetch(`${args.origin}/api/docs`, {
    headers: args.cookie ? { Cookie: args.cookie } : {}
  }).then((response) => response.json()).catch(() => null);

  const document = listing?.docs?.[0]?.file || "";
  const cookies = args.cookie ? [args.cookie] : [];
  const rows = [];

  for (const scenario of scenarios(document, 1)) {
    rows.push(await measure(autocannon, args.origin, scenario, cookies, args));
  }

  print(listing?.docs?.length ?? "unknown", rows);
}

async function main() {
  const args = parseArguments(process.argv.slice(2));

  let autocannon = null;
  try {
    autocannon = require("autocannon");
  } catch {
    console.error("autocannon is not installed. `npm install` first.");
    process.exit(1);
  }

  console.log(`${os.cpus()[0]?.model || "unknown cpu"}, ${os.cpus().length} cores, `
    + `node ${process.version}, ${args.connections} connections, ${args.seconds}s each`);

  if (args.origin) {
    await measureSomebodyElses(autocannon, args);
    return;
  }

  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "azadocs-load-"));
  const document = await seed(stateDir, args.corpus);
  const server = await startServer(stateDir);

  try {
    // The first sign-in also replaces the seeded password; every one after it
    // uses the password that left behind, and is its own session.
    const owned = `${SEED_PASSWORD}-own`;
    const cookies = [await signIn(server.origin)];
    while (cookies.length < args.connections) {
      cookies.push(await signIn(server.origin, owned));
    }

    // The first search builds the index. Measuring that would be measuring a
    // one-off, and the question is what a query costs once the library is warm.
    await fetch(`${server.origin}/api/docs/search?q=nightingale`,
      { headers: { Cookie: cookies[0] } });

    const rows = [];
    for (const scenario of scenarios(document, cookies.length)) {
      rows.push(await measure(autocannon, server.origin, scenario, cookies, args));
    }

    print(args.corpus, rows);
  } finally {
    server.stop();
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
