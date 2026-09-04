// Flat config (ESLint 9). Deliberately close to the code that is already here:
// the point is to catch real mistakes — an undeclared variable, an unused
// binding, a fall-through — not to relitigate style across 6,000 lines that
// read consistently already.

const js = require("@eslint/js");

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
  // Our own shared render engine, loaded as a plain script before app.js.
  MarkdownCore: "readonly",
  // Block splitting and markdown serialization for the visual editor.
  VisualEditor: "readonly",
  // Mermaid flowcharts as steps and arrows, for the diagram builder.
  DiagramModel: "readonly",
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
  "no-console": "off",

  // A missing await on a write is a data-loss bug, not a style question.
  "require-atomic-updates": "error",
  "no-return-await": "error",
  "no-await-in-loop": "off",

  "no-fallthrough": "error",
  "no-constant-condition": ["error", { checkLoops: false }],
  "no-empty": ["error", { allowEmptyCatch: true }]
};

module.exports = [
  {
    ignores: [
      "node_modules/**",
      "public/docs/**",
      "deleted_markdowns/**",
      "data/**"
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
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: NODE_GLOBALS
    },
    rules: SHARED_RULES
  },
  {
    // Web Workers have no window and no document, which is the entire point of
    // running Python in one. Linting them as browser scripts would let a
    // reference to either slip through.
    files: ["public/js/pyodide-worker.js"],
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
    ignores: ["public/js/pyodide-worker.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "script",
      globals: BROWSER_GLOBALS
    },
    rules: SHARED_RULES
  }
];
