// Part of the diagram-page suite. See diagram-page.test.js, which sets all this
// up and calls it.
//
// Everything you can do to what is under the pointer: colours, words on the
// paper, lines, and icons.
//
// Everything it needs is handed to it: the suite's own check(), the helpers
// that boot a page and drag a box, and the fixtures. Split out of one file only
// because that file had grown well past a thousand lines.
module.exports = async (ctx) => {
  const {
    check, server, cookie, origin, settle, openPage, saveAndWait, waitFor, csrfFor,
    dragBox
  } = ctx;

  console.log("=== everything you can do to what is under the pointer ===");
  {
    await server.request("POST", "/api/docs",
      { fileName: "menu.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 80x40",
        "    %% @ B 300,100 80x40",
        "    A[One]",
        "    B[Two]",
        "    A --> B"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/menu.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const menu = () => canvas.querySelector(".ve-diagram-menu");
    // The library's own menu markup: an icon, the label in a span, the
    // keystroke in a kbd. Read the span, which is the label and nothing else.
    const labels = () => [...canvas.querySelectorAll(".ve-diagram-menu .context-item")]
      .map((one) => one.querySelector("span").textContent.trim());
    const clickItem = (text) => [...canvas.querySelectorAll(".ve-diagram-menu .context-item")]
      .find((one) => one.querySelector("span").textContent.trim() === text)
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const boxes = () => [...canvas.querySelectorAll(".dd-node")].map((one) => one.getAttribute("data-id"));
    const ringed = () => canvas.querySelectorAll(".dd-ring").length;

    const rightClick = (target) => {
      const event = new window.MouseEvent("contextmenu",
        { clientX: 300, clientY: 300, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event;
    };

    check("nothing is open to begin with", Boolean(menu()), false);

    const stopped = rightClick(canvas.querySelector('.dd-node[data-id="A"]'));
    check("right-clicking a box opens a list of what can be done to it",
      Boolean(menu()), true);
    // Otherwise the browser's own menu covers ours.
    check("...instead of the browser's own", stopped.defaultPrevented, true);
    check("...about the box, so it holds it", ringed(), 1);
    check("...offering what a box can do",
      ["Rename box", "Duplicate box", "Copy box", "Delete box"]
        .every((one) => labels().includes(one)), true);
    check("...and saying which keys do the same",
      [...canvas.querySelectorAll(".ve-diagram-menu kbd")].map((one) => one.textContent)
        .includes("Ctrl+D"), true);

    /* It is the library's menu, not one that looks nearly like it: the same
     * markup the file tree opens, so the same stylesheet dresses both and they
     * cannot drift apart.
     */
    check("...in the same menu the rest of the app opens",
      menu().classList.contains("context-menu"), true);
    check("...with an icon on every item, as that menu has",
      [...canvas.querySelectorAll(".ve-diagram-menu .context-item")]
        .every((one) => Boolean(one.querySelector("i.ph"))), true);
    check("...and a delete that looks like one",
      [...canvas.querySelectorAll(".ve-diagram-menu .context-item.danger")]
        .map((one) => one.querySelector("span").textContent), ["Delete box"]);

    /* Copy leaves the paper exactly as it was, so if the list has gone it is
     * because choosing put it away — and not because a redraw swept it off. */
    clickItem("Copy box");
    check("choosing something puts the list away", Boolean(menu()), false);

    rightClick(canvas.querySelector('.dd-node[data-id="A"]'));
    clickItem("Duplicate box");
    check("choosing something does it", boxes().length, 3);
    check("...and the list is gone after that too", Boolean(menu()), false);

    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));

    /* --- what is offered depends on what was clicked ------------------------ */

    rightClick(canvas.querySelector(".dd-edge"));
    check("right-clicking an arrow is about the arrow",
      labels().includes("Rename arrow") && labels().includes("Delete arrow"), true);
    check("...and does not offer what only a box can do",
      labels().includes("Rename box"), false);

    clickItem("Reverse arrow");
    await saveAndWait(page);
    const turned = (await server.request("GET", "/api/docs/menu.mmd", undefined, { Cookie: cookie })).body.content;
    check("an arrow can be turned round", turned.includes("B --> A"), true);

    rightClick(canvas);
    check("right-clicking the paper is about the diagram",
      labels().includes("Select all boxes") && labels().includes("Copy diagram as Mermaid"), true);
    check("...and offers nothing that needs a box",
      labels().some((one) => one.startsWith("Duplicate")), false);

    clickItem("Select all boxes");
    check("...and select all from it selects all", ringed(), 2);

    // With several held, the list speaks about all of them.
    rightClick(canvas.querySelector('.dd-node[data-id="A"]'));
    check("with a handful held, the list says how many it is about",
      labels().includes("Delete 2 boxes"), true);
    check("...and drops what only makes sense for one", labels().includes("Rename box"), false);

    /* A rule divides two groups. One at either end, or two together, is what is
     * left behind when the items that do not apply to a handful are dropped —
     * and it reads as a group with nothing in it.
     */
    check("...and leaves no rule standing on its own",
      [...menu().children].some((one, at, all) => one.tagName === "HR"
        && (at === 0 || at === all.length - 1 || all[at - 1].tagName === "HR")), false);

    clickItem("Delete 2 boxes");
    check("...and does it to all of them", boxes().length, 0);
    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));

    /* --- putting it away --------------------------------------------------- */

    rightClick(canvas.querySelector('.dd-node[data-id="A"]'));
    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    check("escape puts the list away", Boolean(menu()), false);
    check("...without also letting go of the box", ringed(), 1);

    /* Pressed on the box that is already held, so nothing about the diagram
     * changes and the list can only have gone because pressing put it away —
     * pressing empty paper would let go of everything and redraw over it. */
    rightClick(canvas.querySelector('.dd-node[data-id="A"]'));
    canvas.querySelector('.dd-node[data-id="A"]').dispatchEvent(
      new window.MouseEvent("pointerdown", { clientX: 200, clientY: 200, bubbles: true }));
    check("pressing anywhere puts it away too", Boolean(menu()), false);
    canvas.dispatchEvent(new window.MouseEvent("pointerup", { clientX: 200, clientY: 200, bubbles: true }));

    /* --- a finger has no second button ------------------------------------- */

    const finger = (type, x, y) => {
      const event = new window.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
      Object.defineProperty(event, "pointerType", { value: "touch" });
      Object.defineProperty(event, "pointerId", { value: 4 });
      return event;
    };

    // Asked for again every time: a redraw replaces the drawing, and a press on
    // a box that has been swept out of the document reaches nothing at all.
    const box = () => canvas.querySelector('.dd-node[data-id="A"]');

    box().dispatchEvent(finger("pointerdown", 200, 200));
    await new Promise((r) => setTimeout(r, 700));
    check("a finger held still opens the same list", Boolean(menu()), true);
    check("...about the box under it", labels().includes("Rename box"), true);
    canvas.dispatchEvent(finger("pointerup", 200, 200));

    // A press that turns into a drag was a drag all along.
    box().dispatchEvent(finger("pointerdown", 200, 200));
    canvas.dispatchEvent(finger("pointermove", 260, 240));
    await new Promise((r) => setTimeout(r, 700));
    check("a finger that moves is dragging, not asking", Boolean(menu()), false);
    canvas.dispatchEvent(finger("pointerup", 260, 240));

    // And one that lets go quickly was a tap.
    box().dispatchEvent(finger("pointerdown", 200, 200));
    canvas.dispatchEvent(finger("pointerup", 200, 200));
    await new Promise((r) => setTimeout(r, 700));
    check("a finger that lets go is tapping, not asking", Boolean(menu()), false);
  }

  console.log("=== a colour is a classDef, which every other renderer reads ===");
  {
    await server.request("POST", "/api/docs",
      { fileName: "colour.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 80x40",
        "    %% @ B 300,100 80x40",
        "    %% @ C 500,100 80x40",
        "    classDef mine fill:#123456",
        "    A[One]",
        "    B[Two]",
        "    C[Three]"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/colour.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const inspector = page.document.querySelector(".ve-diagram-inspector");
    const swatches = () => [...inspector.querySelectorAll(".ve-diagram-swatch")];
    const pick = (label) => swatches().find((one) => one.title === label)
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const groupOf = (id) => canvas.querySelector(`.dd-node[data-id="${id}"]`);
    const fillOf = (id) => groupOf(id).style.getPropertyValue("--dd-fill");
    const tap = (id) => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(groupOf(id).getAttribute("transform"));
      const x = Number(found[1]) + 10;
      const y = Number(found[2]) + 10;
      groupOf(id).dispatchEvent(new window.MouseEvent("pointerdown",
        { clientX: x, clientY: y, bubbles: true }));
      canvas.dispatchEvent(new window.MouseEvent("pointerup",
        { clientX: x, clientY: y, bubbles: true }));
    };
    const written = async () => (await server.request("GET", "/api/docs/colour.mmd",
      undefined, { Cookie: cookie })).body.content;

    tap("A");
    check("a box offers the colours it can be", swatches().length > 2, true);
    check("...and starts wearing none of them",
      swatches()[0].getAttribute("aria-pressed"), "true");

    pick("Red");
    check("choosing one colours the box", fillOf("A"), "#fbdedc");
    check("...and says which one is being worn",
      swatches().find((one) => one.title === "Red").getAttribute("aria-pressed"), "true");
    check("...and leaves the box beside it alone", fillOf("B"), "");

    await saveAndWait(page);
    const red = await written();
    check("the colour reaches the file as a classDef, not as a comment",
      /classDef ddC1 fill:#fbdedc,stroke:#c0453c,color:#4a1512/.test(red), true);
    check("...with a line saying which box wears it", /class A ddC1/.test(red), true);
    check("the classDef that was already there is untouched",
      /classDef mine fill:#123456/.test(red), true);

    /* One definition per colour, shared. Twenty blue boxes are one classDef and
     * one class line, which is smaller and is how a person would write it.
     */
    tap("B");
    pick("Red");
    await saveAndWait(page);
    const both = await written();
    check("a second box in the same colour reuses the definition",
      (both.match(/classDef ddC1/g) || []).length, 1);
    check("...and joins the line that names who wears it", /class A,B ddC1/.test(both), true);

    // Changed rather than added to, or a box that was red and is now green
    // would be wearing both and the file would say so.
    tap("A");
    pick("Green");
    await saveAndWait(page);
    const changed = await written();
    check("changing a colour swaps the class rather than adding one",
      /class A ddC2/.test(changed) && /class B ddC1/.test(changed), true);
    check("...leaving the box wearing exactly one of ours",
      (changed.match(/^\s*class A /gm) || []).length, 1);

    // Cleared: the class goes, and so does a definition of ours nobody wears.
    tap("B");
    pick("No colour");
    await saveAndWait(page);
    const cleared = await written();
    check("clearing a colour takes the class off the box", /class B/.test(cleared), false);
    check("...and takes a definition of ours nobody wears with it",
      /classDef ddC1/.test(cleared), false);
    check("...while one written by hand stays, worn or not",
      /classDef mine fill:#123456/.test(cleared), true);

    // A handful at once, which is the reason to hold four boxes in the first
    // place.
    canvas.dispatchEvent(new window.KeyboardEvent("keydown",
      { key: "a", ctrlKey: true, bubbles: true }));
    check("holding several offers the colours all the same",
      inspector.querySelectorAll(".ve-diagram-swatch").length > 2, true);
    pick("Blue");
    check("...and one choice colours every one of them",
      [fillOf("A"), fillOf("B"), fillOf("C")], ["#d9e6fb", "#d9e6fb", "#d9e6fb"]);

    await saveAndWait(page);
    const blue = await written();
    check("...written as one definition and one line naming all three",
      /class A,B,C ddC\d/.test(blue), true);

    // Read back through the parser rather than assumed: a colour this editor
    // can write and the parser cannot read is a diagram damaged by being saved.
    const reopened = window.DiagramModel.parseFlowchart(blue);
    check("...which is read back as the same colour",
      reopened.classes[reopened.nodes[0].classes[0]].fill, "#d9e6fb");
  }

  console.log("=== words on the paper are their own thing ===");
  {
    /* A text element used to be an ordinary box with its frame turned off,
     * which meant tapping one opened the panel for a box: a shape menu for a
     * thing with no shape, a border for a thing with no edge, a picture and an
     * icon for a thing that is neither. So it is a kind of its own now, and the
     * panel for one asks only what words have an answer to.
     *
     * The one written with nothing but frame=none is how the old tool wrote
     * them, and there are files out there full of them — a frameless box with
     * no icon and no picture is words on the paper and nothing else, so it is
     * read back as what it always was.
     */
    await server.request("POST", "/api/docs",
      { fileName: "words.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 80x40",
        "    %% @ T 300,100 90x32 kind=text frame=none",
        "    %% @ O 500,100 90x32 frame=none",
        "    %% @ P 700,100 80x80 frame=none image=/x.png",
        "    A[One]",
        "    T[Heading]",
        "    O[Older]",
        "    P[Photo]"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/words.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const inspector = page.document.querySelector(".ve-diagram-inspector");
    const groupOf = (id) => canvas.querySelector(`.dd-node[data-id="${id}"]`);
    const captions = () => [...inspector.querySelectorAll(".ve-diagram-field-name")]
      .map((one) => one.textContent);
    const legend = () =>
      inspector.querySelector(".ve-diagram-picked .ve-diagram-legend").textContent;
    const tap = (id) => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\)/
        .exec(groupOf(id).getAttribute("transform"));
      const x = Number(found[1]) + 10;
      const y = Number(found[2]) + 10;
      groupOf(id).dispatchEvent(new window.MouseEvent("pointerdown",
        { clientX: x, clientY: y, bubbles: true }));
      canvas.dispatchEvent(new window.MouseEvent("pointerup",
        { clientX: x, clientY: y, bubbles: true }));
    };
    const written = async () => (await server.request("GET", "/api/docs/words.mmd",
      undefined, { Cookie: cookie })).body.content;

    tap("T");
    check("a panel about words says words, not box", legend(), "Text");
    check("...and asks only what words have an answer to",
      captions(), ["Words", "Font", "Colours"]);
    check("...so no shape menu, which is the question it has no answer to",
      Boolean(inspector.querySelector(".ve-diagram-shape")), false);

    check("the bar over it offers no shape either",
      Boolean(page.document.querySelector(".ve-diagram-hud .ve-diagram-shape")), false);

    check("words on the paper are drawn without a shape",
      Boolean(groupOf("T").querySelector(".dd-shape")), false);

    tap("O");
    check("a frameless box from before there was a kind for one is words too",
      legend(), "Text");

    tap("P");
    check("...while a picture standing on its own is still a box, because it"
      + " is carrying the thing it shows", legend(), "Box");

    tap("A");
    check("an ordinary box still gets every question a box has an answer to",
      captions(),
      ["Label", "Shape", "Fill", "Colours", "Border", "Font", "Picture", "Icon"]);

    /* The two colours everything has, said outright. The swatches say fill,
     * stroke and text all at once, which is the right offer for "make this one
     * red" and no way at all to say "these words are grey".
     */
    const wellFor = (name) => inspector
      .querySelector(`.ve-diagram-inks input[data-ink="${name}"]`);
    const clearFor = (name) => inspector
      .querySelector(`.ve-diagram-inks [data-unink="${name}"]`);
    const setInk = (name, value) => {
      const well = wellFor(name);
      well.value = value;
      well.dispatchEvent(new window.Event("change", { bubbles: true }));
    };

    check("a box is offered its two colours by name",
      [...inspector.querySelectorAll(".ve-diagram-ink-name")].map((one) => one.textContent),
      ["Words", "Behind"]);
    check("...neither of which it has yet, so neither can be taken off",
      [clearFor("color").disabled, clearFor("fill").disabled], [true, true]);

    setInk("color", "#334455");
    check("choosing a colour for the words colours the words",
      groupOf("A").style.getPropertyValue("--dd-text"), "#334455");
    check("...and leaves what is behind them alone",
      groupOf("A").style.getPropertyValue("--dd-fill"), "");
    check("...and can now be taken off on its own",
      [clearFor("color").disabled, clearFor("fill").disabled], [false, true]);

    setInk("fill", "#ffeedd");
    check("and a colour behind them is the other half of the same question",
      [groupOf("A").style.getPropertyValue("--dd-fill"),
        groupOf("A").style.getPropertyValue("--dd-text")], ["#ffeedd", "#334455"]);

    await saveAndWait(page);
    const painted = await written();
    check("both reach the file as one classDef, like every other colour here",
      /classDef ddC\d+ color:#334455,fill:#ffeedd|classDef ddC\d+ fill:#ffeedd,color:#334455/
        .test(painted), true);

    clearFor("fill").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("taking one off takes only that one off",
      [groupOf("A").style.getPropertyValue("--dd-fill"),
        groupOf("A").style.getPropertyValue("--dd-text")], ["", "#334455"]);

    /* A background on a thing whose whole point is not having one has to be
     * painted on something. So words given a colour behind them get a plain
     * rectangle the size of the words — a highlight, with no border, which is
     * the only honest way to offer the control at all.
     */
    tap("T");
    check("words with no colour behind them have nothing drawn behind them",
      Boolean(groupOf("T").querySelector(".dd-shape")), false);

    setInk("fill", "#ffee99");
    check("...and words given one get a highlight to put it on",
      Boolean(groupOf("T").querySelector(".dd-shape.dd-back")), true);
    check("...which is a fill and not a border, or it would be the box the text"
      + " exists in order not to be",
      groupOf("T").style.getPropertyValue("--dd-fill"), "#ffee99");

    clearFor("fill").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("...and taking the colour off takes the highlight with it",
      Boolean(groupOf("T").querySelector(".dd-shape")), false);

    /* And a way back, because the way in is a choice on a box's shape menu and
     * words have no shape menu. Without it a box turned into words by accident
     * is words for good.
     */
    const backToBox = [...inspector.querySelectorAll(".ve-diagram-add")]
      .find((one) => one.textContent.includes("Put a box round it"));
    check("words are offered a way back to being a box", Boolean(backToBox), true);

    backToBox.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("...which gives them one", legend(), "Box");

    /* The redraw is deferred, the way every other edit's is — so this waits
     * for it rather than sleeping for as long as it ought to take. A fixed
     * sleep here was two hundred milliseconds against a delay of two hundred
     * and fifty, which passed on this machine and failed on a cold runner.
     */
    await waitFor(window, () => groupOf("T").querySelector(".dd-shape"),
      "the box was never drawn round the words again");
    check("...drawn round them again",
      Boolean(groupOf("T").querySelector(".dd-shape")), true);

    /* And the other way is the shape menu's "No frame", which has to reach the
     * same answer the parser does — a box that changed kind by being saved
     * would be a diagram damaged by saving it.
     */
    const shapeMenu = inspector.querySelector(".ve-diagram-shape");
    shapeMenu.value = "none";
    shapeMenu.dispatchEvent(new window.Event("change", { bubbles: true }));
    check("taking a box's frame off leaves words on the paper", legend(), "Text");
    check("...and it is offered the way back straight away",
      Boolean([...inspector.querySelectorAll(".ve-diagram-add")]
        .find((one) => one.textContent.includes("Put a box round it"))), true);

    await saveAndWait(page);
    const kept = await written();
    check("...and the file says the same, so it is not a kind it changes into"
      + " by being saved",
      window.DiagramModel.parseFlowchart(kept)
        .nodes.find((one) => one.id === "T").kind, "text");
    check("words on the paper say so in the file",
      (kept.match(/kind=text/g) || []).length, 2);

    // Read back through the parser rather than assumed: a kind this editor
    // writes and the parser does not read is a diagram damaged by being saved.
    const reopened = window.DiagramModel.parseFlowchart(kept);
    check("...and are read back as words rather than as boxes",
      reopened.nodes.filter((one) => one.kind === "text").map((one) => one.id),
      ["T", "O"]);
  }

  console.log("=== a line is a style and two ends, chosen one at a time ===");
  {
    await server.request("POST", "/api/docs",
      { fileName: "ends.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 80x40",
        "    %% @ B 300,300 80x40",
        "    A[One]",
        "    B[Two]",
        "    A --> B"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/ends.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const inspector = page.document.querySelector(".ve-diagram-inspector");
    const control = (aria) => inspector.querySelector(`[aria-label="${aria}"]`);
    const choose = (aria, value) => {
      const found = control(aria);
      found.value = value;
      found.dispatchEvent(new window.Event("change", { bubbles: true }));
    };
    const groupOf = (id) => canvas.querySelector(`.dd-node[data-id="${id}"]`);
    const tap = (id) => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(groupOf(id).getAttribute("transform"));
      const x = Number(found[1]) + 10;
      const y = Number(found[2]) + 10;
      groupOf(id).dispatchEvent(new window.MouseEvent("pointerdown",
        { clientX: x, clientY: y, bubbles: true }));
      canvas.dispatchEvent(new window.MouseEvent("pointerup",
        { clientX: x, clientY: y, bubbles: true }));
    };
    const written = async () => (await server.request("GET", "/api/docs/ends.mmd",
      undefined, { Cookie: cookie })).body.content;

    tap("A");

    /* Three controls, not one list of eleven. A line is a style and two ends,
     * and the eleven links Mermaid has are what a few of those combinations
     * happen to be called — asking for the name instead of the thing is why
     * "dotted line with a hollow diamond on it" was unreachable.
     */
    check("the arrow offers what is at its back", Boolean(control("Arrow start")), true);
    check("...how it is drawn", Boolean(control("Line style")), true);
    check("...what shape it is drawn in", Boolean(control("Line shape")), true);
    check("...and what is at its point", Boolean(control("Arrow end")), true);
    check("a plain arrow starts with nothing behind it and an arrow ahead",
      [control("Arrow start").value, control("Line style").value, control("Arrow end").value],
      ["none", "solid", "arrow"]);
    check("...drawn the way every line has always been drawn",
      control("Line shape").value, "angled");

    // An ending Mermaid has no words for. The file gets the nearest link it
    // does have, and the exact ending beside it.
    choose("Arrow end", "triangle");
    // The canvas redraws a beat after the change, the way it does for typing.
    await new Promise((r) => setTimeout(r, 300));
    check("the line is drawn with the ending it was given, not with an arrow",
      /marker-end="url\(#dd-end-triangle-\d+\)"/.test(canvas.innerHTML), true);

    await saveAndWait(page);
    const uml = await written();
    check("...and an ending Mermaid cannot spell still writes a link it can read",
      /^\s*A --> B\s*$/m.test(uml), true);
    check("...with the ending it really has kept beside it",
      /%% edge 0 [^\n]*ends=none,triangle/.test(uml), true);

    // The style is the other half, and it is a separate question.
    choose("Line style", "dotted");
    await saveAndWait(page);
    const dotted = await written();
    check("changing how the line is drawn leaves its ends alone",
      /^\s*A -\.-> B\s*$/m.test(dotted) && /ends=none,triangle/.test(dotted), true);
    check("...and the control agrees it is dotted", control("Line style").value, "dotted");

    // Something at the back makes it a both-ways link, which is the nearest
    // real thing however unlike the two ends actually are.
    choose("Arrow start", "diamond");
    await saveAndWait(page);
    const both = await written();
    check("something at the back makes it a both-ways link in the file",
      /^\s*A <-\.-> B\s*$/m.test(both), true);
    check("...while the comment still says which end is which",
      /ends=diamond,triangle/.test(both), true);

    /* The shape of the line is a separate question again, and a quiet one: it
     * is not something Mermaid has an opinion about, so it goes in the layout
     * comment and leaves the link alone.
     */
    choose("Line shape", "curved");
    await new Promise((r) => setTimeout(r, 300));
    check("a curved line is drawn with curves in it",
      /Q[\d.]+,[\d.]+/.test(canvas.querySelector(".dd-edge .dd-line").getAttribute("d")), true);

    await saveAndWait(page);
    const bendy = await written();
    check("...which the file says in the layout comment", /route=curved/.test(bendy), true);
    check("...and the link it is drawn on is untouched",
      /^\s*A <-\.-> B\s*$/m.test(bendy), true);

    choose("Line shape", "straight");
    await new Promise((r) => setTimeout(r, 300));
    check("a straight line is one segment",
      (canvas.querySelector(".dd-edge .dd-line").getAttribute("d").match(/[LQ]/g) || []).length, 1);

    choose("Line shape", "curved");

    /* Dragging a box re-routes its arrows in place rather than redrawing the
     * whole diagram, and a re-route that draws a different line from the one a
     * redraw would draw is a tip that hides itself for the length of the drag
     * and comes back when you let go.
     */
    const lineOf = () => canvas.querySelector(".dd-edge .dd-line").getAttribute("d");
    const held = groupOf("B");
    const place = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(held.getAttribute("transform"));
    const at = (px, py) => ({ clientX: px, clientY: py, bubbles: true });
    const grabX = Number(place[1]) + 10;
    const grabY = Number(place[2]) + 10;

    held.dispatchEvent(new window.MouseEvent("pointerdown", at(grabX, grabY)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(grabX, grabY + 40)));
    // The re-route happens on the next frame, the way every other one does.
    await new Promise((done) => window.requestAnimationFrame(
      () => window.requestAnimationFrame(done)));
    const dragged = lineOf();
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(grabX, grabY + 40)));
    await new Promise((r) => setTimeout(r, 300));

    check("an arrow re-routed by a drag is the same line a redraw would give",
      dragged, lineOf());
    // B is now at y=340 and wears a shape at each end of the line, so the line
    // runs from two pixels below A to two pixels above B.
    /* B is now at 300,340 and the line wears a shape at each end, so it leaves
     * A two pixels down and arrives at B two pixels short — and it is curved,
     * so the re-route has to draw the curve as well. A drag that quietly
     * straightened every corner would be a diagram that changed shape for as
     * long as it was being worked on.
     */
    check("...which is one that stops short of the box at either end, curves and all",
      dragged,
      "M140,142 L140,228 Q140,240 152,240 L328,240 Q340,240 340,252 L340,338");
    dragBox(window, "B", 0, -40);

    /* And the controls have to be able to read all that back. A panel that
     * always opens saying "solid arrow" is a panel that quietly undoes the
     * line the moment anything else about it is changed.
     */
    tap("B");
    tap("A");
    check("reopening the arrow shows the line it actually is",
      [control("Arrow start").value, control("Line style").value,
        control("Line shape").value, control("Arrow end").value],
      ["diamond", "dotted", "curved", "triangle"]);

    /* And put back to the ordinary shape it says nothing at all — not even
     * beside the ends, which do need writing down. An arrow drawn the way every
     * arrow has always been drawn has nothing to say about it.
     */
    choose("Line shape", "angled");
    await saveAndWait(page);
    const ordinary = await written();
    check("a line put back to the ordinary shape says nothing about its shape",
      /route=/.test(ordinary), false);
    check("...while what does need saying is still said",
      /ends=diamond,triangle/.test(ordinary), true);

    /* And back to an ordinary arrow. The comment has to go with it: a file that
     * kept saying `ends=none,arrow` would carry a layout line for every arrow
     * in every diagram, saying what the arrow already said.
     */
    choose("Arrow start", "none");
    choose("Line style", "solid");
    choose("Arrow end", "arrow");
    await saveAndWait(page);
    const back = await written();
    check("an ordinary arrow is written as an ordinary arrow",
      /^\s*A --> B\s*$/m.test(back), true);
    check("...and grows no comment saying what it already says",
      /ends=/.test(back), false);
  }

  console.log("=== an icon is picked out of a grid of them ===");
  {
    await server.request("POST", "/api/docs",
      { fileName: "icons.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 120x100",
        "    A[Store]"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/icons.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const inspector = page.document.querySelector(".ve-diagram-inspector");
    const groupOf = () => canvas.querySelector('.dd-node[data-id="A"]');

    const tap = () => {
      const spot = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(groupOf().getAttribute("transform"));
      const x = Number(spot[1]) + 10;
      const y = Number(spot[2]) + 10;
      groupOf().dispatchEvent(new window.MouseEvent("pointerdown",
        { clientX: x, clientY: y, bubbles: true }));
      canvas.dispatchEvent(new window.MouseEvent("pointerup",
        { clientX: x, clientY: y, bubbles: true }));
    };

    const grid = () => inspector.querySelector(".ve-diagram-icon-grid");
    const offered = () => [...grid().querySelectorAll(".ve-diagram-icon-one")]
      .map((one) => one.getAttribute("aria-label"));
    const legends = () => [...grid().querySelectorAll(".ve-diagram-icon-legend")]
      .map((one) => one.textContent);
    const press = (label) => [...grid().querySelectorAll(".ve-diagram-icon-one")]
      .find((one) => one.getAttribute("aria-label") === label)
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const find = () => inspector.querySelector(".ve-diagram-find");
    const search = (words) => {
      find().value = words;
      find().dispatchEvent(new window.Event("input", { bubbles: true }));
    };
    const drawn = () => Boolean(groupOf().querySelector(".dd-icon"));

    tap();
    check("a box offers every icon this build has", offered().length > 100, true);
    check("...in the groups somebody looking for one would think of",
      legends().slice(0, 2), ["Machines", "Networks"]);
    check("...wearing none of them", drawn(), false);

    press("database");
    check("picking one puts it on the box", drawn(), true);
    check("...and says which one is on", (() => {
      const on = [...grid().querySelectorAll('.ve-diagram-icon-one[aria-pressed="true"]')];
      return on.map((one) => one.getAttribute("aria-label"));
    })(), ["database"]);
    // The icon's own markup sits between the text nodes, so what the box says
    // is what is left once that whitespace is taken out.
    check("...leaving the words underneath it", groupOf().textContent.trim(), "Store");

    /* Searched by name, because Lucide's names say what the picture is — a list
     * of keywords beside them would be a second thing to keep in step with the
     * first. Searching is a grouping of its own, so it takes the groups over.
     */
    search("cloud");
    check("searching narrows it to what matches",
      offered().every((name) => name.includes("cloud")), true);
    check("...to more than one thing", offered().length > 2, true);
    check("...and drops the groups, being a grouping itself", legends(), []);

    search("zzz");
    check("a search that matches nothing says so",
      [offered(), inspector.querySelector(".ve-diagram-hint:not([hidden])").textContent],
      [[], 'No icon is called "zzz".']);

    search("");
    check("clearing it brings them all back", offered().length > 100, true);

    await saveAndWait(page);
    const written = (await server.request("GET", "/api/docs/icons.mmd",
      undefined, { Cookie: cookie })).body.content;
    check("an icon reaches the file beside where its box is",
      /%% @ A 100,100 120x100 icon=lucide:database/.test(written), true);
    check("...and the box keeps its label, which is what travels everywhere else",
      /A\[Store\]/.test(written), true);

    // Wearing it already, pressing it takes it off — the only way a grid of
    // switches can also be a way to say "none of these".
    press("database");
    check("pressing the one that is on takes it off", drawn(), false);

    page.window.close();
  }

  console.log("=== a picture is dropped on the paper where it lands ===");
  {
    /* The gesture everybody tries first. The button in the panel is the second
     * way rather than the only way, and the store a picture goes into is the
     * one documents already paste into — so a picture in a diagram and a
     * picture in a document are the same bytes under the same hash.
     */
    await server.request("POST", "/api/docs",
      { fileName: "shot.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 100x60",
        "    A[One]"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/shot.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const inspector = page.document.querySelector(".ve-diagram-inspector");
    const boxes = () => canvas.querySelectorAll(".dd-node").length;
    const pictures = () => [...canvas.querySelectorAll(".dd-picture")]
      .map((one) => one.getAttribute("href"));

    const drop = (name, x, y, type = "image/png") => {
      const file = new window.File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
        name, { type });
      const event = new window.Event("drop", { bubbles: true, cancelable: true });
      event.dataTransfer = { files: [file], dropEffect: "" };
      event.clientX = x;
      event.clientY = y;
      canvas.dispatchEvent(event);
    };

    const sizeOf = (id) => {
      const rect = canvas.querySelector(`.dd-node[data-id="${id}"] rect`);
      return [Number(rect.getAttribute("width")), Number(rect.getAttribute("height"))];
    };

    // The paper says it will take the picture before it is let go: a drag that
    // gives no sign of being noticed is a drag people let go of somewhere else.
    const over = new window.Event("dragover", { bubbles: true, cancelable: true });
    over.dataTransfer = { files: [{ type: "image/png" }], dropEffect: "" };
    canvas.dispatchEvent(over);
    check("the paper says it will take a picture being dragged over it",
      canvas.classList.contains("is-dropping"), true);

    check("a diagram of one box starts with no pictures", [boxes(), pictures()], [1, []]);

    drop("cat.png", 300, 300);
    await waitFor(window, () => pictures().length > 0,
      "the picture was never added to the diagram");

    check("a picture dropped on the paper becomes a box on the paper", boxes(), 2);
    // A box put down is opened for its name, but a picture is not named by
    // being dropped, and a caret blinking over a photograph asks a question
    // nobody had.
    check("...without a caret blinking over it",
      canvas.querySelector(".ve-diagram-inline"), null);
    check("...holding the picture, at the address the store gave it",
      /^\/api\/assets\/[0-9a-f]{64}\.png$/.test(pictures()[0]), true);
    check("...and the paper stops saying it will take one",
      canvas.classList.contains("is-dropping"), false);
    check("...named after the file it came from, without its extension",
      [...canvas.querySelectorAll(".dd-node")].pop().textContent, "cat");

    // Room to be a picture in. Measured by the words under it instead, a
    // picture arrives in a box the size of its caption.
    check("...in a box big enough to be a picture rather than a caption",
      sizeOf("n1"), [180, 140]);

    // A file that is not a picture is not a picture. The paper takes images;
    // everything else goes on being whatever the browser would have done with
    // it, which is not this.
    const was = boxes();
    drop("notes.txt", 400, 400, "text/plain");
    await settle();
    check("something that is not a picture is not dropped on the paper",
      [boxes(), pictures().length], [was, 1]);

    // The same bytes are the same hash, so dropping the same picture twice
    // stores it once — which is what the document store already does.
    drop("cat.png", 500, 300);
    await waitFor(window, () => pictures().length > 1,
      "the second picture was never added");
    check("the same picture twice is the same picture, stored once",
      pictures()[0], pictures()[1]);

    await saveAndWait(page);
    const written = (await server.request("GET", "/api/docs/shot.mmd",
      undefined, { Cookie: cookie })).body.content;
    check("a picture reaches the file beside where its box is",
      (written.match(/image=\/api\/assets\/[0-9a-f]{64}\.png/g) || []).length, 2);

    /* The panel offers the other way in, and a way back out. A box with a
     * picture offers to replace it; one without offers to add one.
     */
    const groupOf = (id) => canvas.querySelector(`.dd-node[data-id="${id}"]`);
    const tap = (id) => {
      const spot = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(groupOf(id).getAttribute("transform"));
      const x = Number(spot[1]) + 10;
      const y = Number(spot[2]) + 10;
      groupOf(id).dispatchEvent(new window.MouseEvent("pointerdown",
        { clientX: x, clientY: y, bubbles: true }));
      canvas.dispatchEvent(new window.MouseEvent("pointerup",
        { clientX: x, clientY: y, bubbles: true }));
    };
    const buttons = () => [...inspector.querySelectorAll(".ve-diagram-add")]
      .map((one) => one.textContent);

    tap("A");
    check("a box with no picture offers to take one",
      buttons().includes("Add a picture"), true);
    check("...and nothing to take off", buttons().includes("Take it off"), false);

    tap("n1");
    check("a box with a picture offers to replace it",
      buttons().includes("Replace the picture"), true);

    inspector.querySelectorAll(".ve-diagram-add")
      .forEach((one) => {
        if (one.textContent === "Take it off") {
          one.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
        }
      });

    check("...and taking it off leaves the box behind", [boxes(), pictures().length], [3, 1]);

    page.window.close();
  }

};
