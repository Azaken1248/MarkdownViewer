// Tooltips.
//
// Nearly every control in this app is icon-only, and native `title` tooltips
// are slow, unstyleable, and land in the wrong place. This adopts the existing
// `title` attributes rather than replacing them at ~40 call sites: on first
// hover the text is moved to `data-tip` (which also stops the native tooltip
// from ever appearing) and drawn in one body-level element, so a tooltip is
// never clipped by the sidebar's own scroll container.
//
// `aria-label` still carries the accessible name, so the tooltip itself is
// decorative and hidden from assistive tech.

(function (global) {
  const TOOLTIP_GAP = 8;
  const TOOLTIP_EDGE_PADDING = 8;

  let tooltipElement = null;
  let tooltipTarget = null;

  function ensureTooltipElement() {
    if (tooltipElement) {
      return tooltipElement;
    }

    tooltipElement = document.createElement("div");
    tooltipElement.className = "tooltip";
    tooltipElement.setAttribute("aria-hidden", "true");
    tooltipElement.hidden = true;
    document.body.appendChild(tooltipElement);
    return tooltipElement;
  }

  function tooltipTextFor(element) {
    // A freshly-assigned .title wins: dynamic labels ("Archive" -> "Exit
    // archive") are rewritten by the code that owns them.
    const native = element.getAttribute("title");
    if (native) {
      element.dataset.tip = native;
      element.removeAttribute("title");
    }

    return element.dataset.tip || "";
  }

  function hideTooltip() {
    tooltipTarget = null;
    if (tooltipElement) {
      tooltipElement.hidden = true;
      tooltipElement.classList.remove("is-above");
    }
  }

  function showTooltip(element) {
    const text = tooltipTextFor(element);
    if (!text) {
      hideTooltip();
      return;
    }

    const tip = ensureTooltipElement();
    tooltipTarget = element;
    tip.textContent = text;
    tip.hidden = false;

    const anchor = element.getBoundingClientRect();
    const box = tip.getBoundingClientRect();

    // Below by default, above when the bottom of the window is in the way.
    const above = anchor.bottom + TOOLTIP_GAP + box.height > window.innerHeight;
    const top = above
      ? anchor.top - box.height - TOOLTIP_GAP
      : anchor.bottom + TOOLTIP_GAP;

    const maxLeft = window.innerWidth - box.width - TOOLTIP_EDGE_PADDING;
    const left = Math.min(
      Math.max(anchor.left + (anchor.width - box.width) / 2, TOOLTIP_EDGE_PADDING),
      Math.max(maxLeft, TOOLTIP_EDGE_PADDING)
    );

    tip.classList.toggle("is-above", above);
    tip.style.top = `${Math.round(top)}px`;
    tip.style.left = `${Math.round(left)}px`;
  }

  function bindTooltips() {
    document.addEventListener("pointerover", (event) => {
      // Touch has no hover state, and a tooltip there just covers what was
      // tapped. The mobile dock carries visible text labels instead.
      if (event.pointerType === "touch" || !(event.target instanceof Element)) {
        return;
      }

      const element = event.target.closest("[title], [data-tip]");
      if (!element || element === tooltipTarget) {
        if (!element) {
          hideTooltip();
        }
        return;
      }

      showTooltip(element);
    });

    document.addEventListener("pointerout", (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }

      // relatedTarget null means the pointer left the window entirely.
      const next = event.relatedTarget;
      if (tooltipTarget && (!next || !tooltipTarget.contains(next))) {
        hideTooltip();
      }
    });

    document.addEventListener("focusin", (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }

      const element = event.target.closest("[title], [data-tip]");
      if (element && element.matches(":focus-visible")) {
        showTooltip(element);
      } else {
        hideTooltip();
      }
    });

    document.addEventListener("focusout", hideTooltip);
    document.addEventListener("click", hideTooltip);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        hideTooltip();
      }
    });
    // The anchor moves out from under a tooltip on any scroll, including the
    // sidebar's own, so listen in the capture phase to catch every scroller.
    document.addEventListener("scroll", hideTooltip, true);
    window.addEventListener("resize", hideTooltip);
  }

  global.AppTooltips = {
    showTooltip,
    hideTooltip,
    bindTooltips
  };
})(typeof window === "undefined" ? globalThis : window);
