/* Ticking a box on somebody else's document.
 *
 * marked renders task lists disabled, which is the right default for a
 * renderer and the wrong one for a checklist somebody is working through. The
 * app makes its own boxes live and writes each click straight to the file; a
 * share link cannot do that, because the document belongs to whoever sent it.
 *
 * So a reader's ticks are a layer of their own, over the document rather than
 * in it. They are kept in this browser, under the share token, and they are
 * never sent anywhere — the person who shared the document cannot see them,
 * and two shared documents open in one browser keep their own.
 *
 * The layer is what the *reader* chose and nothing else. The document's own
 * ticks are not stored, because they are not the reader's and they are not
 * this page's business to remember: the owner can tick, untick, add and
 * remove lines, and what the reader did to the lines they touched is still
 * what the reader did. The two have nothing to do with each other, which is
 * the whole point of the layer being a layer.
 *
 * Which means a reader's choice is remembered against the words beside the
 * box rather than against its position. A line that moves takes the tick with
 * it; a line that is deleted takes it away.
 */

/* exported ShareTicks */
var ShareTicks = (function () {
  "use strict";

  const PREFIX = "mdviewer.ticks.";

  /* Version 2. Version 1 remembered which boxes were on — the document's own
   * among them — which made the owner unticking a line something a reader's
   * copy would quietly undo. A v1 record is not readable as a v2 one and is
   * left where it is rather than guessed at.
   */
  const VERSION = 2;

  const keyFor = (token) => `${PREFIX}${token}`;

  const boxesIn = (content) =>
    [...content.querySelectorAll('li input[type="checkbox"]')];

  const wordsBeside = (box) => (box.closest("li")?.textContent || "").trim();

  /* A name for each box that survives the document being edited around it.
   *
   * The words, and which of the boxes with those words it is — a list can
   * legitimately say "review" twice, and the second one is not the first.
   */
  function namesFor(boxes) {
    const seen = new Map();

    return boxes.map((box) => {
      const words = wordsBeside(box);
      const nth = seen.get(words) || 0;
      seen.set(words, nth + 1);
      return `${nth}:${words}`;
    });
  }

  /* Storage can refuse: private browsing, a full quota, a browser with it
   * switched off. None of that is worth an error on a page somebody is only
   * reading, so a refusal means the ticks are not kept — the boxes still work
   * for as long as the page is open.
   */
  function read(token) {
    try {
      const raw = window.localStorage.getItem(keyFor(token));
      const saved = raw ? JSON.parse(raw) : null;
      return saved && saved.v === VERSION && saved.mine && typeof saved.mine === "object"
        ? saved.mine
        : null;
    } catch {
      return null;
    }
  }

  function write(token, mine) {
    try {
      if (Object.keys(mine).length === 0) {
        // Nothing of the reader's own left to remember.
        window.localStorage.removeItem(keyFor(token));
        return;
      }

      window.localStorage.setItem(keyFor(token), JSON.stringify({ v: VERSION, mine }));
    } catch {
      // Nothing to do and nothing worth saying.
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

    function bind() {
      const boxes = boxesIn(content);
      if (boxes.length === 0) {
        return 0;
      }

      const names = namesFor(boxes);

      /* What the document says, before the reader's layer goes over it. Kept
       * so a reader can put a box back to what the document said, and have
       * that stop being a choice of theirs rather than become the opposite
       * one.
       */
      const asWritten = new Map(names.map((name, index) => [name, boxes[index].checked]));

      const mine = read(token) || {};

      // Only the names still in the document: a line that has gone takes the
      // reader's choice about it with it, rather than sitting in storage for
      // ever against words nobody can see.
      const kept = {};
      for (const name of names) {
        if (Object.prototype.hasOwnProperty.call(mine, name)) {
          kept[name] = Boolean(mine[name]);
        }
      }

      for (let index = 0; index < boxes.length; index += 1) {
        const name = names[index];
        if (Object.prototype.hasOwnProperty.call(kept, name)) {
          boxes[index].checked = kept[name];
        }
      }

      enable(boxes);

      content.addEventListener("change", (event) => {
        const box = /** @type {HTMLInputElement} */ (event.target);
        if (!(box instanceof window.HTMLInputElement) || box.type !== "checkbox") {
          return;
        }

        const at = boxes.indexOf(box);
        if (at === -1) {
          return;
        }

        const name = names[at];
        if (box.checked === asWritten.get(name)) {
          // Back to what the document says, which is not a choice to keep.
          delete kept[name];
        } else {
          kept[name] = box.checked;
        }

        write(token, kept);
      });

      return boxes.length;
    }

    return { bind, count: () => boxesIn(content).length };
  }

  return { create };
})();
