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

  const shareWindow = (url) => {
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

    return `<p>${escape(trimmed)}</p>`;
  }).filter(Boolean).join("\n");
}
