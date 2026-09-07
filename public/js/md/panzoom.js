/* Sizing a drawn diagram, and letting it be dragged and zoomed.
 *
 * A diagram is given a box before it is drawn, so the page does not jump when
 * it arrives, and svg-pan-zoom is attached only once there is something to pan.
 * renderMermaidBlocks at the bottom is what a page calls to turn every diagram
 * in a document into a picture.
 */
(function (global) {
  "use strict";

  const { ensureLibrary, hooks, mermaidState } = global.MdLazy;
  const { renderMathBlocks, waitForNextFrame } = global.MdMath;
  const { decorateCodeBlocks } = global.MdCode;
  const { ensureMermaidInitialized, promoteMermaidCodeBlocks, drawLaidOutDiagrams } = global.MdDiagramTheme;
  const { renderSingleMermaidNode } = global.MdMermaid;

  const livePanZoomInstances = new Map();

  function destroyPanZoomInstances(root = null) {
    for (const [svg, instance] of [...livePanZoomInstances.entries()]) {
      // A null root means "everything"; otherwise only what lives under it, plus
      // any node that has since been detached from the document.
      if (root && root.contains(svg) === false && svg.isConnected) {
        continue;
      }

      try {
        instance.destroy();
      } catch (error) {
        console.error("Pan/zoom destroy failed", error);
      }

      delete svg.dataset.panzoomInit;
      livePanZoomInstances.delete(svg);
    }
  }

  // Wheel-over-diagram used to zoom instead of scrolling the page, which turned
  // every diagram into a scroll trap. Wheel zoom is now opt-in for exactly as
  // long as Ctrl/Cmd is held — the same gesture maps use.
  let wheelZoomArmed = false;

  function setWheelZoomArmed(armed) {
    if (armed === wheelZoomArmed) {
      return;
    }

    wheelZoomArmed = armed;
    for (const instance of livePanZoomInstances.values()) {
      try {
        if (armed) {
          instance.enableMouseWheelZoom();
        } else {
          instance.disableMouseWheelZoom();
        }
      } catch (error) {
        console.error("Pan/zoom wheel toggle failed", error);
      }
    }
  }

  function bindWheelZoomModifier() {
    window.addEventListener("keydown", (event) => {
      if (event.key === "Control" || event.key === "Meta") {
        setWheelZoomArmed(true);
      }
    });

    window.addEventListener("keyup", (event) => {
      if (event.key === "Control" || event.key === "Meta") {
        setWheelZoomArmed(false);
      }
    });

    // A keyup that happens while the window is unfocused never arrives, so the
    // modifier would stay stuck on. Reset whenever focus leaves.
    window.addEventListener("blur", () => setWheelZoomArmed(false));
  }

  // svg-pan-zoom sets the SVG to width:100%/height:100%, so the block has to have
  // a height of its own or the whole thing collapses to nothing — which is what a
  // plain `height: auto` container did. Take the shape from the diagram's own
  // viewBox so each one is sized to its content instead of a blanket 65vh, and let
  // CSS clamp the extremes.
  const DIAGRAM_FALLBACK_RATIO = "16 / 9";
  const DIAGRAM_FALLBACK_WIDTH = 720;
  // Small diagrams are still scaled up to at least this, or a three-node flowchart
  // renders postage-stamp sized on a wide monitor.
  const DIAGRAM_MIN_WIDTH = 360;
  // The block's own padding and border, both sides, since aspect-ratio applies to
  // the border box.
  const DIAGRAM_BLOCK_CHROME = 26;

  function sizeDiagramContainer(svg) {
    const block = svg.closest(".mermaid-block");
    if (!block) {
      return;
    }

    let width = 0;
    let height = 0;

    const viewBox = svg.viewBox?.baseVal;
    if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
      width = viewBox.width;
      height = viewBox.height;
    } else {
      // No usable viewBox (some diagram types), so measure what was drawn.
      try {
        const box = svg.getBBox();
        width = box.width;
        height = box.height;
      } catch {
        // getBBox throws on a detached or not-yet-laid-out SVG; fall through.
      }
    }

    if (width > 0 && height > 0) {
      block.style.aspectRatio = `${width} / ${height}`;
      // Capping the width at the diagram's natural size is what keeps a small
      // diagram small. Without it, width:100% stretches a 160px flowchart across
      // the whole pane and the aspect ratio then makes it enormously tall.
      block.style.maxWidth = `${Math.max(width, DIAGRAM_MIN_WIDTH) + DIAGRAM_BLOCK_CHROME}px`;
      return;
    }

    block.style.aspectRatio = DIAGRAM_FALLBACK_RATIO;
    block.style.maxWidth = `${DIAGRAM_FALLBACK_WIDTH}px`;
  }

  // Only ever wanted once a diagram has actually been drawn, which is the one
  // moment worth paying for the controls.
  function applyPanZoom(root) {
    if (!root) {
      return Promise.resolve();
    }

    if (global.svgPanZoom) {
      applyLoadedPanZoom(root);
      return Promise.resolve();
    }

    if (!root.querySelector(".mermaid-block svg")) {
      return Promise.resolve();
    }

    return ensureLibrary("panZoom").then((ready) => {
      if (ready) {
        applyLoadedPanZoom(root);
      }
    });
  }

  function applyLoadedPanZoom(root) {
    if (!window.svgPanZoom) {
      return;
    }

    // Anything previously initialized inside this root is about to be replaced.
    destroyPanZoomInstances(root);

    const svgNodes = root.querySelectorAll(".mermaid-block svg");
    svgNodes.forEach((svg) => {
      if (svg.dataset.panzoomInit === "1") {
        return;
      }

      // A diagram that is itself a control — the flowchart builder's preview,
      // where a box is tapped to select it — cannot also be a pan-zoom
      // surface: svg-pan-zoom takes the pointer events and adds its own
      // controls on top. Opting a container out is the only thing that keeps
      // those clicks.
      if (svg.closest("[data-pan-zoom=\"off\"]")) {
        return;
      }

      // Must happen before svg-pan-zoom takes over the SVG's own dimensions.
      sizeDiagramContainer(svg);

      mermaidState.panZoomCounter += 1;
      const id = svg.id || `mermaid-svg-${mermaidState.panZoomCounter}`;
      svg.id = id;

      try {
        const panZoomInstance = window.svgPanZoom(`#${id}`, {
          controlIconsEnabled: true,
          fit: true,
          center: true,
          minZoom: 0.5,
          maxZoom: 12,
          zoomScaleSensitivity: 0.3,
          // Off by default so scrolling the page past a diagram scrolls the page.
          // Held Ctrl/Cmd turns it on for as long as the key is down; the +/-
          // control icons work regardless.
          mouseWheelZoomEnabled: false
        });
        svg.dataset.panzoomInit = "1";
        livePanZoomInstances.set(svg, panZoomInstance);
        if (wheelZoomArmed) {
          // Rendered while the modifier was already down.
          panZoomInstance.enableMouseWheelZoom();
        }
        window.requestAnimationFrame(() => {
          // Destroyed between the init and the frame, which is what a second
          // render pass over the same root does: it takes the instance apart
          // and builds another one. svg-pan-zoom nulls its internals on
          // destroy, so the refit this frame was scheduled for would be a
          // refit of nothing — and it threw rather than saying so.
          if (livePanZoomInstances.get(svg) !== panZoomInstance) {
            return;
          }

          try {
            panZoomInstance.resize();
            panZoomInstance.fit();
            panZoomInstance.center();
          } catch (error) {
            console.error("Pan/zoom refit failed", error);
          }
        });
      } catch (error) {
        console.error("Pan/zoom init failed", error);
      }
    });
  }

  async function renderMermaidBlocks(root) {
    const drawn = drawLaidOutDiagrams(root);

    // Asked before anything else is promoted, and deliberately so. Promoting
    // turns a fenced block into a bare <div>, so doing it first and then
    // finding the engine unavailable would leave the diagram's source as loose
    // body text. A document with no diagram in it — or none left that needs an
    // engine — never downloads one at all.
    const wantsDiagram = Boolean(root?.querySelector(
      "pre > code.language-mermaid, pre > code.lang-mermaid, .mermaid:not([data-diagram-drawn])"
    ));

    if (wantsDiagram) {
      await ensureLibrary("mermaid");
    }

    ensureMermaidInitialized();
    if (!window.mermaid) {
      await decorateCodeBlocks(root);
      if (drawn > 0) {
        await applyPanZoom(root);
      }
      await renderMathBlocks(root);
      return;
    }

    await waitForNextFrame();
    promoteMermaidCodeBlocks(root);
    await waitForNextFrame();
    const nodes = root.querySelectorAll(".mermaid:not([data-diagram-drawn])");
    if (nodes.length === 0) {
      if (drawn > 0) {
        await applyPanZoom(root);
      }

      await decorateCodeBlocks(root);
      await renderMathBlocks(root);
      return;
    }

    let hadFailure = false;
    for (const node of nodes) {
      const ok = await renderSingleMermaidNode(node);
      if (!ok) {
        hadFailure = true;
      }
    }

    await decorateCodeBlocks(root);
    await applyPanZoom(root);
    await renderMathBlocks(root);
    if (hadFailure) {
      hooks.onWarning("One or more Mermaid blocks were auto-simplified or could not be parsed.");
    }
  }


  global.MdPanZoom = {
    sizeDiagramContainer, applyPanZoom, destroyPanZoomInstances, setWheelZoomArmed, bindWheelZoomModifier, renderMermaidBlocks
  };
})(typeof window === "undefined" ? globalThis : window);
