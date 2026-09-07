// Part of the diagram-page suite. See diagram-page.test.js, which sets all this
// up and calls it.
//
// Carrying boxes about, typing into the diagram, undo, and groups.
//
// Everything it needs is handed to it: the suite's own check(), the helpers
// that boot a page and drag a box, and the fixtures. Split out of one file only
// because that file had grown well past a thousand lines.
module.exports = async (ctx) => {
  const {
    check, server, cookie, origin, ROOT, openPage, saveAndWait, csrfFor, readAppSource
  } = ctx;

  {
    await server.request("POST", "/api/docs",
      { fileName: "carry.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 80x40",
        "    %% @ B 300,100 80x40",
        "    %% @ C 100,300 80x40",
        "    A[One]",
        "    B[Two]",
        "    C[Three]",
        "    A --> B",
        "    B --> C"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/carry.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const boxes = () => [...canvas.querySelectorAll(".dd-node")].map((one) => one.getAttribute("data-id"));
    const arrows = () => canvas.querySelectorAll(".dd-edge").length;
    const ringed = () => canvas.querySelectorAll(".dd-ring").length;
    const press = (key, extra = {}) => canvas.dispatchEvent(
      new window.KeyboardEvent("keydown", { key, bubbles: true, ...extra }));

    const view = () => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\) scale\(([\d.]+)\)/
        .exec(canvas.querySelector(".dd-view").getAttribute("transform"));
      return { x: Number(found[1]), y: Number(found[2]), scale: Number(found[3]) };
    };
    const placed = (id) => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\)/
        .exec(canvas.querySelector(`.dd-node[data-id="${id}"]`).getAttribute("transform"));
      return [Number(found[1]), Number(found[2])];
    };
    const tap = (id, extra = {}) => {
      const [x, y] = placed(id);
      const at = { clientX: (x * view().scale) + view().x + 10,
        clientY: (y * view().scale) + view().y + 10, bubbles: true, ...extra };
      canvas.querySelector(`.dd-node[data-id="${id}"]`).dispatchEvent(new window.MouseEvent("pointerdown", at));
      canvas.dispatchEvent(new window.MouseEvent("pointerup", at));
    };

    check("three boxes and two arrows to begin with", [boxes().length, arrows()], [3, 2]);

    // An edit first, so that undoing a paste has somewhere to land that is not
    // simply the diagram as it was opened.
    tap("A");
    press("ArrowRight", { shiftKey: true });
    await new Promise((r) => setTimeout(r, 700));
    const nudged = placed("A");

    press("c", { ctrlKey: true });
    press("v", { ctrlKey: true });

    check("pasting a box makes a second box", boxes().length, 4);
    check("...under a name nothing else is using",
      new Set(boxes()).size, boxes().length);
    check("...put down beside what it came from, not on top of it",
      placed(boxes()[3]), [placed("A")[0] + 20, placed("A")[1] + 20]);
    check("...and it is what is now held, because it is what you want to move",
      ringed(), 1);
    check("...while the arrows are as they were, because one end was outside",
      arrows(), 2);

    // Saved and read back, because an arrow with one end that is not there is
    // something the drawing quietly leaves out and the file does not.
    await saveAndWait(page);
    const oneCopied = (await server.request("GET", "/api/docs/carry.mmd", undefined, { Cookie: cookie })).body.content;
    check("...and the file has no arrow to a box that was left behind",
      (oneCopied.match(/-->/g) || []).length, 2);
    check("...nor any mention of one", /undefined/.test(oneCopied), false);

    press("z", { ctrlKey: true });
    check("a paste can be undone", boxes().length, 3);
    check("...back to the edit before it rather than past it", placed("A"), nudged);

    /* Undoing leaves a way forward. Pasting is doing something new, and doing
     * something new is what makes the way forward stop existing — so a redo
     * after a paste must not walk into a diagram that never happened.
     *
     * Undone twice, so what is forward is the nudge rather than another paste:
     * two states that differ only in whether they happened are two states this
     * check cannot tell apart.
     */
    press("z", { ctrlKey: true });
    check("...and again takes back the nudge", placed("A")[0], nudged[0] - 10);

    press("v", { ctrlKey: true });
    check("pasting after an undo puts a box down", boxes().length, 4);

    press("z", { ctrlKey: true, shiftKey: true });
    check("...and there is nothing to redo past it", boxes().length, 4);
    check("...least of all the edit the paste was done instead of",
      placed("A")[0], nudged[0] - 10);

    press("z", { ctrlKey: true });

    /* --- what comes with a copy --------------------------------------------- */

    // An arrow with one end outside the selection has nowhere to arrive when it
    // is pasted, so it does not come. An arrow wholly inside does.
    press("Escape");
    tap("A");
    tap("B", { shiftKey: true });
    press("c", { ctrlKey: true });
    press("v", { ctrlKey: true });
    check("copying two joined boxes brings the arrow between them",
      [boxes().length, arrows()], [5, 3]);
    check("...and holds both of the new ones", ringed(), 2);
    // Two boxes pasted at once are two boxes: asking for a free name once and
    // using it twice would declare the same box twice, and the file would come
    // back with one of them.
    check("...each under a name of its own", new Set(boxes()).size, boxes().length);

    // The new arrow joins the new boxes, not the old ones.
    await saveAndWait(page);
    const pasted = (await server.request("GET", "/api/docs/carry.mmd", undefined, { Cookie: cookie })).body.content;
    const fresh = boxes().filter((id) => !["A", "B", "C"].includes(id));
    check("...joined to each other rather than back to the originals",
      pasted.includes(`${fresh[0]} --> ${fresh[1]}`), true);

    press("z", { ctrlKey: true });

    /* --- cut ---------------------------------------------------------------- */

    press("Escape");
    tap("C");
    press("x", { ctrlKey: true });
    check("cut takes the box out", boxes().includes("C"), false);
    check("...and the arrow that reached it", arrows(), 1);

    press("v", { ctrlKey: true });
    check("...and paste puts one back", boxes().length, 3);

    press("z", { ctrlKey: true });
    press("z", { ctrlKey: true });
    check("both halves of a cut can be undone", boxes().length, 3);

    /* --- duplicate ---------------------------------------------------------- */

    press("Escape");
    tap("A");
    press("c", { ctrlKey: true });
    press("Escape");
    tap("B");
    press("d", { ctrlKey: true });
    check("duplicate copies what is held", boxes().length, 4);

    // Duplicating is not copying: what was on the clipboard before is still
    // what a paste should put down.
    press("Escape");
    press("v", { ctrlKey: true });
    const added = boxes().filter((id) => !["A", "B", "C"].includes(id));
    check("...and leaves the clipboard alone", boxes().length, 5);
    check("...so what was copied earlier is what is pasted now",
      canvas.querySelector(`.dd-node[data-id="${added[added.length - 1]}"]`).textContent.includes("One"),
      true);
  }

  console.log("=== typing into the diagram itself ===");
  {
    await server.request("POST", "/api/docs",
      { fileName: "words.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 120x50",
        "    %% @ B 100,300 120x50",
        "    A[\"One<br/>two\"]",
        "    B[Other]",
        "    A -->|when| B"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/words.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const field = () => canvas.querySelector(".ve-diagram-inline");
    /* Asked for again between the presses: the first one selects the box, and
     * selecting throws the whole drawing away and draws it again. Holding on to
     * the element is how a test passes while no hand can open the box.
     */
    const twice = (selector) => {
      for (let count = 0; count < 2; count += 1) {
        canvas.querySelector(selector)
          .dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
        canvas.dispatchEvent(new window.MouseEvent("pointerup", { bubbles: true }));
      }
    };
    const key = (target, name, extra = {}) => target.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...extra }));

    check("nothing is being typed into to begin with", Boolean(field()), false);

    /* Why two presses and not one `dblclick` event.
     *
     * The first press selects the box, and selecting redraws the whole diagram
     * — `canvas.innerHTML = …` — so the element the browser was counting
     * clicks against is thrown away before the second press lands, and its
     * count starts again from one. A double click therefore never arrived, and
     * the words could only be edited from the panel. Nothing about that is
     * visible to a test that hands the editor a `dblclick` of its own.
     */
    const held = canvas.querySelector('.dd-node[data-id="A"]');
    held.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", { bubbles: true }));
    check("pressing a box replaces the very element that was pressed",
      canvas.querySelector('.dd-node[data-id="A"]') === held, false);
    check("...and it is no longer in the page at all", held.isConnected, false);

    // The second press, on the box rather than on the element: the count is
    // kept against what was pressed, which outlives any number of redraws.
    canvas.querySelector('.dd-node[data-id="A"]')
      .dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", { bubbles: true }));
    check("two presses on a box open a place to type in it, all the same",
      Boolean(field()), true);

    key(field(), "Escape");
    await new Promise((r) => setTimeout(r, 450));

    twice('.dd-node[data-id="A"]');
    check("double-clicking a box opens a place to type in it", Boolean(field()), true);
    // The file says <br/> because that is what Mermaid reads. A person typing
    // into a box presses Enter.
    check("...holding what the box says, as lines rather than markup",
      field().value, "One\ntwo");
    // Over the box, not merely somewhere: a field that opens in the corner is a
    // field you have to look away from the thing you are naming to use.
    const seat = () => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\) scale\(([\d.]+)\)/
        .exec(canvas.querySelector(".dd-view").getAttribute("transform"));
      const at = /translate\((-?[\d.]+),(-?[\d.]+)\)/
        .exec(canvas.querySelector('.dd-node[data-id="A"]').getAttribute("transform"));
      const scale = Number(found[3]);
      return [`${(Number(at[1]) * scale) + Number(found[1])}px`,
        `${(Number(at[2]) * scale) + Number(found[2])}px`];
    };

    check("...over the box it belongs to", [field().style.left, field().style.top], seat());
    check("...at the size it is drawn",
      [field().style.width, field().style.height], ["120px", "50px"]);

    field().value = "Renamed";
    key(field(), "Enter");
    check("enter puts what was typed into the box", Boolean(field()), false);
    check("...and the box says it",
      canvas.querySelector('.dd-node[data-id="A"]').textContent.includes("Renamed"), true);

    // The options panel edits the same words. Both stay: a panel is how you
    // find a setting you have never used, and typing into the thing itself is
    // how you rename a box you are looking at.
    check("...and so does the panel beside it",
      page.document.querySelector(".ve-diagram-text").value, "Renamed");

    twice('.dd-node[data-id="A"]');
    field().value = "Thrown away";
    key(field(), "Escape");
    check("escape throws away what was typed", Boolean(field()), false);
    check("...leaving the box as it was",
      canvas.querySelector('.dd-node[data-id="A"]').textContent.includes("Renamed"), true);

    // Shift-enter is a line break, the way it is in every box anyone has typed
    // a label into.
    twice('.dd-node[data-id="B"]');
    field().value = "Two\nlines";
    key(field(), "Enter");
    await saveAndWait(page);
    const written = (await server.request("GET", "/api/docs/words.mmd", undefined, { Cookie: cookie })).body.content;
    check("a line break is written the way Mermaid reads one",
      written.includes("B[\"Two<br/>lines\"]"), true);

    // An arrow has no box to type in, so one is borrowed where its label is.
    twice(".dd-edge");
    check("double-clicking an arrow opens a place to type its label", field().value, "when");
    /* Pressing a line bends it, so the press that opens its label puts one
     * corner in it. The second press is about the label and nothing else — it
     * must not put a second corner in on the way.
     */
    check("...without bending it a second time on the way",
      canvas.querySelectorAll(".dd-via").length, 1);
    field().value = "if ready";
    key(field(), "Enter");
    await saveAndWait(page);
    const labelled = (await server.request("GET", "/api/docs/words.mmd", undefined, { Cookie: cookie })).body.content;
    check("...which is written on the arrow", labelled.includes("-->|if ready|"), true);

    // And it is one step, like every other edit.
    canvas.dispatchEvent(new window.KeyboardEvent("keydown",
      { key: "z", ctrlKey: true, bubbles: true }));
    check("typing into the diagram can be undone",
      canvas.querySelector(".dd-edge").textContent.includes("when"), true);

    /* --- what a second press is not ---------------------------------------- */

    await new Promise((r) => setTimeout(r, 450));

    /* Clicking a box and then dragging it is two things a person does in a row.
     * Judging the pair on the way down would turn the beginning of that drag
     * into an opened box, and the box would be typed into instead of moved.
     */
    const where = () => /translate\((-?[\d.]+),(-?[\d.]+)\)/
      .exec(canvas.querySelector('.dd-node[data-id="A"]').getAttribute("transform"));

    const start = where();
    const spot = (dx, dy) => ({
      clientX: Number(start[1]) + 10 + dx,
      clientY: Number(start[2]) + 10 + dy,
      bubbles: true,
      cancelable: true
    });

    canvas.querySelector('.dd-node[data-id="A"]')
      .dispatchEvent(new window.MouseEvent("pointerdown", spot(0, 0)));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", spot(0, 0)));
    canvas.querySelector('.dd-node[data-id="A"]')
      .dispatchEvent(new window.MouseEvent("pointerdown", spot(0, 0)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", spot(60, 0)));
    await new Promise((r) => setTimeout(r, 60));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", spot(60, 0)));

    check("a press that goes somewhere is a drag, not the second of two taps",
      Boolean(field()), false);
    check("...and the box went where it was dragged",
      Number(where()[1]) - Number(start[1]), 60);

    /* What else a pair is not. A pair is two presses on the same thing, close
     * together and close by — anything else is two presses.
     */
    const now = () => /translate\((-?[\d.]+),(-?[\d.]+)\)/
      .exec(canvas.querySelector('.dd-node[data-id="A"]').getAttribute("transform"));

    const pressOn = (selector, dx = 0, dy = 0) => {
      const at = now();
      const spot = {
        clientX: Number(at[1]) + 10 + dx,
        clientY: Number(at[2]) + 10 + dy,
        bubbles: true,
        cancelable: true
      };

      canvas.querySelector(selector).dispatchEvent(new window.MouseEvent("pointerdown", spot));
      canvas.dispatchEvent(new window.MouseEvent("pointerup", spot));
    };

    pressOn('.dd-node[data-id="A"]');
    pressOn('.dd-node[data-id="B"]');
    check("one press on each of two boxes is not a pair on either",
      Boolean(field()), false);

    // Far enough apart on the same box to be two places rather than one.
    pressOn('.dd-node[data-id="A"]');
    pressOn('.dd-node[data-id="A"]', 40);
    check("...and two presses far apart on one box are not a pair either",
      Boolean(field()), false);

    await new Promise((r) => setTimeout(r, 450));

    pressOn('.dd-node[data-id="A"]');
    pressOn('.dd-node[data-id="A"]');
    check("...while two on the same spot are", Boolean(field()), true);

    /* Three presses are a pair and then a press. Counting the third against the
     * first as well would throw away the field being typed into and open
     * another one in its place, halfway through a word.
     */
    const opened = field();
    pressOn('.dd-node[data-id="A"]');
    check("...and a third press leaves the field that is being typed into alone",
      field() === opened, true);
    key(field(), "Escape");
  }

  console.log("=== every edit has a way back ===");
  {
    await server.request("POST", "/api/docs",
      { fileName: "steps.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 80x40",
        "    %% @ B 300,100 80x40",
        "    A[One]:::blue",
        "    B[Two]",
        "    A --> B",
        "    classDef blue fill:#2b6cb0"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/steps.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const box = (id) => canvas.querySelector(`.dd-node[data-id="${id}"]`);
    const placed = (id) => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(box(id).getAttribute("transform"));
      return [Number(found[1]), Number(found[2])];
    };
    const view = () => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\) scale\(([\d.]+)\)/
        .exec(canvas.querySelector(".dd-view").getAttribute("transform"));
      return { x: Number(found[1]), y: Number(found[2]), scale: Number(found[3]) };
    };
    const onScreen = (x, y) => [(x * view().scale) + view().x, (y * view().scale) + view().y];
    const at = (x, y, extra = {}) => ({ clientX: x, clientY: y, bubbles: true, ...extra });
    const press = (key, extra = {}) => canvas.dispatchEvent(
      new window.KeyboardEvent("keydown", { key, bubbles: true, ...extra }));

    const drag = async (id, dx, dy) => {
      const [sx, sy] = onScreen(...placed(id));
      box(id).dispatchEvent(new window.MouseEvent("pointerdown", at(sx + 5, sy + 5)));
      canvas.dispatchEvent(new window.MouseEvent("pointermove", at(sx + 5 + dx, sy + 5 + dy)));
      await new Promise((r) => setTimeout(r, 60));
      canvas.dispatchEvent(new window.MouseEvent("pointerup", at(sx + 5 + dx, sy + 5 + dy)));
    };

    const stepButtons = () => [...page.document.querySelectorAll(".ve-diagram-steps button")];
    check("a fresh diagram has nothing to undo and nothing to redo",
      stepButtons().map((one) => one.disabled), [true, true]);

    const started = placed("A");
    await drag("A", 0, 200);
    check("...and one edit gives it something to undo",
      stepButtons().map((one) => one.disabled), [false, true]);
    const moved = placed("A");
    check("a box dragged is a box moved", moved[1] - started[1], 200);

    press("z", { ctrlKey: true });
    check("undo puts it back", placed("A"), started);
    check("...and now there is something to redo",
      stepButtons().map((one) => one.disabled), [true, false]);

    stepButtons()[1].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("the button does what the keystroke does", placed("A"), moved);
    stepButtons()[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("...in both directions", placed("A"), started);

    press("z", { ctrlKey: true, shiftKey: true });
    check("redo moves it again", placed("A"), moved);

    press("y", { ctrlKey: true });
    check("...and there is nothing further forward to go to", placed("A"), moved);

    // One step per gesture, not one per frame: a drag that took forty frames
    // is one thing that happened, and one press of undo has to take it back.
    press("z", { ctrlKey: true });
    check("one drag is one step, however many frames it took", placed("A"), started);

    /* --- a run of them ------------------------------------------------------ */

    await drag("A", 0, 100);
    await drag("B", 100, 0);
    const both = { A: placed("A"), B: placed("B") };

    press("z", { ctrlKey: true });
    check("undo takes back the last thing done, not the last two",
      [placed("A"), placed("B")], [both.A, [both.B[0] - 100, both.B[1]]]);

    press("z", { ctrlKey: true });
    check("...and again takes back the one before it", placed("A"), started);

    press("z", { ctrlKey: true });
    check("...and running out of past is not an error", placed("A"), started);

    press("z", { ctrlKey: true, shiftKey: true });
    press("z", { ctrlKey: true, shiftKey: true });
    check("redo walks the same way forward",
      [placed("A"), placed("B")], [both.A, both.B]);

    // Doing something new is what makes the way forward stop existing.
    press("z", { ctrlKey: true });
    await drag("B", 0, 150);
    const branched = placed("B");
    press("z", { ctrlKey: true, shiftKey: true });
    check("a new edit closes off the way forward", placed("B"), branched);

    /* --- what undo has to restore ------------------------------------------- */

    press("Escape");
    const [cx, cy] = onScreen(...placed("A"));
    box("A").dispatchEvent(new window.MouseEvent("pointerdown", at(cx + 5, cy + 5)));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(cx + 5, cy + 5)));
    press("Delete");
    check("a box can be removed", Boolean(box("A")), false);

    press("z", { ctrlKey: true });
    check("undo brings it back", Boolean(box("A")), true);
    check("...and the arrow that went with it",
      canvas.querySelectorAll(".dd-edge").length, 1);

    /* --- typing ------------------------------------------------------------- */

    // A word typed into a box arrives one character at a time, and a history
    // with one step per keystroke is a history where undo means "take back that
    // letter". A burst is gathered up into one step; a pause ends it.
    press("Escape");
    const [nx, ny] = onScreen(...placed("B"));
    box("B").dispatchEvent(new window.MouseEvent("pointerdown", at(nx + 5, ny + 5)));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(nx + 5, ny + 5)));

    // Re-queried every time: an undo repaints the panel, so a reference kept
    // from before one is a reference to a box that is no longer on the screen.
    const naming = () => page.document.querySelector(".ve-diagram-text");
    const type = (text) => {
      const field = naming();
      field.value = text;
      field.dispatchEvent(new window.Event("input", { bubbles: true }));
    };

    const wasCalled = naming().value;
    for (const text of ["T", "Tw", "Two", "Two ", "Two b"]) {
      type(text);
    }

    // Long enough for the burst to have been gathered up and closed.
    await new Promise((r) => setTimeout(r, 700));
    for (const text of ["Two bo", "Two box"]) {
      type(text);
    }

    await new Promise((r) => setTimeout(r, 700));
    check("typing changes the box", naming().value, "Two box");

    press("z", { ctrlKey: true });
    await new Promise((r) => setTimeout(r, 60));
    check("undo takes back the burst, not the letter",
      naming().value, "Two b");

    press("z", { ctrlKey: true });
    await new Promise((r) => setTimeout(r, 60));
    check("...and again takes back the burst before it",
      naming().value, wasCalled);

    /* A step still being gathered has to be taken back first rather than
     * skipped over, or an undo lands one step further back than it should and
     * the letters just typed survive it.
     *
     * Two bursts, the first finished and the second still open: undo has to
     * arrive at the first, not at what came before it.
     */
    type("Alpha");
    await new Promise((r) => setTimeout(r, 700));
    type("Beta");
    press("z", { ctrlKey: true });
    await new Promise((r) => setTimeout(r, 60));
    check("undo during a burst takes back the burst so far",
      naming().value, "Alpha");
    check("...rather than the finished burst underneath it",
      naming().value === wasCalled, false);

    // A step is the file, so it restores the things this editor has no controls
    // for as faithfully as the things it has.
    await drag("A", 40, 0);
    press("z", { ctrlKey: true });
    await saveAndWait(page);
    const saved = (await server.request("GET", "/api/docs/steps.mmd", undefined, { Cookie: cookie })).body.content;
    check("...and a colour nothing here can edit",
      saved.includes("classDef blue fill:#2b6cb0"), true);
    check("...and the box that wears it", saved.includes("class A blue"), true);
  }

  console.log("=== a name round a handful of boxes ===");
  {
    /* A group is a name over some boxes and nothing else.
     *
     * It has no rectangle of its own anywhere — not in the file, not in the
     * model — so the frame drawn round it is worked out from the boxes every
     * time. That is what these checks are really about: a frame that follows
     * what it holds, and padding that is the same after nine edits as after
     * one, because there is nothing for a second helping of it to be added to.
     */
    await server.request("POST", "/api/docs",
      { fileName: "band.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 80x40",
        "    %% @ B 300,100 80x40",
        "    %% @ C 100,300 80x40",
        "    A[One]",
        "    B[Two]",
        "    C[Three]"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/band.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const inspector = page.document.querySelector(".ve-diagram-inspector");
    const at = (x, y, extra = {}) => ({ clientX: x, clientY: y, bubbles: true, ...extra });
    const box = (id) => canvas.querySelector(`.dd-node[data-id="${id}"]`);
    const placed = (id) => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(box(id).getAttribute("transform"));
      return [Number(found[1]), Number(found[2])];
    };

    const view = () => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\) scale\(([\d.]+)\)/
        .exec(canvas.querySelector(".dd-view").getAttribute("transform"));
      return { x: Number(found[1]), y: Number(found[2]), scale: Number(found[3]) };
    };
    const onScreen = (x, y) => [(x * view().scale) + view().x, (y * view().scale) + view().y];

    const tap = (id, extra = {}) => {
      const [x, y] = onScreen(...placed(id));
      box(id).dispatchEvent(new window.MouseEvent("pointerdown", at(x + 10, y + 10, extra)));
      canvas.dispatchEvent(new window.MouseEvent("pointerup", at(x + 10, y + 10, extra)));
    };

    const press = (key, options = {}) => canvas.dispatchEvent(new window.KeyboardEvent("keydown",
      { key, bubbles: true, cancelable: true, ...options }));

    // Long enough that the next press is a press rather than the second of a
    // pair, which is a different thing entirely now that a pair goes inside.
    const apart = () => new Promise((r) => setTimeout(r, 450));
    const legend = () => inspector.querySelector(".ve-diagram-legend")?.textContent;

    const frame = () => canvas.querySelector(".dd-group-box");
    const frameBox = () => {
      const rect = frame();
      return rect && [Number(rect.getAttribute("x")), Number(rect.getAttribute("y")),
        Number(rect.getAttribute("width")), Number(rect.getAttribute("height"))];
    };
    const ringed = () => canvas.querySelectorAll(".dd-ring").length;
    const nameOn = () => canvas.querySelector(".dd-group-name")?.textContent;

    check("nothing is grouped to begin with", canvas.querySelectorAll(".dd-group").length, 0);

    tap("A");
    press("g", { ctrlKey: true });
    check("one box on its own is not a handful to put a name round",
      canvas.querySelectorAll(".dd-group").length, 0);

    tap("B", { shiftKey: true });
    press("g", { ctrlKey: true });
    check("two boxes held become a group", canvas.querySelectorAll(".dd-group").length, 1);
    check("...with a name on it", nameOn(), "Group 1");
    check("...drawn round both of them and no further",
      frameBox(), [100 - 18, 100 - 18 - 22, 280 + 36, 40 + 36 + 22]);
    check("...behind the boxes, because a frame is background",
      [...canvas.querySelectorAll(".dd-groups, .dd-nodes")]
        .map((one) => one.getAttribute("class"))[0], "dd-groups");
    check("...and the box that was left out is still outside it",
      frameBox()[1] + frameBox()[3] < 300, true);

    check("the panel calls it a group rather than counting the boxes", legend(), "Group");

    /* --- what is written down ---------------------------------------------- */

    const savedNow = async () => {
      await saveAndWait(page);
      return (await server.request("GET", "/api/docs/band.mmd", undefined, { Cookie: cookie })).body.content;
    };

    const written = await savedNow();
    check("a group is written as a subgraph, which is real Mermaid",
      written.includes("subgraph group1 [Group 1]"), true);
    check("...with the boxes in it declared inside it",
      /subgraph group1[^]*A\[One\][^]*B\[Two\][^]*end/.test(written), true);
    check("...and the one that is not, before it and outside it",
      /C\[Three\][^]*subgraph group1/.test(written), true);
    check("...and no rectangle for it anywhere, because there is not one",
      /%% @ group1/.test(written), false);

    /* And read back, it opens on the canvas rather than as source. This used to
     * be the one thing the editor refused: a diagram with a group in it stayed
     * a page of Mermaid you could only type at.
     */
    const reopened = await openPage({ url: `${origin}/diagram/file/band.mmd`, cookie, origin });
    check("a diagram with a group in it opens as a canvas",
      reopened.document.querySelectorAll(".dd-node").length, 3);
    check("...with the group drawn round the boxes it holds",
      reopened.document.querySelectorAll(".dd-group").length, 1);

    /* --- taking hold of it -------------------------------------------------- */

    tap("C");
    check("something else can be held", ringed(), 1);

    const nameSpot = () => {
      const rect = frame();
      return onScreen(Number(rect.getAttribute("x")) + 30, Number(rect.getAttribute("y")) + 8);
    };

    const pressName = (extra = {}) => {
      const [x, y] = nameSpot();
      canvas.dispatchEvent(new window.MouseEvent("pointerdown", at(x, y, extra)));
      canvas.dispatchEvent(new window.MouseEvent("pointerup", at(x, y, extra)));
    };

    pressName();
    check("pressing the group's name takes hold of everything in it", ringed(), 2);
    check("...which is the group, not three boxes that happen to be selected",
      legend(), "Group");

    // Inside the frame but not on the name is the paper, so a rubber band can
    // still be pulled across a group's contents.
    const inside = onScreen(250, 120);
    canvas.dispatchEvent(new window.MouseEvent("pointerdown", at(inside[0], inside[1])));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(inside[0], inside[1])));
    check("a press inside the frame is a press on the paper", ringed(), 0);

    /* --- a group is one thing to press -------------------------------------- */

    /* Pressing a box in a group takes the group. Which is what makes a group a
     * thing rather than a heap of boxes that happen to move together — its name
     * is a way to take hold of it, not the only way.
     *
     * That would leave no way to reach the box, so pressing again goes one
     * level in and Escape comes back out: the descent every editor shaped like
     * this has, and it runs out exactly where typing into a box begins.
     */
    await apart();
    tap("A");
    check("pressing a box in a group takes hold of the group", ringed(), 2);
    check("...and the panel says so", legend(), "Group");

    await apart();
    tap("A");
    tap("A");
    check("pressing it again goes inside, down to the box itself", ringed(), 1);
    check("...which is the box on its own, not the group round it",
      Boolean(inspector.querySelector(".ve-diagram-group-name")), false);
    // Going in is what the second press did. Opening the words as well would
    // put a field over a box that was only being reached for.
    check("...and it did not also open the box for typing",
      Boolean(page.document.querySelector(".ve-diagram-inline")), false);

    press("Escape");
    check("Escape comes back out to the group it went into", ringed(), 2);
    check("...as the group, not as two boxes", legend(), "Group");

    press("Escape");
    check("...and again lets go of it altogether", ringed(), 0);

    /* Pressing the paper is the other way back to the top. Standing inside a
     * group with nothing in it selected is standing somewhere you cannot see,
     * and the next press on a box would quietly reach past a group it looks
     * like it should have taken.
     */
    await apart();
    tap("A");
    tap("A");
    const away = onScreen(700, 520);
    canvas.dispatchEvent(new window.MouseEvent("pointerdown", at(away[0], away[1])));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(away[0], away[1])));
    await apart();
    tap("A");
    check("a press on the paper comes back out to the top of the diagram", ringed(), 2);

    // Shift reaches exactly as far as a press does, so it cannot quietly take
    // half a group.
    await apart();
    tap("C");
    tap("A", { shiftKey: true });
    check("shift on a box in a group adds the whole group", ringed(), 3);

    press("Escape");

    /* --- the tree ------------------------------------------------------------ */

    /* A flat list cannot show a group at all, so the list is the tree: what is
     * at the top level, then each group with its contents under it. Which is
     * the order the file is written in, read the same way in both places.
     */
    const rows = () => page.document.querySelector(".ve-diagram-rail .ve-diagram-branches");
    const shape = () => [...rows().querySelectorAll(".ve-diagram-leaf")]
      .map((row) => [row.dataset.groupId || row.dataset.nodeId,
        Number(row.style.getPropertyValue("--dd-depth"))]);
    const clickOn = (element) =>
      element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    // Down the left, beside the shapes, because it is about what the diagram is
    // made of — and always there, rather than behind a fold-out.
    check("the tree is down the side without being asked for", Boolean(rows()), true);
    check("...with the group as a row of its own and its boxes indented under it",
      shape(), [["C", 0], ["group1", 0], ["A", 1], ["B", 1]]);

    /* A row is a picture and a name and nothing else. It used to carry a field,
     * a menu and a button each, which turned a list of three boxes into nine
     * controls to look past — and every one of them is in the panel on the
     * other side already, aimed at whatever this is pointing at.
     */
    check("...and a row is a picture and a name, not a form",
      [...rows().querySelectorAll("input, select, textarea")].length, 0);

    await apart();
    tap("A");
    check("...and the group's row marked, along with what it holds",
      [...rows().querySelectorAll(".is-picked")]
        .map((row) => row.dataset.groupId || row.dataset.nodeId), ["group1", "A", "B"]);

    const twist = () => rows().querySelector(".ve-diagram-branch .ve-diagram-twist");
    clickOn(twist());
    check("folding a group away takes what is in it with it", shape(), [["C", 0], ["group1", 0]]);
    clickOn(twist());
    check("...and unfolding brings it back",
      shape(), [["C", 0], ["group1", 0], ["A", 1], ["B", 1]]);

    // The tree names the box itself, so it holds the box itself — no descent
    // needed, because the row said which one it meant.
    clickOn(rows().querySelector('.ve-diagram-leaf[data-node-id="A"]'));
    check("holding a box from the tree holds the box, not the group round it", ringed(), 1);

    press("Escape");
    check("...and Escape from there still comes out to the group", ringed(), 2);
    press("Escape");

    /* --- moving it ---------------------------------------------------------- */

    const wasFrame = frameBox();
    const [nx, ny] = nameSpot();
    canvas.dispatchEvent(new window.MouseEvent("pointerdown", at(nx, ny)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(nx + 40, ny + 60)));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(nx + 40, ny + 60)));

    check("dragging the name carries the boxes", placed("A"), [140, 160]);
    check("...both of them", placed("B"), [340, 160]);
    check("...and not the one outside", placed("C"), [100, 300]);
    check("...with the frame following, the same size it was",
      [frameBox()[0] - wasFrame[0], frameBox()[1] - wasFrame[1],
        frameBox()[2] - wasFrame[2], frameBox()[3] - wasFrame[3]], [40, 60, 0, 0]);

    /* --- the name ------------------------------------------------------------ */

    pressName();
    const field = inspector.querySelector(".ve-diagram-group-name");
    check("the panel has the group's name in it to change", field?.value, "Group 1");
    field.value = "Back end";
    field.dispatchEvent(new window.Event("input", { bubbles: true }));
    check("...and typing in it renames the group on the paper", nameOn(), "Back end");

    const renamed = await savedNow();
    check("...and in the file, with the id it has always had",
      renamed.includes("subgraph group1 [Back end]"), true);

    /* --- nesting -------------------------------------------------------------- */

    await apart();
    tap("A");
    tap("A");
    tap("B", { shiftKey: true });
    check("inside a group, the boxes in it are picked up one at a time", ringed(), 2);
    press("g", { ctrlKey: true });
    check("grouping part of a group nests rather than escaping it",
      canvas.querySelectorAll(".dd-group").length, 2);

    const nestedFile = await savedNow();
    check("...which the file says by putting one inside the other",
      /subgraph group1[^]*subgraph group2[^]*end[^]*end/.test(nestedFile), true);

    const frames = () => [...canvas.querySelectorAll(".dd-group-box")]
      .map((rect) => Number(rect.getAttribute("width")));
    check("...and the outer frame goes round the inner one, not round its boxes",
      Math.max(...frames()) - Math.min(...frames()), 36);

    // The outer group holds no box directly — only the group inside it — and
    // its name still takes hold of everything under it.
    pressName();
    check("...whose name still holds everything under it, however deep", ringed(), 2);

    /* --- taking the name off again --------------------------------------------- */

    press("g", { ctrlKey: true, shiftKey: true });
    check("ungrouping takes the name off what is held", canvas.querySelectorAll(".dd-group").length, 1);
    // The inner one, because both hold exactly these two boxes and the one you
    // meant is the closer of the two. Taking the outer instead would leave the
    // group that was just made and lose the one it was made inside.
    check("...the inner one, leaving the group it was made inside", nameOn(), "Back end");
    check("...and leaves the boxes exactly where they were", placed("A"), [140, 160]);

    press("g", { ctrlKey: true, shiftKey: true });
    check("...and again takes off the one above it", canvas.querySelectorAll(".dd-group").length, 0);

    const flat = await savedNow();
    check("...leaving a file with no subgraph in it at all", /subgraph/.test(flat), false);
    check("...and every box still in it", [/A\[One\]/, /B\[Two\]/, /C\[Three\]/]
      .every((one) => one.test(flat)), true);

    /* --- the tree's own buttons ---------------------------------------------- */

    press("Escape");
    await apart();
    tap("A");
    tap("B", { shiftKey: true });
    press("g", { ctrlKey: true });

    // A name is typed where the name is written, and only while it is being
    // typed: the row goes back to being a row afterwards.
    const branchName = () => rows().querySelector(".ve-diagram-branch .ve-diagram-leaf-name");
    branchName().dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true }));

    const typing = rows().querySelector(".ve-diagram-leaf-field");
    check("a group's name is typed in the tree, in a field that was not there before",
      typing.value, "Group 1");

    typing.value = "Whole thing";
    typing.dispatchEvent(new window.KeyboardEvent("keydown",
      { key: "Enter", bubbles: true, cancelable: true }));
    check("...and it is the group's name on the paper afterwards", nameOn(), "Whole thing");
    check("...with the row back to being a row",
      [Boolean(rows().querySelector(".ve-diagram-leaf-field")), branchName().textContent],
      [false, "Whole thing"]);

    /* --- locking -------------------------------------------------------------- */

    /* A locked group is not what a press on the paper picks up. Locked is not
     * hidden and it is not gone: the paper is simply what is under it, and the
     * tree can still hold it, which is where the lock comes off again.
     */
    const lockButton = () => rows().querySelector(".ve-diagram-branch .ve-diagram-lock");
    check("a group is unlocked until it is locked",
      lockButton().getAttribute("aria-pressed"), "false");

    clickOn(lockButton());
    check("...and says so once it is", lockButton().getAttribute("aria-pressed"), "true");

    press("Escape");
    await apart();
    tap("A");
    check("a press on a locked group's box picks up nothing at all", ringed(), 0);

    const locked = await savedNow();
    check("...which the file says beside the group rather than inside it",
      locked.includes("%% group group1 lock=1"), true);
    check("...leaving the subgraph itself ordinary Mermaid",
      /subgraph group1 \[Whole thing\]/.test(locked), true);

    // Still there to be found, and still the way to let it go again.
    clickOn(rows().querySelector('.ve-diagram-leaf[data-node-id="A"]'));
    check("the tree can still hold what the paper will not", ringed(), 1);
    press("Delete");
    check("...but a locked box is not deleted by holding it",
      canvas.querySelectorAll(".dd-node").length, 3);

    clickOn(lockButton());
    check("...and the lock comes off from the same button",
      lockButton().getAttribute("aria-pressed"), "false");

    press("Escape");
    await apart();
    tap("A");
    check("...leaving the group there to be picked up again", ringed(), 2);

    /* --- a group with nothing left in it ----------------------------------------- */

    check("a group again", canvas.querySelectorAll(".dd-group").length, 1);

    pressName();
    press("Delete");
    check("taking the last box out of a group takes the group with it",
      canvas.querySelectorAll(".dd-group").length, 0);

    const emptied = await savedNow();
    check("...and the file has no empty subgraph left in it", /subgraph/.test(emptied), false);
    check("...only the box that was never in one", /C\[Three\]/.test(emptied), true);
  }

  console.log("=== the way in and the way back ===");
  {
    const appSource = readAppSource(ROOT);

    check("a diagram in a document has a way out to the page",
      /ve-embed-build/.test(appSource), true);
    // One way in, and it is that one. The canvas used to open inside the block
    // as well, in a strip too small for what it has grown into.
    check("...and no second way that opens it in the block instead",
      /openDiagramBuilder/.test(appSource), false);
    check("...which leaves the document where the page will look for it",
      /stashDocument\(state\.pageEdit\.file, markdown\)/.test(appSource), true);
    check("...and the document editor picks it back up",
      /takeStashedDocument\(file\)/.test(appSource), true);
    // Left behind, it would be picked up by an edit weeks later and quietly
    // undo whatever happened in between.
    check("...taking it rather than reading it",
      /removeItem\(diagramStashKey\(file\)\)/.test(appSource), true);
    check("a .mmd file opens on the page rather than in a text box",
      /\/diagram\/file\/\$\{docUrl\(state\.activeFile\)\}/.test(appSource), true);
  }
};
