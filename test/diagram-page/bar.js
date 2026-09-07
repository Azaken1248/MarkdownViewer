// Part of the diagram-page suite. See diagram-page.test.js, which sets all this
// up and calls it.
//
// The bar over the box, and dressing one where it stands.
//
// Everything it needs is handed to it: the suite's own check(), the helpers
// that boot a page and drag a box, and the fixtures. Split out of one file only
// because that file had grown well past a thousand lines.
module.exports = async (ctx) => {
  const {
    check, server, cookie, origin, openPage, saveAndWait, csrfFor
  } = ctx;

  console.log("=== a bar over the box, so a box is dressed where it stands ===");
  {
    /* Everything a box wears could be changed from the panel at the side and
     * nowhere else, which is a long way to go when the box is the thing you are
     * looking at. The controls reached for while drawing sit over the selection
     * as well — and they are the same controls, not copies of them, because two
     * sets of swatches that have to agree about what red is are one set too
     * many.
     */
    await server.request("POST", "/api/docs",
      { fileName: "overbox.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 120x60",
        "    %% @ B 100,300 120x60",
        "    A[One]",
        "    B[Two]"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/overbox.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const inspector = page.document.querySelector(".ve-diagram-inspector");
    const groupOf = (id) => canvas.querySelector(`.dd-node[data-id="${id}"]`);
    const bar = () => page.document.querySelector(".ve-diagram-hud");
    const at = (id) => {
      const spot = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(groupOf(id).getAttribute("transform"));
      return { x: Number(spot[1]), y: Number(spot[2]) };
    };

    const tap = (id, options = {}) => {
      const spot = at(id);
      groupOf(id).dispatchEvent(new window.MouseEvent("pointerdown",
        { clientX: spot.x + 10, clientY: spot.y + 10, bubbles: true, ...options }));
      canvas.dispatchEvent(new window.MouseEvent("pointerup",
        { clientX: spot.x + 10, clientY: spot.y + 10, bubbles: true, ...options }));
    };

    /* The bar is laid over the drawing in the window's own coordinates, and the
     * box is drawn in the diagram's — so where the bar should be is the box put
     * through the view the diagram is being looked at from.
     */
    const seenAt = (id) => {
      const said = /translate\(([-\d.]+),([-\d.]+)\) scale\(([\d.]+)\)/
        .exec(canvas.querySelector(".dd-view").getAttribute("transform"));
      const view = { x: Number(said[1]), y: Number(said[2]), scale: Number(said[3]) };
      const spot = at(id);
      return { x: (spot.x * view.scale) + view.x, y: (spot.y * view.scale) + view.y };
    };

    const topOf = () => Number(bar().style.top.replace("px", ""));

    check("nothing is held, so there is no bar", bar(), null);

    tap("A");
    check("a box held gets a bar over it", Boolean(bar()), true);
    check("...carrying what a box is dressed in: its shape, its colour, its"
      + " size, its two switches, and the way out",
      [Boolean(bar().querySelector(".ve-diagram-shape")),
        Boolean(bar().querySelector(".ve-diagram-swatch")),
        Boolean(bar().querySelector(".ve-diagram-size")),
        bar().querySelectorAll(".ve-diagram-mark").length,
        Boolean(bar().querySelector(".ve-diagram-drop"))],
      [true, true, true, 2, true]);

    // Over the box rather than on it: a bar drawn across what it is about is a
    // bar you have to move to see your own diagram.
    check("...standing above the box it is about",
      Math.round(topOf()), Math.round(seenAt("A").y) - 12);

    const swatchOn = (where, index) =>
      [...where.querySelectorAll(".ve-diagram-swatch")][index]
        .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    /* A pointer that lands on the bar has landed on the bar. Without that it
     * lands on the paper underneath as well, which is a press on empty paper —
     * and empty paper means "let go of that box", so the bar goes away under
     * the finger reaching for it.
     */
    bar().querySelector(".ve-diagram-swatch").dispatchEvent(
      new window.MouseEvent("pointerdown", { clientX: 0, clientY: 0, bubbles: true }));
    canvas.dispatchEvent(new window.MouseEvent("pointerup",
      { clientX: 0, clientY: 0, bubbles: true }));
    check("...and a press on the bar is not also a press on the paper under it",
      Boolean(bar()), true);

    swatchOn(bar(), 1);
    check("a colour chosen on the bar paints the box",
      /--dd-fill:/.test(groupOf("A").getAttribute("style") || ""), true);
    check("...and the panel at the side says the same thing, being the same"
      + " control shown twice",
      inspector.querySelector(".ve-diagram-swatch.is-on")
        .getAttribute("aria-label"),
      bar().querySelector(".ve-diagram-swatch.is-on").getAttribute("aria-label"));

    /* The size is on both, and a size changed on one that left the other saying
     * the old number would be two controls disagreeing about one diagram.
     */
    const sizeOn = (where) => where.querySelector(".ve-diagram-size");
    const typedInto = sizeOn(bar());
    typedInto.value = "24";
    typedInto.dispatchEvent(new window.Event("change", { bubbles: true }));
    check("a size set on the bar reaches the box",
      groupOf("A").style.getPropertyValue("--dd-font-size"), "24px");
    check("...and the field in the panel comes into step with it",
      sizeOn(inspector).value, "24");
    /* Without the panel being repainted under the caret. A field thrown away
     * and made again between one press of the spinner and the next is a spinner
     * you can only press once.
     */
    check("...and the field being typed into is still the field being typed into",
      typedInto.isConnected, true);

    /* A number half typed is not a number. The field the caret is in is left
     * alone while the others are brought into step, or a two-digit size cannot
     * be typed at all: the first digit lands, the diagram changes, and the
     * field is rewritten before the second one arrives.
     */
    typedInto.focus();
    typedInto.value = "3";
    sizeOn(inspector).value = "30";
    sizeOn(inspector).dispatchEvent(new window.Event("change", { bubbles: true }));
    check("...and a number half typed is not overwritten while it is being typed",
      [typedInto.value, groupOf("A").style.getPropertyValue("--dd-font-size")],
      ["3", "30px"]);
    typedInto.blur();
    sizeOn(bar()).value = "24";
    sizeOn(bar()).dispatchEvent(new window.Event("change", { bubbles: true }));

    /* Type twice the size needs twice the room. A box that keeps the size it
     * was measured at while its type is enlarged is a box its own words no
     * longer fit in.
     */
    const tallAs = () => Number(groupOf("A").querySelector(".dd-shape")
      .getAttribute("height"));
    const held = tallAs();
    sizeOn(bar()).value = "48";
    sizeOn(bar()).dispatchEvent(new window.Event("change", { bubbles: true }));
    check("...and the box grows to hold type that size", tallAs() > held, true);

    sizeOn(inspector).value = "11";
    sizeOn(inspector).dispatchEvent(new window.Event("change", { bubbles: true }));
    check("and it works the other way round too", sizeOn(bar()).value, "11");

    /* The field laid over a box is set in the box's own type. One that is
     * always 13px is a word that changes size the moment you stop typing —
     * which is the one thing typing into the drawing is supposed to avoid.
     */
    sizeOn(inspector).value = "32";
    sizeOn(inspector).dispatchEvent(new window.Event("change", { bubbles: true }));

    await new Promise((r) => setTimeout(r, 450));
    const tapTwice = () => {
      for (let count = 0; count < 2; count += 1) {
        groupOf("A").dispatchEvent(
          new window.MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
        canvas.dispatchEvent(new window.MouseEvent("pointerup", { bubbles: true }));
      }
    };

    tapTwice();
    const scale = Number(/scale\(([\d.]+)\)/
      .exec(canvas.querySelector(".dd-view").getAttribute("transform"))[1]);
    check("the field opens in the type the box is set in",
      canvas.querySelector(".ve-diagram-inline").style.fontSize, `${32 * scale}px`);
    canvas.querySelector(".ve-diagram-inline").dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));

    sizeOn(inspector).value = "11";
    sizeOn(inspector).dispatchEvent(new window.Event("change", { bubbles: true }));

    /* The bar is laid over the drawing rather than drawn into it, so a redraw
     * has to leave it where it is — and it has to follow the box it is about.
     */
    const stood = topOf();
    canvas.dispatchEvent(new window.KeyboardEvent("keydown",
      { key: "ArrowDown", shiftKey: true, bubbles: true, cancelable: true }));
    await new Promise((done) => setTimeout(done, 300));
    check("the bar survives the diagram being drawn again", Boolean(bar()), true);
    check("...and comes down with the box it is about", topOf() > stood, true);

    /* Above the box, and underneath it when the box is against the top of the
     * window: a bar drawn off the top of the paper is a bar nobody can reach.
     */
    canvas.dispatchEvent(new window.WheelEvent("wheel",
      { deltaY: seenAt("A").y + 40, bubbles: true, cancelable: true }));
    check("a box against the top of the window gets its bar underneath it",
      Math.round(topOf()) > Math.round(seenAt("A").y), true);
    canvas.dispatchEvent(new window.WheelEvent("wheel",
      { deltaY: -200, bubbles: true, cancelable: true }));

    // A shape menu over four boxes would have to say what four shapes are, so
    // it is offered for one box and the rest of the bar for any number.
    tap("B", { shiftKey: true });
    check("two boxes held share a bar",
      [Boolean(bar()), Boolean(bar().querySelector(".ve-diagram-shape")),
        Boolean(bar().querySelector(".ve-diagram-swatch"))],
      [true, false, true]);

    /* A size field over four boxes that showed one of their sizes would set the
     * other three to it the moment anybody touched it. Two boxes that disagree
     * have no one size, so the field says nothing rather than picking a side.
     */
    check("...and the size says nothing while the two of them disagree",
      sizeOn(bar()).value, "");

    swatchOn(bar(), 2);
    check("...and a colour chosen on it paints both of them",
      [/--dd-fill:/.test(groupOf("A").getAttribute("style") || ""),
        /--dd-fill:/.test(groupOf("B").getAttribute("style") || "")],
      [true, true]);

    /* Not everybody wants a bar standing over what they are drawing, so it is
     * put away the way the other regions are: by asking, and it stays away.
     */
    const menuOn = (target, x, y) => target.dispatchEvent(new window.MouseEvent(
      "contextmenu", { clientX: x, clientY: y, bubbles: true, cancelable: true }));
    const item = (text) => [...canvas.querySelectorAll(".ve-diagram-menu .context-item")]
      .find((one) => one.querySelector("span").textContent.trim() === text);

    menuOn(groupOf("A"), 200, 200);
    check("the list of what can be done to a box offers to put the bar away",
      Boolean(item("Hide the bar over the box")), true);
    item("Hide the bar over the box").dispatchEvent(
      new window.MouseEvent("click", { bubbles: true }));
    check("...and asking puts it away", bar(), null);

    tap("A");
    check("...and it stays away when the next box is held", bar(), null);

    // Asked back from the paper, which is where you are when there is no bar to
    // right-click.
    menuOn(canvas, 20, 20);
    check("the paper offers it back", Boolean(item("Show the bar over the box")), true);
    item("Show the bar over the box").dispatchEvent(
      new window.MouseEvent("click", { bubbles: true }));
    check("...and asking brings it back", Boolean(bar()), true);

    // Kept where the width of the panels is kept: it is the same question about
    // the same builder, and answering it twice a session is answering it twice.
    menuOn(groupOf("A"), 200, 200);
    item("Hide the bar over the box").dispatchEvent(
      new window.MouseEvent("click", { bubbles: true }));
    check("...and the answer is remembered",
      JSON.parse(window.localStorage.getItem("azadocs:diagram:panels")).barShut, true);

    menuOn(groupOf("A"), 200, 200);
    item("Show the bar over the box").dispatchEvent(
      new window.MouseEvent("click", { bubbles: true }));

    tap("A");
    canvas.dispatchEvent(new window.MouseEvent("pointerdown",
      { clientX: 5, clientY: 5, bubbles: true }));
    canvas.dispatchEvent(new window.MouseEvent("pointerup",
      { clientX: 5, clientY: 5, bubbles: true }));
    tap("B", { shiftKey: true });
    tap("A", { shiftKey: true });

    bar().querySelector(".ve-diagram-drop")
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("the way out on the bar takes both away, and the bar with them",
      [canvas.querySelectorAll(".dd-node").length, bar()], [0, null]);

    page.window.close();
  }

  console.log("=== a box can be dashed, and thick, and red, all at once ===");
  {
    await server.request("POST", "/api/docs",
      { fileName: "border.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 80x40",
        "    %% @ B 100,300 80x40",
        "    A[One]",
        "    B[Two]"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/border.mmd`, cookie, origin });
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
    const propOf = (id, name) => groupOf(id).style.getPropertyValue(name);
    const tap = (id) => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(groupOf(id).getAttribute("transform"));
      const x = Number(found[1]) + 10;
      const y = Number(found[2]) + 10;
      groupOf(id).dispatchEvent(new window.MouseEvent("pointerdown",
        { clientX: x, clientY: y, bubbles: true }));
      canvas.dispatchEvent(new window.MouseEvent("pointerup",
        { clientX: x, clientY: y, bubbles: true }));
    };
    const written = async () => (await server.request("GET", "/api/docs/border.mmd",
      undefined, { Cookie: cookie })).body.content;

    tap("A");
    check("a box starts plain and thin",
      [control("Border").value, control("Border weight").value], ["Plain", "Thin"]);

    choose("Border", "Dashed");
    check("a dashed border is drawn dashed", propOf("A", "--dd-dash"), "6 4");

    /* The point of doing it as a classDef: a dash is real Mermaid, so the file
     * is dashed everywhere and not only here.
     */
    await saveAndWait(page);
    const dashed = await written();
    check("...and the dash reaches the file as a classDef",
      /classDef ddC1 stroke-dasharray:6 4/.test(dashed), true);

    /* Three separate questions, so answering one must not undo another. A box
     * asked to be red should not stop being dashed.
     */
    inspector.querySelector('.ve-diagram-swatch[title="Red"]')
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("colouring a dashed box leaves it dashed",
      [propOf("A", "--dd-fill"), propOf("A", "--dd-dash")], ["#fbdedc", "6 4"]);
    // ...and the swatches have to know it is still red, or a box goes on
    // looking uncoloured the moment it is also dashed.
    check("...and the panel still says which colour it is",
      inspector.querySelector('.ve-diagram-swatch[title="Red"]').getAttribute("aria-pressed"),
      "true");

    choose("Border weight", "Thick");
    check("...and so does thickening it",
      [propOf("A", "--dd-fill"), propOf("A", "--dd-dash"), propOf("A", "--dd-stroke-width")],
      ["#fbdedc", "6 4", "4px"]);

    await saveAndWait(page);
    const all = await written();
    // Order is whatever order they were chosen in, so what matters is that
    // there is one definition and that everything asked for is in it.
    const defined = (all.match(/^\s*classDef ddC\d .*$/gm) || []);
    check("all three live in one definition", defined.length, 1);
    check("...which says every one of them",
      ["fill:#fbdedc", "stroke:#c0453c", "color:#4a1512", "stroke-dasharray:6 4",
        "stroke-width:4px"].every((part) => defined[0].includes(part)), true);
    check("...and the box wears exactly one of ours",
      (all.match(/^\s*class A /gm) || []).length, 1);

    // Read back through the parser: a border this editor writes and the parser
    // cannot read is a diagram damaged by being saved.
    const reopened = window.DiagramModel.parseFlowchart(all);
    check("...which is read back as the same border",
      reopened.classes[reopened.nodes[0].classes[0]]["stroke-dasharray"], "6 4");
    check("...and the controls come back saying so",
      [control("Border").value, control("Border weight").value], ["Dashed", "Thick"]);

    /* Clearing a colour clears the colour. It is not a way of resetting the
     * box, and a dashed box that lost its dash by being un-coloured would be
     * one more thing the person has to put back.
     */
    inspector.querySelector('.ve-diagram-swatch[title="No colour"]')
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("clearing the colour keeps the border",
      [propOf("A", "--dd-fill"), propOf("A", "--dd-dash"), propOf("A", "--dd-stroke-width")],
      ["", "6 4", "4px"]);

    choose("Border", "Plain");
    choose("Border weight", "Thin");
    await saveAndWait(page);
    const bare = await written();
    check("a box put back to plain wears no class of ours", /^\s*class A/m.test(bare), false);
    check("...and leaves no definition of ours behind", /classDef ddC/.test(bare), false);

    /* A handful at once, the same as the colours. "Make these four dashed" is
     * as much a reason to hold four boxes as "make these four red" is.
     */
    canvas.dispatchEvent(new window.KeyboardEvent("keydown",
      { key: "a", ctrlKey: true, bubbles: true }));
    check("holding several offers the border all the same",
      Boolean(control("Border")), true);
    choose("Border", "Dotted");
    check("...and one choice dashes every one of them",
      [propOf("A", "--dd-dash"), propOf("B", "--dd-dash")], ["2 4", "2 4"]);
  }

  console.log("=== the arrow tool stays on until it is put away ===");
  {
    /* Drawing an arrow meant selecting the box it comes from and then finding
     * the circle on its edge: one selection per arrow, ten selections for ten
     * arrows. Switched on, a drag from any box to any box is an arrow, over and
     * over, with nothing selected first.
     */
    await server.request("POST", "/api/docs",
      { fileName: "joining.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 80x40",
        "    %% @ B 400,100 80x40",
        "    %% @ C 100,400 80x40",
        "    A[One]",
        "    B[Two]",
        "    C[Three]"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/joining.mmd`, cookie, origin });
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
    const arrows = () => canvas.querySelectorAll(".dd-edge").length;
    const joined = () => [...canvas.querySelectorAll(".dd-edge")]
      .map((one) => `${one.dataset.from}->${one.dataset.to}`);

    const tool = [...page.document.querySelectorAll(".ve-diagram-bar .ve-diagram-icon[aria-pressed]")]
      .find((one) => /Arrow/i.test(one.getAttribute("title") || ""));

    const middleOf = (id) => {
      const spot = /translate\((-?[\d.]+),(-?[\d.]+)\)/
        .exec(canvas.querySelector(`.dd-node[data-id="${id}"]`).getAttribute("transform"));
      return [Number(spot[1]) + 40, Number(spot[2]) + 20];
    };
    const drag = (from, to) => {
      const [x1, y1] = middleOf(from);
      const [x2, y2] = middleOf(to);
      canvas.querySelector(`.dd-node[data-id="${from}"]`)
        .dispatchEvent(new window.MouseEvent("pointerdown", at(x1, y1)));
      canvas.dispatchEvent(new window.MouseEvent("pointermove", at(x2, y2)));
      canvas.dispatchEvent(new window.MouseEvent("pointerup", at(x2, y2)));
    };

    check("there is an arrow tool to switch on", Boolean(tool), true);
    check("...and it starts switched off", tool.getAttribute("aria-pressed"), "false");
    check("a diagram of three boxes starts with no arrows", arrows(), 0);

    // Off, a drag on a box moves the box. That is what a drag has always meant
    // and switching a tool on is the only thing that may change it.
    const placeOf = (id) =>
      canvas.querySelector(`.dd-node[data-id="${id}"]`).getAttribute("transform");
    const nudge = (id, dx, dy) => {
      const [x, y] = middleOf(id);
      canvas.querySelector(`.dd-node[data-id="${id}"]`)
        .dispatchEvent(new window.MouseEvent("pointerdown", at(x, y)));
      canvas.dispatchEvent(new window.MouseEvent("pointermove", at(x + dx, y + dy)));
      canvas.dispatchEvent(new window.MouseEvent("pointerup", at(x + dx, y + dy)));
    };

    nudge("A", 0, 60);
    check("with the tool off, dragging a box moves it rather than joining it",
      [arrows(), placeOf("A")], [0, "translate(100,160)"]);
    nudge("A", 0, -60);
    check("...and back where it was, so what follows starts where it started",
      placeOf("A"), "translate(100,100)");

    tool.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("switching it on says so", tool.getAttribute("aria-pressed"), "true");
    check("...and the canvas says so too",
      canvas.classList.contains("is-joining"), true);

    /* The line you drag is drawn in the diagram, not on the window.
     *
     * Both of its ends are places in the diagram — the box the model puts at
     * 100,100 and a pointer already converted back through the view — so it
     * belongs inside the group the view transform is on, beside the guides and
     * the band. Hung off the svg root instead it began where the box was not,
     * and swung about that spot instead of following the pointer.
     */
    const [aX, aY] = middleOf("A");
    canvas.querySelector('.dd-node[data-id="A"]')
      .dispatchEvent(new window.MouseEvent("pointerdown", at(aX, aY)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(aX + 150, aY + 90)));
    await new Promise((done) => window.requestAnimationFrame(
      () => window.requestAnimationFrame(done)));

    const draft = canvas.querySelector(".dd-draft");
    check("a drag draws a line to follow the pointer", Boolean(draft), true);
    check("...in the diagram rather than over the window",
      draft.parentNode === canvas.querySelector(".dd-view"), true);
    check("...starting at the middle of the box it came from and ending under"
      + " the pointer", draft.getAttribute("d"), "M140,120 L290,210");

    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(aX + 150, aY + 90)));
    check("...and letting go over nothing takes the line away with it",
      [canvas.querySelector(".dd-draft"), arrows()], [null, 0]);

    drag("A", "B");
    check("a drag between two boxes is an arrow", joined(), ["A->B"]);
    check("...and the tool is still on", tool.getAttribute("aria-pressed"), "true");

    // The whole reason for it being a mode: the second arrow costs the same as
    // the first. And the second arrow out of the same box has to be an arrow —
    // the first one is lying under the drag by then.
    drag("A", "C");
    check("...so the next drag is the next arrow", joined(), ["A->B", "A->C"]);
    check("...rather than a corner put into the one already there",
      canvas.querySelectorAll(".dd-via").length, 0);

    /* A tap that goes nowhere has drawn nothing. The circle on a selected box
     * grows a new box when it is clicked, and the tool borrows that gesture —
     * so without saying otherwise, every tap on a box while the tool was on
     * made another box.
     */
    const boxes = () => canvas.querySelectorAll(".dd-node").length;
    const was = boxes();
    const [tapX, tapY] = middleOf("B");
    canvas.querySelector('.dd-node[data-id="B"]')
      .dispatchEvent(new window.MouseEvent("pointerdown", at(tapX, tapY)));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(tapX, tapY)));
    check("a tap that goes nowhere draws nothing and makes nothing",
      [boxes(), joined().length], [was, 2]);

    // And a drag that reaches empty paper has reached no box to join to.
    canvas.querySelector('.dd-node[data-id="B"]')
      .dispatchEvent(new window.MouseEvent("pointerdown", at(tapX, tapY)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(tapX + 400, tapY + 400)));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(tapX + 400, tapY + 400)));
    check("...and neither does one let go over nothing",
      [boxes(), joined().length], [was, 2]);

    await saveAndWait(page);
    const written = (await server.request("GET", "/api/docs/joining.mmd",
      undefined, { Cookie: cookie })).body.content;
    check("...and both reach the file as ordinary links",
      /A --> B/.test(written) && /A --> C/.test(written), true);

    // A mode wants a way out that is not finding the button that turned it on.
    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    check("Escape puts the tool away", tool.getAttribute("aria-pressed"), "false");
    drag("A", "B");
    check("...and a drag is a drag again", joined().length, 2);

    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "a", bubbles: true }));
    check("A switches it on", tool.getAttribute("aria-pressed"), "true");

    /* Two modes at once is one mode too many, and the hand is the one that
     * takes the whole canvas: a drag that is both an arrow and a pan is
     * neither.
     */
    const hand = [...page.document.querySelectorAll(".ve-diagram-bar .ve-diagram-icon[aria-pressed]")]
      .find((one) => /Hand/i.test(one.getAttribute("title") || ""));
    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "h", bubbles: true }));
    check("reaching for the hand puts the arrow tool away",
      [hand.getAttribute("aria-pressed"), tool.getAttribute("aria-pressed")], ["true", "false"]);

    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "a", bubbles: true }));
    check("...and reaching back for the arrow puts the hand away",
      [hand.getAttribute("aria-pressed"), tool.getAttribute("aria-pressed")], ["false", "true"]);

    canvas.dispatchEvent(new window.KeyboardEvent("keydown", { key: "v", bubbles: true }));
    check("...and V is the pointer again", tool.getAttribute("aria-pressed"), "false");

    // Ctrl+A is select-all and has been since before there was a tool to arm.
    canvas.dispatchEvent(new window.KeyboardEvent("keydown",
      { key: "a", ctrlKey: true, bubbles: true }));
    check("Ctrl+A is still select-all, not the arrow tool",
      [tool.getAttribute("aria-pressed"), canvas.querySelectorAll(".dd-ring-one").length],
      ["false", 3]);
  }

};
