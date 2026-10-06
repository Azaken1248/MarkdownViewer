/* The client, in a browser.
 *
 * Every other client suite runs in jsdom, which is a JavaScript implementation
 * of the DOM rather than a browser. It is fast and it is thorough and there
 * are five things it structurally cannot answer, because it does not lay
 * anything out, does not enforce a Content-Security-Policy, does not run a
 * worker, and does not paint. Twenty thousand lines of client code, and until
 * this suite the only thing that had ever executed one of them was an
 * approximation of the thing they run in.
 *
 * The first page a real browser loaded found a defect in ninety seconds: the
 * app's own icons, written as absolute URLs from PUBLIC_BASE_URL, are refused
 * by the app's own `img-src 'self'` on any other hostname. Nothing jsdom could
 * ever say, since it parses the header and ignores it. That is check one.
 *
 * These are the five, chosen for being what the fast suites cannot say rather
 * than for covering the most code. The jsdom suites keep their jobs.
 */

const { createChecker } = require("./helpers/check.js");
const { startTestServer, SEED_USERNAME, SEED_PASSWORD, TEST_PASSWORD } = require("./helpers/server.js");

const { check, finish } = createChecker("BROWSER");

async function main() {
  let chromium = null;
  try {
    ({ chromium } = require("playwright-core"));
  } catch {
    console.log("  SKIP  playwright-core is not installed");
    process.exit(finish());
  }

  let browser = null;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    /* A browser is a 266MB install and this suite is the only thing that
     * needs one. Saying so and passing is better than a red build on a
     * machine that simply has not downloaded it: the step that installs it
     * lives in the workflow, where its absence is visible.
     */
    console.log(`  SKIP  no browser to drive (${String(error.message).split("\n")[0]})`);
    console.log("        npx playwright install chromium --only-shell");
    process.exit(finish());
  }

  const server = await startTestServer();

  try {
    await theFirstSignIn(browser, server);
    await runChecks(browser, server);
  } finally {
    await browser.close();
    await server.stop();
  }

  process.exit(finish());
}

/* Everything the page complained about, which is the point of check one.
 *
 * A console error, an uncaught exception and a request that never arrived are
 * three different failures with one thing in common: no jsdom suite sees any
 * of them, and all three are things the app did to itself.
 */
function watch(page) {
  const problems = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      problems.push(`console: ${message.text().slice(0, 200)}`);
    }
  });

  page.on("pageerror", (error) => problems.push(`uncaught: ${error.message.slice(0, 200)}`));
  page.on("requestfailed", (request) => {
    // A navigation the test itself abandoned is not a failure of the page.
    if (!request.failure()?.errorText.includes("net::ERR_ABORTED")) {
      problems.push(`failed: ${request.url().slice(0, 120)} — ${request.failure()?.errorText}`);
    }
  });

  return problems;
}

/* Signed in the way a person is, through the form.
 *
 * The seeded admin must change its password before it may do anything, which
 * is the app working as intended and is a thing the other suites do over the
 * API. Here it goes through the dialog, so the forced-change path is driven
 * in a browser too.
 */
/* The seeded admin must change its password before it may do anything, which
 * is the app working as intended. Done once, in the browser, so the forced
 * change is driven here too — and so every sign-in after it is the ordinary
 * one rather than a guess at which password is current.
 */
async function theFirstSignIn(browser, server) {
  const page = await browser.newPage();

  await page.goto(`${server.origin}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#loginUsername", { timeout: 20000 });
  await page.fill("#loginUsername", SEED_USERNAME);
  await page.fill("#loginPassword", SEED_PASSWORD);
  await page.click("#loginSubmitBtn");

  await page.waitForSelector("#currentPassword", { timeout: 20000 });
  await page.fill("#currentPassword", SEED_PASSWORD);
  await page.fill("#newPassword", TEST_PASSWORD);
  await page.fill("#confirmPassword", TEST_PASSWORD);
  await page.click("#passwordSubmitBtn");
  await waitForTheLibrary(page);
  await page.close();
}

async function signIn(page, origin) {
  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#loginUsername", { timeout: 20000 });
  await page.fill("#loginUsername", SEED_USERNAME);
  await page.fill("#loginPassword", TEST_PASSWORD);
  await page.click("#loginSubmitBtn");
  await waitForTheLibrary(page);
}

// Signed in and the tree filled, rather than merely signed in: an empty tree
// is what a refused password looks like from the outside.
function waitForTheLibrary(page) {
  return page.waitForFunction(
    () => document.querySelectorAll("#docList .tree-row-folder, #docList .tree-row-doc").length > 1,
    null,
    { timeout: 25000 }
  );
}

async function runChecks(browser, server) {
  await theConsoleIsEmpty(browser, server);
  await theCspRefusesAScript(browser, server);
  await theLayoutIsTheLayout(browser, server);
  await aDocumentRenders(browser, server);
  await theThemeChangesColours(browser, server);
  await pythonRuns(browser, server);
}

/* --- 1. Nothing in the console ------------------------------------------- */

async function theConsoleIsEmpty(browser, server) {
  console.log("=== the page loads without complaining ===");

  /* On a hostname the app was not told about, which is the case that found
   * the icon bug: PUBLIC_BASE_URL says one thing and the browser is at
   * another, so anything the page builds as an absolute URL is cross-origin
   * to itself.
   */
  const page = await browser.newPage();
  const problems = watch(page);

  await page.goto(`${server.origin}/`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(1500);

  check("the sign-in page loads with an empty console", problems, []);

  // Specifically, because this is the one that was wrong and the message is
  // worth keeping in the suite rather than only in a commit.
  check("...and nothing of its own is refused by its own CSP",
    problems.filter((one) => /Content Security Policy/i.test(one)), []);

  const icons = await page.evaluate(() => [...document.querySelectorAll("link[rel*='icon']")]
    .map((link) => link.getAttribute("href")));
  check("the icons are paths, so they are same-origin wherever it is served",
    icons.filter((href) => /^https?:/.test(href)), []);
  check("...and there are some", icons.length > 0, true);

  await page.close();
}

/* --- 2. The policy refuses something ------------------------------------- */

async function theCspRefusesAScript(browser, server) {
  console.log("=== the Content-Security-Policy is enforced, not merely sent ===");

  const page = await browser.newPage();
  await page.goto(`${server.origin}/`, { waitUntil: "domcontentloaded" });

  /* Injected the way an XSS would arrive — as markup the page inserts — and
   * the question is whether it runs. jsdom can only say the header was sent.
   */
  const ran = await page.evaluate(() => new Promise((done) => {
    const flag = /** @type {any} */ (window);
    flag.__itRan = false;
    const holder = document.createElement("div");
    // Split so this file's own parser does not end the script here.
    holder.innerHTML = `<${"script"}>window.__itRan = true;</${"script"}>`;
    document.body.appendChild(holder);

    const inline = document.createElement("script");
    inline.textContent = "window.__itRan = true;";
    document.body.appendChild(inline);

    const remote = document.createElement("script");
    remote.src = "https://example.invalid/evil.js";
    document.body.appendChild(remote);

    setTimeout(() => done(flag.__itRan), 400);
  }));

  check("an inline script injected into the page does not run", ran, false);

  const refusedRemote = await page.evaluate(() => new Promise((done) => {
    const probe = document.createElement("script");
    probe.src = "https://example.invalid/evil.js";
    probe.onerror = () => done(true);
    probe.onload = () => done(false);
    document.body.appendChild(probe);
    setTimeout(() => done(true), 1500);
  }));

  check("...and a script from somewhere else is refused", refusedRemote, true);
  await page.close();
}

/* --- 3. The layout, measured --------------------------------------------- */

async function theLayoutIsTheLayout(browser, server) {
  console.log("=== the layout is what the stylesheet is read to mean ===");

  /* layout.test.js and mobile.test.js reason about the stylesheet, because
   * jsdom answers zero to every measurement. They are fast and they catch a
   * different class of mistake, so they stay — and these measure the same
   * claims, so the two have to agree.
   */
  const wide = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await signIn(wide, server.origin);

  const desktop = await wide.evaluate(() => {
    const sidebar = document.getElementById("sidebar");
    return {
      sidebarLeft: Math.round(sidebar.getBoundingClientRect().left),
      sidebarWidth: Math.round(sidebar.getBoundingClientRect().width),
      documentScrolls: document.documentElement.scrollWidth > window.innerWidth + 1
    };
  });

  check("the sidebar is on the page at a desktop width", desktop.sidebarLeft >= 0, true);
  check("...and has a width", desktop.sidebarWidth > 100, true);
  check("nothing pushes the page sideways", desktop.documentScrolls, false);
  await wide.close();

  const narrow = await browser.newPage({ viewport: { width: 375, height: 760 } });
  await signIn(narrow, server.origin);
  await narrow.waitForTimeout(400);

  const phone = await narrow.evaluate(() => {
    const sidebar = document.getElementById("sidebar");
    const box = sidebar.getBoundingClientRect();
    const buttons = [...document.querySelectorAll(".icon-btn:not([hidden])")]
      .map((b) => b.getBoundingClientRect())
      .filter((r) => r.width > 0);

    return {
      sidebarOffScreen: box.right <= 1 || box.left >= window.innerWidth - 1,
      documentScrolls: document.documentElement.scrollWidth > window.innerWidth + 1,
      smallestTarget: Math.round(Math.min(...buttons.map((r) => Math.min(r.width, r.height)))),
      targets: buttons.length
    };
  });

  check("the sidebar is off-screen on a phone", phone.sidebarOffScreen, true);
  check("...and the page still does not scroll sideways", phone.documentScrolls, false);
  check("every pointer target is at least 24px", phone.smallestTarget >= 24, true);
  check("...and there are targets to measure", phone.targets > 3, true);
  await narrow.close();
}

/* --- 4. A document, actually rendered ------------------------------------ */

async function aDocumentRenders(browser, server) {
  console.log("=== a document renders, with the real libraries ===");

  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const problems = watch(page);

  await signIn(page, server.origin);

  // By its address, which is how a link to one arrives and is the path the
  // client's own router takes.
  await page.goto(`${server.origin}/beta.md`, { waitUntil: "domcontentloaded" });
  // Attached rather than visible: the viewer fades the article in, and what
  // is being checked is that it rendered rather than when it finished moving.
  await page.waitForSelector("#docContent h1", { state: "attached", timeout: 25000 });
  await page.waitForTimeout(1200);

  const rendered = await page.evaluate(() => ({
    heading: document.querySelector("#docContent h1")?.textContent?.trim(),
    paragraphs: document.querySelectorAll("#docContent p").length,
    // Every jsdom suite stubs these. Here they came over the network with
    // their SRI hashes enforced, which is the only check that the pins are
    // both correct and servable to a browser.
    marked: typeof window.marked !== "undefined",
    purify: typeof window.DOMPurify !== "undefined"
  }));

  check("the document's heading is on the page", rendered.heading, "Beta");
  check("...and its prose with it", rendered.paragraphs > 0, true);
  check("marked arrived from the CDN and passed its hash", rendered.marked, true);
  check("...and so did DOMPurify", rendered.purify, true);
  check("rendering it complained about nothing", problems, []);

  await page.close();
}

/* --- 5. The theme, as painted -------------------------------------------- */

async function theThemeChangesColours(browser, server) {
  console.log("=== the theme is a cascade of custom properties, resolved ===");

  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await signIn(page, server.origin);

  const colourNow = () => page.evaluate(() => ({
    theme: document.documentElement.getAttribute("data-theme"),
    background: getComputedStyle(document.body).backgroundColor,
    text: getComputedStyle(document.body).color
  }));

  const before = await colourNow();
  await page.click("#themeToggleBtn");
  await page.waitForTimeout(400);
  const after = await colourNow();

  check("the theme changes", before.theme === after.theme, false);
  // The only place the custom-property cascade is real: jsdom resolves
  // var() to the empty string.
  check("...and the painted background with it", before.background === after.background, false);
  check("...and the painted text colour", before.text === after.text, false);
  check("both are real colours", /^rgb/.test(before.background) && /^rgb/.test(after.background), true);

  await page.close();
}

/* --- 6. Python, for real ---------------------------------------------------
 *
 * The `worker` suite drives the protocol against a Pyodide that answers and
 * nothing more, which reaches the message handling, both caps, the error
 * paths and the network guard without a browser. What it cannot say is
 * whether Python runs: "the fake agrees with the protocol" and "a cell
 * prints" are different claims.
 *
 * So this is one check, and it is the slow one — a real Worker, the real
 * twelve megabytes from the CDN, and one line of Python. jsdom has no Worker
 * at all, which is why nothing had ever executed a line of that file.
 */
const PYTHON_TIMEOUT_MS = 180000;

async function pythonRuns(browser, server) {
  console.log("=== Python runs in a real worker, which is the slow one ===");

  const page = await browser.newPage();
  await page.goto(`${server.origin}/`, { waitUntil: "domcontentloaded" });

  const started = Date.now();
  const answer = await page.evaluate(async (ms) => new Promise((done) => {
    // The app's own worker, at the address the app loads it from, under the
    // Content-Security-Policy the app serves — worker-src 'self'.
    const worker = new Worker("/js/pyodide-worker.js");
    const stages = [];
    const timer = setTimeout(() => done({ timedOut: true, stages }), ms);

    worker.onmessage = (event) => {
      const message = event.data || {};
      if (message.type === "status") {
        stages.push(message.stage);
        return;
      }

      if (message.type === "result") {
        clearTimeout(timer);
        worker.terminate();
        done({ ...message, stages });
      }
    };

    worker.onerror = (error) => {
      clearTimeout(timer);
      done({ failed: String(error.message || error), stages });
    };

    worker.postMessage({
      type: "run",
      id: "real",
      notebookId: "browser-suite",
      code: "print('hello from python')\n6 * 7"
    });
  }), PYTHON_TIMEOUT_MS);

  const seconds = Math.round((Date.now() - started) / 1000);

  if (answer.timedOut || answer.failed) {
    check(`Python runs in a worker (gave up after ${seconds}s)`,
      answer.failed || `timed out after ${stageList(answer)}`, "");
    await page.close();
    return;
  }

  check(`Python starts and runs a cell (${seconds}s)`, answer.ok, true);
  check("...having said what it was doing on the way",
    answer.stages.includes("downloading") && answer.stages.includes("ready"), true);
  check("...and what the cell printed comes back", answer.stdout, ["hello from python"]);
  check("...with the value of its last expression", answer.result, "42");

  await page.close();
}

const stageList = (answer) => (answer.stages.length > 0 ? answer.stages.join(" → ") : "no status at all");

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
