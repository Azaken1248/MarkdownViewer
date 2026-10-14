// Part of the diagram-page suite. See diagram-page.test.js, which sets all this
// up and calls it.
//
// The parts of the editor nothing had opened: the band drawn round a group of
// boxes, the corners an arrow is bent at, the menu an arrow has of its own,
// which box is in front of which, and the two buttons on the side that rebuild
// the whole diagram.
//
// None of it is new machinery. Everything here is a right-click, a drag or a
// press on something the eight files beside this one already know how to find.
module.exports = async (ctx) => {
  const { check, server, cookie, origin, openPage, csrfFor, settle, saveAndWait } = ctx;

  // What is on disk afterwards, which is the only place the editor's answer
  // actually lands: there is no source box on this page.
  const onDisk = async (name) => (await server.request("GET", `/api/docs/${name}`,
    undefined, { Cookie: cookie })).body.content;

  const wrote = async (name, lines) => server.request("POST", "/api/docs",
    { fileName: name, overwrite: true, content: `${lines.join("\n")}\n` },
    { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

  console.log("=== a band drawn round the boxes it crosses ===");
  {
    /* Dragging on the paper draws a band and takes everything it touches,
     * which is how a handful of boxes are picked up without clicking each one.
     */
    await wrote("band.mmd", [
      "flowchart TD",
      "    %% layout v1",
      "    %% @ A 100,100 100x60",
      "    %% @ B 100,300 100x60",
      "    %% @ C 100,900 100x60",
      "    A[One]",
      "    B[Two]",
      "    C[Three]"
    ]);

    const page = await openPage({ url: `${origin}/diagram/file/band.mmd`, cookie, origin });
    const { window, document } = page;
    const canvas = document.querySelector(".ve-diagram-canvas");

    /* A point on the paper, in the coordinates a press arrives in. The view is
     * translated and scaled to fit the diagram, so a diagram point and a
     * client point are not the same number.
     */
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

    const ringed = () => canvas.querySelectorAll(".dd-ring").length;
    const band = () => canvas.querySelector(".dd-marquee");

    canvas.dispatchEvent(new window.MouseEvent("pointerdown", at(50, 50)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(400, 400)));
    // Drawn on the next frame rather than on the event, because a band
    // redrawn on every pointermove is a redraw per pixel of the drag.
    await settle();
    check("dragging on the paper draws a band", Boolean(band()), true);
    // Rounded to the grid the band is drawn on, so a pixel either way.
    check("...as big as the drag it is, in the diagram's own coordinates",
      [Math.round(Number(band().getAttribute("width"))),
        Math.round(Number(band().getAttribute("height")))], [350, 350]);

    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(400, 400)));
    check("...and takes the boxes it crossed", ringed(), 2);
    check("...and the band itself is not left on the paper", Boolean(band()), false);

    // A band dragged over nothing is a way of letting go of everything, which
    // is what pressing the paper does and what a band over empty paper means.
    canvas.dispatchEvent(new window.MouseEvent("pointerdown", at(600, 600)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(700, 700)));
    await settle();
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(700, 700)));
    check("a band over empty paper holds nothing", ringed(), 0);
  }

  console.log("=== the corner an arrow is already bent at ===");
  {
    /* Bending an arrow is checked in arrows.js, by pressing the line. What is
     * not is dragging a corner that was already in the file when the diagram
     * was opened — which is the same handle and a different code path, because
     * the gesture starts on a dot rather than on a line.
     */
    await wrote("bends.mmd", [
      "flowchart TD",
      "    %% layout v1",
      "    %% @ A 100,100 100x60",
      "    %% @ B 100,500 100x60",
      "    %% edge 0 via=300,300",
      "    A[One]",
      "    B[Two]",
      "    A --> B"
    ]);

    const page = await openPage({ url: `${origin}/diagram/file/bends.mmd`, cookie, origin });
    const { window, document } = page;
    const canvas = document.querySelector(".ve-diagram-canvas");
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

    // The handles are on the arrows of the box being worked on, so the arrow
    // has to be in hand before its corner is there to take hold of.
    canvas.querySelector('.dd-node[data-id="A"]')
      .dispatchEvent(new window.MouseEvent("pointerdown", at(110, 110)));
    canvas.querySelector('.dd-node[data-id="A"]')
      .dispatchEvent(new window.MouseEvent("pointerup", at(110, 110)));

    const dot = canvas.querySelector(".dd-via");
    check("an arrow bent in the file has a corner to take hold of", Boolean(dot), true);

    dot.dispatchEvent(new window.MouseEvent("pointerdown", at(300, 300)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(360, 340)));
    await settle();
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(360, 340)));
    await saveAndWait(page);
    check("...and dragging it moves the bend, in the file",
      /%% edge 0 [^\n]*via=360,340/.test(await onDisk("bends.mmd")), true);

    const menuItem = (text) => [...canvas.querySelectorAll(".ve-diagram-menu .context-item")]
      .find((one) => one.querySelector("span").textContent.trim() === text);
    const rightClick = (target) => target.dispatchEvent(new window.MouseEvent("contextmenu",
      { clientX: 300, clientY: 300, bubbles: true, cancelable: true }));
    const line = () => canvas.querySelector(".dd-edge-hit, .dd-edge");

    rightClick(line());
    check("an arrow has a menu of its own",
      [...canvas.querySelectorAll(".ve-diagram-menu .context-item")]
        .map((one) => one.querySelector("span").textContent.trim()),
      ["Rename arrow", "Reverse arrow", "Straighten arrow", "Delete arrow"]);

    menuItem("Straighten arrow").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await saveAndWait(page);
    check("...and straightening it takes every corner out",
      /via=/.test(await onDisk("bends.mmd")), false);

    rightClick(line());
    menuItem("Reverse arrow").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await saveAndWait(page);
    check("...reversing it turns it round", /B --> A/.test(await onDisk("bends.mmd")), true);

    rightClick(line());
    menuItem("Delete arrow").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await saveAndWait(page);
    const left = await onDisk("bends.mmd");
    check("...and deleting it leaves the boxes it joined",
      [/-->/.test(left), canvas.querySelectorAll(".dd-node").length], [false, 2]);
  }

  console.log("=== which box is in front of which ===");
  {
    /* Two boxes that overlap are drawn in the order they are written in, so
     * the only way to put one in front is to move it in the file. There is no
     * z-index on an SVG: later is on top.
     */
    await wrote("stack.mmd", [
      "flowchart TD",
      "    %% layout v1",
      "    %% @ A 100,100 200x200",
      "    %% @ B 150,150 200x200",
      "    A[One]",
      "    B[Two]"
    ]);

    const page = await openPage({ url: `${origin}/diagram/file/stack.mmd`, cookie, origin });
    const { window, document } = page;
    const canvas = document.querySelector(".ve-diagram-canvas");
    const order = () => [...canvas.querySelectorAll(".dd-node")]
      .map((one) => one.getAttribute("data-id"));
    const menuItem = (text) => [...canvas.querySelectorAll(".ve-diagram-menu .context-item")]
      .find((one) => one.querySelector("span").textContent.trim() === text);
    const run = (text) => menuItem(text)
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const rightClick = (id) => canvas.querySelector(`.dd-node[data-id="${id}"]`)
      .dispatchEvent(new window.MouseEvent("contextmenu",
        { clientX: 200, clientY: 200, bubbles: true, cancelable: true }));

    check("the boxes are drawn in the order they are written", order(), ["A", "B"]);

    rightClick("A");
    run("Bring to front");
    check("bringing one to the front draws it last", order(), ["B", "A"]);

    rightClick("A");
    run("Send to back");
    check("...and sending it back draws it first", order(), ["A", "B"]);

    /* Which is a change to the file rather than to the view: there is no
     * z-index on an SVG, so the only way to put one box in front of another is
     * to move it in the document — and closing the page and opening it again
     * has to show the same thing.
     */
    rightClick("A");
    run("Bring to front");
    await saveAndWait(page);
    const written = await onDisk("stack.mmd");
    check("...and it is the file that changed",
      written.indexOf("B[Two]") < written.indexOf("A[One]"), true);
  }

  console.log("=== a selection taken away as Mermaid ===");
  {
    /* The one way out of the editor that is not a file: the boxes that are
     * held, written as the flowchart they are, so a piece of one diagram can
     * be pasted into another.
     */
    await wrote("part.mmd", [
      "flowchart TD",
      "    %% layout v1",
      "    %% @ A 100,100 100x60",
      "    %% @ B 100,300 100x60",
      "    %% @ C 400,100 100x60",
      "    A[One]",
      "    B[Two]",
      "    C[Three]",
      "    A --> B",
      "    A --> C"
    ]);

    const page = await openPage({ url: `${origin}/diagram/file/part.mmd`, cookie, origin });
    const { window, document } = page;
    const canvas = document.querySelector(".ve-diagram-canvas");

    const written = [];
    let refuses = false;
    Object.defineProperty(window, "navigator", {
      configurable: true,
      value: {
        clipboard: {
          writeText: async (text) => {
            if (refuses) {
              throw new Error("the clipboard said no");
            }
            written.push(text);
          }
        }
      }
    });

    const menuItem = (text) => [...canvas.querySelectorAll(".ve-diagram-menu .context-item")]
      .find((one) => one.querySelector("span").textContent.trim() === text);
    const rightClick = (id) => canvas.querySelector(`.dd-node[data-id="${id}"]`)
      .dispatchEvent(new window.MouseEvent("contextmenu",
        { clientX: 200, clientY: 200, bubbles: true, cancelable: true }));

    rightClick("A");
    menuItem("Copy box as Mermaid").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await Promise.resolve();

    check("one box goes out as a flowchart of one box",
      [written.length, /A\[One\]/.test(written[0]), /B\[Two\]/.test(written[0])],
      [1, true, false]);
    // An arrow with only one of its ends held is not part of what was taken:
    // pasting it would make an arrow to a box that is not there.
    check("...without the arrows that leave it", /-->/.test(written[0]), false);
    check("...and with where it sits, so it is pasted where it was drawn",
      /%% @ A /.test(written[0]), true);

    /* Not every browser and not every page will allow it, and a menu item that
     * throws is worse than one that quietly does nothing.
     */
    refuses = true;
    rightClick("A");
    check("a clipboard that refuses is not an error on the page",
      (menuItem("Copy box as Mermaid")
        .dispatchEvent(new window.MouseEvent("click", { bubbles: true })), true), true);

    Object.defineProperty(window, "navigator", { configurable: true, value: {} });
    rightClick("A");
    check("...and neither is a page with no clipboard at all",
      (menuItem("Copy box as Mermaid")
        .dispatchEvent(new window.MouseEvent("click", { bubbles: true })), true), true);
  }

  console.log("=== and the two buttons that rebuild the whole thing ===");
  {
    await wrote("rebuild.mmd", [
      "flowchart TD",
      "    %% layout v1",
      "    %% @ A 500,500 100x60",
      "    %% @ B 20,900 100x60",
      "    A[One]",
      "    B[Two]"
    ]);

    const page = await openPage({ url: `${origin}/diagram/file/rebuild.mmd`, cookie, origin });
    const { window, document } = page;
    const press = (selector) => document.querySelector(selector)
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    /* Tidy throws the hand-placed layout away and arranges every box again
     * from the flow direction, which is the way out of a diagram somebody has
     * dragged into a mess.
     */
    press(".ve-diagram-tidy");
    await saveAndWait(page);
    const tidied = await onDisk("rebuild.mmd");
    check("tidying arranges every box again", /%% @ A 500,500/.test(tidied), false);
    check("...keeping the boxes themselves", /A\[One\][\s\S]*B\[Two\]/.test(tidied), true);

    // Add arrow joins the first two boxes, because an arrow has to start
    // somewhere and the list is the only order there is.
    check("there are no arrows to begin with", /-->/.test(tidied), false);
    press(".ve-diagram-add");
    await saveAndWait(page);
    check("the add button joins the first two boxes",
      /A --> B/.test(await onDisk("rebuild.mmd")), true);
  }

  console.log("=== a box drawn by pulling an arrow into empty paper ===");
  {
    /* Pulling the connect handle onto another box joins them, which arrows.js
     * covers. Pulling it onto empty paper makes a box there and joins that —
     * which is how a flowchart is drawn one step at a time without going back
     * to the palette.
     */
    await wrote("pull.mmd", [
      "flowchart TD",
      "    %% layout v1",
      "    %% @ A 100,100 100x60",
      "    A[One]"
    ]);

    const page = await openPage({ url: `${origin}/diagram/file/pull.mmd`, cookie, origin });
    const { window, document } = page;
    const canvas = document.querySelector(".ve-diagram-canvas");
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

    const take = (id) => {
      const box = canvas.querySelector(`.dd-node[data-id="${id}"]`);
      box.dispatchEvent(new window.MouseEvent("pointerdown", at(110, 110)));
      box.dispatchEvent(new window.MouseEvent("pointerup", at(110, 110)));
    };

    take("A");
    const handle = canvas.querySelector(".dd-connect");
    check("a box in hand has a handle to pull an arrow out of", Boolean(handle), true);

    handle.dispatchEvent(new window.MouseEvent("pointerdown", at(150, 160)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(150, 400)));
    await settle();
    check("...and pulling it draws the arrow as it goes",
      canvas.querySelectorAll(".dd-draft").length, 1);

    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(150, 400)));
    await saveAndWait(page);
    const pulled = await onDisk("pull.mmd");
    check("letting go on empty paper makes a box there",
      canvas.querySelectorAll(".dd-node").length, 2);
    check("...joined to the one it came from", /A --> /.test(pulled), true);
    check("...and the draft arrow is not left on the paper",
      canvas.querySelectorAll(".dd-draft").length, 0);

    /* And a pull that went nowhere: a press and a release on the handle is
     * still a new box, put below the one it came from, because that is what
     * tapping the handle is for.
     */
    /* And a tap on the handle rather than a pull, which is still a new box —
     * put below the one it came from, because that is where the next step of
     * a flowchart goes.
     */
    take("A");
    const again = canvas.querySelector(".dd-connect");
    again.dispatchEvent(new window.MouseEvent("pointerdown", at(150, 160)));
    again.dispatchEvent(new window.MouseEvent("pointerup", at(150, 160)));
    await saveAndWait(page);

    const spots = [...(await onDisk("pull.mmd")).matchAll(/%% @ (\S+) (-?\d+),(-?\d+)/g)]
      .map(([, id, x, y]) => ({ id, x: Number(x), y: Number(y) }));
    check("tapping the handle puts a box below the one it came from",
      [canvas.querySelectorAll(".dd-node").length,
        spots.some((one) => one.y === 250)], [3, true]);

    /* And moved along when that place is taken, because the alternative is a
     * box dropped exactly on top of one that is already there — which reads
     * as the tap having done nothing.
     */
    await wrote("taken.mmd", [
      "flowchart TD",
      "    %% layout v1",
      "    %% @ A 100,100 100x60",
      "    %% @ Z 0,250 600x60",
      "    A[One]",
      "    Z[In the way]"
    ]);

    const blocked = await openPage({ url: `${origin}/diagram/file/taken.mmd`, cookie, origin });
    const blockedCanvas = blocked.document.querySelector(".ve-diagram-canvas");
    const box = blockedCanvas.querySelector('.dd-node[data-id="A"]');
    const press = (type, x, y) => box.dispatchEvent(
      new blocked.window.MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));

    press("pointerdown", 110, 110);
    press("pointerup", 110, 110);
    const handleOf = blockedCanvas.querySelector(".dd-connect");
    handleOf.dispatchEvent(new blocked.window.MouseEvent("pointerdown",
      { clientX: 150, clientY: 160, bubbles: true }));
    handleOf.dispatchEvent(new blocked.window.MouseEvent("pointerup",
      { clientX: 150, clientY: 160, bubbles: true }));
    await saveAndWait(blocked);

    const placed = [...(await onDisk("taken.mmd")).matchAll(/%% @ (\S+) (-?\d+),(-?\d+)/g)]
      .map(([, id, x, y]) => ({ id, x: Number(x), y: Number(y) }))
      .find((one) => one.id !== "A" && one.id !== "Z");
    check("...and moved along when that place is already taken",
      [placed.y, placed.x >= 600], [250, true]);
  }

  console.log("=== a group, taken hold of by its name ===");
  {
    /* The menu for a group's name is the menu for what is in it, which is
     * where grouping and ungrouping already live — so right-clicking the name
     * picks up the boxes and offers what can be done to them.
     */
    await wrote("named.mmd", [
      "flowchart TD",
      "    %% layout v1",
      "    %% @ A 100,100 100x60",
      "    %% @ B 100,300 100x60",
      "    %% group outer name=\"Outer\"",
      "    subgraph outer [\"Outer\"]",
      "    A[One]",
      "    B[Two]",
      "    end"
    ]);

    const page = await openPage({ url: `${origin}/diagram/file/named.mmd`, cookie, origin });
    const { window, document } = page;
    const canvas = document.querySelector(".ve-diagram-canvas");

    const name = canvas.querySelector(".dd-group-name");
    check("a group is drawn with its name on it", Boolean(name), true);

    /* The name's own band, in the diagram's coordinates and then in the
     * page's: the frame is drawn round the boxes and the name sits in a strip
     * along the top of it.
     */
    const frame = canvas.querySelector(".dd-group rect, .dd-group-frame");
    const view = () => {
      const found = /translate\((-?[\d.]+),(-?[\d.]+)\) scale\(([\d.]+)\)/
        .exec(canvas.querySelector(".dd-view").getAttribute("transform"));
      return { x: Number(found[1]), y: Number(found[2]), scale: Number(found[3]) };
    };
    const onName = {
      x: Number(frame.getAttribute("x")) + 10,
      y: Number(frame.getAttribute("y")) + 10
    };

    canvas.dispatchEvent(new window.MouseEvent("contextmenu", {
      clientX: (onName.x * view().scale) + view().x,
      clientY: (onName.y * view().scale) + view().y,
      bubbles: true,
      cancelable: true
    }));

    const labels = [...canvas.querySelectorAll(".ve-diagram-menu .context-item")]
      .map((one) => one.querySelector("span").textContent.trim());
    check("...and right-clicking it takes hold of what is in it",
      canvas.querySelectorAll(".dd-ring").length, 2);
    check("...offering what can be done to those boxes",
      labels.includes("Ungroup 2 boxes"), true);
  }

  console.log("=== a colour nobody chose from the row ===");
  {
    await wrote("tinted.mmd", [
      "flowchart TD",
      "    %% layout v1",
      "    %% @ A 100,100 100x60",
      "    A[One]"
    ]);

    const page = await openPage({ url: `${origin}/diagram/file/tinted.mmd`, cookie, origin });
    const { window, document } = page;
    const canvas = document.querySelector(".ve-diagram-canvas");

    canvas.querySelector('.dd-node[data-id="A"]').dispatchEvent(
      new window.MouseEvent("pointerdown", { clientX: 110, clientY: 110, bubbles: true }));
    canvas.querySelector('.dd-node[data-id="A"]').dispatchEvent(
      new window.MouseEvent("pointerup", { clientX: 110, clientY: 110, bubbles: true }));

    const custom = document.querySelector(".ve-diagram-swatch-custom");
    check("the panel offers a colour of your own beside the row", Boolean(custom), true);

    /* The outline and the words are worked out from it rather than asked for:
     * a fill with no outline is a box with no edge, and a reader who picks a
     * pale yellow and gets pale yellow writing on it has picked nothing.
     */
    custom.value = "#8899ff";
    custom.dispatchEvent(new window.Event("change", { bubbles: true }));
    await saveAndWait(page);
    const tinted = await onDisk("tinted.mmd");

    check("choosing one fills the box with it", /fill:#8899ff/.test(tinted), true);
    check("...outlines it in a darker shade of the same",
      /stroke:#4b548c/i.test(tinted), true);
    check("...and writes on it in a darker one still",
      /color:#1b1f33/i.test(tinted), true);
  }

  console.log("=== a picture of the diagram, drawn rather than written ===");
  {
    /* The SVG is checked beside this, in furniture.js. The PNG is the same
     * picture put through a canvas, which is the one thing on this page that
     * needs a rasteriser — so here is one, answering the same way every time.
     */
    await wrote("picture.mmd", [
      "flowchart TD",
      "    %% layout v1",
      "    %% @ A 100,100 100x60",
      "    A[One]"
    ]);

    const page = await openPage({ url: `${origin}/diagram/file/picture.mmd`, cookie, origin });
    const { window, document } = page;

    const drawn = [];
    window.HTMLCanvasElement.prototype.getContext = /** @type {any} */ (() => ({
      scale: (...parts) => drawn.push(["scale", ...parts]),
      drawImage: (...parts) => drawn.push(["drawImage", parts.length])
    }));

    let encodes = true;
    window.HTMLCanvasElement.prototype.toBlob = /** @type {any} */ (function toBlob(done) {
      const sized = `PNG ${this.width}x${this.height}`;
      Promise.resolve().then(() => done(encodes
        ? new window.Blob([sized], { type: "image/png" })
        : null));
    });

    // jsdom loads nothing, so whether the drawing can be rasterised is this
    // test's to decide.
    let loads = true;
    const sources = [];

    let handed = null;
    let named = null;
    window.URL.createObjectURL = (blob) => {
      handed = blob;
      return "blob:picture";
    };
    window.URL.revokeObjectURL = () => {};
    const made = window.document.createElement.bind(window.document);
    window.document.createElement = (tag) => {
      const one = made(tag);

      if (tag === "a") {
        one.click = () => {
          named = one.download;
        };
      }

      /* The drawing is handed to the rasteriser as an <img> and waited on.
       * jsdom fetches nothing, not even a data URI, so the load this is
       * waiting for is this test's to fire.
       */
      if (tag === "img") {
        Object.defineProperty(one, "src", {
          configurable: true,
          set(value) {
            sources.push(String(value));
            Promise.resolve().then(() => one.dispatchEvent(
              new window.Event(loads ? "load" : "error")));
          },
          get() {
            return sources[sources.length - 1] || "";
          }
        });
      }

      return one;
    };

    const button = (label) => [...document.querySelectorAll(".ve-diagram-export")]
      .find((one) => one.textContent === label);

    button("PNG").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await ctx.waitFor(window, () => handed !== null, "the picture was never handed over");

    check("saving hands over a PNG", handed.type, "image/png");
    check("...named after the diagram", named, "picture.png");
    // The same SVG the other button saves, handed to the rasteriser as a data
    // URI rather than a blob: a canvas will not read back a drawing it was
    // given from a blob URL.
    check("...drawn from the same picture the SVG button saves",
      sources[0].startsWith("data:image/svg+xml;charset=utf-8,"), true);
    /* At more than one pixel per pixel, because a PNG of a diagram is pasted
     * into things and looked at closely, and a diagram drawn at its own size
     * is soft everywhere it is not.
     */
    check("...on paper larger than the diagram", drawn[0][1] > 1, true);
    check("...with the drawing scaled onto it", drawn[1], ["drawImage", 5]);

    // A drawing the canvas will not take, and one it will not give back:
    // neither is a page that stops working.
    handed = null;
    loads = false;
    button("PNG").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await settle();
    check("a drawing that will not rasterise hands over nothing", handed, null);

    loads = true;
    encodes = false;
    button("PNG").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await settle();
    check("...and neither does a canvas that will not encode one", handed, null);
  }

  console.log("=== a picture put into the diagram ===");
  {
    await wrote("photos.mmd", [
      "flowchart TD",
      "    %% layout v1",
      "    %% @ A 100,100 100x60",
      "    A[One]"
    ]);

    const page = await openPage({ url: `${origin}/diagram/file/photos.mmd`, cookie, origin });
    const { window, document } = page;
    const canvas = document.querySelector(".ve-diagram-canvas");

    /* The file dialogue is the browser's, so what is stood in for is the file
     * coming back from it — and then it is the page's own upload, against the
     * real server, from there on.
     */
    /* A real PNG — an eight-byte signature and an IHDR — because the store
     * sniffs what it is given rather than trusting the type on it.
     */
    const PNG = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from([0, 0, 0, 13]),
      Buffer.from("IHDR"),
      Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
      Buffer.from([0x1f, 0x15, 0xc4, 0x89])
    ]);

    const chosen = (picker, name) => {
      const file = new window.File([PNG], name, { type: "image/png" });
      Object.defineProperty(picker, "files", { configurable: true, value: [file] });
      picker.dispatchEvent(new window.Event("change", { bubbles: true }));
    };

    const picker = () => document.querySelector(".ve-diagram-picker");
    const press = (one) => one.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    /* Dragged off the palette onto the paper, which is the way a picture is
     * added: the choice says what, and where it was let go says where.
     */
    const tool = [...document.querySelectorAll(".ve-diagram-tool")]
      .find((one) => one.querySelector("span").textContent === "Picture");
    check("the palette offers a picture", Boolean(tool), true);

    /* Tapped rather than clicked: the palette arms itself on the way up, so
     * that the same press can turn out to have been a drag instead.
     */
    const tap = (one, x, y) => {
      one.dispatchEvent(new window.MouseEvent("pointerdown",
        { clientX: x, clientY: y, bubbles: true }));
      one.dispatchEvent(new window.MouseEvent("pointerup",
        { clientX: x, clientY: y, bubbles: true }));
    };

    tap(tool, 20, 400);
    tap(canvas, 400, 300);

    check("...and choosing it asks for a file", Boolean(picker()), true);
    chosen(picker(), "a cat.png");
    await ctx.waitFor(window, () => canvas.querySelectorAll(".dd-node").length === 2,
      `the picture never arrived on the paper: the page says "${
        document.querySelector(".ve-diagram-hint")?.textContent}"`);

    await saveAndWait(page);
    const written = await onDisk("photos.mmd");
    // Named after the file rather than after nothing, with the extension off:
    // a box labelled "a cat.png" is a box labelled with a filename.
    check("a picture arrives as a box named after the file",
      /\ba cat\b/.test(written), true);
    check("...carrying the address it was uploaded to",
      /img=\/?[^\s]*assets/.test(written) || /image=/.test(written), true);

    /* And onto a box that is already there, from the panel beside it, which is
     * how a box gets a picture without becoming a second box.
     */
    const boxes = canvas.querySelectorAll(".dd-node").length;
    canvas.querySelector('.dd-node[data-id="A"]')
      .dispatchEvent(new window.MouseEvent("pointerdown", { clientX: 110, clientY: 110, bubbles: true }));
    canvas.querySelector('.dd-node[data-id="A"]')
      .dispatchEvent(new window.MouseEvent("pointerup", { clientX: 110, clientY: 110, bubbles: true }));

    const add = [...document.querySelectorAll(".ve-diagram-inspector button")]
      .find((one) => /picture/i.test(one.textContent));
    check("the panel offers a picture for the box in hand", Boolean(add), true);

    press(add);
    chosen(picker(), "logo.png");
    await ctx.waitFor(window,
      () => canvas.querySelector('.dd-node[data-id="A"] image'),
      "the box never got its picture");
    check("...which goes into the box rather than making another",
      canvas.querySelectorAll(".dd-node").length, boxes);
  }

  console.log("=== a drag the browser takes away ===");
  {
    /* A pointercancel is the browser saying the gesture is over and not
     * telling you where: a phone call arriving, a system gesture starting. The
     * half-drawn arrow has to go with it rather than being left on the paper.
     */
    await wrote("cancel.mmd", [
      "flowchart TD",
      "    %% layout v1",
      "    %% @ A 100,100 100x60",
      "    %% @ B 400,100 100x60",
      "    A[One]",
      "    B[Two]"
    ]);

    const page = await openPage({
      url: `${origin}/diagram/file/cancel.mmd`, cookie, origin,
      // The editor fits the view to the diagram when it is built, and asks
      // again whenever the box it is in changes size. jsdom has no observer to
      // ask with, so here is one.
      before: (window) => {
        window.ResizeObserver = /** @type {any} */ (class {
          constructor(run) {
            /** @type {any} */ (window).resized = run;
          }

          observe() {}

          disconnect() {}
        });
      }
    });
    const { window, document } = page;
    const canvas = document.querySelector(".ve-diagram-canvas");

    check("the editor watches the box it is drawn in",
      typeof /** @type {any} */ (window).resized, "function");
    check("...and asking it again is not an error",
      (/** @type {any} */ (window).resized(), true), true);

    const at = (x, y) => ({ clientX: x, clientY: y, bubbles: true });
    canvas.querySelector('.dd-node[data-id="A"]')
      .dispatchEvent(new window.MouseEvent("pointerdown", at(110, 110)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(300, 300)));
    await settle();

    canvas.dispatchEvent(new window.MouseEvent("pointercancel", at(300, 300)));
    check("a drag the browser takes away leaves nothing half-drawn",
      canvas.querySelectorAll(".dd-draft").length, 0);
    check("...and the boxes are where they were",
      canvas.querySelectorAll(".dd-node").length, 2);
  }

  console.log("=== and a shape dragged off the palette ===");
  {
    await wrote("palette.mmd", [
      "flowchart TD",
      "    %% layout v1",
      "    %% @ A 100,100 100x60",
      "    A[One]"
    ]);

    const page = await openPage({ url: `${origin}/diagram/file/palette.mmd`, cookie, origin });
    const { window, document } = page;
    const canvas = document.querySelector(".ve-diagram-canvas");

    const tool = [...document.querySelectorAll(".ve-diagram-tool")]
      .find((one) => one.querySelector("span").textContent === "Box");

    /* Dragged rather than tapped, which is the other way the palette works —
     * and the one that needs the pointer captured, because the drag leaves the
     * button almost immediately.
     */
    let captured = 0;
    Object.assign(tool, {
      setPointerCapture: () => {
        captured += 1;
      },
      hasPointerCapture: () => captured > 0,
      releasePointerCapture: () => {
        captured = 0;
      }
    });

    const at = (x, y) => ({ clientX: x, clientY: y, bubbles: true, pointerId: 1 });
    tool.dispatchEvent(new window.MouseEvent("pointerdown", at(20, 400)));
    tool.dispatchEvent(new window.MouseEvent("pointermove", at(300, 300)));

    const ghost = document.querySelector(".ve-diagram-ghost");
    check("dragging a shape off the palette shows what is being carried",
      Boolean(ghost), true);
    check("...labelled as the shape it is", ghost.textContent, "Box");
    check("...and following the pointer", ghost.style.left, "300px");

    const was = canvas.querySelectorAll(".dd-node").length;
    tool.dispatchEvent(new window.MouseEvent("pointerup", at(300, 300)));
    check("letting go on the paper puts it there",
      canvas.querySelectorAll(".dd-node").length, was + 1);
    check("...and what was being carried is not left on the page",
      Boolean(document.querySelector(".ve-diagram-ghost")), false);

    /* A drag the browser takes away mid-flight, which on the palette means the
     * ghost is left following a pointer that is no longer there.
     */
    tool.dispatchEvent(new window.MouseEvent("pointerdown", at(20, 400)));
    tool.dispatchEvent(new window.MouseEvent("pointermove", at(300, 300)));
    tool.dispatchEvent(new window.MouseEvent("pointercancel", at(300, 300)));
    check("a palette drag the browser takes away takes the ghost with it",
      Boolean(document.querySelector(".ve-diagram-ghost")), false);

    // Let go outside the paper, which is how a drag is thought better of.
    tool.dispatchEvent(new window.MouseEvent("pointerdown", at(20, 400)));
    tool.dispatchEvent(new window.MouseEvent("pointermove", at(20, 900)));
    const before = canvas.querySelectorAll(".dd-node").length;
    tool.dispatchEvent(new window.MouseEvent("pointerup", at(20, 2000)));
    check("...and letting go off the paper puts nothing anywhere",
      canvas.querySelectorAll(".dd-node").length, before);

    // The right button is a menu, not a drag.
    const other = [...document.querySelectorAll(".ve-diagram-tool")]
      .find((one) => one.querySelector("span").textContent === "Box");
    other.dispatchEvent(new window.MouseEvent("pointerdown",
      { clientX: 20, clientY: 400, bubbles: true, button: 2 }));
    other.dispatchEvent(new window.MouseEvent("pointermove", at(300, 300)));
    check("a press that is not the first button is not a drag",
      Boolean(document.querySelector(".ve-diagram-ghost")), false);
  }

  console.log("=== a diagram with one box in it, and nothing to join ===");
  {
    await wrote("alone.mmd", [
      "flowchart TD",
      "    %% layout v1",
      "    %% @ A 100,100 100x60",
      "    A[Only]"
    ]);

    const page = await openPage({ url: `${origin}/diagram/file/alone.mmd`, cookie, origin });
    const { window, document } = page;
    const press = (selector) => document.querySelector(selector)
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    // An arrow needs two ends. Offering the button and having it do nothing is
    // better than hiding it and leaving somebody looking for it.
    press(".ve-diagram-add");
    press(".ve-diagram-tidy");
    await saveAndWait(page);
    const written = await onDisk("alone.mmd");
    check("the add button has nothing to join in a diagram of one box",
      /-->/.test(written), false);
    // And tidying one box still puts it where a tidy diagram starts, rather
    // than where somebody happened to drag it.
    check("...and tidying it puts it where a diagram starts",
      /%% @ A \d+,\d+/.test(written), true);
  }
};
