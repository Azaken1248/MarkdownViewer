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
  appSource: readAppSource, modelScriptPaths, drawScriptPaths
} = require("./app-source.js");
const { JSDOM } = require("jsdom");
const { startTestServer, SEED_USERNAME, SEED_PASSWORD, TEST_PASSWORD } = require("./helpers/server");

const ROOT = path.join(__dirname, "..", "public");
const pageHtml = fs.readFileSync(path.join(ROOT, "diagram.html"), "utf8");
// The shell routes, which is where the reserved prefixes live.
const pagesSource = fs.readFileSync(path.join(__dirname, "..", "lib", "routes", "pages.js"), "utf8");

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

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

    const response = await fetch(target.href, {
      ...options,
      headers: { ...(options.headers || {}), Cookie: cookie }
    });

    return {
      ok: response.ok,
      status: response.status,
      json: () => response.json(),
      // Saving a picture asks for the app's own stylesheet, which is text.
      text: () => response.text()
    };
  };

  // theme-boot.js first, and for the same reason the page loads it in <head>:
  // it settles the theme before anything paints, and it is where the switch the
  // bar wires up lives.
  window.eval(fs.readFileSync(path.join(ROOT, "js", "theme-boot.js"), "utf8"));
  window.eval(fs.readFileSync(path.join(ROOT, "js", "visual-editor.js"), "utf8"));
  for (const file of modelScriptPaths(ROOT)) {
    window.eval(fs.readFileSync(file, "utf8"));
  }
  window.eval(fs.readFileSync(path.join(ROOT, "js", "diagram-icons.js"), "utf8"));
  for (const file of drawScriptPaths(ROOT)) {
    window.eval(fs.readFileSync(file, "utf8"));
  }
  for (const file of ["diagram-editor.js", "diagram-page.js"]) {
    window.eval(fs.readFileSync(path.join(ROOT, "js", file), "utf8"));
  }

  // The page fetches before it draws, so waiting a fixed moment is waiting on a
  // network round trip and hoping. Wait for the page to have finished instead:
  // a canvas with a diagram on it, or a message saying why there is not one.
  await waitFor(window, () => window.document.querySelector(".dd-node, .diagram-page-empty"));

  return { window, document: window.document, requested };
}

function openPage({ url, cookie, origin, stash = null, panels = null }) {
  const dom = new JSDOM(pageHtml, { url, runScripts: "outside-only", pretendToBeVisual: true });
  // What the browser was left holding, before the editor is built and reads it.
  if (panels !== null) {
    dom.window.localStorage.setItem("azadocs:diagram:panels", panels);
  }

  if (stash !== null) {
    dom.window.sessionStorage.setItem(`azadocs:diagram:${new URL(url).pathname.replace(/^\/diagram\/(?:doc|file)\//, "")}`, stash);
  }

  return boot(dom, { cookie, origin }).then((page) => ({ ...page, dom }));
}

// Click Save and wait for it to have happened. A fixed pause here is a pause
// racing a real HTTP round trip, and the race is won often enough to make a
// broken check look like a passing one.
async function saveAndWait(page) {
  page.document.getElementById("diagramSave").click();
  await waitFor(page.window,
    () => /^Saved/.test(page.document.getElementById("diagramStatus").textContent),
    `the save never finished: the page says "${page.document.getElementById("diagramStatus").textContent}"`);
}

async function waitFor(window, done, what = "the page never finished starting up", timeoutMs = 4000) {
  const started = Date.now();
  while (!done()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(what);
    }

    await settle();
  }

  return done();
}

(async () => {
  const server = await startTestServer();
  console.log(`  (test server on ${server.origin})`);

  let cookie = "";
  try {
    const login = await server.request("POST", "/api/auth/login",
      { username: SEED_USERNAME, password: SEED_PASSWORD });
    const jar = new Map();
    const absorb = (headers) => {
      for (const raw of headers["set-cookie"] || []) {
        const [pair] = raw.split(";");
        const at = pair.indexOf("=");
        jar.set(pair.slice(0, at).trim(), pair.slice(at + 1));
      }
      cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    };

    absorb(login.headers);
    const changed = await server.request("POST", "/api/auth/password",
      { currentPassword: SEED_PASSWORD, newPassword: TEST_PASSWORD },
      { Cookie: cookie, "X-CSRF-Token": login.body.csrfToken });
    absorb(changed.headers);

    await run(server, cookie);
  } finally {
    await server.stop();
  }

  console.log(failures === 0 ? "\nALL DIAGRAM PAGE CHECKS PASSED" : `\n${failures} DIAGRAM PAGE CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function run(server, cookie) {
  const origin = server.origin;

  /* The checks themselves, in eight files beside this one.
   *
   * Each boots its own page or reuses the one the last left open, in this
   * order, the way somebody working on a diagram would. What they share is the
   * harness above, handed over rather than reached for.
   */
  const ctx = {
    check, server, cookie, origin, fs, path, ROOT, JSDOM, pageHtml, pagesSource,
    DIAGRAM_DOC, SETTLE, settle, boot, openPage, saveAndWait, waitFor,
    csrfFor, addressOf, dragBox, readAppSource
  };

  await require("./diagram-page/documents.js")(ctx);
  await require("./diagram-page/furniture.js")(ctx);
  await require("./diagram-page/moving.js")(ctx);
  await require("./diagram-page/dressing.js")(ctx);
  await require("./diagram-page/typography.js")(ctx);
  await require("./diagram-page/bar.js")(ctx);
  await require("./diagram-page/arrows.js")(ctx);
  await require("./diagram-page/carrying.js")(ctx);

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
  dom.window.eval(fs.readFileSync(path.join(ROOT, "js", "visual-editor.js"), "utf8"));
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
