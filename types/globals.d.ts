// What the checker cannot see from the sources alone.
//
// `npm run typecheck` reads every file the page loads as the classic script it
// is, so a module's top-level `var Name = (function () { ... })();` is a global
// with its real type. What remains are the names that arrive some other way:
// libraries loaded from a CDN as plain <script> tags, the one file that is a
// CommonJS module and a browser script at once, the worker's scope, and the
// field the session middleware hangs on each Express request.

// The CDN libraries. Pinned and SRI-checked in the pages; none ships types we
// could use as a script, so they are `any` here — the calls into them are the
// one place the check is no stronger than it was.
declare const marked: any;
declare const DOMPurify: any;
declare const mermaid: any;
declare const hljs: any;
declare const katex: any;
declare const renderMathInElement: any;
declare const svgPanZoom: any;

// The same libraries, looked up on the window where a module asks whether one
// has loaded yet rather than assuming it has.
interface Window {
  marked?: any;
  DOMPurify?: any;
  mermaid?: any;
  hljs?: any;
  katex?: any;
  renderMathInElement?: any;
  svgPanZoom?: any;
  loadPyodide?: any;
}

// The two files both sides use: required by lib/ and loaded by every page, so
// the checker sees each as the module it also is and needs telling about the
// global the page knows it by.
declare const DocKinds: typeof import("../public/js/doc-kinds.js");
declare const DomHtml: typeof import("../public/js/dom-html.js");

// The Python worker's own scope (pyodide-worker.js). The DOM lib and the
// worker lib cannot both be loaded, so the two names it uses are declared here.
declare function importScripts(...urls: string[]): void;
declare function loadPyodide(options?: { indexURL?: string }): Promise<any>;

// attachSession (lib/guards.js) sets this on every request before any route
// runs: the signed-in account, or null.
declare namespace Express {
  interface Request {
    auth: import("../lib/auth.js").RequestAuth | null;
  }
}
