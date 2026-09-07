// Part of the diagram-page suite. See diagram-page.test.js, which sets all this
// up and calls it.
//
// The bar, the rails, the panel, saving a picture of it, and tables.
//
// Everything it needs is handed to it: the suite's own check(), the helpers
// that boot a page and drag a box, and the fixtures. Split out of one file only
// because that file had grown well past a thousand lines.
module.exports = async (ctx) => {
  const {
    check, server, cookie, origin, openPage, saveAndWait, waitFor, csrfFor
  } = ctx;

  console.log("=== the editor is a bar, two rails and the paper between them ===");
  {
    /* Where a control is says what it does to.
     *
     * The bar along the top is what is done to the whole diagram, the rail is
     * what can be put into it, the panel is what is true of what is picked,
     * and the zoom is about the window rather than about the drawing — so the
     * zoom is on the paper and nothing else is. A control in the wrong region
     * is a control nobody looks for twice.
     */
    await server.request("POST", "/api/docs",
      { fileName: "regions.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 80x40",
        "    A[One]"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/regions.mmd`, cookie, origin });
    const where = (selector) => {
      const found = page.document.querySelector(selector);
      if (!found) return null;
      for (const region of ["bar", "rail", "stage", "side"]) {
        if (found.closest(`.ve-diagram-${region}`)) return region;
      }

      return "loose";
    };

    check("there is one of each region",
      ["shell", "bar", "rail", "stage", "side"]
        .map((one) => page.document.querySelectorAll(`.ve-diagram-${one}`).length),
      [1, 1, 1, 1, 1]);

    check("the shapes are on the rail", where(".ve-diagram-palette"), "rail");
    check("...the paper is the stage", where(".ve-diagram-canvas"), "stage");
    check("...what is true of a box is in the panel",
      [where(".ve-diagram-inspector"), where(".ve-diagram-hint")], ["side", "side"]);
    check("...the whole diagram's own controls are on the bar",
      [where(".ve-diagram-tidy"), where(".ve-diagram-flow"), where(".ve-diagram-steps")],
      ["bar", "bar", "bar"]);
    check("...as are the two tools that change what a drag means",
      [...page.document.querySelectorAll(".ve-diagram-icon[aria-pressed]")]
        .every((one) => one.closest(".ve-diagram-bar")), true);
    check("...and the zoom is on the paper, because it is about the window",
      where(".ve-diagram-zoom"), "stage");

    // The page's own bar names the diagram. Naming it again here would be the
    // same words twice on one screen.
    check("the editor does not name a diagram its host has already named",
      page.document.querySelector(".ve-diagram-name"), null);

    // Six shapes, each showing the outline it puts on the paper. An icon font's
    // nearest square is not that, so these are drawn here.
    const shapes = [...page.document.querySelectorAll(".ve-diagram-tool")];
    /* An icon and a picture on the rail, put down on their own rather than
     * inside a rectangle: what is on the paper is the thing, which is what most
     * of a technical diagram is made of.
     */
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const rail = [...page.document.querySelectorAll(".ve-diagram-tool")]
      .map((one) => one.textContent);
    check("the rail offers an icon and a picture as well as the shapes",
      ["Icon", "Picture"].filter((one) => rail.includes(one)),
      ["Icon", "Picture"]);

    /* A shape is put down in two taps: one on the rail to say what, and one on
     * the paper to say where. Tapping the rail used to put the shape down
     * wherever there happened to be room, which is an answer to a question
     * nobody asked — every box then cost a tap and a drag.
     */
    const armTool = (label) => {
      const tool = [...page.document.querySelectorAll(".ve-diagram-tool")]
        .find((one) => one.textContent === label);
      tool.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true }));
      tool.dispatchEvent(new window.MouseEvent("pointerup", { bubbles: true }));
      return tool;
    };

    const tapPaper = (x, y) => canvas.dispatchEvent(new window.MouseEvent("pointerdown",
      { bubbles: true, clientX: x, clientY: y }));

    const before = canvas.querySelectorAll(".dd-node").length;
    const armed = armTool("Icon");
    check("tapping a shape on the rail puts nothing on the paper yet",
      canvas.querySelectorAll(".dd-node").length, before);
    check("...and the shape that is armed says so",
      armed.getAttribute("aria-pressed"), "true");

    tapPaper(240, 180);
    await new Promise((done) => setTimeout(done, 300));

    check("...and the tap on the paper is what puts it down",
      canvas.querySelectorAll(".dd-node").length, before + 1);
    check("...after which nothing is armed any more",
      armed.getAttribute("aria-pressed"), "false");

    const put = [...canvas.querySelectorAll(".dd-node")].pop();
    check("an icon put down is an icon and not a rectangle with one in it",
      [Boolean(put.querySelector(".dd-icon")), Boolean(put.querySelector(".dd-shape"))],
      [true, false]);
    check("...and is still a box, so it can be joined and moved like the rest",
      Boolean(put.getAttribute("data-id")), true);

    check("every shape on the rail shows a picture of itself",
      shapes.length > 0 && shapes.every((one) => one.querySelector("svg.ve-diagram-glyph")),
      true);
    check("...and still says what it is", shapes[0].textContent, "Box");

    /* The rest of the vocabulary a technical diagram is drawn in, none of
     * which Mermaid has brackets for. Each is written as the nearest real
     * shape with the exact one said beside it, so what is dropped here has to
     * come back out of the file as what was dropped.
     */
    let spot = 200;
    const drop = async (label) => {
      armTool(label);
      // Somewhere new each time, so that what is being looked at is the shape
      // just put down rather than the one it landed on top of.
      spot += 60;
      tapPaper(spot, spot);
      await new Promise((done) => setTimeout(done, 300));
      return [...canvas.querySelectorAll(".dd-node")].pop();
    };

    check("a note put down is a page with its corner turned down",
      /L[\d.]+,[\d.]+ V/.test((await drop("Note")).querySelector(".dd-shape").getAttribute("d")),
      true);
    check("a cloud put down is one closed path rather than a heap of circles",
      (await drop("Cloud")).querySelectorAll("path.dd-shape, circle.dd-shape").length, 1);
    check("an actor put down is a figure with limbs",
      Boolean((await drop("Actor")).querySelector(".dd-actor")), true);
    check("a queue put down is a cylinder on its side",
      /A [\d.]+,[\d.]+ 0 0 1/.test((await drop("Queue")).querySelector(".dd-shape").getAttribute("d")),
      true);

    /* Words on the paper with nothing round them. A heading over a group of
     * boxes is not itself a step, and drawing a box round it says it is.
     */
    const text = await drop("Text");
    check("text put down is words and no shape",
      [text.textContent, Boolean(text.querySelector(".dd-shape"))], ["Text", false]);

    /* Where the tap said, and not wherever there happened to be room.
     *
     * Which is the whole difference: the old rail put a shape under the lowest
     * box, or nudged it sideways until it was clear of everything, and the
     * shape then had to be dragged from there to wherever it was wanted. So
     * two things are asked. Two taps far apart put two shapes far apart, in the
     * order they were tapped — and two taps on the same spot put both shapes on
     * the same spot, which a rail that nudges things clear of each other could
     * never do.
     */
    const middle = (one) => {
      const at = /translate\((-?[\d.]+)[ ,]+(-?[\d.]+)\)/
        .exec(one.getAttribute("transform")) || [];
      return [Number(at[1]), Number(at[2])];
    };

    // By the id that was not there a moment ago, rather than by whichever
    // group is drawn last: what is on top is a question about stacking order,
    // and the one just put down is not always the answer to it.
    const ids = () => new Set([...canvas.querySelectorAll(".dd-node")]
      .map((one) => one.getAttribute("data-id")));

    const placeAt = async (label, x, y) => {
      const had = ids();
      armTool(label);
      tapPaper(x, y);
      await new Promise((done) => setTimeout(done, 300));

      const made = [...ids()].find((one) => !had.has(one));
      return made ? middle(canvas.querySelector(`.dd-node[data-id="${made}"]`)) : null;
    };

    const near = await placeAt("Box", 300, 300);
    const far = await placeAt("Box", 620, 520);

    check("a shape goes where the paper was tapped, not where there was room",
      [far[0] > near[0], far[1] > near[1]], [true, true]);

    const over = await placeAt("Box", 300, 300);
    check("...and two tapped on one spot land on it, rather than being nudged"
      + " clear of each other", over, near);

    /* A mode wants a way out that is not "use it". Two of them: the button that
     * turned it on, and the key that dismisses everything else here.
     */
    const box = armTool("Box");
    check("tapping the armed shape again puts the tool down",
      armTool("Box").getAttribute("aria-pressed"), "false");
    check("...and so does Escape", (() => {
      armTool("Box");
      const held = box.getAttribute("aria-pressed");
      page.document.querySelector(".ve-diagram-shell").dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return [held, box.getAttribute("aria-pressed")];
    })(), ["true", "false"]);

    const settled = canvas.querySelectorAll(".dd-node").length;
    tapPaper(500, 400);
    await new Promise((done) => setTimeout(done, 300));
    check("...after which a tap on the paper is a tap and not a placement",
      canvas.querySelectorAll(".dd-node").length, settled);

    await saveAndWait(page);
    const vocabulary = (await server.request("GET", "/api/docs/regions.mmd",
      undefined, { Cookie: cookie })).body.content;
    /* Words on the paper are their own kind in the file, rather than a box with
     * its frame turned off. Which is what lets the panel for one be a panel
     * about words instead of a panel about a box with most of it greyed out.
     */
    check("text reaches the file as its own kind", /kind=text/.test(vocabulary), true);
    check("...and each reaches the file as the nearest real shape",
      ["A[", "((", "([", "[("].every((real) => vocabulary.includes(real)), true);
    check("...with the exact one said beside it",
      ["note", "cloud", "actor", "queue"]
        .filter((name) => new RegExp(`shape=${name}`).test(vocabulary)),
      ["note", "cloud", "actor", "queue"]);

    page.window.close();
  }

  console.log("=== the panel names what it is showing you ===");
  {
    /* Every control here used to sit in a row with two others and no words at
     * all, which left a menu of six shapes and a menu of three border weights
     * looking like the same unlabelled menu twice — and the label field, the
     * one thing anybody types into, sharing its line with a menu and a delete
     * button in a column narrower than any of the three wanted.
     */
    await server.request("POST", "/api/docs",
      { fileName: "panel.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 80x40",
        "    %% @ B 300,100 120x80 kind=table",
        "    %% @ C 300,300 120x60 kind=table",
        "    A[One]",
        '    B["Two<br/>a | x<br/>b"]',
        "    C[Three]",
        "    A --> B"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/panel.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const inspector = page.document.querySelector(".ve-diagram-inspector");
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
    const captions = () => [...inspector.querySelectorAll(".ve-diagram-field-name")]
      .map((one) => one.textContent);

    tap("A");
    check("a panel about a box says so at the top",
      inspector.querySelector(".ve-diagram-picked .ve-diagram-legend").textContent, "Box");
    check("...with the way to remove it up there, since it is not a property of it",
      Boolean(inspector.querySelector(".ve-diagram-picked > .ve-diagram-drop")), true);
    check("...and every control below it named",
      captions(),
      ["Label", "Shape", "Fill", "Colours", "Border", "Font", "Picture", "Icon"]);

    // A label wrapping its control is also the label that control answers to,
    // so the caption is a way into the field rather than a word beside it. A
    // group of buttons is not something a label can point at, so those keep the
    // group's own aria-label and get a plain box.
    const holder = (name) => [...inspector.querySelectorAll(".ve-diagram-field")]
      .find((one) => one.querySelector(".ve-diagram-field-name").textContent === name);
    check("a caption over one control is that control's own label",
      [holder("Label").tagName, holder("Shape").tagName], ["LABEL", "LABEL"]);
    check("...and a caption over a group of buttons is not, because it cannot be",
      [holder("Fill").tagName, holder("Fill").querySelector("[role=group]")
        .getAttribute("aria-label")], ["DIV", "Colour"]);

    /* The field grows with what is typed into it. A box can hold a paragraph,
     * and a field that shows one line of it and scrolls the rest is a field you
     * cannot read your own diagram in.
     */
    const label = holder("Label").querySelector(".ve-diagram-text");
    check("the label field starts at the one line the box has", label.rows, 1);
    label.value = "One\ntwo\nthree";
    label.dispatchEvent(new window.Event("input", { bubbles: true }));
    check("...and grows by the line as it is filled", label.rows, 3);
    check("...up to a point, since the panel holds more than this field", (() => {
      label.value = new Array(40).fill("x").join("\n");
      label.dispatchEvent(new window.Event("input", { bubbles: true }));
      return label.rows;
    })(), 10);

    /* A table is a grid, and a grid typed into one box as lines of pipes is a
     * grid you have to hold in your head to edit: which of these words is in
     * the second column is a question you answer by counting. So a table gets
     * one field per cell, laid out the way it is drawn.
     */
    tap("B");
    check("a table says it is one",
      inspector.querySelector(".ve-diagram-picked .ve-diagram-legend").textContent, "Table");
    check("...and calls its words what they are", captions()[0], "Cells");
    check("...and offers the two numbers a table has",
      captions().slice(1, 3), ["Rows", "Columns"]);
    check("...and the spacing that goes with them",
      captions().slice(3, 5), ["Padding", "Spacing"]);
    check("...typed one cell at a time rather than as lines of pipes",
      [Boolean(inspector.querySelector(".ve-diagram-cells")),
        inspector.querySelector(".ve-diagram-text")], [true, null]);

    // A field per cell, plus the title, which spans the table the same way it
    // is drawn.
    const fields = () => [...inspector.querySelectorAll(".ve-diagram-cell")]
      .map((one) => one.value);
    // Five fields for a title and a two-by-two grid, and the row that was
    // written with only one cell in it gets the empty one it is short.
    check("one field per cell, with the words already in them",
      fields(), ["Two", "a", "x", "b", ""]);
    check("...the title spanning the whole of it",
      inspector.querySelector(".ve-diagram-cell").classList
        .contains("ve-diagram-cell-title"), true);
    check("...and the panel laid out in as many columns as the table has",
      inspector.querySelector(".ve-diagram-cells").style
        .getPropertyValue("--dd-columns"), "2");

    page.window.close();
  }

  console.log("=== a picture of the diagram, for somewhere this app is not ===");
  {
    /* The file is the diagram. A picture of it is what you paste into
     * something that cannot open one — so both are done to the whole diagram,
     * and both live on the bar.
     */
    await server.request("POST", "/api/docs",
      { fileName: "picture.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 0,0 120x60",
        "    %% @ B 0,140 100x60",
        "    A[One]",
        "    B[Two]",
        "    A --> B"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/picture.mmd`, cookie, origin });
    const { window } = page;

    const button = (label) => [...page.document.querySelectorAll(".ve-diagram-export")]
      .find((one) => one.textContent === label);

    check("the bar offers a picture of the diagram in two shapes",
      [Boolean(button("SVG")), Boolean(button("PNG"))], [true, true]);
    check("...and says so where the rest of the whole-diagram controls are",
      Boolean(button("SVG").closest(".ve-diagram-bar")), true);

    /* What is handed over, and under what name. The browser is given a link it
     * clicks itself, so this is the only place the file is observable.
     */
    /* jsdom has no stylesheet and so no theme to read, which is exactly what
     * the export reads. Put one on the page and it has something true to find.
     */
    page.document.documentElement.style.setProperty("--fg", "#e6edf3");
    page.document.documentElement.style.setProperty("--canvas", "#06090a");

    let handed = null;
    window.URL.createObjectURL = (blob) => {
      handed = blob;
      return "blob:picture";
    };
    window.URL.revokeObjectURL = () => {};

    let named = null;
    const madeLink = window.document.createElement.bind(window.document);
    window.document.createElement = (tag) => {
      const made = madeLink(tag);
      if (tag === "a") {
        made.click = () => { named = made.download; };
      }

      return made;
    };

    button("SVG").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitFor(window, () => handed !== null, "the picture was never handed over");

    check("saving hands over an SVG", handed.type, "image/svg+xml");
    check("...named after the diagram rather than after nothing",
      named, "picture.svg");

    const text = await handed.text();
    check("...carrying the rules it is painted by", text.includes("<style>.dd{"), true);
    check("...and the theme it was painted in, as the page has it now",
      /<svg[^>]*style="[^"]*--fg:#e6edf3/.test(text), true);
    check("...painted on a background, since pale lines on an unknown page is"
      + " a picture of nothing",
      text.includes('fill="#06090a"'), true);
    check("...and needing nothing else to be looked at",
      /<(?:link|script)\b/.test(text), false);
    check("...and it is the diagram that was on the screen",
      (text.match(/<g class="dd-node" data-id=/g) || []).length, 2);

    page.window.close();
  }

  console.log("=== a table is so many rows by so many columns ===");
  {
    /* Rows and columns are the two things about a table you change one at a
     * time, and typing pipes into a field to say "one more column" is a strange
     * way to ask for one more column. The count reads as well as sets, so the
     * shape of the table is something the panel says rather than something you
     * work out by counting the pipes in the field above it.
     */
    await server.request("POST", "/api/docs",
      { fileName: "grid.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 200x120 kind=table",
        // Deliberately shorter than the three rows in it need: a box can be
        // dragged smaller than its contents, and the steppers have to cope.
        "    %% @ B 100,400 200x40 kind=table",
        '    A["Person<br/>name | string<br/>age | int"]',
        '    B["T<br/>a | b<br/>c | d"]'
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    const page = await openPage({ url: `${origin}/diagram/file/grid.mmd`, cookie, origin });
    const { window } = page;
    const canvas = page.document.querySelector(".ve-diagram-canvas");
    const inspector = page.document.querySelector(".ve-diagram-inspector");
    const groupOf = (id) => canvas.querySelector(`.dd-node[data-id="${id}"]`);

    const tap = (id) => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(groupOf(id).getAttribute("transform"));
      groupOf(id).dispatchEvent(new window.MouseEvent("pointerdown",
        { clientX: Number(found[1]) + 10, clientY: Number(found[2]) + 10, bubbles: true }));
      canvas.dispatchEvent(new window.MouseEvent("pointerup",
        { clientX: Number(found[1]) + 10, clientY: Number(found[2]) + 10, bubbles: true }));
    };

    const steppers = () => [...inspector.querySelectorAll(".ve-diagram-stepper")];
    const stepper = (name) => steppers()
      .find((one) => one.getAttribute("aria-label") === name);
    const count = (name) =>
      Number(stepper(name).querySelector(".ve-diagram-count").textContent);
    const counts = () => [count("Rows"), count("Columns")];
    const spacing = () => [count("Padding"), count("Spacing")];
    const press = (name, which) => stepper(name)
      .querySelectorAll(".ve-diagram-step")[which]
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const fewer = (name) => press(name, 0);
    const more = (name) => press(name, 1);
    const cells = () => [...groupOf("A").querySelectorAll(".dd-row")]
      .map((one) => one.textContent);
    const rules = () => groupOf("A").querySelectorAll(".dd-cell-rule").length;
    const boxOf = (id = "A") => {
      const at = groupOf(id).querySelector("rect");
      return [Number(at.getAttribute("width")), Number(at.getAttribute("height"))];
    };

    tap("A");
    check("a table says how many rows and columns it has", counts(), [3, 2]);
    check("...and is drawn with a line between each of them", rules(), 2);

    /* A table dragged off the rail arrives as a table.
     *
     * It used to arrive as a heading with one line under it, which is one
     * column and one row — a shape with no grid in it to see. Whatever is
     * dropped on the paper has to be the thing that was picked up.
     */
    const shape = [...page.document.querySelectorAll(".ve-diagram-tool")]
      .find((one) => one.dataset.kind === "table");
    shape.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true }));
    shape.dispatchEvent(new window.MouseEvent("pointerup", { bubbles: true }));
    // The rail says what; the paper says where.
    canvas.dispatchEvent(new window.MouseEvent("pointerdown",
      { bubbles: true, clientX: 420, clientY: 320 }));
    await new Promise((done) => setTimeout(done, 300));

    check("a table dropped on the paper is a table", counts(), [3, 2]);
    const fresh = [...canvas.querySelectorAll(".dd-node")].pop();
    check("...with its rows and its columns drawn",
      fresh.querySelectorAll(".dd-cell-rule").length, 2);
    check("...and nothing written in it but its heading",
      [...fresh.querySelectorAll(".dd-text")].map((one) => one.textContent), ["Table"]);

    tap("A");

    /* The size it was given in the file, which is bigger than a table of these
     * cells needs. Read before anything is pressed, because the question below
     * is what the steppers do to a size somebody chose by hand.
     */
    const [wide, high] = boxOf();

    // Rows enough to need more room than the file gave it. A table with room
    // for another row does not have to grow to hold one.
    more("Rows");
    more("Rows");
    more("Rows");
    check("asking for rows gives them", counts(), [6, 2]);
    check("...and the table grows to hold them", boxOf()[1] > high, true);
    check("...and no wider, since none of that was about its width",
      boxOf()[0], wide);

    const tall = boxOf()[1];
    fewer("Rows");
    check("taking one off again leaves the size it had", boxOf(), [wide, tall]);
    check("...because the rows share out the height between them rather than"
      + " stacking from the top",
      /y1="\d+" x2="200"/.test(groupOf("A").innerHTML), true);

    fewer("Rows");
    fewer("Rows");
    more("Columns");
    check("asking for another column gives it one", counts(), [3, 3]);
    check("...and draws the line that divides it", rules(), 3);
    check("...leaving what was already in it where it was",
      cells(), ["name", "string", "age", "int"]);
    // Every column needs room to be read in, so another column is a wider
    // table rather than a division of the width it already had.
    check("...and widens the table to hold it", boxOf()[0] > wide, true);

    const grew = boxOf()[0];
    fewer("Columns");
    check("and taking it away takes it away", counts(), [3, 2]);
    check("...the cells that were in it included", cells(), ["name", "string", "age", "int"]);
    check("...but not the width, because a box here grows and never shrinks",
      boxOf()[0], grew);

    /* One column has no line down it — there is nothing on either side of one
     * to divide — but it still has the lines between its rows. A table whose
     * structure you have to infer from where the words happen to sit is a box
     * with a list in it.
     */
    fewer("Columns");
    check("a table of one column has no line down it", counts(), [3, 1]);
    check("...but still has the one between its rows", rules(), 1);
    check("...and the second cell of every row gone with the column",
      cells(), ["name", "age"]);

    // A table of no columns is not a table, and a way down that goes nowhere
    // has to look like one rather than quietly doing nothing.
    check("...and no way down from there",
      stepper("Columns").querySelectorAll(".ve-diagram-step")[0].disabled, true);
    check("...though the way up is still open",
      stepper("Columns").querySelectorAll(".ve-diagram-step")[1].disabled, false);

    /* How the table is spaced out: how far the words sit from the walls of a
     * cell, and how much room a row gets.
     *
     * Both are statements about size, so the box follows them exactly rather
     * than only growing — which is the opposite of what adding a row does, and
     * for the opposite reason. A row is a thing to hold, and a box keeps
     * whatever size it was dragged to as long as it can hold it; asking for
     * shorter rows and getting the same table back is asking for nothing.
     */
    check("a table says how it is spaced out", spacing(), [10, 20]);

    const wordsAt = () =>
      Number(groupOf("A").querySelector(".dd-row").getAttribute("x"));
    check("...with its words that far in from the wall", wordsAt(), 10);

    more("Padding");
    check("more padding is more room before the words start", spacing()[0], 12);
    await new Promise((done) => setTimeout(done, 300));
    check("...which is where they start", wordsAt(), 12);

    fewer("Padding");
    fewer("Padding");
    check("and less is less", spacing()[0], 8);
    await new Promise((done) => setTimeout(done, 300));
    check("...there too", wordsAt(), 8);

    /* The box moves by the amount the change made, rather than to what the
     * table now needs: this one was dragged roomier than it needs to be, and a
     * stepper that snapped it to the minimum would take that away the moment it
     * was touched.
     */
    const before = boxOf()[1];
    more("Spacing");
    check("more spacing is more room for every row", spacing()[1], 25);
    await new Promise((done) => setTimeout(done, 300));
    check("...and a taller table to put them in", boxOf()[1] - before, 10);

    fewer("Spacing");
    fewer("Spacing");
    await new Promise((done) => setTimeout(done, 300));
    check("...and asking for less gives a shorter one, since asking for shorter"
      + " rows and getting the same table back is asking for nothing",
      before - boxOf()[1], 10);

    // Back to where it started, so what follows measures what it means to.
    more("Spacing");
    more("Padding");
    await new Promise((done) => setTimeout(done, 300));
    check("and back to the standard, which is the one the file leaves out",
      [spacing(), boxOf()[1]], [[10, 20], before]);

    /* A box can be dragged smaller than what is in it, so the difference the
     * stepper moves by has to stop somewhere: a table already too short for its
     * rows, asked for shorter ones, must not be walked down towards nothing.
     */
    tap("B");
    check("a table can be shorter than the rows in it", boxOf("B")[1], 40);
    fewer("Spacing");
    await new Promise((done) => setTimeout(done, 300));
    check("...and asking for less spacing takes it no further down than what"
      + " those rows need", boxOf("B")[1], 60);

    tap("A");

    /* Typing into a cell puts the words in that cell, and a pipe typed into one
     * is taken out again: it is the wall between two cells, so it cannot be
     * inside one. The label reaches the file quoted, which the row break
     * already required of it.
     */
    more("Columns");
    const field = (at) => inspector.querySelectorAll(".ve-diagram-cell")[at];
    const type = (at, words) => {
      field(at).value = words;
      field(at).dispatchEvent(new window.Event("input", { bubbles: true }));
    };

    type(0, "Person");
    type(1, "name");
    type(2, "string");
    type(3, "age");
    type(4, "int");

    // Typing redraws on a pause, the same as typing anywhere else here does.
    await new Promise((done) => setTimeout(done, 300));
    check("typing into a cell puts the words in that cell",
      cells(), ["name", "string", "age", "int"]);

    type(2, "str|ing");
    await new Promise((done) => setTimeout(done, 300));
    check("...and a pipe typed into one is taken back out of it",
      [field(2).value, cells()[1]], ["string", "string"]);

    await saveAndWait(page);
    const written = (await server.request("GET", "/api/docs/grid.mmd",
      undefined, { Cookie: cookie })).body.content;
    check("a grid reaches the file as one quoted label",
      /A\["Person<br\/>name \| string<br\/>age \| int"\]/.test(written), true);

    /* The type one cell is set in.
     *
     * Everything else on this panel dresses a whole node, because a classDef
     * dresses a whole node and that is all Mermaid can be told. A table is the
     * one place where that is not the grain of the thing — the header row wants
     * to be bold and the id column wants to be mono — so the controls are aimed
     * at whichever cell has the caret, and say which one that is.
     */
    const strip = () => [...inspector.querySelectorAll(".ve-diagram-font")]
      .find((one) => one.querySelector(".ve-diagram-aimed"));
    const aimed = () => strip().querySelector(".ve-diagram-aimed").textContent;
    const mark = (label) => strip().querySelector(`[aria-label="${label} cell"]`);
    const menu = (label) => strip().querySelector(`[aria-label="${label}"]`);
    const styleOf = (at) => groupOf("A").querySelectorAll(".dd-row")[at]
      .getAttribute("style") || "";

    check("a table has controls for the type one of its cells is set in",
      Boolean(strip()), true);
    check("...switched off while no cell has the caret",
      [mark("Bold").disabled, menu("Cell font").disabled], [true, true]);
    check("...and saying what they are waiting for",
      /Click into a cell/.test(aimed()), true);

    field(1).focus();
    check("clicking into a cell aims them at it", aimed(), "Row 1, column 1.");
    check("...and switches them on", mark("Bold").disabled, false);

    mark("Bold").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("a cell told to be bold says so on the button",
      mark("Bold").getAttribute("aria-pressed"), "true");
    check("...and is drawn bold", styleOf(0), "--dd-font-weight:700;");
    check("...and no other cell is", styleOf(1), "");

    field(2).focus();
    check("the caret moving moves what the controls are about",
      [aimed(), mark("Bold").getAttribute("aria-pressed")],
      ["Row 1, column 2.", "false"]);

    menu("Cell font").value = "Mono";
    menu("Cell font").dispatchEvent(new window.Event("change", { bubbles: true }));
    menu("Cell text size").value = "11";
    menu("Cell text size").dispatchEvent(new window.Event("change", { bubbles: true }));
    check("...and a family and a size are both said about that one cell",
      styleOf(1), "--dd-font-size:11px;--dd-font-family:monospace;");

    // A cell is set in one family, so choosing another takes the first off
    // rather than leaving the diagram wearing both.
    menu("Cell font").value = "Serif";
    menu("Cell font").dispatchEvent(new window.Event("change", { bubbles: true }));
    check("choosing another family takes the first one off",
      styleOf(1), "--dd-font-size:11px;--dd-font-family:serif;");

    menu("Cell font").value = "Default";
    menu("Cell font").dispatchEvent(new window.Event("change", { bubbles: true }));
    check("...and choosing none takes it off without taking the size with it",
      styleOf(1), "--dd-font-size:11px;");

    field(3).focus();
    mark("Italic").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    await saveAndWait(page);
    const dressed = (await server.request("GET", "/api/docs/grid.mmd",
      undefined, { Cookie: cookie })).body.content;
    check("what the cells wear reaches the file beside the table",
      /cells=1\.0:b;1\.1:11;2\.0:i/.test(dressed), true);

    /* A row taken off takes its cells' type with it. Keeping it would mean
     * that adding the row back later brings an old italic with it out of
     * nowhere, and it would leave the file dressing a row nobody can see.
     */
    fewer("Rows");
    await saveAndWait(page);
    const shorter = (await server.request("GET", "/api/docs/grid.mmd",
      undefined, { Cookie: cookie })).body.content;
    check("a row taken off takes what its cells wore with it",
      /cells=1\.0:b;1\.1:11(?: |$)/m.test(shorter), true);

    /* And is gone from the diagram, not merely left out of the file.
     *
     * Only left out, it would still be sitting in the table — so asking for
     * the row back would hand you a cell already italic, which nobody asked
     * for and nothing on the panel explains.
     */
    more("Rows");
    await saveAndWait(page);
    const back = (await server.request("GET", "/api/docs/grid.mmd",
      undefined, { Cookie: cookie })).body.content;
    check("...so asking for the row back does not bring the old italic with it",
      /2\.0:i/.test(back), false);

    page.window.close();
  }

};
