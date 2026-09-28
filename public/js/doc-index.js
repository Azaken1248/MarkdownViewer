/* A document's headings, as a tree you can collapse and jump from.
 *
 * Built for the share page: a shared document is a thing somebody reads end to
 * end, often a long one, and the reading view had no way to reach a section
 * except by scrolling to it. The headings are read off the rendered page —
 * md/lazy.js gives each one an anchor, which is what the links point at — so
 * nothing is parsed twice and an anchor pasted elsewhere goes to the same
 * place.
 *
 * Standalone on purpose. It takes the elements it works on rather than
 * reaching for a namespace, so the page it is on is the page's business: the
 * share view scrolls the window and has no sidebar, and anything else that
 * wants an outline can hand over different elements.
 *
 * A nav of nested lists, not an ARIA tree. Nested lists are what a screen
 * reader already understands and links are already reachable with Tab, where
 * role="tree" promises an arrow-key model that then has to be built and kept
 * working — a half-built tree widget is worse for somebody using one than an
 * honest list. The collapse controls are buttons that say whether they are
 * open, and the heading being read carries aria-current.
 */

/* exported DocIndex */
var DocIndex = (function () {
  "use strict";

  const HEADINGS = "h1, h2, h3, h4, h5, h6";

  // Whether the reader wants it, remembered between visits. Per-viewer taste,
  // so a browser that refuses storage just means "not remembered".
  const STORAGE_KEY = "mdviewer.outline";

  /* The headings on the page, flat, with the level each one declares.
   *
   * The level is the tag's own number rather than a depth counted while
   * walking, because a document that goes from h2 straight to h4 means it:
   * the h4 belongs under the h2, and nesting it two deep would draw a level
   * that is not in the document.
   */
  function headingsIn(root) {
    const found = [];

    for (const node of root.querySelectorAll(HEADINGS)) {
      const text = (node.textContent || "").trim();
      // A heading with no anchor is one nothing can link to, so it is left out
      // rather than listed as a link that goes nowhere.
      if (text && node.id) {
        found.push({ id: node.id, text, level: Number(node.tagName[1]), node });
      }
    }

    return found;
  }

  /* The flat list, nested by level.
   *
   * Each heading hangs off the nearest one above it with a smaller level. A
   * document whose first heading is an h3 is not malformed; it starts at the
   * top of its own tree, which is why the stack is emptied rather than padded.
   */
  function nest(headings) {
    const roots = [];
    const stack = [];

    for (const heading of headings) {
      const item = { ...heading, children: [] };

      while (stack.length > 0 && stack[stack.length - 1].level >= item.level) {
        stack.pop();
      }

      if (stack.length === 0) {
        roots.push(item);
      } else {
        stack[stack.length - 1].children.push(item);
      }

      stack.push(item);
    }

    return roots;
  }

  function remembered() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === "open";
    } catch {
      return false;
    }
  }

  function remember(wanted) {
    try {
      window.localStorage.setItem(STORAGE_KEY, wanted ? "open" : "closed");
    } catch {
      // Private mode. The choice still holds for this page.
    }
  }

  function scrollToHeading(view, node) {
    const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth";

    if (!view.scroller) {
      node.scrollIntoView({ block: "start", behavior });
      return;
    }

    const top = node.getBoundingClientRect().top - view.scroller.getBoundingClientRect().top;
    view.scroller.scrollBy({ top: top - 12, behavior });
  }

  // The heading being read, said as well as shown.
  function paintActive(view) {
    for (const link of view.body.querySelectorAll(".doc-index-link")) {
      const isActive = link.dataset.id === view.active;
      link.classList.toggle("is-active", isActive);

      if (isActive) {
        link.setAttribute("aria-current", "true");
      } else {
        link.removeAttribute("aria-current");
      }
    }
  }

  /* Is the panel over the document, or beside it?
   *
   * The stylesheet decides, at a width where there is room for a rail in the
   * margin — so this asks it rather than keeping a second copy of the
   * breakpoint that would drift from the first. When there is room, nothing is
   * covered and nothing needs dismissing.
   */
  function overlaying(view) {
    return Boolean(view.backdrop)
      && window.getComputedStyle(view.backdrop).display !== "none";
  }

  function toggleBranch(view, id) {
    if (view.collapsed.has(id)) {
      view.collapsed.delete(id);
    } else {
      view.collapsed.add(id);
    }

    draw(view);
  }

  // A branch's control, which says whether it is open; a leaf gets the same
  // width of gutter and nothing to press.
  function caretFor(view, entry) {
    if (entry.children.length === 0) {
      const spacer = document.createElement("span");
      spacer.className = "doc-index-caret is-empty";
      spacer.setAttribute("aria-hidden", "true");
      return spacer;
    }

    const caret = document.createElement("button");
    caret.type = "button";
    caret.className = "doc-index-caret";
    const shut = view.collapsed.has(entry.id);
    caret.setAttribute("aria-expanded", shut ? "false" : "true");
    caret.setAttribute("aria-label", `${shut ? "Expand" : "Collapse"} ${entry.text}`);
    caret.innerHTML = '<i class="ph ph-caret-down" aria-hidden="true"></i>';
    caret.addEventListener("click", () => toggleBranch(view, entry.id));
    return caret;
  }

  function linkFor(view, entry) {
    const link = document.createElement("a");
    link.className = "doc-index-link";
    link.href = `#${entry.id}`;
    link.textContent = entry.text;
    link.dataset.id = entry.id;
    link.dataset.level = String(entry.level);

    link.addEventListener("click", (event) => {
      event.preventDefault();
      scrollToHeading(view, entry.node);
      view.active = entry.id;
      paintActive(view);

      // Over the document, so reading what you just jumped to means getting it
      // out of the way. Beside the document, it stays where it is.
      if (overlaying(view)) {
        show(view, false);
      }
    });

    return link;
  }

  /* One heading, as a list item. Built as elements rather than as markup: the
   * text is the document's, and this is the one place it would otherwise be
   * interpolated into HTML.
   */
  function itemFor(view, entry) {
    const item = document.createElement("li");
    item.className = "doc-index-item";

    const row = document.createElement("div");
    row.className = "doc-index-row";
    row.appendChild(caretFor(view, entry));
    row.appendChild(linkFor(view, entry));
    item.appendChild(row);

    if (entry.children.length > 0) {
      const list = document.createElement("ul");
      list.className = "doc-index-children";
      list.hidden = view.collapsed.has(entry.id);
      for (const child of entry.children) {
        list.appendChild(itemFor(view, child));
      }
      item.appendChild(list);
    }

    return item;
  }

  function draw(view) {
    const list = document.createElement("ul");
    list.className = "doc-index-list";
    for (const entry of view.tree) {
      list.appendChild(itemFor(view, entry));
    }

    view.body.replaceChildren(list);
    paintActive(view);
  }

  /* Which heading the reader is at.
   *
   * An observer rather than a scroll handler: a scroll handler on a long
   * document runs hundreds of times a second, and this only has to know when a
   * heading crosses the top. The margin makes the band the top fifth of the
   * page, so the heading that has just gone past is the one named.
   */
  function watchScrolling(view, headings) {
    view.watcher?.disconnect();
    view.watcher = null;

    if (!window.IntersectionObserver || headings.length === 0) {
      return;
    }

    const showing = new Map();
    view.watcher = new window.IntersectionObserver((entries) => {
      for (const entry of entries) {
        showing.set(entry.target.id, entry.isIntersecting);
      }

      const passed = headings.filter((one) => showing.get(one.id));
      const current = passed.length > 0
        ? passed[passed.length - 1].id
        : headings.find((one) => one.node.getBoundingClientRect().top > 0)?.id || "";

      if (current !== view.active) {
        view.active = current;
        paintActive(view);
      }
    }, { root: view.scroller, rootMargin: "0px 0px -80% 0px", threshold: 0 });

    for (const heading of headings) {
      view.watcher.observe(heading.node);
    }
  }

  function show(view, wanted) {
    view.open = wanted;
    remember(wanted);

    const listed = view.tree.length > 0;
    view.panel.hidden = !wanted || !listed;

    if (view.backdrop) {
      view.backdrop.hidden = !wanted || !listed;
    }

    if (view.toggle) {
      view.toggle.setAttribute("aria-expanded", wanted ? "true" : "false");
      const label = wanted ? "Hide the outline" : "Show the outline";
      view.toggle.setAttribute("aria-label", label);
      view.toggle.title = label;
    }

    document.body.classList.toggle("has-doc-index", wanted && listed);
  }

  /* Build it again for whatever is on the page now. Called once the document
   * has rendered, because the headings are the document's.
   */
  function refresh(view) {
    const headings = headingsIn(view.content);
    view.collapsed.clear();
    view.active = headings[0]?.id || "";
    view.tree = nest(headings);

    // One heading is a title, not an outline. Two is a document with sections.
    const listed = headings.length > 1;
    if (view.toggle) {
      view.toggle.hidden = !listed;
    }

    if (!listed) {
      view.tree = [];
      show(view, false);
      view.watcher?.disconnect();
      view.watcher = null;
      return;
    }

    draw(view);
    show(view, view.open || remembered());
    watchScrolling(view, headings);
  }

  function bind(view) {
    view.toggle?.addEventListener("click", () => show(view, !view.open));
    view.closeBtn?.addEventListener("click", () => {
      show(view, false);
      view.toggle?.focus();
    });
    view.backdrop?.addEventListener("click", () => show(view, false));

    // Escape closes it, which is what a panel over the document has to do.
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && view.open && overlaying(view)) {
        show(view, false);
        view.toggle?.focus();
      }
    });
  }

  /* One outline, on the elements it was handed.
   *
   * `scroller` is what actually scrolls — the share page scrolls a container
   * of its own, and somewhere else it might be the window, which is what null
   * means here.
   */
  function create(options) {
    const view = {
      content: options.content,
      panel: options.panel,
      body: options.body,
      toggle: options.toggle || null,
      closeBtn: options.closeBtn || null,
      backdrop: options.backdrop || null,
      scroller: options.scroller || null,
      collapsed: new Set(),
      tree: [],
      active: "",
      watcher: null,
      open: false
    };

    bind(view);
    return { refresh: () => refresh(view) };
  }

  return { create, headingsIn, nest };
})();
