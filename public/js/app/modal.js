// Modal focus containment.
//
// The dialogs claimed aria-modal="true" but nothing enforced it: a screen
// reader or a Tab key walked straight out of an open dialog into the page
// behind it. A layer is pushed when a dialog opens and popped when it closes,
// everything outside the top layer is made inert, and Tab wraps within it.
//
// A stack, not a flag, because dialogs open on top of dialogs — the share
// dialog over the document, a confirmation over that.

(function (global) {
  const FOCUSABLE_SELECTOR = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled]):not([type='hidden'])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])"
  ].join(",");

  const modalLayerStack = [];

  function focusableWithin(container) {
    return [...container.querySelectorAll(FOCUSABLE_SELECTOR)].filter((node) => {
      // offsetParent is null for display:none subtrees; position:fixed nodes have
      // no offsetParent either, so fall back to a box check for those.
      return node.offsetParent !== null || node.getClientRects().length > 0;
    });
  }

  function syncModalInertness() {
    const top = modalLayerStack.length
      ? modalLayerStack[modalLayerStack.length - 1].element
      : null;

    for (const node of document.body.children) {
      // Toasts have to stay announceable even while a dialog is up.
      if (node.id === "toastRegion") {
        continue;
      }

      node.inert = Boolean(top) && node !== top;
    }
  }

  function trapModalTab(event) {
    if (event.key !== "Tab") {
      return;
    }

    const layer = modalLayerStack[modalLayerStack.length - 1];
    if (!layer || !layer.element.contains(event.currentTarget)) {
      return;
    }

    const focusable = focusableWithin(layer.element);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || !layer.element.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function enterModalLayer(element) {
    if (modalLayerStack.some((layer) => layer.element === element)) {
      return;
    }

    const opener = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    element.addEventListener("keydown", trapModalTab);
    modalLayerStack.push({ element, opener });
    syncModalInertness();
  }

  function exitModalLayer(element) {
    const index = modalLayerStack.findIndex((layer) => layer.element === element);
    if (index === -1) {
      return;
    }

    const [layer] = modalLayerStack.splice(index, 1);
    element.removeEventListener("keydown", trapModalTab);
    syncModalInertness();

    // Only the dialog that actually owned focus should move it, and only if the
    // opener is still on the page and reachable.
    const opener = layer.opener;
    if (opener && opener.isConnected && !opener.inert && typeof opener.focus === "function") {
      opener.focus();
    }
  }

  global.AppModal = {
    enterModalLayer,
    exitModalLayer
  };
})(typeof window === "undefined" ? globalThis : window);
