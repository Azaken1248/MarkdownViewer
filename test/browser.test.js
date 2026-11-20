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
const { startTestServer } = require("./helpers/server.js");
const { launchBrowser, INSTALL_HINT, theFirstSignIn, signIn } = require("./helpers/browser.js");

const { check, finish } = createChecker("BROWSER");

async function main() {
  const { browser, reason } = await launchBrowser();
  if (!browser) {
    console.log(`  SKIP  ${reason}`);
    console.log(`        ${INSTALL_HINT}`);
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

  /* And maths, which no suite had ever rendered for real.
   *
   * Every jsdom suite stubs KaTeX — `katex.render` becomes a function that
   * writes the TeX into the node — so what has never been checked anywhere is
   * whether the pinned version typesets, with this app's options, from the
   * bytes the hash admits. That is the one thing a version bump can break
   * that reading the diff cannot catch, and the bump is also where the
   * stylesheet and the two scripts have to arrive in the right order.
   *
   * The document is written through the app's own API, with the session the
   * page already has, rather than seeded on disk where every other suite
   * would have to agree about it.
   */
  const made = await page.evaluate(async () => {
    const session = await (await fetch("/api/session")).json();
    const answer = await fetch("/api/docs", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken },
      body: JSON.stringify({
        fileName: "typeset.md",
        overwrite: true,
        content: "# Typeset\n\n$$\\frac{a}{b} = \\sqrt{c}$$\n\nAnd $x^2$ inline.\n"
      })
    });

    return answer.status;
  });
  check("(a document with maths in it)", made, 201);

  await page.goto(`${server.origin}/typeset.md`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#docContent .katex", { state: "attached", timeout: 30000 });

  const maths = await page.evaluate(() => {
    /* The visible half only. KaTeX puts the original TeX in an
     * <annotation> inside the MathML it hides for screen readers, so the
     * document's textContent contains "\frac" whether it typeset or not —
     * which is what this check got wrong the first time it was written.
     */
    const visible = [...document.querySelectorAll("#docContent .katex-html")]
      .map((one) => one.textContent).join(" ");
    // KaTeX's own block wrapper, not the app's: the app's is a span and
    // measures nothing.
    const display = document.querySelector("#docContent .katex-display");

    return {
      katex: typeof window.katex !== "undefined",
      autoRender: typeof window.renderMathInElement !== "undefined",
      typeset: document.querySelectorAll("#docContent .katex").length,
      // The hidden MathML is what a screen reader reads and what the export
      // strips; it is also the half of the output that the visible one is
      // measured against.
      spoken: document.querySelectorAll("#docContent .katex-mathml").length,
      // Laid out, which is the thing jsdom cannot answer: a fraction is taller
      // than the line it sits on.
      tall: display ? display.getBoundingClientRect().height : 0,
      raw: visible.includes("\\frac") || visible.includes("\\sqrt"),
      // The stylesheet arrived too: without it every glyph is unspaced.
      styled: getComputedStyle(document.querySelector("#docContent .katex")).fontFamily
    };
  });

  check("KaTeX arrived from the CDN and passed its hash", maths.katex, true);
  check("...and the auto-render contrib script with it", maths.autoRender, true);
  check("...and typeset both the block and the inline maths", maths.typeset >= 2, true);
  check("...leaving the MathML a screen reader reads", maths.spoken >= 2, true);
  check("...with no raw TeX left in what a reader sees", maths.raw, false);
  check("...the formula is laid out rather than a line of text", maths.tall > 20, true);
  check("...and its stylesheet arrived, so it is set in the maths font",
    /katex|Main|Math/i.test(maths.styled), true);
  check("typesetting it complained about nothing", problems, []);

  /* And a diagram, which only a browser can answer for — because what is
   * being checked is what happens when the drawing is rasterised.
   *
   * Word and PDF turn each diagram into a PNG the same way: serialise the
   * SVG, load it through an <img>, draw it on a canvas. Inside an <img> an
   * SVG is on its own, with none of the page's CSS — so a drawing that is
   * styled from the page rather than from itself comes out as an empty
   * frame. Mermaid writes its own <style> into the SVG, which is what makes
   * this work, and this is the check that says so.
   *
   * jsdom cannot answer any of it: no layout, no rasteriser and a stubbed
   * Mermaid, so the suites that stub it would pass either way.
   */
  const diagramMade = await page.evaluate(async () => {
    const session = await (await fetch("/api/session")).json();
    const answer = await fetch("/api/docs", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken },
      body: JSON.stringify({
        fileName: "drawn.md",
        overwrite: true,
        content: "# Drawn\n\n```mermaid\nflowchart TD\n    A[Run the tests] --> B[Ship it<br/>today]\n```\n"
      })
    });
    return answer.status;
  });
  check("(a document with a diagram in it)", [200, 201].includes(diagramMade), true);

  await page.goto(`${server.origin}/drawn.md`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#docContent .mermaid-block svg", { state: "attached", timeout: 30000 });

  const diagram = await page.evaluate(async () => {
    const svg = /** @type {SVGGraphicsElement} */ (
      document.querySelector("#docContent .mermaid-block svg"));
    const box = svg.getBBox();

    // The export's own steps, on the same drawing, with and without its
    // words — so the answer is the picture rather than the markup.
    const pixelsOf = async (wordless) => {
      const clone = /** @type {SVGElement} */ (svg.cloneNode(true));
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("width", String(Math.round(box.width)));
      clone.setAttribute("height", String(Math.round(box.height)));

      if (wordless) {
        for (const words of clone.querySelectorAll("text, foreignObject")) {
          words.remove();
        }
      }

      const source = new XMLSerializer().serializeToString(clone);
      const picture = new Image();
      const loaded = new Promise((done) => {
        picture.onload = () => done(true);
        picture.onerror = () => done(false);
      });

      picture.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
      if (!(await loaded)) {
        return null;
      }

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(box.width);
      canvas.height = Math.round(box.height);
      const paper = canvas.getContext("2d");
      paper.drawImage(picture, 0, 0, canvas.width, canvas.height);
      return paper.getImageData(0, 0, canvas.width, canvas.height).data;
    };

    const withWords = await pixelsOf(false);
    const without = await pixelsOf(true);

    let differing = 0;
    if (withWords && without) {
      for (let at = 0; at < withWords.length; at += 4) {
        if (withWords[at] !== without[at]
          || withWords[at + 1] !== without[at + 1]
          || withWords[at + 2] !== without[at + 2]
          || withWords[at + 3] !== without[at + 3]) {
          differing += 1;
        }
      }
    }

    return { rasterised: Boolean(withWords), pixelsTheWordsDraw: differing };
  });

  check("the drawing rasterises the way every export rasterises it",
    diagram.rasterised, true);
  check("...and its words are in the picture, not only in the markup",
    diagram.pixelsTheWordsDraw > 0, true);

  /* And the export's copy of it describes itself.
   *
   * On the page a Mermaid drawing is sized by the column it sits in: width
   * "100%", no height, no viewBox, overflow hidden, a max-width in pixels,
   * and a transform saying where the pan-and-zoom window is. All of that is
   * about the app's layout and all of it used to travel into the export —
   * where nothing scales a viewBox-less SVG, so a page narrower than the app
   * took the right-hand side off the drawing. Measured before this changed:
   * viewBox null, width "100%".
   */
  const exported = await page.evaluate(async () => {
    const article = document.getElementById("docContent");
    const built = await window.ExportSnapshot.build({ title: "Drawn", article });
    const html = String(built.html || built);

    // Dropped into a page narrower than the app's column, which is what a
    // printed sheet and somebody else's window both are.
    const holder = document.createElement("div");
    holder.style.cssText = "position:fixed;left:-10000px;top:0;width:480px";
    holder.innerHTML = html.replace(/<\/?(html|head|body)[^>]*>/g, "");
    document.body.appendChild(holder);
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));

    const svg = /** @type {SVGGraphicsElement} */ (holder.querySelector(".mermaid-block svg"));
    const facts = svg
      ? {
        viewBox: svg.getAttribute("viewBox"),
        width: svg.getAttribute("width"),
        overflow: svg.style.overflow || "",
        drawnWidth: Math.round(svg.getBBox().width),
        shown: Math.round(svg.getBoundingClientRect().width)
      }
      : null;

    holder.remove();
    return facts;
  });

  check("the export's copy of a diagram carries its own bounds",
    /^[\d.-]+ [\d.-]+ [\d.]+ [\d.]+$/.test(exported?.viewBox || ""), true);
  check("...and a size in its own units rather than the column's",
    /^\d+$/.test(exported?.width || ""), true);
  check("...with the rule that did the cutting taken off",
    exported?.overflow, "");
  check("...so all of it is inside the box it is given",
    exported.drawnWidth > 0 && exported.shown > 0, true);
  check("drawing it complained about nothing", problems, []);

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
