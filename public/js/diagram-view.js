/* A diagram, opened in a view of its own.
 *
 * In the app a diagram in a document can be opened in the editor, which is
 * where it can be looked at properly: as big as the window, pannable, and
 * built for it. A shared document has nowhere like that to go — the document
 * belongs to whoever sent the link and a stranger has no session to open an
 * editor with — and the copy in the page is boxed into a slot in the column
 * of words, which for anything past a handful of nodes is a drawing nobody
 * can read.
 *
 * So the drawing gets a view of its own: the page over, the diagram at the
 * size of the window, with the pan and zoom every other diagram here has.
 *
 * Drawn again from its source rather than moved or copied. What is in the
 * block is an SVG with svg-pan-zoom's sizing and viewport transform written
 * into it, so a copy of it is a copy of the box it was squeezed into; and
 * moving the live one leaves the document with a hole in it while the view is
 * open. The source is kept on the block already — the theme repaint renders
 * from it for the same reason — and rendering it is the path every diagram on
 * the page took to get there.
 */

/* exported DiagramView */
var DiagramView = (function () {
  "use strict";

  const OPENER = "diagram-open";

  function create({ content }) {
    let frame = null;
    let stage = null;
    let closer = null;
    let cameFrom = null;

    const isOpen = () => Boolean(frame) && !frame.hidden;

    function build() {
      frame = document.createElement("div");
      frame.className = "diagram-view";
      frame.hidden = true;
      frame.setAttribute("role", "dialog");
      frame.setAttribute("aria-modal", "true");
      frame.setAttribute("aria-label", "Diagram");

      closer = document.createElement("button");
      closer.type = "button";
      closer.className = "diagram-view-close";
      closer.title = "Close this diagram";
      closer.setAttribute("aria-label", "Close this diagram");
      const cross = document.createElement("i");
      cross.className = "ph ph-x";
      closer.appendChild(cross);

      stage = document.createElement("div");
      // markdown-body because that is what the stylesheet styles a diagram
      // block by, and this is the same kind of block as the one in the
      // document; the view's own class is what makes it fill the window.
      stage.className = "diagram-view-stage markdown-body";

      frame.append(closer, stage);
      document.body.appendChild(frame);

      closer.addEventListener("click", () => {
        close();
      });

      frame.addEventListener("click", (event) => {
        // The backdrop only. Letting go of a pan inside the drawing is not a
        // click to put the drawing away.
        if (event.target === frame) {
          close();
        }
      });

      frame.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          // Stopped here, so a page that closes something else on Escape —
          // an outline, a toolbar — does not also close that.
          event.stopPropagation();
          close();
        }
      });
    }

    async function open(source, from) {
      if (!source) {
        return false;
      }

      if (!frame) {
        build();
      }

      cameFrom = from || null;

      const block = document.createElement("div");
      block.className = "mermaid mermaid-block";
      block.textContent = source;
      block.dataset.mermaidSource = source;
      stage.replaceChildren(block);

      frame.hidden = false;
      // The page behind must not scroll under a view that covers it.
      document.body.classList.add("is-viewing-diagram");
      closer.focus();

      // The same call the document itself was rendered with: it draws the
      // laid-out diagrams without an engine, fetches one for the rest, and
      // puts pan and zoom on whatever it ends up with.
      await MarkdownCore.renderMermaidBlocks(stage);
      return true;
    }

    function close() {
      if (!isOpen()) {
        return;
      }

      // Unbound before the SVG it is bound to goes: svg-pan-zoom hangs
      // listeners off the window, and they would outlive the drawing.
      MarkdownCore.destroyPanZoomInstances(stage);
      stage.replaceChildren();
      frame.hidden = true;
      document.body.classList.remove("is-viewing-diagram");

      // Back to the button that opened it, which is where somebody using the
      // keyboard was before the view took the focus.
      if (cameFrom && cameFrom.isConnected) {
        cameFrom.focus();
      }

      cameFrom = null;
    }

    /* The offer, on every diagram that was actually drawn.
     *
     * Not on one that fell back to its source text: there is no drawing to
     * open, and a button promising a view of one is a button that lies.
     */
    function bind() {
      let offered = 0;

      for (const block of content.querySelectorAll(".mermaid-block")) {
        const source = block.dataset.mermaidSource;
        if (!source || !block.querySelector("svg") || block.querySelector(`.${OPENER}`)) {
          continue;
        }

        const button = document.createElement("button");
        button.type = "button";
        button.className = OPENER;
        button.title = "Open this diagram";
        button.setAttribute("aria-label", "Open this diagram");
        // An export is of the document, not of the page's furniture, and
        // snapshot.js already drops anything marked this way.
        button.dataset.export = "skip";

        const icon = document.createElement("i");
        icon.className = "ph ph-arrows-out";
        button.appendChild(icon);

        button.addEventListener("click", () => {
          void open(source, button);
        });

        block.appendChild(button);
        offered += 1;
      }

      return offered;
    }

    return { bind, open, close, isOpen };
  }

  return { create };
})();
