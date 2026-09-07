/* What the engine is built on, and what it fetches when it needs it.
 *
 * The sanitizer configuration is here, in one copy: two copies drift, and the
 * copy nobody is looking at becomes the XSS hole. So is the lazy loader —
 * Mermaid, KaTeX, highlight.js and svg-pan-zoom come to nearly four megabytes
 * between them, and a document with none of those in it downloads none of them.
 */
(function (global) {
  "use strict";

  const mermaidState = { ready: false, theme: null, panZoomCounter: 0 };

  const hooks = {
    onWarning(message) {
      console.warn(message);
    },
    // Off unless the host page turns it on. The share page leaves it off: a
    // visitor following a link should not be handed a Run button for code
    // somebody else wrote.
    executableNotebooks: false
  };

  function configure(overrides) {
    Object.assign(hooks, overrides || {});
  }

  const SANITIZE_ALLOWED_URI_PATTERN = /^(?:(?:(?:f|ht)tps?|mailto|tel):|data:image\/(?:bmp|gif|jpe?g|png|svg\+xml|webp|avif)(?:;charset=[^;,]+)?(?:;base64)?,|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i;
  const MARKDOWN_SANITIZE_OPTIONS = {
    ALLOWED_URI_REGEXP: SANITIZE_ALLOWED_URI_PATTERN,
    ADD_DATA_URI_TAGS: ["img"]
  };
  const CODE_LANGUAGE_ALIAS = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    rb: "ruby",
    sh: "bash",
    shell: "bash",
    zsh: "bash",
    yml: "yaml",
    md: "markdown",
    html: "xml"
  };

  /* --- The heavy half, fetched only when a document needs it ---------------
   *
   * Mermaid is 3.5MB. As a <script defer> in the head it had to arrive and
   * parse before app.js — the file that draws the entire interface — was
   * allowed to run, so every visit paid for a diagram engine, a maths
   * typesetter and a syntax highlighter before it could show a word of text,
   * whether or not the document contained a diagram, an equation or a line of
   * code. All four are only ever reached from inside a render, so they are
   * fetched from inside a render.
   *
   * marked and DOMPurify are deliberately not here. Nothing renders without
   * them, so there is nothing to defer.
   *
   * The integrity hashes are the ones the eager tags carried and must move with
   * the versions. When bumping one, recompute:
   *   curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A
   */
  const LAZY_LIBRARIES = {
    mermaid: {
      label: "The diagram engine",
      loaded: () => Boolean(global.mermaid),
      assets: [
        {
          js: "https://cdn.jsdelivr.net/npm/mermaid@11.16.1/dist/mermaid.min.js",
          integrity: "sha384-aBQXj4hK6Jm05i7aQAsUV3bLdSUrHX1BGYfMB0166TtWt/RRaw+h0Eelme9OCOvy"
        }
      ]
    },
    panZoom: {
      label: "Diagram pan and zoom",
      loaded: () => Boolean(global.svgPanZoom),
      assets: [
        {
          js: "https://cdn.jsdelivr.net/npm/svg-pan-zoom@3.6.1/dist/svg-pan-zoom.min.js",
          integrity: "sha384-yc/c2Lk1s2V2ir1rxvjo8YyVD9PlOlYTqpNr3Wm1WIuAA30GlDYNx6U5104OiavY"
        }
      ]
    },
    highlight: {
      label: "Syntax highlighting",
      loaded: () => Boolean(global.hljs),
      assets: [
        {
          js: "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js",
          integrity: "sha384-RH2xi4eIQ/gjtbs9fUXM68sLSi99C7ZWBRX1vDrVv6GQXRibxXLbwO2NGZB74MbU"
        }
      ]
    },
    // The stylesheet belongs to the same download: KaTeX without its CSS is a
    // column of unspaced glyphs, which reads worse than the TeX it replaced.
    // auto-render reads the katex global at call time, so order matters here —
    // which is why assets load one after another rather than all at once.
    math: {
      label: "Maths typesetting",
      loaded: () => Boolean(global.katex && global.renderMathInElement),
      assets: [
        {
          css: "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css",
          integrity: "sha384-nB0miv6/jRmo5UMMR1wu3Gz6NLsoTkbqJghGIsx//Rlm+ZU03BU6SQNC66uf4l5+"
        },
        {
          js: "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js",
          integrity: "sha384-7zkQWkzuo3B5mTepMUcHkMB5jZaolc2xDwL6VFqjFALcbeS9Ggm/Yr2r3Dy4lfFg"
        },
        {
          js: "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js",
          integrity: "sha384-43gviWU0YVjaDtb/GhzOouOXtZMP/7XUzwPTstBeZFe/+rCMvRwr4yROQP43s0Xk"
        }
      ]
    }
  };

  const libraryLoads = new Map();

  function loadAsset(asset) {
    return new Promise((resolve, reject) => {
      const node = document.createElement(asset.css ? "link" : "script");
      if (asset.css) {
        node.rel = "stylesheet";
        node.href = asset.css;
      } else {
        node.src = asset.js;
      }

      // Same integrity, crossorigin and referrer policy the head tags carried.
      // A subresource that stops being checked because it moved to a lazy load
      // is a subresource that stopped being checked.
      node.integrity = asset.integrity;
      node.crossOrigin = "anonymous";
      node.referrerPolicy = "no-referrer";
      node.addEventListener("load", () => resolve());
      node.addEventListener("error", () => reject(new Error(`Could not load ${asset.css || asset.js}`)));
      document.head.appendChild(node);
    });
  }

  // Resolves true once the library is usable. One load per page, shared by
  // every render that asks while it is still in flight. A failure is not
  // cached: a document opened after the network comes back tries again, and
  // until then the render degrades exactly as it did when the library was
  // simply absent.
  function ensureLibrary(name) {
    const library = LAZY_LIBRARIES[name];
    if (!library) {
      return Promise.resolve(false);
    }

    if (library.loaded()) {
      return Promise.resolve(true);
    }

    if (!libraryLoads.has(name)) {
      const load = (async () => {
        for (const asset of library.assets) {
          await loadAsset(asset);
        }
      })()
        .then(() => library.loaded())
        .catch((error) => {
          console.error(error);
          libraryLoads.delete(name);
          hooks.onWarning(`${library.label} could not be loaded, so part of this document is shown unformatted.`);
          return false;
        });

      libraryLoads.set(name, load);
    }

    return libraryLoads.get(name);
  }

  marked.setOptions({
    gfm: true,
    breaks: false,
    mangle: false,
    headerIds: true,
    langPrefix: "language-"
  });


  // Local copy: a lowercase helper, not shared behaviour worth coupling over.

  global.MdLazy = {
    mermaidState, hooks, configure, SANITIZE_ALLOWED_URI_PATTERN, MARKDOWN_SANITIZE_OPTIONS, CODE_LANGUAGE_ALIAS, LAZY_LIBRARIES, ensureLibrary
  };
})(typeof window === "undefined" ? globalThis : window);
