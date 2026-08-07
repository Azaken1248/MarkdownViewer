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

  // Our own shared render engine, loaded as a plain script before app.js.
  MarkdownCore: "readonly"
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
    // Server and tooling.
    files: ["server.js", "eslint.config.js", "test/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: NODE_GLOBALS
    },
    rules: SHARED_RULES
  },
  {
    // Browser code. No bundler, no modules — these are plain scripts.
    files: ["public/js/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "script",
      globals: BROWSER_GLOBALS
    },
    rules: SHARED_RULES
  }
];
