// Part of the DOM suite. See dom.test.js, which sets all this up and calls it.
//
// The source editor's keyboard, and the rest of its window.
//
// test/dom/editing.js calls the formatting functions directly and pastes a
// picture into the text. What nothing reached was the surface around them:
// the keys as they are actually pressed — through the modal's one keydown
// listener, which decides what is a shortcut and what belongs to the field it
// was pressed in — the tabs, a picture dropped rather than pasted, the two
// panes scrolling together, and the six buttons.
module.exports = async (ctx) => {
  const { check, waitUntil, window, doc, server, cookieHeader, get } = ctx;

  const run = (source) => window.eval(source);
  const state = () => run("window.__t.state");
  const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

  const area = () => doc.getElementById("editorInput");
  const preview = () => doc.getElementById("editorPreview");
  const nameField = () => doc.getElementById("editorFileName");

  const csrf = () => state().csrfToken;
  const made = async (name, content = `# ${name}\n`) => {
    await server.request("POST", "/api/docs",
      { fileName: name, overwrite: true, content },
      { Cookie: cookieHeader(), "X-CSRF-Token": csrf() });
  };

  const openOn = async (file) => {
    await run(`window.__t.openEditorForDocument(${JSON.stringify(file)})`);
    await waitUntil(() => state().editorOpen, 3000);
  };

  // Ctrl is pressed where a person presses it: on the element that has the
  // focus, with the event going up to the modal that listens for it.
  const ctrl = (node, key, extra = {}) => {
    const event = new window.KeyboardEvent("keydown",
      { key, ctrlKey: true, bubbles: true, cancelable: true, ...extra });
    node.dispatchEvent(event);
    return event;
  };
  const select = (from, to) => {
    area().focus();
    area().setSelectionRange(from, to);
  };
  const selected = () => area().value.slice(area().selectionStart, area().selectionEnd);

  await made("surface.md", "# Surface\n");
  await run("window.__t.refreshDocs({ preserveSearch: true })");
  await openOn("surface.md");

  console.log("=== the shortcuts, as they are pressed ===");
  {
    area().value = "plain words here";
    select(6, 11);
    check("Ctrl+B is taken off the browser", ctrl(area(), "b").defaultPrevented, true);
    check("...and wraps what was selected", area().value, "plain **words** here");

    /* Pressed again with the markers inside the selection this time, which is
     * what dragging over the bold text and pressing Ctrl+B again does. The
     * other unwrap — the markers just outside the selection — is what
     * pressing it twice without moving does, and editing.js has that one.
     */
    select(6, 15);
    check("...and unwraps them again when they are inside the selection",
      [ctrl(area(), "b").defaultPrevented, area().value], [true, "plain words here"]);

    select(6, 11);
    ctrl(area(), "i");
    check("Ctrl+I is italic", area().value, "plain *words* here");
    select(6, 13);
    ctrl(area(), "i");

    select(6, 11);
    ctrl(area(), "e");
    check("Ctrl+E is code", area().value, "plain `words` here");
    select(6, 13);
    ctrl(area(), "e");
    check("...and each of them leaves the words selected to type over",
      [area().value, selected()], ["plain words here", "words"]);

    // jsdom has no prompt, and the link shortcut is the one place the app asks
    // a question through one.
    const realPrompt = window.prompt;
    const ask = (fn) => { window.prompt = fn; };
    const asked = [];

    ask((question, value) => {
      asked.push([question, value]);
      return "https://example.com/page";
    });
    select(6, 11);
    check("Ctrl+K is taken off the browser too", ctrl(area(), "k").defaultPrevented, true);
    check("...and asks for the address", asked, [["Link address", "https://"]]);
    check("...then writes the link around what was selected",
      area().value, "plain [words](https://example.com/page) here");
    check("...with the label selected, since that is what gets retyped",
      selected(), "words");

    /* Answering nothing is cancelling. Writing `[words]()` for somebody who
     * pressed Escape would leave a broken link in the document.
     */
    area().value = "plain words here";
    select(6, 11);
    ask(() => null);
    check("...and cancelling the question writes nothing",
      [ctrl(area(), "k").defaultPrevented, area().value], [true, "plain words here"]);

    ask(() => "");
    select(6, 11);
    check("...which an empty answer is as well", area().value, "plain words here");

    // Pressed with nothing selected, the link gets words to type over rather
    // than empty brackets.
    ask(() => "https://example.com/");
    select(6, 6);
    ctrl(area(), "k");
    check("...and with nothing selected it writes something to type over",
      [area().value, selected()],
      ["plain [link text](https://example.com/)words here", "link text"]);
    area().value = "plain words here";

    ask(realPrompt);

    // A key this editor has no use for is left to the browser, or Ctrl+F and
    // Ctrl+R would stop working inside the editor.
    const other = ctrl(area(), "g");
    check("a key that is not a shortcut is left alone",
      [other.defaultPrevented, area().value], [false, "plain words here"]);
    check("...and so is one pressed with no modifier at all",
      area().dispatchEvent(new window.KeyboardEvent("keydown",
        { key: "b", bubbles: true, cancelable: true })) && area().value,
      "plain words here");
  }

  console.log("=== and where they are pressed ===");
  {
    /* Ctrl+S is bound on the modal so it saves from the filename field as
     * well, where it is at least as likely to be pressed. The formatting keys
     * are not: Ctrl+B in the name field is the browser's.
     */
    nameField().focus();
    const bold = ctrl(nameField(), "b");
    check("a formatting key outside the text is not this editor's",
      [bold.defaultPrevented, nameField().value], [false, "surface.md"]);

    check("...while Ctrl+S from the same field is",
      ctrl(nameField(), "s").defaultPrevented, true);
    await waitUntil(() => run("window.__t.isEditorDirty()") === false, 4000);

    // The listener is on a modal that stays in the page when it is closed, so
    // it has to ask whether the editor is open at all.
    run("window.__t.closeEditor()");
    const shut = ctrl(doc.getElementById("editorModal"), "s");
    check("a key pressed at a closed editor does nothing", shut.defaultPrevented, false);
    await openOn("surface.md");
  }

  console.log("=== the two tabs a narrow window collapses into ===");
  {
    const tabs = doc.getElementById("editorTabs");
    const key = (name) => {
      const event = new window.KeyboardEvent("keydown",
        { key: name, bubbles: true, cancelable: true });
      tabs.dispatchEvent(event);
      return event;
    };

    run('window.__t.selectEditorTab("write")');
    check("the right arrow moves to the other tab",
      [key("ArrowRight").defaultPrevented, state().editorTab], [true, "preview"]);
    check("...and takes the focus with it, or there is nothing to press next",
      doc.activeElement, doc.getElementById("editorTabPreview"));
    check("the left arrow moves back",
      [key("ArrowLeft").defaultPrevented, state().editorTab], [true, "write"]);
    check("...and the focus with it", doc.activeElement, doc.getElementById("editorTabWrite"));

    // Every other key belongs to the button, including the ones that press it.
    check("another key is left to the tab it was pressed on",
      [key("Enter").defaultPrevented, key("a").defaultPrevented, state().editorTab],
      [false, false, "write"]);
  }

  console.log("=== a picture dropped into the text ===");
  {
    const png = new window.File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9, 9])],
      "dropped.png", { type: "image/png" });
    const text = new window.File(["# not a picture"], "notes.md", { type: "text/markdown" });

    const drag = (type, files) => {
      const event = new window.Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { dataTransfer: { files, items: [], getData: () => "" } });
      area().dispatchEvent(event);
      return event;
    };

    area().value = "# Surface\n";
    area().setSelectionRange(area().value.length, area().value.length);

    check("a drag carrying a picture is offered a drop", drag("dragover", [png]).defaultPrevented, true);
    /* A drag carrying anything else is left to the browser, which is what
     * makes dragging a file onto the window still open it rather than
     * silently doing nothing.
     */
    check("...and one carrying anything else is not",
      drag("dragover", [text]).defaultPrevented, false);
    check("...nor is one carrying nothing", drag("dragover", []).defaultPrevented, false);

    check("dropping a picture is taken over", drag("drop", [png]).defaultPrevented, true);
    check("...and something stands in for it straight away",
      area().value.includes("![Uploading dropped.png...]()"), true);
    await waitUntil(() => !area().value.includes("Uploading"), 6000);
    const link = area().value.match(/!\[([^\]]*)\]\((\/api\/assets\/[0-9a-f]{64}\.png)\)/);
    check("...then by the picture itself, once the bytes are up", Boolean(link), true);
    check("...with the file's name as the alt text", link && link[1], "dropped");

    const before = area().value;
    check("dropping anything else is left alone",
      [drag("drop", [text]).defaultPrevented, area().value], [false, before]);
  }

  console.log("=== the panes scrolling together ===");
  {
    /* jsdom lays nothing out, so both panes measure zero and the ratio is
     * always zero. The heights are what the arithmetic is about, so they are
     * given: the preview is twice as long as the text, and halfway down one
     * has to be halfway down the other.
     */
    const sized = (node, scrollHeight, clientHeight) => {
      Object.defineProperty(node, "scrollHeight", { value: scrollHeight, configurable: true });
      Object.defineProperty(node, "clientHeight", { value: clientHeight, configurable: true });
      node.scrollTop = 0;
    };

    sized(area(), 1000, 500);
    sized(preview(), 2000, 500);

    area().scrollTop = 250;
    area().dispatchEvent(new window.Event("scroll"));
    check("halfway down the text is halfway down the preview", preview().scrollTop, 750);

    await waitUntil(() => state().editorScrollSyncLock === false, 2000);
    preview().scrollTop = 1500;
    preview().dispatchEvent(new window.Event("scroll"));
    check("...and it works the other way round", area().scrollTop, 500);

    /* The pane that is being followed must not turn round and follow back:
     * each would nudge the other a pixel at a time for as long as the lock is
     * off. The lock is what stops it, and it is released a frame later.
     */
    await waitUntil(() => state().editorScrollSyncLock === false, 2000);
    const resting = preview().scrollTop;
    area().scrollTop = 0;
    area().dispatchEvent(new window.Event("scroll"));
    const movedTo = preview().scrollTop;
    preview().dispatchEvent(new window.Event("scroll"));
    check("the pane being followed does not follow back while it is being moved",
      [resting !== movedTo, area().scrollTop], [true, 0]);
  }

  console.log("=== and the buttons ===");
  {
    const press = (id) => doc.getElementById(id)
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    area().value = "# Saved by the button\n";
    press("saveDocBtn");
    await waitUntil(() => state().editorOpen === false, 4000);
    check("the Save button writes and closes", state().editorOpen, false);

    await openOn("surface.md");
    press("closeEditorBtn");
    await waitUntil(() => state().editorOpen === false, 4000);
    check("the close button closes it when there is nothing to lose",
      [state().editorOpen, state().confirmOpen], [false, false]);

    await openOn("surface.md");
    area().value = "# typed and not saved\n";
    press("editorBackdrop");
    await waitUntil(() => state().confirmOpen, 4000);
    check("clicking away from it asks first", state().confirmOpen, true);

    // The dialog's own four buttons, each of which is somebody's answer.
    press("confirmBackdrop");
    await settle();
    check("the dialog's backdrop is Keep editing",
      [state().confirmOpen, state().editorOpen], [false, true]);

    press("closeEditorBtn");
    await waitUntil(() => state().confirmOpen, 4000);
    press("confirmCancelBtn");
    await settle();
    check("...and so is Cancel", [state().confirmOpen, state().editorOpen], [false, true]);

    press("closeEditorBtn");
    await waitUntil(() => state().confirmOpen, 4000);
    press("confirmAltBtn");
    await waitUntil(() => state().editorOpen === false, 6000);
    check("Save Changes saves it and closes", state().editorOpen, false);
    check("...having written what was in it",
      JSON.parse((await get("/api/docs/surface.md")).body).content, "# typed and not saved\n");

    await openOn("surface.md");
    area().value = "# thrown away\n";
    press("closeEditorBtn");
    await waitUntil(() => state().confirmOpen, 4000);
    press("confirmProceedBtn");
    await waitUntil(() => state().editorOpen === false, 4000);
    check("Discard Changes closes without writing",
      JSON.parse((await get("/api/docs/surface.md")).body).content, "# typed and not saved\n");
  }

  await server.request("POST", "/api/docs/surface.md/delete", { mode: "soft" },
    { Cookie: cookieHeader(), "X-CSRF-Token": csrf() });
  await run("window.__t.refreshDocs({ preserveSearch: true })");
};
