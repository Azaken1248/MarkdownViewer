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

    return { ok: response.ok, status: response.status, json: () => response.json() };
  };

  // theme-boot.js first, and for the same reason the page loads it in <head>:
  // it settles the theme before anything paints, and it is where the switch the
  // bar wires up lives.
  for (const file of ["theme-boot.js", "visual-editor.js", "diagram-model.js",
    "diagram-icons.js", "diagram-draw.js", "diagram-editor.js", "diagram-page.js"]) {
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

    /* The theme. This page loads none of app.js, so it used to have no way to
     * change the theme at all — the whole cycle lived in a file it does not
     * load. It lives in theme-boot.js now, which every page with a theme runs
     * before it paints, so there is one cycle rather than two to disagree.
     */
    const themeButton = page.document.getElementById("diagramTheme");
    const themeNow = () => page.document.documentElement.dataset.theme;
    const wanted = () => page.document.documentElement.dataset.themePreference;

    check("the page has a way to change the theme", Boolean(themeButton), true);
    check("...saying what it is now and what pressing it does",
      /dark theme\. switch to light/i.test(themeButton.getAttribute("aria-label")), true);
    check("...starting where the library starts", [wanted(), themeNow()], ["dark", "dark"]);

    themeButton.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    check("pressing it goes to the next one", [wanted(), themeNow()], ["light", "light"]);
    check("...and says so", themeButton.querySelector("i").className, "ph ph-sun");

    themeButton.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    check("...and then to following the system", wanted(), "auto");
    // "Auto" is a preference, not a palette. What goes on the page has to be
    // one of the two real ones or the stylesheet has nothing to paint with.
    check("...which is put on the page as whichever one that turns out to be",
      ["dark", "light"].includes(themeNow()), true);

    // Written down under the same name the library uses, or the two pages
    // disagree about the theme the moment you move between them.
    check("...and the choice is kept where the library keeps it",
      page.window.localStorage.getItem("mdviewer.theme"), "auto");

    themeButton.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    check("...and round to the start again", wanted(), "dark");

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

    /* And again. The address is half an index and half a hash of what is in the
     * block, so saving the block is what makes it stop matching — and the
     * address has to be taken again from what was actually written. Looked up
     * by the address it already had, it found a body that had just been
     * replaced, found nothing, and left the address pointing at a block that no
     * longer existed. Which the second save then said out loud.
     */
    dragBox(page.window, "A", 20, 0);
    await settle();
    check("a second edit is saveable too",
      page.document.getElementById("diagramSave").disabled, false);

    await saveAndWait(page);
    check("...and saving it does not say the block has gone",
      /no longer in the document/.test(page.document.getElementById("diagramStatus").textContent),
      false);

    const twice = await server.request("GET", "/api/docs/deploy.md", undefined, { Cookie: cookie });
    check("...and the second edit reaches the file too",
      twice.body.content !== saved.body.content, true);
    check("...with the document still whole around it",
      twice.body.content.startsWith("# Deployment\n\nBefore the diagram.\n\n```mermaid\n")
        && twice.body.content.endsWith("```\n\nAfter the diagram.\n"), true);
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

  console.log("=== the editor is a bar, two rails and the paper between them ===");
  {
    /* Where a control is says what it does to.
     *
     * The bar along the top is what is done to the whole diagram, the rail is
     * what can be put into it, the panel is what is true of what is picked,
     * and the zoom is about the window rather than about the drawing — so the
     * zoom is on the paper and nothing else is. A control in the wrong region
     * is a control nobody looks for twice.
     */
    await server.request("POST", "/api/docs",
      { fileName: "regions.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 80x40",
        "    A[One]"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/regions.mmd`, cookie, origin });
    const where = (selector) => {
      const found = page.document.querySelector(selector);
      if (!found) return null;
      for (const region of ["bar", "rail", "stage", "side"]) {
        if (found.closest(`.ve-diagram-${region}`)) return region;
      }

      return "loose";
    };

    check("there is one of each region",
      ["shell", "bar", "rail", "stage", "side"]
        .map((one) => page.document.querySelectorAll(`.ve-diagram-${one}`).length),
      [1, 1, 1, 1, 1]);

    check("the shapes are on the rail", where(".ve-diagram-palette"), "rail");
    check("...the paper is the stage", where(".ve-diagram-canvas"), "stage");
    check("...what is true of a box is in the panel",
      [where(".ve-diagram-inspector"), where(".ve-diagram-hint")], ["side", "side"]);
    check("...the whole diagram's own controls are on the bar",
      [where(".ve-diagram-tidy"), where(".ve-diagram-flow"), where(".ve-diagram-steps")],
      ["bar", "bar", "bar"]);
    check("...as are the two tools that change what a drag means",
      [...page.document.querySelectorAll(".ve-diagram-icon[aria-pressed]")]
        .every((one) => one.closest(".ve-diagram-bar")), true);
    check("...and the zoom is on the paper, because it is about the window",
      where(".ve-diagram-zoom"), "stage");

    // The page's own bar names the diagram. Naming it again here would be the
    // same words twice on one screen.
    check("the editor does not name a diagram its host has already named",
      page.document.querySelector(".ve-diagram-name"), null);

    // Six shapes, each showing the outline it puts on the paper. An icon font's
    // nearest square is not that, so these are drawn here.
    const shapes = [...page.document.querySelectorAll(".ve-diagram-tool")];
    /* An icon and a picture on the rail, put down on their own rather than
     * inside a rectangle: what is on the paper is the thing, which is what most
     * of a technical diagram is made of.
     */
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const rail = [...page.document.querySelectorAll(".ve-diagram-tool")]
      .map((one) => one.textContent);
    check("the rail offers an icon and a picture as well as the shapes",
      rail.slice(-2), ["Icon", "Picture"]);

    const icon = [...page.document.querySelectorAll(".ve-diagram-tool")]
      .find((one) => one.textContent === "Icon");
    icon.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true }));
    icon.dispatchEvent(new window.MouseEvent("pointerup", { bubbles: true }));
    await new Promise((done) => setTimeout(done, 300));

    const put = [...canvas.querySelectorAll(".dd-node")].pop();
    check("an icon put down is an icon and not a rectangle with one in it",
      [Boolean(put.querySelector(".dd-icon")), Boolean(put.querySelector(".dd-shape"))],
      [true, false]);
    check("...and is still a box, so it can be joined and moved like the rest",
      Boolean(put.getAttribute("data-id")), true);

    check("every shape on the rail shows a picture of itself",
      shapes.length > 0 && shapes.every((one) => one.querySelector("svg.ve-diagram-glyph")),
      true);
    check("...and still says what it is", shapes[0].textContent, "Box");

    page.window.close();
  }

  console.log("=== the panel names what it is showing you ===");
  {
    /* Every control here used to sit in a row with two others and no words at
     * all, which left a menu of six shapes and a menu of three border weights
     * looking like the same unlabelled menu twice — and the label field, the
     * one thing anybody types into, sharing its line with a menu and a delete
     * button in a column narrower than any of the three wanted.
     */
    await server.request("POST", "/api/docs",
      { fileName: "panel.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 80x40",
        "    %% @ B 300,100 120x80 kind=table",
        "    %% @ C 300,300 120x60 kind=table",
        "    A[One]",
        '    B["Two<br/>a | x<br/>b"]',
        "    C[Three]",
        "    A --> B"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/panel.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const inspector = page.document.querySelector(".ve-diagram-inspector");
    const groupOf = (id) => canvas.querySelector(`.dd-node[data-id="${id}"]`);
    const tap = (id) => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(groupOf(id).getAttribute("transform"));
      const x = Number(found[1]) + 10;
      const y = Number(found[2]) + 10;
      groupOf(id).dispatchEvent(new window.MouseEvent("pointerdown",
        { clientX: x, clientY: y, bubbles: true }));
      canvas.dispatchEvent(new window.MouseEvent("pointerup",
        { clientX: x, clientY: y, bubbles: true }));
    };
    const captions = () => [...inspector.querySelectorAll(".ve-diagram-field-name")]
      .map((one) => one.textContent);

    tap("A");
    check("a panel about a box says so at the top",
      inspector.querySelector(".ve-diagram-picked .ve-diagram-legend").textContent, "Box");
    check("...with the way to remove it up there, since it is not a property of it",
      Boolean(inspector.querySelector(".ve-diagram-picked > .ve-diagram-drop")), true);
    check("...and every control below it named",
      captions(), ["Label", "Shape", "Fill", "Border", "Font", "Picture", "Icon"]);

    // A label wrapping its control is also the label that control answers to,
    // so the caption is a way into the field rather than a word beside it. A
    // group of buttons is not something a label can point at, so those keep the
    // group's own aria-label and get a plain box.
    const holder = (name) => [...inspector.querySelectorAll(".ve-diagram-field")]
      .find((one) => one.querySelector(".ve-diagram-field-name").textContent === name);
    check("a caption over one control is that control's own label",
      [holder("Label").tagName, holder("Shape").tagName], ["LABEL", "LABEL"]);
    check("...and a caption over a group of buttons is not, because it cannot be",
      [holder("Fill").tagName, holder("Fill").querySelector("[role=group]")
        .getAttribute("aria-label")], ["DIV", "Colour"]);

    /* The field grows with what is typed into it. A box can hold a paragraph,
     * and a field that shows one line of it and scrolls the rest is a field you
     * cannot read your own diagram in.
     */
    const label = holder("Label").querySelector(".ve-diagram-text");
    check("the label field starts at the one line the box has", label.rows, 1);
    label.value = "One\ntwo\nthree";
    label.dispatchEvent(new window.Event("input", { bubbles: true }));
    check("...and grows by the line as it is filled", label.rows, 3);
    check("...up to a point, since the panel holds more than this field", (() => {
      label.value = new Array(40).fill("x").join("\n");
      label.dispatchEvent(new window.Event("input", { bubbles: true }));
      return label.rows;
    })(), 10);

    /* A table is a grid, and a grid typed into one box as lines of pipes is a
     * grid you have to hold in your head to edit: which of these words is in
     * the second column is a question you answer by counting. So a table gets
     * one field per cell, laid out the way it is drawn.
     */
    tap("B");
    check("a table says it is one",
      inspector.querySelector(".ve-diagram-picked .ve-diagram-legend").textContent, "Table");
    check("...and calls its words what they are", captions()[0], "Cells");
    check("...and offers the two numbers a table has",
      captions().slice(1, 3), ["Rows", "Columns"]);
    check("...and the spacing that goes with them",
      captions().slice(3, 5), ["Padding", "Spacing"]);
    check("...typed one cell at a time rather than as lines of pipes",
      [Boolean(inspector.querySelector(".ve-diagram-cells")),
        inspector.querySelector(".ve-diagram-text")], [true, null]);

    // A field per cell, plus the title, which spans the table the same way it
    // is drawn.
    const fields = () => [...inspector.querySelectorAll(".ve-diagram-cell")]
      .map((one) => one.value);
    // Five fields for a title and a two-by-two grid, and the row that was
    // written with only one cell in it gets the empty one it is short.
    check("one field per cell, with the words already in them",
      fields(), ["Two", "a", "x", "b", ""]);
    check("...the title spanning the whole of it",
      inspector.querySelector(".ve-diagram-cell").classList
        .contains("ve-diagram-cell-title"), true);
    check("...and the panel laid out in as many columns as the table has",
      inspector.querySelector(".ve-diagram-cells").style
        .getPropertyValue("--dd-columns"), "2");

    page.window.close();
  }

  console.log("=== a table is so many rows by so many columns ===");
  {
    /* Rows and columns are the two things about a table you change one at a
     * time, and typing pipes into a field to say "one more column" is a strange
     * way to ask for one more column. The count reads as well as sets, so the
     * shape of the table is something the panel says rather than something you
     * work out by counting the pipes in the field above it.
     */
    await server.request("POST", "/api/docs",
      { fileName: "grid.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 200x120 kind=table",
        // Deliberately shorter than the three rows in it need: a box can be
        // dragged smaller than its contents, and the steppers have to cope.
        "    %% @ B 100,400 200x40 kind=table",
        '    A["Person<br/>name | string<br/>age | int"]',
        '    B["T<br/>a | b<br/>c | d"]'
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/grid.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const inspector = page.document.querySelector(".ve-diagram-inspector");
    const groupOf = (id) => canvas.querySelector(`.dd-node[data-id="${id}"]`);

    const tap = (id) => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(groupOf(id).getAttribute("transform"));
      groupOf(id).dispatchEvent(new window.MouseEvent("pointerdown",
        { clientX: Number(found[1]) + 10, clientY: Number(found[2]) + 10, bubbles: true }));
      canvas.dispatchEvent(new window.MouseEvent("pointerup",
        { clientX: Number(found[1]) + 10, clientY: Number(found[2]) + 10, bubbles: true }));
    };

    const steppers = () => [...inspector.querySelectorAll(".ve-diagram-stepper")];
    const stepper = (name) => steppers()
      .find((one) => one.getAttribute("aria-label") === name);
    const count = (name) =>
      Number(stepper(name).querySelector(".ve-diagram-count").textContent);
    const counts = () => [count("Rows"), count("Columns")];
    const spacing = () => [count("Padding"), count("Spacing")];
    const press = (name, which) => stepper(name)
      .querySelectorAll(".ve-diagram-step")[which]
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const fewer = (name) => press(name, 0);
    const more = (name) => press(name, 1);
    const cells = () => [...groupOf("A").querySelectorAll(".dd-row")]
      .map((one) => one.textContent);
    const rules = () => groupOf("A").querySelectorAll(".dd-cell-rule").length;
    const boxOf = (id = "A") => {
      const at = groupOf(id).querySelector("rect");
      return [Number(at.getAttribute("width")), Number(at.getAttribute("height"))];
    };

    tap("A");
    check("a table says how many rows and columns it has", counts(), [3, 2]);
    check("...and is drawn with a line between each of them", rules(), 2);

    /* A table dragged off the rail arrives as a table.
     *
     * It used to arrive as a heading with one line under it, which is one
     * column and one row — a shape with no grid in it to see. Whatever is
     * dropped on the paper has to be the thing that was picked up.
     */
    const shape = [...page.document.querySelectorAll(".ve-diagram-tool")]
      .find((one) => one.dataset.kind === "table");
    shape.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true }));
    shape.dispatchEvent(new window.MouseEvent("pointerup", { bubbles: true }));
    await new Promise((done) => setTimeout(done, 300));

    check("a table dropped on the paper is a table", counts(), [3, 2]);
    const fresh = [...canvas.querySelectorAll(".dd-node")].pop();
    check("...with its rows and its columns drawn",
      fresh.querySelectorAll(".dd-cell-rule").length, 2);
    check("...and nothing written in it but its heading",
      [...fresh.querySelectorAll(".dd-text")].map((one) => one.textContent), ["Table"]);

    tap("A");

    /* The size it was given in the file, which is bigger than a table of these
     * cells needs. Read before anything is pressed, because the question below
     * is what the steppers do to a size somebody chose by hand.
     */
    const [wide, high] = boxOf();

    // Rows enough to need more room than the file gave it. A table with room
    // for another row does not have to grow to hold one.
    more("Rows");
    more("Rows");
    more("Rows");
    check("asking for rows gives them", counts(), [6, 2]);
    check("...and the table grows to hold them", boxOf()[1] > high, true);
    check("...and no wider, since none of that was about its width",
      boxOf()[0], wide);

    const tall = boxOf()[1];
    fewer("Rows");
    check("taking one off again leaves the size it had", boxOf(), [wide, tall]);
    check("...because the rows share out the height between them rather than"
      + " stacking from the top",
      /y1="\d+" x2="200"/.test(groupOf("A").innerHTML), true);

    fewer("Rows");
    fewer("Rows");
    more("Columns");
    check("asking for another column gives it one", counts(), [3, 3]);
    check("...and draws the line that divides it", rules(), 3);
    check("...leaving what was already in it where it was",
      cells(), ["name", "string", "age", "int"]);
    // Every column needs room to be read in, so another column is a wider
    // table rather than a division of the width it already had.
    check("...and widens the table to hold it", boxOf()[0] > wide, true);

    const grew = boxOf()[0];
    fewer("Columns");
    check("and taking it away takes it away", counts(), [3, 2]);
    check("...the cells that were in it included", cells(), ["name", "string", "age", "int"]);
    check("...but not the width, because a box here grows and never shrinks",
      boxOf()[0], grew);

    /* One column has no line down it — there is nothing on either side of one
     * to divide — but it still has the lines between its rows. A table whose
     * structure you have to infer from where the words happen to sit is a box
     * with a list in it.
     */
    fewer("Columns");
    check("a table of one column has no line down it", counts(), [3, 1]);
    check("...but still has the one between its rows", rules(), 1);
    check("...and the second cell of every row gone with the column",
      cells(), ["name", "age"]);

    // A table of no columns is not a table, and a way down that goes nowhere
    // has to look like one rather than quietly doing nothing.
    check("...and no way down from there",
      stepper("Columns").querySelectorAll(".ve-diagram-step")[0].disabled, true);
    check("...though the way up is still open",
      stepper("Columns").querySelectorAll(".ve-diagram-step")[1].disabled, false);

    /* How the table is spaced out: how far the words sit from the walls of a
     * cell, and how much room a row gets.
     *
     * Both are statements about size, so the box follows them exactly rather
     * than only growing — which is the opposite of what adding a row does, and
     * for the opposite reason. A row is a thing to hold, and a box keeps
     * whatever size it was dragged to as long as it can hold it; asking for
     * shorter rows and getting the same table back is asking for nothing.
     */
    check("a table says how it is spaced out", spacing(), [10, 20]);

    const wordsAt = () =>
      Number(groupOf("A").querySelector(".dd-row").getAttribute("x"));
    check("...with its words that far in from the wall", wordsAt(), 10);

    more("Padding");
    check("more padding is more room before the words start", spacing()[0], 12);
    await new Promise((done) => setTimeout(done, 300));
    check("...which is where they start", wordsAt(), 12);

    fewer("Padding");
    fewer("Padding");
    check("and less is less", spacing()[0], 8);
    await new Promise((done) => setTimeout(done, 300));
    check("...there too", wordsAt(), 8);

    /* The box moves by the amount the change made, rather than to what the
     * table now needs: this one was dragged roomier than it needs to be, and a
     * stepper that snapped it to the minimum would take that away the moment it
     * was touched.
     */
    const before = boxOf()[1];
    more("Spacing");
    check("more spacing is more room for every row", spacing()[1], 25);
    await new Promise((done) => setTimeout(done, 300));
    check("...and a taller table to put them in", boxOf()[1] - before, 10);

    fewer("Spacing");
    fewer("Spacing");
    await new Promise((done) => setTimeout(done, 300));
    check("...and asking for less gives a shorter one, since asking for shorter"
      + " rows and getting the same table back is asking for nothing",
      before - boxOf()[1], 10);

    // Back to where it started, so what follows measures what it means to.
    more("Spacing");
    more("Padding");
    await new Promise((done) => setTimeout(done, 300));
    check("and back to the standard, which is the one the file leaves out",
      [spacing(), boxOf()[1]], [[10, 20], before]);

    /* A box can be dragged smaller than what is in it, so the difference the
     * stepper moves by has to stop somewhere: a table already too short for its
     * rows, asked for shorter ones, must not be walked down towards nothing.
     */
    tap("B");
    check("a table can be shorter than the rows in it", boxOf("B")[1], 40);
    fewer("Spacing");
    await new Promise((done) => setTimeout(done, 300));
    check("...and asking for less spacing takes it no further down than what"
      + " those rows need", boxOf("B")[1], 60);

    tap("A");

    /* Typing into a cell puts the words in that cell, and a pipe typed into one
     * is taken out again: it is the wall between two cells, so it cannot be
     * inside one. The label reaches the file quoted, which the row break
     * already required of it.
     */
    more("Columns");
    const field = (at) => inspector.querySelectorAll(".ve-diagram-cell")[at];
    const type = (at, words) => {
      field(at).value = words;
      field(at).dispatchEvent(new window.Event("input", { bubbles: true }));
    };

    type(0, "Person");
    type(1, "name");
    type(2, "string");
    type(3, "age");
    type(4, "int");

    // Typing redraws on a pause, the same as typing anywhere else here does.
    await new Promise((done) => setTimeout(done, 300));
    check("typing into a cell puts the words in that cell",
      cells(), ["name", "string", "age", "int"]);

    type(2, "str|ing");
    await new Promise((done) => setTimeout(done, 300));
    check("...and a pipe typed into one is taken back out of it",
      [field(2).value, cells()[1]], ["string", "string"]);

    await saveAndWait(page);
    const written = (await server.request("GET", "/api/docs/grid.mmd",
      undefined, { Cookie: cookie })).body.content;
    check("a grid reaches the file as one quoted label",
      /A\["Person<br\/>name \| string<br\/>age \| int"\]/.test(written), true);

    page.window.close();
  }

  console.log("=== a box is resized by any of its edges, and lines up doing it ===");
  {
    /* A box had one grip, on its bottom-right corner, so making it wider always
     * made it taller as well. And a resize was the one drag that snapped to
     * nothing: a box could be dragged to within a pixel of lining up with its
     * neighbour and there was nothing to say so.
     */
    await server.request("POST", "/api/docs",
      { fileName: "grips.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 100x100",
        // Off the grid on purpose, both of them: a box whose edges are all
        // multiples of ten is a box that cannot tell snapping to the grid from
        // lining up with a neighbour.
        "    %% @ B 403,344 100x100",
        // Three pixels from A's left edge, at the point below where a side grip
        // is dragged — near enough to line up with, if that edge were moving.
        "    %% @ C 153,700 20x100",
        "    A[One]",
        "    B[Two]",
        "    C[Three]"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/grips.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const view = () => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\) scale\(([\d.]+)\)/
        .exec(canvas.querySelector(".dd-view").getAttribute("transform"));
      return { x: Number(found[1]), y: Number(found[2]), scale: Number(found[3]) };
    };
    const at = (x, y) => ({
      clientX: (x * view().scale) + view().x,
      clientY: (y * view().scale) + view().y,
      bubbles: true
    });

    const groupOf = (id) => canvas.querySelector(`.dd-node[data-id="${id}"]`);
    const boxOf = (id) => {
      const spot = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(groupOf(id).getAttribute("transform"));
      const rect = groupOf(id).querySelector("rect");
      return [Number(spot[1]), Number(spot[2]),
        Number(rect.getAttribute("width")), Number(rect.getAttribute("height"))];
    };

    const grip = (name) => canvas.querySelector(`.dd-resize[data-grip="${name}"]`);
    const guides = () => canvas.querySelectorAll(".dd-guides .dd-guide").length;

    let letGoAt = [0, 0];
    const drag = (name, dx, dy, { hold = false } = {}) => {
      const one = grip(name);
      const x = Number(one.getAttribute("cx"));
      const y = Number(one.getAttribute("cy"));
      letGoAt = [x + dx, y + dy];
      one.dispatchEvent(new window.MouseEvent("pointerdown", at(x, y)));
      canvas.dispatchEvent(new window.MouseEvent("pointermove", at(...letGoAt)));
      if (!hold) {
        canvas.dispatchEvent(new window.MouseEvent("pointerup", at(...letGoAt)));
      }
    };

    // Let go where the hand actually is. Releasing somewhere else is a resize to
    // somewhere else: the size is settled from the point the drag ended at.
    const letGo = () => canvas.dispatchEvent(
      new window.MouseEvent("pointerup", at(...letGoAt)));

    groupOf("A").dispatchEvent(new window.MouseEvent("pointerdown", at(150, 150)));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(150, 150)));
    check("a box starts where the file put it", boxOf("A"), [100, 100, 100, 100]);

    // A side grip drags one edge. The other three stay exactly where they were,
    // which is the whole of what makes it a side rather than a corner.
    drag("e", 60, 0);
    check("dragging the right edge makes it wider and nothing else",
      boxOf("A"), [100, 100, 160, 100]);

    drag("s", 0, 40);
    check("...and the bottom edge taller and nothing else",
      boxOf("A"), [100, 100, 160, 140]);

    /* The left and the top move the box as well as resize it: the edge you are
     * dragging is the one that moves, so the one you are not has to stay put.
     */
    drag("w", -50, 0);
    check("dragging the left edge moves that edge, not the right one",
      boxOf("A"), [50, 100, 210, 140]);

    drag("n", -30, -30);
    check("...and the top edge the same, ignoring the across it was given",
      boxOf("A"), [50, 70, 210, 170]);

    // A corner drags two edges at once, which is what it always did.
    drag("se", -60, -50);
    check("a corner still drags both of its edges",
      boxOf("A"), [50, 70, 150, 120]);

    /* A box that has hit its smallest must not walk. The edge being dragged is
     * the one that gives way, so the edge that is not being dragged stays where
     * it is however far the hand keeps going.
     */
    drag("w", 900, 0);
    check("a box dragged past its smallest stops at its smallest",
      boxOf("A"), [150, 70, page.window.DiagramEditor.MIN_BOX, 120]);
    check("...with the edge that was not being dragged still where it was",
      boxOf("A")[0] + boxOf("A")[2], 200);

    drag("n", 0, 900);
    check("...and the same going the other way, on the other axis",
      boxOf("A"), [150, 165, 50, 25]);

    /* Lining up. The same six lines a move is snapped to, but only the edge
     * being dragged may be put on one of them: snapping an edge that is not
     * moving would move it, which is a resize that also drags the box sideways.
     *
     * Both boxes to line up against are off the grid, so a line that came from
     * the grid and a line that came from a neighbour are telling apart.
     */
    const frame = () => new Promise((done) => window.requestAnimationFrame(
      () => window.requestAnimationFrame(done)));

    check("nothing is being lined up before anything is dragged", guides(), 0);

    // The bottom edge to within three of B's top, and the left edge left alone
    // three from C's — one of those is moving and the other is not.
    drag("s", 0, 344 - 190 - 3, { hold: true });
    await frame();

    check("an edge dragged near another box's edge snaps onto it, rather than"
      + " onto the grid it would otherwise land on",
      boxOf("A")[1] + boxOf("A")[3], 344);
    check("...and the edge that is not being dragged stays exactly where it was",
      boxOf("A")[0], 150);
    check("...with one line drawn, about the edge that moved",
      guides(), 1);
    check("...which is the line across, since it is the bottom edge that moved",
      [...canvas.querySelectorAll(".dd-guides .dd-guide")]
        .every((one) => one.getAttribute("y1") === one.getAttribute("y2")), true);

    letGo();
    check("letting go takes the lines away", guides(), 0);

    /* A box cannot line up with itself.
     *
     * Every edge of the box being resized is within nothing of where it already
     * is, so a box allowed to line up with itself is a box whose edges snap
     * back the moment they are nudged — and a small resize becomes impossible.
     * A's top is at 165, off the grid, with nothing else near it.
     */
    drag("n", 0, 4);
    check("a small drag moves the edge rather than snapping it back to itself",
      boxOf("A"), [150, 170, 50, 174]);

    // And the same the other way about: a right edge to a neighbour's left.
    drag("e", 403 - 200 - 3, 0, { hold: true });
    await frame();
    check("a right edge lines up with a left one just as well",
      boxOf("A")[0] + boxOf("A")[2], 403);
    check("...saying so with the line down", guides(), 1);

    letGo();

    // With nothing to line up against, the grid catches the edge — which is
    // what keeps a diagram tidy where no neighbour is near enough to help.
    drag("s", 0, 23);
    check("an edge with nothing near it lands on the grid",
      boxOf("A")[1] + boxOf("A")[3], 370);

    drag("e", 23, 0);
    check("...going across as well as down",
      boxOf("A")[0] + boxOf("A")[2], 430);

    page.window.close();
  }

  console.log("=== the two sides move, and go away, and are remembered ===");
  {
    /* How much room somebody wants for the shapes is about their screen and
     * their hands rather than about the drawing, so it is kept in the browser
     * and not in the file — a diagram that carried it would hand one person's
     * window to everyone who opened it.
     */
    await server.request("POST", "/api/docs",
      { fileName: "sides.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 100x60",
        "    A[One]"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/sides.mmd`, cookie, origin });
    const { window } = page;
    const body = page.document.querySelector(".ve-diagram-body");
    const grip = (which) => page.document.querySelector(`.ve-diagram-grip-${which}`);
    const shut = (which) => grip(which).querySelector(".ve-diagram-grip-shut");
    const wide = (which) => body.style.getPropertyValue(`--dd-${which}`);

    check("the two sides start at the width they were given",
      [wide("rail"), wide("side")], ["132px", "300px"]);
    check("...with a bar between each of them and the paper",
      [...body.children].map((one) => one.className.split(" ")[0]),
      ["ve-diagram-rail", "ve-diagram-grip", "ve-diagram-stage",
        "ve-diagram-grip", "ve-diagram-side"]);

    // A separator rather than a decoration: an edge that can only be dragged is
    // an edge that belongs to whoever has a mouse.
    check("a bar is something the keyboard can reach",
      [grip("rail").getAttribute("role"), grip("rail").tabIndex], ["separator", 0]);

    const drag = (which, from, to) => {
      grip(which).dispatchEvent(new window.MouseEvent("pointerdown",
        { clientX: from, bubbles: true }));
      grip(which).dispatchEvent(new window.MouseEvent("pointermove",
        { clientX: to, bubbles: true }));
      grip(which).dispatchEvent(new window.MouseEvent("pointerup",
        { clientX: to, bubbles: true }));
    };

    drag("rail", 132, 192);
    check("dragging the rail's bar to the right widens the rail", wide("rail"), "192px");

    // The rail's edge is on its right and the panel's on its left, so the same
    // drag widens one and narrows the other.
    drag("side", 600, 660);
    check("...and dragging the panel's bar the same way narrows the panel",
      wide("side"), "240px");

    drag("rail", 192, 9000);
    check("neither can be dragged wider than it is allowed", wide("rail"), "260px");
    drag("rail", 260, -9000);
    check("...nor narrower", wide("rail"), "56px");
    check("...and a rail too narrow for the words shows the pictures alone",
      body.classList.contains("is-rail-tight"), true);

    // The arrow keys move it too, by a step rather than by a pixel.
    grip("rail").dispatchEvent(new window.KeyboardEvent("keydown",
      { key: "ArrowRight", bubbles: true }));
    check("an arrow key moves the edge as well", wide("rail"), "76px");

    /* Shut, a region is gone and its bar is all that is left of it — which is
     * what makes it something you can bring back rather than something you
     * have lost.
     */
    shut("side").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("the chevron takes a side away", body.classList.contains("is-side-shut"), true);
    check("...leaving the bar that brings it back",
      Boolean(grip("side")), true);
    check("...which says it is the way back",
      shut("side").getAttribute("aria-expanded"), "false");

    shut("side").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("and brings it back the width it was",
      [body.classList.contains("is-side-shut"), wide("side")], [false, "240px"]);

    // Kept in the browser, so the next diagram opens the way the last one was
    // left. A place that will not keep it is a place where the panels still
    // work, so every read and write of it is allowed to fail.
    const kept = JSON.parse(window.localStorage.getItem("azadocs:diagram:panels"));
    check("what was left is written down", [kept.rail, kept.side], [76, 240]);

    const wideOf = (one, which) =>
      one.document.querySelector(".ve-diagram-body").style.getPropertyValue(`--dd-${which}`);

    const again = await openPage({ url: `${origin}/diagram/file/sides.mmd`, cookie, origin,
      panels: window.localStorage.getItem("azadocs:diagram:panels") });
    check("...and the next diagram opens the way the last one was left",
      [wideOf(again, "rail"), wideOf(again, "side")], ["76px", "240px"]);

    // Nothing kept, or nothing readable, is the standard widths rather than a
    // panel that will not open.
    const fresh = await openPage({ url: `${origin}/diagram/file/sides.mmd`, cookie, origin });
    check("a browser holding nothing opens at the widths it was built with",
      [wideOf(fresh, "rail"), wideOf(fresh, "side")], ["132px", "300px"]);

    const bad = await openPage({ url: `${origin}/diagram/file/sides.mmd`, cookie, origin,
      panels: "{not json" });
    check("...and so does one holding something it cannot read",
      [wideOf(bad, "rail"), wideOf(bad, "side")], ["132px", "300px"]);

    const daft = await openPage({ url: `${origin}/diagram/file/sides.mmd`, cookie, origin,
      panels: JSON.stringify({ rail: 99999, side: -4 }) });
    check("...and one holding a width no panel may be is held to what it may",
      [wideOf(daft, "rail"), wideOf(daft, "side")], ["260px", "200px"]);

    daft.window.close();
    bad.window.close();
    fresh.window.close();
    again.window.close();
    page.window.close();
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
      { clientX: aimed.x, clientY: aimed.y, deltaY: -100, ctrlKey: true,
        bubbles: true, cancelable: true }));

    const zoomed = view();
    check("Ctrl and the wheel zooms in", zoomed.scale > before.scale, true);
    // The whole point of zooming about the pointer: the thing you are pointing
    // at is the thing that stays put, and everything else moves around it.
    check("...about the pointer, so what was under it still is", [
      Math.round(((under.x * zoomed.scale) + zoomed.x) - aimed.x),
      Math.round(((under.y * zoomed.scale) + zoomed.y) - aimed.y)
    ], [0, 0]);

    canvas.dispatchEvent(new window.window.WheelEvent("wheel",
      { clientX: aimed.x, clientY: aimed.y, deltaY: 100, ctrlKey: true,
        bubbles: true, cancelable: true }));
    check("...and the other way turns it back", Math.round(view().scale * 1000),
      Math.round(before.scale * 1000));

    /* --- and a bare wheel moves about ---------------------------------------
     *
     * Which is what it means in Figma, in Canva and in every map anybody has
     * scrolled. It used to zoom, and that left a diagram zoomed away to one
     * side with no way back: the only thing the wheel could do was zoom it
     * further away.
     */
    const still = view();
    canvas.dispatchEvent(new window.window.WheelEvent("wheel",
      { clientX: aimed.x, clientY: aimed.y, deltaY: 120, bubbles: true, cancelable: true }));
    check("a bare wheel moves the diagram rather than zooming it",
      [view().x - still.x, view().y - still.y], [0, -120]);
    check("...at the zoom it was already at", view().scale, still.scale);

    canvas.dispatchEvent(new window.window.WheelEvent("wheel",
      { clientX: aimed.x, clientY: aimed.y, deltaX: -80, bubbles: true, cancelable: true }));
    check("...and a trackpad pushed sideways moves it sideways",
      [view().x - still.x, view().y - still.y], [80, -120]);

    /* A mouse with one wheel says sideways with Shift, and the browsers do not
     * agree on how to spell it: some translate it to deltaX themselves, some
     * send deltaY with shiftKey set. Both have to be read, or half the mice in
     * the world scroll nothing at all.
     */
    canvas.dispatchEvent(new window.window.WheelEvent("wheel",
      { clientX: aimed.x, clientY: aimed.y, deltaY: 50, shiftKey: true,
        bubbles: true, cancelable: true }));
    check("...as does a wheel with only one direction and Shift held",
      [view().x - still.x, view().y - still.y], [30, -120]);

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

    const fit = [...page.document.querySelectorAll(".ve-diagram-zoom .ve-diagram-icon")].pop();
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

    // Coalesced to one update per frame, and letting go used to throw away
    // whatever had not been drawn yet — so a flick quicker than a frame was a
    // pan that never happened.
    const flickFrom = view();
    box.dispatchEvent(new window.MouseEvent("pointerdown", at(200, 200)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(260, 250)));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(260, 250)));
    check("...and a flick quicker than a frame is a pan all the same",
      [view().x - flickFrom.x, view().y - flickFrom.y], [60, 50]);
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
    // One to draw an arrow with, and eight to resize by: four corners and four
    // sides, because a box you can only resize diagonally is a box you cannot
    // make wider without also making it taller.
    check("...with the handles that belong to one box",
      [canvas.querySelectorAll(".dd-marks [data-role=connect]").length,
        canvas.querySelectorAll(".dd-marks [data-role=resize]").length], [1, 8]);
    check("...one on every side and one on every corner",
      [...canvas.querySelectorAll(".dd-marks [data-role=resize]")]
        .map((one) => one.dataset.grip),
      ["nw", "n", "ne", "w", "e", "sw", "s", "se"]);

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

  console.log("=== everything you can do to what is under the pointer ===");
  {
    await server.request("POST", "/api/docs",
      { fileName: "menu.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 80x40",
        "    %% @ B 300,100 80x40",
        "    A[One]",
        "    B[Two]",
        "    A --> B"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/menu.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const menu = () => canvas.querySelector(".ve-diagram-menu");
    // The library's own menu markup: an icon, the label in a span, the
    // keystroke in a kbd. Read the span, which is the label and nothing else.
    const labels = () => [...canvas.querySelectorAll(".ve-diagram-menu .context-item")]
      .map((one) => one.querySelector("span").textContent.trim());
    const clickItem = (text) => [...canvas.querySelectorAll(".ve-diagram-menu .context-item")]
      .find((one) => one.querySelector("span").textContent.trim() === text)
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const boxes = () => [...canvas.querySelectorAll(".dd-node")].map((one) => one.getAttribute("data-id"));
    const ringed = () => canvas.querySelectorAll(".dd-ring").length;

    const rightClick = (target) => {
      const event = new window.MouseEvent("contextmenu",
        { clientX: 300, clientY: 300, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event;
    };

    check("nothing is open to begin with", Boolean(menu()), false);

    const stopped = rightClick(canvas.querySelector('.dd-node[data-id="A"]'));
    check("right-clicking a box opens a list of what can be done to it",
      Boolean(menu()), true);
    // Otherwise the browser's own menu covers ours.
    check("...instead of the browser's own", stopped.defaultPrevented, true);
    check("...about the box, so it holds it", ringed(), 1);
    check("...offering what a box can do",
      ["Rename box", "Duplicate box", "Copy box", "Delete box"]
        .every((one) => labels().includes(one)), true);
    check("...and saying which keys do the same",
      [...canvas.querySelectorAll(".ve-diagram-menu kbd")].map((one) => one.textContent)
        .includes("Ctrl+D"), true);

    /* It is the library's menu, not one that looks nearly like it: the same
     * markup the file tree opens, so the same stylesheet dresses both and they
     * cannot drift apart.
     */
    check("...in the same menu the rest of the app opens",
      menu().classList.contains("context-menu"), true);
    check("...with an icon on every item, as that menu has",
      [...canvas.querySelectorAll(".ve-diagram-menu .context-item")]
        .every((one) => Boolean(one.querySelector("i.ph"))), true);
    check("...and a delete that looks like one",
      [...canvas.querySelectorAll(".ve-diagram-menu .context-item.danger")]
        .map((one) => one.querySelector("span").textContent), ["Delete box"]);

    /* Copy leaves the paper exactly as it was, so if the list has gone it is
     * because choosing put it away — and not because a redraw swept it off. */
    clickItem("Copy box");
    check("choosing something puts the list away", Boolean(menu()), false);

    rightClick(canvas.querySelector('.dd-node[data-id="A"]'));
    clickItem("Duplicate box");
    check("choosing something does it", boxes().length, 3);
    check("...and the list is gone after that too", Boolean(menu()), false);

    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));

    /* --- what is offered depends on what was clicked ------------------------ */

    rightClick(canvas.querySelector(".dd-edge"));
    check("right-clicking an arrow is about the arrow",
      labels().includes("Rename arrow") && labels().includes("Delete arrow"), true);
    check("...and does not offer what only a box can do",
      labels().includes("Rename box"), false);

    clickItem("Reverse arrow");
    await saveAndWait(page);
    const turned = (await server.request("GET", "/api/docs/menu.mmd", undefined, { Cookie: cookie })).body.content;
    check("an arrow can be turned round", turned.includes("B --> A"), true);

    rightClick(canvas);
    check("right-clicking the paper is about the diagram",
      labels().includes("Select all boxes") && labels().includes("Copy diagram as Mermaid"), true);
    check("...and offers nothing that needs a box",
      labels().some((one) => one.startsWith("Duplicate")), false);

    clickItem("Select all boxes");
    check("...and select all from it selects all", ringed(), 2);

    // With several held, the list speaks about all of them.
    rightClick(canvas.querySelector('.dd-node[data-id="A"]'));
    check("with a handful held, the list says how many it is about",
      labels().includes("Delete 2 boxes"), true);
    check("...and drops what only makes sense for one", labels().includes("Rename box"), false);

    clickItem("Delete 2 boxes");
    check("...and does it to all of them", boxes().length, 0);
    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));

    /* --- putting it away --------------------------------------------------- */

    rightClick(canvas.querySelector('.dd-node[data-id="A"]'));
    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    check("escape puts the list away", Boolean(menu()), false);
    check("...without also letting go of the box", ringed(), 1);

    /* Pressed on the box that is already held, so nothing about the diagram
     * changes and the list can only have gone because pressing put it away —
     * pressing empty paper would let go of everything and redraw over it. */
    rightClick(canvas.querySelector('.dd-node[data-id="A"]'));
    canvas.querySelector('.dd-node[data-id="A"]').dispatchEvent(
      new window.MouseEvent("pointerdown", { clientX: 200, clientY: 200, bubbles: true }));
    check("pressing anywhere puts it away too", Boolean(menu()), false);
    canvas.dispatchEvent(new window.MouseEvent("pointerup", { clientX: 200, clientY: 200, bubbles: true }));

    /* --- a finger has no second button ------------------------------------- */

    const finger = (type, x, y) => {
      const event = new window.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
      Object.defineProperty(event, "pointerType", { value: "touch" });
      Object.defineProperty(event, "pointerId", { value: 4 });
      return event;
    };

    // Asked for again every time: a redraw replaces the drawing, and a press on
    // a box that has been swept out of the document reaches nothing at all.
    const box = () => canvas.querySelector('.dd-node[data-id="A"]');

    box().dispatchEvent(finger("pointerdown", 200, 200));
    await new Promise((r) => setTimeout(r, 700));
    check("a finger held still opens the same list", Boolean(menu()), true);
    check("...about the box under it", labels().includes("Rename box"), true);
    canvas.dispatchEvent(finger("pointerup", 200, 200));

    // A press that turns into a drag was a drag all along.
    box().dispatchEvent(finger("pointerdown", 200, 200));
    canvas.dispatchEvent(finger("pointermove", 260, 240));
    await new Promise((r) => setTimeout(r, 700));
    check("a finger that moves is dragging, not asking", Boolean(menu()), false);
    canvas.dispatchEvent(finger("pointerup", 260, 240));

    // And one that lets go quickly was a tap.
    box().dispatchEvent(finger("pointerdown", 200, 200));
    canvas.dispatchEvent(finger("pointerup", 200, 200));
    await new Promise((r) => setTimeout(r, 700));
    check("a finger that lets go is tapping, not asking", Boolean(menu()), false);
  }

  console.log("=== a colour is a classDef, which every other renderer reads ===");
  {
    await server.request("POST", "/api/docs",
      { fileName: "colour.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 80x40",
        "    %% @ B 300,100 80x40",
        "    %% @ C 500,100 80x40",
        "    classDef mine fill:#123456",
        "    A[One]",
        "    B[Two]",
        "    C[Three]"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/colour.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const inspector = page.document.querySelector(".ve-diagram-inspector");
    const swatches = () => [...inspector.querySelectorAll(".ve-diagram-swatch")];
    const pick = (label) => swatches().find((one) => one.title === label)
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const groupOf = (id) => canvas.querySelector(`.dd-node[data-id="${id}"]`);
    const fillOf = (id) => groupOf(id).style.getPropertyValue("--dd-fill");
    const tap = (id) => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(groupOf(id).getAttribute("transform"));
      const x = Number(found[1]) + 10;
      const y = Number(found[2]) + 10;
      groupOf(id).dispatchEvent(new window.MouseEvent("pointerdown",
        { clientX: x, clientY: y, bubbles: true }));
      canvas.dispatchEvent(new window.MouseEvent("pointerup",
        { clientX: x, clientY: y, bubbles: true }));
    };
    const written = async () => (await server.request("GET", "/api/docs/colour.mmd",
      undefined, { Cookie: cookie })).body.content;

    tap("A");
    check("a box offers the colours it can be", swatches().length > 2, true);
    check("...and starts wearing none of them",
      swatches()[0].getAttribute("aria-pressed"), "true");

    pick("Red");
    check("choosing one colours the box", fillOf("A"), "#fbdedc");
    check("...and says which one is being worn",
      swatches().find((one) => one.title === "Red").getAttribute("aria-pressed"), "true");
    check("...and leaves the box beside it alone", fillOf("B"), "");

    await saveAndWait(page);
    const red = await written();
    check("the colour reaches the file as a classDef, not as a comment",
      /classDef ddC1 fill:#fbdedc,stroke:#c0453c,color:#4a1512/.test(red), true);
    check("...with a line saying which box wears it", /class A ddC1/.test(red), true);
    check("the classDef that was already there is untouched",
      /classDef mine fill:#123456/.test(red), true);

    /* One definition per colour, shared. Twenty blue boxes are one classDef and
     * one class line, which is smaller and is how a person would write it.
     */
    tap("B");
    pick("Red");
    await saveAndWait(page);
    const both = await written();
    check("a second box in the same colour reuses the definition",
      (both.match(/classDef ddC1/g) || []).length, 1);
    check("...and joins the line that names who wears it", /class A,B ddC1/.test(both), true);

    // Changed rather than added to, or a box that was red and is now green
    // would be wearing both and the file would say so.
    tap("A");
    pick("Green");
    await saveAndWait(page);
    const changed = await written();
    check("changing a colour swaps the class rather than adding one",
      /class A ddC2/.test(changed) && /class B ddC1/.test(changed), true);
    check("...leaving the box wearing exactly one of ours",
      (changed.match(/^\s*class A /gm) || []).length, 1);

    // Cleared: the class goes, and so does a definition of ours nobody wears.
    tap("B");
    pick("No colour");
    await saveAndWait(page);
    const cleared = await written();
    check("clearing a colour takes the class off the box", /class B/.test(cleared), false);
    check("...and takes a definition of ours nobody wears with it",
      /classDef ddC1/.test(cleared), false);
    check("...while one written by hand stays, worn or not",
      /classDef mine fill:#123456/.test(cleared), true);

    // A handful at once, which is the reason to hold four boxes in the first
    // place.
    canvas.dispatchEvent(new window.KeyboardEvent("keydown",
      { key: "a", ctrlKey: true, bubbles: true }));
    check("holding several offers the colours all the same",
      inspector.querySelectorAll(".ve-diagram-swatch").length > 2, true);
    pick("Blue");
    check("...and one choice colours every one of them",
      [fillOf("A"), fillOf("B"), fillOf("C")], ["#d9e6fb", "#d9e6fb", "#d9e6fb"]);

    await saveAndWait(page);
    const blue = await written();
    check("...written as one definition and one line naming all three",
      /class A,B,C ddC\d/.test(blue), true);

    // Read back through the parser rather than assumed: a colour this editor
    // can write and the parser cannot read is a diagram damaged by being saved.
    const reopened = window.DiagramModel.parseFlowchart(blue);
    check("...which is read back as the same colour",
      reopened.classes[reopened.nodes[0].classes[0]].fill, "#d9e6fb");
  }

  console.log("=== a line is a style and two ends, chosen one at a time ===");
  {
    await server.request("POST", "/api/docs",
      { fileName: "ends.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 80x40",
        "    %% @ B 300,300 80x40",
        "    A[One]",
        "    B[Two]",
        "    A --> B"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/ends.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const inspector = page.document.querySelector(".ve-diagram-inspector");
    const control = (aria) => inspector.querySelector(`[aria-label="${aria}"]`);
    const choose = (aria, value) => {
      const found = control(aria);
      found.value = value;
      found.dispatchEvent(new window.Event("change", { bubbles: true }));
    };
    const groupOf = (id) => canvas.querySelector(`.dd-node[data-id="${id}"]`);
    const tap = (id) => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(groupOf(id).getAttribute("transform"));
      const x = Number(found[1]) + 10;
      const y = Number(found[2]) + 10;
      groupOf(id).dispatchEvent(new window.MouseEvent("pointerdown",
        { clientX: x, clientY: y, bubbles: true }));
      canvas.dispatchEvent(new window.MouseEvent("pointerup",
        { clientX: x, clientY: y, bubbles: true }));
    };
    const written = async () => (await server.request("GET", "/api/docs/ends.mmd",
      undefined, { Cookie: cookie })).body.content;

    tap("A");

    /* Three controls, not one list of eleven. A line is a style and two ends,
     * and the eleven links Mermaid has are what a few of those combinations
     * happen to be called — asking for the name instead of the thing is why
     * "dotted line with a hollow diamond on it" was unreachable.
     */
    check("the arrow offers what is at its back", Boolean(control("Arrow start")), true);
    check("...how it is drawn", Boolean(control("Line style")), true);
    check("...what shape it is drawn in", Boolean(control("Line shape")), true);
    check("...and what is at its point", Boolean(control("Arrow end")), true);
    check("a plain arrow starts with nothing behind it and an arrow ahead",
      [control("Arrow start").value, control("Line style").value, control("Arrow end").value],
      ["none", "solid", "arrow"]);
    check("...drawn the way every line has always been drawn",
      control("Line shape").value, "angled");

    // An ending Mermaid has no words for. The file gets the nearest link it
    // does have, and the exact ending beside it.
    choose("Arrow end", "triangle");
    // The canvas redraws a beat after the change, the way it does for typing.
    await new Promise((r) => setTimeout(r, 300));
    check("the line is drawn with the ending it was given, not with an arrow",
      /marker-end="url\(#dd-end-triangle-\d+\)"/.test(canvas.innerHTML), true);

    await saveAndWait(page);
    const uml = await written();
    check("...and an ending Mermaid cannot spell still writes a link it can read",
      /^\s*A --> B\s*$/m.test(uml), true);
    check("...with the ending it really has kept beside it",
      /%% edge 0 [^\n]*ends=none,triangle/.test(uml), true);

    // The style is the other half, and it is a separate question.
    choose("Line style", "dotted");
    await saveAndWait(page);
    const dotted = await written();
    check("changing how the line is drawn leaves its ends alone",
      /^\s*A -\.-> B\s*$/m.test(dotted) && /ends=none,triangle/.test(dotted), true);
    check("...and the control agrees it is dotted", control("Line style").value, "dotted");

    // Something at the back makes it a both-ways link, which is the nearest
    // real thing however unlike the two ends actually are.
    choose("Arrow start", "diamond");
    await saveAndWait(page);
    const both = await written();
    check("something at the back makes it a both-ways link in the file",
      /^\s*A <-\.-> B\s*$/m.test(both), true);
    check("...while the comment still says which end is which",
      /ends=diamond,triangle/.test(both), true);

    /* The shape of the line is a separate question again, and a quiet one: it
     * is not something Mermaid has an opinion about, so it goes in the layout
     * comment and leaves the link alone.
     */
    choose("Line shape", "curved");
    await new Promise((r) => setTimeout(r, 300));
    check("a curved line is drawn with curves in it",
      /Q[\d.]+,[\d.]+/.test(canvas.querySelector(".dd-edge .dd-line").getAttribute("d")), true);

    await saveAndWait(page);
    const bendy = await written();
    check("...which the file says in the layout comment", /route=curved/.test(bendy), true);
    check("...and the link it is drawn on is untouched",
      /^\s*A <-\.-> B\s*$/m.test(bendy), true);

    choose("Line shape", "straight");
    await new Promise((r) => setTimeout(r, 300));
    check("a straight line is one segment",
      (canvas.querySelector(".dd-edge .dd-line").getAttribute("d").match(/[LQ]/g) || []).length, 1);

    choose("Line shape", "curved");

    /* Dragging a box re-routes its arrows in place rather than redrawing the
     * whole diagram, and a re-route that draws a different line from the one a
     * redraw would draw is a tip that hides itself for the length of the drag
     * and comes back when you let go.
     */
    const lineOf = () => canvas.querySelector(".dd-edge .dd-line").getAttribute("d");
    const held = groupOf("B");
    const place = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(held.getAttribute("transform"));
    const at = (px, py) => ({ clientX: px, clientY: py, bubbles: true });
    const grabX = Number(place[1]) + 10;
    const grabY = Number(place[2]) + 10;

    held.dispatchEvent(new window.MouseEvent("pointerdown", at(grabX, grabY)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(grabX, grabY + 40)));
    // The re-route happens on the next frame, the way every other one does.
    await new Promise((done) => window.requestAnimationFrame(
      () => window.requestAnimationFrame(done)));
    const dragged = lineOf();
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(grabX, grabY + 40)));
    await new Promise((r) => setTimeout(r, 300));

    check("an arrow re-routed by a drag is the same line a redraw would give",
      dragged, lineOf());
    // B is now at y=340 and wears a shape at each end of the line, so the line
    // runs from two pixels below A to two pixels above B.
    /* B is now at 300,340 and the line wears a shape at each end, so it leaves
     * A two pixels down and arrives at B two pixels short — and it is curved,
     * so the re-route has to draw the curve as well. A drag that quietly
     * straightened every corner would be a diagram that changed shape for as
     * long as it was being worked on.
     */
    check("...which is one that stops short of the box at either end, curves and all",
      dragged,
      "M140,142 L140,228 Q140,240 152,240 L328,240 Q340,240 340,252 L340,338");
    dragBox(window, "B", 0, -40);

    /* And the controls have to be able to read all that back. A panel that
     * always opens saying "solid arrow" is a panel that quietly undoes the
     * line the moment anything else about it is changed.
     */
    tap("B");
    tap("A");
    check("reopening the arrow shows the line it actually is",
      [control("Arrow start").value, control("Line style").value,
        control("Line shape").value, control("Arrow end").value],
      ["diamond", "dotted", "curved", "triangle"]);

    /* And put back to the ordinary shape it says nothing at all — not even
     * beside the ends, which do need writing down. An arrow drawn the way every
     * arrow has always been drawn has nothing to say about it.
     */
    choose("Line shape", "angled");
    await saveAndWait(page);
    const ordinary = await written();
    check("a line put back to the ordinary shape says nothing about its shape",
      /route=/.test(ordinary), false);
    check("...while what does need saying is still said",
      /ends=diamond,triangle/.test(ordinary), true);

    /* And back to an ordinary arrow. The comment has to go with it: a file that
     * kept saying `ends=none,arrow` would carry a layout line for every arrow
     * in every diagram, saying what the arrow already said.
     */
    choose("Arrow start", "none");
    choose("Line style", "solid");
    choose("Arrow end", "arrow");
    await saveAndWait(page);
    const back = await written();
    check("an ordinary arrow is written as an ordinary arrow",
      /^\s*A --> B\s*$/m.test(back), true);
    check("...and grows no comment saying what it already says",
      /ends=/.test(back), false);
  }

  console.log("=== an icon is picked out of a grid of them ===");
  {
    await server.request("POST", "/api/docs",
      { fileName: "icons.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 120x100",
        "    A[Store]"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/icons.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const inspector = page.document.querySelector(".ve-diagram-inspector");
    const groupOf = () => canvas.querySelector('.dd-node[data-id="A"]');

    const tap = () => {
      const spot = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(groupOf().getAttribute("transform"));
      const x = Number(spot[1]) + 10;
      const y = Number(spot[2]) + 10;
      groupOf().dispatchEvent(new window.MouseEvent("pointerdown",
        { clientX: x, clientY: y, bubbles: true }));
      canvas.dispatchEvent(new window.MouseEvent("pointerup",
        { clientX: x, clientY: y, bubbles: true }));
    };

    const grid = () => inspector.querySelector(".ve-diagram-icon-grid");
    const offered = () => [...grid().querySelectorAll(".ve-diagram-icon-one")]
      .map((one) => one.getAttribute("aria-label"));
    const legends = () => [...grid().querySelectorAll(".ve-diagram-icon-legend")]
      .map((one) => one.textContent);
    const press = (label) => [...grid().querySelectorAll(".ve-diagram-icon-one")]
      .find((one) => one.getAttribute("aria-label") === label)
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const find = () => inspector.querySelector(".ve-diagram-find");
    const search = (words) => {
      find().value = words;
      find().dispatchEvent(new window.Event("input", { bubbles: true }));
    };
    const drawn = () => Boolean(groupOf().querySelector(".dd-icon"));

    tap();
    check("a box offers every icon this build has", offered().length > 100, true);
    check("...in the groups somebody looking for one would think of",
      legends().slice(0, 2), ["Machines", "Networks"]);
    check("...wearing none of them", drawn(), false);

    press("database");
    check("picking one puts it on the box", drawn(), true);
    check("...and says which one is on", (() => {
      const on = [...grid().querySelectorAll('.ve-diagram-icon-one[aria-pressed="true"]')];
      return on.map((one) => one.getAttribute("aria-label"));
    })(), ["database"]);
    // The icon's own markup sits between the text nodes, so what the box says
    // is what is left once that whitespace is taken out.
    check("...leaving the words underneath it", groupOf().textContent.trim(), "Store");

    /* Searched by name, because Lucide's names say what the picture is — a list
     * of keywords beside them would be a second thing to keep in step with the
     * first. Searching is a grouping of its own, so it takes the groups over.
     */
    search("cloud");
    check("searching narrows it to what matches",
      offered().every((name) => name.includes("cloud")), true);
    check("...to more than one thing", offered().length > 2, true);
    check("...and drops the groups, being a grouping itself", legends(), []);

    search("zzz");
    check("a search that matches nothing says so",
      [offered(), inspector.querySelector(".ve-diagram-hint:not([hidden])").textContent],
      [[], 'No icon is called "zzz".']);

    search("");
    check("clearing it brings them all back", offered().length > 100, true);

    await saveAndWait(page);
    const written = (await server.request("GET", "/api/docs/icons.mmd",
      undefined, { Cookie: cookie })).body.content;
    check("an icon reaches the file beside where its box is",
      /%% @ A 100,100 120x100 icon=lucide:database/.test(written), true);
    check("...and the box keeps its label, which is what travels everywhere else",
      /A\[Store\]/.test(written), true);

    // Wearing it already, pressing it takes it off — the only way a grid of
    // switches can also be a way to say "none of these".
    press("database");
    check("pressing the one that is on takes it off", drawn(), false);

    page.window.close();
  }

  console.log("=== a picture is dropped on the paper where it lands ===");
  {
    /* The gesture everybody tries first. The button in the panel is the second
     * way rather than the only way, and the store a picture goes into is the
     * one documents already paste into — so a picture in a diagram and a
     * picture in a document are the same bytes under the same hash.
     */
    await server.request("POST", "/api/docs",
      { fileName: "shot.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 100x60",
        "    A[One]"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/shot.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const inspector = page.document.querySelector(".ve-diagram-inspector");
    const boxes = () => canvas.querySelectorAll(".dd-node").length;
    const pictures = () => [...canvas.querySelectorAll(".dd-picture")]
      .map((one) => one.getAttribute("href"));

    const drop = (name, x, y, type = "image/png") => {
      const file = new window.File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
        name, { type });
      const event = new window.Event("drop", { bubbles: true, cancelable: true });
      event.dataTransfer = { files: [file], dropEffect: "" };
      event.clientX = x;
      event.clientY = y;
      canvas.dispatchEvent(event);
    };

    const sizeOf = (id) => {
      const rect = canvas.querySelector(`.dd-node[data-id="${id}"] rect`);
      return [Number(rect.getAttribute("width")), Number(rect.getAttribute("height"))];
    };

    // The paper says it will take the picture before it is let go: a drag that
    // gives no sign of being noticed is a drag people let go of somewhere else.
    const over = new window.Event("dragover", { bubbles: true, cancelable: true });
    over.dataTransfer = { files: [{ type: "image/png" }], dropEffect: "" };
    canvas.dispatchEvent(over);
    check("the paper says it will take a picture being dragged over it",
      canvas.classList.contains("is-dropping"), true);

    check("a diagram of one box starts with no pictures", [boxes(), pictures()], [1, []]);

    drop("cat.png", 300, 300);
    await waitFor(window, () => pictures().length > 0,
      "the picture was never added to the diagram");

    check("a picture dropped on the paper becomes a box on the paper", boxes(), 2);
    check("...holding the picture, at the address the store gave it",
      /^\/api\/assets\/[0-9a-f]{64}\.png$/.test(pictures()[0]), true);
    check("...and the paper stops saying it will take one",
      canvas.classList.contains("is-dropping"), false);
    check("...named after the file it came from, without its extension",
      [...canvas.querySelectorAll(".dd-node")].pop().textContent, "cat");

    // Room to be a picture in. Measured by the words under it instead, a
    // picture arrives in a box the size of its caption.
    check("...in a box big enough to be a picture rather than a caption",
      sizeOf("n1"), [180, 140]);

    // A file that is not a picture is not a picture. The paper takes images;
    // everything else goes on being whatever the browser would have done with
    // it, which is not this.
    const was = boxes();
    drop("notes.txt", 400, 400, "text/plain");
    await settle();
    check("something that is not a picture is not dropped on the paper",
      [boxes(), pictures().length], [was, 1]);

    // The same bytes are the same hash, so dropping the same picture twice
    // stores it once — which is what the document store already does.
    drop("cat.png", 500, 300);
    await waitFor(window, () => pictures().length > 1,
      "the second picture was never added");
    check("the same picture twice is the same picture, stored once",
      pictures()[0], pictures()[1]);

    await saveAndWait(page);
    const written = (await server.request("GET", "/api/docs/shot.mmd",
      undefined, { Cookie: cookie })).body.content;
    check("a picture reaches the file beside where its box is",
      (written.match(/image=\/api\/assets\/[0-9a-f]{64}\.png/g) || []).length, 2);

    /* The panel offers the other way in, and a way back out. A box with a
     * picture offers to replace it; one without offers to add one.
     */
    const groupOf = (id) => canvas.querySelector(`.dd-node[data-id="${id}"]`);
    const tap = (id) => {
      const spot = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(groupOf(id).getAttribute("transform"));
      const x = Number(spot[1]) + 10;
      const y = Number(spot[2]) + 10;
      groupOf(id).dispatchEvent(new window.MouseEvent("pointerdown",
        { clientX: x, clientY: y, bubbles: true }));
      canvas.dispatchEvent(new window.MouseEvent("pointerup",
        { clientX: x, clientY: y, bubbles: true }));
    };
    const buttons = () => [...inspector.querySelectorAll(".ve-diagram-add")]
      .map((one) => one.textContent);

    tap("A");
    check("a box with no picture offers to take one",
      buttons().includes("Add a picture"), true);
    check("...and nothing to take off", buttons().includes("Take it off"), false);

    tap("n1");
    check("a box with a picture offers to replace it",
      buttons().includes("Replace the picture"), true);

    inspector.querySelectorAll(".ve-diagram-add")
      .forEach((one) => {
        if (one.textContent === "Take it off") {
          one.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
        }
      });

    check("...and taking it off leaves the box behind", [boxes(), pictures().length], [3, 1]);

    page.window.close();
  }

  console.log("=== the type a box is set in is a classDef like everything else ===");
  {
    /* Every font control goes the way a colour and a border go: into a classDef,
     * which every Mermaid renderer reads. There is no control here for anything
     * Mermaid cannot say, because a size the file cannot keep is a size that
     * goes away the next time the diagram is opened somewhere else.
     */
    await server.request("POST", "/api/docs",
      { fileName: "type.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 120x60",
        "    A[One]"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/type.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const inspector = page.document.querySelector(".ve-diagram-inspector");
    const groupOf = () => canvas.querySelector('.dd-node[data-id="A"]');

    const tap = () => {
      const spot = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(groupOf().getAttribute("transform"));
      const x = Number(spot[1]) + 10;
      const y = Number(spot[2]) + 10;
      groupOf().dispatchEvent(new window.MouseEvent("pointerdown",
        { clientX: x, clientY: y, bubbles: true }));
      canvas.dispatchEvent(new window.MouseEvent("pointerup",
        { clientX: x, clientY: y, bubbles: true }));
    };

    const menu = (label) => [...inspector.querySelectorAll(".ve-diagram-kind")]
      .find((one) => one.getAttribute("aria-label") === label);
    const pick = (label, value) => {
      const one = menu(label);
      one.value = value;
      one.dispatchEvent(new window.Event("change", { bubbles: true }));
    };
    const mark = (label) => [...inspector.querySelectorAll(".ve-diagram-mark")]
      .find((one) => one.getAttribute("aria-label") === label);
    const setOf = (property) => groupOf().style.getPropertyValue(property);

    tap();
    check("a box offers a font, a size and the two switches",
      [Boolean(menu("Font")), Boolean(menu("Text size")),
        Boolean(mark("Bold")), Boolean(mark("Italic"))], [true, true, true, true]);
    check("...and starts wearing none of them",
      [menu("Font").value, menu("Text size").value,
        mark("Bold").getAttribute("aria-pressed")], ["Default", "Normal", "false"]);

    pick("Font", "Mono");
    check("choosing a font sets the box in it", setOf("--dd-font-family"), "monospace");
    // The panel is redrawn from what the box is wearing, so the menu has to
    // come back saying what was just chosen rather than what it opened saying.
    check("...and the menu says so afterwards", menu("Font").value, "Mono");

    pick("Text size", "Large");
    check("...and a size beside it, without taking the font off",
      [setOf("--dd-font-size"), setOf("--dd-font-family")], ["16px", "monospace"]);
    check("...with both menus saying what they are",
      [menu("Font").value, menu("Text size").value], ["Mono", "Large"]);

    mark("Bold").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("a switch goes on", setOf("--dd-font-weight"), "700");
    check("...and says it is on", mark("Bold").getAttribute("aria-pressed"), "true");

    mark("Italic").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("...and the other is a switch of its own",
      [setOf("--dd-font-style"), setOf("--dd-font-weight")], ["italic", "700"]);

    await saveAndWait(page);
    const written = (await server.request("GET", "/api/docs/type.mmd",
      undefined, { Cookie: cookie })).body.content;
    // The name is whichever one was free; what matters is that all four
    // declarations are on one class and the box is wearing it.
    const named = (/classDef (ddC\d+) ([^\n]+)/.exec(written) || []);
    check("all four reach the file as one classDef, which is real Mermaid",
      named[2], "font-family:monospace,font-size:16px,font-weight:700,font-style:italic");
    check("...with a line saying which box wears it",
      new RegExp(`class A ${named[1]}`).test(written), true);

    // Off again takes that one declaration off and leaves the rest alone, the
    // same way clearing a colour leaves the dashed border behind.
    mark("Bold").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("a switch goes off again",
      [setOf("--dd-font-weight"), setOf("--dd-font-style")], ["", "italic"]);

    pick("Font", "Default");
    check("...and Default is a choice rather than the absence of one",
      [setOf("--dd-font-family"), setOf("--dd-font-size")], ["", "16px"]);

    page.window.close();
  }

  console.log("=== a box can be dashed, and thick, and red, all at once ===");
  {
    await server.request("POST", "/api/docs",
      { fileName: "border.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 80x40",
        "    %% @ B 100,300 80x40",
        "    A[One]",
        "    B[Two]"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/border.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const inspector = page.document.querySelector(".ve-diagram-inspector");
    const control = (aria) => inspector.querySelector(`[aria-label="${aria}"]`);
    const choose = (aria, value) => {
      const found = control(aria);
      found.value = value;
      found.dispatchEvent(new window.Event("change", { bubbles: true }));
    };
    const groupOf = (id) => canvas.querySelector(`.dd-node[data-id="${id}"]`);
    const propOf = (id, name) => groupOf(id).style.getPropertyValue(name);
    const tap = (id) => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(groupOf(id).getAttribute("transform"));
      const x = Number(found[1]) + 10;
      const y = Number(found[2]) + 10;
      groupOf(id).dispatchEvent(new window.MouseEvent("pointerdown",
        { clientX: x, clientY: y, bubbles: true }));
      canvas.dispatchEvent(new window.MouseEvent("pointerup",
        { clientX: x, clientY: y, bubbles: true }));
    };
    const written = async () => (await server.request("GET", "/api/docs/border.mmd",
      undefined, { Cookie: cookie })).body.content;

    tap("A");
    check("a box starts plain and thin",
      [control("Border").value, control("Border weight").value], ["Plain", "Thin"]);

    choose("Border", "Dashed");
    check("a dashed border is drawn dashed", propOf("A", "--dd-dash"), "6 4");

    /* The point of doing it as a classDef: a dash is real Mermaid, so the file
     * is dashed everywhere and not only here.
     */
    await saveAndWait(page);
    const dashed = await written();
    check("...and the dash reaches the file as a classDef",
      /classDef ddC1 stroke-dasharray:6 4/.test(dashed), true);

    /* Three separate questions, so answering one must not undo another. A box
     * asked to be red should not stop being dashed.
     */
    inspector.querySelector('.ve-diagram-swatch[title="Red"]')
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("colouring a dashed box leaves it dashed",
      [propOf("A", "--dd-fill"), propOf("A", "--dd-dash")], ["#fbdedc", "6 4"]);
    // ...and the swatches have to know it is still red, or a box goes on
    // looking uncoloured the moment it is also dashed.
    check("...and the panel still says which colour it is",
      inspector.querySelector('.ve-diagram-swatch[title="Red"]').getAttribute("aria-pressed"),
      "true");

    choose("Border weight", "Thick");
    check("...and so does thickening it",
      [propOf("A", "--dd-fill"), propOf("A", "--dd-dash"), propOf("A", "--dd-stroke-width")],
      ["#fbdedc", "6 4", "4px"]);

    await saveAndWait(page);
    const all = await written();
    // Order is whatever order they were chosen in, so what matters is that
    // there is one definition and that everything asked for is in it.
    const defined = (all.match(/^\s*classDef ddC\d .*$/gm) || []);
    check("all three live in one definition", defined.length, 1);
    check("...which says every one of them",
      ["fill:#fbdedc", "stroke:#c0453c", "color:#4a1512", "stroke-dasharray:6 4",
        "stroke-width:4px"].every((part) => defined[0].includes(part)), true);
    check("...and the box wears exactly one of ours",
      (all.match(/^\s*class A /gm) || []).length, 1);

    // Read back through the parser: a border this editor writes and the parser
    // cannot read is a diagram damaged by being saved.
    const reopened = window.DiagramModel.parseFlowchart(all);
    check("...which is read back as the same border",
      reopened.classes[reopened.nodes[0].classes[0]]["stroke-dasharray"], "6 4");
    check("...and the controls come back saying so",
      [control("Border").value, control("Border weight").value], ["Dashed", "Thick"]);

    /* Clearing a colour clears the colour. It is not a way of resetting the
     * box, and a dashed box that lost its dash by being un-coloured would be
     * one more thing the person has to put back.
     */
    inspector.querySelector('.ve-diagram-swatch[title="No colour"]')
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("clearing the colour keeps the border",
      [propOf("A", "--dd-fill"), propOf("A", "--dd-dash"), propOf("A", "--dd-stroke-width")],
      ["", "6 4", "4px"]);

    choose("Border", "Plain");
    choose("Border weight", "Thin");
    await saveAndWait(page);
    const bare = await written();
    check("a box put back to plain wears no class of ours", /^\s*class A/m.test(bare), false);
    check("...and leaves no definition of ours behind", /classDef ddC/.test(bare), false);

    /* A handful at once, the same as the colours. "Make these four dashed" is
     * as much a reason to hold four boxes as "make these four red" is.
     */
    canvas.dispatchEvent(new window.KeyboardEvent("keydown",
      { key: "a", ctrlKey: true, bubbles: true }));
    check("holding several offers the border all the same",
      Boolean(control("Border")), true);
    choose("Border", "Dotted");
    check("...and one choice dashes every one of them",
      [propOf("A", "--dd-dash"), propOf("B", "--dd-dash")], ["2 4", "2 4"]);
  }

  console.log("=== the arrow tool stays on until it is put away ===");
  {
    /* Drawing an arrow meant selecting the box it comes from and then finding
     * the circle on its edge: one selection per arrow, ten selections for ten
     * arrows. Switched on, a drag from any box to any box is an arrow, over and
     * over, with nothing selected first.
     */
    await server.request("POST", "/api/docs",
      { fileName: "joining.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 80x40",
        "    %% @ B 400,100 80x40",
        "    %% @ C 100,400 80x40",
        "    A[One]",
        "    B[Two]",
        "    C[Three]"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/joining.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const view = () => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\) scale\(([\d.]+)\)/
        .exec(canvas.querySelector(".dd-view").getAttribute("transform"));
      return { x: Number(found[1]), y: Number(found[2]), scale: Number(found[3]) };
    };
    const at = (x, y) => ({
      clientX: (x * view().scale) + view().x,
      clientY: (y * view().scale) + view().y,
      bubbles: true
    });
    const arrows = () => canvas.querySelectorAll(".dd-edge").length;
    const joined = () => [...canvas.querySelectorAll(".dd-edge")]
      .map((one) => `${one.dataset.from}->${one.dataset.to}`);

    const tool = [...page.document.querySelectorAll(".ve-diagram-bar .ve-diagram-icon[aria-pressed]")]
      .find((one) => /Arrow/i.test(one.getAttribute("title") || ""));

    const middleOf = (id) => {
      const spot = /translate\((-?[\d.]+),(-?[\d.]+)\)/
        .exec(canvas.querySelector(`.dd-node[data-id="${id}"]`).getAttribute("transform"));
      return [Number(spot[1]) + 40, Number(spot[2]) + 20];
    };
    const drag = (from, to) => {
      const [x1, y1] = middleOf(from);
      const [x2, y2] = middleOf(to);
      canvas.querySelector(`.dd-node[data-id="${from}"]`)
        .dispatchEvent(new window.MouseEvent("pointerdown", at(x1, y1)));
      canvas.dispatchEvent(new window.MouseEvent("pointermove", at(x2, y2)));
      canvas.dispatchEvent(new window.MouseEvent("pointerup", at(x2, y2)));
    };

    check("there is an arrow tool to switch on", Boolean(tool), true);
    check("...and it starts switched off", tool.getAttribute("aria-pressed"), "false");
    check("a diagram of three boxes starts with no arrows", arrows(), 0);

    // Off, a drag on a box moves the box. That is what a drag has always meant
    // and switching a tool on is the only thing that may change it.
    const placeOf = (id) =>
      canvas.querySelector(`.dd-node[data-id="${id}"]`).getAttribute("transform");
    const nudge = (id, dx, dy) => {
      const [x, y] = middleOf(id);
      canvas.querySelector(`.dd-node[data-id="${id}"]`)
        .dispatchEvent(new window.MouseEvent("pointerdown", at(x, y)));
      canvas.dispatchEvent(new window.MouseEvent("pointermove", at(x + dx, y + dy)));
      canvas.dispatchEvent(new window.MouseEvent("pointerup", at(x + dx, y + dy)));
    };

    nudge("A", 0, 60);
    check("with the tool off, dragging a box moves it rather than joining it",
      [arrows(), placeOf("A")], [0, "translate(100,160)"]);
    nudge("A", 0, -60);
    check("...and back where it was, so what follows starts where it started",
      placeOf("A"), "translate(100,100)");

    tool.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("switching it on says so", tool.getAttribute("aria-pressed"), "true");
    check("...and the canvas says so too",
      canvas.classList.contains("is-joining"), true);

    /* The line you drag is drawn in the diagram, not on the window.
     *
     * Both of its ends are places in the diagram — the box the model puts at
     * 100,100 and a pointer already converted back through the view — so it
     * belongs inside the group the view transform is on, beside the guides and
     * the band. Hung off the svg root instead it began where the box was not,
     * and swung about that spot instead of following the pointer.
     */
    const [aX, aY] = middleOf("A");
    canvas.querySelector('.dd-node[data-id="A"]')
      .dispatchEvent(new window.MouseEvent("pointerdown", at(aX, aY)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(aX + 150, aY + 90)));
    await new Promise((done) => window.requestAnimationFrame(
      () => window.requestAnimationFrame(done)));

    const draft = canvas.querySelector(".dd-draft");
    check("a drag draws a line to follow the pointer", Boolean(draft), true);
    check("...in the diagram rather than over the window",
      draft.parentNode === canvas.querySelector(".dd-view"), true);
    check("...starting at the middle of the box it came from and ending under"
      + " the pointer", draft.getAttribute("d"), "M140,120 L290,210");

    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(aX + 150, aY + 90)));
    check("...and letting go over nothing takes the line away with it",
      [canvas.querySelector(".dd-draft"), arrows()], [null, 0]);

    drag("A", "B");
    check("a drag between two boxes is an arrow", joined(), ["A->B"]);
    check("...and the tool is still on", tool.getAttribute("aria-pressed"), "true");

    // The whole reason for it being a mode: the second arrow costs the same as
    // the first. And the second arrow out of the same box has to be an arrow —
    // the first one is lying under the drag by then.
    drag("A", "C");
    check("...so the next drag is the next arrow", joined(), ["A->B", "A->C"]);
    check("...rather than a corner put into the one already there",
      canvas.querySelectorAll(".dd-via").length, 0);

    /* A tap that goes nowhere has drawn nothing. The circle on a selected box
     * grows a new box when it is clicked, and the tool borrows that gesture —
     * so without saying otherwise, every tap on a box while the tool was on
     * made another box.
     */
    const boxes = () => canvas.querySelectorAll(".dd-node").length;
    const was = boxes();
    const [tapX, tapY] = middleOf("B");
    canvas.querySelector('.dd-node[data-id="B"]')
      .dispatchEvent(new window.MouseEvent("pointerdown", at(tapX, tapY)));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(tapX, tapY)));
    check("a tap that goes nowhere draws nothing and makes nothing",
      [boxes(), joined().length], [was, 2]);

    // And a drag that reaches empty paper has reached no box to join to.
    canvas.querySelector('.dd-node[data-id="B"]')
      .dispatchEvent(new window.MouseEvent("pointerdown", at(tapX, tapY)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(tapX + 400, tapY + 400)));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(tapX + 400, tapY + 400)));
    check("...and neither does one let go over nothing",
      [boxes(), joined().length], [was, 2]);

    await saveAndWait(page);
    const written = (await server.request("GET", "/api/docs/joining.mmd",
      undefined, { Cookie: cookie })).body.content;
    check("...and both reach the file as ordinary links",
      /A --> B/.test(written) && /A --> C/.test(written), true);

    // A mode wants a way out that is not finding the button that turned it on.
    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    check("Escape puts the tool away", tool.getAttribute("aria-pressed"), "false");
    drag("A", "B");
    check("...and a drag is a drag again", joined().length, 2);

    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "a", bubbles: true }));
    check("A switches it on", tool.getAttribute("aria-pressed"), "true");

    /* Two modes at once is one mode too many, and the hand is the one that
     * takes the whole canvas: a drag that is both an arrow and a pan is
     * neither.
     */
    const hand = [...page.document.querySelectorAll(".ve-diagram-bar .ve-diagram-icon[aria-pressed]")]
      .find((one) => /Hand/i.test(one.getAttribute("title") || ""));
    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "h", bubbles: true }));
    check("reaching for the hand puts the arrow tool away",
      [hand.getAttribute("aria-pressed"), tool.getAttribute("aria-pressed")], ["true", "false"]);

    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "a", bubbles: true }));
    check("...and reaching back for the arrow puts the hand away",
      [hand.getAttribute("aria-pressed"), tool.getAttribute("aria-pressed")], ["false", "true"]);

    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "v", bubbles: true }));
    check("...and V is the pointer again", tool.getAttribute("aria-pressed"), "false");

    // Ctrl+A is select-all and has been since before there was a tool to arm.
    canvas.dispatchEvent(new window.KeyboardEvent("keydown",
      { key: "a", ctrlKey: true, bubbles: true }));
    check("Ctrl+A is still select-all, not the arrow tool",
      [tool.getAttribute("aria-pressed"), canvas.querySelectorAll(".dd-ring-one").length],
      ["false", 3]);
  }

  console.log("=== an arrow goes where it is dragged ===");
  {
    await server.request("POST", "/api/docs",
      { fileName: "bend.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 80x40",
        "    %% @ B 300,300 80x40",
        "    A[One]",
        "    B[Two]",
        "    A --> B"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/bend.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    // The view is fitted, so a point in the diagram is a point on the screen
    // plus wherever the fit put it.
    const view = () => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\) scale\(([\d.]+)\)/
        .exec(canvas.querySelector(".dd-view").getAttribute("transform"));
      return { x: Number(found[1]), y: Number(found[2]), scale: Number(found[3]) };
    };
    const at = (x, y) => ({
      clientX: (x * view().scale) + view().x,
      clientY: (y * view().scale) + view().y,
      bubbles: true
    });
    const lineOf = () => canvas.querySelector(".dd-edge .dd-line").getAttribute("d");
    const corners = () => canvas.querySelectorAll(".dd-via").length;
    const pins = () => canvas.querySelectorAll(".dd-pin").length;
    const written = async () => (await server.request("GET", "/api/docs/bend.mmd",
      undefined, { Cookie: cookie })).body.content;

    const groupOf = (id) => canvas.querySelector(`.dd-node[data-id="${id}"]`);
    const tap = (id) => {
      const spot = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(groupOf(id).getAttribute("transform"));
      const here = at(Number(spot[1]) + 10, Number(spot[2]) + 10);
      groupOf(id).dispatchEvent(new window.MouseEvent("pointerdown", here));
      canvas.dispatchEvent(new window.MouseEvent("pointerup", here));
    };

    check("an arrow nobody has touched has no corners in it", corners(), 0);
    check("...and the box beside it shows none either", pins(), 0);

    /* Nothing selected, nothing to bend. A finger landing on a line on the way
     * to somewhere else would otherwise put a corner in it, on a canvas where
     * pressing empty paper is how you move about.
     */
    canvas.querySelector(".dd-edge .dd-hit")
      .dispatchEvent(new window.MouseEvent("pointerdown", at(140, 220)));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(140, 220)));
    check("pressing a line with nothing selected does not bend it", corners(), 0);

    /* The handles are on the arrows of the box being worked on. Every waypoint
     * of every arrow in a diagram of two hundred would be two hundred handles
     * nobody asked for.
     */
    tap("A");
    check("selecting a box offers the ends of its arrows", pins(), 2);

    /* Pressing the line bends it: a corner where the finger went down, dragged
     * from there. Which is how it works everywhere that has ever let anyone
     * bend an arrow, and needs nothing explaining.
     */
    const hit = canvas.querySelector(".dd-edge .dd-hit");
    check("...and a stroke wide enough to be caught hold of", Boolean(hit), true);

    hit.dispatchEvent(new window.MouseEvent("pointerdown", at(140, 220)));
    check("pressing the line puts a corner in it", corners(), 1);
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(60, 220)));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(60, 220)));

    /* The line goes through the corner. It does not necessarily *turn* at it —
     * a corner on a straight run of the line is a corner the line passes
     * through without changing direction, and listing it as a vertex would be
     * listing a point that makes no difference to the shape.
     */
    check("...which the line then goes out to", lineOf().includes("L60,"), true);

    await saveAndWait(page);
    const bent = await written();
    check("...and which the file says in the layout comment",
      /%% edge 0 [^\n]*via=60,220/.test(bent), true);
    check("...leaving the link itself alone", /^\s*A --> B\s*$/m.test(bent), true);

    /* Dragged again, and it is the same corner rather than another one: a line
     * that grew a corner every time it was touched would be unusable.
     */
    const corner = canvas.querySelector(".dd-via");
    corner.dispatchEvent(new window.MouseEvent("pointerdown", at(60, 220)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(40, 260)));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(40, 260)));
    check("dragging a corner moves it rather than making another", corners(), 1);
    check("...to where it was dragged",
      [canvas.querySelector(".dd-via").getAttribute("cx"),
        canvas.querySelector(".dd-via").getAttribute("cy")], ["40", "260"]);
    check("...and the line goes out to it", lineOf().includes("L40,"), true);

    /* A second corner, put in nearer the start of the line than the one already
     * there. It has to go into the list before it, not after: the corners are
     * in the order the line passes through them, and a line that collected them
     * in the order they were thought of would double back to fetch each one.
     */
    canvas.querySelector(".dd-edge .dd-hit")
      .dispatchEvent(new window.MouseEvent("pointerdown", at(140, 160)));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(140, 160)));
    check("a second corner is a second corner", corners(), 2);

    await saveAndWait(page);
    check("...and it goes into the list in the order the line reaches them",
      /via=140,160;40,260/.test(await written()), true);

    // The second of the two, so that taking out "a corner" and taking out "the
    // one that was asked for" are two different answers.
    canvas.querySelector('.dd-via[data-at="1"]')
      .dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true }));
    check("...and the one taken out is the one that was asked for",
      [corners(), canvas.querySelector(".dd-via").getAttribute("cy")], [1, "160"]);

    // Two taps on the corner itself takes it out, the same way two taps on a
    // box opens it.
    canvas.querySelector(".dd-via")
      .dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true }));
    check("two taps on a corner takes it out", corners(), 0);

    await saveAndWait(page);
    check("...and the file stops mentioning it", /via=/.test(await written()), false);

    /* A loop back to the same box has a shape of its own and no route to put a
     * corner into. Taking one and ignoring it would be a press that changed the
     * file and nothing else.
     */
    await server.request("POST", "/api/docs",
      { fileName: "loop.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 80x40",
        "    A[One]",
        "    A --> A"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const looping = await openPage({ url: `${origin}/diagram/file/loop.mmd`, cookie, origin });
    const round = looping.document.querySelector(".ve-diagram-canvas");
    const box = round.querySelector('.dd-node[data-id="A"]');
    box.dispatchEvent(new looping.window.MouseEvent("pointerdown",
      { clientX: 0, clientY: 0, bubbles: true }));
    round.dispatchEvent(new looping.window.MouseEvent("pointerup",
      { clientX: 0, clientY: 0, bubbles: true }));
    round.querySelector(".dd-edge .dd-hit")
      .dispatchEvent(new looping.window.MouseEvent("pointerdown",
        { clientX: 0, clientY: 0, bubbles: true }));
    round.dispatchEvent(new looping.window.MouseEvent("pointerup",
      { clientX: 0, clientY: 0, bubbles: true }));
    check("a loop back to the same box refuses a corner",
      round.querySelectorAll(".dd-via").length, 0);

    /* And the ends. Dragged round the box, an end pins itself to the side it
     * was dragged to; dragged back into the middle, it goes back to being the
     * router's business.
     */
    const end = canvas.querySelector('.dd-pin[data-end="0"]');
    end.dispatchEvent(new window.MouseEvent("pointerdown", at(140, 140)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(178, 120)));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(178, 120)));
    check("an end dragged to a side leaves from that side",
      lineOf().startsWith("M180,"), true);

    await saveAndWait(page);
    check("...which the file says too", /sides=r,a/.test(await written()), true);

    const again = canvas.querySelector('.dd-pin[data-end="0"]');
    again.dispatchEvent(new window.MouseEvent("pointerdown", at(180, 120)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(140, 120)));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(140, 120)));
    check("dragged back into the middle it is the router's business again",
      lineOf(), "M140,140 L140,220 L340,220 L340,298");

    await saveAndWait(page);
    check("...and the file says nothing about it at all",
      /%% edge 0/.test(await written()), false);
  }

  console.log("=== a box carried into another is carried on top of it ===");
  {
    // Listed chair-first on purpose: in one flat layer the file's order is the
    // drawing's order, and that is exactly what has to stop being true.
    await server.request("POST", "/api/docs",
      { fileName: "nested.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ Chair 600,140 80x40",
        "    %% @ Hall 100,100 320x220",
        "    Chair[Chair]",
        "    Hall[Hall]"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/nested.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const painted = () => [...canvas.querySelectorAll(".dd-node")].map((one) => one.dataset.id);
    const at = (px, py) => ({ clientX: px, clientY: py, bubbles: true });
    const grab = (id) => {
      const box = canvas.querySelector(`.dd-node[data-id="${id}"]`);
      const spot = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(box.getAttribute("transform"));
      return [box, Number(spot[1]) + 10, Number(spot[2]) + 10];
    };

    check("two boxes beside each other are drawn in one layer",
      canvas.querySelectorAll(".dd-nodes").length, 1);
    check("...in the order the file lists them", painted(), ["Chair", "Hall"]);

    /* Selecting is not carrying. A press that never goes anywhere never redraws
     * either, so a box raised on the way down stays raised — which is a
     * container that covers everything inside it for as long as it is selected,
     * and nothing to put it back.
     */
    const [still, stillX, stillY] = grab("Chair");
    still.dispatchEvent(new window.MouseEvent("pointerdown", at(stillX, stillY)));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(stillX, stillY)));
    check("selecting a box does not lift it over the ones after it",
      painted(), ["Chair", "Hall"]);

    /* Picked up and carried in. The layer a box belongs in is only worked out
     * when the drawing is made, so between picking it up and putting it down
     * it is held in front of everything — otherwise it slides under the hall
     * halfway across and reappears on being let go, which reads as having
     * dropped it and lost it.
     */
    const [chair, chairX, chairY] = grab("Chair");
    chair.dispatchEvent(new window.MouseEvent("pointerdown", at(chairX, chairY)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(chairX - 400, chairY + 40)));
    check("a box being carried is drawn in front of what it is carried over",
      painted(), ["Hall", "Chair"]);
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(chairX - 400, chairY + 40)));
    await new Promise((r) => setTimeout(r, 300));

    /* And the drawing agrees once it is made again. The hall is opaque, so a
     * chair painted before it is a chair nobody can see.
     */
    check("a box let go inside a bigger one is drawn in a layer of its own",
      canvas.querySelectorAll(".dd-nodes").length, 2);
    check("...after the box it is now inside, whatever the file's order",
      painted(), ["Hall", "Chair"]);

    /* Carrying the outer one is where the rule stops. A box lifted over its own
     * contents hides them for the whole length of the drag, which is worse than
     * the problem being solved — so a box with something inside it stays in its
     * layer and you can still see what you are moving.
     */
    const [hall, hallX, hallY] = grab("Hall");
    hall.dispatchEvent(new window.MouseEvent("pointerdown", at(hallX, hallY)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(hallX + 20, hallY)));
    check("...but a box carried over what is inside it stays behind it",
      painted(), ["Hall", "Chair"]);
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(hallX + 20, hallY)));
    await new Promise((r) => setTimeout(r, 300));

    // Carried back out, and the layers go with it.
    dragBox(window, "Chair", 500, 0);
    await new Promise((r) => setTimeout(r, 300));
    check("a box carried back out is drawn beside what it was inside",
      canvas.querySelectorAll(".dd-nodes").length, 1);

    /* A box that holds nothing is not held back by a box that is inside
     * something else.
     *
     * "Holds something" cannot be "there is a box deeper than me somewhere in
     * the diagram", or one nested box anywhere would pin every plain box in the
     * drawing to its layer. It has to be about this box and that one.
     */
    await server.request("POST", "/api/docs",
      { fileName: "beside.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ Sign 700,100 80x40",
        "    %% @ Hall 100,100 320x220",
        "    %% @ Chair 160,160 80x40",
        "    Sign[Sign]",
        "    Hall[Hall]",
        "    Chair[Chair]"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const near = await openPage({ url: `${origin}/diagram/file/beside.mmd`, cookie, origin });
    const nearby = near.document.querySelector(".ve-diagram-canvas");
    const order = () => [...nearby.querySelectorAll(".dd-node")].map((one) => one.dataset.id);
    const spot = (id) => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\)/
        .exec(nearby.querySelector(`.dd-node[data-id="${id}"]`).getAttribute("transform"));
      return [Number(found[1]) + 10, Number(found[2]) + 10];
    };

    check("a plain box beside a container is drawn in the first layer",
      order(), ["Sign", "Hall", "Chair"]);

    const [signX, signY] = spot("Sign");
    nearby.querySelector('.dd-node[data-id="Sign"]').dispatchEvent(
      new near.window.MouseEvent("pointerdown",
        { clientX: signX, clientY: signY, bubbles: true }));
    nearby.dispatchEvent(new near.window.MouseEvent("pointermove",
      { clientX: signX - 400, clientY: signY, bubbles: true }));
    check("...and carrying it forward is not stopped by somebody else's contents",
      order()[order().length - 1], "Sign");
    nearby.dispatchEvent(new near.window.MouseEvent("pointerup",
      { clientX: signX - 400, clientY: signY, bubbles: true }));

    // The file has no opinion about any of this: where a box is, is what says
    // what it is inside, and where it is was already written down.
    await saveAndWait(page);
    const saved = (await server.request("GET", "/api/docs/nested.mmd",
      undefined, { Cookie: cookie })).body.content;
    check("...and nothing about layers reaches the file", /layer=/.test(saved), false);
  }

  console.log("=== the canvas has no edges to be stopped at ===");
  {
    await server.request("POST", "/api/docs",
      { fileName: "edgeless.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 80x40",
        "    %% @ B 300,100 80x40",
        "    A[One]",
        "    B[Two]",
        "    A --> B"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/edgeless.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const at = (id) => {
      const group = canvas.querySelector(`.dd-node[data-id="${id}"]`);
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(group.getAttribute("transform"));
      return [Number(found[1]), Number(found[2])];
    };

    /* A position used to be clamped at zero, from when the canvas was a fixed
     * sheet of paper. Panning to show the space beside a diagram and then being
     * unable to drag anything into it is not an endless canvas.
     */
    const startedAt = at("A");
    dragBox(window, "A", -500, -360);
    check("a box can be carried to the left of where the diagram started",
      at("A"), [startedAt[0] - 500, startedAt[1] - 360]);

    await saveAndWait(page);
    const written = (await server.request("GET", "/api/docs/edgeless.mmd", undefined,
      { Cookie: cookie })).body.content;
    check("...and the file says so with a minus sign",
      new RegExp(`%% @ A ${at("A")[0]},${at("A")[1]} `).test(written), true);

    // Read back rather than assumed: a position the editor can write and the
    // parser cannot read is a diagram that is damaged by being saved.
    const reopened = window.DiagramModel.parseFlowchart(written);
    check("...which is read back as the same place",
      [reopened.layout.A.x, reopened.layout.A.y], at("A"));
    check("...which is somewhere no clamp would have allowed",
      reopened.layout.A.x < 0 && reopened.layout.A.y < 0, true);

    dragBox(window, "A", 500, 360);
    check("...and it comes back again", at("A"), startedAt);
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
      /ve-embed-build/.test(appSource), true);
    // One way in, and it is that one. The canvas used to open inside the block
    // as well, in a strip too small for what it has grown into.
    check("...and no second way that opens it in the block instead",
      /openDiagramBuilder/.test(appSource), false);
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
