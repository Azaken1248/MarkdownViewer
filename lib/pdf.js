/* Drawing a PDF with the engine that already knows how.
 *
 * The export is laid out in the reader's browser — the pages are measured and
 * cut there, the sheets are styled there, the diagrams are fitted there — and
 * what arrives here is one self-contained HTML file: every stylesheet inlined,
 * every font embedded, every picture a data URI, and the ink over the top of
 * it. Nothing in it points anywhere.
 *
 * What is missing from a browser tab is the thing underneath it. Chromium's
 * PDF backend embeds a subset of each font, writes the text as text and the
 * diagrams as vectors, and is unreachable from a page: only a browser driven
 * from outside can ask for it. So the page builds the document and this draws
 * it, which is how every other HTML-to-PDF tool is arranged and is the reason
 * the output is a tenth the size with the words actually in it.
 *
 * It is optional. With no browser installed this says so and the export falls
 * back to the one the page can write by itself.
 *
 * What it will not do is fetch anything. The document is self-contained by
 * construction, so every request the page makes is refused and scripts are
 * turned off — which leaves the HTML and CSS parsers as the whole of what
 * somebody posting a document here can reach.
 */

const IDLE_SHUTDOWN_MS = 120000;

// A page that has not finished in this long is a page that is not going to.
const RENDER_TIMEOUT_MS = 30000;

// Fonts are data URIs and load with the document, but the first layout after
// `load` is not always the one that has them. A frame is enough.
const SETTLE_MS = 120;

function createPdfRenderer({ executablePath = null, log = null } = {}) {
  let browser = null;
  let starting = null;
  let idleTimer = null;
  let working = 0;

  /* One browser, kept while it is being used and let go when it is not.
   *
   * Starting Chromium is about a second, which is most of a short export, and
   * leaving it running forever is a quarter of a gigabyte of resident memory
   * on a box whose job is serving markdown. So it stays for as long as
   * exports keep arriving and shuts down two minutes after the last one.
   */
  async function open() {
    if (browser) {
      return browser;
    }

    if (!starting) {
      starting = launch().finally(() => {
        starting = null;
      });
    }

    return starting;
  }

  async function launch() {
    const { chromium } = require("playwright-core");
    browser = await chromium.launch({
      ...(executablePath ? { executablePath } : {}),
      args: ["--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"]
    });

    // A browser that dies on its own — out of memory, killed by the host —
    // must not leave a handle behind that every later export waits on.
    browser.on("disconnected", () => {
      browser = null;
    });

    log?.info?.("pdf renderer started");
    return browser;
  }

  function holdOpen() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (working === 0 && browser) {
        const going = browser;
        browser = null;
        void going.close().catch(() => {});
        log?.info?.("pdf renderer idle, stopped");
      }
    }, IDLE_SHUTDOWN_MS);

    idleTimer.unref?.();
  }

  /* One document, as the bytes of a PDF.
   *
   * `preferCSSPageSize` is what makes the sheets the pages: the document says
   * A4 with no margin and means it, because its margins are inside each sheet
   * so that the background reaches the edge of the paper.
   */
  async function render(html) {
    const engine = await open();
    const context = await engine.newContext({
      // Nothing in the document needs it, and without it the HTML and CSS
      // parsers are the whole of the surface this exposes.
      javaScriptEnabled: false
    });

    working += 1;

    try {
      const page = await context.newPage();
      // The document is self-contained. Anything it asks for is something it
      // should not have, so nothing is fetched.
      await page.route("**/*", (route) => route.abort());
      await page.setContent(html, { waitUntil: "load", timeout: RENDER_TIMEOUT_MS });
      await page.waitForTimeout(SETTLE_MS);

      return await page.pdf({
        preferCSSPageSize: true,
        printBackground: true,
        margin: { top: "0", bottom: "0", left: "0", right: "0" },
        timeout: RENDER_TIMEOUT_MS
      });
    } finally {
      working -= 1;
      await context.close().catch(() => {});
      holdOpen();
    }
  }

  /* Whether this deployment has a browser at all.
   *
   * Asked once and remembered as the promise rather than as its answer, so
   * that two requests arriving together ask once between them — and so that
   * the second waits for the first's answer instead of starting a second
   * browser to find out.
   */
  let availability = null;

  function available() {
    availability = availability || open().then(() => true, (error) => {
      log?.warn?.("pdf renderer unavailable", { reason: String(error.message).slice(0, 200) });
      return false;
    });

    return availability;
  }

  async function close() {
    clearTimeout(idleTimer);
    const going = browser;
    browser = null;
    await going?.close().catch(() => {});
  }

  return { render, available, close, RENDER_TIMEOUT_MS };
}

module.exports = { createPdfRenderer, IDLE_SHUTDOWN_MS, RENDER_TIMEOUT_MS };
