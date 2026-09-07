// Part of the visual-editor suite. See visual.test.js, which loads the modules
// and calls it.
//
// Groups, tables, icons, pictures, the shapes with no brackets, and the type a
// diagram is set in.
//
// Everything it needs is handed to it: the suite's own check(), the three
// modules under test, and the fixtures walker. Split out of one file only
// because that file had grown past a thousand lines.
module.exports = (ctx) => {
  const {
    check, VE, DM, DD, walkDocuments, fs, path, ROOT, JSDOM, styleSource
  } = ctx;

console.log("=== a box inside a box is drawn inside it, not under it ===");
{
  /* Boxes used to be drawn in the order the file lists them, which is fine
   * until one is inside another: the outer one is opaque, so whichever of the
   * two the file happens to mention second wins, and half the time the box you
   * put inside vanishes the moment the drawing is made again. So does the arrow
   * pointing at it, which has to cross the outer box to get there.
   *
   * Drawn from the outside in instead: a box that holds another is background
   * to it, and so is any arrow that stops outside it.
   */
  const nested = {
    direction: "TD",
    nodes: [{ id: "Inner", shape: "rect", text: "in" },
      { id: "Outer", shape: "rect", text: "out" },
      { id: "C", shape: "rect", text: "C" }],
    edges: [{ from: "C", to: "Inner", kind: "arrow", label: "" },
      { from: "C", to: "Outer", kind: "arrow", label: "" }],
    layout: { Outer: { x: 100, y: 100, w: 300, h: 200 },
      Inner: { x: 180, y: 180, w: 100, h: 50 },
      C: { x: 500, y: 180, w: 80, h: 40 } }
  };

  const depths = DD.nestingDepths(nested.nodes, nested.layout);
  check("a box inside a bigger one is a layer deeper", depths.get("Inner"), 1);
  check("...and the one holding it is not", depths.get("Outer"), 0);
  check("...nor is one standing on its own", depths.get("C"), 0);

  // Same size and place: neither is inside the other, or two boxes drawn on
  // top of each other would each count as being in the other. It is the same
  // rule that stops a box counting itself.
  const twins = DD.nestingDepths(
    [{ id: "A" }, { id: "B" }],
    { A: { x: 0, y: 0, w: 80, h: 40 }, B: { x: 0, y: 0, w: 80, h: 40 } });
  check("two boxes the same size and place are neither inside the other",
    [twins.get("A"), twins.get("B")], [0, 0]);

  /* And it goes as deep as it is drawn. A box in a box in a box is three
   * layers, or the two inner ones share one and whichever the file mentions
   * second paints over the other.
   */
  const russian = DD.nestingDepths(
    [{ id: "Big" }, { id: "Middle" }, { id: "Small" }],
    { Big: { x: 0, y: 0, w: 400, h: 400 }, Middle: { x: 50, y: 50, w: 200, h: 200 },
      Small: { x: 80, y: 80, w: 60, h: 60 } });
  check("a box in a box in a box is three layers deep",
    [russian.get("Big"), russian.get("Middle"), russian.get("Small")], [0, 1, 2]);

  // Overlapping is not containing. Half in and half out is still beside.
  const overlapping = DD.nestingDepths(
    [{ id: "A" }, { id: "B" }],
    { A: { x: 0, y: 0, w: 200, h: 100 }, B: { x: 150, y: 50, w: 100, h: 100 } });
  check("a box hanging over the edge of another is not inside it",
    [overlapping.get("A"), overlapping.get("B")], [0, 0]);

  const painted = new JSDOM(`<!doctype html><body>${DD.render(nested,
    { layout: nested.layout, natural: true })}</body>`).window.document;
  const order = [...painted.querySelectorAll(".dd-node, .dd-edge")]
    .map((one) => one.dataset.id || `edge ${one.dataset.edge}`);

  check("the outer box and what stops at it come first, then what is inside",
    order, ["edge 1", "Outer", "C", "edge 0", "Inner"]);

  /* An arrow keeps the number it has in the file whatever order it is drawn in,
   * because that number is how everything else refers to it.
   */
  check("...and an arrow drawn out of turn keeps its own number",
    [...painted.querySelectorAll(".dd-edge")].map((one) => one.dataset.from),
    ["C", "C"]);

  const deep = new JSDOM(`<!doctype html><body>${DD.render({
    direction: "TD",
    nodes: [{ id: "Small", shape: "rect", text: "s" }, { id: "Big", shape: "rect", text: "b" },
      { id: "Middle", shape: "rect", text: "m" }],
    edges: [],
    layout: { Big: { x: 0, y: 0, w: 400, h: 400 }, Middle: { x: 50, y: 50, w: 200, h: 200 },
      Small: { x: 80, y: 80, w: 60, h: 60 } }
  }, { natural: true })}</body>`).window.document;
  check("...and it is drawn that way round however the file lists them",
    [...deep.querySelectorAll(".dd-node")].map((one) => one.dataset.id),
    ["Big", "Middle", "Small"]);

  // A diagram with nothing inside anything is the one layer of arrows and one
  // of boxes it always was.
  const flat = new JSDOM(`<!doctype html><body>${DD.render({
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", text: "A" }, { id: "B", shape: "rect", text: "B" }],
    edges: [{ from: "A", to: "B", kind: "arrow", label: "" }],
    layout: { A: { x: 0, y: 0, w: 80, h: 40 }, B: { x: 0, y: 200, w: 80, h: 40 } }
  }, { natural: true })}</body>`).window.document;
  check("a diagram with nothing nested is drawn in one layer as before",
    [flat.querySelectorAll(".dd-edges").length, flat.querySelectorAll(".dd-nodes").length],
    [1, 1]);

  // And an empty one still has the places those things go, or the editor has
  // nothing to put the first box into.
  const empty = new JSDOM(`<!doctype html><body>${DD.render({
    direction: "TD", nodes: [], edges: [], layout: {}
  }, { natural: true })}</body>`).window.document;
  check("...and an empty diagram still has both places to draw into",
    [empty.querySelectorAll(".dd-edges").length, empty.querySelectorAll(".dd-nodes").length],
    [1, 1]);
}

console.log("=== ...for every diagram in the real library ===");
{
  // The same argument as the block splitter's library pass: fixtures cover what
  // someone thought of. What is actually on this machine covers the rest — and
  // a diagram the builder opens and then writes back differently is a diagram
  // it has damaged, which is the only failure here that matters.
  const files = walkDocuments(path.join(ROOT, "docs"));
  const drifted = [];
  let diagrams = 0;
  let buildable = 0;

  for (const file of files) {
    for (const block of VE.splitBlocks(fs.readFileSync(file, "utf8"))) {
      if (block.type !== "fence") {
        continue;
      }

      const fence = VE.parseFence(block.source);
      if (!/^mermaid\b/i.test(fence.info)) {
        continue;
      }

      diagrams += 1;
      const model = DM.parseFlowchart(fence.body);
      if (!model.ok) {
        continue;
      }

      buildable += 1;
      if (JSON.stringify(DM.parseFlowchart(DM.serializeFlowchart(model))) !== JSON.stringify(model)) {
        drifted.push(path.relative(ROOT, file));
      }
    }
  }

  console.log(`  (${diagrams} diagrams, ${buildable} of them the builder will open)`);
  check("no diagram the builder opens comes back different", drifted.slice(0, 5), []);
}

console.log("=== a table is rows of cells, and the file says so in the label ===");
{
  /* Where a table's columns live.
   *
   * In the label, beside the rows that were already there, rather than in a
   * comment of their own. A renderer that knows nothing about this app shows
   * "Name | Type" on a line, which is what that row says — and the number of
   * columns is something the text answers rather than something a second line
   * has to keep agreeing with it about.
   */
  check("a row splits into its cells",
    DM.textCells("Person<br/>name | string<br/>age | int"),
    [["Person"], ["name", "string"], ["age", "int"]]);
  check("...however much space is left around the pipe",
    DM.textCells("a|b<br/>c   |   d"), [["a", "b"], ["c", "d"]]);
  check("...and a table of one column is still a grid of one column",
    DM.textCells("Just<br/>a<br/>list"), [["Just"], ["a"], ["list"]]);

  check("and joins back the way it came",
    DM.joinCells([["Person"], ["name", "string"]]),
    "Person<br/>name | string");
  check("...so the label survives being read and written",
    DM.joinCells(DM.textCells("Person<br/>name | string<br/>age | int")),
    "Person<br/>name | string<br/>age | int");

  // As many columns as the widest row has. A row with fewer than that has
  // empty cells on the end, which is a thing a table is allowed to be.
  check("a table has as many columns as its widest row",
    DM.columnsOf([["a"], ["b", "c", "d"], ["e", "f"]]), 3);
  // A grid of no rows has no widest row to ask, and a table of no columns is a
  // division by zero in everything that lays one out.
  check("...and never none at all", DM.columnsOf([]), 1);

  /* Rows and cells are added empty and taken off the end, so growing and
   * shrinking are each other's undo for as long as nothing was typed into
   * what was dropped.
   */
  check("growing a grid fills the new cells with nothing",
    DM.resizeGrid([["T"]], 3, 2), [["T"], ["", ""], ["", ""]]);
  check("...and shrinking it takes them off the end",
    DM.resizeGrid([["T"], ["a", "b"], ["c", "d"]], 2, 1), [["T"], ["a"]]);
  check("...so one undoes the other while the new cells are still empty",
    DM.resizeGrid(DM.resizeGrid([["T"], ["a", "b"]], 4, 3), 2, 2),
    [["T"], ["a", "b"]]);

  /* The first row is the title and spans the whole table, so it is one cell
   * however many columns there are. Padded to the width of the rest it would be
   * written out as "Person |", which says there is an empty cell beside the
   * title — and there is no beside, that is what spanning means.
   */
  check("the title stays one cell however wide the table gets",
    DM.resizeGrid([["Person"], ["a"]], 2, 4), [["Person"], ["a", "", "", ""]]);
  check("...so it is written as a title rather than as a title and a gap",
    DM.joinCells(DM.resizeGrid([["Person"], ["a"]], 2, 2)),
    "Person<br/>a |");

  // A pipe is one of the characters that cannot be left bare in a Mermaid
  // label, and the row break already forced the quotes.
  const written = DM.serializeFlowchart({
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", kind: "table", text: "Person<br/>name | string" }],
    edges: [],
    layout: { A: { x: 0, y: 0, w: 160, h: 60 } }
  });
  check("a table's cells reach the file as the label they are",
    /A\["Person<br\/>name \| string"\]/.test(written), true);
  check("...and come back as the same grid",
    DM.textCells(DM.parseFlowchart(written).nodes[0].text),
    [["Person"], ["name", "string"]]);
}

console.log("=== a table with columns is drawn as a grid ===");
{
  const table = (text, w, h) => DD.render({
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", kind: "table", text }],
    edges: [],
    layout: { A: { x: 0, y: 0, w, h } }
  }, { natural: true });

  const grid = table("Person<br/>name | string<br/>age | int", 200, 126);
  const rules = [...grid.matchAll(/<line class="dd-rule dd-cell-rule"[^/]*\/>/g)]
    .map((one) => one[0]);

  // Two columns is one line down the middle; two body rows is one line across
  // between them. Both start under the title, which spans the whole width.
  check("a grid is drawn with a line between its columns",
    rules.filter((one) => /x1="100" y1="26" x2="100" y2="126"/.test(one)).length, 1);
  check("...and one between its rows",
    rules.filter((one) => /x1="0" y1="76" x2="200" y2="76"/.test(one)).length, 1);
  check("...and no more than that", rules.length, 2);

  /* The body is shared out evenly rather than stacked from the top, so a table
   * dragged taller is a table with taller rows rather than one with a blank
   * half underneath its text. Which is the whole reason the rules land where
   * the rows are at any size.
   */
  const tall = table("Person<br/>name | string<br/>age | int", 200, 226);
  check("a taller table has taller rows, not a blank half",
    /x1="0" y1="126" x2="200" y2="126"/.test(tall), true);
  check("...and its cells sit in the middle of the rows they are in",
    [...tall.matchAll(/<text class="dd-text dd-row" x="10" y="(\d+)"/g)].map((one) => one[1]),
    ["76", "176"]);

  // A cell is in its own column, so the second one starts where the first ends.
  check("a cell is written inside the column it is in",
    /<text class="dd-text dd-row" x="110" y="51"[^>]*>string<\/text>/.test(grid), true);

  /* Every row and every column a table has is drawn. A table whose structure
   * you have to infer from where the words happen to sit is a box with a list
   * in it, and the lines are the whole difference between the two — so one
   * column still gets the lines between its rows.
   */
  const list = table("Person<br/>name<br/>age", 200, 126);
  const listRules = [...list.matchAll(/<line class="dd-rule dd-cell-rule"[^/]*\/>/g)]
    .map((one) => one[0]);
  check("a table of one column has no line down it", 
    listRules.filter((one) => /y2="126"/.test(one)).length, 0);
  check("...and still has the line between its two rows",
    listRules, ['<line class="dd-rule dd-cell-rule" x1="0" y1="76" x2="200" y2="76"/>']);
  check("...under the rule its title has always had",
    /<line class="dd-rule" x1="0" y1="26" x2="200" y2="26"\/>/.test(list), true);

  // One row under the title has nothing to be divided from, so a table of one
  // row is a heading with a cell under it and no lines drawn through either.
  check("a table of one row is drawn with no lines through it at all",
    /dd-cell-rule/.test(table("Person<br/>only", 200, 66)), false);

  // A cell with nothing in it is not written at all: an empty tspan still
  // takes a line's worth of nothing and is one more thing to escape.
  const gappy = table("T<br/>a | <br/> | d", 200, 126);
  check("an empty cell is not written",
    (gappy.match(/<text class="dd-text/g) || []).length, 3);
}

console.log("=== an icon in a box ===");
{
  const boxed = (node, w = 120, h = 100) => DD.render({
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", ...node }],
    edges: [],
    layout: { A: { x: 0, y: 0, w, h } }
  }, { natural: true });

  /* Built, not written: the sprite is made by tools/make-icon-sprite.js from
   * lucide-static and committed, so the app has no request to make and no font
   * to load — a diagram is drawn into an SVG this builds as a string, and an
   * icon has to be markup it already has.
   */
  const DI = globalThis.DiagramIcons;
  check("the sprite is a set of icons with names", DI.names().length > 100, true);
  check("...grouped the way somebody looking for one would think of it",
    DI.GROUPS[0][0], "Machines");
  check("...with every grouped name actually in it",
    DI.GROUPS.flatMap(([, names]) => names).filter((name) => !DI.bodyOf(name)), []);
  check("...and every icon in it in exactly one group",
    DI.GROUPS.flatMap(([, names]) => names).length, DI.names().length);

  // Lucide's own markup, with the wrapper taken off: no size, no viewBox, no
  // stroke. Those belong to the box it is drawn in, and repeating them 180
  // times would be 180 copies of a decision made once.
  check("an icon is the inside of its file and nothing else",
    /viewBox|stroke-width|<svg/.test(DI.bodyOf("database")), false);

  /* Named by set and by name, because there will be a second set one day and a
   * name on its own would then mean two things.
   */
  const worn = boxed({ text: "Store", icon: "lucide:database" });
  check("a box with an icon draws it", /<g class="dd-icon"/.test(worn), true);
  check("...scaled to what the box has room for, as one transform",
    /<g class="dd-icon" transform="translate\(27,6\) scale\(2\.8\)"/.test(worn), true);
  check("...with the words in the strip under it",
    /<tspan x="60" y="89">Store<\/tspan>/.test(worn), true);

  // The same proportions both ways, so an icon in a wide box is not a stretched
  // icon — the scale is one number, not two.
  const wide = boxed({ text: "", icon: "lucide:database" }, 300, 100);
  check("an icon in a box of any shape keeps its own",
    /<g class="dd-icon" transform="translate\(106,6\) scale\(3\.7\)"/.test(wide), true);

  /* A name this build has never heard of draws nothing at all, and the box
   * falls back to its words — which is what a file written by a later version
   * of this app says, and a box with its label in it is a better answer to
   * that than a gap where a picture should be.
   */
  const refused = ["lucide:not-an-icon", "database", "lucide:../../etc", "LUCIDE:DATABASE",
    "material:database", "<script>", "lucide:database "];
  check("a name this build does not have draws no icon",
    refused.filter((icon) => /dd-icon/.test(boxed({ text: "x", icon }))), []);
  check("...and the box says what it says instead",
    /<tspan[^>]*>x<\/tspan>/.test(boxed({ text: "x", icon: refused[0] })), true);

  // A picture beats an icon: nobody drops a photograph on a box meaning to keep
  // the little drawing under it.
  const both = boxed({ text: "x", icon: "lucide:database",
    image: `/api/assets/${"a".repeat(64)}.png` });
  check("a box with both a picture and an icon shows the picture",
    [/<image/.test(both), /dd-icon/.test(both)], [true, false]);

  // It travels in the layout comment, where everything Mermaid cannot say goes.
  const written = DM.serializeFlowchart({
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", text: "Store", icon: "lucide:database" }],
    edges: [],
    layout: { A: { x: 0, y: 0, w: 120, h: 100 } }
  });
  check("an icon reaches the file beside where its box is",
    /%% @ A 0,0 120x100 icon=lucide:database/.test(written), true);

  const read = DM.parseFlowchart(written).nodes[0];
  check("...and comes back off it", read.icon, "lucide:database");
  check("...as something the model understood", read.extra, undefined);
}

console.log("=== the shapes Mermaid has no brackets for ===");
{
  const one = (shape, text = "Ada", at = { x: 0, y: 0, w: 160, h: 100 }) => ({
    direction: "TD",
    nodes: [{ id: "A", shape, text }],
    edges: [],
    layout: { A: at }
  });
  const drawn = (shape, text, at) => DD.render(one(shape, text, at), { natural: true });

  /* Same bargain as the arrow ends: the file carries the nearest real shape,
   * so the diagram still reads as something sensible wherever else it is
   * opened, and the exact shape is said beside it in the layout comment.
   */
  const brackets = { note: "A[Ada]", cloud: "A((Ada))", actor: "A([Ada])", queue: "A[(Ada)]" };
  for (const [shape, real] of Object.entries(brackets)) {
    const written = DM.serializeFlowchart(one(shape));
    check(`a ${shape} is written as the nearest real shape`,
      written.includes(`    ${real}`), true);
    check(`...with what it actually is said beside it`,
      new RegExp(`@ A [^\n]*shape=${shape}`).test(written), true);
    check(`...and read back as itself`,
      DM.parseFlowchart(written).nodes[0].shape, shape);
  }

  // A shape name this build has never heard of is not a shape. The attribute
  // comes out of a file and is about to pick which markup is drawn.
  const odd = DM.parseFlowchart([
    "flowchart TD",
    "    %% layout v1",
    "    %% @ A 0,0 160x100 shape=trapdoor",
    "    A[Ada]"
  ].join("\n") + "\n");
  check("a shape nothing here draws is not taken from the file",
    odd.nodes[0].shape, "rect");

  // A page with its corner turned down. Drawn as well as cut out: a corner
  // that is merely missing reads as a mistake.
  const note = drawn("note");
  check("a note is a page with its corner turned down",
    /d="M0,0 H144 L160,16 V100 H0 Z"/.test(note), true);
  check("...and the fold is drawn, not only cut out",
    /class="dd-rule"[^>]*d="M144,0 V16 H160"/.test(note), true);

  /* Written on the unit square and multiplied out, so it is the same cloud in
   * a box of any shape rather than one that goes lopsided the wider it gets.
   */
  const cloudPath = (svg) => /class="dd-shape" d="([^"]*)"/.exec(svg)[1];
  const wide = cloudPath(drawn("cloud", "Ada", { x: 0, y: 0, w: 320, h: 100 }));
  const tall = cloudPath(drawn("cloud"));
  const numbers = (d) => d.match(/-?[\d.]+/g).map(Number);
  check("a cloud drawn twice as wide is twice as wide",
    numbers(wide).filter((ignored, at) => at % 2 === 0),
    numbers(tall).filter((ignored, at) => at % 2 === 0).map((x) => x * 2));
  check("...and no taller for it",
    numbers(wide).filter((ignored, at) => at % 2 === 1),
    numbers(tall).filter((ignored, at) => at % 2 === 1));
  check("...and closed, because a cloud is a shape and not a squiggle",
    / Z"/.test(drawn("cloud")), true);

  // A cylinder lying down, open at the left: a queue is a pipe things wait in,
  // and the seam says which end they go in at.
  const queue = drawn("queue");
  check("a queue is a cylinder on its side", /A 16,50 0 0 1 144,100/.test(queue), true);
  check("...with a seam at the end things go in", /class="dd-rule"[^>]*A 16,50 0 0 1 16,100/.test(queue), true);

  /* A stick figure with its name across its chest is not a labelled actor, it
   * is a scribble. The figure and the label share out the height by one number
   * that both of them read.
   */
  const actor = drawn("actor");
  const band = 100 * (1 - DM.ACTOR_BAND);
  check("an actor is a figure and a name under it",
    /class="dd-actor"/.test(actor), true);
  check("...with the name below everything the figure uses",
    Number(/<tspan x="80" y="([\d.]+)"/.exec(actor)[1]) > band, true);
  check("...and the figure inside what the name leaves it",
    Number(/class="dd-actor"[^>]*L100.2,([\d.]+)"/.exec(actor)[1]), band);
  // Without a frame there is no figure, so there is nothing to sit under.
  const bare = DD.render({
    direction: "TD",
    nodes: [{ id: "A", shape: "actor", text: "Ada", frame: "none" }],
    edges: [],
    layout: { A: { x: 0, y: 0, w: 160, h: 100 } }
  }, { natural: true });
  check("an actor with no frame is words in the middle like anything else",
    /<tspan x="80" y="50">/.test(bare), true);

  /* Only ever a starting size, but a starting size that holds the thing. An
   * actor measured like a box is a head and no legs.
   */
  check("an actor starts tall enough to be a person",
    DM.measureNode({ shape: "actor", text: "Ada" }).h >= DM.ACTOR_LEAST, true);
  check("...and a queue wide enough for the caps that hold nothing",
    DM.measureNode({ shape: "queue", text: "Ada" }).w
      > DM.measureNode({ shape: "rect", text: "Ada" }).w, true);
  check("...and a cloud roomy enough that its words are not in a bump",
    DM.measureNode({ shape: "cloud", text: "Ada" }).h
      > DM.measureNode({ shape: "rect", text: "Ada" }).h, true);
}

console.log("=== a box drawn without its box ===");
{
  const boxed = (node) => DD.render({
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", ...node }],
    edges: [],
    layout: { A: { x: 0, y: 0, w: 120, h: 100 } }
  }, { natural: true });

  /* An icon or a picture standing on the paper on its own, which is what most
   * of a technical diagram is. Still a box underneath — it can be joined, moved
   * and labelled like everything else — but the shape is the frame, and without
   * one there is nothing to draw but what is inside.
   */
  const bare = boxed({ text: "Store", icon: "lucide:database", frame: "none" });
  check("a box with no frame draws no shape", /dd-shape/.test(bare), false);
  check("...and draws what is in it just the same",
    [/dd-icon/.test(bare), /Store/.test(bare)], [true, true]);

  const framed = boxed({ text: "Store", icon: "lucide:database" });
  check("...while a box that has one still has it", /dd-shape/.test(framed), true);

  // Only that word. Anything else a file might say is a frame, because a box
  // is the thing this draws and refusing to draw one on a typo is worse.
  check("anything but 'none' is a box with a frame",
    ["", "None", "off", "0", true].filter((frame) =>
      !/dd-shape/.test(boxed({ text: "x", frame }))), []);

  /* Mermaid has no way to say "no shape" — every labelled node is written with
   * brackets of some kind — so it goes down as the rectangle it nearly is, and
   * the missing frame is said beside it. The same bargain the arrow ends make.
   */
  const written = DM.serializeFlowchart({
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", text: "Store", icon: "lucide:database", frame: "none" }],
    edges: [],
    layout: { A: { x: 0, y: 0, w: 120, h: 100 } }
  });

  check("a frameless box is still a real node in the diagram",
    /A\[Store\]/.test(written), true);
  check("...with the frame it has not got said beside it",
    /icon=lucide:database frame=none/.test(written), true);

  const read = DM.parseFlowchart(written).nodes[0];
  check("...and comes back the way it went in",
    [read.frame, read.shape, read.icon], ["none", "rect", "lucide:database"]);
  check("...as something the model understood", read.extra, undefined);
}

console.log("=== a picture in a box ===");
{
  const HASH = "a".repeat(64);
  const HREF = `/api/assets/${HASH}.png`;

  const boxed = (node, w = 160, h = 120) => DD.render({
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", ...node }],
    edges: [],
    layout: { A: { x: 0, y: 0, w, h } }
  }, { natural: true });

  /* Fitted rather than filled: a picture stretched to the shape of the box it
   * was dropped in is a picture nobody recognises, so it keeps its own shape
   * and the box has whatever is left over.
   */
  const shown = boxed({ text: "Cat", image: HREF });
  check("a box with a picture draws it", /<image class="dd-picture"/.test(shown), true);
  check("...keeping the picture's own shape rather than the box's",
    /preserveAspectRatio="xMidYMid meet"/.test(shown), true);
  check("...inside the box rather than over its edges",
    /x="6" y="6" width="148" height="86"/.test(shown), true);
  check("...with the words in the strip under it",
    /<tspan x="80" y="109">Cat<\/tspan>/.test(shown), true);

  // A box with nothing written in it gives the whole of itself to the picture.
  const bare = boxed({ text: "", image: HREF });
  check("a picture with no words under it takes the room they would have had",
    /width="148" height="108"/.test(bare), true);
  check("...and nothing is written where they would have been",
    /<tspan/.test(bare), false);

  // The shape is still drawn, so a picture can be coloured and bordered like
  // everything else on the paper.
  check("a picture is in a box, and the box is still a box",
    /<rect class="dd-shape"/.test(shown), true);

  /* The address is checked rather than trusted. It comes out of a file and is
   * about to become the href of an <image>: a string that is not plainly one of
   * this app's own stored assets is a request to somewhere else, made by
   * everyone who opens the diagram.
   */
  const refused = [
    "https://example.com/tracker.png",
    "//example.com/tracker.png",
    "/api/assets/../../etc/passwd",
    `/api/assets/${HASH}.svg`,
    `/api/assets/${"z".repeat(64)}.png`,
    "javascript:alert(1)",
    `  ${HREF}`
  ];

  check("an address that is not one of this app's own is not drawn at all",
    refused.filter((image) => /<image/.test(boxed({ text: "x", image }))), []);
  check("...and the box is drawn as the box it is",
    /<tspan[^>]*>x<\/tspan>/.test(boxed({ text: "x", image: refused[0] })), true);

  // Every extension the store hands out is one the drawing will show.
  check("every kind of picture the store keeps can be drawn",
    ["png", "jpg", "gif", "webp", "avif"]
      .filter((ext) => !/<image/.test(boxed({ text: "x", image: `/api/assets/${HASH}.${ext}` }))),
    []);

  // It travels in the layout comment, which is where everything Mermaid cannot
  // say already goes.
  const written = DM.serializeFlowchart({
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", text: "Cat", image: HREF }],
    edges: [],
    layout: { A: { x: 0, y: 0, w: 160, h: 120 } }
  });

  check("a picture reaches the file beside where the box is",
    new RegExp(`%% @ A 0,0 160x120 image=${HREF}`).test(written), true);

  const read = DM.parseFlowchart(written).nodes[0];
  check("...and comes back off it", read.image, HREF);
  check("...as something the model understood, not as an unknown it is carrying",
    read.extra, undefined);
}

console.log("=== the type a diagram is set in is real Mermaid ===");
{
  const paint = (node, classes) => DD.render({
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", ...node }],
    edges: [],
    classes,
    layout: { A: { x: 0, y: 0, w: 120, h: 40 } }
  }, { natural: true });

  /* Every font control is a classDef declaration, which every Mermaid renderer
   * reads — so a diagram set in bold serif is set in bold serif on GitHub as
   * well, rather than only here. There is no control for anything Mermaid
   * cannot say, because a size the file cannot keep is a size that goes away
   * the next time the diagram is opened somewhere else.
   */
  const worn = paint({ text: "a", classes: ["big"] },
    { big: { "font-size": "20px", "font-weight": "700",
      "font-family": "serif", "font-style": "italic" } });

  check("what a box is set in reaches the drawing as it was written",
    /--dd-font-size:20px;--dd-font-weight:700;--dd-font-family:serif;--dd-font-style:italic;/
      .test(worn), true);

  /* Held to what a font control can say. A classDef comes out of a file and a
   * font name out of a file is a string on its way into a style attribute, so
   * anything that is not plainly one of the three generic families is dropped
   * and the box is set the way everything else is.
   */
  const odd = paint({ text: "a", classes: ["odd"] },
    { odd: { "font-family": "url(evil)", "font-size": "20em",
      "font-weight": "heavy", "font-style": "oblique 40deg" } });
  check("...and anything else is not written at all",
    /--dd-font/.test(odd), false);

  // The size decides where a word is cut off as well as how it looks, so a box
  // set larger runs out of room sooner.
  const long = (classes) => DD.render({
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", kind: "table",
      text: "T<br/>a long field name | b", classes: classes ? ["big"] : [] }],
    edges: [],
    classes: { big: { "font-size": "20px" } },
    layout: { A: { x: 0, y: 0, w: 200, h: 66 } }
  }, { natural: true });

  const cutAt = (drawn) => (/<\/title>([^<]*)</.exec(drawn) || [])[1] || "";
  check("a box set larger runs out of room sooner",
    [cutAt(long(false)), cutAt(long(true))], ["a long fiel…", "a long \u2026"]);

  /* One size for every label, and the drawing has to know what it is to measure
   * a word against it. It is written in two places — the stylesheet sets it and
   * the drawing measures by it — so this is the check that holds them together.
   */
  const stylesheet = styleSource(ROOT);
  const set = new JSDOM(`<style>${stylesheet}</style>
    <svg class="dd"><text class="dd-text" id="one">x</text>
    <text class="dd-text dd-row" id="row">x</text></svg>`);
  const typed = (id) => set.window.getComputedStyle(set.window.document.getElementById(id));

  check("the size the stylesheet sets is the size the drawing measures by",
    typed("one").fontSize, `var(--dd-font-size, ${DD.TEXT_SIZE}px)`);
  check("...and a row in a table is set in the same one, so there is one number",
    typed("row").fontSize, typed("one").fontSize);
  check("...with what a box was told to be beating it",
    [typed("one").fontWeight, typed("one").fontFamily, typed("one").fontStyle],
    ["var(--dd-font-weight, 400)", "var(--dd-font-family, inherit)",
      "var(--dd-font-style, normal)"]);
}

};
