/* The diagram editor, on a page of its own.
 *
 * A diagram is the one thing in a document that is not really text. Editing it
 * in a strip inside the document meant a canvas the height of a paragraph, and
 * every feature after the first few had nowhere to go. So it gets the window.
 *
 * Two things can be behind this page and it treats them the same way:
 *
 *   /diagram/doc/<path>#<n>-<hash>   one mermaid fence inside a document
 *   /diagram/file/<path>             a .mmd file, which is all diagram
 *
 * The dangerous case is the first one with unsaved work behind it. Reading the
 * document from disk on the way in would silently throw away whatever the
 * editor had not saved yet, so the document editor leaves its current text in
 * sessionStorage and this page prefers that over the file. Saving puts it back
 * there, still unsaved, with the diagram changed — and going back finds the
 * document exactly as it was left, plus the new picture.
 *
 * Opened directly, with nothing stashed, it reads and writes the file.
 */
(function () {
  "use strict";

  const STASH_PREFIX = "azadocs:diagram:";
  const AUTOSAVE_DELAY = 1500;
  const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

  const state = {
    kind: "",
    file: "",
    address: "",
    // The whole markdown document, for a fence; the diagram itself, for a file.
    document: "",
    // Where the document came from, which is where it goes back to.
    stashed: false,
    csrfToken: "",
    editor: null,
    source: "",
    saved: "",
    saving: false,
    autosave: 0
  };

  const elements = {};

  // Small setters, so that what a step of an async flow changed is one named
  // thing rather than a scatter of assignments after an await.
  function useSession(payload) {
    state.csrfToken = payload?.csrfToken || "";
  }

  function useDocument(text, fromStash) {
    state.document = text;
    state.stashed = fromStash;
  }

  function markSaved(content, source) {
    state.document = content;
    state.saved = source;
  }

  function markSaving(saving) {
    state.saving = saving;
  }

  function moveAddressTo(address) {
    state.address = address;
  }

  /* --- Talking to the server ------------------------------------------- */

  async function requestJson(url, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const headers = { ...(options.headers || {}) };

    if (typeof options.body === "string") {
      headers["Content-Type"] = "application/json";
    }

    if (UNSAFE_METHODS.has(method) && state.csrfToken) {
      headers["X-CSRF-Token"] = state.csrfToken;
    }

    const response = await fetch(url, { ...options, headers, credentials: "same-origin" });
    let payload = null;

    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      throw new Error(payload?.error || `Request failed (${response.status})`);
    }

    return payload;
  }

  function docUrl(file) {
    return String(file).split("/").map(encodeURIComponent).join("/");
  }

  /* --- Where we came from ----------------------------------------------- */

  /* The address, read as what it names.
   *
   * Everything after /diagram/doc/ or /diagram/file/ is the path, decoded the
   * same way the app decodes a document address, and the fragment is which
   * diagram inside it.
   */
  function readAddress(pathname, hash) {
    const match = /^\/diagram\/(doc|file)\/(.+)$/.exec(pathname);
    if (!match) {
      return null;
    }

    let file = "";
    try {
      file = decodeURIComponent(match[2]);
    } catch {
      return null;
    }

    return {
      kind: match[1],
      file,
      address: String(hash || "").replace(/^#/, "")
    };
  }

  function stashKey(file) {
    return `${STASH_PREFIX}${file}`;
  }

  function readStash(file) {
    try {
      return window.sessionStorage.getItem(stashKey(file));
    } catch {
      // Private browsing, or a storage quota. Falling back to the file is the
      // right answer; losing the page is not.
      return null;
    }
  }

  function writeStash(file, text) {
    try {
      window.sessionStorage.setItem(stashKey(file), text);
      return true;
    } catch {
      return false;
    }
  }

  /* --- The page --------------------------------------------------------- */

  function say(message, tone) {
    elements.status.textContent = message || "";
    elements.status.className = `diagram-page-status${tone ? ` is-${tone}` : ""}`;
  }

  function fail(heading, detail) {
    elements.canvas.innerHTML = "";
    const box = document.createElement("div");
    box.className = "diagram-page-empty";
    const title = document.createElement("h2");
    title.textContent = heading;
    const text = document.createElement("p");
    text.textContent = detail;
    box.append(title, text);
    elements.canvas.append(box);
    elements.save.disabled = true;
  }

  const dirty = () => state.source !== state.saved;

  function syncSaveButton() {
    elements.save.disabled = state.saving || !dirty();
  }

  /* The document as it is right now, not as it was when this page opened.
   *
   * A diagram page can be open for a long time, and the document behind it can
   * change while it is: another tab, another device, the document editor in the
   * next window. Saving the copy this page started with would put every one of
   * those changes back the way they were, which is a worse failure than any
   * this page could have on its own.
   */
  async function currentDocument() {
    if (state.stashed) {
      const held = readStash(state.file);
      return held === null ? state.document : held;
    }

    if (state.kind === "file") {
      return state.document;
    }

    const payload = await requestJson(`/api/docs/${docUrl(state.file)}`, { cache: "no-store" });
    return String(payload?.content || "");
  }

  /* That document with this diagram in it, or null.
   *
   * Null means the fence this page was opened on is no longer there — edited
   * into something else or deleted outright while the editor was open. The only
   * safe thing left is to say so: writing the diagram back where the block used
   * to be would put it over whatever is there now.
   */
  function documentWith(document_, source) {
    if (state.kind === "file") {
      return `${source.replace(/\n$/, "")}\n`;
    }

    return VisualEditor.replaceDiagram(document_, state.address, source);
  }

  async function save() {
    if (state.saving || !dirty()) {
      return;
    }

    markSaving(true);
    syncSaveButton();
    say("Saving…");

    try {
      const source = state.source;
      const document_ = await currentDocument();

      // Found before the block is rewritten, because rewriting it is what makes
      // the address that found it stop matching.
      const target = state.kind === "doc"
        ? VisualEditor.findDiagram(document_, state.address)
        : null;

      const content = documentWith(document_, source);
      if (content === null) {
        say("The block this diagram came from is no longer in the document. Copy the source before leaving.", "bad");
        return;
      }

      // A document that came out of the stash goes back into it: it was already
      // unsaved before this page opened, and writing it to disk here would save
      // edits the person who made them has not decided to save.
      if (state.stashed) {
        if (!writeStash(state.file, content)) {
          throw new Error("This browser will not hold the document while you edit the diagram.");
        }
      } else {
        await requestJson(`/api/docs/${docUrl(state.file)}`, {
          method: "PUT",
          body: JSON.stringify({ content })
        });
      }

      markSaved(content, source);

      /* The address is half an index and half a hash of what is in the block,
       * so saving the block is what makes it stop matching. It has to be taken
       * again from what was actually written, by the block it was written to —
       * looking it up by the address it already has is looking for a body that
       * has just been replaced, which finds nothing, which left the address
       * stale and made the *second* save say the block was gone.
       */
      if (target) {
        const now = VisualEditor.diagramFences(content)
          .find((one) => one.index === target.index);

        if (now) {
          moveAddressTo(VisualEditor.diagramAddress(now));
          window.history.replaceState(null, "", `${window.location.pathname}#${state.address}`);
        }
      }

      say(state.stashed ? "Saved to the document you are editing" : "Saved", "good");
    } catch (error) {
      say(error.message || "Could not save", "bad");
    } finally {
      markSaving(false);
      syncSaveButton();
    }
  }

  function autosaveSoon() {
    window.clearTimeout(state.autosave);
    state.autosave = window.setTimeout(() => {
      void save();
    }, AUTOSAVE_DELAY);
  }

  // Back to the document this came out of, which for a .mmd file is the file
  // itself. The stash is left where it is: the document editor picks it up.
  function goBack() {
    window.location.href = `/${docUrl(state.file)}`;
  }

  /* --- Starting up ------------------------------------------------------- */

  function mountEditor(source, title) {
    state.source = source;
    state.saved = source;

    const editor = DiagramEditor.mount(elements.canvas, {
      source,
      title,
      // The page is a window onto the diagram rather than a strip showing it:
      // pan, zoom, and no end to the paper in any direction.
      viewport: true,
      onChange: (body) => {
        state.source = body;
        syncSaveButton();
        say("");
        autosaveSoon();
      }
    });

    if (!editor) {
      fail("This diagram cannot be opened here yet",
        "The editor draws every diagram it opens, and it cannot draw this one. It is still a valid diagram — open it as source in the document.");
      return;
    }

    state.editor = editor;
    syncSaveButton();
  }

  async function start() {
    elements.canvas = document.getElementById("diagramCanvas");
    elements.status = document.getElementById("diagramStatus");
    elements.save = document.getElementById("diagramSave");
    elements.back = document.getElementById("diagramBack");
    elements.title = document.getElementById("diagramTitle");
    elements.theme = document.getElementById("diagramTheme");

    elements.save.addEventListener("click", () => void save());
    elements.back.addEventListener("click", goBack);

    /* The theme switch. The same three-state cycle as the library's, because it
     * is the same cycle — it lives in theme-boot.js, which every page with a
     * theme already loads, so the two cannot drift apart.
     *
     * The canvas draws in the theme's own colours through CSS custom
     * properties, so nothing here has to be redrawn: the paper, the boxes and
     * the arrows all follow immediately.
     */
    ThemeSwitch.dress(elements.theme);
    elements.theme?.addEventListener("click", () => {
      ThemeSwitch.apply(ThemeSwitch.META[ThemeSwitch.preference()].next);
      ThemeSwitch.dress(elements.theme);
    });

    // A tab closing with an unsaved diagram in it gets the browser's own
    // warning. Autosave usually means there is nothing to warn about, which is
    // exactly why the warning is worth keeping for the times there is.
    window.addEventListener("beforeunload", (event) => {
      if (dirty()) {
        event.preventDefault();
        event.returnValue = "";
      }
    });

    const where = readAddress(window.location.pathname, window.location.hash);
    if (!where) {
      fail("Nothing to edit", "This address does not name a diagram.");
      return;
    }

    Object.assign(state, where);
    elements.title.textContent = state.file;
    document.title = `${state.file} — diagram`;

    try {
      useSession(await requestJson("/api/session", { cache: "no-store" }));
    } catch {
      // A signed-out reader can still be handed a document by the API if the
      // library allows public reads, and finds out on save that they cannot
      // write. Failing here would refuse them a diagram they are allowed to see.
      useSession(null);
    }

    const stashed = readStash(state.file);
    if (stashed !== null) {
      useDocument(stashed, true);
    } else {
      try {
        const payload = await requestJson(`/api/docs/${docUrl(state.file)}`, { cache: "no-store" });
        useDocument(String(payload?.content || ""), false);
      } catch (error) {
        fail("That document is not here", error.message || "It may have been moved or deleted.");
        return;
      }
    }

    if (state.kind === "file") {
      mountEditor(state.document.replace(/\n$/, ""), state.file.split("/").pop());
      return;
    }

    const found = VisualEditor.findDiagram(state.document, state.address);
    if (!found) {
      fail("That diagram is not in this document",
        "The block it was in has been changed or removed since this page was opened.");
      return;
    }

    // The block may have moved since the link was made; the address follows it.
    state.address = VisualEditor.diagramAddress(found);
    mountEditor(found.body, state.file.split("/").pop());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void start());
  } else {
    void start();
  }
})();
