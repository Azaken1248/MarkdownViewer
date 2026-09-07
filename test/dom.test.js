// Loads the real index.html + app.js in jsdom against a real server, so a
// load-time crash or a broken render shows up without needing a browser.
//
// The server is spawned by the suite against a throwaway state directory with a
// known corpus (see helpers/server.js), which is what lets the write paths —
// cut, paste, rename, folder create — be exercised for real.
const fs = require("fs");
const path = require("path");
const {
  appScriptPaths, appSource, coreSource, modelScriptPaths, drawScriptPaths, styleSource
} = require("./app-source.js");
const http = require("http");
const { JSDOM, VirtualConsole } = require("jsdom");
const { startTestServer, SEED_USERNAME, SEED_PASSWORD, TEST_PASSWORD } = require("./helpers/server");

const ROOT = path.join(__dirname, "..", "public");

// The whole client, for the checks that read it as text rather than run it.
const clientSource = appSource(ROOT);

let failures = 0;
const consoleErrors = [];

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

// A fixed sleep long enough for a slow machine is a slow suite everywhere else,
// and a fixed sleep short enough to be quick is a flake. Wait for the thing
// itself, and let the check that follows say what it found if it never happens.
async function waitUntil(condition, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

let ORIGIN = "";

let sendCookies = () => "";
let receiveCookies = () => {};

function get(pathname) {
  return new Promise((resolve, reject) => {
    const headers = sendCookies() ? { Cookie: sendCookies() } : {};
    http.get(`${ORIGIN}${pathname}`, { headers }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        receiveCookies(res);
        resolve({ status: res.statusCode, body: data });
      });
    }).on("error", reject);
  });
}

(async () => {
  const server = await startTestServer();
  ORIGIN = server.origin;
  console.log(`  (test server on ${ORIGIN}, state in ${server.stateDir})`);

  try {
    await run(server);
  } finally {
    await server.stop();
  }

  console.log(failures === 0 ? "\nALL DOM CHECKS PASSED" : `\n${failures} DOM CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function run(server) {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8")
    .replace(/__EMBED_[A-Z_]+__/g, "x")
    // Strip the CDN tags; their globals are stubbed below.
    .replace(/<link[^>]+cdn[^>]+>/g, "")
    .replace(/<script[^>]+https:[^>]+><\/script>/g, "")
    .replace(/<script src="js\/app\.js[^"]*" defer><\/script>/, "");

  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => consoleErrors.push(`jsdomError: ${e.message}`));
  virtualConsole.on("error", (...args) => consoleErrors.push(`console.error: ${args.join(" ")}`));

  const dom = new JSDOM(html, {
    url: ORIGIN,
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole
  });

  const { window } = dom;

  // Browsers put these on window; jsdom does not. markdown-core stashes the TeX
  // of a maths block as base64 through TextEncoder, so without them rendering
  // any document containing maths throws and the open silently gives up.
  window.TextEncoder = TextEncoder;
  window.TextDecoder = TextDecoder;

  // Nor does it implement object URLs, which is how a pasted picture is shown
  // on the page before its upload finishes.
  let objectUrls = 0;
  window.URL.createObjectURL = () => `blob:${ORIGIN}/${++objectUrls}`;
  window.URL.revokeObjectURL = () => {};

  // jsdom has no layout, so it implements no scrolling. The app only ever uses
  // this to be polite about where it just put something.
  window.Element.prototype.scrollIntoView = function scrollIntoView() {};

  // Third-party globals the app expects to already be on the page.
  //
  // A stand-in for marked. It only has to produce the shapes the editor works
  // on — a table, a code block, a paragraph — because what is under test in
  // this suite is what the editor does with a rendering, not how markdown is
  // parsed. The parsing itself is marked's, and the serializers that read these
  // shapes back are checked against the real library in the visual suite.
  const escape = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // One block at a time. The reading view hands marked a whole document while
  // the editor hands it a single block, so parse() below splits the input first
  // and this renders each piece.
  const renderOneBlock = (md) => {
      const text = String(md);

      if (text.trim() === "") {
        return "";
      }

      const fence = text.match(/^ {0,3}(?:```|~~~)(\S*)[^\n]*\n([\s\S]*?)(?:\n)?(?:```|~~~)\s*$/);
      if (fence) {
        return `<pre><code class="language-${escape(fence[1])}">${escape(fence[2])}\n</code></pre>`;
      }

      const lines = text.split("\n").filter((line) => line.trim() !== "");
      const isTable = lines.length >= 2 && lines[0].includes("|") && /^[\s|:-]*-[\s|:-]*$/.test(lines[1]);
      if (isTable) {
        const cells = (line) => line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
        const head = cells(lines[0]).map((c) => `<th>${escape(c)}</th>`).join("");
        const body = lines.slice(2)
          .map((line) => `<tr>${cells(line).map((c) => `<td>${escape(c)}</td>`).join("")}</tr>`)
          .join("");
        return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
      }

      // Real marked passes block-level raw HTML straight through. markdown-core
      // depends on that: it rewrites a maths block into a placeholder div
      // carrying the TeX, and expects the renderer to hand it back untouched.
      if (/^<[a-z]/i.test(text.trim())) {
        return text.trim();
      }

      // GFM task lists, rendered the way marked renders them — the checkbox
      // disabled, which is exactly the default the app has to override.
      if (lines.length > 0 && lines.every((line) => /^\s*([-*+]|\d+[.)])\s/.test(line))) {
        const items = lines.map((line) => {
          const item = line.replace(/^\s*([-*+]|\d+[.)])\s+/, "");
          const task = item.match(/^\[([ xX])\]\s+([\s\S]*)$/);
          return task
            ? `<li><input${task[1] === " " ? "" : " checked=\"\""} disabled="" type="checkbox"> ${escape(task[2])}</li>`
            : `<li>${escape(item)}</li>`;
        }).join("");
        return `<ul>${items}</ul>`;
      }

      // Inline images, because a document that has had one pasted into it has
      // to render as a picture and serialize back out of one.
      const inline = text.replace(/[<>]/g, "")
        .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g,
          (_, alt, src) => `<img src="${escape(src)}" alt="${escape(alt)}">`);

      return `<p>${inline}</p>`;
  };

  window.marked = {
    setOptions() {},
    parse(md) {
      const text = String(md);

      // Chunk with the app's own splitter rather than on blank lines, so a
      // fence containing one is not torn in half. It is loaded by the time any
      // rendering happens; before that there is only ever a single block.
      const split = window.VisualEditor?.splitBlocks;
      if (!split) {
        return renderOneBlock(text);
      }

      return split(text).map((block) => renderOneBlock(block.source)).filter(Boolean).join("\n");
    }
  };
  window.DOMPurify = { sanitize: (html) => html };
  window.mermaid = { initialize() {}, render: async () => ({ svg: "<svg></svg>" }) };
  // Knows one language and genuinely rewrites the markup for it, so the
  // live-highlighting checks below are moving the DOM the caret stands in
  // rather than watching a stub hand the source straight back.
  window.hljs = {
    getLanguage: (name) => (name === "javascript" ? { name } : null),
    highlightAuto: (s) => ({ value: s }),
    highlight: (s) => ({ value: String(s).replace(/\b(const|return)\b/g, '<span class="hljs-keyword">$1</span>') })
  };
  // KaTeX replaces the placeholder's contents with typeset maths and leaves the
  // TeX attribute alone; that is all this suite needs it to do.
  window.katex = {
    renderToString: (t) => t,
    render: (tex, node) => { node.textContent = tex; }
  };
  window.renderMathInElement = () => {};
  window.svgPanZoom = () => ({ destroy() {}, resize() {}, fit() {}, center() {}, updateBBox() {} });

  // jsdom implements no execCommand at all. Enough of insertText to be real —
  // it is how the app inserts into a textarea without wiping the undo stack, so
  // a suite where it always fell through to the fallback would never exercise
  // the path a browser actually takes.
  const execCommands = [];
  window.document.execCommand = (name, _ui, value) => {
    execCommands.push(name);

    if (name !== "insertText") {
      return false;
    }

    const field = window.document.activeElement;
    if (!field || !["TEXTAREA", "INPUT"].includes(field.tagName)) {
      return false;
    }

    const start = field.selectionStart ?? 0;
    const end = field.selectionEnd ?? start;
    field.value = `${field.value.slice(0, start)}${value}${field.value.slice(end)}`;
    const at = start + String(value).length;
    field.setSelectionRange(at, at);
    return true;
  };

  // jsdom builds neither a clipboard nor a secure context, and the app checks
  // for both before it will use the modern path.
  const clipboardWrites = [];
  window.isSecureContext = true;
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: (text) => { clipboardWrites.push(String(text)); return Promise.resolve(); } }
  });

  // Cookie jar for the proxy below. The app's session is an httpOnly cookie, so
  // there is nothing for the page script to carry — the transport has to.
  const cookieJar = new Map();

  function cookieHeader() {
    return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  sendCookies = cookieHeader;
  receiveCookies = absorbCookies;

  function absorbCookies(res) {
    for (const raw of res.headers["set-cookie"] || []) {
      const [pair] = raw.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value) {
        cookieJar.set(name, value);
      } else {
        cookieJar.delete(name);
      }
    }
  }

  // jsdom's Blob has no arrayBuffer(), so the bytes come out through the one
  // reader it does implement.
  const blobBytes = (blob) => new Promise((resolve, reject) => {
    const reader = new window.FileReader();
    reader.onload = () => resolve(Buffer.from(reader.result));
    reader.onerror = () => reject(reader.error || new Error("Could not read blob"));
    reader.readAsArrayBuffer(blob);
  });

  // Proxy fetch to the spawned server so the app sees a real corpus.
  window.fetch = async (url, options = {}) => {
    const target = String(url).startsWith("http") ? String(url) : `${ORIGIN}${url}`;
    const method = (options.method || "GET").toUpperCase();
    // jsdom has no Response constructor, so hand back the shape requestJson uses.
    const makeResponse = (status, body) => ({
      status,
      ok: status >= 200 && status < 300,
      async json() { return JSON.parse(body); },
      async text() { return body; }
    });

    // A FormData body is what the browser turns into a multipart request. The
    // app sends one when attaching an image, so the proxy has to encode it the
    // same way rather than writing "[object FormData]" down the socket.
    let payload = options.body;
    let extraHeaders = {};

    if (payload && typeof payload !== "string" && typeof payload.entries === "function") {
      const boundary = `----domsuite${Math.random().toString(16).slice(2)}`;
      const chunks = [];

      for (const [name, value] of payload.entries()) {
        if (value instanceof window.Blob) {
          chunks.push(Buffer.from(
            `--${boundary}\r\n`
            + `Content-Disposition: form-data; name="${name}"; filename="${value.name || "file"}"\r\n`
            + `Content-Type: ${value.type || "application/octet-stream"}\r\n\r\n`
          ));
          chunks.push(await blobBytes(value));
          chunks.push(Buffer.from("\r\n"));
        } else {
          chunks.push(Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
          ));
        }
      }

      chunks.push(Buffer.from(`--${boundary}--\r\n`));
      payload = Buffer.concat(chunks);
      extraHeaders = {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": payload.length
      };
    }

    if (method !== "GET") {
      const body = await new Promise((resolve, reject) => {
        const parsed = new URL(target);
        const req = http.request({
          host: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname + parsed.search,
          method,
          // Deliberately passes the client's headers through untouched. This
          // used to add Content-Type itself, which meant a caller that forgot
          // it still worked here and failed in a browser: express.json()
          // ignores a body that does not say it is JSON, so the server saw an
          // empty req.body and complained about a missing field.
          headers: {
            ...(options.headers || {}),
            ...extraHeaders,
            ...(cookieHeader() ? { Cookie: cookieHeader() } : {})
          }
        }, (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            absorbCookies(res);
            resolve({ status: res.statusCode, body: data });
          });
        });
        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
      });
      return makeResponse(body.status, body.body);
    }

    const parsed = new URL(target);
    const res = await get(parsed.pathname + parsed.search);
    return makeResponse(res.status, res.body);
  };

  // Sign in the way a browser does, before the app boots, so it comes up with a
  // real session. The seeded admin must replace its public password first.
  console.log("=== the harness signs in like a browser ===");
  {
    const login = await server.request("POST", "/api/auth/login",
      { username: SEED_USERNAME, password: SEED_PASSWORD });
    check("the seeded admin can sign in", login.status, 200);
    check("...and is required to change its password", login.body.user.mustChangePassword, true);
    absorbCookies({ headers: login.headers });

    const changed = await server.request("POST", "/api/auth/password",
      { currentPassword: SEED_PASSWORD, newPassword: TEST_PASSWORD },
      { Cookie: cookieHeader(), "X-CSRF-Token": login.body.csrfToken });
    check("the forced change succeeds", changed.status, 200);
    absorbCookies({ headers: changed.headers });
  }

  // The modules app.js is assembled from, in the order the page loads them,
  // and then app.js itself — which is evaluated below with the test handle
  // appended, so it has to stay separate from the rest.
  const appScripts = appScriptPaths(ROOT);
  const appModules = appScripts.slice(0, -1);
  const appEntrySource = fs.readFileSync(appScripts[appScripts.length - 1], "utf8");
  const engineSource = coreSource(ROOT);
  // markdown-core defines the render engine app.js delegates to; it has to be
  // in scope before app.js runs, exactly as the script tags on the page arrange.
  window.eval(engineSource);

  // The theme, settled before anything paints — and the cycle app.js switches
  // it with, which lives here because the diagram page needs it too and loads
  // none of app.js.
  window.eval(fs.readFileSync(path.join(ROOT, "js", "theme-boot.js"), "utf8"));

  // Block splitting for the visual editor, loaded before app.js as the page
  // loads it.
  window.eval(fs.readFileSync(path.join(ROOT, "js", "visual-editor.js"), "utf8"));

  // And the flowchart model the diagram builder is made of, and the drawing it
  // puts on the screen, the same way.
  for (const file of modelScriptPaths(ROOT)) {
    window.eval(fs.readFileSync(file, "utf8"));
  }
  window.eval(fs.readFileSync(path.join(ROOT, "js", "diagram-icons.js"), "utf8"));
  for (const file of drawScriptPaths(ROOT)) {
    window.eval(fs.readFileSync(file, "utf8"));
  }
  window.eval(fs.readFileSync(path.join(ROOT, "js", "diagram-editor.js"), "utf8"));

  // The notebook Python controller, loaded before app.js the same way the page
  // loads it. jsdom has no Worker, but nothing here constructs one until a Run
  // button is pressed.
  window.eval(fs.readFileSync(path.join(ROOT, "js", "notebook-runtime.js"), "utf8"));

  for (const file of appModules) window.eval(fs.readFileSync(file, "utf8"));

  console.log("=== app.js evaluates against the real DOM ===");
  try {
    window.eval(appEntrySource);

    window.eval(`
      /* The handle the checks below drive the app through.
       *
       * Assembled from every namespace the page defines rather than from a
       * list kept here, so that moving a function from app.js into a module
       * of its own — which is a fact about the source tree — cannot quietly
       * empty a check. App goes on last: a name it still owns is the one the
       * app is really using.
       */
      ;window.__t = Object.assign(
        {},
        ...Object.keys(window).filter((key) => /^App[A-Z]/.test(key)).map((key) => window[key]),
        App
      );
    `);
    check("no exception on load", true, true);

    /* Every call a module makes into another one is answered.
     *
     * A module that has to reach something loaded after it names the module at
     * the call site — App.something() for app.js itself, AppPageEdit.x() for a
     * module. Until that name is on the other side's surface it is only a name,
     * and nothing checks it at load: the call fails when a person clicks the
     * thing, which is how "App.openContextMenu is not a function" reached a
     * green lint.
     *
     * Comments are stripped first: the prose in these files names App.x too.
     */
    const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    const reaches = [...new Set(appModules
      .flatMap((file) => [...withoutComments(fs.readFileSync(file, "utf8")).matchAll(/\b(App[A-Za-z]*)\.([a-zA-Z_$][\w$]*)\s*\(/g)])
      .map(([, namespace, name]) => `${namespace}.${name}`))].sort();
    const unanswered = reaches.filter((call) => window.eval(`typeof ${call}`) === "undefined");
    check(`the ${reaches.length} calls into another module are all answered`, unanswered, []);
  } catch (error) {
    check(`no exception on load (${error.message})`, false, true);
    console.log(error.stack.split("\n").slice(0, 6).join("\n"));
    process.exit(1);
  }


  // Let the init fetches settle.
  await new Promise((r) => setTimeout(r, 1500));

  const doc = window.document;

  /* The checks themselves, in five files beside this one.
   *
   * Order matters: each leaves the app somewhere the next one starts from, the
   * same way a person using it would. What they share is the context built
   * above, handed over rather than reached for.
   */
  const ctx = {
    check, waitUntil, get, server, window, doc, ROOT, fs, path,
    cookieHeader, absorbCookies, objectUrls, execCommands, clipboardWrites,
    blobBytes, renderOneBlock, escape, clientSource, styleSource, coreSource
  };

  await require("./dom/tree.js")(ctx);
  await require("./dom/chrome.js")(ctx);
  await require("./dom/page-editor.js")(ctx);
  await require("./dom/editing.js")(ctx);
  await require("./dom/links-and-roles.js")(ctx);

  console.log("=== console output ===");
  const realErrors = consoleErrors.filter((e) => !/Could not parse CSS|Not implemented/.test(e));
  check("no errors logged during load", realErrors, []);
}
