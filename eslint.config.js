// Flat config (ESLint 9). Deliberately close to the code that is already here:
// the point is to catch real mistakes — an undeclared variable, an unused
// binding, a fall-through — not to relitigate style across 6,000 lines that
// read consistently already.

const js = require("@eslint/js");
const noUnsanitized = require("eslint-plugin-no-unsanitized");
const security = require("eslint-plugin-security");

const BROWSER_GLOBALS = {
  window: "readonly",
  document: "readonly",
  navigator: "readonly",
  console: "readonly",
  fetch: "readonly",
  localStorage: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  requestAnimationFrame: "readonly",
  cancelAnimationFrame: "readonly",
  CustomEvent: "readonly",
  Event: "readonly",
  MouseEvent: "readonly",
  KeyboardEvent: "readonly",
  DragEvent: "readonly",
  HTMLElement: "readonly",
  HTMLLinkElement: "readonly",
  Element: "readonly",
  Node: "readonly",
  DataTransfer: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  AbortController: "readonly",
  IntersectionObserver: "readonly",
  ResizeObserver: "readonly",
  MutationObserver: "readonly",
  getComputedStyle: "readonly",
  matchMedia: "readonly",
  structuredClone: "readonly",
  TextEncoder: "readonly",
  TextDecoder: "readonly",
  Blob: "readonly",
  File: "readonly",
  FileReader: "readonly",
  FormData: "readonly",
  CSS: "readonly",
  NodeFilter: "readonly",

  // Third-party libraries loaded from a CDN as plain <script> tags, so they
  // arrive as globals rather than imports. Pinned and SRI-checked in index.html.
  marked: "readonly",
  DOMPurify: "readonly",
  mermaid: "readonly",
  hljs: "readonly",
  katex: "readonly",
  renderMathInElement: "readonly",
  svgPanZoom: "readonly",

  // The theme cycle, set up by theme-boot.js in <head> on every page that has
  // one — including the diagram page, which loads none of the rest of this.
  ThemeSwitch: "readonly",
  DiagramIcons: "readonly",
  // The modules app.js is assembled from, in /js/app, each loaded before it.
  // app.js itself, which is the last of them and exports what it is.
  App: "readonly",
  AppApi: "readonly",
  AppLibrary: "readonly",
  AppSearch: "readonly",
  AppText: "readonly",
  AppDom: "readonly",
  AppState: "readonly",
  AppSelection: "readonly",
  AppTooltips: "readonly",
  AppModal: "readonly",
  AppShell: "readonly",
  AppNotify: "readonly",
  AppLinks: "readonly",
  AppPastedImages: "readonly",
  AppShare: "readonly",
  AppLocation: "readonly",
  AppTheme: "readonly",
  AppNotebook: "readonly",
  AppTextarea: "readonly",
  AppInlineRename: "readonly",
  AppFolderCollapse: "readonly",
  AppJump: "readonly",
  AppSearchPanel: "readonly",
  AppViewerHeader: "readonly",
  AppSession: "readonly",
  AppUsers: "readonly",
  AppFolderModal: "readonly",
  AppRender: "readonly",
  AppSourceEditor: "readonly",
  AppRefresh: "readonly",
  AppUploads: "readonly",
  AppEditorSave: "readonly",
  AppFileActions: "readonly",
  AppMatchNav: "readonly",
  AppPlaces: "readonly",
  AppAccountMenu: "readonly",
  AppSidebar: "readonly",
  AppEditorKeys: "readonly",
  AppDocs: "readonly",
  AppTaskLists: "readonly",
  AppPageImages: "readonly",
  AppClipboard: "readonly",
  AppDeletion: "readonly",
  AppContextMenu: "readonly",
  AppTree: "readonly",
  AppSearching: "readonly",
  AppOpening: "readonly",
  AppDocActions: "readonly",
  AppFolderOps: "readonly",
  AppPageBlocks: "readonly",
  AppPageTables: "readonly",
  AppPageCode: "readonly",
  AppPageEmbeds: "readonly",
  AppPageInsert: "readonly",
  AppPageHistory: "readonly",
  AppPageEdit: "readonly",
  // Our own shared render engine, loaded as a plain script before app.js:
  // the modules under /js/md, then markdown-core.js, which is made of them.
  DocKinds: "readonly",
  DomHtml: "readonly",
  MdLazy: "readonly",
  MdText: "readonly",
  MdCode: "readonly",
  MdMath: "readonly",
  MdDiagramTheme: "readonly",
  MdMermaid: "readonly",
  MdNotebook: "readonly",
  MdPanZoom: "readonly",
  MarkdownCore: "readonly",
  // Block splitting and markdown serialization for the visual editor.
  VisualEditor: "readonly",
  // Mermaid flowcharts as steps and arrows, for the diagram builder: the
  // model under /js/dm, the drawing under /js/dd, and the two files made of them.
  DmGrammar: "readonly",
  DmCells: "readonly",
  DmDeclarations: "readonly",
  DmShapes: "readonly",
  DmLayout: "readonly",
  DmParse: "readonly",
  DmSerialize: "readonly",
  DiagramModel: "readonly",
  DdBase: "readonly",
  DdEnds: "readonly",
  DdMarks: "readonly",
  DdRoute: "readonly",
  DdEdges: "readonly",
  DdGroups: "readonly",
  DdShapes: "readonly",
  DdPaint: "readonly",
  DiagramDraw: "readonly",
  DiagramEditor: "readonly",
  // The notebook Python controller, loaded before app.js.
  NotebookRuntime: "readonly",
  Worker: "readonly"
};

const NODE_GLOBALS = {
  require: "readonly",
  module: "writable",
  exports: "writable",
  process: "readonly",
  console: "readonly",
  Buffer: "readonly",
  __dirname: "readonly",
  __filename: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  setImmediate: "readonly",
  URL: "readonly",
  // Node has had a global fetch since 18, and the test suites use it to talk to
  // a server they started.
  fetch: "readonly",
  TextEncoder: "readonly",
  TextDecoder: "readonly"
};

/* eslint-plugin-security, selectively.
 *
 * The plugin is fourteen rules and three of them account for almost four
 * hundred reports here, none of which is a bug. What is below is the split,
 * written down so the next person does not have to run it to find out.
 *
 * On as errors: nine rules that report nothing today. That is the point —
 * each is a thing this app has no business doing, so the rule costs nothing
 * now and refuses the first one. A server that must shell out or read a
 * computed module path can turn one off in a commit that says why.
 *
 * On as a warning: detect-unsafe-regex, which earned it. It found a real one
 * — decodeDataUri in lib/link-preview.js matched a data: URI's parameters
 * with `(?:;[^,]*)*`, where each parameter could itself contain the separator,
 * so `data:x;a;a;a…` with no comma had exponentially many ways to be read.
 * Forty of them would have held the event loop for hours, and the href comes
 * off a page a stranger asked the server to preview. It still reports that
 * one, because the fix made the repeat unambiguous rather than removing it,
 * and the rule counts nested quantifiers without asking whether they overlap.
 * That is also why the other twelve are reported: each was given an input
 * built to make it blow up — sixty thousand characters down the path that has
 * to fail — and the worst of them took two milliseconds. They are pinned in
 * test/limits.test.js by file and count, so a new one is a regex somebody has
 * to look at rather than a number that grew.
 *
 * Off, with the reason rather than without:
 *
 *   detect-object-injection (230) — every `obj[key]` in the codebase. This is
 *     a JavaScript app; the rule is a syntax census, not a finding.
 *   detect-non-literal-fs-filename (130) — this is a file server, so every
 *     fs call takes a computed path. What actually stops traversal is
 *     resolveDocPath and sanitizeFilename, which every route goes through and
 *     which the suites test directly. The rule cannot see that and would
 *     report the safe calls and the unsafe ones alike.
 *   detect-non-literal-regexp (23) — a RegExp built from a variable. One is
 *     in lib (attributeValue, whose tag names are literals a few lines up),
 *     three are in the client and build a matcher from a term the caller
 *     escaped, and the other nineteen are test suites building a matcher.
 *   detect-possible-timing-attacks (1) — `password === null`, which is the
 *     null window.prompt returns when the box is cancelled, in client code
 *     where there is no timing to attack.
 */
const SECURITY_RULES = {
  "security/detect-child-process": "error",
  "security/detect-eval-with-expression": "error",
  "security/detect-non-literal-require": "error",
  "security/detect-pseudoRandomBytes": "error",
  "security/detect-buffer-noassert": "error",
  "security/detect-new-buffer": "error",
  "security/detect-bidi-characters": "error",
  "security/detect-disable-mustache-escape": "error",
  "security/detect-no-csrf-before-method-override": "error",

  "security/detect-unsafe-regex": "warn",

  "security/detect-object-injection": "off",
  "security/detect-non-literal-fs-filename": "off",
  "security/detect-non-literal-regexp": "off",
  "security/detect-possible-timing-attacks": "off"
};

const SHARED_RULES = {
  ...js.configs.recommended.rules,

  // Caught real bugs in this codebase's history: a variable read before it was
  // ever declared, and dead functions nothing called.
  "no-undef": "error",
  "no-unused-vars": ["error", {
    args: "after-used",
    argsIgnorePattern: "^_",
    // Express error handlers must declare all four parameters to be recognised
    // as error middleware, even when `next` is unused.
    caughtErrors: "none"
  }],

  eqeqeq: ["error", "smart"],
  "no-var": "error",
  "prefer-const": ["error", { destructuring: "all" }],
  "no-implicit-coercion": "off",

  // On the server, in the test suites and in the build tools, printing is the
  // job. The client is the side where a stray console.log ships to everyone
  // who opens the page, so the rule lives in BROWSER_RULES below.
  "no-console": "off",

  // A missing await on a write is a data-loss bug, not a style question.
  "require-atomic-updates": "error",
  "no-return-await": "error",

  /* no-await-in-loop, off — and this is the audit rather than a shrug.
   *
   * It is on the list of rules worth having because a loop that awaits is
   * often N round trips that should have been one Promise.all. Every one of
   * the twenty-seven outside the test suites was read. None of them is that.
   * Most are sequential because the iteration before allocates something the
   * next one must see — ensureUniqueFilenameInDir hands out a name, and two
   * uploads racing for it would land on the same file. Some stop early: the
   * redirect chain in link-preview, the icon candidates, the mermaid render
   * attempts. Some are sequential because what they call is not re-entrant
   * (mermaid) or because order is the point (a library's scripts in md/lazy).
   * Two are bounded worker pools already running under Promise.all, which is
   * the shape the rule is asking for and cannot see.
   *
   * So it would report twenty-seven and be right about none, and the
   * twenty-seven disables would say less than this paragraph does. Turning it
   * on is one word here if a real N+1 ever shows up.
   */
  "no-await-in-loop": "off",

  /* Complexity, as advice rather than as a gate.
   *
   * The rules above are about mistakes; these are about whether the next
   * person can change a function without breaking it, which is a different
   * question and a softer one — a long function is sometimes exactly right,
   * and a warning that says "look at this" is worth more than an error that
   * has to be argued with. What keeps them from being ignored is that the
   * count is pinned by a test (test/limits.test.js), so the list stays a
   * decision somebody made rather than a number that drifted.
   */
  complexity: ["warn", 15],
  "max-depth": ["warn", 4],
  "max-lines-per-function": ["warn", { max: 120, skipComments: true, skipBlankLines: true }],
  "max-params": ["warn", 5],

  "no-fallthrough": "error",
  "no-constant-condition": ["error", { checkLoops: false }],
  "no-empty": ["error", { allowEmptyCatch: true }],

  ...SECURITY_RULES
};

// A browser module is `var Name = (function () { ... return {...}; })();` — a
// top-level `var`, because that is the one declaration a classic script can
// make that later scripts, the concatenated bundle and a test's window.eval
// all see the same way (a `const` at top level is invisible to window.eval),
// and because the type checker (`npm run typecheck`) reads every script's
// top-level declarations as the globals they are, so a call from one module
// into another is checked against the real signature. So `var` is allowed at
// the top level of a module and nowhere else, and a module declaring the
// namespace the globals list already names is not a redeclaration.
const BROWSER_RULES = {
  ...SHARED_RULES,

  /* Debug output, but not error reporting.
   *
   * A console.log left in ships to everyone who opens the page. A
   * console.error in a catch is different: it is how this app says a
   * highlighter or a diagram renderer fell over, and it is the only trace of
   * it there is — the DOM suites read those and fail on one they did not
   * expect. So the two are separated rather than the rule being turned off.
   * There are nineteen console.error and console.warn calls in the client and
   * no console.log at all, which is the state worth keeping.
   */
  "no-console": ["warn", { allow: ["error", "warn"] }],

  /* Every assignment to innerHTML that builds its string out of a value.
   *
   * Most of the hundred-odd in this app are static markup, and the ones that
   * interpolate mostly interpolate something the code itself produced — an
   * icon name from a fixed list, a caret direction. Rendered markdown goes
   * through DOMPurify and a diagram's SVG is escaped where it is built, so
   * there was no hole here. What there was not was anything stopping the next
   * one: "we are careful" does not survive a codebase this size, and a rule
   * does. This one permits a static string and refuses interpolation, which is
   * exactly the line that matters; where interpolation is right, the `html`
   * tagged template in js/dom-html.js escapes it, and the handful of places
   * that pass markup through on purpose say so in a disable comment with the
   * reason.
   */
  "no-unsanitized/property": ["error", {
    escape: { taggedTemplates: ["html"] }
  }],
  "no-unsanitized/method": ["error", {
    escape: { taggedTemplates: ["html"] }
  }],
  "no-var": "off",
  "no-restricted-syntax": ["error", {
    selector: "VariableDeclaration[kind='var']:not(Program > VariableDeclaration)",
    message: "var is only for a module's namespace at the top level; use let or const."
  }],
  "no-redeclare": ["error", { builtinGlobals: false }]
};

module.exports = [
  {
    ignores: [
      "node_modules/**",
      "public/docs/**",
      "deleted_markdowns/**",
      "data/**",
      // What `npm run coverage` writes: a report, with its own scripts in it.
      "coverage/**",
      // ...and what `npm run build` writes: every page's scripts concatenated.
      // Linting the output reports each finding a second time, at a line
      // number in a file nobody edits.
      "public/build/**"
    ]
  },
  {
    // Server and tooling. `lib/**` is where the server's own modules live, so it
    // is listed explicitly: a flat config lints a file only if some block claims
    // it, and for a while these did not appear in any block at all — an
    // undefined identifier in lib/ was a runtime error nothing would have caught.
    files: [
      "server.js",
      "eslint.config.js",
      "lib/**/*.js",
      "tools/**/*.js",
      "test/**/*.js"
    ],
    plugins: { security },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: NODE_GLOBALS
    },
    rules: SHARED_RULES
  },
  {
    /* A suite is a script, not a function.
     *
     * Each of these is one `module.exports = async (ctx) => { ... }` holding a
     * few hundred checks in the order somebody would do them by hand. Cutting
     * that into hundred-line pieces would only make the order harder to
     * follow, and its "branches" are the checks themselves — a suite that asks
     * about twenty cases is twenty branches and is none the worse for it. The
     * other rules still apply: a helper inside a suite is a function like any
     * other.
     */
    files: ["test/**/*.js"],
    rules: {
      "max-lines-per-function": "off",
      complexity: "off"
    }
  },
  {
    // Web Workers have no window and no document, which is the entire point of
    // running Python in one. Linting them as browser scripts would let a
    // reference to either slip through.
    files: ["public/js/pyodide-worker.js"],
    plugins: { security },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "script",
      globals: {
        self: "readonly",
        importScripts: "readonly",
        loadPyodide: "readonly",
        console: "readonly",
        fetch: "readonly",
        postMessage: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly"
      }
    },
    rules: SHARED_RULES
  },
  {
    // Browser code. No bundler, no modules — these are plain scripts.
    files: ["public/js/**/*.js"],
    ignores: ["public/js/pyodide-worker.js", "public/js/doc-kinds.js", "public/js/dom-html.js"],
    plugins: { "no-unsanitized": noUnsanitized, security },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "script",
      globals: BROWSER_GLOBALS
    },
    rules: BROWSER_RULES
  },

  {
    /* The two files both sides load: a plain script in the browser and a
     * CommonJS module on the server, so they may say `module` as well as
     * `window`.
     *
     * doc-kinds.js is what a document filename means, and dom-html.js is how
     * text is escaped — both are rules the server and the client have to
     * apply the same way, which is why they are shared rather than copied.
     * Kept to those two on purpose: this is the seam, not a convention.
     */
    files: ["public/js/doc-kinds.js", "public/js/dom-html.js"],
    plugins: { "no-unsanitized": noUnsanitized, security },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "script",
      globals: { ...BROWSER_GLOBALS, module: "readonly" }
    },
    rules: BROWSER_RULES
  }
];
