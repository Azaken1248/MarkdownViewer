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
const { JSDOM } = require("jsdom");
const { startTestServer, SEED_USERNAME, SEED_PASSWORD, TEST_PASSWORD } = require("./helpers/server");

const ROOT = path.join(__dirname, "..", "public");
const pageHtml = fs.readFileSync(path.join(ROOT, "diagram.html"), "utf8");
const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

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

  const requested = [];
  window.fetch = async (input, options = {}) => {
    const target = new URL(String(input), origin);
    requested.push({ url: target.pathname, method: String(options.method || "GET").toUpperCase() });

    const response = await fetch(target.href, {
      ...options,
      headers: { ...(options.headers || {}), Cookie: cookie }
    });

    return { ok: response.ok, status: response.status, json: () => response.json() };
  };

  for (const file of ["visual-editor.js", "diagram-model.js", "diagram-draw.js", "diagram-editor.js", "diagram-page.js"]) {
    window.eval(fs.readFileSync(path.join(ROOT, "js", file), "utf8"));
  }

  // The page fetches before it draws, so waiting a fixed moment is waiting on a
  // network round trip and hoping. Wait for the page to have finished instead:
  // a canvas with a diagram on it, or a message saying why there is not one.
  await waitFor(window, () => window.document.querySelector(".dd-node, .diagram-page-empty"));

  return { window, document: window.document, requested };
}

function openPage({ url, cookie, origin, stash = null }) {
  const dom = new JSDOM(pageHtml, { url, runScripts: "outside-only", pretendToBeVisual: true });
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

  console.log("=== the page has an address of its own ===");
  {
    // A document path is a document path wherever it appears, so /diagram/doc/
    // has to be kept out of the shell route or opening the editor would serve
    // the app instead.
    check("the editor's address is not read as a document",
      /SHELL_RESERVED_PREFIXES = \[[^\]]*"\/diagram"/.test(serverSource), true);

    for (const [what, url] of [
      ["a fence inside a document", "/diagram/doc/Notes/deploy.md"],
      ["a diagram file", "/diagram/file/plan.mmd"]
    ]) {
      const res = await server.request("GET", url, undefined, { Cookie: cookie });
      check(`${what} gets the editor page`, res.status, 200);
      check("...which is the editor and not the app", /diagram-page\.js/.test(res.raw), true);
    }

    // Same reason the document shell does not: answering differently for a real
    // path and an imaginary one is a list of what is in the library.
    const missing = await server.request("GET", "/diagram/doc/nothing/here.md", undefined, { Cookie: cookie });
    check("a document that is not there gets the same page as one that is", missing.status, 200);

    const signedOut = await server.request("GET", "/diagram/doc/Notes/deploy.md");
    check("...and so does a reader with no session", signedOut.status, 200);

    const nonsense = await server.request("GET", "/diagram/elsewhere", undefined, { Cookie: cookie });
    check("an address that names neither is not the editor", nonsense.status, 404);
  }

  console.log("=== a diagram inside a document ===");
  {
    const made = await server.request("POST", "/api/docs",
      { fileName: "deploy.md", content: DIAGRAM_DOC, overwrite: true },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });
    check("the fixture document is there to be edited", made.status, 201);

    const address = addressOf(DIAGRAM_DOC, 0);
    const page = await openPage({
      url: `${origin}/diagram/doc/deploy.md#${address}`,
      cookie,
      origin
    });

    check("the page reads the document it was opened on",
      page.requested.some((one) => one.url === "/api/docs/deploy.md"), true);
    check("...and draws the diagram that was in it",
      page.document.querySelectorAll(".dd-node").length, 2);
    check("...naming the file it belongs to",
      page.document.getElementById("diagramTitle").textContent, "deploy.md");
    check("nothing is saveable until something is changed",
      page.document.getElementById("diagramSave").disabled, true);

    // Move a box. That is an edit to the layout comments and nothing else, and
    // it is the smallest edit the canvas can make.
    dragBox(page.window, "A", 60, 40);
    await settle();

    check("moving a box makes the diagram saveable",
      page.document.getElementById("diagramSave").disabled, false);

    page.document.getElementById("diagramSave").click();
    await settle();

    const saved = await server.request("GET", "/api/docs/deploy.md", undefined, { Cookie: cookie });
    check("saving writes the document back", /%% @ A /.test(saved.body.content), true);
    check("...with everything around the diagram untouched",
      saved.body.content.startsWith("# Deployment\n\nBefore the diagram.\n\n```mermaid\n"), true);
    check("...and the prose after it still after it",
      saved.body.content.endsWith("```\n\nAfter the diagram.\n"), true);
    check("...and it is still a mermaid fence",
      (saved.body.content.match(/```/g) || []).length, 2);
  }

  console.log("=== a stash belongs to one document ===");
  {
    // The stash is keyed by the document it holds, and a page that reached for
    // any stash at all would open one document with the contents of another.
    await server.request("POST", "/api/docs",
      { fileName: "other.md", content: DIAGRAM_DOC, overwrite: true },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const address = addressOf(DIAGRAM_DOC, 0);
    const dom = new JSDOM(pageHtml, {
      url: `${origin}/diagram/doc/other.md#${address}`,
      runScripts: "outside-only",
      pretendToBeVisual: true
    });
    dom.window.sessionStorage.setItem("azadocs:diagram:something-else.md", "# Not this one\n");

    const page = await boot(dom, { cookie, origin });
    check("a stash for another document is not used",
      page.requested.some((one) => one.url === "/api/docs/other.md"), true);
    check("...and the diagram that opens is the one in this document",
      page.document.querySelectorAll(".dd-node").length, 2);
  }

  console.log("=== ...and comes back the same way ===");
  {
    const unsaved = DIAGRAM_DOC.replace("Before the diagram.", "Before the diagram, edited and not saved.");
    const address = addressOf(unsaved, 0);
    const url = `${origin}/diagram/doc/deploy.md#${address}`;

    const page = await openPage({ url, cookie, origin, stash: unsaved });
    const dom = page.dom;

    check("the stashed document is used instead of the file",
      page.requested.some((one) => one.url === "/api/docs/deploy.md"), false);
    check("...and the diagram in it is the one that is drawn",
      page.document.querySelectorAll(".dd-node").length, 2);

    dragBox(page.window, "A", 60, 40);
    await settle();
    page.document.getElementById("diagramSave").click();
    await settle();

    const held = dom.window.sessionStorage.getItem("azadocs:diagram:deploy.md");
    check("saving puts the whole document back where it came from",
      held.includes("Before the diagram, edited and not saved."), true);
    check("...with the diagram changed", /%% @ A /.test(held), true);

    const onDisk = await server.request("GET", "/api/docs/deploy.md", undefined, { Cookie: cookie });
    check("...and nothing at all written to the file",
      onDisk.body.content.includes("edited and not saved"), false);
  }

  console.log("=== a diagram whose block is gone is not written anywhere ===");
  {
    const address = addressOf(DIAGRAM_DOC, 0);
    const url = `${origin}/diagram/doc/deploy.md#${address}`;

    const page = await openPage({ url, cookie, origin, stash: DIAGRAM_DOC });
    const dom = page.dom;

    dragBox(page.window, "A", 60, 40);
    await settle();

    // Somebody deleted the block in the other tab while this one was open.
    dom.window.sessionStorage.setItem("azadocs:diagram:deploy.md", "# Deployment\n\nNo diagram any more.\n");
    page.document.getElementById("diagramSave").click();
    await settle();

    check("the page says the block is gone",
      /no longer in the document/i.test(page.document.getElementById("diagramStatus").textContent), true);
    check("...and writes nothing over what is there now",
      dom.window.sessionStorage.getItem("azadocs:diagram:deploy.md"),
      "# Deployment\n\nNo diagram any more.\n");
  }

  console.log("=== a diagram file is the whole file ===");
  {
    const made = await server.request("POST", "/api/docs",
      { fileName: "plan.mmd", content: "flowchart LR\n  Start --> Finish\n", overwrite: true },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });
    check("the fixture diagram file is there to be edited", made.status, 201);

    const page = await openPage({ url: `${origin}/diagram/file/plan.mmd`, cookie, origin });
    check("a .mmd file opens with no address at all",
      page.document.querySelectorAll(".dd-node").length, 2);

    dragBox(page.window, "Start", 60, 40);
    await settle();
    page.document.getElementById("diagramSave").click();
    await settle();

    const saved = await server.request("GET", "/api/docs/plan.mmd", undefined, { Cookie: cookie });
    check("saving writes the diagram and nothing around it",
      saved.body.content.startsWith("flowchart LR\n"), true);
    check("...with its arrangement in it", /%% @ Start /.test(saved.body.content), true);
    check("...and no fence wrapped round it", saved.body.content.includes("```"), false);
    check("...ending in one newline, the way a file does",
      /[^\n]\n$/.test(saved.body.content), true);
  }

  console.log("=== a diagram says more than the canvas can change ===");
  {
    /* The canvas has controls for boxes and arrows. A diagram can say more than
     * that — what colour a class is, what layers there are, keys written by a
     * later version of this editor than the one open. None of it can be edited
     * here yet, and every bit of it has to come back out unchanged: an editor
     * that quietly drops what it has no button for is an editor that eats work.
     */
    const coloured = [
      "flowchart TD",
      "    %% layout v1",
      "    %% @ A 40,40 120x50 shadow=soft",
      "    %% @ B 40,200 120x50",
      "    %% layer 2 \"Back end\" locked",
      "    A[One]:::blue",
      "    B[Two]",
      "    A --> B",
      "    classDef blue fill:#2b6cb0,stroke:#1a365d",
      "    style B fill:#eee"
    ].join("\n") + "\n";

    await server.request("POST", "/api/docs",
      { fileName: "styled.mmd", overwrite: true, content: coloured },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/styled.mmd`, cookie, origin });
    check("a coloured diagram opens", page.document.querySelectorAll(".dd-node").length, 2);

    dragBox(page.window, "A", 60, 40);
    await saveAndWait(page);

    const saved = (await server.request("GET", "/api/docs/styled.mmd", undefined, { Cookie: cookie })).body.content;
    check("moving a box moves the box", /%% @ A (?!40,40)/.test(saved), true);
    // The class each box wears was never in danger — it is written on the box.
    // What went missing was what the class means, which left the names behind
    // pointing at nothing.
    check("...and what its colour means is still there",
      saved.includes("classDef blue fill:#2b6cb0,stroke:#1a365d"), true);
    check("...along with the box that wears it", saved.includes("class A blue"), true);
    check("...the one-off colour on the other box", saved.includes("style B fill:#eee"), true);
    check("...the layer nothing here can show yet",
      saved.includes('%% layer 2 "Back end" locked'), true);
    check("...and a key written by a version this one has never met",
      saved.includes("shadow=soft"), true);
  }

  console.log("=== the diagram is somewhere you are looking at part of ===");
  {
    await server.request("POST", "/api/docs",
      { fileName: "wide.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 120x60",
        "    %% @ B 100,400 120x60",
        "    A[One]",
        "    B[Two]",
        "    A --> B"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/wide.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const svg = () => canvas.querySelector("svg");
    const view = () => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\) scale\(([\d.]+)\)/
        .exec(svg().querySelector(".dd-view").getAttribute("transform"));
      return { x: Number(found[1]), y: Number(found[2]), scale: Number(found[3]) };
    };

    // The harness reports a 900x600 canvas, and the diagram is 320 tall by the
    // time its margins are counted, so the whole of it fits without magnifying.
    check("a diagram opens with the whole of it in view", view().scale, 1);
    check("...centred on where the diagram is, not on where a picture of it would be",
      [Math.round(view().x), Math.round(view().y)], [290, 20]);

    const source = () => window.eval("document.getElementById('diagramSave').disabled");
    check("looking at a diagram is not editing it", source(), true);

    /* --- panning ---------------------------------------------------------- */

    const at = (x, y, extra = {}) => ({ clientX: x, clientY: y, bubbles: true, ...extra });
    const started = view();

    const finger = (type, x, y, id = 9) => {
      const event = new window.MouseEvent(type, at(x, y, { cancelable: true }));
      Object.defineProperty(event, "pointerType", { value: "touch" });
      Object.defineProperty(event, "pointerId", { value: id });
      return event;
    };

    // The empty paper, under a finger. A finger has no space bar and no middle
    // button, so dragging the paper is the only way it can go anywhere.
    canvas.dispatchEvent(finger("pointerdown", 700, 500));
    canvas.dispatchEvent(finger("pointermove", 760, 460));
    await new Promise((r) => setTimeout(r, 60));
    canvas.dispatchEvent(finger("pointerup", 760, 460));

    check("dragging the paper with a finger moves the view by exactly that much",
      [view().x - started.x, view().y - started.y], [60, -40]);
    check("...at the same zoom it was", view().scale, started.scale);
    check("...and moves nothing in the diagram", source(), true);

    /* --- zooming ---------------------------------------------------------- */

    const before = view();
    const aimed = { x: 400, y: 300 };
    // What the pointer is over, in the diagram, before the wheel turns.
    const under = {
      x: (aimed.x - before.x) / before.scale,
      y: (aimed.y - before.y) / before.scale
    };

    canvas.dispatchEvent(new window.window.WheelEvent("wheel",
      { clientX: aimed.x, clientY: aimed.y, deltaY: -100, bubbles: true, cancelable: true }));

    const zoomed = view();
    check("the wheel zooms in", zoomed.scale > before.scale, true);
    // The whole point of zooming about the pointer: the thing you are pointing
    // at is the thing that stays put, and everything else moves around it.
    check("...about the pointer, so what was under it still is", [
      Math.round(((under.x * zoomed.scale) + zoomed.x) - aimed.x),
      Math.round(((under.y * zoomed.scale) + zoomed.y) - aimed.y)
    ], [0, 0]);

    canvas.dispatchEvent(new window.window.WheelEvent("wheel",
      { clientX: aimed.x, clientY: aimed.y, deltaY: 100, bubbles: true, cancelable: true }));
    check("...and the other way turns it back", Math.round(view().scale * 1000),
      Math.round(before.scale * 1000));

    check("the grid moves with the diagram rather than staying behind it",
      svg().querySelector("pattern").getAttribute("patternTransform"),
      svg().querySelector(".dd-view").getAttribute("transform"));

    check("zooming is not editing either", source(), true);

    /* --- the readout ------------------------------------------------------ */

    const field = page.document.querySelector(".ve-diagram-zoom-value");
    check("the zoom says what it is", field.value, "100%");

    field.value = "250";
    field.dispatchEvent(new window.Event("change", { bubbles: true }));
    check("...and can be told what to be", view().scale, 2.5);
    check("...saying so afterwards in the same words", field.value, "250%");

    // Free, not stepped: a zoom that clicks through fixed sizes cannot stop
    // where the thing being worked on happens to fit.
    field.value = "137";
    field.dispatchEvent(new window.Event("change", { bubbles: true }));
    check("a zoom can be any size at all", view().scale, 1.37);

    field.value = "9000";
    field.dispatchEvent(new window.Event("change", { bubbles: true }));
    check("...up to a point", view().scale, 8);
    field.value = "0.01";
    field.dispatchEvent(new window.Event("change", { bubbles: true }));
    check("...and down to one", view().scale, 0.1);
    field.value = "not a number";
    field.dispatchEvent(new window.Event("change", { bubbles: true }));
    check("...and nonsense leaves it where it was", view().scale, 0.1);

    /* --- fit -------------------------------------------------------------- */

    const fit = [...page.document.querySelectorAll(".ve-diagram-zoom-step")].pop();
    fit.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    // The diagram is 120 wide by 360 tall and its top-left corner is at
    // (100, 100). In a 900x600 window that fits at life size, centred — which
    // is a fit of the diagram where it actually is, not of a rectangle that
    // starts at the origin and happens to contain it.
    check("fit puts the whole diagram back in view", view().scale, 1);
    check("...centred on the diagram itself, wherever it happens to be",
      [Math.round(view().x), Math.round(view().y)], [290, 20]);

    /* --- the space bar ----------------------------------------------------- */

    const box = canvas.querySelector('.dd-node[data-id="A"]');
    const boxAt = () => /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(box.getAttribute("transform"));
    const wasAt = boxAt()[0];
    const held = view();

    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: " ", bubbles: true }));
    // The same press that would have moved a box, with space held down.
    box.dispatchEvent(new window.MouseEvent("pointerdown", at(200, 200)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(230, 210)));
    await new Promise((r) => setTimeout(r, 60));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(230, 210)));

    check("space held turns a drag on a box into a pan",
      [view().x - held.x, view().y - held.y], [30, 10]);
    check("...and leaves the box exactly where it was",
      canvas.querySelector('.dd-node[data-id="A"]').getAttribute("transform"), wasAt);
    check("...and the diagram unedited", source(), true);

    canvas.dispatchEvent(new window.KeyboardEvent("keyup", { key: " ", bubbles: true }));
    const after = view();
    box.dispatchEvent(new window.MouseEvent("pointerdown", at(200, 200)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(230, 210)));
    await new Promise((r) => setTimeout(r, 60));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(230, 210)));
    check("...and letting go of it gives the box back",
      [view().x - after.x, view().y - after.y], [0, 0]);
    check("...which is an edit, unlike everything above it", source(), false);

    /* --- a pixel is not a unit ---------------------------------------------- */

    // Looked at twice life size, a box dragged a hundred pixels across the
    // screen has moved fifty in the diagram — and it is the diagram the file
    // records. This is the one place the zoom has to be divided out rather than
    // cancelling itself in a difference.
    field.value = "200";
    field.dispatchEvent(new window.Event("change", { bubbles: true }));

    const magnified = canvas.querySelector('.dd-node[data-id="B"]');
    const wasThere = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(magnified.getAttribute("transform"));

    magnified.dispatchEvent(new window.MouseEvent("pointerdown", at(300, 300)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(400, 380)));
    await new Promise((r) => setTimeout(r, 80));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(400, 380)));

    const nowThere = /translate\((-?[\d.]+),(-?[\d.]+)\)/
      .exec(canvas.querySelector('.dd-node[data-id="B"]').getAttribute("transform"));
    check("a box dragged at twice life size moves half as far in the diagram",
      [Number(nowThere[1]) - Number(wasThere[1]), Number(nowThere[2]) - Number(wasThere[2])],
      [50, 40]);

    fit.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    /* --- the middle button -------------------------------------------------- */

    const middled = view();
    canvas.dispatchEvent(new window.MouseEvent("pointerdown", at(200, 200, { button: 1 })));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(150, 250)));
    await new Promise((r) => setTimeout(r, 60));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(150, 250)));
    check("the middle button pans wherever it is pressed",
      [view().x - middled.x, view().y - middled.y], [-50, 50]);

    /* --- two fingers -------------------------------------------------------- */

    // A pinch begins as one finger doing something else, and the something else
    // has to be abandoned rather than finished — otherwise every pinch leaves a
    // box wherever the first finger happened to be when the second arrived.
    const pinched = view();
    const touch = (type, id, x, y) => {
      const event = new window.MouseEvent(type, at(x, y, { cancelable: true }));
      Object.defineProperty(event, "pointerType", { value: "touch" });
      Object.defineProperty(event, "pointerId", { value: id });
      return event;
    };

    // Saved first, so that what the file says about where A is, is what it said
    // before any of this — and a pinch that moved it has somewhere to show.
    await saveAndWait(page);
    const placedBefore = /%% @ A (-?\d+),(-?\d+)/
      .exec((await server.request("GET", "/api/docs/wide.mmd", undefined, { Cookie: cookie })).body.content);

    canvas.querySelector('.dd-node[data-id="A"]').dispatchEvent(touch("pointerdown", 1, 400, 300));
    canvas.dispatchEvent(touch("pointerdown", 2, 500, 300));
    canvas.dispatchEvent(touch("pointermove", 1, 350, 300));
    canvas.dispatchEvent(touch("pointermove", 2, 550, 300));
    canvas.dispatchEvent(touch("pointerup", 1, 350, 300));
    canvas.dispatchEvent(touch("pointerup", 2, 550, 300));
    await new Promise((r) => setTimeout(r, 60));

    check("fingers moving apart zoom in", view().scale > pinched.scale, true);
    check("...about the point between them",
      [Math.round(((450 - pinched.x) / pinched.scale * view().scale) + view().x),
        Math.round(((300 - pinched.y) / pinched.scale * view().scale) + view().y)], [450, 300]);

    // The finger that started on a box was doing something else, and two
    // fingers are a different intention. Finishing what the first one started
    // would leave a box wherever it happened to be when the second arrived —
    // which the drawing would not show for another quarter of a second, so this
    // asks the file rather than the screen.
    await saveAndWait(page);
    const placedAfter = /%% @ A (-?\d+),(-?\d+)/
      .exec((await server.request("GET", "/api/docs/wide.mmd", undefined, { Cookie: cookie })).body.content);
    check("...and the finger that was on a box does not take it along",
      [placedAfter[1], placedAfter[2]], [placedBefore[1], placedBefore[2]]);
  }

  console.log("=== a diagram is edited in handfuls as often as one box at a time ===");
  {
    await server.request("POST", "/api/docs",
      { fileName: "grid.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 80x40",
        "    %% @ B 300,100 80x40",
        "    %% @ C 100,300 80x40",
        "    %% @ D 300,300 80x40",
        "    A[One]",
        "    B[Two]",
        "    C[Three]",
        "    D[Four]",
        "    A --> B"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/grid.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const at = (x, y, extra = {}) => ({ clientX: x, clientY: y, bubbles: true, ...extra });
    const box = (id) => canvas.querySelector(`.dd-node[data-id="${id}"]`);
    const placed = (id) => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(box(id).getAttribute("transform"));
      return [Number(found[1]), Number(found[2])];
    };
    const ringed = () => canvas.querySelectorAll(".dd-ring").length;
    const framed = () => canvas.querySelectorAll(".dd-frame").length;

    // The view is fitted, so a point in the diagram is a point on the screen
    // plus wherever the fit put it.
    const view = () => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\) scale\(([\d.]+)\)/
        .exec(canvas.querySelector(".dd-view").getAttribute("transform"));
      return { x: Number(found[1]), y: Number(found[2]), scale: Number(found[3]) };
    };
    const onScreen = (x, y) => [(x * view().scale) + view().x, (y * view().scale) + view().y];

    const tap = (id, extra = {}) => {
      const [x, y] = onScreen(...placed(id));
      box(id).dispatchEvent(new window.MouseEvent("pointerdown", at(x + 10, y + 10, extra)));
      canvas.dispatchEvent(new window.MouseEvent("pointerup", at(x + 10, y + 10, extra)));
    };

    check("nothing is selected to begin with", [ringed(), framed()], [0, 0]);

    tap("A");
    check("tapping a box selects it, and only it", [ringed(), framed()], [1, 0]);
    check("...with the handles that belong to one box",
      canvas.querySelectorAll("[data-role]").length, 2);

    tap("B", { shiftKey: true });
    check("shift adds a second", [ringed(), framed()], [2, 1]);
    // Connecting and resizing are things you do to a box. Offering them on a
    // selection of four would be offering something that has no meaning yet.
    check("...and the handles go away, because they are about one box",
      canvas.querySelectorAll("[data-role]").length, 0);

    tap("B", { shiftKey: true });
    check("shift on one that is already in takes it back out", [ringed(), framed()], [1, 0]);

    /* --- the rubber band --------------------------------------------------- */

    const band = (x1, y1, x2, y2, extra = {}) => {
      const [sx, sy] = onScreen(x1, y1);
      const [ex, ey] = onScreen(x2, y2);
      canvas.dispatchEvent(new window.MouseEvent("pointerdown", at(sx, sy, extra)));
      canvas.dispatchEvent(new window.MouseEvent("pointermove", at(ex, ey, extra)));
      canvas.dispatchEvent(new window.MouseEvent("pointerup", at(ex, ey, extra)));
    };

    // A band drawn round the top two boxes, from empty paper above and left of
    // them to empty paper below and right.
    band(60, 60, 420, 180);
    check("a band round two boxes takes both", [ringed(), framed()], [2, 1]);

    band(60, 60, 200, 180);
    check("...and one round one takes one", [ringed(), framed()], [1, 0]);

    // Touched, not swallowed whole: a band you have to draw carefully is a band
    // that is no easier than clicking the boxes one at a time.
    band(60, 60, 140, 120);
    check("a band that only clips a box still takes it", [ringed(), framed()], [1, 0]);

    // A hand that moves two pixels while letting go of the paper has clicked
    // the paper, not drawn a band round the corner of the box next to it.
    band(99, 99, 102, 102);
    check("a press on the paper that wobbles is still a press on the paper",
      [ringed(), framed()], [0, 0]);

    band(60, 60, 420, 400);
    check("a band round everything takes everything", [ringed(), framed()], [4, 1]);

    band(600, 500, 700, 560);
    check("a band round nothing takes nothing", [ringed(), framed()], [0, 0]);

    tap("A");
    band(240, 240, 420, 400, { shiftKey: true });
    check("shift adds what a band catches to what was already there",
      [ringed(), framed()], [2, 1]);

    /* --- select all, and let go -------------------------------------------- */

    canvas.dispatchEvent(new window.KeyboardEvent("keydown",
      { key: "a", ctrlKey: true, bubbles: true }));
    check("select all selects all", [ringed(), framed()], [4, 1]);

    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    check("escape lets go of all of it", [ringed(), framed()], [0, 0]);

    /* --- dragging a handful ------------------------------------------------ */

    canvas.dispatchEvent(new window.KeyboardEvent("keydown",
      { key: "a", metaKey: true, bubbles: true }));

    const was = { A: placed("A"), B: placed("B"), C: placed("C"), D: placed("D") };
    const [gx, gy] = onScreen(...was.A);
    box("A").dispatchEvent(new window.MouseEvent("pointerdown", at(gx + 10, gy + 10)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(gx + 70, gy + 50)));
    await new Promise((r) => setTimeout(r, 60));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(gx + 70, gy + 50)));

    check("dragging one of them drags all of them", Object.keys(was).map((id) =>
      [placed(id)[0] - was[id][0], placed(id)[1] - was[id][1]]),
    [[60, 40], [60, 40], [60, 40], [60, 40]]);
    check("...and the selection is still what it was", [ringed(), framed()], [4, 1]);

    // Each box is put where it was plus how far the drag went, rather than
    // nudged by the difference since the last frame — which accumulates, and a
    // selection dragged across the canvas would come apart on the way.
    check("...so nothing has drifted out of line",
      [placed("B")[0] - placed("A")[0], placed("C")[1] - placed("A")[1]], [200, 200]);

    /* --- lining up --------------------------------------------------------- */

    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    // Dragged so its left edge lands five pixels past another box's left edge.
    // The grid alone would round that the other way, to ten past — so a box
    // that ends up exactly on the line got there by lining up, not by rounding.
    const nudgeOff = 5;
    const target = placed("B");
    const start = placed("D");
    tap("D");

    const [dx0, dy0] = onScreen(...start);
    const wantedX = target[0] + nudgeOff;
    box("D").dispatchEvent(new window.MouseEvent("pointerdown", at(dx0 + 5, dy0 + 5)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove",
      at(dx0 + 5 + (wantedX - start[0]), dy0 + 5)));
    await new Promise((r) => setTimeout(r, 60));

    check("a box dragged near another's edge is drawn on it, not near it",
      placed("D")[0], target[0]);
    // Two lines, not one: the drag was sideways, so the box is still level with
    // the one it started beside, and that is worth saying as well.
    const upright = [...canvas.querySelectorAll(".dd-guide")]
      .filter((line) => line.getAttribute("x1") === line.getAttribute("x2"));
    check("...with a line saying why", upright.length, 1);
    check("...and another for the row it is still in",
      canvas.querySelectorAll(".dd-guide").length, 2);
    check("...drawn on the edge the box went to",
      [Number(upright[0].getAttribute("x1")), Number(upright[0].getAttribute("x2"))],
      [target[0], target[0]]);
    check("...and long enough to reach both boxes",
      Number(upright[0].getAttribute("y2")) - Number(upright[0].getAttribute("y1")) > 200, true);

    canvas.dispatchEvent(new window.MouseEvent("pointerup",
      at(dx0 + 5 + (wantedX - start[0]), dy0 + 5)));
    check("...and where it is let go is where it stays", placed("D")[0], target[0]);
    check("...with the explanation gone once the drag is",
      canvas.querySelectorAll(".dd-guide").length, 0);

    // Far from anything, the grid is all there is, and the box lands on it.
    const loose = placed("D");
    const [lx, ly] = onScreen(...loose);
    box("D").dispatchEvent(new window.MouseEvent("pointerdown", at(lx + 5, ly + 5)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(lx + 5 + 137, ly + 5 + 73)));
    await new Promise((r) => setTimeout(r, 60));
    check("a box dragged nowhere near anything shows no lines",
      canvas.querySelectorAll(".dd-guide").length, 0);
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(lx + 5 + 137, ly + 5 + 73)));
    check("...and lands on the grid instead",
      [placed("D")[0] % 10, placed("D")[1] % 10], [0, 0]);

    // Five pixels is half a grid step, so the grid rounds it up to a whole one.
    // A box that came back to where it started would be one lining itself up
    // with itself, which is the one box it must never be compared against.
    const tiny = placed("D");
    const [tx, ty] = onScreen(...tiny);
    box("D").dispatchEvent(new window.MouseEvent("pointerdown", at(tx + 5, ty + 5)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(tx + 10, ty + 5)));
    await new Promise((r) => setTimeout(r, 60));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(tx + 10, ty + 5)));
    check("a box nudged half a grid step goes a whole one, not back where it was",
      placed("D")[0] - tiny[0], 10);

    // A line does not have to be on the grid. Nudge one box a single pixel off
    // it, then drag another up against it: the second has to land exactly on
    // the first, not on the nearest grid line to it.
    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    tap("D");
    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await new Promise((r) => setTimeout(r, 350));

    const offGrid = placed("D")[0];
    check("a box can sit off the grid to begin with", offGrid % 10 !== 0, true);

    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    const mover = placed("A");
    const [ax, ay] = onScreen(...mover);
    tap("A");
    box("A").dispatchEvent(new window.MouseEvent("pointerdown", at(ax + 5, ay + 5)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove",
      at(ax + 5 + (offGrid + 3 - mover[0]), ay + 5)));
    await new Promise((r) => setTimeout(r, 60));
    canvas.dispatchEvent(new window.MouseEvent("pointerup",
      at(ax + 5 + (offGrid + 3 - mover[0]), ay + 5)));

    check("...and a box lining up with it lands on it, not on the grid near it",
      placed("A")[0], offGrid);

    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    canvas.dispatchEvent(new window.KeyboardEvent("keydown",
      { key: "a", ctrlKey: true, bubbles: true }));

    /* --- and the arrow keys ------------------------------------------------ */

    const before = { A: placed("A"), D: placed("D") };
    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    check("an arrow key moves everything selected, by one pixel",
      [placed("A")[0] - before.A[0], placed("D")[0] - before.D[0]], [1, 1]);

    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    tap("C");
    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    check("delete removes what is selected", Boolean(box("C")), false);
    check("...and lets go of it", [ringed(), framed()], [0, 0]);

    canvas.dispatchEvent(new window.KeyboardEvent("keydown",
      { key: "a", ctrlKey: true, bubbles: true }));
    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    check("...and a selection of everything empties the diagram in one go",
      canvas.querySelectorAll(".dd-node").length, 0);

    await saveAndWait(page);
    const emptied = (await server.request("GET", "/api/docs/grid.mmd", undefined, { Cookie: cookie })).body.content;
    check("...which is one edit to the file, not four",
      emptied.includes("A[One]") || emptied.includes("B[Two]"), false);
    check("...with the arrow between two of them gone with them",
      emptied.includes("-->"), false);
  }

  console.log("=== boxes can be carried about ===");
  {
    await server.request("POST", "/api/docs",
      { fileName: "carry.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 80x40",
        "    %% @ B 300,100 80x40",
        "    %% @ C 100,300 80x40",
        "    A[One]",
        "    B[Two]",
        "    C[Three]",
        "    A --> B",
        "    B --> C"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/carry.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const boxes = () => [...canvas.querySelectorAll(".dd-node")].map((one) => one.getAttribute("data-id"));
    const arrows = () => canvas.querySelectorAll(".dd-edge").length;
    const ringed = () => canvas.querySelectorAll(".dd-ring").length;
    const press = (key, extra = {}) => canvas.dispatchEvent(
      new window.KeyboardEvent("keydown", { key, bubbles: true, ...extra }));

    const view = () => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\) scale\(([\d.]+)\)/
        .exec(canvas.querySelector(".dd-view").getAttribute("transform"));
      return { x: Number(found[1]), y: Number(found[2]), scale: Number(found[3]) };
    };
    const placed = (id) => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\)/
        .exec(canvas.querySelector(`.dd-node[data-id="${id}"]`).getAttribute("transform"));
      return [Number(found[1]), Number(found[2])];
    };
    const tap = (id, extra = {}) => {
      const [x, y] = placed(id);
      const at = { clientX: (x * view().scale) + view().x + 10,
        clientY: (y * view().scale) + view().y + 10, bubbles: true, ...extra };
      canvas.querySelector(`.dd-node[data-id="${id}"]`).dispatchEvent(new window.MouseEvent("pointerdown", at));
      canvas.dispatchEvent(new window.MouseEvent("pointerup", at));
    };

    check("three boxes and two arrows to begin with", [boxes().length, arrows()], [3, 2]);

    // An edit first, so that undoing a paste has somewhere to land that is not
    // simply the diagram as it was opened.
    tap("A");
    press("ArrowRight", { shiftKey: true });
    await new Promise((r) => setTimeout(r, 700));
    const nudged = placed("A");

    press("c", { ctrlKey: true });
    press("v", { ctrlKey: true });

    check("pasting a box makes a second box", boxes().length, 4);
    check("...under a name nothing else is using",
      new Set(boxes()).size, boxes().length);
    check("...put down beside what it came from, not on top of it",
      placed(boxes()[3]), [placed("A")[0] + 20, placed("A")[1] + 20]);
    check("...and it is what is now held, because it is what you want to move",
      ringed(), 1);
    check("...while the arrows are as they were, because one end was outside",
      arrows(), 2);

    // Saved and read back, because an arrow with one end that is not there is
    // something the drawing quietly leaves out and the file does not.
    await saveAndWait(page);
    const oneCopied = (await server.request("GET", "/api/docs/carry.mmd", undefined, { Cookie: cookie })).body.content;
    check("...and the file has no arrow to a box that was left behind",
      (oneCopied.match(/-->/g) || []).length, 2);
    check("...nor any mention of one", /undefined/.test(oneCopied), false);

    press("z", { ctrlKey: true });
    check("a paste can be undone", boxes().length, 3);
    check("...back to the edit before it rather than past it", placed("A"), nudged);

    /* Undoing leaves a way forward. Pasting is doing something new, and doing
     * something new is what makes the way forward stop existing — so a redo
     * after a paste must not walk into a diagram that never happened.
     *
     * Undone twice, so what is forward is the nudge rather than another paste:
     * two states that differ only in whether they happened are two states this
     * check cannot tell apart.
     */
    press("z", { ctrlKey: true });
    check("...and again takes back the nudge", placed("A")[0], nudged[0] - 10);

    press("v", { ctrlKey: true });
    check("pasting after an undo puts a box down", boxes().length, 4);

    press("z", { ctrlKey: true, shiftKey: true });
    check("...and there is nothing to redo past it", boxes().length, 4);
    check("...least of all the edit the paste was done instead of",
      placed("A")[0], nudged[0] - 10);

    press("z", { ctrlKey: true });

    /* --- what comes with a copy --------------------------------------------- */

    // An arrow with one end outside the selection has nowhere to arrive when it
    // is pasted, so it does not come. An arrow wholly inside does.
    press("Escape");
    tap("A");
    tap("B", { shiftKey: true });
    press("c", { ctrlKey: true });
    press("v", { ctrlKey: true });
    check("copying two joined boxes brings the arrow between them",
      [boxes().length, arrows()], [5, 3]);
    check("...and holds both of the new ones", ringed(), 2);
    // Two boxes pasted at once are two boxes: asking for a free name once and
    // using it twice would declare the same box twice, and the file would come
    // back with one of them.
    check("...each under a name of its own", new Set(boxes()).size, boxes().length);

    // The new arrow joins the new boxes, not the old ones.
    await saveAndWait(page);
    const pasted = (await server.request("GET", "/api/docs/carry.mmd", undefined, { Cookie: cookie })).body.content;
    const fresh = boxes().filter((id) => !["A", "B", "C"].includes(id));
    check("...joined to each other rather than back to the originals",
      pasted.includes(`${fresh[0]} --> ${fresh[1]}`), true);

    press("z", { ctrlKey: true });

    /* --- cut ---------------------------------------------------------------- */

    press("Escape");
    tap("C");
    press("x", { ctrlKey: true });
    check("cut takes the box out", boxes().includes("C"), false);
    check("...and the arrow that reached it", arrows(), 1);

    press("v", { ctrlKey: true });
    check("...and paste puts one back", boxes().length, 3);

    press("z", { ctrlKey: true });
    press("z", { ctrlKey: true });
    check("both halves of a cut can be undone", boxes().length, 3);

    /* --- duplicate ---------------------------------------------------------- */

    press("Escape");
    tap("A");
    press("c", { ctrlKey: true });
    press("Escape");
    tap("B");
    press("d", { ctrlKey: true });
    check("duplicate copies what is held", boxes().length, 4);

    // Duplicating is not copying: what was on the clipboard before is still
    // what a paste should put down.
    press("Escape");
    press("v", { ctrlKey: true });
    const added = boxes().filter((id) => !["A", "B", "C"].includes(id));
    check("...and leaves the clipboard alone", boxes().length, 5);
    check("...so what was copied earlier is what is pasted now",
      canvas.querySelector(`.dd-node[data-id="${added[added.length - 1]}"]`).textContent.includes("One"),
      true);
  }

  console.log("=== typing into the diagram itself ===");
  {
    await server.request("POST", "/api/docs",
      { fileName: "words.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 120x50",
        "    %% @ B 100,300 120x50",
        "    A[\"One<br/>two\"]",
        "    B[Other]",
        "    A -->|when| B"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/words.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const field = () => canvas.querySelector(".ve-diagram-inline");
    const twice = (target) => target.dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true }));
    const key = (target, name, extra = {}) => target.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...extra }));

    check("nothing is being typed into to begin with", Boolean(field()), false);

    twice(canvas.querySelector('.dd-node[data-id="A"]'));
    check("double-clicking a box opens a place to type in it", Boolean(field()), true);
    // The file says <br/> because that is what Mermaid reads. A person typing
    // into a box presses Enter.
    check("...holding what the box says, as lines rather than markup",
      field().value, "One\ntwo");
    // Over the box, not merely somewhere: a field that opens in the corner is a
    // field you have to look away from the thing you are naming to use.
    const seat = () => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\) scale\(([\d.]+)\)/
        .exec(canvas.querySelector(".dd-view").getAttribute("transform"));
      const at = /translate\((-?[\d.]+),(-?[\d.]+)\)/
        .exec(canvas.querySelector('.dd-node[data-id="A"]').getAttribute("transform"));
      const scale = Number(found[3]);
      return [`${(Number(at[1]) * scale) + Number(found[1])}px`,
        `${(Number(at[2]) * scale) + Number(found[2])}px`];
    };

    check("...over the box it belongs to", [field().style.left, field().style.top], seat());
    check("...at the size it is drawn",
      [field().style.width, field().style.height], ["120px", "50px"]);

    field().value = "Renamed";
    key(field(), "Enter");
    check("enter puts what was typed into the box", Boolean(field()), false);
    check("...and the box says it",
      canvas.querySelector('.dd-node[data-id="A"]').textContent.includes("Renamed"), true);

    // The options panel edits the same words. Both stay: a panel is how you
    // find a setting you have never used, and typing into the thing itself is
    // how you rename a box you are looking at.
    check("...and so does the panel beside it",
      page.document.querySelector(".ve-diagram-text").value, "Renamed");

    twice(canvas.querySelector('.dd-node[data-id="A"]'));
    field().value = "Thrown away";
    key(field(), "Escape");
    check("escape throws away what was typed", Boolean(field()), false);
    check("...leaving the box as it was",
      canvas.querySelector('.dd-node[data-id="A"]').textContent.includes("Renamed"), true);

    // Shift-enter is a line break, the way it is in every box anyone has typed
    // a label into.
    twice(canvas.querySelector('.dd-node[data-id="B"]'));
    field().value = "Two\nlines";
    key(field(), "Enter");
    await saveAndWait(page);
    const written = (await server.request("GET", "/api/docs/words.mmd", undefined, { Cookie: cookie })).body.content;
    check("a line break is written the way Mermaid reads one",
      written.includes("B[\"Two<br/>lines\"]"), true);

    // An arrow has no box to type in, so one is borrowed where its label is.
    twice(canvas.querySelector(".dd-edge"));
    check("double-clicking an arrow opens a place to type its label", field().value, "when");
    field().value = "if ready";
    key(field(), "Enter");
    await saveAndWait(page);
    const labelled = (await server.request("GET", "/api/docs/words.mmd", undefined, { Cookie: cookie })).body.content;
    check("...which is written on the arrow", labelled.includes("-->|if ready|"), true);

    // And it is one step, like every other edit.
    canvas.dispatchEvent(new window.KeyboardEvent("keydown",
      { key: "z", ctrlKey: true, bubbles: true }));
    check("typing into the diagram can be undone",
      canvas.querySelector(".dd-edge").textContent.includes("when"), true);
  }

  console.log("=== every edit has a way back ===");
  {
    await server.request("POST", "/api/docs",
      { fileName: "steps.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 80x40",
        "    %% @ B 300,100 80x40",
        "    A[One]:::blue",
        "    B[Two]",
        "    A --> B",
        "    classDef blue fill:#2b6cb0"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/steps.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const box = (id) => canvas.querySelector(`.dd-node[data-id="${id}"]`);
    const placed = (id) => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(box(id).getAttribute("transform"));
      return [Number(found[1]), Number(found[2])];
    };
    const view = () => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\) scale\(([\d.]+)\)/
        .exec(canvas.querySelector(".dd-view").getAttribute("transform"));
      return { x: Number(found[1]), y: Number(found[2]), scale: Number(found[3]) };
    };
    const onScreen = (x, y) => [(x * view().scale) + view().x, (y * view().scale) + view().y];
    const at = (x, y, extra = {}) => ({ clientX: x, clientY: y, bubbles: true, ...extra });
    const press = (key, extra = {}) => canvas.dispatchEvent(
      new window.KeyboardEvent("keydown", { key, bubbles: true, ...extra }));

    const drag = async (id, dx, dy) => {
      const [sx, sy] = onScreen(...placed(id));
      box(id).dispatchEvent(new window.MouseEvent("pointerdown", at(sx + 5, sy + 5)));
      canvas.dispatchEvent(new window.MouseEvent("pointermove", at(sx + 5 + dx, sy + 5 + dy)));
      await new Promise((r) => setTimeout(r, 60));
      canvas.dispatchEvent(new window.MouseEvent("pointerup", at(sx + 5 + dx, sy + 5 + dy)));
    };

    const stepButtons = () => [...page.document.querySelectorAll(".ve-diagram-steps button")];
    check("a fresh diagram has nothing to undo and nothing to redo",
      stepButtons().map((one) => one.disabled), [true, true]);

    const started = placed("A");
    await drag("A", 0, 200);
    check("...and one edit gives it something to undo",
      stepButtons().map((one) => one.disabled), [false, true]);
    const moved = placed("A");
    check("a box dragged is a box moved", moved[1] - started[1], 200);

    press("z", { ctrlKey: true });
    check("undo puts it back", placed("A"), started);
    check("...and now there is something to redo",
      stepButtons().map((one) => one.disabled), [true, false]);

    stepButtons()[1].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("the button does what the keystroke does", placed("A"), moved);
    stepButtons()[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("...in both directions", placed("A"), started);

    press("z", { ctrlKey: true, shiftKey: true });
    check("redo moves it again", placed("A"), moved);

    press("y", { ctrlKey: true });
    check("...and there is nothing further forward to go to", placed("A"), moved);

    // One step per gesture, not one per frame: a drag that took forty frames
    // is one thing that happened, and one press of undo has to take it back.
    press("z", { ctrlKey: true });
    check("one drag is one step, however many frames it took", placed("A"), started);

    /* --- a run of them ------------------------------------------------------ */

    await drag("A", 0, 100);
    await drag("B", 100, 0);
    const both = { A: placed("A"), B: placed("B") };

    press("z", { ctrlKey: true });
    check("undo takes back the last thing done, not the last two",
      [placed("A"), placed("B")], [both.A, [both.B[0] - 100, both.B[1]]]);

    press("z", { ctrlKey: true });
    check("...and again takes back the one before it", placed("A"), started);

    press("z", { ctrlKey: true });
    check("...and running out of past is not an error", placed("A"), started);

    press("z", { ctrlKey: true, shiftKey: true });
    press("z", { ctrlKey: true, shiftKey: true });
    check("redo walks the same way forward",
      [placed("A"), placed("B")], [both.A, both.B]);

    // Doing something new is what makes the way forward stop existing.
    press("z", { ctrlKey: true });
    await drag("B", 0, 150);
    const branched = placed("B");
    press("z", { ctrlKey: true, shiftKey: true });
    check("a new edit closes off the way forward", placed("B"), branched);

    /* --- what undo has to restore ------------------------------------------- */

    press("Escape");
    const [cx, cy] = onScreen(...placed("A"));
    box("A").dispatchEvent(new window.MouseEvent("pointerdown", at(cx + 5, cy + 5)));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(cx + 5, cy + 5)));
    press("Delete");
    check("a box can be removed", Boolean(box("A")), false);

    press("z", { ctrlKey: true });
    check("undo brings it back", Boolean(box("A")), true);
    check("...and the arrow that went with it",
      canvas.querySelectorAll(".dd-edge").length, 1);

    /* --- typing ------------------------------------------------------------- */

    // A word typed into a box arrives one character at a time, and a history
    // with one step per keystroke is a history where undo means "take back that
    // letter". A burst is gathered up into one step; a pause ends it.
    press("Escape");
    const [nx, ny] = onScreen(...placed("B"));
    box("B").dispatchEvent(new window.MouseEvent("pointerdown", at(nx + 5, ny + 5)));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(nx + 5, ny + 5)));

    // Re-queried every time: an undo repaints the panel, so a reference kept
    // from before one is a reference to a box that is no longer on the screen.
    const naming = () => page.document.querySelector(".ve-diagram-text");
    const type = (text) => {
      const field = naming();
      field.value = text;
      field.dispatchEvent(new window.Event("input", { bubbles: true }));
    };

    const wasCalled = naming().value;
    for (const text of ["T", "Tw", "Two", "Two ", "Two b"]) {
      type(text);
    }

    // Long enough for the burst to have been gathered up and closed.
    await new Promise((r) => setTimeout(r, 700));
    for (const text of ["Two bo", "Two box"]) {
      type(text);
    }

    await new Promise((r) => setTimeout(r, 700));
    check("typing changes the box", naming().value, "Two box");

    press("z", { ctrlKey: true });
    await new Promise((r) => setTimeout(r, 60));
    check("undo takes back the burst, not the letter",
      naming().value, "Two b");

    press("z", { ctrlKey: true });
    await new Promise((r) => setTimeout(r, 60));
    check("...and again takes back the burst before it",
      naming().value, wasCalled);

    /* A step still being gathered has to be taken back first rather than
     * skipped over, or an undo lands one step further back than it should and
     * the letters just typed survive it.
     *
     * Two bursts, the first finished and the second still open: undo has to
     * arrive at the first, not at what came before it.
     */
    type("Alpha");
    await new Promise((r) => setTimeout(r, 700));
    type("Beta");
    press("z", { ctrlKey: true });
    await new Promise((r) => setTimeout(r, 60));
    check("undo during a burst takes back the burst so far",
      naming().value, "Alpha");
    check("...rather than the finished burst underneath it",
      naming().value === wasCalled, false);

    // A step is the file, so it restores the things this editor has no controls
    // for as faithfully as the things it has.
    await drag("A", 40, 0);
    press("z", { ctrlKey: true });
    await saveAndWait(page);
    const saved = (await server.request("GET", "/api/docs/steps.mmd", undefined, { Cookie: cookie })).body.content;
    check("...and a colour nothing here can edit",
      saved.includes("classDef blue fill:#2b6cb0"), true);
    check("...and the box that wears it", saved.includes("class A blue"), true);
  }

  console.log("=== the way in and the way back ===");
  {
    const appSource = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");

    check("a diagram in a document has a way out to the page",
      /ve-embed-expand/.test(appSource), true);
    check("...which leaves the document where the page will look for it",
      /stashDocument\(state\.pageEdit\.file, markdown\)/.test(appSource), true);
    check("...and the document editor picks it back up",
      /takeStashedDocument\(file\)/.test(appSource), true);
    // Left behind, it would be picked up by an edit weeks later and quietly
    // undo whatever happened in between.
    check("...taking it rather than reading it",
      /removeItem\(diagramStashKey\(file\)\)/.test(appSource), true);
    check("a .mmd file opens on the page rather than in a text box",
      /\/diagram\/file\/\$\{docUrl\(state\.activeFile\)\}/.test(appSource), true);
  }
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
