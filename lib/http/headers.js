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

/* What a page here is allowed to ask the browser for. Nothing in this app
 * needs a camera, a microphone, a location, a USB device or a payment
 * handler, so an injected script cannot ask for one either. Denying them
 * costs one line, and interest-cohort= is the opt-out from the ad-profiling
 * experiment for anyone still running a browser that had it.
 */
const PERMISSIONS_POLICY = [
  "camera=()", "microphone=()", "geolocation=()", "payment=()", "usb=()",
  "interest-cohort=()"
].join(", ");

// A year. Long enough that a browser that has seen this site once will not
// speak plain HTTP to it again before the next visit refreshes it. No
// `preload`: that submits the domain to a list browsers ship with, and it is
// effectively irreversible, so it is a decision to make on purpose and not one
// to make here by default.
const HSTS = "max-age=31536000; includeSubDomains";

/* One middleware, set on every response including static files and errors:
 * a policy that only covers the pages you remembered to cover is not a policy.
 *
 * `secure` says whether this deployment is actually reached over HTTPS. HSTS
 * goes out only then: sent from a plain-HTTP server it would pin localhost,
 * or a development box, to a scheme it does not serve, and the browser would
 * refuse to come back.
 */
function securityHeaders({ secure = false } = {}) {
  return (req, res, next) => {
    res.setHeader("Content-Security-Policy", CSP_DIRECTIVES);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    // frame-ancestors in the CSP covers a modern browser; this is what an
    // older one, and every scanner, still looks for.
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    // A page opened from here cannot be reached back into through
    // window.opener, and nothing here reaches into one it opened.
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    // The app's own responses — a pasted image, the icon, the embed card —
    // are for the app's own pages. A crawler fetching og:image for a preview
    // is a server, not a browser, and this does not apply to it.
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Permissions-Policy", PERMISSIONS_POLICY);

    if (secure) {
      res.setHeader("Strict-Transport-Security", HSTS);
    }

    next();
  };
}

module.exports = { CSP_DIRECTIVES, PERMISSIONS_POLICY, HSTS, securityHeaders };
