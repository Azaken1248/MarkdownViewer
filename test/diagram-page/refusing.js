// Part of the diagram-page suite. See diagram-page.test.js, which sets all this
// up and calls it.
//
// What the editor will not do, and what it says instead.
//
// The nine files beside this one drive the editor doing things. These are the
// places it declines: a diagram already as big as the grammar can read back, a
// clipboard with nothing on it, and a picture the store will not take. Each is
// a line nothing reached, and each is one a person meets by trying something
// perfectly reasonable.
//
// No new machinery: the taps, drags and drops are the ones the files beside
// this one already use.
module.exports = async (ctx) => {
  const { check, server, cookie, origin, openPage, csrfFor, settle, waitFor, saveAndWait } = ctx;

  const wrote = async (name, lines) => server.request("POST", "/api/docs",
    { fileName: name, overwrite: true, content: `${lines.join("\n")}\n` },
    { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

  // The hint line under the panel, which is the only place this page can say
  // anything: there is no toast on the diagram page.
  const saidIn = (document) => {
    const hint = document.querySelector(".ve-diagram-hint");
    return hint && !hint.hidden ? hint.textContent : "";
  };

  // The palette arms itself on the way up, so that the same press can turn out
  // to have been a drag instead. Hence a tap rather than a click.
  const tapper = (window) => (one, x = 20, y = 400) => {
    one.dispatchEvent(new window.MouseEvent("pointerdown", { clientX: x, clientY: y, bubbles: true }));
    one.dispatchEvent(new window.MouseEvent("pointerup", { clientX: x, clientY: y, bubbles: true }));
  };

  console.log("=== as many steps as a diagram can hold ===");
  {
    /* The cap belongs to the grammar rather than to the editor: sixty boxes is
     * what the parser will read back, so a diagram grown past it would be one
     * the editor could no longer open. It says so instead, which is the only
     * answer that leaves the file openable.
     */
    const many = 60;
    const lines = ["flowchart TD", "    %% layout v1"];
    for (let i = 0; i < many; i += 1) {
      lines.push(`    %% @ N${i} ${100 + ((i % 10) * 160)},${100 + (Math.floor(i / 10) * 140)} 100x60`);
    }
    for (let i = 0; i < many; i += 1) {
      lines.push(`    N${i}[Step ${i}]`);
    }

    await wrote("full.mmd", lines);

    const page = await openPage({ url: `${origin}/diagram/file/full.mmd`, cookie, origin });
    const { window, document } = page;
    const canvas = document.querySelector(".ve-diagram-canvas");
    const boxes = () => canvas.querySelectorAll(".dd-node").length;
    const tap = tapper(window);

    check("a diagram of sixty boxes opens with all of them", boxes(), many);

    /* The palette is where somebody meets this: the paper looks like it has
     * room, and the cap is not about room. The rail says what, and the paper
     * says where.
     */
    const shape = [...document.querySelectorAll(".ve-diagram-tool")]
      .find((one) => one.dataset.kind !== "table" && one.querySelector("span"));
    check("(the palette offers a shape to put down)", Boolean(shape), true);

    tap(shape);
    tap(canvas, 900, 700);
    /* Waited for rather than slept through: a fixed pause long enough for a
     * loaded two-core runner is a pause everywhere else, and one short enough
     * to be quick is a check that passes because nothing has happened yet.
     * Either answer ends the wait, and the checks below say which it was.
     */
    await waitFor(window, () => saidIn(document) !== "" || boxes() !== many,
      "the editor neither put a box down nor said why not");

    check("asking for one more says the diagram is as big as it goes",
      saidIn(document), "That is as many steps as this can hold.");
    check("...and no box was put down", boxes(), many);
    // A box put down is a box about to be named. One that was refused is not.
    check("...and nothing is left half-made on the paper",
      canvas.querySelector(".ve-diagram-inline"), null);

    page.window.close();
  }

  console.log("=== as many arrows as a diagram can hold ===");
  {
    // The same for arrows, which have a cap of their own and are reached a
    // different way: two boxes already on the paper, joined once more.
    const many = 120;
    const lines = ["flowchart TD", "    %% layout v1",
      "    %% @ A 100,100 80x40", "    %% @ B 400,100 80x40",
      "    A[One]", "    B[Two]"];
    for (let i = 0; i < many; i += 1) {
      lines.push("    A --> B");
    }

    await wrote("tangle.mmd", lines);

    const page = await openPage({ url: `${origin}/diagram/file/tangle.mmd`, cookie, origin });
    const { window, document } = page;
    const canvas = document.querySelector(".ve-diagram-canvas");
    const arrows = () => canvas.querySelectorAll(".dd-edge").length;

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
    const middleOf = (id) => {
      const spot = /translate\((-?[\d.]+),(-?[\d.]+)\)/
        .exec(canvas.querySelector(`.dd-node[data-id="${id}"]`).getAttribute("transform"));
      return [Number(spot[1]) + 40, Number(spot[2]) + 20];
    };

    check("a diagram of a hundred and twenty arrows opens with all of them", arrows(), many);

    const tool = [...document.querySelectorAll(".ve-diagram-bar .ve-diagram-icon[aria-pressed]")]
      .find((one) => /Arrow/i.test(one.getAttribute("title") || ""));
    check("(the bar offers the arrow tool)", Boolean(tool), true);

    tool.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    const [x1, y1] = middleOf("A");
    const [x2, y2] = middleOf("B");
    canvas.querySelector('.dd-node[data-id="A"]')
      .dispatchEvent(new window.MouseEvent("pointerdown", at(x1, y1)));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", at(x2, y2)));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", at(x2, y2)));
    await waitFor(window, () => saidIn(document) !== "" || arrows() !== many,
      "the editor neither drew an arrow nor said why not");

    check("asking for one more arrow says the diagram is as tangled as it goes",
      saidIn(document), "That is as many arrows as this can hold.");
    check("...and no arrow was drawn", arrows(), many);

    page.window.close();
  }

  console.log("=== a clipboard with nothing on it ===");
  {
    await wrote("clip.mmd", [
      "flowchart TD",
      "    %% layout v1",
      "    %% @ A 100,100 100x60",
      "    A[One]"
    ]);

    const page = await openPage({ url: `${origin}/diagram/file/clip.mmd`, cookie, origin });
    const { window, document } = page;
    const canvas = document.querySelector(".ve-diagram-canvas");
    const boxes = () => canvas.querySelectorAll(".dd-node").length;
    const held = () => canvas.querySelectorAll(".dd-ring").length;

    const press = (key) => canvas.dispatchEvent(new window.KeyboardEvent("keydown",
      { key, bubbles: true, ctrlKey: true }));

    /* Keys people press out of habit, at a moment when they have not selected
     * anything. All three have to be nothing-happens rather than
     * something-breaks — and a copy that took nothing has to leave the
     * clipboard empty rather than putting an empty handful on it, or the next
     * paste is an undo step for a change nobody made.
     */
    check("a page just opened holds nothing", held(), 0);

    press("c");
    press("x");
    press("v");
    await settle();

    check("copy, cut and paste with nothing held change nothing", boxes(), 1);
    check("...and the diagram is still the one that was opened",
      [...canvas.querySelectorAll(".dd-node")].map((one) => one.dataset.id), ["A"]);

    press("v");
    await settle();
    check("...and a paste after a copy of nothing puts nothing down", boxes(), 1);

    /* And a paste that puts nothing down is not an edit.
     *
     * Every edit tells the page, which clears the line the page was using to
     * talk — "Saved" among other things — and starts the clock on an
     * autosave. A stray Ctrl+V has no business doing either: the word on
     * screen is what somebody is reading, and the save it would schedule is a
     * write of a document nobody changed.
     */
    const status = () => document.querySelector(".diagram-page-status").textContent;

    // An edit, so there is something to save and something for the page to
    // say about it. Nudging a box is the smallest one there is.
    const box = canvas.querySelector('.dd-node[data-id="A"]');
    const spot = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(box.getAttribute("transform"));
    const x = Number(spot[1]) + 20;
    const y = Number(spot[2]) + 20;
    const placed = () => canvas.querySelector('.dd-node[data-id="A"]').getAttribute("transform");
    const was = placed();
    box.dispatchEvent(new window.MouseEvent("pointerdown", { clientX: x, clientY: y, bubbles: true }));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", { clientX: x + 40, clientY: y, bubbles: true }));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", { clientX: x + 40, clientY: y, bubbles: true }));
    // The save below needs the edit to have landed, or Save has nothing to do
    // and the wait for "Saved" is a wait for something nobody started.
    await waitFor(window, () => placed() !== was, "the box never moved");

    await saveAndWait(page);
    await waitFor(window, () => status().startsWith("Saved"),
      `the page never said what became of the save: it says "${status()}"`);
    const after = status();

    // Nothing held, so the paste below has an empty clipboard to work from.
    canvas.dispatchEvent(new window.MouseEvent("pointerdown", { clientX: 5, clientY: 5, bubbles: true }));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", { clientX: 5, clientY: 5, bubbles: true }));
    await waitFor(window, () => held() === 0, "pressing the paper never let go of the box");
    check("(nothing is held again)", held(), 0);

    press("v");
    await settle();
    check("...and a stray paste does not wipe what the page was saying", status(), after);

    page.window.close();
  }

  console.log("=== a picture the store will not take ===");
  {
    await wrote("refused.mmd", [
      "flowchart TD",
      "    %% layout v1",
      "    %% @ A 100,100 100x60",
      "    A[One]"
    ]);

    const page = await openPage({ url: `${origin}/diagram/file/refused.mmd`, cookie, origin });
    const { window, document } = page;
    const canvas = document.querySelector(".ve-diagram-canvas");
    const boxes = () => canvas.querySelectorAll(".dd-node").length;
    const tap = tapper(window);

    /* A file that says it is a picture and is not. The paper takes it — it has
     * no way to know better — and the store sniffs the bytes and refuses it,
     * which is the one failure the drop gesture has to survive.
     */
    const file = new window.File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])],
      "pretend.png", { type: "image/png" });
    const drop = new window.Event("drop", { bubbles: true, cancelable: true });
    drop.dataTransfer = { files: [file], dropEffect: "" };
    drop.clientX = 300;
    drop.clientY = 300;
    canvas.dispatchEvent(drop);

    await waitFor(window, () => saidIn(document) === "That picture could not be added.",
      `the editor never said the picture was refused: it says "${saidIn(document)}"`);

    check("a picture the store refuses is said to have been refused",
      saidIn(document), "That picture could not be added.");
    check("...and no box was left behind for it", boxes(), 1);
    check("...and the paper is not still saying it will take one",
      canvas.classList.contains("is-dropping"), false);

    /* The other way in is the file dialogue, and the commonest thing anybody
     * does with one is close it again. Choosing the picture tool opens it;
     * choosing nothing has to be nothing at all.
     */
    const tool = [...document.querySelectorAll(".ve-diagram-tool")]
      .find((one) => one.querySelector("span")?.textContent === "Picture");
    check("(the palette offers a picture)", Boolean(tool), true);

    tap(tool);
    tap(canvas, 500, 300);
    await waitFor(window, () => Boolean(document.querySelector(".ve-diagram-picker")),
      "choosing the picture tool never asked for a file");

    const picker = document.querySelector(".ve-diagram-picker");
    check("choosing it asks for a file", Boolean(picker), true);

    const was = boxes();
    picker.dispatchEvent(new window.Event("change", { bubbles: true }));
    await settle();
    check("a file dialogue closed with nothing chosen adds nothing", boxes(), was);
    check("...and says nothing about it", saidIn(document), "");

    page.window.close();
  }

};
