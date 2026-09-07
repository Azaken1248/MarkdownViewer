// Part of the visual-editor suite. See visual.test.js, which loads the modules
// and calls it.
//
// How big a box has to be to hold what is in it, and the picture that comes
// out at the end.
//
// Everything it needs is handed to it: the suite's own check(), the three
// modules under test, and the fixtures walker. Split out of one file only
// because that file had grown past a thousand lines.
module.exports = (ctx) => {
  const {
    check, DM, DD, ROOT, JSDOM, styleSource
  } = ctx;

console.log("=== a table's cells are in one place, read twice ===");
{
  /* The drawing puts its words in these places, and the editor puts a field
   * over a cell in the same ones. Two copies of that arithmetic is a table
   * where you type into one place and the words come out in another.
   */
  const grid = [["Person"], ["name", "string"], ["age", "int"]];
  const node = { id: "A", shape: "rect", kind: "table", text: DM.joinCells(grid) };
  const spacing = DM.tableMetrics(node);
  const cells = DM.textCells(node.text);
  const boxes = DD.cellBoxes(cells, 200, 120, spacing);

  check("a table is its title, and then a cell per column per row",
    boxes.map((at) => `${at.row}.${at.column}`),
    ["0.0", "1.0", "1.1", "2.0", "2.1"]);
  // A heading rather than one more row: it spans the width and keeps its own
  // band whatever the rows under it are doing.
  check("...the title spanning the whole of it",
    [boxes[0].w, boxes[0].h], [200, spacing.title]);

  const drawn = DD.render({
    direction: "TD",
    nodes: [node],
    edges: [],
    classes: {},
    layout: { A: { x: 0, y: 0, w: 200, h: 120 } }
  }, { natural: true });

  const parsed = new JSDOM(`<!doctype html><body>${drawn}</body>`).window.document;
  const written = (what) => [...parsed.querySelectorAll(what)]
    .map((one) => [Number(one.getAttribute("x")), Number(one.getAttribute("y"))]);

  check("...and every word is drawn where the run says its cell is",
    written(".dd-row"),
    boxes.slice(1).map((at) => [at.x + spacing.pad, at.y + (at.h / 2)]));
  check("...the title in the middle of the band the run gives it",
    written(".dd-title"), [[boxes[0].w / 2, boxes[0].h / 2]]);

  // And which cell a point is in, asked of the same run: a table dragged taller
  // than its rows has somewhere in it that is no cell at all.
  const found = (x, y) => {
    const at = DD.cellAt(cells, 200, 120, spacing, x, y);
    return at && `${at.row}.${at.column}`;
  };

  check("a point in the table finds the cell it landed in",
    [found(150, 49), found(10, 10), found(10, 500), found(150, 96)],
    ["1.1", "0.0", null, "2.1"]);
}

console.log("=== type big enough to need the room ===");
{
  /* A size control that only changes the letters is a size control that works
   * on boxes with one word in them. Two lines set in 32px on twenty-point
   * spacing are two lines written over one another, and a caption keeping the
   * band small type needed is a caption written over the picture above it.
   */
  const paint = (node, classes, at) => DD.render({
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", ...node }],
    edges: [],
    classes,
    layout: { A: { x: 0, y: 0, ...at } }
  }, { natural: true });

  const apart = (drawn) => {
    const ys = [...drawn.matchAll(/<tspan x="[\d.-]+" y="([\d.-]+)"/g)]
      .map((one) => Number(one[1]));
    return Math.round((ys[1] - ys[0]) * 100) / 100;
  };

  const room = { w: 200, h: 100 };
  const two = { text: "one<br/>two", classes: ["big"] };
  const set = (size) => ({ big: { "font-size": size } });

  check("two lines of ordinary type sit a line apart",
    apart(paint({ text: "one<br/>two" }, {}, room)), DD.LINE_HEIGHT);
  check("...and two lines of big type sit as far apart as the type is big",
    apart(paint(two, set("32px"), room)), Math.round(32 * DD.LEADING * 100) / 100);
  check("...while type too small to need more room keeps the room it had",
    apart(paint(two, set("9px"), room)), DD.LINE_HEIGHT);

  /* And the block of them stays in the middle of the box. Lines spaced for big
   * type but placed for small type are lines that fit and sit too high, which
   * is the same bug wearing a hat.
   */
  const middleOf = (drawn) => {
    const ys = [...drawn.matchAll(/<tspan x="[\d.-]+" y="([\d.-]+)"/g)]
      .map((one) => Number(one[1]));
    return Math.round(((ys[0] + ys[ys.length - 1]) / 2) * 100) / 100;
  };

  check("...and either way the words sit in the middle of what holds them",
    [middleOf(paint(two, set("32px"), room)), middleOf(paint(two, {}, room))],
    [room.h / 2, room.h / 2]);

  /* A size this file would not write into a style attribute is not one it lays
   * the lines out by either: the box is drawn at the standard size, so it has
   * to be spaced at the standard size or the words come apart from the room
   * kept for them.
   */
  check("...and a size the drawing will not write is a size it does not space by",
    apart(paint(two, set("32em"), room)), DD.LINE_HEIGHT);

  // The words under a picture take a band along the bottom, and the band is as
  // deep as the words in it are tall.
  const HREF = `/api/assets/${"a".repeat(64)}.png`;
  const tall = (drawn) => Number(/<image[^>]* height="([\d.]+)"/.exec(drawn)[1]);
  check("a caption in big type takes the room for it out of the picture",
    [tall(paint({ text: "one", image: HREF }, {}, room)),
      tall(paint({ text: "one", image: HREF, classes: ["big"] }, set("32px"), room))],
    [66, 39.6]);

  // And out of an icon, which is the same band drawn under a different thing.
  const scaleOf = (drawn) =>
    Number(/class="dd-icon" transform="translate\([-\d.,]+\) scale\(([\d.]+)\)/
      .exec(drawn)[1]);
  check("...and out of an icon, which is the same band under a different thing",
    [scaleOf(paint({ text: "one", icon: "lucide:database" }, {}, room)),
      scaleOf(paint({ text: "one", icon: "lucide:database", classes: ["big"] },
        set("32px"), room))],
    [2.8, 1.7]);

  /* The measure knows as well. A box measured for ordinary type and then set in
   * big type is a box its own words no longer fit in — and the measure is the
   * one thing that could have known.
   */
  const box = (font) => DM.measureNode({ id: "A", shape: "rect", text: "hello there" },
    font ? { font } : {});

  check("a box measured for big type is given the room for it",
    [box("26px").w > box().w, box("26px").h > box().h], [true, true]);
  check("...and a size out of the bounds the panel offers is no size at all",
    [box("400px"), box("20em"), box("0px")], [box(), box(), box()]);
}

console.log("=== a box is gripped by any of its edges ===");
{
  /* Eight grips: four corners and four sides. A box with only the diagonal one
   * is a box you cannot make wider without also making it taller.
   *
   * Each sits on what it drags — the middle of a side, the point of a corner —
   * because a handle that is not on the thing it moves is a handle you have to
   * be told about.
   */
  const marks = DD.marksMarkup({ x: 100, y: 200, w: 80, h: 40 });
  const grips = [...marks.matchAll(
    /data-grip="(\w+)" cx="(-?\d+)" cy="(-?\d+)"/g)]
    .map((one) => [one[1], Number(one[2]), Number(one[3])]);

  check("every side and every corner has one", grips.map((one) => one[0]),
    ["nw", "n", "ne", "w", "e", "sw", "s", "se"]);
  check("...the corners on the corners",
    grips.filter(([name]) => name.length === 2).map(([, x, y]) => [x, y]),
    [[100, 200], [180, 200], [100, 240], [180, 240]]);
  check("...and the sides in the middle of their sides",
    grips.filter(([name]) => name.length === 1).map(([, x, y]) => [x, y]),
    [[140, 200], [100, 220], [180, 220], [140, 240]]);

  // Circles rather than squares: a handle grown for a finger has to grow about
  // its own middle, and a square given a bigger width grows down and to the
  // right, off the corner it was marking.
  check("a grip is a circle, so growing one keeps it where it was",
    /<circle class="dd-handle dd-resize"/.test(marks), true);

  /* The cursor is the only thing that says which way a grip goes before it is
   * dragged. Computed rather than matched as text: a rule that lands on the
   * wrong grip is a cascade problem and a regex cannot see a cascade.
   */
  const stylesheet = styleSource(ROOT);
  const held = new JSDOM(`<style>${stylesheet}</style>
    <svg class="dd dd-editing">${DD.GRIPS.map(([name]) =>
    `<circle class="dd-handle dd-resize" id="g-${name}" data-grip="${name}"/>`).join("")}</svg>`);
  const aims = (name) =>
    held.window.getComputedStyle(held.window.document.getElementById(`g-${name}`)).cursor;

  check("a corner grip points along its diagonal",
    [aims("nw"), aims("se"), aims("ne"), aims("sw")],
    ["nwse-resize", "nwse-resize", "nesw-resize", "nesw-resize"]);
  check("...and a side grip across the edge it drags",
    [aims("n"), aims("s"), aims("e"), aims("w")],
    ["ns-resize", "ns-resize", "ew-resize", "ew-resize"]);
}

console.log("=== a table is spaced out the way it was asked to be ===");
{
  const table = (node, w, h) => DD.render({
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", kind: "table", ...node }],
    edges: [],
    layout: { A: { x: 0, y: 0, w, h } }
  }, { natural: true });

  /* Two numbers anyone would want to change about a table: how far the words
   * sit from the walls of a cell, and how much room a row gets. Both have a
   * standard, and the file only mentions one when it is departed from.
   */
  check("a table nobody has spaced out has a standard to be spaced out by",
    DM.tableMetrics({}), { title: 26, pad: 10, gap: 20 });
  check("...and one that has been keeps what it was given",
    DM.tableMetrics({ pad: 4, gap: 32 }), { title: 26, pad: 4, gap: 32 });
  check("...within what a cell can hold, so nothing written by hand can break it",
    [DM.tableMetrics({ pad: 900, gap: -4 }), DM.tableMetrics({ pad: "x" })],
    [{ title: 26, pad: 24, gap: 10 }, { title: 26, pad: 10, gap: 20 }]);

  // The title band never moves. It is a heading rather than a row, and a
  // heading that changes size with the rows under it stops reading as one.
  check("the heading is the same height however the rows are spaced",
    [DM.tableMetrics({ gap: 10 }).title, DM.tableMetrics({ gap: 50 }).title], [26, 26]);

  // Padding is where the words start, so it is the one thing that moves them.
  check("padding is how far a cell's words sit from its wall",
    /<text class="dd-text dd-row" x="4"/.test(
      table({ text: "T<br/>a | b", pad: 4 }, 200, 66)), true);
  check("...and the same padding again on a table nobody has touched",
    /<text class="dd-text dd-row" x="10"/.test(
      table({ text: "T<br/>a | b" }, 200, 66)), true);

  // Spacing is a row's worth of height, so it is what the table is measured by.
  const heightOf = (node) => DM.measureNode({ shape: "rect", kind: "table", ...node }).h;
  check("spacing is how much room each row gets",
    [heightOf({ text: "T<br/>a<br/>b" }), heightOf({ text: "T<br/>a<br/>b", gap: 40 })],
    [70, 110]);
  // A table of nothing but a heading is the shortest a box is allowed to be,
  // whatever its rows would have been given.
  check("...counted for the rows and not for the heading",
    heightOf({ text: "T", gap: 40 }), 50);

  // And padding is room a column has to have, so it is what a column's floor
  // is measured by.
  const widthOf = (node) => DM.measureNode({ shape: "rect", kind: "table", ...node }).w;
  check("padding is room a column has to have either side of its words",
    [widthOf({ text: "T<br/>a | b" }), widthOf({ text: "T<br/>a | b", pad: 20 })],
    [140, 180]);

  // Written down only when it is not the standard: the file says what was
  // chosen rather than what everything happens to be.
  const written = (node) => DM.serializeFlowchart({
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", kind: "table", text: "T<br/>a", ...node }],
    edges: [],
    layout: { A: { x: 0, y: 0, w: 140, h: 60 } }
  });

  /* Anything the model understands has to be listed as understood, or it is
   * read into the node AND kept as an unknown — and the unknowns are written
   * last, so the value that was read wins over the value that was changed and
   * the edit is thrown away on save.
   *
   * It cost a released version of the two steppers above: they worked on the
   * screen and did nothing to any file that already said what it was spaced by.
   */
  const said = DM.parseFlowchart("flowchart TD\n    %% layout v1\n"
    + "    %% @ A 0,0 200x120 kind=table pad=4 gap=30 mystery=1\n    A[\"T<br/>a\"]\n");

  check("a node keeps nothing it understood as an unknown as well",
    said.nodes[0].extra, { mystery: "1" });

  const changed = { ...said, layout: said.layout };
  changed.nodes[0].pad = 20;
  changed.nodes[0].gap = 40;
  check("...so changing one changes the file, rather than the file changing it back",
    /pad=20 gap=40/.test(DM.serializeFlowchart(changed)), true);
  check("...and the one it never understood is still carried",
    /mystery=1/.test(DM.serializeFlowchart(changed)), true);

  check("a table spaced the standard way says nothing about it",
    /pad=|gap=/.test(written({ pad: 10, gap: 20 })), false);
  check("...and one spaced any other way says so",
    /kind=table pad=4 gap=32/.test(written({ pad: 4, gap: 32 })), true);
  check("...and says it in a way that comes back",
    (() => {
      const node = DM.parseFlowchart(written({ pad: 4, gap: 32 })).nodes[0];
      return [node.pad, node.gap];
    })(), [4, 32]);
}

console.log("=== a word too long for its cell stops at the wall ===");
{
  const table = (text, w) => DD.render({
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", kind: "table", text }],
    edges: [],
    layout: { A: { x: 0, y: 0, w, h: 66 } }
  }, { natural: true });

  /* A word wider than the cell it is in is a word written over the wall into
   * the next one, which is worse than not being able to read all of it. So it
   * is cut to what fits and marked, and what it said in full is hung off the
   * text as a <title> — resting on it says the rest.
   */
  const wide = table("T<br/>short | short", 400);
  check("a word that fits is written as it is",
    /<text class="dd-text dd-row" x="10"[^>]*>short<\/text>/.test(wide), true);
  check("...and says nothing more about itself", /<title>/.test(wide), false);

  const tight = table("T<br/>a very long field name indeed | b", 200);
  check("a word too long for its cell is cut off",
    /&#8230;|…/.test(tight), true);
  check("...and marked where it was cut",
    /<\/title>a very long…<\/text>/.test(tight), true);
  check("...keeping what it said in full, for resting on",
    /<title>a very long field name indeed<\/title>/.test(tight), true);

  // The heading spans the whole table, so it is cut against the whole width
  // rather than against a column.
  const heading = table("a very long heading indeed that will not fit<br/>a | b", 200);
  check("a heading too long for the table is cut too",
    /<title>a very long heading indeed that will not fit<\/title>/.test(heading), true);
  check("...against the whole width, because that is what it spans",
    /<\/title>a very long heading indeed …<\/text>/.test(heading), true);

  // A cell with room for nothing but the mark gets the mark, and one without
  // room for even that gets nothing: a mark drawn over the wall is the thing
  // this exists to stop. Both keep what they said, for resting on.
  const narrow = table("T<br/>abcdef | b", 56);
  check("a cell with room for nothing but the mark gets the mark",
    /<title>abcdef<\/title>…<\/text>/.test(narrow), true);

  const none = table("T<br/>abcdef | b", 30);
  check("...and one without room for even that writes nothing over the wall",
    /<title>abcdef<\/title><\/text>/.test(none), true);
}

console.log("=== one cell of a table, set in its own type ===");
{
  const table = (cells, text = "T<br/>a | b<br/>c | d", w = 400) => DD.render({
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", kind: "table", text, cells }],
    edges: [],
    layout: { A: { x: 0, y: 0, w, h: 120 } }
  }, { natural: true });

  const styleOf = (svg, words) => {
    const found = new RegExp(`<text[^>]*?(?: style="([^"]*)")?>${words}</text>`)
      .exec(svg);
    return found ? (found[1] || "") : null;
  };

  /* The same custom properties the box's own font sets, one level further in.
   * Which is what makes "bold this cell" something you can say on top of "this
   * table is mono" rather than instead of it.
   */
  const dressed = table({ "1.0": "b", "2.1": "m11", "0.0": "s18" });
  check("a cell told to be bold is written bold",
    styleOf(dressed, "a"), "--dd-font-weight:700;");
  check("...and one told a family and a size says both",
    styleOf(dressed, "d"), "--dd-font-size:11px;--dd-font-family:monospace;");
  check("...and the title is a cell like any other",
    styleOf(dressed, "T"), "--dd-font-size:18px;--dd-font-family:serif;");
  check("...while a cell that was told nothing says nothing",
    styleOf(dressed, "b"), "");

  // A cell set larger runs out of room sooner. A cell that kept the table's
  // character width would be cut too late, and so written over the wall.
  const big = table({ "1.0": "40" }, "T<br/>abcdefgh | b", 200);
  check("a cell set larger is cut sooner",
    /<title>abcdefgh<\/title>/.test(big), true);
  check("...and the same words at the ordinary size are not",
    /<title>abcdefgh<\/title>/.test(table({}, "T<br/>abcdefgh | b", 200)), false);

  /* The token becomes a style attribute on a <text>, and a file is something
   * anyone can hand you. Anything that is not one of the shapes the format has
   * is dropped on the way in rather than kept and passed on.
   */
  const read = (said) => DM.readCellStyles(said);
  check("a token the format has is read", read("1.0:b;2.1:m14"),
    { "1.0": "b", "2.1": "m14" });
  check("...a letter it does not have is not", read("1.0:x"), {});
  check("...nor a size outside what a diagram is set in",
    read("1.0:b99;2.0:b4"), {});
  check("...nor anything smuggled in beside it",
    read("1.0:b;red:x;2.0:</style>"), { "1.0": "b" });
  check("...and a cell wearing nothing gets no entry", read("1.0:"), {});

  /* Mermaid has a classDef and a classDef dresses a node. There is no such
   * thing as a class on a cell, so this is one of the few things that cannot
   * be said in the real syntax — and it is said beside it, and survives.
   */
  const written = DM.serializeFlowchart({
    direction: "TD",
    nodes: [{
      id: "A", shape: "rect", kind: "table",
      text: "Staff<br/>Ada | Lead", cells: { "1.1": "m14", "0.0": "b" }
    }],
    edges: [],
    layout: { A: { x: 0, y: 0, w: 200, h: 80 } }
  });
  check("what a cell wears reaches the file beside the table",
    /cells=0\.0:b;1\.1:m14/.test(written), true);
  check("...in one order however it was given, so the file settles",
    written, DM.serializeFlowchart(DM.parseFlowchart(written)));
  check("...and comes back on the same cells",
    DM.parseFlowchart(written).nodes[0].cells, { "0.0": "b", "1.1": "m14" });
  check("...while a table nobody dressed says nothing about it",
    /cells=/.test(DM.serializeFlowchart({
      direction: "TD",
      nodes: [{ id: "A", shape: "rect", kind: "table", text: "Staff<br/>Ada" }],
      edges: [],
      layout: { A: { x: 0, y: 0, w: 200, h: 80 } }
    })), false);

  /* A row taken off takes its cells' type with it. Keeping it would mean that
   * adding the row back later brings an old bold with it out of nowhere.
   */
  const grid = DM.textCells("T<br/>a | b");
  check("a cell the table still has is written",
    DM.writeCellStyles({ "1.0": "b", "1.1": "i" }, grid), "1.0:b;1.1:i");
  check("...and one on a row that has gone is not",
    DM.writeCellStyles({ "1.0": "b", "4.0": "i" }, grid), "1.0:b");
  check("...nor one in a column that has gone",
    DM.writeCellStyles({ "1.0": "b", "1.5": "i" }, grid), "1.0:b");
  // The title spans the table, so row zero has exactly one cell however many
  // columns there are.
  check("...nor one beside a title, which has no beside",
    DM.writeCellStyles({ "0.0": "b", "0.1": "i" }, grid), "0.0:b");
}

console.log("=== a table is measured by its columns ===");
{
  const size = (text) => DM.measureNode({ shape: "rect", kind: "table", text });

  check("a table is at least as wide as a table", size("A<br/>b").w, 140);

  /* Every column needs room to be read in, whatever is in it — which is what
   * makes another column widen the table rather than divide the width it
   * already had.
   */
  check("...and at least so wide per column",
    [3, 4, 5].map((many) => size(`A<br/>${new Array(many).fill("x").join(" | ")}`).w),
    [210, 280, 350]);
  check("...and wider still once the cells themselves no longer fit",
    size("A<br/>a very long cell indeed | another long one").w > 280, true);
}

console.log("=== a picture of the diagram, for somewhere this app is not ===");
{
  const stylesheet = styleSource(ROOT);
  const model = {
    direction: "TD",
    nodes: [{ id: "A", shape: "note", text: "Ada" }, { id: "B", shape: "actor", text: "Bo" }],
    edges: [{ from: "A", to: "B", kind: "arrow" }],
    layout: { A: { x: 0, y: 0, w: 120, h: 60 }, B: { x: 0, y: 140, w: 100, h: 100 } }
  };

  /* On the page a diagram is markup this app writes, painted by rules in
   * app.css, in the colours of whichever theme is on. Only the first of those
   * is inside the SVG — so a file saved as it stands opens elsewhere as black
   * shapes on white, and an export has to carry the other two with it.
   */
  const rules = DD.exportRules(stylesheet);
  check("the rules the drawing is painted by come out of the app's own stylesheet",
    rules.includes(".dd .dd-shape{"), true);
  check("...every one of them", rules.split("\n").length > 20, true);
  check("...and nothing that is not about the drawing",
    rules.split("\n").every((rule) => rule.includes(".dd")), true);

  /* Scanned rather than matched with a pattern. A stylesheet is nested, and a
   * regular expression that walks one takes every other rule — which is the
   * kind of wrong that still looks like it works.
   */
  const pair = ".dd .one{fill:red}\n.dd .two{fill:blue}\n.dd .three{fill:green}";
  check("two rules in a row are both taken, not every other one",
    DD.exportRules(pair).split("\n").length, 3);
  // What is inside a @media is about the screen it is being read on, and a
  // saved file has no screen.
  check("...and a rule that only applies to a narrow screen is left behind",
    DD.exportRules("@media (max-width: 40em){.dd .one{fill:red}}"), "");
  // An at-rule may name a selector in its own prelude, which is the one way a
  // block that is not a rule can look like one that is.
  check("...and an at-rule that names the drawing is still an at-rule",
    DD.exportRules("@supports selector(.dd){color:red}"), "");
  check("...as is a comment that happens to mention one",
    DD.exportRules("/* .dd .one{fill:red} */"), "");

  /* Gathered from the rules rather than listed anywhere, so a rule that starts
   * falling back to one more variable takes it with it.
   */
  /* Every name answered, so that a variable left out of the picture is one this
   * decided to leave out rather than one the theme had nothing to say about.
   */
  const asked = DD.exportPalette(".dd{color:var(--fg)} .dd .a{fill:var(--dd-fill, var(--canvas))}",
    (name) => ({ "--fg": "#111", "--canvas": "#fff" })[name] || "#abcabc");
  check("the theme travels with the picture", asked, "--canvas:#fff;--fg:#111;");
  /* `--dd-*` are the box's own, set on the group as it is drawn. Pinning them
   * at the root would paint every box in the diagram the same colour.
   */
  check("...but not the ones each box sets for itself",
    asked.includes("--dd-fill"), false);
  check("...and a variable the theme has nothing to say about is left out",
    DD.exportPalette(".dd{color:var(--nope)}", () => ""), "");

  const saved = DD.exportSvg(model, {
    css: stylesheet,
    read: (name) => (name === "--canvas" ? "#0b0f12" : "#ff0000"),
    background: "#0b0f12",
    label: "Ada and Bo"
  });

  check("a saved picture carries its own rules", saved.includes("<style>.dd{"), true);
  check("...and its own colours", /<svg[^>]*style="[^"]*--canvas:#0b0f12/.test(saved), true);
  check("...and a background, because pale lines on an unknown page is a"
    + " picture of nothing",
    /<rect x="0" y="0" width="150" height="270" fill="#0b0f12"\/>/.test(saved), true);
  check("...behind the diagram rather than over it",
    saved.indexOf('fill="#0b0f12"/>') < saved.indexOf('<g class="dd-nodes"'), true);
  check("...and is one file, needing nothing else to be looked at",
    /<(?:link|script)\b/.test(saved), false);
  check("...at the size of the diagram", DD.exportSize(model, model.layout),
    { w: 150, h: 270 });
  check("...and still says what it is", saved.includes('aria-label="Ada and Bo"'), true);

  /* A colour out of the theme is about to become a fill attribute, and a theme
   * is a stylesheet somebody can write. What is not plainly a colour is not
   * painted at all — escaping it would keep it out of the markup's way, but it
   * would still be a fill nobody chose.
   */
  const odd = DD.exportSvg(model,
    { css: "", read: () => "", background: 'red"/><script>x' });
  check("a background that is not plainly a colour is not painted",
    /<rect x="0" y="0"[^>]*fill=/.test(odd), false);
  check("...and nothing of it reaches the markup",
    odd.includes("<script"), false);

  /* A copy nothing compares is a copy that goes stale. These are the classes
   * the drawing actually writes, so an export that stopped carrying the rules
   * for one of them would be an export missing that part of the picture.
   */
  const drawn = ["dd-shape", "dd-rule", "dd-text", "dd-actor", "dd-icon", "dd-edge"];
  check("every class the drawing writes is a class the picture carries the rule for",
    drawn.filter((name) => !rules.includes(`.dd-${name.slice(3)}`)), []);
}

console.log("=== a new step needs an id nothing is using ===");
{
  check("the first id on an empty diagram", DM.nextNodeId({ nodes: [] }), "n1");
  check("...skips the ones already taken",
    DM.nextNodeId({ nodes: [{ id: "n1" }, { id: "n2" }, { id: "n4" }] }), "n3");
  check("...and does not care what else is in the diagram",
    DM.nextNodeId({ nodes: [{ id: "Start" }, { id: "End" }] }), "n1");
}

console.log("=== the previews are actually on the screen ===");
{
  // A source preview carries .markdown-body, and it carries it deliberately: it
  // is what makes an equation, a code block or a diagram inside it look the way
  // it will look once it is in the document.
  //
  // What comes with it is the article's own rules, which are about the article.
  // `.markdown-body { display: none }` waits for a document to be loaded, and
  // `.app-shell .markdown-body` adds the phone tier's 96px of dock clearance at
  // the bottom of the page. Applied to a preview a few hundred pixels up inside
  // that page, the first makes it invisible and the second hangs an empty
  // half-screen under it — so this is computed from the real stylesheet rather
  // than asserted as a string, because the bug is in the cascade and a regex
  // cannot see a cascade.
  //
  // The builder's canvas is deliberately not one of these. It is a drawing we
  // make ourselves rather than rendered markdown, so it has no reason to carry
  // the article's class and nothing to inherit from it.
  const stylesheet = styleSource(ROOT);
  const page = new JSDOM(`<style>${stylesheet}</style>
    <div class="app-shell"><article class="markdown-body doc-editing visible">
      <div class="ve-embed">
        <div class="ve-embed-preview markdown-body" id="source">x</div>
        <div class="ve-diagram-canvas" id="canvas">y</div>
        <div class="ve-embed-preview markdown-body" id="blank"></div>
      </div>
    </article></div>`);

  const styleOf = (id) => page.window.getComputedStyle(page.window.document.getElementById(id));

  check("a source preview is visible", styleOf("source").display, "block");
  check("a source preview keeps its own padding, not the document's",
    styleOf("source").paddingBottom, "10px");
  check("the canvas the diagram is drawn on is visible", styleOf("canvas").display, "block");
  check("...and scrolls its own paper rather than the page",
    styleOf("canvas").overflow, "auto");
  check("a preview of markdown that renders to nothing stays hidden",
    styleOf("blank").display, "none");

  /* The grid was drawn from the day the canvas had one and has never once been
   * seen.
   *
   * The paper carries fill="url(#grid)" as an attribute, and the stylesheet
   * painted the same element var(--canvas). A presentation attribute loses to
   * every author rule, so the paper came out a flat colour and the pattern
   * underneath it was never shown. The colour lives inside the pattern now, and
   * nothing in the stylesheet may paint the paper again.
   */
  const drawn = new JSDOM(`<style>${stylesheet}</style>
    <svg class="dd dd-editing">
      <rect class="dd-paper" id="paper" fill="url(#grid)"/>
      <rect class="dd-grid-back" id="back"/>
      <path class="dd-grid-line" id="line"/>
    </svg>`);
  const painted = (id) => drawn.window.getComputedStyle(drawn.window.document.getElementById(id));

  check("nothing in the stylesheet paints over the paper's pattern",
    painted("paper").fill, "");

  // The pattern carries the paper's own colour, or the paper is transparent and
  // whatever is behind the canvas shows through the grid.
  const sheet = DD.render({
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", text: "a" }],
    edges: [],
    layout: { A: { x: 0, y: 0, w: 80, h: 40 } }
  }, { natural: true, grid: true });
  check("...because the paper's colour is a rect inside the pattern",
    /<pattern[^>]*><rect class="dd-grid-back" width="\d+" height="\d+"\/>/.test(sheet), true);
  check("...with the lines drawn over it",
    /dd-grid-back[^>]*\/><path class="dd-grid-line"/.test(sheet), true);
  check("...and the paper's colour is inside the pattern instead",
    painted("back").fill, "var(--canvas)");
  check("...with the lines faint enough to be paper rather than graph paper",
    [painted("line").stroke, painted("line").opacity], ["var(--border)", "0.55"]);

  /* The editor is four regions, and each one holds one kind of thing: the bar
   * across the top is what is done to the whole diagram, the rail down one side
   * is what can be put into it, the panel down the other is what is true of
   * what is picked, and the paper takes everything left over.
   *
   * Computed rather than matched as text, because what went wrong last time was
   * a cascade and not a rule: the canvas carried a 60dvh cap meant for a strip
   * inside a document, and on a page where the editor is the whole window that
   * cap left the paper two thirds of the height it had been given and the rest
   * of the page scrolling under it.
   */
  const editor = new JSDOM(`<style>${stylesheet}</style>
    <main class="diagram-page-canvas" id="host">
      <div class="ve-diagram-shell" id="shell">
        <div class="ve-diagram-bar" id="bar"></div>
        <div class="ve-diagram-body" id="body">
          <aside class="ve-diagram-rail" id="rail">
            <div class="ve-diagram-palette" id="palette"></div>
            <div class="ve-diagram-tree" id="tree">
              <div class="ve-diagram-branches" id="branches"></div>
            </div>
          </aside>
          <div class="ve-diagram-stage" id="stage">
            <div class="ve-diagram-canvas" id="paper"></div>
            <div class="ve-diagram-zoom" id="zoom"></div>
          </div>
          <aside class="ve-diagram-side" id="side"></aside>
        </div>
      </div>
    </main>`);
  const region = (id) =>
    editor.window.getComputedStyle(editor.window.document.getElementById(id));

  check("the bar is across the top and the two rails are beside each other",
    [region("shell").flexDirection, region("body").flexDirection], ["column", ""]);
  check("the paper takes what the rails leave",
    [region("stage").flex, region("paper").flex], ["1 1 0%", "1 1 0%"]);
  check("...all of it, rather than the strip's share of a document",
    region("paper").maxHeight, "none");
  check("...and can be narrower than the diagram on it, so the panel stays put",
    [region("stage").minWidth, region("paper").minWidth], ["0", "0"]);

  /* One scroller per region. The page cannot scroll — a page that scrolls is a
   * page whose Save button can be pushed off the bottom — so the rail and the
   * panel each scroll themselves, and the paper pans instead of scrolling.
   */
  /* Both sides are as wide as they were left, which the editor writes as a
   * custom property on the body. A width baked into the rule instead is a
   * panel whose bar moves nothing.
   */
  check("a side is as wide as it was left rather than as wide as it was built",
    [region("rail").flex, region("side").flex],
    ["0 0 var(--dd-rail, 196px)", "0 0 var(--dd-side, 300px)"]);
  check("...and can be narrower than what is in it, so the bar can reach",
    [region("rail").minWidth, region("side").minWidth], ["0", "0"]);

  check("nothing scrolls the page the editor is on", region("host").overflow, "hidden");
  /* The rail is two things stacked — the shapes to put down and the tree of
   * what is down — so it is the two of them that scroll rather than the rail.
   * A rail that scrolled as one would push the shapes off the top of it as
   * soon as the diagram had more boxes than the window is tall.
   */
  check("...the rail holds two scrollers rather than being one",
    [region("rail").overflow, region("palette").overflowY, region("branches").overflowY],
    ["hidden", "auto", "auto"]);
  check("...with the tree taking whatever the shapes leave",
    [region("tree").flex, region("tree").minHeight], ["1 1 auto", "0"]);
  check("...and so does the panel", region("side").overflowY, "auto");

  // The zoom is about the view rather than about the diagram, so it belongs to
  // the window it changes. Which only works if the paper is what it is measured
  // against: positioned against anything further out and it drifts.
  check("the zoom sits on the paper",
    [region("zoom").position, region("stage").position], ["absolute", "relative"]);

  /* A control is capped by the row it shares. The flow menu shares no row — it
   * is on a bar with nine other things — and it was wearing the panel field's
   * `max-width: 40%`, which squeezed "Left to right" down to a few letters and
   * an ellipsis. The panel's own fields have the opposite problem: each owns
   * its line now, so a cap at a fraction of a row it no longer shares leaves
   * half the line empty.
   *
   * Both are the cascade rather than a rule, so both are computed.
   */
  const controls = new JSDOM(`<style>${stylesheet}</style>
    <div class="ve-diagram-bar">
      <label class="ve-diagram-flow"><span>Flow</span>
        <select class="ve-diagram-kind ve-diagram-direction" id="flow"></select>
      </label>
    </div>
    <div class="ve-diagram-inspector">
      <label class="ve-diagram-field"><span class="ve-diagram-field-name">Shape</span>
        <select class="ve-diagram-shape" id="shape"></select>
      </label>
      <label class="ve-diagram-field"><span class="ve-diagram-field-name">Label</span>
        <textarea class="ve-diagram-text" id="label"></textarea>
      </label>
    </div>`);
  const control = (id) =>
    controls.window.getComputedStyle(controls.window.document.getElementById(id));

  check("the flow menu is not capped at a fraction of the bar it sits on",
    control("flow").maxWidth, "none");
  /* Room for the longest thing it can say and the caret beside it. It had
   * neither: the shorthand `background` wiped the caret the rule above draws,
   * and the padding took back the room that caret needs — so the words ran
   * under where it should have been.
   */
  check("...and is wide enough for the longest thing it can say",
    control("flow").minWidth, "9.5rem");
  check("...with the room the caret needs still reserved beside them",
    control("flow").paddingRight, "26px");
  check("...and the caret itself still drawn",
    /linear-gradient/.test(control("flow").backgroundImage), true);
  check("a field in the panel takes the whole line it owns",
    [control("shape").width, control("shape").maxWidth], ["100%", "none"]);
  check("...the one anybody types into included",
    [control("label").width, control("label").maxWidth], ["100%", "none"]);

  /* A table's cells are laid out the way the table is drawn, so the field you
   * type into is in the place on the screen the words will appear in. Which is
   * a grid of as many columns as the table has — a row of fields that wraps
   * where it runs out of room is a row of fields in nobody's column.
   */
  const cells = new JSDOM(`<style>${stylesheet}</style>
    <div class="ve-diagram-cells" id="cells" style="--dd-columns: 3">
      <input class="ve-diagram-cell ve-diagram-cell-title" id="title"/>
      <input class="ve-diagram-cell"/>
    </div>`);
  const laid = (id) => cells.window.getComputedStyle(cells.window.document.getElementById(id));

  check("the cells are laid out as a grid", laid("cells").display, "grid");
  check("...of as many columns as the table has",
    laid("cells").gridTemplateColumns, "repeat(var(--dd-columns, 1), minmax(0, 1fr))");
  check("...with the title spanning the whole of it, the way it is drawn",
    laid("title").gridColumn, "1 / -1");
}
};
