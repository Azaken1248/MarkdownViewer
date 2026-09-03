/* The headers every response carries, and the reasoning behind each one.
 *
 * A leaf module: no app state, no stores, nothing but the policy itself. It
 * lives on its own because the CSP is the single most security-relevant string
 * in the repository and it should be findable without reading a router.
 */

// Content Security Policy.
//
// script-src is the part that matters: it pins executable code to this origin
// plus the two CDNs we load pinned, SRI-checked bundles from, so an injected
// <script src> or inline payload cannot run.
//
// 'unsafe-inline' is required for style-src because KaTeX sets inline style
// attributes and Mermaid injects <style> blocks into rendered SVG. Styles are
// a far weaker vector than scripts, so this is a deliberate trade.
//
// Running Python in notebooks costs three more allowances, all of them narrow:
//
//   'wasm-unsafe-eval'  lets WebAssembly be compiled. It does NOT enable
//                       eval() or new Function() — that would be
//                       'unsafe-eval', which is still refused.
//   connect-src cdn     Pyodide fetches its ~10MB runtime and any packages a
//                       cell imports at run time, over fetch() rather than
//                       <script>, so script-src does not cover it.
//   worker-src 'self'   the Python worker is our own file.
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://fonts.googleapis.com",
  "font-src 'self' data: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://cdn.jsdelivr.net",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'"
].join("; ");

// One middleware, set on every response including static files and errors:
// a policy that only covers the pages you remembered to cover is not a policy.
function securityHeaders() {
  return (req, res, next) => {
    res.setHeader("Content-Security-Policy", CSP_DIRECTIVES);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  };
}

module.exports = { CSP_DIRECTIVES, securityHeaders };
