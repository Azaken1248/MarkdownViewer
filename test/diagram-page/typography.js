// Part of the diagram-page suite. See diagram-page.test.js, which sets all this
// up and calls it.
//
// Pictures dropped on the paper, the type a box is set in, typing into it, and
// the keys the builder answers.
//
// Everything it needs is handed to it: the suite's own check(), the helpers
// that boot a page and drag a box, and the fixtures. Split out of one file only
// because that file had grown well past a thousand lines.
module.exports = async (ctx) => {
  const {
    check, server, cookie, origin, openPage, saveAndWait, csrfFor
  } = ctx;

  console.log("=== the type a box is set in is a classDef like everything else ===");
  {
    /* Every font control goes the way a colour and a border go: into a classDef,
     * which every Mermaid renderer reads. There is no control here for anything
     * Mermaid cannot say, because a size the file cannot keep is a size that
     * goes away the next time the diagram is opened somewhere else.
     */
    await server.request("POST", "/api/docs",
      { fileName: "type.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 120x60",
        "    A[One]"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/type.mmd`, cookie, origin });
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

    const menu = (label) => [...inspector.querySelectorAll(".ve-diagram-kind")]
      .find((one) => one.getAttribute("aria-label") === label);
    const pick = (label, value) => {
      const one = menu(label);
      one.value = value;
      one.dispatchEvent(new window.Event("change", { bubbles: true }));
    };
    const mark = (label) => [...inspector.querySelectorAll(".ve-diagram-mark")]
      .find((one) => one.getAttribute("aria-label") === label);
    const setOf = (property) => groupOf().style.getPropertyValue(property);

    // The size is a number rather than one of four names: a diagram that wants
    // a heading at 28 had to take 20 or nothing, and `font-size` is a real
    // classDef declaration at any value.
    const sizeBox = () => inspector.querySelector(".ve-diagram-size");
    const setSize = (typed) => {
      const one = sizeBox();
      one.value = typed;
      one.dispatchEvent(new window.Event("change", { bubbles: true }));
    };

    tap();
    check("a box offers a font, a size and the two switches",
      [Boolean(menu("Font")), Boolean(sizeBox()),
        Boolean(mark("Bold")), Boolean(mark("Italic"))], [true, true, true, true]);
    check("...and starts wearing none of them",
      [menu("Font").value, sizeBox().value,
        mark("Bold").getAttribute("aria-pressed")], ["Default", "", "false"]);

    pick("Font", "Mono");
    check("choosing a font sets the box in it", setOf("--dd-font-family"), "monospace");
    // The panel is redrawn from what the box is wearing, so the menu has to
    // come back saying what was just chosen rather than what it opened saying.
    check("...and the menu says so afterwards", menu("Font").value, "Mono");

    setSize("16");
    check("...and a size beside it, without taking the font off",
      [setOf("--dd-font-size"), setOf("--dd-font-family")], ["16px", "monospace"]);
    check("...with both controls saying what they are",
      [menu("Font").value, sizeBox().value], ["Mono", "16"]);

    /* Any size, not one of four. Held to the bounds and written back into the
     * field, so a field left saying 400 over a box drawn at 96 cannot happen.
     */
    setSize("29");
    check("a size nobody offered is still a size", setOf("--dd-font-size"), "29px");
    setSize("400");
    check("...and one nothing could be read at is brought back to the largest",
      [setOf("--dd-font-size"), sizeBox().value], ["96px", "96"]);
    setSize("1");
    check("...and one nothing could be read at all, to the smallest",
      [setOf("--dd-font-size"), sizeBox().value], ["8px", "8"]);

    // Blank is not the standard size. A box that says nothing follows the theme
    // wherever the theme goes; one that says 13 is 13 for ever.
    setSize("");
    check("emptying it says nothing about the size at all",
      [setOf("--dd-font-size"), setOf("--dd-font-family")], ["", "monospace"]);
    setSize("16");

    mark("Bold").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("a switch goes on", setOf("--dd-font-weight"), "700");
    check("...and says it is on", mark("Bold").getAttribute("aria-pressed"), "true");

    mark("Italic").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("...and the other is a switch of its own",
      [setOf("--dd-font-style"), setOf("--dd-font-weight")], ["italic", "700"]);

    await saveAndWait(page);
    const written = (await server.request("GET", "/api/docs/type.mmd",
      undefined, { Cookie: cookie })).body.content;
    // The name is whichever one was free; what matters is that all four
    // declarations are on one class and the box is wearing it.
    const named = (/classDef (ddC\d+) ([^\n]+)/.exec(written) || []);
    check("all four reach the file as one classDef, which is real Mermaid",
      named[2], "font-family:monospace,font-size:16px,font-weight:700,font-style:italic");
    check("...with a line saying which box wears it",
      new RegExp(`class A ${named[1]}`).test(written), true);

    // Off again takes that one declaration off and leaves the rest alone, the
    // same way clearing a colour leaves the dashed border behind.
    mark("Bold").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("a switch goes off again",
      [setOf("--dd-font-weight"), setOf("--dd-font-style")], ["", "italic"]);

    pick("Font", "Default");
    check("...and Default is a choice rather than the absence of one",
      [setOf("--dd-font-family"), setOf("--dd-font-size")], ["", "16px"]);

    page.window.close();
  }

  console.log("=== the words are typed where they are drawn ===");
  {
    /* A table opened as one field of pipes is a table you edit by counting
     * walls. Its cells are drawn in known places, so a double-click lands in
     * one of them and the field goes exactly where that cell's words are.
     */
    await server.request("POST", "/api/docs",
      { fileName: "typing.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 200x120 kind=table",
        '    A["Person<br/>name | string<br/>age | int"]'
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/typing.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const groupOf = (id) => canvas.querySelector(`.dd-node[data-id="${id}"]`);
    const field = () => canvas.querySelector(".ve-diagram-inline");
    const rows = () => [...groupOf("A").querySelectorAll(".dd-row")]
      .map((one) => one.textContent);

    // The diagram is drawn in its own coordinates and clicked in the window's,
    // so a point in the table has to be put through the view to be aimed at.
    const onScreen = (x, y) => {
      const said = /translate\(([-\d.]+),([-\d.]+)\) scale\(([\d.]+)\)/
        .exec(canvas.querySelector(".dd-view").getAttribute("transform"));
      const view = { x: Number(said[1]), y: Number(said[2]), scale: Number(said[3]) };
      return { x: (x * view.scale) + view.x, y: (y * view.scale) + view.y, scale: view.scale };
    };

    /* Two presses, the way a browser sends them — and re-asking for the box
     * between them, because the first press selects it and selecting redraws
     * the whole drawing. A test that dispatched one `dblclick` at an element it
     * held onto would pass against an editor no hand could open.
     */
    const openAt = (x, y) => {
      const spot = onScreen(x, y);
      const press = () => {
        groupOf("A").dispatchEvent(new window.MouseEvent("pointerdown",
          { clientX: spot.x, clientY: spot.y, bubbles: true, cancelable: true }));
        canvas.dispatchEvent(new window.MouseEvent("pointerup",
          { clientX: spot.x, clientY: spot.y, bubbles: true, cancelable: true }));
      };

      press();
      press();
    };

    const press = (key, options = {}) => field().dispatchEvent(
      new window.KeyboardEvent("keydown",
        { key, bubbles: true, cancelable: true, ...options }));

    const typed = (words) => {
      field().value = words;
    };

    // Where the field is, rounded, so it can be compared with where the cell is.
    const over = () => ({
      x: Math.round(Number(field().style.left.replace("px", ""))),
      y: Math.round(Number(field().style.top.replace("px", ""))),
      w: Math.round(Number(field().style.width.replace("px", "")))
    });

    check("a table starts with its words in its cells",
      rows(), ["name", "string", "age", "int"]);
    check("...and nothing being typed into", field(), null);

    /* The table is 200 across and 120 down at 100,100, with a title band of 26
     * over two rows of two. So the second cell of the first row is the 100 to
     * 200 half, 26 to 73 down — and its middle is what is aimed at here.
     */
    openAt(250, 149);
    check("double-clicking a cell opens that cell", Boolean(field()), true);
    check("...saying what that cell says", field().value, "string");
    check("...set against its left wall, the way a cell is drawn",
      field().classList.contains("ve-diagram-inline-left"), true);
    check("...and standing exactly over it", over(),
      { x: Math.round(onScreen(200, 126).x), y: Math.round(onScreen(200, 126).y),
        w: Math.round(100 * onScreen(0, 0).scale) });

    typed("text");
    press("Enter");
    check("what is typed goes into that cell and no other",
      rows(), ["name", "text", "age", "int"]);
    check("...and the field is put away", field(), null);

    /* Tab walks the grid, the way it does in every table anybody has typed
     * into. Without it a table is filled in by double-clicking once per cell.
     */
    openAt(150, 149);
    check("Tab starts where you opened", field().value, "name");
    press("Tab");
    check("...and steps along to the next cell",
      [field().value, over().x], ["text", Math.round(onScreen(200, 126).x)]);
    press("Tab");
    check("...and round the end of the row into the one below",
      [field().value, over().y], ["age", Math.round(onScreen(100, 173).y)]);
    press("Tab", { shiftKey: true });
    check("...and back the other way", field().value, "text");

    press("Tab");
    press("Tab");
    press("Tab");
    check("...and off the last cell it closes rather than wrapping", field(), null);

    /* Asked for without a point — from a key — it opens the first thing anybody
     * would want to type, which for a table is its title.
     */
    canvas.dispatchEvent(new window.KeyboardEvent("keydown",
      { key: "Enter", bubbles: true, cancelable: true }));
    check("a key opens the title, being the first thing anybody would type",
      field().value, "Person");
    press("Escape");

    // The title spans the whole table, the way it is drawn.
    openAt(200, 113);
    check("the title band opens the title", field().value, "Person");
    check("...spanning the whole table", over().w, Math.round(200 * onScreen(0, 0).scale));
    // A title is drawn in the middle of its band and a cell against its left
    // wall, and a field that disagrees is a word that jumps when you stop.
    check("...and set in the middle, the way a title is drawn",
      field().classList.contains("ve-diagram-inline-left"), false);

    /* A pipe is the wall between two cells and a line break is the wall between
     * two rows, so neither can be inside one.
     */
    typed("A | person\nhere");
    press("Enter");
    check("neither wall can be typed into a cell",
      groupOf("A").querySelector(".dd-title").textContent, "A person here");

    await saveAndWait(page);
    const written = (await server.request("GET", "/api/docs/typing.mmd",
      undefined, { Cookie: cookie })).body.content;
    check("and what was typed on the paper is what the file says",
      /A\["A person here<br\/>name \| text<br\/>age \| int"\]/.test(written), true);

    /* A box just put down is a box about to be named, and the place to name it
     * is the box rather than a field in a panel on the other side of the screen.
     */
    canvas.dispatchEvent(new window.MouseEvent("contextmenu",
      { clientX: 40, clientY: 40, bubbles: true, cancelable: true }));
    [...canvas.querySelectorAll(".ve-diagram-menu .context-item")]
      .find((one) => one.querySelector("span").textContent.trim() === "Add box here")
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    check("a box just put down is open for its name, on the paper",
      Boolean(field()), true);
    check("...with the name it was given ready to be typed over",
      field().value, "Step 2");

    page.window.close();

    /* A cell may be set in its own type, and the field over it has to be set in
     * that type rather than in the table's — otherwise the one cell anybody
     * bothered to enlarge is the one cell that jumps when you stop typing.
     */
    await server.request("POST", "/api/docs",
      { fileName: "sized.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 200x120 kind=table cells=1.1:24",
        '    A["Person<br/>name | string"]'
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const sized = await openPage({ url: `${origin}/diagram/file/sized.mmd`, cookie, origin });
    const paper = sized.document.querySelector(".ve-diagram-canvas");
    const table = () => paper.querySelector('.dd-node[data-id="A"]');
    const typing = () => paper.querySelector(".ve-diagram-inline");
    const view = () => Number(/scale\(([\d.]+)\)/
      .exec(paper.querySelector(".dd-view").getAttribute("transform"))[1]);

    // The diagram is drawn in its own coordinates and pressed in the window's.
    const pressAt = (x, y) => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\) scale\(([\d.]+)\)/
        .exec(paper.querySelector(".dd-view").getAttribute("transform"));
      const spot = {
        clientX: (x * Number(found[3])) + Number(found[1]),
        clientY: (y * Number(found[3])) + Number(found[2]),
        bubbles: true,
        cancelable: true
      };

      for (let count = 0; count < 2; count += 1) {
        table().dispatchEvent(new sized.window.MouseEvent("pointerdown", spot));
        paper.dispatchEvent(new sized.window.MouseEvent("pointerup", spot));
      }
    };

    // Row one, column one: the cell the file set in 24px.
    pressAt(250, 149);
    check("a cell set in its own type is typed into in that type",
      typing().style.fontSize, `${24 * view()}px`);
    typing().dispatchEvent(new sized.window.KeyboardEvent("keydown",
      { key: "Escape", bubbles: true, cancelable: true }));

    await new Promise((r) => setTimeout(r, 450));

    // Row one, column nought, which set nothing and so takes the table's.
    pressAt(150, 149);
    // 13px is the size a box is drawn in when it says nothing about its type.
    check("...and one that set none takes the table's",
      typing().style.fontSize, `${13 * view()}px`);

    sized.window.close();
  }

  console.log("=== the keys are the builder's, not the paper's ===");
  {
    /* Every shortcut used to need the canvas itself to have the focus. So
     * pressing Delete after choosing a colour did nothing at all: the swatch
     * had the focus and the canvas was what was listening.
     *
     * Anything inside the builder is near enough the diagram to mean the
     * diagram. Except a field, where Backspace takes a letter off a word; and
     * except the keys a control uses to work itself, because a panel nobody can
     * press a button in from the keyboard is not an improvement.
     */
    await server.request("POST", "/api/docs",
      { fileName: "keys.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 120x60",
        "    %% @ B 100,300 120x60",
        "    A[One]",
        "    B[Two]"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/keys.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const inspector = page.document.querySelector(".ve-diagram-inspector");
    const rail = page.document.querySelector(".ve-diagram-rail");
    const boxes = () => canvas.querySelectorAll(".dd-node").length;
    const groupOf = (id) => canvas.querySelector(`.dd-node[data-id="${id}"]`);
    const whereIs = (id) => groupOf(id).getAttribute("transform");

    const press = (where, key, options = {}) => where.dispatchEvent(
      new window.KeyboardEvent("keydown",
        { key, bubbles: true, cancelable: true, ...options }));

    const tap = (id) => {
      const spot = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(whereIs(id));
      const x = Number(spot[1]) + 10;
      const y = Number(spot[2]) + 10;
      groupOf(id).dispatchEvent(new window.MouseEvent("pointerdown",
        { clientX: x, clientY: y, bubbles: true }));
      canvas.dispatchEvent(new window.MouseEvent("pointerup",
        { clientX: x, clientY: y, bubbles: true }));
    };

    tap("A");
    const swatch = inspector.querySelector(".ve-diagram-swatch");
    const was = whereIs("A");
    press(swatch, "ArrowRight");
    check("an arrow key with the focus in the panel still nudges the box",
      whereIs("A") === was, false);

    /* Except in a field, where Backspace takes a letter off a word. An editor
     * that also took the box away is an editor nothing can be renamed in.
     */
    press(inspector.querySelector(".ve-diagram-text"), "Backspace");
    check("...but a key typed into a field belongs to the field", boxes(), 2);

    press(rail.querySelector("button"), "a");
    check("...and a letter with the focus on the rail still picks the tool up",
      canvas.classList.contains("is-joining"), true);
    press(rail.querySelector("button"), "Escape");
    check("...and Escape still puts it down", canvas.classList.contains("is-joining"), false);

    /* Enter and Space on a button are how a button is pressed. A shortcut that
     * swallowed them would be a panel that cannot be worked from the keyboard
     * at all — so the control that uses the key keeps it.
     */
    /* Long enough after the last press on this box to be a second click rather
     * than the second half of a double one — which would open the box to be
     * typed in, and that is the thing this is checking does not happen.
     */
    await new Promise((r) => setTimeout(r, 450));
    tap("A");
    press(rail.querySelector("button"), "Enter");
    check("Enter on a button belongs to the button",
      canvas.querySelector(".ve-diagram-inline"), null);
    press(rail.querySelector("button"), " ");
    check("...and so does the space bar",
      canvas.classList.contains("is-panning-armed"), false);

    press(inspector, " ");
    check("...while the space bar anywhere else arms the hand",
      canvas.classList.contains("is-panning-armed"), true);
    inspector.dispatchEvent(new window.KeyboardEvent("keyup",
      { key: " ", bubbles: true }));
    check("...and letting it go puts the hand away",
      canvas.classList.contains("is-panning-armed"), false);

    press(inspector, "Enter");
    const inline = canvas.querySelector(".ve-diagram-inline");
    check("Enter with the focus in the panel opens the box for typing",
      Boolean(inline), true);
    press(inline, "Backspace");
    check("...and Backspace in what you are typing into is a letter, not the box",
      boxes(), 2);
    press(inline, "Escape");

    // The grip is moved with the arrow keys, and a grip that also moved the box
    // it is beside would be a grip nobody could use.
    const grip = page.document.querySelector(".ve-diagram-grip-side");
    const body = page.document.querySelector(".ve-diagram-body");
    const wide = body.style.getPropertyValue("--dd-side");
    const stood = whereIs("A");
    press(grip, "ArrowLeft");
    check("a key the grip has already answered is not the diagram's as well",
      [body.style.getPropertyValue("--dd-side") === wide, whereIs("A")],
      [false, stood]);

    tap("A");
    press(inspector.querySelector(".ve-diagram-swatch"), "Delete");
    check("Delete with the focus in the panel takes the box away", boxes(), 1);

    page.window.close();
  }

};
