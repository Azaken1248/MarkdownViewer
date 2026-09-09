/* The optional bundles, and whether they are the same app.
 *
 * `npm run build` concatenates and minifies what each page already loads. That
 * is a second way to serve this app, and a second way is only safe if
 * something checks the two agree — otherwise the tests all exercise the
 * unbundled path and visitors get the other one.
 *
 * So the check is a comparison, not an inspection: load the individual scripts
 * into one window, load the bundle into another, and require that the two
 * windows offer the same thing. A minifier that dropped a namespace, a
 * concatenation in the wrong order, an IIFE that swallowed the file after it —
 * all of them show up as a difference here.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");
const { TextEncoder, TextDecoder } = require("util");
const { clientScriptPaths } = require("./app-source.js");
const { build, deferredScripts, ownStylesheets, MIN_SCRIPTS } = require("../tools/build.js");
const { createBundles } = require("../lib/http/bundles.js");

const ROOT = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

// A window with just enough of a browser for these scripts to load into. They
// only reach for the DOM at load; what they do afterwards is the DOM suite's
// business, and this one is about whether they got there at all.
function emptyWindow() {
  const problems = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => problems.push(error.message));
  virtualConsole.on("error", (...args) => problems.push(args.join(" ")));

  const html = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");
  const dom = new JSDOM(html, {
    url: "http://localhost/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole
  });

  dom.window.TextEncoder = TextEncoder;
  dom.window.TextDecoder = TextDecoder;
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

  /* The libraries the page loads from a CDN, stubbed to the shape the scripts
   * touch at load. What they return does not matter here — both windows get
   * the identical stub, so anything either one does with it, the other does
   * too, and a difference between them is a difference in the bundle.
   */
  dom.window.marked = { setOptions() {}, parse: (md) => `<p>${md}</p>` };
  dom.window.DOMPurify = { sanitize: (html) => html };

  /* theme-boot.js, which the page runs eagerly before any of this and which
   * the build leaves out for that reason. It puts ThemeSwitch on the window,
   * and several of the modules below reach for it at load.
   */
  dom.window.eval(fs.readFileSync(path.join(PUBLIC_DIR, "js", "theme-boot.js"), "utf8"));

  return { window: dom.window, problems };
}

// What a window ended up offering, as a sorted list of names. The app's own
// namespaces and the engines beside them; nothing the harness put there.
function surfaceOf(window) {
  return Object.keys(window)
    .filter((key) => /^(?:App[A-Z]|App$|Md[A-Z]|Dm[A-Z]|Dd[A-Z])/.test(key)
      || ["MarkdownCore", "VisualEditor", "DiagramModel", "DiagramDraw", "DiagramEditor",
        "DiagramIcons", "NotebookRuntime", "ThemeSwitch"].includes(key))
    .sort();
}

(async () => {
  console.log("=== the build reads the page rather than a list of its own ===");
  {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");
    const scripts = deferredScripts(html);
    const styles = ownStylesheets(html);

    check("it finds the shell's deferred scripts",
      scripts.length, clientScriptPaths(PUBLIC_DIR).length - 1);
    check("...and leaves the one that is not deferred alone",
      scripts.some((src) => src.includes("theme-boot")), false);
    check("...because it settles the theme before the stylesheet paints, and a"
      + " deferred bundle would put the flash back", true, true);
    check("it finds the stylesheets too", styles.length > MIN_SCRIPTS, true);
    check("...and none of them are the CDN's",
      styles.filter((href) => !href.startsWith("/css/")), []);
  }

  console.log("=== a bundle is the same app as the scripts it replaces ===");
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "azadocs-build-"));
  try {
    await build({ publicDir: PUBLIC_DIR, buildDir: scratch });

    const manifest = JSON.parse(fs.readFileSync(path.join(scratch, "manifest.json"), "utf8"));
    check("the manifest names a bundle for the shell", typeof manifest.index.bundle, "string");
    check("...and says which tags it stands in for",
      manifest.index.replaces.length, deferredScripts(
        fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8")).length);

    // Loaded one at a time, the way the page loads them.
    const separate = emptyWindow();
    for (const file of manifest.index.replaces) {
      separate.window.eval(fs.readFileSync(path.join(PUBLIC_DIR, file.slice(1)), "utf8"));
    }

    // And all at once, the way a visitor gets them.
    const bundled = emptyWindow();
    bundled.window.eval(fs.readFileSync(path.join(scratch, "index.js"), "utf8"));

    check("the individual scripts load without error", separate.problems, []);
    check("the bundle loads without error", bundled.problems, []);

    const want = surfaceOf(separate.window);
    check(`the scripts define ${want.length} namespaces`, want.length > 60, true);
    check("...and the bundle defines exactly the same ones", surfaceOf(bundled.window), want);

    // Sameness of names is not sameness of contents, so look inside the two
    // that everything else is reached through.
    for (const namespace of ["App", "MarkdownCore", "DiagramModel"]) {
      check(`${namespace} offers the same keys either way`,
        Object.keys(bundled.window[namespace]).sort(),
        Object.keys(separate.window[namespace]).sort());
    }

    check("the bundle is smaller than what it replaces",
      fs.statSync(path.join(scratch, "index.js")).size
        < manifest.index.replaces.reduce((total, src) =>
          total + fs.statSync(path.join(PUBLIC_DIR, src.slice(1))).size, 0),
      true);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  console.log("=== with no build, the pages serve what they name ===");
  {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "azadocs-nobuild-"));
    try {
      const bundles = createBundles({ publicDir: empty });
      const html = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");
      check("a missing manifest changes nothing", bundles.forPage("index")(html), html);
      check("...and reports itself as absent", bundles.manifest(), null);

      // The failure this guards against is a manifest that outlived its files:
      // collapsing eighty-six tags into one that 404s is a blank page.
      fs.mkdirSync(path.join(empty, "build"), { recursive: true });
      fs.writeFileSync(path.join(empty, "build", "manifest.json"),
        JSON.stringify({ index: { bundle: "/build/gone.js", replaces: ["/js/app.js"] } }));
      const stale = createBundles({ publicDir: empty });
      check("a manifest naming a bundle that is not there is ignored",
        stale.forPage("index")(html), html);

      fs.writeFileSync(path.join(empty, "build", "manifest.json"), "{ half written");
      const broken = createBundles({ publicDir: empty });
      check("a manifest being written is ignored rather than thrown",
        broken.forPage("index")(html), html);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  }

  console.log(failures === 0 ? "\nALL BUILD CHECKS PASSED" : `\n${failures} BUILD CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
