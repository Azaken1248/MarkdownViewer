// Part of the diagram-page suite. See diagram-page.test.js, which sets all this
// up and calls it.
//
// Resizing, the two sides of the screen, looking at part of a diagram, and
// editing a handful of boxes at once.
//
// Everything it needs is handed to it: the suite's own check(), the helpers
// that boot a page and drag a box, and the fixtures. Split out of one file only
// because that file had grown well past a thousand lines.
module.exports = async (ctx) => {
  const {
    check, server, cookie, origin, openPage, saveAndWait, csrfFor
  } = ctx;

  console.log("=== a box is resized by any of its edges, and lines up doing it ===");
  {
    /* A box had one grip, on its bottom-right corner, so making it wider always
     * made it taller as well. And a resize was the one drag that snapped to
     * nothing: a box could be dragged to within a pixel of lining up with its
     * neighbour and there was nothing to say so.
     */
    await server.request("POST", "/api/docs",
      { fileName: "grips.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 100x100",
        // Off the grid on purpose, both of them: a box whose edges are all
        // multiples of ten is a box that cannot tell snapping to the grid from
        // lining up with a neighbour.
        "    %% @ B 403,344 100x100",
        // Three pixels from A's left edge, at the point below where a side grip
        // is dragged — near enough to line up with, if that edge were moving.
        "    %% @ C 153,700 20x100",
        "    A[One]",
        "    B[Two]",
        "    C[Three]"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/grips.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const view = () => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\) scale\(([\d.]+)\)/
        .exec(canvas.querySelector(".dd-view").getAttribute("transform"));
      return { x: Number(found[1]), y: Number(found[2]), scale: Number(found[3]) };
    };
    const at = (x, y) => ({
      clientX: (x * view().scale) + view().x,
      clientY: (y * view().scale) + view().y,
      bubbles: true
    });

    const groupOf = (id) => canvas.querySelector(`.dd-node[data-id="${id}"]`);
    const boxOf = (id) => {
      const spot = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(groupOf(id).getAttribute("transform"));
      const rect = groupOf(id).querySelector("rect");
      return [Number(spot[1]), Number(spot[2]),
        Number(rect.getAttribute("width")), Number(rect.getAttribute("height"))];
    };

    const grip = (name) => canvas.querySelector(`.dd-resize[data-grip="${name}"]`);
    const guides = () => canvas.querySelectorAll(".dd-guides .dd-guide").length;

    let letGoAt = [0, 0];
    const drag = (name, dx, dy, { hold = false } = {}) => {
      const one = grip(name);
      const x = Number(one.getAttribute("cx"));
      const y = Number(one.getAttribute("cy"));
      letGoAt = [x + dx, y + dy];
      one.dispatchEvent(new window.MouseEvent("pointerdown", at(x, y)));
      canvas.dispatchEvent(new window.MouseEvent("pointermove", at(...letGoAt)));
      if (!hold) {
        canvas.dispatchEvent(new window.MouseEvent("pointerup", at(...letGoAt)));
      }
    };

    // Let go where the hand actually is. Releasing somewhere else is a resize to
    // somewhere else: the size is settled from the point the drag ended at.
    const letGo = () => canvas.dispatchEvent(
      new window.MouseEvent("pointerup", at(...letGoAt)));

    groupOf("A").dispatchEvent(new window.MouseEvent("pointerdown", at(150, 150)));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(150, 150)));
    check("a box starts where the file put it", boxOf("A"), [100, 100, 100, 100]);

    // A side grip drags one edge. The other three stay exactly where they were,
    // which is the whole of what makes it a side rather than a corner.
    drag("e", 60, 0);
    check("dragging the right edge makes it wider and nothing else",
      boxOf("A"), [100, 100, 160, 100]);

    drag("s", 0, 40);
    check("...and the bottom edge taller and nothing else",
      boxOf("A"), [100, 100, 160, 140]);

    /* The left and the top move the box as well as resize it: the edge you are
     * dragging is the one that moves, so the one you are not has to stay put.
     */
    drag("w", -50, 0);
    check("dragging the left edge moves that edge, not the right one",
      boxOf("A"), [50, 100, 210, 140]);

    drag("n", -30, -30);
    check("...and the top edge the same, ignoring the across it was given",
      boxOf("A"), [50, 70, 210, 170]);

    // A corner drags two edges at once, which is what it always did.
    drag("se", -60, -50);
    check("a corner still drags both of its edges",
      boxOf("A"), [50, 70, 150, 120]);

    /* A box that has hit its smallest must not walk. The edge being dragged is
     * the one that gives way, so the edge that is not being dragged stays where
     * it is however far the hand keeps going.
     */
    drag("w", 900, 0);
    check("a box dragged past its smallest stops at its smallest",
      boxOf("A"), [150, 70, page.window.DiagramEditor.MIN_BOX, 120]);
    check("...with the edge that was not being dragged still where it was",
      boxOf("A")[0] + boxOf("A")[2], 200);

    drag("n", 0, 900);
    check("...and the same going the other way, on the other axis",
      boxOf("A"), [150, 165, 50, 25]);

    /* Lining up. The same six lines a move is snapped to, but only the edge
     * being dragged may be put on one of them: snapping an edge that is not
     * moving would move it, which is a resize that also drags the box sideways.
     *
     * Both boxes to line up against are off the grid, so a line that came from
     * the grid and a line that came from a neighbour are telling apart.
     */
    const frame = () => new Promise((done) => window.requestAnimationFrame(
      () => window.requestAnimationFrame(done)));

    check("nothing is being lined up before anything is dragged", guides(), 0);

    // The bottom edge to within three of B's top, and the left edge left alone
    // three from C's — one of those is moving and the other is not.
    drag("s", 0, 344 - 190 - 3, { hold: true });
    await frame();

    check("an edge dragged near another box's edge snaps onto it, rather than"
      + " onto the grid it would otherwise land on",
      boxOf("A")[1] + boxOf("A")[3], 344);
    check("...and the edge that is not being dragged stays exactly where it was",
      boxOf("A")[0], 150);
    check("...with one line drawn, about the edge that moved",
      guides(), 1);
    check("...which is the line across, since it is the bottom edge that moved",
      [...canvas.querySelectorAll(".dd-guides .dd-guide")]
        .every((one) => one.getAttribute("y1") === one.getAttribute("y2")), true);

    letGo();
    check("letting go takes the lines away", guides(), 0);

    /* A box cannot line up with itself.
     *
     * Every edge of the box being resized is within nothing of where it already
     * is, so a box allowed to line up with itself is a box whose edges snap
     * back the moment they are nudged — and a small resize becomes impossible.
     * A's top is at 165, off the grid, with nothing else near it.
     */
    drag("n", 0, 4);
    check("a small drag moves the edge rather than snapping it back to itself",
      boxOf("A"), [150, 170, 50, 174]);

    // And the same the other way about: a right edge to a neighbour's left.
    drag("e", 403 - 200 - 3, 0, { hold: true });
    await frame();
    check("a right edge lines up with a left one just as well",
      boxOf("A")[0] + boxOf("A")[2], 403);
    check("...saying so with the line down", guides(), 1);

    letGo();

    // With nothing to line up against, the grid catches the edge — which is
    // what keeps a diagram tidy where no neighbour is near enough to help.
    drag("s", 0, 23);
    check("an edge with nothing near it lands on the grid",
      boxOf("A")[1] + boxOf("A")[3], 370);

    drag("e", 23, 0);
    check("...going across as well as down",
      boxOf("A")[0] + boxOf("A")[2], 430);

    page.window.close();
  }

  console.log("=== the two sides move, and go away, and are remembered ===");
  {
    /* How much room somebody wants for the shapes is about their screen and
     * their hands rather than about the drawing, so it is kept in the browser
     * and not in the file — a diagram that carried it would hand one person's
     * window to everyone who opened it.
     */
    await server.request("POST", "/api/docs",
      { fileName: "sides.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 100x60",
        "    A[One]"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/sides.mmd`, cookie, origin });
    const { window } = page;
    const body = page.document.querySelector(".ve-diagram-body");
    const grip = (which) => page.document.querySelector(`.ve-diagram-grip-${which}`);
    const shut = (which) => grip(which).querySelector(".ve-diagram-grip-shut");
    const wide = (which) => body.style.getPropertyValue(`--dd-${which}`);

    check("the two sides start at the width they were given",
      [wide("rail"), wide("side")], ["196px", "300px"]);
    check("...with a bar between each of them and the paper",
      [...body.children].map((one) => one.className.split(" ")[0]),
      ["ve-diagram-rail", "ve-diagram-grip", "ve-diagram-stage",
        "ve-diagram-grip", "ve-diagram-side"]);

    // A separator rather than a decoration: an edge that can only be dragged is
    // an edge that belongs to whoever has a mouse.
    check("a bar is something the keyboard can reach",
      [grip("rail").getAttribute("role"), grip("rail").tabIndex], ["separator", 0]);

    const drag = (which, from, to) => {
      grip(which).dispatchEvent(new window.MouseEvent("pointerdown",
        { clientX: from, bubbles: true }));
      grip(which).dispatchEvent(new window.MouseEvent("pointermove",
        { clientX: to, bubbles: true }));
      grip(which).dispatchEvent(new window.MouseEvent("pointerup",
        { clientX: to, bubbles: true }));
    };

    drag("rail", 196, 256);
    check("dragging the rail's bar to the right widens the rail", wide("rail"), "256px");

    // The rail's edge is on its right and the panel's on its left, so the same
    // drag widens one and narrows the other.
    drag("side", 600, 660);
    check("...and dragging the panel's bar the same way narrows the panel",
      wide("side"), "240px");

    drag("rail", 256, 9000);
    check("neither can be dragged wider than it is allowed", wide("rail"), "320px");
    drag("rail", 320, -9000);
    check("...nor narrower", wide("rail"), "56px");
    check("...and a rail too narrow for the words shows the pictures alone",
      body.classList.contains("is-rail-tight"), true);

    // The arrow keys move it too, by a step rather than by a pixel.
    grip("rail").dispatchEvent(new window.KeyboardEvent("keydown",
      { key: "ArrowRight", bubbles: true }));
    check("an arrow key moves the edge as well", wide("rail"), "76px");

    /* Shut, a region is gone and its bar is all that is left of it — which is
     * what makes it something you can bring back rather than something you
     * have lost.
     */
    shut("side").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("the chevron takes a side away", body.classList.contains("is-side-shut"), true);
    check("...leaving the bar that brings it back",
      Boolean(grip("side")), true);
    check("...which says it is the way back",
      shut("side").getAttribute("aria-expanded"), "false");

    shut("side").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("and brings it back the width it was",
      [body.classList.contains("is-side-shut"), wide("side")], [false, "240px"]);

    // Kept in the browser, so the next diagram opens the way the last one was
    // left. A place that will not keep it is a place where the panels still
    // work, so every read and write of it is allowed to fail.
    const kept = JSON.parse(window.localStorage.getItem("azadocs:diagram:panels"));
    check("what was left is written down", [kept.rail, kept.side], [76, 240]);

    const wideOf = (one, which) =>
      one.document.querySelector(".ve-diagram-body").style.getPropertyValue(`--dd-${which}`);

    const again = await openPage({ url: `${origin}/diagram/file/sides.mmd`, cookie, origin,
      panels: window.localStorage.getItem("azadocs:diagram:panels") });
    check("...and the next diagram opens the way the last one was left",
      [wideOf(again, "rail"), wideOf(again, "side")], ["76px", "240px"]);

    // Nothing kept, or nothing readable, is the standard widths rather than a
    // panel that will not open.
    const fresh = await openPage({ url: `${origin}/diagram/file/sides.mmd`, cookie, origin });
    check("a browser holding nothing opens at the widths it was built with",
      [wideOf(fresh, "rail"), wideOf(fresh, "side")], ["196px", "300px"]);

    const bad = await openPage({ url: `${origin}/diagram/file/sides.mmd`, cookie, origin,
      panels: "{not json" });
    check("...and so does one holding something it cannot read",
      [wideOf(bad, "rail"), wideOf(bad, "side")], ["196px", "300px"]);

    const daft = await openPage({ url: `${origin}/diagram/file/sides.mmd`, cookie, origin,
      panels: JSON.stringify({ rail: 99999, side: -4 }) });
    check("...and one holding a width no panel may be is held to what it may",
      [wideOf(daft, "rail"), wideOf(daft, "side")], ["320px", "200px"]);

    daft.window.close();
    bad.window.close();
    fresh.window.close();
    again.window.close();
    page.window.close();
  }

  console.log("=== the diagram is somewhere you are looking at part of ===");
  {
    await server.request("POST", "/api/docs",
      { fileName: "wide.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 120x60",
        "    %% @ B 100,400 120x60",
        "    A[One]",
        "    B[Two]",
        "    A --> B"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/wide.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const svg = () => canvas.querySelector("svg");
    const view = () => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\) scale\(([\d.]+)\)/
        .exec(svg().querySelector(".dd-view").getAttribute("transform"));
      return { x: Number(found[1]), y: Number(found[2]), scale: Number(found[3]) };
    };

    // The harness reports a 900x600 canvas, and the diagram is 320 tall by the
    // time its margins are counted, so the whole of it fits without magnifying.
    check("a diagram opens with the whole of it in view", view().scale, 1);
    check("...centred on where the diagram is, not on where a picture of it would be",
      [Math.round(view().x), Math.round(view().y)], [290, 20]);

    const source = () => window.eval("document.getElementById('diagramSave').disabled");
    check("looking at a diagram is not editing it", source(), true);

    /* --- panning ---------------------------------------------------------- */

    const at = (x, y, extra = {}) => ({ clientX: x, clientY: y, bubbles: true, ...extra });
    const started = view();

    const finger = (type, x, y, id = 9) => {
      const event = new window.MouseEvent(type, at(x, y, { cancelable: true }));
      Object.defineProperty(event, "pointerType", { value: "touch" });
      Object.defineProperty(event, "pointerId", { value: id });
      return event;
    };

    // The empty paper, under a finger. A finger has no space bar and no middle
    // button, so dragging the paper is the only way it can go anywhere.
    canvas.dispatchEvent(finger("pointerdown", 700, 500));
    canvas.dispatchEvent(finger("pointermove", 760, 460));
    await new Promise((r) => setTimeout(r, 60));
    canvas.dispatchEvent(finger("pointerup", 760, 460));

    check("dragging the paper with a finger moves the view by exactly that much",
      [view().x - started.x, view().y - started.y], [60, -40]);
    check("...at the same zoom it was", view().scale, started.scale);
    check("...and moves nothing in the diagram", source(), true);

    /* --- zooming ---------------------------------------------------------- */

    const before = view();
    const aimed = { x: 400, y: 300 };
    // What the pointer is over, in the diagram, before the wheel turns.
    const under = {
      x: (aimed.x - before.x) / before.scale,
      y: (aimed.y - before.y) / before.scale
    };

    canvas.dispatchEvent(new window.window.WheelEvent("wheel",
      { clientX: aimed.x, clientY: aimed.y, deltaY: -100, ctrlKey: true,
        bubbles: true, cancelable: true }));

    const zoomed = view();
    check("Ctrl and the wheel zooms in", zoomed.scale > before.scale, true);
    // The whole point of zooming about the pointer: the thing you are pointing
    // at is the thing that stays put, and everything else moves around it.
    check("...about the pointer, so what was under it still is", [
      Math.round(((under.x * zoomed.scale) + zoomed.x) - aimed.x),
      Math.round(((under.y * zoomed.scale) + zoomed.y) - aimed.y)
    ], [0, 0]);

    canvas.dispatchEvent(new window.window.WheelEvent("wheel",
      { clientX: aimed.x, clientY: aimed.y, deltaY: 100, ctrlKey: true,
        bubbles: true, cancelable: true }));
    check("...and the other way turns it back", Math.round(view().scale * 1000),
      Math.round(before.scale * 1000));

    /* --- and a bare wheel moves about ---------------------------------------
     *
     * Which is what it means in Figma, in Canva and in every map anybody has
     * scrolled. It used to zoom, and that left a diagram zoomed away to one
     * side with no way back: the only thing the wheel could do was zoom it
     * further away.
     */
    const still = view();
    canvas.dispatchEvent(new window.window.WheelEvent("wheel",
      { clientX: aimed.x, clientY: aimed.y, deltaY: 120, bubbles: true, cancelable: true }));
    check("a bare wheel moves the diagram rather than zooming it",
      [view().x - still.x, view().y - still.y], [0, -120]);
    check("...at the zoom it was already at", view().scale, still.scale);

    canvas.dispatchEvent(new window.window.WheelEvent("wheel",
      { clientX: aimed.x, clientY: aimed.y, deltaX: -80, bubbles: true, cancelable: true }));
    check("...and a trackpad pushed sideways moves it sideways",
      [view().x - still.x, view().y - still.y], [80, -120]);

    /* A mouse with one wheel says sideways with Shift, and the browsers do not
     * agree on how to spell it: some translate it to deltaX themselves, some
     * send deltaY with shiftKey set. Both have to be read, or half the mice in
     * the world scroll nothing at all.
     */
    canvas.dispatchEvent(new window.window.WheelEvent("wheel",
      { clientX: aimed.x, clientY: aimed.y, deltaY: 50, shiftKey: true,
        bubbles: true, cancelable: true }));
    check("...as does a wheel with only one direction and Shift held",
      [view().x - still.x, view().y - still.y], [30, -120]);

    check("the grid moves with the diagram rather than staying behind it",
      svg().querySelector("pattern").getAttribute("patternTransform"),
      svg().querySelector(".dd-view").getAttribute("transform"));

    check("zooming is not editing either", source(), true);

    /* --- the readout ------------------------------------------------------ */

    const field = page.document.querySelector(".ve-diagram-zoom-value");
    check("the zoom says what it is", field.value, "100%");

    field.value = "250";
    field.dispatchEvent(new window.Event("change", { bubbles: true }));
    check("...and can be told what to be", view().scale, 2.5);
    check("...saying so afterwards in the same words", field.value, "250%");

    // Free, not stepped: a zoom that clicks through fixed sizes cannot stop
    // where the thing being worked on happens to fit.
    field.value = "137";
    field.dispatchEvent(new window.Event("change", { bubbles: true }));
    check("a zoom can be any size at all", view().scale, 1.37);

    field.value = "9000";
    field.dispatchEvent(new window.Event("change", { bubbles: true }));
    check("...up to a point", view().scale, 8);
    field.value = "0.01";
    field.dispatchEvent(new window.Event("change", { bubbles: true }));
    check("...and down to one", view().scale, 0.1);
    field.value = "not a number";
    field.dispatchEvent(new window.Event("change", { bubbles: true }));
    check("...and nonsense leaves it where it was", view().scale, 0.1);

    /* --- fit -------------------------------------------------------------- */

    const fit = [...page.document.querySelectorAll(".ve-diagram-zoom .ve-diagram-icon")].pop();
    fit.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    // The diagram is 120 wide by 360 tall and its top-left corner is at
    // (100, 100). In a 900x600 window that fits at life size, centred — which
    // is a fit of the diagram where it actually is, not of a rectangle that
    // starts at the origin and happens to contain it.
    check("fit puts the whole diagram back in view", view().scale, 1);
    check("...centred on the diagram itself, wherever it happens to be",
      [Math.round(view().x), Math.round(view().y)], [290, 20]);

    /* --- the space bar ----------------------------------------------------- */

    const box = canvas.querySelector('.dd-node[data-id="A"]');
    const boxAt = () => /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(box.getAttribute("transform"));
    const wasAt = boxAt()[0];
    const held = view();

    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: " ", bubbles: true }));
    // The same press that would have moved a box, with space held down.
    box.dispatchEvent(new window.MouseEvent("pointerdown", at(200, 200)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(230, 210)));
    await new Promise((r) => setTimeout(r, 60));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(230, 210)));

    check("space held turns a drag on a box into a pan",
      [view().x - held.x, view().y - held.y], [30, 10]);

    // Coalesced to one update per frame, and letting go used to throw away
    // whatever had not been drawn yet — so a flick quicker than a frame was a
    // pan that never happened.
    const flickFrom = view();
    box.dispatchEvent(new window.MouseEvent("pointerdown", at(200, 200)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(260, 250)));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(260, 250)));
    check("...and a flick quicker than a frame is a pan all the same",
      [view().x - flickFrom.x, view().y - flickFrom.y], [60, 50]);
    check("...and leaves the box exactly where it was",
      canvas.querySelector('.dd-node[data-id="A"]').getAttribute("transform"), wasAt);
    check("...and the diagram unedited", source(), true);

    canvas.dispatchEvent(new window.KeyboardEvent("keyup", { key: " ", bubbles: true }));
    const after = view();
    box.dispatchEvent(new window.MouseEvent("pointerdown", at(200, 200)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(230, 210)));
    await new Promise((r) => setTimeout(r, 60));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(230, 210)));
    check("...and letting go of it gives the box back",
      [view().x - after.x, view().y - after.y], [0, 0]);
    check("...which is an edit, unlike everything above it", source(), false);

    /* --- a pixel is not a unit ---------------------------------------------- */

    // Looked at twice life size, a box dragged a hundred pixels across the
    // screen has moved fifty in the diagram — and it is the diagram the file
    // records. This is the one place the zoom has to be divided out rather than
    // cancelling itself in a difference.
    field.value = "200";
    field.dispatchEvent(new window.Event("change", { bubbles: true }));

    const magnified = canvas.querySelector('.dd-node[data-id="B"]');
    const wasThere = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(magnified.getAttribute("transform"));

    magnified.dispatchEvent(new window.MouseEvent("pointerdown", at(300, 300)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(400, 380)));
    await new Promise((r) => setTimeout(r, 80));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(400, 380)));

    const nowThere = /translate\((-?[\d.]+),(-?[\d.]+)\)/
      .exec(canvas.querySelector('.dd-node[data-id="B"]').getAttribute("transform"));
    check("a box dragged at twice life size moves half as far in the diagram",
      [Number(nowThere[1]) - Number(wasThere[1]), Number(nowThere[2]) - Number(wasThere[2])],
      [50, 40]);

    fit.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    /* --- the middle button -------------------------------------------------- */

    const middled = view();
    canvas.dispatchEvent(new window.MouseEvent("pointerdown", at(200, 200, { button: 1 })));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(150, 250)));
    await new Promise((r) => setTimeout(r, 60));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(150, 250)));
    check("the middle button pans wherever it is pressed",
      [view().x - middled.x, view().y - middled.y], [-50, 50]);

    /* --- two fingers -------------------------------------------------------- */

    // A pinch begins as one finger doing something else, and the something else
    // has to be abandoned rather than finished — otherwise every pinch leaves a
    // box wherever the first finger happened to be when the second arrived.
    const pinched = view();
    const touch = (type, id, x, y) => {
      const event = new window.MouseEvent(type, at(x, y, { cancelable: true }));
      Object.defineProperty(event, "pointerType", { value: "touch" });
      Object.defineProperty(event, "pointerId", { value: id });
      return event;
    };

    // Saved first, so that what the file says about where A is, is what it said
    // before any of this — and a pinch that moved it has somewhere to show.
    await saveAndWait(page);
    const placedBefore = /%% @ A (-?\d+),(-?\d+)/
      .exec((await server.request("GET", "/api/docs/wide.mmd", undefined, { Cookie: cookie })).body.content);

    canvas.querySelector('.dd-node[data-id="A"]').dispatchEvent(touch("pointerdown", 1, 400, 300));
    canvas.dispatchEvent(touch("pointerdown", 2, 500, 300));
    canvas.dispatchEvent(touch("pointermove", 1, 350, 300));
    canvas.dispatchEvent(touch("pointermove", 2, 550, 300));
    canvas.dispatchEvent(touch("pointerup", 1, 350, 300));
    canvas.dispatchEvent(touch("pointerup", 2, 550, 300));
    await new Promise((r) => setTimeout(r, 60));

    check("fingers moving apart zoom in", view().scale > pinched.scale, true);
    check("...about the point between them",
      [Math.round(((450 - pinched.x) / pinched.scale * view().scale) + view().x),
        Math.round(((300 - pinched.y) / pinched.scale * view().scale) + view().y)], [450, 300]);

    // The finger that started on a box was doing something else, and two
    // fingers are a different intention. Finishing what the first one started
    // would leave a box wherever it happened to be when the second arrived —
    // which the drawing would not show for another quarter of a second, so this
    // asks the file rather than the screen.
    await saveAndWait(page);
    const placedAfter = /%% @ A (-?\d+),(-?\d+)/
      .exec((await server.request("GET", "/api/docs/wide.mmd", undefined, { Cookie: cookie })).body.content);
    check("...and the finger that was on a box does not take it along",
      [placedAfter[1], placedAfter[2]], [placedBefore[1], placedBefore[2]]);
  }

  console.log("=== a diagram is edited in handfuls as often as one box at a time ===");
  {
    await server.request("POST", "/api/docs",
      { fileName: "grid.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 80x40",
        "    %% @ B 300,100 80x40",
        "    %% @ C 100,300 80x40",
        "    %% @ D 300,300 80x40",
        "    A[One]",
        "    B[Two]",
        "    C[Three]",
        "    D[Four]",
        "    A --> B"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/grid.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const at = (x, y, extra = {}) => ({ clientX: x, clientY: y, bubbles: true, ...extra });
    const box = (id) => canvas.querySelector(`.dd-node[data-id="${id}"]`);
    const placed = (id) => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(box(id).getAttribute("transform"));
      return [Number(found[1]), Number(found[2])];
    };
    const ringed = () => canvas.querySelectorAll(".dd-ring").length;
    const framed = () => canvas.querySelectorAll(".dd-frame").length;

    // The view is fitted, so a point in the diagram is a point on the screen
    // plus wherever the fit put it.
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

    check("nothing is selected to begin with", [ringed(), framed()], [0, 0]);

    tap("A");
    check("tapping a box selects it, and only it", [ringed(), framed()], [1, 0]);
    // One to draw an arrow with, and eight to resize by: four corners and four
    // sides, because a box you can only resize diagonally is a box you cannot
    // make wider without also making it taller.
    check("...with the handles that belong to one box",
      [canvas.querySelectorAll(".dd-marks [data-role=connect]").length,
        canvas.querySelectorAll(".dd-marks [data-role=resize]").length], [1, 8]);
    check("...one on every side and one on every corner",
      [...canvas.querySelectorAll(".dd-marks [data-role=resize]")]
        .map((one) => one.dataset.grip),
      ["nw", "n", "ne", "w", "e", "sw", "s", "se"]);

    tap("B", { shiftKey: true });
    check("shift adds a second", [ringed(), framed()], [2, 1]);
    // Connecting and resizing are things you do to a box. Offering them on a
    // selection of four would be offering something that has no meaning yet.
    check("...and the handles go away, because they are about one box",
      canvas.querySelectorAll("[data-role]").length, 0);

    tap("B", { shiftKey: true });
    check("shift on one that is already in takes it back out", [ringed(), framed()], [1, 0]);

    /* --- the rubber band --------------------------------------------------- */

    const band = (x1, y1, x2, y2, extra = {}) => {
      const [sx, sy] = onScreen(x1, y1);
      const [ex, ey] = onScreen(x2, y2);
      canvas.dispatchEvent(new window.MouseEvent("pointerdown", at(sx, sy, extra)));
      canvas.dispatchEvent(new window.MouseEvent("pointermove", at(ex, ey, extra)));
      canvas.dispatchEvent(new window.MouseEvent("pointerup", at(ex, ey, extra)));
    };

    // A band drawn round the top two boxes, from empty paper above and left of
    // them to empty paper below and right.
    band(60, 60, 420, 180);
    check("a band round two boxes takes both", [ringed(), framed()], [2, 1]);

    band(60, 60, 200, 180);
    check("...and one round one takes one", [ringed(), framed()], [1, 0]);

    // Touched, not swallowed whole: a band you have to draw carefully is a band
    // that is no easier than clicking the boxes one at a time.
    band(60, 60, 140, 120);
    check("a band that only clips a box still takes it", [ringed(), framed()], [1, 0]);

    // A hand that moves two pixels while letting go of the paper has clicked
    // the paper, not drawn a band round the corner of the box next to it.
    band(99, 99, 102, 102);
    check("a press on the paper that wobbles is still a press on the paper",
      [ringed(), framed()], [0, 0]);

    band(60, 60, 420, 400);
    check("a band round everything takes everything", [ringed(), framed()], [4, 1]);

    band(600, 500, 700, 560);
    check("a band round nothing takes nothing", [ringed(), framed()], [0, 0]);

    tap("A");
    band(240, 240, 420, 400, { shiftKey: true });
    check("shift adds what a band catches to what was already there",
      [ringed(), framed()], [2, 1]);

    /* --- select all, and let go -------------------------------------------- */

    canvas.dispatchEvent(new window.KeyboardEvent("keydown",
      { key: "a", ctrlKey: true, bubbles: true }));
    check("select all selects all", [ringed(), framed()], [4, 1]);

    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    check("escape lets go of all of it", [ringed(), framed()], [0, 0]);

    /* --- dragging a handful ------------------------------------------------ */

    canvas.dispatchEvent(new window.KeyboardEvent("keydown",
      { key: "a", metaKey: true, bubbles: true }));

    const was = { A: placed("A"), B: placed("B"), C: placed("C"), D: placed("D") };
    const [gx, gy] = onScreen(...was.A);
    box("A").dispatchEvent(new window.MouseEvent("pointerdown", at(gx + 10, gy + 10)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(gx + 70, gy + 50)));
    await new Promise((r) => setTimeout(r, 60));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(gx + 70, gy + 50)));

    check("dragging one of them drags all of them", Object.keys(was).map((id) =>
      [placed(id)[0] - was[id][0], placed(id)[1] - was[id][1]]),
    [[60, 40], [60, 40], [60, 40], [60, 40]]);
    check("...and the selection is still what it was", [ringed(), framed()], [4, 1]);

    // Each box is put where it was plus how far the drag went, rather than
    // nudged by the difference since the last frame — which accumulates, and a
    // selection dragged across the canvas would come apart on the way.
    check("...so nothing has drifted out of line",
      [placed("B")[0] - placed("A")[0], placed("C")[1] - placed("A")[1]], [200, 200]);

    /* --- lining up --------------------------------------------------------- */

    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    // Dragged so its left edge lands five pixels past another box's left edge.
    // The grid alone would round that the other way, to ten past — so a box
    // that ends up exactly on the line got there by lining up, not by rounding.
    const nudgeOff = 5;
    const target = placed("B");
    const start = placed("D");
    tap("D");

    const [dx0, dy0] = onScreen(...start);
    const wantedX = target[0] + nudgeOff;
    box("D").dispatchEvent(new window.MouseEvent("pointerdown", at(dx0 + 5, dy0 + 5)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove",
      at(dx0 + 5 + (wantedX - start[0]), dy0 + 5)));
    await new Promise((r) => setTimeout(r, 60));

    check("a box dragged near another's edge is drawn on it, not near it",
      placed("D")[0], target[0]);
    // Two lines, not one: the drag was sideways, so the box is still level with
    // the one it started beside, and that is worth saying as well.
    const upright = [...canvas.querySelectorAll(".dd-guide")]
      .filter((line) => line.getAttribute("x1") === line.getAttribute("x2"));
    check("...with a line saying why", upright.length, 1);
    check("...and another for the row it is still in",
      canvas.querySelectorAll(".dd-guide").length, 2);
    check("...drawn on the edge the box went to",
      [Number(upright[0].getAttribute("x1")), Number(upright[0].getAttribute("x2"))],
      [target[0], target[0]]);
    check("...and long enough to reach both boxes",
      Number(upright[0].getAttribute("y2")) - Number(upright[0].getAttribute("y1")) > 200, true);

    canvas.dispatchEvent(new window.MouseEvent("pointerup",
      at(dx0 + 5 + (wantedX - start[0]), dy0 + 5)));
    check("...and where it is let go is where it stays", placed("D")[0], target[0]);
    check("...with the explanation gone once the drag is",
      canvas.querySelectorAll(".dd-guide").length, 0);

    // Far from anything, the grid is all there is, and the box lands on it.
    const loose = placed("D");
    const [lx, ly] = onScreen(...loose);
    box("D").dispatchEvent(new window.MouseEvent("pointerdown", at(lx + 5, ly + 5)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(lx + 5 + 137, ly + 5 + 73)));
    await new Promise((r) => setTimeout(r, 60));
    check("a box dragged nowhere near anything shows no lines",
      canvas.querySelectorAll(".dd-guide").length, 0);
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(lx + 5 + 137, ly + 5 + 73)));
    check("...and lands on the grid instead",
      [placed("D")[0] % 10, placed("D")[1] % 10], [0, 0]);

    // Five pixels is half a grid step, so the grid rounds it up to a whole one.
    // A box that came back to where it started would be one lining itself up
    // with itself, which is the one box it must never be compared against.
    const tiny = placed("D");
    const [tx, ty] = onScreen(...tiny);
    box("D").dispatchEvent(new window.MouseEvent("pointerdown", at(tx + 5, ty + 5)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(tx + 10, ty + 5)));
    await new Promise((r) => setTimeout(r, 60));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(tx + 10, ty + 5)));
    check("a box nudged half a grid step goes a whole one, not back where it was",
      placed("D")[0] - tiny[0], 10);

    // A line does not have to be on the grid. Nudge one box a single pixel off
    // it, then drag another up against it: the second has to land exactly on
    // the first, not on the nearest grid line to it.
    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    tap("D");
    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await new Promise((r) => setTimeout(r, 350));

    const offGrid = placed("D")[0];
    check("a box can sit off the grid to begin with", offGrid % 10 !== 0, true);

    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    const mover = placed("A");
    const [ax, ay] = onScreen(...mover);
    tap("A");
    box("A").dispatchEvent(new window.MouseEvent("pointerdown", at(ax + 5, ay + 5)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove",
      at(ax + 5 + (offGrid + 3 - mover[0]), ay + 5)));
    await new Promise((r) => setTimeout(r, 60));
    canvas.dispatchEvent(new window.MouseEvent("pointerup",
      at(ax + 5 + (offGrid + 3 - mover[0]), ay + 5)));

    check("...and a box lining up with it lands on it, not on the grid near it",
      placed("A")[0], offGrid);

    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    canvas.dispatchEvent(new window.KeyboardEvent("keydown",
      { key: "a", ctrlKey: true, bubbles: true }));

    /* --- and the arrow keys ------------------------------------------------ */

    const before = { A: placed("A"), D: placed("D") };
    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    check("an arrow key moves everything selected, by one pixel",
      [placed("A")[0] - before.A[0], placed("D")[0] - before.D[0]], [1, 1]);

    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    tap("C");
    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    check("delete removes what is selected", Boolean(box("C")), false);
    check("...and lets go of it", [ringed(), framed()], [0, 0]);

    canvas.dispatchEvent(new window.KeyboardEvent("keydown",
      { key: "a", ctrlKey: true, bubbles: true }));
    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    check("...and a selection of everything empties the diagram in one go",
      canvas.querySelectorAll(".dd-node").length, 0);

    await saveAndWait(page);
    const emptied = (await server.request("GET", "/api/docs/grid.mmd", undefined, { Cookie: cookie })).body.content;
    check("...which is one edit to the file, not four",
      emptied.includes("A[One]") || emptied.includes("B[Two]"), false);
    check("...with the arrow between two of them gone with them",
      emptied.includes("-->"), false);
  }

};
