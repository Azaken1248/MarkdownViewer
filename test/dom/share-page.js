// Part of the DOM suite. See dom.test.js, which starts the server it uses.
//
// The share view: public/js/share.js, which is the whole of the client a
// visitor following a link ever runs. It had no test at all — the coverage
// map showed it as the one file in public/js that nothing evaluated — and it
// is the only page this app serves to people who are not signed in.
//
// It runs in a window of its own rather than the app's: a different page, a
// different set of scripts, and no session, which is the point. Its fetch goes
// to the same real server, with no cookie on it.
const { JSDOM, VirtualConsole } = require("jsdom");
const http = require("http");
const { sharePageScriptPaths, loadScript } = require("../app-source.js");

module.exports = async (ctx) => {
  const { check, waitUntil, server, cookieHeader, ROOT } = ctx;
  const ORIGIN = server.origin;

  // Signed in, because making the link is the one part of this that needs an
  // account. Everything after it is done as a stranger.
  const csrfToken = (await server.request("GET", "/api/session", undefined,
    { Cookie: cookieHeader() })).body.csrfToken;

  const asAdmin = (method, pathname, body) => server.request(method, pathname, body, {
    Cookie: cookieHeader(),
    "X-CSRF-Token": csrfToken
  });

  const markdown = [
    "# The shared document",
    "",
    "A paragraph a stranger may read.",
    "",
    "![a picture](/api/assets/deadbeef.png)",
    ""
  ].join("\n");

  const made = await asAdmin("POST", "/api/docs", { fileName: "shared-view.md", content: markdown });
  check("(a document to share)", made.status, 201);
  const file = made.body.file;

  const shared = await asAdmin("POST", `/api/docs/${file}/share`);
  check("(and a link to it)", shared.status, 201);
  const token = shared.body.url.split("/").pop();

  // The page as a visitor is served it, token substituted and all. Fetched
  // without a cookie, because that is how it will be fetched.
  const page = await anonymousGet(ORIGIN, `/s/${token}`);
  check("the share page is served to nobody in particular", page.status, 200);

  /* `fetching` stands in for the network — for a request that never arrives
   * at all, as against one the server refuses, and for an answer this server
   * will not give. `tweak` runs on the window after the stubs are in and
   * before the page's own scripts, which is the only moment at which one of
   * those stubs can be made to fail.
   */
  const shareWindow = (url, { fetching = null, tweak = null } = {}) => {
    const html = page.body
      // The CDN tags; their globals are stubbed below, the same way the app's
      // own window stubs them.
      .replace(/<link[^>]+cdn[^>]+>/g, "")
      .replace(/<script[^>]+https:[^>]+><\/script>/g, "")
      // The page's own scripts are evaluated by hand, in the order the page
      // lists them, so jsdom is not asked to fetch them.
      .replace(/<script src="\/js\/[^"]*"[^>]*><\/script>/g, "");

    const problems = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on("jsdomError", (e) => problems.push(`jsdomError: ${e.message}`));
    virtualConsole.on("error", (...args) => problems.push(`console.error: ${args.join(" ")}`));

    const dom = new JSDOM(html, { url, runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
    const { window } = dom;

    window.TextEncoder = TextEncoder;
    window.TextDecoder = TextDecoder;
    window.Element.prototype.scrollIntoView = function scrollIntoView() {};

    // The libraries the page loads from a CDN. The share view only needs them
    // to be there: what is under test is the glue, and how markdown is parsed
    // is marked's business and the visual suite's.
    window.marked = { setOptions() {}, parse: (md) => renderBlocks(String(md)) };
    window.DOMPurify = { sanitize: (html) => html };
    window.mermaid = { initialize() {}, render: async () => ({ svg: "<svg></svg>" }) };
    window.hljs = { getLanguage: () => null, highlightAuto: (s) => ({ value: s }), highlight: (s) => ({ value: s }) };
    window.katex = { renderToString: (t) => t, render: (tex, node) => { node.textContent = tex; } };
    window.renderMathInElement = () => {};
    window.svgPanZoom = () => ({ destroy() {}, resize() {}, fit() {}, center() {}, updateBBox() {} });

    // No cookie, ever. A share link that only works for someone already signed
    // in is a share link that does not work.
    const sent = [];
    window.fetch = /** @type {any} */ (async (url, options = {}) => {
      if (fetching) {
        return fetching(url, options);
      }

      const target = new URL(String(url), ORIGIN);
      sent.push({ path: target.pathname, headers: options.headers || {} });
      const res = await anonymousGet(ORIGIN, target.pathname + target.search);
      return {
        status: res.status,
        ok: res.status >= 200 && res.status < 300,
        async json() { return JSON.parse(res.body); },
        async text() { return res.body; }
      };
    });

    if (tweak) {
      tweak(window);
    }

    for (const file of sharePageScriptPaths(ROOT)) {
      loadScript(window, file);
    }

    return { window, problems, sent };
  };

  console.log("=== the share view renders the document it was given ===");
  const view = shareWindow(`${ORIGIN}/s/${token}`);
  {
    const { window, problems, sent } = view;
    const doc = window.document;

    await waitUntil(() => doc.getElementById("shareContent").classList.contains("visible"));

    check("the content is shown", doc.getElementById("shareContent").classList.contains("visible"), true);
    check("...and the spinner is not", doc.getElementById("shareLoading").hidden, true);
    check("...nor the error panel", doc.getElementById("shareError").hidden, true);
    check("the document's text is on the page",
      doc.getElementById("shareContent").textContent.includes("A paragraph a stranger may read."), true);
    check("the tab is named after the document", window.document.title.includes("Shared View"), true);

    const meta = doc.getElementById("shareMeta").textContent;
    check("the footer names the file", meta.includes(file), true);
    check("...and how big it is", /\d+ B/.test(meta), true);
    check("...and when it was updated", meta.includes("Updated"), true);

    // A visitor has no session, so /api/assets would refuse them. The token is
    // what stands in for one, and only for images in this document.
    const image = doc.querySelector("#shareContent img");
    check("an image is served through the share link, not the private route",
      image.getAttribute("src"), `/api/share/${encodeURIComponent(token)}/assets/deadbeef.png`);

    check("the document was fetched by its token",
      sent.map((one) => one.path), [`/api/share/${encodeURIComponent(token)}`]);
    check("...with no cookie on the request",
      sent.every((one) => !Object.keys(one.headers).some((h) => h.toLowerCase() === "cookie")), true);
    check("nothing was logged as an error", problems.filter((p) => !/Could not parse CSS/.test(p)), []);
  }

  console.log("=== the outline lists the document's own headings ===");
  {
    const { window } = view;
    const doc = window.document;
    const content = doc.getElementById("shareContent");
    const outlineBody = doc.getElementById("shareOutlineBody");
    const toggle = doc.getElementById("shareOutlineToggle");

    /* The document above has one heading, so there is nothing to outline —
     * which is itself the first thing worth checking, because a panel that
     * offers itself for a document with a title and no sections is noise.
     */
    check("a document with one heading is not offered an outline", toggle.hidden, true);

    // A document with sections in it. Put on the page directly: this suite
    // stands marked in, so there is no markdown pass here to make headings.
    content.innerHTML = [
      '<h1 id="top">The document</h1>',
      '<h2 id="one">One</h2>',
      '<h3 id="deeper">Deeper</h3>',
      '<h2 id="two">Two</h2>',
      '<h2>No anchor</h2>'
    ].join("");
    window.DocIndex.create({
      content,
      panel: doc.getElementById("shareOutline"),
      body: outlineBody,
      toggle,
      closeBtn: doc.getElementById("shareOutlineClose")
    }).refresh();

    const links = () => /** @type {HTMLElement[]} */ (
      [...outlineBody.querySelectorAll(".doc-index-link")]);
    check("now it is offered", toggle.hidden, false);
    check("one entry per heading that has an anchor",
      links().map((link) => link.textContent), ["The document", "One", "Deeper", "Two"]);
    check("...a heading with no anchor is left out rather than linked nowhere",
      links().some((link) => link.textContent === "No anchor"), false);
    check("...each pointing at something on the page",
      links().every((link) => content.querySelector(`#${link.dataset.id}`)), true);
    check("...nested the way the levels say",
      outlineBody.querySelectorAll(":scope > ul > li").length, 1);
    check("a branch says whether it is open",
      outlineBody.querySelector(".doc-index-caret[aria-expanded]").getAttribute("aria-expanded"),
      "true");
    check("...and a leaf offers nothing to press",
      outlineBody.querySelectorAll(".doc-index-caret.is-empty").length, 2);

    /* It opens on the top level and the one below it, not the whole tree.
     *
     * Eighty-four headings all at once is a list to scroll rather than an
     * outline to read, so a reader gets the sections and their parts and
     * opens the rest if they want it. Here that means "Deeper" starts hidden
     * under "One", and "One" itself does not.
     */
    // Hidden by a collapsed branch, rather than by the panel itself being
    // shut — so the walk stops at the list.
    const underACollapsedBranch = (link) => {
      for (let at = link.parentElement; at && at !== outlineBody; at = at.parentElement) {
        if (/** @type {HTMLElement} */ (at).hidden) {
          return true;
        }
      }

      return false;
    };

    const visible = () => links().filter((link) => !underACollapsedBranch(link))
      .map((link) => link.textContent);
    check("the top level and the one below it are open", visible(),
      ["The document", "One", "Two"]);
    check("...and anything deeper starts shut",
      outlineBody.querySelector(".doc-index-caret[aria-expanded='false']") !== null, true);

    // Expanding reaches what was shut.
    /** @type {HTMLElement} */ (
      outlineBody.querySelector(".doc-index-caret[aria-expanded='false']")).click();
    check("expanding a branch reveals what is under it", visible(),
      ["The document", "One", "Deeper", "Two"]);

    // ...and collapsing puts it back, saying so.
    /** @type {HTMLElement} */ (
      outlineBody.querySelector(".doc-index-caret[aria-expanded='true']")).click();
    check("collapsing a branch hides its children",
      /** @type {HTMLElement} */ (outlineBody.querySelector(".doc-index-children")).hidden, true);
    check("...and the control says it is shut",
      outlineBody.querySelector(".doc-index-caret").getAttribute("aria-expanded"), "false");
  }

  console.log("=== writing on it stays on this machine ===");
  {
    const { window, sent: requests } = view;
    const doc = window.document;

    /* The point of the feature, checked first: a shared link is somebody
     * else's document, and the marks a reader puts on it are the reader's
     * own. Nothing about them is sent anywhere.
     */
    const asked = requests.map((one) => one.path);
    check("(the page has only ever asked for the document itself)",
      asked.every((path) => path.startsWith("/api/share/")), true);

    const ink = window.Annotate.create({
      surface: doc.querySelector(".share-layout"),
      content: doc.getElementById("shareContent"),
      toolbar: doc.createElement("div"),
      token: "a-token-for-the-suite"
    });

    ink.restore();
    check("a document nobody has drawn on has no ink", ink.strokeCount(), 0);
    check("...and no tool is held, so the words are still selectable",
      ink.tool(), "none");

    // The layer goes over the whole page rather than over the column of text,
    // which is what makes the margins drawable.
    const layer = doc.querySelector(".ink-layer");
    check("the layer is over the page, not inside the text",
      layer.parentElement.className, "share-layout");

    ink.chooseTool("pen");
    check("choosing a tool arms the layer", ink.tool(), "pen");
    check("...and pressing the same tool again puts it down",
      (ink.chooseTool("pen"), ink.tool()), "none");

    check("nothing was sent while any of that happened",
      requests.map((one) => one.path), asked);
  }

  console.log("=== the levels nest by what they declare ===");
  {
    const { nest } = view.window.DocIndex;

    const tree = nest([
      { id: "a", text: "A", level: 1 },
      { id: "b", text: "B", level: 2 },
      { id: "c", text: "C", level: 3 },
      { id: "d", text: "D", level: 2 }
    ]);
    check("a level is a level", tree.map((one) => one.id), ["a"]);
    check("...and what sits under it is under it", tree[0].children.map((one) => one.id), ["b", "d"]);
    check("...however deep", tree[0].children[0].children.map((one) => one.id), ["c"]);

    // A document that starts at h3 is not malformed, it starts there.
    const deep = nest([{ id: "x", text: "X", level: 3 }, { id: "y", text: "Y", level: 4 }]);
    check("a document that starts deep starts at the top of its own tree",
      [deep.length, deep[0].children.length], [1, 1]);

    // A jump from h2 to h4 means the h4 belongs to the h2, not to a level the
    // document does not have.
    const jumped = nest([{ id: "p", text: "P", level: 2 }, { id: "q", text: "Q", level: 4 }]);
    check("a skipped level does not invent one", jumped[0].children.map((one) => one.id), ["q"]);
  }

  console.log("=== and its theme toggle is the same cycle as the app's ===");
  {
    const { window } = view;
    const root = window.document.documentElement;
    const toggle = window.document.getElementById("shareThemeToggle");

    const before = root.dataset.themePreference || "dark";
    check("(the page starts on a theme)", ["dark", "light", "auto"].includes(before), true);

    toggle.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitUntil(() => root.dataset.themePreference !== before);
    const after = root.dataset.themePreference;
    check("a click moves it along the cycle", after !== before, true);
    check("...and the resolved theme is one of the two real ones",
      ["dark", "light"].includes(root.dataset.theme), true);
    check("...the choice is remembered for next time",
      window.localStorage.getItem("mdviewer.theme"), after);
    check("...and the button says what pressing it will do next",
      /Switch to/.test(toggle.getAttribute("aria-label")), true);
  }

  console.log("=== the pen is out of the way until it is asked for ===");
  {
    /* Most of the time a shared link is something somebody is reading, so the
     * tools are not on screen until the button is pressed. The button is also
     * the way to put them away, and putting them away has to put the pen down
     * — a toolbar that is gone while a drag still draws is a document whose
     * words cannot be selected any more, with nothing on screen to explain it.
     */
    const { window } = view;
    const doc = window.document;
    const toggle = doc.getElementById("shareAnnotateToggle");
    const toolbar = doc.getElementById("shareInkToolbar");
    const press = () => toggle.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    check("the tools start out of the way",
      [toolbar.hidden, toggle.getAttribute("aria-expanded")], [true, "false"]);

    press();
    check("the button brings them out",
      [toolbar.hidden, toggle.getAttribute("aria-expanded")], [false, "true"]);
    check("...and says what pressing it again will do",
      [toggle.getAttribute("aria-label"), toggle.title],
      ["Put the pen down", "Put the pen down"]);
    check("...with the page marked as being written on, which the layout reads",
      doc.body.classList.contains("is-annotating"), true);

    press();
    check("pressing it again puts them away",
      [toolbar.hidden, toggle.getAttribute("aria-expanded"), doc.body.classList.contains("is-annotating")],
      [true, "false", false]);
    check("...and offers to bring them back", toggle.getAttribute("aria-label"),
      "Annotate this document");
  }

  console.log("=== and closing them puts the pen down ===");
  {
    const { window } = view;
    const doc = window.document;
    const toggle = doc.getElementById("shareAnnotateToggle");
    const press = () => toggle.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    press();
    const pen = [...doc.getElementById("shareInkToolbar").querySelectorAll("button")]
      .find((one) => one.getAttribute("aria-label") === "Pen");
    check("(there is a pen to pick up)", Boolean(pen), true);

    /* The layer takes the pointer only while something is held, so that the
     * words underneath stay selectable the rest of the time. That is the
     * thing to read: it is what a reader feels.
     */
    const layer = /** @type {SVGElement} */ (doc.querySelector(".ink-layer"));
    pen.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("a tool picked up gives the layer the pointer",
      [layer.style.pointerEvents, doc.querySelector(".share-layout").classList.contains("is-annotating")],
      ["auto", true]);

    press();
    check("closing the tools puts the pen down with them",
      layer.style.pointerEvents, "none");
    check("...so the document can be read and selected again",
      doc.querySelector(".share-layout").classList.contains("is-annotating"), false);
  }

  console.log("=== what the footer says about a document of any size ===");
  {
    /* The footer is three clauses and each one can be nothing: a file with no
     * bytes in it, and a document the server gave no date for. Neither is a
     * reason to print "0 B" or "Updated Invalid Date" under somebody's
     * document.
     */
    const empty = await asAdmin("POST", "/api/docs",
      { fileName: "shared-empty.md", content: "", overwrite: true });
    check("(a document with nothing in it)", empty.status, 201);
    const emptyShare = await asAdmin("POST", `/api/docs/${empty.body.file}/share`);
    const emptyToken = emptyShare.body.url.split("/").pop();

    const { window } = shareWindow(`${ORIGIN}/s/${emptyToken}`);
    await waitUntil(() => window.document.getElementById("shareFooter").hidden === false);
    const meta = window.document.getElementById("shareMeta").textContent;
    check("an empty document says its name and nothing about its size",
      [meta.includes("shared-empty.md"), /\bB\b|KB|MB/.test(meta)], [true, false]);

    // Big enough to be counted in kilobytes, which is the loop the small one
    // never enters.
    const big = await asAdmin("POST", "/api/docs",
      { fileName: "shared-big.md", content: `# Big\n\n${"word ".repeat(2000)}\n`, overwrite: true });
    const bigShare = await asAdmin("POST", `/api/docs/${big.body.file}/share`);
    const bigToken = bigShare.body.url.split("/").pop();

    const bigView = shareWindow(`${ORIGIN}/s/${bigToken}`);
    await waitUntil(() => bigView.window.document.getElementById("shareFooter").hidden === false);
    check("a larger one is counted in the unit a person reads",
      /\d+(\.\d)? KB/.test(bigView.window.document.getElementById("shareMeta").textContent), true);
  }

  console.log("=== a page the server never answers ===");
  {
    /* Not a refusal — a request that does not arrive at all. The page cannot
     * say what is wrong, so it says the one useful thing instead of leaving
     * the spinner turning for ever.
     */
    const { window } = shareWindow(`${ORIGIN}/s/${token}`,
      { fetching: () => Promise.reject(new Error("the network went away")) });
    const doc = window.document;
    await waitUntil(() => !doc.getElementById("shareError").hidden);

    check("a request that never arrives still ends the wait",
      doc.getElementById("shareLoading").hidden, true);
    check("...with something a reader can act on",
      [doc.getElementById("shareErrorTitle").textContent,
        doc.getElementById("shareErrorMessage").textContent],
      ["Could not load the document", "Check your connection and try again."]);
  }

  console.log("=== a document that does not render cleanly ===");
  {
    /* A diagram that will not draw is not a reason to say nothing: the page
     * is a stranger's only view of this document, and a blank where a
     * flowchart should be, with no word about it, reads as the document being
     * wrong rather than as this page having failed to draw it.
     */
    const withDiagram = await asAdmin("POST", "/api/docs", {
      fileName: "shared-diagram.md",
      content: "# Diagram\n\n```mermaid\nflowchart TD\n  A --> B\n```\n",
      overwrite: true
    });
    const diagramShare = await asAdmin("POST", `/api/docs/${withDiagram.body.file}/share`);
    const diagramToken = diagramShare.body.url.split("/").pop();

    const warnings = [];
    const { window } = shareWindow(`${ORIGIN}/s/${diagramToken}`, {
      tweak: (made) => {
        made.console.warn = (...args) => warnings.push(args.join(" "));
        made.mermaid.render = () => Promise.reject(new Error("that is not a diagram"));
      }
    });

    await waitUntil(() => window.document.getElementById("shareContent").classList.contains("visible"));
    check("a diagram that will not draw is said out loud",
      await waitUntil(() => warnings.length > 0, 8000), true);
    check("...in words about this page rather than about the document",
      warnings.at(-1),
      "One or more Mermaid blocks were auto-simplified or could not be parsed.");
    check("...and the rest of the document is still on the page",
      window.document.getElementById("shareContent").textContent.includes("Diagram"), true);
  }

  console.log("=== a date the server did not give ===");
  {
    /* The footer's third clause is a date, and a document can arrive without
     * one — an older share, a clock that answered with rubbish. "Updated
     * Invalid Date" under somebody's document is worse than no date at all.
     */
    const answerWith = (payload) => ({
      fetching: async () => ({
        status: 200, ok: true,
        async json() { return payload; },
        async text() { return JSON.stringify(payload); }
      })
    });
    const base = { file: "dated.md", title: "Dated", content: "# Dated\n", allowExport: false };

    const without = shareWindow(`${ORIGIN}/s/${token}`, answerWith({ ...base }));
    await waitUntil(() => without.window.document.getElementById("shareFooter").hidden === false);
    check("a document with no date says nothing about when it changed",
      without.window.document.getElementById("shareMeta").textContent.includes("Updated"), false);

    const nonsense = shareWindow(`${ORIGIN}/s/${token}`,
      answerWith({ ...base, updatedAt: "the day before yesterday" }));
    await waitUntil(() => nonsense.window.document.getElementById("shareFooter").hidden === false);
    const meta = nonsense.window.document.getElementById("shareMeta").textContent;
    check("...and a date that is not one says nothing either",
      [meta.includes("Updated"), meta.includes("Invalid")], [false, false]);
    check("...while the rest of the footer is still there", meta.includes("dated.md"), true);
  }

  console.log("=== the copy a link may or may not offer ===");
  {
    /* The server decides and the page asks. A button the client hid would be
     * a permission enforced by the client — and there is nothing to enforce
     * anyway, since the copy is made from what is already on screen. What the
     * permission governs is whether the offer is made at all.
     */
    check("a link published without exporting offers no copy",
      view.window.document.getElementById("shareExportBtn").hidden, true);

    const allowed = await asAdmin("PATCH", `/api/docs/${file}/share`, { allowExport: true });
    check("(the owner allows exporting)", allowed.status, 200);

    /* The offer is the last thing the load does — after the document is on
     * screen, the diagrams are drawn and the ink is back. Reading the button
     * when the content appears is reading it before the answer exists.
     */
    const { window } = shareWindow(`${ORIGIN}/s/${token}`);
    const offered = window.document.getElementById("shareExportBtn");
    check("...and one published with it offers the button",
      await waitUntil(() => offered.hidden === false, 8000), true);
  }

  console.log("=== a link revoked while the page was open says so ===");
  {
    const revoked = await asAdmin("DELETE", `/api/docs/${file}/share`);
    check("(the link is revoked)", revoked.status, 200);

    const { window, problems } = shareWindow(`${ORIGIN}/s/${token}`);
    const doc = window.document;
    await waitUntil(() => !doc.getElementById("shareError").hidden);

    check("the error panel is shown", doc.getElementById("shareError").hidden, false);
    check("...saying the link is not valid", doc.getElementById("shareErrorTitle").textContent,
      "This link is not valid");
    check("...and the content stays hidden",
      doc.getElementById("shareContent").classList.contains("visible"), false);
    check("...and the spinner stops", doc.getElementById("shareLoading").hidden, true);
    check("a refusal is not an exception", problems.filter((p) => !/Could not parse CSS/.test(p)), []);
  }

  console.log("=== an address with no token in it never asks the server ===");
  {
    const { window, sent } = shareWindow(`${ORIGIN}/s/`);
    const doc = window.document;
    await waitUntil(() => !doc.getElementById("shareError").hidden);

    check("it says what is wrong with the address",
      doc.getElementById("shareErrorMessage").textContent, "The address is missing its share token.");
    check("...without a request behind it", sent, []);
  }
};

// A GET with no cookies at all, which is what a visitor following a link is.
function anonymousGet(origin, pathname) {
  const url = new URL(pathname, origin);
  return new Promise((resolve, reject) => {
    const req = http.get({ host: url.hostname, port: url.port, path: url.pathname + url.search }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on("error", reject);
  });
}

// Enough of marked for the share view: headings, paragraphs and images, which
// is what the document above is made of.
function renderBlocks(text) {
  const escape = (value) => String(value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  return text.split(/\n{2,}/).map((block) => {
    const trimmed = block.trim();
    if (!trimmed) {
      return "";
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      return `<h${heading[1].length}>${escape(heading[2])}</h${heading[1].length}>`;
    }

    const image = trimmed.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (image) {
      return `<p><img src="${escape(image[2])}" alt="${escape(image[1])}"></p>`;
    }

    /* A fence comes out as marked leaves one — a code element carrying the
     * language — because the promotion of a mermaid block to a diagram is the
     * app's own work, done on that element afterwards.
     */
    if (trimmed.startsWith("```")) {
      // Split rather than matched: a lazy wildcard between two fences is the
      // shape the linter's unsafe-regex rule is there to refuse, and the
      // `limits` census would have to carry it for ever.
      const lines = trimmed.split("\n");
      const language = lines[0].slice(3).trim();
      const last = lines.length - 1;
      const body = lines.slice(1, lines[last].startsWith("```") ? last : undefined).join("\n");
      const named = language ? ` class="language-${escape(language)}"` : "";
      return `<pre><code${named}>${escape(body)}</code></pre>`;
    }

    return `<p>${escape(trimmed)}</p>`;
  }).filter(Boolean).join("\n");
}
