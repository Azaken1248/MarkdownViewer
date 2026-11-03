// The diagram editor on a page of its own, and the way a document gets to it
// and back.
//
// Two things are worth testing here and neither is the canvas — that is tested
// where the canvas is. The first is the address: a diagram is found again after
// the document moved under it, or it is not found and nothing is written. The
// second is the handoff: a document with unsaved changes in it goes across in
// sessionStorage and comes back with the new diagram still unsaved, because the
// alternative is silently saving edits nobody asked to save, or silently losing
// them.

const fs = require("fs");
const path = require("path");
const {
  appSource: readAppSource, pageScriptPaths, loadScript
} = require("./app-source.js");
const { JSDOM, VirtualConsole } = require("jsdom");
const { startTestServer, SEED_USERNAME, SEED_PASSWORD, TEST_PASSWORD } = require("./helpers/server");
const { createChecker } = require("./helpers/check.js");

const ROOT = path.join(__dirname, "..", "public");
const pageHtml = fs.readFileSync(path.join(ROOT, "diagram.html"), "utf8");
// The shell routes, which is where the reserved prefixes live.
const pagesSource = fs.readFileSync(path.join(__dirname, "..", "lib", "routes", "pages.js"), "utf8");

const { check, finish } = createChecker("DIAGRAM PAGE");

const DIAGRAM_DOC = [
  "# Deployment",
  "",
  "Before the diagram.",
  "",
  "```mermaid",
  "flowchart TD",
  "  A[Build] --> B[Ship]",
  "```",
  "",
  "After the diagram.",
  ""
].join("\n");

const SETTLE = 40;
const settle = () => new Promise((resolve) => setTimeout(resolve, SETTLE));

/* A page, booted the way the browser boots it: the real HTML, the real scripts
 * in the order the page lists them, and a fetch that goes to the real server.
 */
async function boot(dom, { cookie, origin }) {
  const { window } = dom;

  // jsdom has no layout, so a canvas measured against the window is measured
  // against zero. The editor only reads these to place a dropped shape.
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 0, top: 0, left: 0, right: 900, bottom: 600, width: 900, height: 600 };
  };

  /* Node's FormData rather than jsdom's, because the shim below hands the body
   * to Node's fetch and the two implementations do not recognise each other.
   * Everything else about the upload is the page's own code.
   */
  window.FormData = globalThis.FormData;
  window.File = globalThis.File;
  window.Blob = globalThis.Blob;

  const requested = [];
  window.fetch = async (input, options = {}) => {
    const target = new URL(String(input), origin);
    requested.push({ url: target.pathname, method: String(options.method || "GET").toUpperCase() });

    /* A request that does not arrive at all — the server gone, the socket
     * reset — used to surface as a bare "socket hang up" with no stack of
     * ours in it and nothing about what was being asked for. Under a full
     * `npm test` on a machine short of memory that is the whole failure
     * report, so it says which request now.
     */
    let response;
    try {
      response = await fetch(target.href, {
        ...options,
        headers: { ...(options.headers || {}), Cookie: cookie }
      });
    } catch (error) {
      /* With the cause, because undici says "fetch failed" for every one of
       * them and the cause is the whole difference: a socket the server
       * reset, a connection that timed out trying, a port with nothing
       * listening. Those are three different faults.
       */
      throw new Error(`the page's ${
        String(options.method || "GET").toUpperCase()} ${target.pathname} never arrived: ${
        because(error)}`, { cause: error });
    }

    return {
      ok: response.ok,
      status: response.status,
      json: () => response.json(),
      // Saving a picture asks for the app's own stylesheet, which is text.
      text: () => response.text()
    };
  };

  /* Every script diagram.html loads, in the order it loads them.
   *
   * Read off the page rather than listed here, for the reason the rest of the
   * suite reads index.html: a script added to the page and not to a list in a
   * test is a script no test ever evaluates — which is exactly what happened
   * when js/dom-html.js was added and this list was not.
   */
  for (const file of pageScriptPaths("diagram.html", ROOT)) {
    loadScript(window, file);
  }

  // The page fetches before it draws, so waiting a fixed moment is waiting on a
  // network round trip and hoping. Wait for the page to have finished instead:
  // a canvas with a diagram on it, or a message saying why there is not one.
  await waitFor(window, () => window.document.querySelector(".dd-node, .diagram-page-empty"));

  return { window, document: window.document, requested };
}

/* Every page this suite has opened and not yet closed.
 *
 * A page is a jsdom window, and this suite opens fifty-five of them. They were
 * never closed: the suite finished holding all fifty-five, which is most of
 * the eight hundred megabytes it peaked at — the largest lane in the run, on a
 * machine where every other suite wants memory at the same time. Nothing needs
 * them after the file that opened them, so each file's are put down when it
 * is done.
 *
 * Not for the CPU: fifty-five idle windows cost twenty milliseconds of it over
 * two seconds, which was measured before this was written and is nothing.
 */
const openPages = [];

/* What the pages logged, gathered from all of them.
 *
 * Every error here is the page saying something went wrong in a place it
 * could not report any other way — a draw that threw, a fetch nothing was
 * waiting for, a handler that fell over on a guard that is no longer there.
 * Nothing collected them, so a check could pass while the page was logging a
 * TypeError on every pointer move. The DOM suite has read its own console
 * since it was written; this is the same thing one page over, and each entry
 * says which page it came from, because this suite opens dozens.
 */
const pageErrors = [];

function watchedConsole(url) {
  const where = String(url).replace(/^https?:\/\/[^/]+/, "");
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => pageErrors.push(`${where} jsdomError: ${error.message}`));
  virtualConsole.on("error", (...args) => pageErrors.push(`${where} console.error: ${args.join(" ")}`));
  return virtualConsole;
}

function closeOpenPages() {
  for (const dom of openPages.splice(0)) {
    if (!dom.window.closed) {
      dom.window.close();
    }
  }
}

function openPage({ url, cookie, origin, stash = null, panels = null, before = null }) {
  const dom = new JSDOM(pageHtml, {
    url, runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: watchedConsole(url)
  });
  // Anything that has to be on the window before the page's own scripts read
  // it — a ResizeObserver, say, which jsdom has not got and which the editor
  // only reaches for while it is being built.
  if (before) {
    before(dom.window);
  }
  // What the browser was left holding, before the editor is built and reads it.
  if (panels !== null) {
    dom.window.localStorage.setItem("azadocs:diagram:panels", panels);
  }

  if (stash !== null) {
    dom.window.sessionStorage.setItem(`azadocs:diagram:${new URL(url).pathname.replace(/^\/diagram\/(?:doc|file)\//, "")}`, stash);
  }

  openPages.push(dom);
  return boot(dom, { cookie, origin }).then((page) => ({ ...page, dom }));
}

// Click Save and wait for it to have happened. A fixed pause here is a pause
// racing a real HTTP round trip, and the race is won often enough to make a
// broken check look like a passing one.
/* What a transport error actually was. `fetch failed` is undici's wrapper for
 * all of them; the cause underneath carries the code.
 */
function because(error) {
  const cause = error.cause;
  if (!cause) {
    return error.message;
  }

  const code = cause.code ? ` (${cause.code})` : "";
  return `${error.message}: ${cause.message}${code}`;
}

async function saveAndWait(page) {
  const before = page.requested.length;
  page.document.getElementById("diagramSave").click();
  await waitFor(page.window,
    () => /^Saved/.test(page.document.getElementById("diagramStatus").textContent),
    () => `the save never finished: the page says "${
      page.document.getElementById("diagramStatus").textContent}"; requests since the click: ${
      JSON.stringify(page.requested.slice(before))}`);
}

/* Wait for something to have happened, with a ceiling that means "this is
 * never going to happen" rather than "this machine is slow".
 *
 * Fifteen seconds is far longer than any of these take (the whole suite is
 * about twenty), and it has to be: the runner starts several suites at once,
 * so a page that boots in 200ms on an idle machine can take a few seconds when
 * three other jsdom suites are between it and a core. A tight ceiling here
 * does not catch anything a loose one misses — the loop returns the moment the
 * condition holds — it only turns a busy machine into a failing run.
 */
/* Fifteen seconds was too tight, and the failure was always the same one:
 * "the save never finished: the page says Saving…", from a save that is one
 * local HTTP round trip. It passed alone every time and failed about one run
 * in three under `npm test`, where this suite shares a machine with
 * thirty-five others — which is the signature of a ceiling that has stopped
 * meaning "this is never going to happen" and started meaning "this machine
 * is busy". Forty-five is still the first of those: nothing here waits on
 * anything but a server in the same process tree.
 */
/**
 * @param {Window} window
 * @param {() => unknown} done
 * @param {string | (() => string)} what what it was waiting for, or a function
 *   that says so once it is known to have failed — the state to describe is
 *   the state at the deadline, not the one when the wait began.
 * @param {number} [timeoutMs]
 */
async function waitFor(window, done, what = "the page never finished starting up", timeoutMs = 45000) {
  const started = Date.now();
  while (!done()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(typeof what === "function" ? what() : what);
    }

    await settle();
  }

  return done();
}

/* The same wait, for when a check is about to say what it found.
 *
 * waitFor throws, which is right when the page never got far enough for any
 * check to mean anything — a page that never booted. It is wrong just before
 * a check: a throw stops the suite with a sentence, so the run says "it
 * failed" and names the file, while a check says what it wanted and what it
 * got. Eight deliberate breaks against the arrow panel showed the difference:
 * every one of them stopped the suite without a FAIL line in it.
 *
 * So this one returns instead, and the check that follows does the talking.
 * The ceiling is lower for the same reason: nothing after it is waiting on
 * the condition, so there is no cost to finding out sooner.
 */
async function until(window, done, timeoutMs = 10000) {
  const started = Date.now();
  while (!done()) {
    if (Date.now() - started > timeoutMs) {
      return false;
    }

    await settle();
  }

  return true;
}

/* Signing in, which this suite does more than once.
 *
 * Writes are rate limited per session — a hundred and twenty a minute — and
 * this suite is eleven files of a page that saves. Locally they are spread
 * over four minutes and nothing notices; on CI the whole suite is a hundred
 * seconds, so they land inside one window and the page starts answering "Too
 * many saves just now", which arrives as a save that never finishes.
 *
 * The limit is not what is being tested here (the `limiter` suite owns it)
 * and it is not wrong: a person saving by hand cannot reach it. So each file
 * signs in for itself instead, which is eleven budgets rather than one, and
 * which is also what eleven people would be.
 */
async function signIn(server, password) {
  const login = await server.request("POST", "/api/auth/login",
    { username: SEED_USERNAME, password });
  const jar = new Map();

  const absorb = (headers) => {
    for (const raw of headers["set-cookie"] || []) {
      const [pair] = raw.split(";");
      const at = pair.indexOf("=");
      jar.set(pair.slice(0, at).trim(), pair.slice(at + 1));
    }
  };

  absorb(login.headers);
  return { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "), login, absorb, jar };
}

(async () => {
  const server = await startTestServer();
  console.log(`  (test server on ${server.origin})`);

  try {
    const first = await signIn(server, SEED_PASSWORD);
    const changed = await server.request("POST", "/api/auth/password",
      { currentPassword: SEED_PASSWORD, newPassword: TEST_PASSWORD },
      { Cookie: first.cookie, "X-CSRF-Token": first.login.body.csrfToken });
    first.absorb(changed.headers);

    await run(server, () => signIn(server, TEST_PASSWORD).then((one) => one.cookie));
  } finally {
    await server.stop();
  }

  process.exit(finish());
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function run(server, freshCookie) {
  const origin = server.origin;

  /* The checks themselves, in eleven files beside this one, in this order — the
   * way somebody working on a diagram would. What they share is the harness
   * above, handed over rather than reached for.
   *
   * Each gets a session of its own, for the write budget rather than for
   * anything it does with it: see signIn below.
   */
  const PARTS = [
    require("./diagram-page/documents.js"),
    require("./diagram-page/furniture.js"),
    require("./diagram-page/moving.js"),
    require("./diagram-page/dressing.js"),
    require("./diagram-page/typography.js"),
    require("./diagram-page/bar.js"),
    require("./diagram-page/arrows.js"),
    require("./diagram-page/carrying.js"),
    require("./diagram-page/reaching.js"),
    require("./diagram-page/refusing.js"),
    require("./diagram-page/embedded.js")
  ];

  const shared = {
    check, server, origin, fs, path, ROOT, JSDOM, pageHtml, pagesSource,
    DIAGRAM_DOC, SETTLE, settle, boot, openPage, saveAndWait, waitFor, until,
    csrfFor, addressOf, dragBox, readAppSource
  };

  for (const part of PARTS) {
    await part({ ...shared, cookie: await freshCookie() });
    closeOpenPages();
  }

  console.log("=== what the pages logged ===");
  /* jsdom's own two complaints are not the page's: it has no CSS parser for
   * everything the stylesheet uses and no layout, and it says so. Anything
   * else came from the page's own code.
   */
  const itsOwn = pageErrors.filter((one) => !/Could not parse CSS|Not implemented/.test(one));
  check("no page logged an error of its own", itsOwn, []);

}

/* --- the harness's own small tools ------------------------------------- */

async function csrfFor(server, cookie) {
  const session = await server.request("GET", "/api/session", undefined, { Cookie: cookie });
  return session.body.csrfToken;
}

// The address of the nth diagram in a document, computed the way the app
// computes it — through the module that owns the format, not by hand.
function addressOf(markdown, which) {
  const dom = new JSDOM("", { runScripts: "outside-only" });
  loadScript(dom.window, path.join(ROOT, "js", "visual-editor.js"));
  const VE = dom.window.VisualEditor;
  return VE.diagramAddress(VE.diagramFences(markdown)[which]);
}

// A real drag on a real box, through the events the canvas listens for.
//
// jsdom has no PointerEvent, but an event is dispatched by its name: a
// MouseEvent named pointerdown reaches a pointerdown listener with the
// coordinates on it, which is all the canvas reads. And jsdom measures nothing,
// so a point on the screen is a point in the diagram.
function dragBox(window, id, dx, dy) {
  const canvas = window.document.querySelector(".ve-diagram-canvas");
  const group = canvas.querySelector(`.dd-node[data-id="${id}"]`);
  const found = /translate\(([-\d.]+),([-\d.]+)\)/.exec(group.getAttribute("transform"));
  const x = Number(found[1]) + 10;
  const y = Number(found[2]) + 10;
  const at = (px, py) => ({ clientX: px, clientY: py, bubbles: true });

  group.dispatchEvent(new window.MouseEvent("pointerdown", at(x, y)));
  canvas.dispatchEvent(new window.MouseEvent("pointermove", at(x + dx, y + dy)));
  canvas.dispatchEvent(new window.MouseEvent("pointerup", at(x + dx, y + dy)));
}
