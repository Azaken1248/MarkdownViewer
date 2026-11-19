/* Ticking a box on somebody else's document.
 *
 * marked renders task lists disabled, which is the right default for a
 * renderer and the wrong one for a checklist somebody is working through. The
 * app makes its own boxes live and writes each click straight to the file; a
 * share link cannot do that, because the document belongs to whoever sent it.
 *
 * So the boxes are live here and the ticks stay in this browser — the same
 * rule the ink follows, for the same reason. Nothing is sent anywhere, and the
 * person who shared the document cannot see them. A reader working through a
 * checklist gets to keep their place; the document is untouched.
 *
 * Keyed by share token, so two shared documents open in the same browser keep
 * their own ticks.
 */

/* exported ShareTicks */
var ShareTicks = (function () {
  "use strict";

  const PREFIX = "mdviewer.ticks.";
  const VERSION = 1;

  const keyFor = (token) => `${PREFIX}${token}`;

  const boxesIn = (content) =>
    [...content.querySelectorAll('li input[type="checkbox"]')];

  /* What the list said when these ticks were made.
   *
   * The owner can edit the document while somebody is reading it, and a tick
   * is only a number — the third box. If the list has changed underneath, the
   * third box is a different line, so remembered ticks would be put against
   * the wrong jobs. Cheaper than storing the text and enough to notice: the
   * count, and a hash of the words beside each box.
   */
  function fingerprint(boxes) {
    /* The words *and* what the document itself says about each one. Ticks
     * are remembered as "which boxes are on", so if the owner unticks a line
     * while somebody is reading, a remembered tick would quietly put it back
     * — which is the document being misreported rather than annotated.
     */
    const words = boxes
      .map((box) => `${box.checked ? 1 : 0}:${(box.closest("li")?.textContent || "").trim()}`)
      .join("\u0000");

    // FNV-1a, which is a few lines and good enough to tell one list from
    // another. Nothing here is a security question.
    let hash = 0x811c9dc5;
    for (let at = 0; at < words.length; at += 1) {
      hash ^= words.charCodeAt(at);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }

    return `${boxes.length}:${hash.toString(16)}`;
  }

  /* Storage can refuse: private browsing, a full quota, a browser with it
   * switched off. None of that is worth an error on a page somebody is only
   * reading, so a refusal means the ticks are not kept — the boxes still
   * work for as long as the page is open.
   */
  function read(token) {
    try {
      const raw = window.localStorage.getItem(keyFor(token));
      const saved = raw ? JSON.parse(raw) : null;
      return saved && saved.v === VERSION && Array.isArray(saved.on) ? saved : null;
    } catch {
      return null;
    }
  }

  function write(token, body) {
    try {
      window.localStorage.setItem(keyFor(token), JSON.stringify(body));
    } catch {
      // Nothing to do and nothing worth saying.
    }
  }

  function forget(token) {
    try {
      window.localStorage.removeItem(keyFor(token));
    } catch {
      // As above.
    }
  }

  function create({ content, token }) {
    /* Live, whatever the renderer thought.
     *
     * The attribute is removed rather than the element replaced, so the box
     * the reader is about to click is the box that was already there — and
     * anything else on the page holding a reference to it still has one.
     */
    function enable(boxes) {
      for (const box of boxes) {
        box.disabled = false;
        box.removeAttribute("disabled");
      }
    }

    function save(boxes, asWritten) {
      const on = boxes
        .map((box, index) => (box.checked ? index : -1))
        .filter((index) => index >= 0);

      if (on.length === 0) {
        // Nothing ticked is the document as it was written, which needs no
        // record — and leaves nothing behind for a reader who unticks.
        forget(token);
        return;
      }

      write(token, { v: VERSION, of: asWritten, on });
    }

    function restore(boxes, asWritten) {
      const saved = read(token);
      if (!saved) {
        return;
      }

      // A list that has changed since is a list these ticks are not about.
      if (saved.of !== asWritten) {
        forget(token);
        return;
      }

      for (const index of saved.on) {
        const box = boxes[index];
        if (box) {
          box.checked = true;
        }
      }
    }

    /* Called once the document is on the page.
     *
     * The ticks are restored before the boxes are made live, so the restore
     * cannot be read as somebody ticking them — and the listener is on the
     * list rather than on each box, since the boxes are not replaced.
     */
    function bind() {
      const boxes = boxesIn(content);
      if (boxes.length === 0) {
        return 0;
      }

      /* Taken before anything is restored: this is the list as the document
       * wrote it, which is what the ticks are remembered against. Measuring
       * it later would measure the reader's own ticks and match anything.
       */
      const asWritten = fingerprint(boxes);

      restore(boxes, asWritten);
      enable(boxes);

      content.addEventListener("change", (event) => {
        const box = /** @type {HTMLInputElement} */ (event.target);
        if (box instanceof window.HTMLInputElement && box.type === "checkbox") {
          save(boxesIn(content), asWritten);
        }
      });

      return boxes.length;
    }

    return { bind, count: () => boxesIn(content).length };
  }

  return { create };
})();
