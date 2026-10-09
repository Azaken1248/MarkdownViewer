/* What axe says about every page, in both themes.
 *
 * Until this suite nothing had asked more than once. axe-core has been a
 * devDependency since the outline panel was built — run by hand, over that one
 * panel, and never since. Two axes were covered by accident: theme.test.js
 * computes contrast ratios from the token file, and the dom suites drive the
 * app by keyboard because that is how a test types. Neither is an
 * accessibility check — the first reads a stylesheet rather than a painted
 * page, and the second would pass just as well if every control were
 * unlabelled.
 *
 * axe-core is the thing that asks. It runs inside the page, against what was
 * actually rendered, and reports the WCAG 2.1 AA rules a machine can decide.
 * The first run over six states found four defects: --fg-subtle was 3.8:1
 * behind the metadata lines in the dark theme and 4.4:1 in the light one, the
 * share and error pages declared no language, two buttons in the mobile dock
 * were named something that did not contain the word printed on them, and the
 * diagram editor's panel separator was focusable with a focusable button
 * inside it. All fixed, which is why the budget below is empty.
 *
 * Three things this cannot say, so that they are said here instead of being
 * mistaken for silence: axe decides perhaps a third of WCAG, no screen reader
 * has been run against this app, and the document tree is a div that answers
 * to clicks. docs/ACCESSIBILITY.md is the list.
 *
 * It runs against what the server serves, which with a build in public/build
 * is the bundle. `npm run build` happens before `npm test` in CI; locally, a
 * stale bundle is a stale answer.
 */

const fs = require("fs");
const path = require("path");
const { createChecker } = require("./helpers/check.js");
const { startTestServer } = require("./helpers/server.js");
const { launchBrowser, INSTALL_HINT, theFirstSignIn, signIn } = require("./helpers/browser.js");

const { check, fail, finish } = createChecker("ACCESSIBILITY");

/* Which rules to run: the two AA levels and the two A levels under them.
 *
 * Not axe's full set. "best-practice" holds opinions — one landmark per page,
 * no nested interactive elements — that are worth reading and are not WCAG,
 * and a budget that mixes the two stops being a statement about conformance.
 */
const STANDARD = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/* How many nodes each rule may fail, per page state and theme.
 *
 * Empty, and it is meant to stay that way. The point of writing it down is
 * that it cannot quietly stop being empty: a new violation fails this suite
 * and somebody has to either fix it or add a line here saying which rule, how
 * many nodes, and why that is the right answer. A number nobody had to type
 * is a number that drifted.
 *
 * Shaped `{ "<state>|<theme>": { "<rule>": nodes } }`, so a failure names the
 * page it is on rather than a total to go hunting through.
 *
 * @type {Record<string, Record<string, number>>}
 */
const BUDGET = {};

/* Where axe looks. Six states, because the app is six different pages:
 *
 *  - signed out      the login form, the only page a stranger reaches
 *  - the shell       the explorer, the toolbar, the search field
 *  - a document      rendered markdown, the thing the app is for
 *  - the editor      a textarea, a toolbar and a live preview
 *  - the diagram page  its own page, its own CSS, its own canvas
 *  - a dead link     the error page, which is also the share page's template
 *
 * Each says how to get there and when it has arrived. "Arrived" is a selector
 * rather than a timeout wherever there is one to wait for: a scan that ran
 * before the page finished is a clean result about nothing.
 */
const STATES = [
  {
    name: "signed out",
    go: async (page, origin) => {
      await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#loginUsername", { timeout: 20000 });
    }
  },
  {
    name: "the shell",
    go: async (page, origin) => {
      await signIn(page, origin);
    }
  },
  {
    name: "a document",
    go: async (page, origin) => {
      await page.goto(`${origin}/beta.md`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#docContent h1", { state: "attached", timeout: 25000 });
    }
  },
  {
    name: "the editor",
    go: async (page) => {
      await page.click("#editDocBtn");
      await page.waitForSelector("#editorInput", { state: "visible", timeout: 20000 });
    }
  },
  {
    name: "the diagram page",
    go: async (page, origin) => {
      await page.goto(`${origin}/diagram/file/${DIAGRAM_FILE}`, { waitUntil: "domcontentloaded" });
      // Drawn, or saying why it is not. A fixed wait here would be waiting on
      // a fetch and hoping.
      await page.waitForSelector(".dd-node, .diagram-page-empty", { state: "attached", timeout: 25000 });
    }
  },
  {
    name: "a dead link",
    go: async (page, origin) => {
      await page.goto(`${origin}/s/not-a-real-token`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".error-detail", { state: "attached", timeout: 20000 });
    }
  }
];

// Long enough for the fonts to load and the layout to settle, since contrast
// and target size are measured off what is painted.
const SETTLE_MS = 800;

/* A diagram for the diagram page to be a diagram page about.
 *
 * Not in the shared fixture, because the corpus other suites count rows in is
 * theirs; written straight to the documents directory, which is where a .mmd
 * file put there by hand would be, and read per request rather than out of the
 * tree the server scanned at boot.
 */
const DIAGRAM_FILE = "accessibility-flow.mmd";
const DIAGRAM_SOURCE = "graph TD\n  A[Start] --> B[Middle]\n  B --> C[End]\n";

async function main() {
  const { browser, reason } = await launchBrowser();
  if (!browser) {
    console.log(`  SKIP  ${reason}`);
    console.log(`        ${INSTALL_HINT}`);
    process.exit(finish());
  }

  const axe = axePath();
  if (!axe) {
    console.log("  SKIP  axe-core is not installed (npm install)");
    await browser.close();
    process.exit(finish());
  }

  const server = await startTestServer();
  fs.writeFileSync(path.join(server.stateDir, "docs", DIAGRAM_FILE), DIAGRAM_SOURCE);

  try {
    await theFirstSignIn(browser, server);
    await everyStateInBothThemes(browser, server, axe);
    await thereIsAWayPastTheExplorer(browser, server);
    await motionCanBeTurnedOff(browser, server);
    await itSurvivesTwoHundredPercent(browser, server, axe);
    await forcedColoursLeaveSomethingToRead(browser, server);
  } finally {
    await browser.close();
    await server.stop();
  }

  process.exit(finish());
}

function axePath() {
  try {
    return require.resolve("axe-core/axe.min.js");
  } catch {
    return null;
  }
}

/* Injected before the page's own scripts, not added to it afterwards.
 *
 * page.addScriptTag() is how this is usually done and the app's own CSP
 * refuses it, correctly: `script-src 'self'` has no opinion about who is
 * asking. addInitScript runs in the page before anything else, outside the
 * policy, which is the one way to measure a page without weakening the thing
 * being measured.
 */
async function pageUnder(browser, axe, options) {
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    ...options
  });
  if (axe) {
    await context.addInitScript({ path: axe });
  }
  return { context, page: await context.newPage() };
}

/* What axe found, as `{ rule: nodes }`, plus how much it managed to check.
 *
 * The count of passing rules is the part that matters as much as the
 * violations: an empty violation list is also what a failed injection looks
 * like, and a budget of zero would sit there agreeing with it forever.
 */
function scan(page) {
  return page.evaluate(async (standard) => {
    // Injected before the page's own scripts; nothing declares it, so this is
    // the one place that has to say it is there.
    const axe = /** @type {any} */ (window).axe;
    if (!axe) {
      return { ran: false, rules: 0, violations: {}, details: [] };
    }

    const result = await axe.run(document, { runOnly: standard });
    const violations = {};
    for (const one of result.violations) {
      violations[one.id] = one.nodes.length;
    }

    return {
      ran: true,
      rules: result.passes.length,
      violations,
      details: result.violations.flatMap((one) => one.nodes.map((node) => `${one.id} (${one.impact}) `
        + `${(node.target || []).join(" ")}: `
        + String(node.failureSummary || "").replace(/\s+/g, " ").slice(0, 160)))
    };
  }, STANDARD);
}

/* How many rules a real scan has something to say about.
 *
 * The floor exists because an empty violation list is also what a failed
 * injection looks like, and a budget of zero would sit there agreeing with it
 * forever. Five, because the error page is a heading and two paragraphs and
 * genuinely only nine rules apply to it — a floor set by the richest page
 * would be a floor that fails on the plainest one.
 */
const RULES_AT_LEAST = 5;

async function everyStateInBothThemes(browser, server, axe) {
  console.log("=== axe over six page states, in both themes ===");

  for (const theme of ["dark", "light"]) {
    /* A context per theme, and signed out at the start of each.
     *
     * The session is a cookie, so reusing one would mean the light pass
     * started already signed in — testing a page the first pass had already
     * covered instead of the login form.
     */
    const { context, page } = await pageUnder(browser, axe);

    await page.goto(`${server.origin}/`, { waitUntil: "domcontentloaded" });
    await page.evaluate((want) => localStorage.setItem("mdviewer.theme", want), theme);

    for (const state of STATES) {
      await state.go(page, server.origin);
      await page.waitForTimeout(SETTLE_MS);

      const found = await scan(page);
      const where = `${state.name}|${theme}`;

      if (!found.ran || found.rules < RULES_AT_LEAST) {
        check(`axe ran on ${state.name} (${theme})`, found.rules, `at least ${RULES_AT_LEAST}`);
        continue;
      }

      if (!check(`${state.name} (${theme}) is within budget`, found.violations, BUDGET[where] || {})) {
        for (const line of found.details) {
          console.log(`          ${line}`);
        }
      }
    }

    await context.close();
  }

  const accepted = Object.values(BUDGET).reduce((total, rules) => total
    + Object.values(rules).reduce((sum, nodes) => sum + nodes, 0), 0);
  check("...and the number of accepted violations is still none", accepted, 0);
}

/* --- The way past the explorer ------------------------------------------- */

/* WCAG 2.4.1, and the one thing a keyboard user here actually needs.
 *
 * The page has landmarks, which is what satisfies axe's `bypass` rule and what
 * a screen reader's landmark navigation uses. Somebody with a keyboard and no
 * screen reader has neither: every folder row in the explorer is four Tab
 * stops — the row and its three actions — so an open tree puts dozens of them
 * between the top of the page and the document.
 *
 * Three things have to be true and each was false at some point while this was
 * written: the link is the first stop, it becomes visible when it is, and it
 * lands somewhere that can hold the focus. The last is the one that is usually
 * missed — a skip link whose target is not focusable changes the hash, scrolls
 * the page, and leaves the focus where it was, so the next Tab goes straight
 * back into the explorer.
 */
async function thereIsAWayPastTheExplorer(browser, server) {
  console.log("=== there is a way past the explorer, for a keyboard ===");

  const { context, page } = await pageUnder(browser, null);
  await signIn(page, server.origin);
  await page.goto(`${server.origin}/beta.md`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#docContent h1", { state: "attached", timeout: 25000 });
  await page.waitForTimeout(SETTLE_MS);

  const focused = () => page.evaluate(() => {
    const el = document.activeElement;
    const box = el?.getBoundingClientRect?.() || { top: 0, bottom: 0 };
    return {
      id: el?.id || "",
      className: typeof el?.className === "string" ? el.className : "",
      text: (el?.textContent || "").trim().slice(0, 40),
      // Off the top of the viewport until it has focus, which is how it stays
      // out of the way without leaving the tab order.
      onScreen: box.top >= 0 && box.bottom <= 900
    };
  });

  // Nothing focused, which is where a page starts before anybody presses Tab.
  await page.evaluate(() => /** @type {any} */ (document.activeElement)?.blur?.());
  await page.keyboard.press("Tab");
  // Long enough for the transition that brings it down from off-screen.
  await page.waitForTimeout(300);

  const first = await focused();
  check("the first thing a Tab reaches is the way past", first.className, "skip-link");
  check("...and taking it brings it onto the screen", first.onScreen, true);
  check("...saying what it does", first.text, "Skip to the document");

  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);

  const landed = await focused();
  check("following it lands on the document", landed.id, "docContent");

  /* And the view went with the focus.
   *
   * Two separate things, and each has been the one that was missing: a target
   * that cannot hold focus moves only the scroll, and a target that is focused
   * without being scrolled to leaves the reader looking at the explorer with
   * the focus somewhere they cannot see.
   */
  const heading = await page.evaluate(() => {
    const box = document.querySelector("#docContent h1")?.getBoundingClientRect();
    return box ? { top: Math.round(box.top), onScreen: box.top >= 0 && box.top < 900 } : null;
  });
  check("...and the document is what is on the screen", heading?.onScreen, true);

  await context.close();
}

/* --- Motion, and turning it off ------------------------------------------ */

/* Everything that still moves, with how long for.
 *
 * Read off the computed style rather than from the stylesheet, because that is
 * the question: a rule under `prefers-reduced-motion` that is overridden by a
 * later one is a rule that does nothing, and only the cascade knows.
 */
function whatMoves(page) {
  return page.evaluate(() => {
    const seconds = (list) => String(list).split(",")
      .map((part) => (/ms/.test(part) ? parseFloat(part) / 1000 : parseFloat(part)))
      .filter((n) => !Number.isNaN(n));

    const moving = [];
    for (const element of document.querySelectorAll("*")) {
      const style = getComputedStyle(element);
      const longest = Math.max(
        0,
        ...seconds(style.transitionDuration),
        ...(style.animationName === "none" ? [] : seconds(style.animationDuration))
      );

      // The reduce override sets 0.01ms rather than `none`, so that a
      // transitionend listener still hears one. Anything under a millisecond
      // is that, and is not motion.
      if (longest >= 0.001) {
        moving.push(`${element.tagName.toLowerCase()}`
          + `${element.id ? `#${element.id}` : ""} ${longest}s`);
      }
    }

    return moving;
  });
}

async function motionCanBeTurnedOff(browser, server) {
  console.log("=== prefers-reduced-motion is honoured, not merely mentioned ===");

  const ordinary = await pageUnder(browser, null);
  await signIn(ordinary.page, server.origin);
  await ordinary.page.waitForTimeout(SETTLE_MS);
  const without = await whatMoves(ordinary.page);
  await ordinary.context.close();

  /* The control, and the reason this check can fail.
   *
   * A page where nothing animates satisfies reduced motion by accident, and a
   * check that only looked at the reduce side would pass just as happily if
   * the browser flag had stopped working.
   */
  check("without it, the shell animates", without.length > 0, true);

  const reduced = await pageUnder(browser, null, { reducedMotion: "reduce" });
  await signIn(reduced.page, server.origin);
  await reduced.page.waitForTimeout(SETTLE_MS);
  const shell = await whatMoves(reduced.page);
  check("with it, nothing in the shell does", shell, []);

  await reduced.page.goto(`${server.origin}/beta.md`, { waitUntil: "domcontentloaded" });
  await reduced.page.waitForSelector("#docContent h1", { state: "attached", timeout: 25000 });
  await reduced.page.waitForTimeout(SETTLE_MS);
  check("...nor anything on a document", await whatMoves(reduced.page), []);

  await reduced.context.close();
}

/* --- Zoomed to 200% ------------------------------------------------------ */

/* WCAG 1.4.4: text scales to 200% without losing content or function.
 *
 * Zoom is the viewport getting smaller in CSS pixels, so this is the 1400px
 * layout at 700. What that breaks is horizontal scrolling — a reader zoomed in
 * having to pan left and right along every line — so the check is that
 * nothing sticks out, and that axe still has nothing to say at that size.
 */
const ZOOMED = { width: 700, height: 600, scale: 2 };

function whatSticksOut(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const over = [];

    for (const element of document.querySelectorAll("body *")) {
      const box = element.getBoundingClientRect();
      // A pixel of slack: a sub-pixel layout rounds, and a box one 32nd of a
      // pixel wide is not something a reader has to scroll to.
      if (box.width > 0 && box.right > root.clientWidth + 1) {
        over.push(`${element.tagName.toLowerCase()}`
          + `${element.id ? `#${element.id}` : ""} right=${Math.round(box.right)}`);
      }
    }

    return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, over: over.slice(0, 6) };
  });
}

async function itSurvivesTwoHundredPercent(browser, server, axe) {
  console.log("=== at 200% zoom, which is the layout at half the width ===");

  const { context, page } = await pageUnder(browser, axe, {
    viewport: { width: ZOOMED.width, height: ZOOMED.height },
    deviceScaleFactor: ZOOMED.scale
  });

  await signIn(page, server.origin);
  await page.waitForTimeout(SETTLE_MS);

  const shell = await whatSticksOut(page);
  check("the shell fits the width", { over: shell.over, wider: shell.scrollWidth > shell.clientWidth },
    { over: [], wider: false });

  const zoomedShell = await scan(page);
  if (!check("...and axe still has nothing to say about it", zoomedShell.violations, {})) {
    for (const line of zoomedShell.details) {
      console.log(`          ${line}`);
    }
  }

  await page.goto(`${server.origin}/beta.md`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#docContent h1", { state: "attached", timeout: 25000 });
  await page.waitForTimeout(SETTLE_MS);

  const document_ = await whatSticksOut(page);
  check("a document fits it too", { over: document_.over, wider: document_.scrollWidth > document_.clientWidth },
    { over: [], wider: false });

  const zoomedDoc = await scan(page);
  if (!check("...and axe nothing about that", zoomedDoc.violations, {})) {
    for (const line of zoomedDoc.details) {
      console.log(`          ${line}`);
    }
  }

  await context.close();
}

/* --- Forced colours ------------------------------------------------------ */

/* Windows High Contrast, and anyone who has told the OS to pick the colours.
 *
 * The whole of this app is painted with custom properties, which forced
 * colours overrides wholesale: every `color` and `background-color` becomes
 * the system's, and anything that was carrying meaning in a colour the system
 * does not know about stops carrying it. What disappears first, in apps built
 * this way, is a border drawn as a `box-shadow` or a background on a
 * pseudo-element — neither of which is forced, so both keep a colour nothing
 * else has any more.
 *
 * This is a smoke check and is written down as one in docs/ACCESSIBILITY.md:
 * it asks whether the page still has readable text and visible controls, not
 * whether it is good. axe says little here, because contrast is the system's
 * business in this mode and the rule knows it.
 */
async function forcedColoursLeaveSomethingToRead(browser, server) {
  console.log("=== with the colours taken over by the system ===");

  const { context, page } = await pageUnder(browser, null, { forcedColors: "active" });
  await signIn(page, server.origin);
  await page.goto(`${server.origin}/beta.md`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#docContent h1", { state: "attached", timeout: 25000 });
  await page.waitForTimeout(SETTLE_MS);

  const painted = await page.evaluate(() => {
    const read = (selector) => {
      const element = document.querySelector(selector);
      if (!element) {
        return { missing: selector };
      }

      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return {
        colour: style.color,
        background: style.backgroundColor,
        drawn: box.width > 0 && box.height > 0
      };
    };

    return {
      // The page knows it is in this mode at all, which is what any rule
      // written for it depends on.
      mode: window.matchMedia("(forced-colors: active)").matches,
      heading: read("#docContent h1"),
      prose: read("#docContent p"),
      button: read("#newDocBtn"),
      row: read("#docList .tree-row-btn")
    };
  });

  check("the page is in forced-colours mode", painted.mode, true);

  for (const [what, found] of Object.entries(painted)) {
    if (what === "mode") {
      continue;
    }

    check(`  ${what} is still drawn`, found.drawn, true);
    /* A colour at all, rather than a specific one.
     *
     * Which colours the system picks is the reader's business and differs per
     * machine; what this is about is that the app has not left something
     * transparent or painted on a background the system has replaced.
     */
    check(`  ...and has a colour the system gave it`,
      /^rgba?\(/.test(found.colour) && !/rgba\(0, 0, 0, 0\)/.test(found.colour), true);
  }

  await context.close();
}

void main().catch((error) => {
  console.error(error);
  fail();
  process.exit(1);
});
