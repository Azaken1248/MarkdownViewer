// Part of the diagram-page suite. See diagram-page.test.js, which sets all this
// up and calls it.
//
// Arrows: where one goes when it is dragged, and what carrying a box does
// to the arrows that touch it.
//
// Everything it needs is handed to it: the suite's own check(), the helpers
// that boot a page and drag a box, and the fixtures. Split out of one file only
// because that file had grown well past a thousand lines.
module.exports = async (ctx) => {
  const {
    check, server, cookie, origin, openPage, saveAndWait, csrfFor, dragBox
  } = ctx;

  console.log("=== an arrow goes where it is dragged ===");
  {
    await server.request("POST", "/api/docs",
      { fileName: "bend.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 80x40",
        "    %% @ B 300,300 80x40",
        "    A[One]",
        "    B[Two]",
        "    A --> B"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/bend.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    // The view is fitted, so a point in the diagram is a point on the screen
    // plus wherever the fit put it.
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
    const lineOf = () => canvas.querySelector(".dd-edge .dd-line").getAttribute("d");
    const corners = () => canvas.querySelectorAll(".dd-via").length;
    const pins = () => canvas.querySelectorAll(".dd-pin").length;
    const written = async () => (await server.request("GET", "/api/docs/bend.mmd",
      undefined, { Cookie: cookie })).body.content;

    const groupOf = (id) => canvas.querySelector(`.dd-node[data-id="${id}"]`);
    const tap = (id) => {
      const spot = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(groupOf(id).getAttribute("transform"));
      const here = at(Number(spot[1]) + 10, Number(spot[2]) + 10);
      groupOf(id).dispatchEvent(new window.MouseEvent("pointerdown", here));
      canvas.dispatchEvent(new window.MouseEvent("pointerup", here));
    };

    /* Two presses on the same thing, asked for again in between: the first one
     * changes the diagram, and a change is a redraw that throws the element
     * away. What is tapped twice is the corner, not the circle drawing it.
     */
    const tapTwice = (selector) => {
      for (let count = 0; count < 2; count += 1) {
        canvas.querySelector(selector).dispatchEvent(
          new window.MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
        canvas.dispatchEvent(new window.MouseEvent("pointerup", { bubbles: true }));
      }
    };

    check("an arrow nobody has touched has no corners in it", corners(), 0);
    check("...and the box beside it shows none either", pins(), 0);

    /* Nothing selected, nothing to bend. A finger landing on a line on the way
     * to somewhere else would otherwise put a corner in it, on a canvas where
     * pressing empty paper is how you move about.
     */
    canvas.querySelector(".dd-edge .dd-hit")
      .dispatchEvent(new window.MouseEvent("pointerdown", at(140, 220)));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(140, 220)));
    check("pressing a line with nothing selected does not bend it", corners(), 0);

    /* The handles are on the arrows of the box being worked on. Every waypoint
     * of every arrow in a diagram of two hundred would be two hundred handles
     * nobody asked for.
     */
    tap("A");
    check("selecting a box offers the ends of its arrows", pins(), 2);

    /* Pressing the line bends it: a corner where the finger went down, dragged
     * from there. Which is how it works everywhere that has ever let anyone
     * bend an arrow, and needs nothing explaining.
     */
    const hit = canvas.querySelector(".dd-edge .dd-hit");
    check("...and a stroke wide enough to be caught hold of", Boolean(hit), true);

    hit.dispatchEvent(new window.MouseEvent("pointerdown", at(140, 220)));
    check("pressing the line puts a corner in it", corners(), 1);
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(60, 220)));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(60, 220)));

    /* The line goes through the corner. It does not necessarily *turn* at it —
     * a corner on a straight run of the line is a corner the line passes
     * through without changing direction, and listing it as a vertex would be
     * listing a point that makes no difference to the shape.
     */
    check("...which the line then goes out to", lineOf().includes("L60,"), true);

    await saveAndWait(page);
    const bent = await written();
    check("...and which the file says in the layout comment",
      /%% edge 0 [^\n]*via=60,220/.test(bent), true);
    check("...leaving the link itself alone", /^\s*A --> B\s*$/m.test(bent), true);

    /* Dragged again, and it is the same corner rather than another one: a line
     * that grew a corner every time it was touched would be unusable.
     */
    const corner = canvas.querySelector(".dd-via");
    corner.dispatchEvent(new window.MouseEvent("pointerdown", at(60, 220)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(40, 260)));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(40, 260)));
    check("dragging a corner moves it rather than making another", corners(), 1);
    check("...to where it was dragged",
      [canvas.querySelector(".dd-via").getAttribute("cx"),
        canvas.querySelector(".dd-via").getAttribute("cy")], ["40", "260"]);
    check("...and the line goes out to it", lineOf().includes("L40,"), true);

    /* A second corner, put in nearer the start of the line than the one already
     * there. It has to go into the list before it, not after: the corners are
     * in the order the line passes through them, and a line that collected them
     * in the order they were thought of would double back to fetch each one.
     */
    canvas.querySelector(".dd-edge .dd-hit")
      .dispatchEvent(new window.MouseEvent("pointerdown", at(140, 160)));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(140, 160)));
    check("a second corner is a second corner", corners(), 2);

    await saveAndWait(page);
    check("...and it goes into the list in the order the line reaches them",
      /via=140,160;40,260/.test(await written()), true);

    // The second of the two, so that taking out "a corner" and taking out "the
    // one that was asked for" are two different answers.
    /* Two corners of the same arrow are two things. Pressing one and then the
     * other is not two presses on a corner, and neither of them goes.
     */
    const onCorner = (which) => {
      const found = canvas.querySelector(`.dd-via[data-at="${which}"]`);
      // Where the corner actually is: a press somewhere else is a corner
      // dragged there, because letting go of a corner puts it where the hand is.
      const here = at(Number(found.getAttribute("cx")), Number(found.getAttribute("cy")));
      found.dispatchEvent(new window.MouseEvent("pointerdown", here));
      canvas.dispatchEvent(new window.MouseEvent("pointerup", here));
    };

    onCorner(0);
    onCorner(1);
    check("one press on each of two corners takes neither of them out", corners(), 2);

    // Long enough after that last press for the pair below to be its own pair.
    await new Promise((r) => setTimeout(r, 450));

    tapTwice('.dd-via[data-at="1"]');
    check("...and the one taken out is the one that was asked for",
      [corners(), canvas.querySelector(".dd-via").getAttribute("cy")], [1, "160"]);

    // Two taps on the corner itself takes it out, the same way two taps on a
    // box opens it.
    tapTwice(".dd-via");
    check("two taps on a corner takes it out", corners(), 0);

    await saveAndWait(page);
    check("...and the file stops mentioning it", /via=/.test(await written()), false);

    /* A loop back to the same box has a shape of its own and no route to put a
     * corner into. Taking one and ignoring it would be a press that changed the
     * file and nothing else.
     */
    await server.request("POST", "/api/docs",
      { fileName: "loop.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 80x40",
        "    A[One]",
        "    A --> A"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const looping = await openPage({ url: `${origin}/diagram/file/loop.mmd`, cookie, origin });
    const round = looping.document.querySelector(".ve-diagram-canvas");
    const box = round.querySelector('.dd-node[data-id="A"]');
    box.dispatchEvent(new looping.window.MouseEvent("pointerdown",
      { clientX: 0, clientY: 0, bubbles: true }));
    round.dispatchEvent(new looping.window.MouseEvent("pointerup",
      { clientX: 0, clientY: 0, bubbles: true }));
    round.querySelector(".dd-edge .dd-hit")
      .dispatchEvent(new looping.window.MouseEvent("pointerdown",
        { clientX: 0, clientY: 0, bubbles: true }));
    round.dispatchEvent(new looping.window.MouseEvent("pointerup",
      { clientX: 0, clientY: 0, bubbles: true }));
    check("a loop back to the same box refuses a corner",
      round.querySelectorAll(".dd-via").length, 0);

    /* And the ends. Dragged round the box, an end pins itself to the side it
     * was dragged to; dragged back into the middle, it goes back to being the
     * router's business.
     */
    const end = canvas.querySelector('.dd-pin[data-end="0"]');
    end.dispatchEvent(new window.MouseEvent("pointerdown", at(140, 140)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(178, 120)));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(178, 120)));
    check("an end dragged to a side leaves from that side",
      lineOf().startsWith("M180,"), true);

    await saveAndWait(page);
    check("...which the file says too", /sides=r,a/.test(await written()), true);

    const again = canvas.querySelector('.dd-pin[data-end="0"]');
    again.dispatchEvent(new window.MouseEvent("pointerdown", at(180, 120)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(140, 120)));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(140, 120)));
    check("dragged back into the middle it is the router's business again",
      lineOf(), "M140,140 L140,220 L340,220 L340,298");

    await saveAndWait(page);
    check("...and the file says nothing about it at all",
      /%% edge 0/.test(await written()), false);

    /* Two corners can be put next to each other, and zoomed out far enough they
     * are within a finger's width of each other on the screen. Then the only
     * thing telling a press on one from a press on the other is which corner it
     * was — and without that, pressing one and then its neighbour takes out a
     * corner nobody asked to lose.
     *
     * On a paper of its own, because it leaves a diagram bent in two places and
     * looked at from a long way off.
     */
    await server.request("POST", "/api/docs",
      { fileName: "close.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 80x40",
        "    %% @ B 300,260 80x40",
        "    A --> B"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const far = await openPage({ url: `${origin}/diagram/file/close.mmd`, cookie, origin });
    const paper = far.document.querySelector(".ve-diagram-canvas");
    const bends = () => paper.querySelectorAll(".dd-via").length;
    const spot = (x, y) => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\) scale\(([\d.]+)\)/
        .exec(paper.querySelector(".dd-view").getAttribute("transform"));
      return {
        clientX: (x * Number(found[3])) + Number(found[1]),
        clientY: (y * Number(found[3])) + Number(found[2]),
        bubbles: true
      };
    };

    const bend = (x, y) => {
      paper.querySelector(".dd-edge .dd-hit")
        .dispatchEvent(new far.window.MouseEvent("pointerdown", spot(x, y)));
      paper.dispatchEvent(new far.window.MouseEvent("pointerup", spot(x, y)));
    };

    // Selected, because only the arrows of the box being worked on can be bent.
    paper.querySelector('.dd-node[data-id="A"]')
      .dispatchEvent(new far.window.MouseEvent("pointerdown", spot(140, 120)));
    paper.dispatchEvent(new far.window.MouseEvent("pointerup", spot(140, 120)));

    const step = 10;
    bend(140, 200);
    bend(140, 200 + step);
    check("two corners can be put next to each other", bends(), 2);

    // Far enough out that one grid step is less than a tap is wide.
    for (let count = 0; count < 8; count += 1) {
      paper.dispatchEvent(new far.window.WheelEvent("wheel",
        { deltaY: 1, ctrlKey: true, bubbles: true, cancelable: true }));
    }

    const shrunk = Number(/scale\(([\d.]+)\)/
      .exec(paper.querySelector(".dd-view").getAttribute("transform"))[1]);
    check("...and zoomed out they are a few pixels apart on the screen",
      step * shrunk < 6, true);

    await new Promise((r) => setTimeout(r, 450));

    const onCornerHere = (which) => {
      const found = paper.querySelector(`.dd-via[data-at="${which}"]`);
      const here = spot(Number(found.getAttribute("cx")), Number(found.getAttribute("cy")));
      found.dispatchEvent(new far.window.MouseEvent("pointerdown", here));
      paper.dispatchEvent(new far.window.MouseEvent("pointerup", here));
    };

    onCornerHere(0);
    onCornerHere(1);
    check("...but one press on each is still one press on each", bends(), 2);

    far.window.close();
  }

  console.log("=== a box carried into another is carried on top of it ===");
  {
    // Listed chair-first on purpose: in one flat layer the file's order is the
    // drawing's order, and that is exactly what has to stop being true.
    await server.request("POST", "/api/docs",
      { fileName: "nested.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ Chair 600,140 80x40",
        "    %% @ Hall 100,100 320x220",
        "    Chair[Chair]",
        "    Hall[Hall]"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/nested.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const painted = () => [...canvas.querySelectorAll(".dd-node")].map((one) => one.dataset.id);
    const at = (px, py) => ({ clientX: px, clientY: py, bubbles: true });
    const grab = (id) => {
      const box = canvas.querySelector(`.dd-node[data-id="${id}"]`);
      const spot = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(box.getAttribute("transform"));
      return [box, Number(spot[1]) + 10, Number(spot[2]) + 10];
    };

    check("two boxes beside each other are drawn in one layer",
      canvas.querySelectorAll(".dd-nodes").length, 1);
    check("...in the order the file lists them", painted(), ["Chair", "Hall"]);

    /* Selecting is not carrying. A press that never goes anywhere never redraws
     * either, so a box raised on the way down stays raised — which is a
     * container that covers everything inside it for as long as it is selected,
     * and nothing to put it back.
     */
    const [still, stillX, stillY] = grab("Chair");
    still.dispatchEvent(new window.MouseEvent("pointerdown", at(stillX, stillY)));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(stillX, stillY)));
    check("selecting a box does not lift it over the ones after it",
      painted(), ["Chair", "Hall"]);

    /* Picked up and carried in. The layer a box belongs in is only worked out
     * when the drawing is made, so between picking it up and putting it down
     * it is held in front of everything — otherwise it slides under the hall
     * halfway across and reappears on being let go, which reads as having
     * dropped it and lost it.
     */
    const [chair, chairX, chairY] = grab("Chair");
    chair.dispatchEvent(new window.MouseEvent("pointerdown", at(chairX, chairY)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(chairX - 400, chairY + 40)));
    check("a box being carried is drawn in front of what it is carried over",
      painted(), ["Hall", "Chair"]);
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(chairX - 400, chairY + 40)));
    await new Promise((r) => setTimeout(r, 300));

    /* And the drawing agrees once it is made again. The hall is opaque, so a
     * chair painted before it is a chair nobody can see.
     */
    check("a box let go inside a bigger one is drawn in a layer of its own",
      canvas.querySelectorAll(".dd-nodes").length, 2);
    check("...after the box it is now inside, whatever the file's order",
      painted(), ["Hall", "Chair"]);

    /* Carrying the outer one is where the rule stops. A box lifted over its own
     * contents hides them for the whole length of the drag, which is worse than
     * the problem being solved — so a box with something inside it stays in its
     * layer and you can still see what you are moving.
     */
    const [hall, hallX, hallY] = grab("Hall");
    hall.dispatchEvent(new window.MouseEvent("pointerdown", at(hallX, hallY)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(hallX + 20, hallY)));
    check("...but a box carried over what is inside it stays behind it",
      painted(), ["Hall", "Chair"]);
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(hallX + 20, hallY)));
    await new Promise((r) => setTimeout(r, 300));

    // Carried back out, and the layers go with it.
    dragBox(window, "Chair", 500, 0);
    await new Promise((r) => setTimeout(r, 300));
    check("a box carried back out is drawn beside what it was inside",
      canvas.querySelectorAll(".dd-nodes").length, 1);

    /* A box that holds nothing is not held back by a box that is inside
     * something else.
     *
     * "Holds something" cannot be "there is a box deeper than me somewhere in
     * the diagram", or one nested box anywhere would pin every plain box in the
     * drawing to its layer. It has to be about this box and that one.
     */
    await server.request("POST", "/api/docs",
      { fileName: "beside.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ Sign 700,100 80x40",
        "    %% @ Hall 100,100 320x220",
        "    %% @ Chair 160,160 80x40",
        "    Sign[Sign]",
        "    Hall[Hall]",
        "    Chair[Chair]"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const near = await openPage({ url: `${origin}/diagram/file/beside.mmd`, cookie, origin });
    const nearby = near.document.querySelector(".ve-diagram-canvas");
    const order = () => [...nearby.querySelectorAll(".dd-node")].map((one) => one.dataset.id);
    const spot = (id) => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\)/
        .exec(nearby.querySelector(`.dd-node[data-id="${id}"]`).getAttribute("transform"));
      return [Number(found[1]) + 10, Number(found[2]) + 10];
    };

    check("a plain box beside a container is drawn in the first layer",
      order(), ["Sign", "Hall", "Chair"]);

    const [signX, signY] = spot("Sign");
    nearby.querySelector('.dd-node[data-id="Sign"]').dispatchEvent(
      new near.window.MouseEvent("pointerdown",
        { clientX: signX, clientY: signY, bubbles: true }));
    nearby.dispatchEvent(new near.window.MouseEvent("pointermove",
      { clientX: signX - 400, clientY: signY, bubbles: true }));
    check("...and carrying it forward is not stopped by somebody else's contents",
      order()[order().length - 1], "Sign");
    nearby.dispatchEvent(new near.window.MouseEvent("pointerup",
      { clientX: signX - 400, clientY: signY, bubbles: true }));

    // The file has no opinion about any of this: where a box is, is what says
    // what it is inside, and where it is was already written down.
    await saveAndWait(page);
    const saved = (await server.request("GET", "/api/docs/nested.mmd",
      undefined, { Cookie: cookie })).body.content;
    check("...and nothing about layers reaches the file", /layer=/.test(saved), false);
  }

  console.log("=== the canvas has no edges to be stopped at ===");
  {
    await server.request("POST", "/api/docs",
      { fileName: "edgeless.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 80x40",
        "    %% @ B 300,100 80x40",
        "    A[One]",
        "    B[Two]",
        "    A --> B"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/edgeless.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const at = (id) => {
      const group = canvas.querySelector(`.dd-node[data-id="${id}"]`);
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(group.getAttribute("transform"));
      return [Number(found[1]), Number(found[2])];
    };

    /* A position used to be clamped at zero, from when the canvas was a fixed
     * sheet of paper. Panning to show the space beside a diagram and then being
     * unable to drag anything into it is not an endless canvas.
     */
    const startedAt = at("A");
    dragBox(window, "A", -500, -360);
    check("a box can be carried to the left of where the diagram started",
      at("A"), [startedAt[0] - 500, startedAt[1] - 360]);

    await saveAndWait(page);
    const written = (await server.request("GET", "/api/docs/edgeless.mmd", undefined,
      { Cookie: cookie })).body.content;
    check("...and the file says so with a minus sign",
      new RegExp(`%% @ A ${at("A")[0]},${at("A")[1]} `).test(written), true);

    // Read back rather than assumed: a position the editor can write and the
    // parser cannot read is a diagram that is damaged by being saved.
    const reopened = window.DiagramModel.parseFlowchart(written);
    check("...which is read back as the same place",
      [reopened.layout.A.x, reopened.layout.A.y], at("A"));
    check("...which is somewhere no clamp would have allowed",
      reopened.layout.A.x < 0 && reopened.layout.A.y < 0, true);

    dragBox(window, "A", 500, 360);
    check("...and it comes back again", at("A"), startedAt);
  }

  console.log("=== boxes can be carried about ===");
};
