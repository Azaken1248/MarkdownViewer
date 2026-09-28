/* The document's headings, as a tree beside it.
 *
 * A long document is a thing you navigate, not a thing you scroll, and this
 * app had no way to get to a heading except by looking for it. The outline is
 * built from the headings already on the page — marked gives each one an id,
 * which is what the links point at — so nothing is parsed twice and an anchor
 * somebody pastes elsewhere goes to the same place.
 *
 * Beside the viewer rather than inside it. The viewer is the scroll container,
 * and an outline that scrolls away with the document is an outline you cannot
 * use to leave where you are.
 *
 * A nav of nested lists rather than an ARIA tree. Nested lists are what a
 * screen reader already understands and links are already reachable with Tab;
 * `role="tree"` would promise an arrow-key model that then has to be built and
 * kept working, and a half-built tree widget is worse for somebody using one
 * than an honest list. The collapse controls are buttons with aria-expanded,
 * which is the part that does need saying out loud.
 */

/* exported AppDocIndex */
var AppDocIndex = (function () {
  const { elements } = AppDom;

  // Which headings count. h1 is usually the document's title and is included
  // anyway: a document with several is a document where they are sections.
  const HEADINGS = "h1, h2, h3, h4, h5, h6";

  // Whether the reader wants the panel at all, remembered between documents
  // and between visits. Per-viewer taste, so localStorage is the right home
  // and a browser that refuses it just means "not remembered".
  const STORAGE_KEY = "mdviewer.outline";

  const state = {
    open: false,
    // id -> whether its children are hidden. Per document; cleared on rebuild,
    // because a heading in one document is not a heading in the next.
    collapsed: new Set(),
    active: "",
    watcher: null
  };

  function remembered() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === "open";
    } catch {
      return false;
    }
  }

  function remember(open) {
    try {
      window.localStorage.setItem(STORAGE_KEY, open ? "open" : "closed");
    } catch {
      // Private mode. The choice still holds for this page.
    }
  }

  /* The headings on the page, flat, with the depth each one sits at.
   *
   * The level is the tag's own number rather than a depth counted as we go,
   * because a document that jumps from h2 to h4 means it: the h4 belongs under
   * the h2 and nesting it two deep would draw a level that is not there.
   */
  function headingsIn(root) {
    const found = [];

    for (const node of root.querySelectorAll(HEADINGS)) {
      const text = (node.textContent || "").trim();
      if (!text) {
        continue;
      }

      // marked gives every heading an id; one without is one this app did not
      // render, and there is nothing to link to.
      if (!node.id) {
        continue;
      }

      found.push({ id: node.id, text, level: Number(node.tagName[1]), node });
    }

    return found;
  }

  /* The flat list, nested by level.
   *
   * Each heading hangs off the nearest one above it with a smaller level. A
   * document whose first heading is an h3 is not malformed; it just starts at
   * the top of this tree, which is why the stack is emptied rather than
   * padded.
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

  function scrollTo(heading) {
    // The viewer is the scroll container, and the toolbar sticks to its top,
    // so scrollIntoView on its own puts the heading under the bar. `start`
    // plus the bar's height is what lands it where somebody can read it.
    const bar = elements.viewerToolbar;
    const offset = bar ? bar.getBoundingClientRect().height : 0;
    const viewer = elements.docContent?.closest(".viewer");

    if (!viewer) {
      heading.scrollIntoView({ block: "start" });
      return;
    }

    const top = heading.getBoundingClientRect().top - viewer.getBoundingClientRect().top;
    viewer.scrollBy({
      top: top - offset - 8,
      // A reader who has asked not to be moved around is not moved around.
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth"
    });
  }

  /* One heading, as a list item.
   *
   * Built as elements rather than as markup because the text is the document's
   * and this is the one place it would otherwise be interpolated into HTML.
   */
  function itemFor(entry) {
    const item = document.createElement("li");
    item.className = "doc-index-item";
    item.dataset.id = entry.id;

    const row = document.createElement("div");
    row.className = "doc-index-row";

    if (entry.children.length > 0) {
      const caret = document.createElement("button");
      caret.type = "button";
      caret.className = "doc-index-caret";
      const hidden = state.collapsed.has(entry.id);
      caret.setAttribute("aria-expanded", hidden ? "false" : "true");
      caret.setAttribute("aria-label", `${hidden ? "Expand" : "Collapse"} ${entry.text}`);
      caret.innerHTML = '<i class="ph ph-caret-down" aria-hidden="true"></i>';
      caret.addEventListener("click", () => toggleBranch(entry.id));
      row.appendChild(caret);
    } else {
      const spacer = document.createElement("span");
      spacer.className = "doc-index-caret is-empty";
      spacer.setAttribute("aria-hidden", "true");
      row.appendChild(spacer);
    }

    const link = document.createElement("a");
    link.className = "doc-index-link";
    link.href = `#${entry.id}`;
    link.textContent = entry.text;
    link.dataset.level = String(entry.level);
    link.addEventListener("click", (event) => {
      // The app owns the address bar; a hash jump here would fight it.
      event.preventDefault();
      scrollTo(entry.node);
    });

    row.appendChild(link);
    item.appendChild(row);

    if (entry.children.length > 0) {
      const list = document.createElement("ul");
      list.className = "doc-index-children";
      list.hidden = state.collapsed.has(entry.id);
      for (const child of entry.children) {
        list.appendChild(itemFor(child));
      }
      item.appendChild(list);
    }

    return item;
  }

  function toggleBranch(id) {
    if (state.collapsed.has(id)) {
      state.collapsed.delete(id);
    } else {
      state.collapsed.add(id);
    }

    draw();
  }

  let tree = [];

  function draw() {
    const body = elements.docIndexBody;
    if (!body) {
      return;
    }

    const list = document.createElement("ul");
    list.className = "doc-index-list";
    for (const entry of tree) {
      list.appendChild(itemFor(entry));
    }

    body.replaceChildren(list);
    paintActive();
  }

  // The heading being read, marked in the outline. aria-current rather than a
  // class alone, so it is said as well as shown.
  function paintActive() {
    const body = elements.docIndexBody;
    if (!body) {
      return;
    }

    for (const link of body.querySelectorAll(".doc-index-link")) {
      const isActive = link.getAttribute("href") === `#${state.active}`;
      link.classList.toggle("is-active", isActive);
      if (isActive) {
        link.setAttribute("aria-current", "true");
      } else {
        link.removeAttribute("aria-current");
      }
    }
  }

  /* Which heading the reader is at.
   *
   * An observer rather than a scroll handler: a scroll handler on a long
   * document runs hundreds of times a second and this only has to know when a
   * heading crosses the top. The band is the top fifth of the viewer, so the
   * heading that has just gone past the bar is the one named.
   */
  function watchScrolling(headings) {
    state.watcher?.disconnect();
    state.watcher = null;

    if (!window.IntersectionObserver || headings.length === 0) {
      return;
    }

    const seen = new Map();
    state.watcher = new window.IntersectionObserver((entries) => {
      for (const entry of entries) {
        seen.set(entry.target.id, entry.isIntersecting);
      }

      // The last heading whose top has gone past: the one being read.
      const passed = headings.filter((one) => seen.get(one.id));
      const current = passed.length > 0
        ? passed[passed.length - 1].id
        : headings.find((one) => one.node.getBoundingClientRect().top > 0)?.id || "";

      if (current !== state.active) {
        state.active = current;
        paintActive();
      }
    }, {
      root: elements.docContent?.closest(".viewer") || null,
      rootMargin: "0px 0px -80% 0px",
      threshold: 0
    });

    for (const heading of headings) {
      state.watcher.observe(heading.node);
    }
  }

  function show(open) {
    state.open = open;
    remember(open);

    if (elements.docIndex) {
      elements.docIndex.hidden = !open || tree.length === 0;
    }

    const toggle = elements.docIndexToggleBtn;
    if (toggle) {
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      const label = open ? "Hide the outline" : "Show the outline";
      toggle.setAttribute("aria-label", label);
      toggle.title = label;
    }

    document.body.classList.toggle("has-doc-index", open && tree.length > 0);
  }

  /* Build it again, for whatever is on the page now.
   *
   * Called after every render — opening a document, leaving the editor,
   * changing the theme — because the headings are the document's and the
   * document may be a different one.
   */
  function refresh() {
    const content = elements.docContent;
    if (!content) {
      return;
    }

    const headings = headingsIn(content);
    state.collapsed = new Set();
    state.active = headings[0]?.id || "";
    tree = nest(headings);

    // One heading is a title, not an outline. Two is a document with sections.
    const worthShowing = headings.length > 1;
    if (elements.docIndexToggleBtn) {
      elements.docIndexToggleBtn.hidden = !worthShowing;
    }

    if (!worthShowing) {
      tree = [];
      show(false);
      state.watcher?.disconnect();
      state.watcher = null;
      return;
    }

    draw();
    show(state.open || remembered());
    watchScrolling(headings);
  }

  function bindDocIndex() {
    state.open = remembered();

    elements.docIndexToggleBtn?.addEventListener("click", () => show(!state.open));
    elements.docIndexCloseBtn?.addEventListener("click", () => {
      show(false);
      elements.docIndexToggleBtn?.focus();
    });
  }

  return { bindDocIndex, refresh, headingsIn, nest };
})();
