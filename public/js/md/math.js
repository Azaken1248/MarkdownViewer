/* The TeX left behind by the markdown pass, drawn once KaTeX is here.
 *
 * Nothing loads KaTeX unless a document actually has math in it, so this checks
 * first and only then asks for the library.
 */
/* exported MdMath */
var MdMath = (function () {
  "use strict";

  const { ensureLibrary } = MdLazy;
  const { decodeBase64Utf8 } = MdText;

  const INLINE_MATH_PATTERN = /\$[^$\n]+\$|\\\(|\\\[|\\begin\{/;

  function hasMathContent(root) {
    if (root.querySelector(".math-block[data-math-tex], .math-inline[data-math-tex]")) {
      return true;
    }

    return INLINE_MATH_PATTERN.test(root.textContent || "");
  }

  // Resolves when the maths on screen is typeset. Already-loaded KaTeX is used
  // on the spot rather than a microtask later, so nothing that renders and
  // measures in the same breath has to learn to wait.
  function renderMathBlocks(root) {
    if (!root) {
      return Promise.resolve();
    }

    if (window.katex || window.renderMathInElement) {
      renderLoadedMathBlocks(root);
      return Promise.resolve();
    }

    if (!hasMathContent(root)) {
      return Promise.resolve();
    }

    return ensureLibrary("math").then((ready) => {
      if (ready) {
        renderLoadedMathBlocks(root);
      }
    });
  }

  function renderLoadedMathBlocks(root) {
    if (!root) {
      return;
    }

    /* Both kinds of marker, drawn from the attribute nobody could have
     * altered. The TeX went in before markdown ran and comes out here, so what
     * KaTeX is handed is exactly what the document said.
     */
    if (window.katex) {
      for (const [selector, displayMode] of [
        [".math-block[data-math-tex]", true],
        [".math-inline[data-math-tex]", false]
      ]) {
        for (const node of root.querySelectorAll(selector)) {
          const tex = decodeBase64Utf8(node.getAttribute("data-math-tex") || "");

          try {
            window.katex.render(tex, node, {
              displayMode,
              throwOnError: false,
              errorColor: "#eb9b96"
            });
          } catch (error) {
            console.error("Math rendering failed", error);
            node.textContent = tex;
          }
        }
      }
    }

    if (!window.renderMathInElement) {
      return;
    }

    try {
      window.renderMathInElement(root, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "\\[", right: "\\]", display: true },
          { left: "\\(", right: "\\)", display: false },
          { left: "$", right: "$", display: false }
        ],
        ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code", "svg"],
        processEscapes: true,
        throwOnError: false,
        errorColor: "#eb9b96"
      });
    } catch (error) {
      console.error("Math rendering failed", error);
    }
  }

  function waitForNextFrame() {
    return /** @type {Promise<void>} */ (new Promise((resolve) => {
      window.requestAnimationFrame(() => resolve());
    }));
  }


  return {
    INLINE_MATH_PATTERN, hasMathContent, renderMathBlocks, waitForNextFrame
  };
})();
