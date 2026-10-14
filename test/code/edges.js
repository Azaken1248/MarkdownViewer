/* Part of the CODE suite. See code.test.js, which loads this.
 *
 * The edges of md/code.js: what happens with no highlighter on the page, with
 * one that refuses, with a clipboard that says no, and with a caret in a block
 * that was edited out from under it.
 *
 * The suite above drives the ordinary paths with a highlighter standing in.
 * These are the ones a reader only meets when something has gone wrong, which
 * is exactly when a page that stops rendering is worst.
 */
module.exports = async (check, context) => {
  /* `Core` is markdown-core, which is what a page holds; `MdCode` is the
   * module itself, for the one thing markdown-core does not pass on.
   */
  const { window, document, Core, MdCode, fixture, putCaret, caretAt, hljsCalls } = context;

  const logged = [];
  window.console.error = (...parts) => logged.push(parts.map(String).join(" "));

  console.log("=== a page with no highlighter on it ===");
  {
    /* Nothing is fetched for a document with no code in it, and a document
     * with code in it gets the library once. Either way the page renders: a
     * code block with no colours in it is still a code block.
     */
    const delivered = [];
    window.document.head.appendChild = /** @type {any} */ ((node) => {
      delivered.push(String(node.src || node.href || ""));
      // jsdom fetches nothing, so the asset never arrives of its own accord.
      Promise.resolve().then(() => node.dispatchEvent(new window.Event("error")));
      return node;
    });

    const real = window.hljs;
    delete /** @type {any} */ (window).hljs;

    check("nothing is asked for a document with no code in it",
      (await Core.highlightCodeBlocks(fixture("<p>words</p>")), delivered.length), 0);
    check("...and nothing at all is asked of nothing",
      (await Core.highlightCodeBlocks(null), delivered.length), 0);

    const waiting = fixture("<pre><code>x = 1</code></pre>");
    await Core.highlightCodeBlocks(waiting);
    check("a document with code in it asks for the highlighter",
      delivered.filter((where) => where.includes("highlight")).length, 1);
    // The library never arriving is a page with plain code blocks on it, not a
    // page that stopped halfway down.
    check("...and renders the block plainly when it never arrives",
      [waiting.querySelector("code").textContent, waiting.querySelectorAll(".hljs").length],
      ["x = 1", 0]);

    // The live highlighter is the editor's, and it answers the same way.
    check("and nothing is painted live without one",
      Core.liveHighlightCode(waiting.querySelector("code"), "python"), false);

    // And one that does arrive paints what was waiting for it.
    window.document.head.appendChild = /** @type {any} */ ((node) => {
      Promise.resolve().then(() => {
        Object.assign(window, { hljs: real });
        node.dispatchEvent(new window.Event("load"));
      });
      return node;
    });

    const arrives = fixture('<pre><code class="language-python">x = 1</code></pre>');
    await Core.highlightCodeBlocks(arrives);
    check("...and a highlighter that does arrive paints what was waiting",
      arrives.querySelector("code").classList.contains("hljs"), true);

    /* And a block is painted once. Two passes over one root is not exotic —
     * the renderer makes one and the editor's preview makes another — and
     * re-colouring a document's worth of blocks on each is the cost this
     * avoids.
     */
    hljsCalls.highlight = 0;
    await Core.highlightCodeBlocks(arrives);
    check("...and is not painted again on the next pass", hljsCalls.highlight, 0);

    Object.assign(window, { hljs: real });
  }

  console.log("=== and one that refuses ===");
  {
    const real = window.hljs;

    Object.assign(window, {
      hljs: {
        getLanguage: () => ({ name: "python" }),
        highlight: () => {
          throw new Error("the highlighter fell over");
        },
        highlightAuto: () => {
          throw new Error("the highlighter fell over");
        }
      }
    });

    logged.splice(0);
    const root = fixture('<pre><code class="language-python">x = 1</code></pre>');
    await Core.highlightCodeBlocks(root);
    check("a highlighter that falls over leaves the code readable",
      root.querySelector("code").textContent, "x = 1");
    check("...and says so rather than silently",
      logged.some((line) => line.includes("Code highlighting failed")), true);

    // Guessing is a separate call and fails separately; no guess is no
    // colours rather than no block.
    logged.splice(0);
    check("a guess that falls over is simply no guess", MdCode.detectCodeLanguage("x = 1"), "");
    check("...and is written down", logged.some((line) => line.includes("Language detection")), true);

    // The live path has its own try, because it runs on every keystroke and a
    // throw there would take the editor with it.
    logged.splice(0);
    const typed = fixture('<pre><code class="language-python">def f(): pass</code></pre>')
      .querySelector("code");
    check("live highlighting that falls over stops painting",
      Core.liveHighlightCode(typed, "python"), false);
    check("...and says so", logged.some((line) => line.includes("Live highlighting failed")), true);

    Object.assign(window, { hljs: real });
  }

  console.log("=== a guess with no name to give it ===");
  {
    const real = window.hljs;
    Object.assign(window, {
      hljs: {
        getLanguage: () => null,
        highlight: real.highlight,
        // A highlighter that found some structure but will not name it, which
        // is what an unrecognised dialect looks like.
        highlightAuto: (source) => ({ value: source, language: "", relevance: 0 })
      }
    });

    const root = fixture("<pre><code>&lt;&lt;unknown&gt;&gt;</code></pre>");
    await Core.highlightCodeBlocks(root);
    const code = root.querySelector("code");
    check("a block whose language could not be named is still highlighted",
      code.classList.contains("hljs"), true);
    check("...and is not labelled with a language it was not told",
      [...code.classList].some((one) => one.startsWith("language-")), false);

    /* A guess that does name one labels the block with it, which is what the
     * stylesheet and the copy button hang off.
     */
    Object.assign(window, {
      hljs: { ...real, highlightAuto: (source) => ({ value: source, language: "ruby", relevance: 9 }) }
    });
    const guessed = fixture("<pre><code>puts 1</code></pre>");
    await Core.highlightCodeBlocks(guessed);
    check("...while a guess that does name one says which",
      guessed.querySelector("code").classList.contains("language-ruby"), true);
    Object.assign(window, { hljs: real });
  }

  console.log("=== the code that is not code ===");
  {
    /* A Mermaid fallback is a <pre><code> holding the source of a diagram that
     * would not parse. Highlighting it, or offering to copy it, is offering
     * the reader the wrong thing about the wrong thing.
     */
    const root = fixture('<div class="mermaid-block">'
      + '<pre class="mermaid-fallback-code"><code>graph ???</code></pre></div>');
    await Core.decorateCodeBlocks(root);
    check("a diagram's own fallback source is not highlighted",
      root.querySelector("code").classList.contains("hljs"), false);
    check("...and is not given a copy button", root.querySelectorAll(".code-copy").length, 0);

    // Code being typed into is already selectable, and in the visual editor the
    // corner of the block belongs to the language field.
    const editing = fixture('<pre><code contenteditable="true">x = 1</code></pre>');
    Core.addCopyButtons(editing);
    check("code being typed into is not given one either",
      editing.querySelectorAll(".code-copy").length, 0);

    // A fence opened and not yet typed into, which the renderer still sees.
    const bare = fixture("<pre><code></code></pre>");
    await Core.highlightCodeBlocks(bare);
    check("a code block with nothing in it is highlighted as nothing",
      bare.querySelector("code").textContent, "");

    check("and nothing at all is not given one", Core.addCopyButtons(null), undefined);
    check("...nor is something that is not a document",
      Core.addCopyButtons(/** @type {any} */ ("a string")), undefined);
  }

  console.log("=== a press that is not on a copy button ===");
  {
    /* One listener on the document rather than one per block, so the page does
     * not gain a listener for every code block in a long document — which
     * means every click on the page arrives here and most of them are not
     * this.
     */
    const root = fixture("<p>words</p><div class=\"code-block\">"
      + "<button class=\"code-copy\"></button></div>");
    Core.addCopyButtons(root);

    const press = (node) => node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("a press on the prose is not a copy", (press(root.firstElementChild), true), true);

    // A copy button with no code beside it is a block that was taken off the
    // page between the render and the press.
    const orphan = /** @type {HTMLElement} */ (root.querySelector(".code-copy"));
    check("...and a copy button with no code beside it copies nothing",
      (press(orphan), orphan.classList.contains("is-copied")), false);
  }

  console.log("=== and what the button says after it ===");
  {
    const timers = [];
    const realTimeout = window.setTimeout;
    Object.assign(window, {
      setTimeout: (run, ms) => {
        timers.push({ run, ms });
        return timers.length;
      }
    });

    const root = fixture("<pre><code>x = 1</code></pre>");
    Core.addCopyButtons(root);
    const button = /** @type {HTMLElement} */ (root.querySelector(".code-copy"));
    Object.defineProperties(window, {
      isSecureContext: { value: true, configurable: true },
      navigator: { value: { clipboard: { writeText: async () => {} } }, configurable: true }
    });

    button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    check("the button says it worked", button.classList.contains("is-copied"), true);
    check("...and says so to anybody not looking at it",
      button.getAttribute("aria-label"), "Copied");

    /* And then stops saying it. A button left saying "Copied" is a button that
     * is lying about the next thing somebody does.
     */
    timers[timers.length - 1].run();
    check("...and then goes back to what it was",
      [button.className, button.getAttribute("aria-label"), button.dataset.copyFlash],
      ["code-copy", "Copy this code", undefined]);

    Object.assign(window, { setTimeout: realTimeout });
  }

  console.log("=== a clipboard that says no ===");
  {
    const asked = [];
    const secure = (writeText) => Object.defineProperties(window, {
      isSecureContext: { value: true, configurable: true },
      navigator: { value: { clipboard: { writeText } }, configurable: true }
    });

    secure(async (text) => {
      asked.push(text);
    });

    await Core.copyText("take this");
    check("a secure page uses the clipboard it is given", asked, ["take this"]);
    check("...and nothing becomes an empty string rather than the word undefined",
      (await Core.copyText(null), asked[1]), "");

    /* Permission can still be refused on a secure origin, and the older path is
     * not subject to the same policy — so a refusal falls back to it rather
     * than failing.
     */
    let allowed = true;
    document.execCommand = /** @type {any} */ (() => allowed);
    secure(async () => {
      throw new Error("permission denied");
    });

    /* And the selection the reader had is put back. The older path works by
     * selecting a textarea, which takes the selection away from whatever they
     * had highlighted — and leaving it taken is the page losing their place.
     */
    const prose = fixture("<p>something they had selected</p>");
    putCaret(prose.firstElementChild, 4, 14);
    const had = caretAt(prose.firstElementChild);

    let refused = "";
    try {
      await Core.copyText("x");
    } catch (error) {
      refused = error.message;
    }
    check("a refusal on a secure page falls back to the older way", refused, "");
    check("...and gives the reader their selection back",
      caretAt(prose.firstElementChild), had);

    allowed = false;
    try {
      await Core.copyText("x");
    } catch (error) {
      refused = error.message;
    }
    check("...and when that is refused too, the caller is told",
      refused, "Copying was refused by the browser.");

    // An insecure page — or an old browser — never had the clipboard API.
    Object.defineProperties(window, {
      isSecureContext: { value: false, configurable: true },
      navigator: { value: {}, configurable: true }
    });

    allowed = true;
    check("a page with no clipboard API uses the older way",
      (await Core.copyText("x"), true), true);
    allowed = false;
    refused = "";
    try {
      await Core.copyText("x");
    } catch (error) {
      refused = error.message;
    }
    check("...and says so when that is refused", refused, "Copying was refused by the browser.");
  }

  console.log("=== and a caret in a block that was edited out from under it ===");
  {
    const root = fixture('<pre><code class="language-javascript">const a = 1;</code></pre>');
    const code = /** @type {HTMLElement} */ (root.querySelector("code"));

    Core.liveHighlightCode(code, "javascript");
    putCaret(code, 6, 6);
    check("the caret is read back as an offset into the text",
      Core.selectionOffsetsWithin(code), { start: 6, end: 6 });

    // Nothing selected is no caret to keep, which is the state the editor is
    // in before anybody has clicked into a block.
    document.getSelection().removeAllRanges();
    check("...and with nothing selected there is no caret to keep",
      Core.selectionOffsetsWithin(code), null);

    /* Put back past the end of the text, which is what an edit that shortened
     * the block leaves behind. The end of it is the only honest place left.
     */
    Core.placeSelectionWithin(code, 500, 500);
    check("a caret past the end of the block lands at the end of it",
      caretAt(code).start, code.textContent.length);

    // A start inside the text and an end past it: the selection runs to the
    // end of the block rather than nowhere.
    Core.placeSelectionWithin(code, 3, 500);
    check("...and a selection that overruns stops at the end",
      caretAt(code).start + caretAt(code).length, code.textContent.length);

    // Nothing to put a caret in is nothing to do, not a throw. An element in a
    // document fragment has no selection to speak of.
    const loose = window.document.createElement("code");
    Object.defineProperty(loose, "ownerDocument", { value: null, configurable: true });
    check("an element with no document to select in is left alone",
      Core.placeSelectionWithin(loose, 0, 0), undefined);

    // Too much of it to paint on every keystroke: a minified bundle pasted
    // into a fence is a block that would be re-highlighted character by
    // character.
    const huge = fixture(`<pre><code>${"x".repeat(200000)}</code></pre>`).querySelector("code");
    check("a block too big to paint live is not painted live",
      Core.liveHighlightCode(huge, "javascript"), false);
    check("...and neither is an empty one",
      Core.liveHighlightCode(fixture("<pre><code>   </code></pre>").querySelector("code"),
        "javascript"), false);
    // A fence with nothing in it at all, which is what one looks like the
    // moment it is opened.
    check("...nor one with nothing in it at all",
      Core.liveHighlightCode(fixture("<pre><code></code></pre>").querySelector("code"),
        "javascript"), false);
    check("...nor nothing at all", Core.liveHighlightCode(null, "javascript"), false);
  }
};
