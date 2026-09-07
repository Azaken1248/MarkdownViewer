// Part of the visual-editor suite. See visual.test.js, which loads the modules
// and calls it.
//
// Arrows: round what is in the way, with two ends, in the shape asked for, and
// where they are put.
//
// Everything it needs is handed to it: the suite's own check(), the three
// modules under test, and the fixtures walker. Split out of one file only
// because that file had grown past a thousand lines.
module.exports = (ctx) => {
  const {
    check, DM, DD
  } = ctx;

console.log("=== an arrow goes round what is in its way ===");
{
  // The drawing is the other half of writing the layout down: nothing else on
  // the page knows where these boxes are, so nothing else can draw the lines
  // between them.
  const square = (x, y) => ({ x, y, w: 100, h: 60, kind: "box" });
  const layout = { A: square(0, 0), B: square(0, 300) };

  const straight = DD.routeEdge(layout, { from: "A", to: "B", kind: "arrow", label: "" });
  const corners = (route) => route.points.length;
  const axial = (route) => route.points.every((point, index) => index === 0
    || point[0] === route.points[index - 1][0]
    || point[1] === route.points[index - 1][1]);

  check("an arrow between two boxes in line is a straight line", corners(straight), 2);
  check("...leaving the box it comes from", straight.points[0], [50, 60]);
  check("...and arriving at the one it points to", straight.points[1], [50, 300]);

  // Put something between them and the arrow has to go round it rather than
  // through it.
  const blocked = { ...layout, C: square(0, 140) };
  const around = DD.routeEdge(blocked, { from: "A", to: "B", kind: "arrow", label: "" });
  check("an arrow with a box in its way turns", corners(around) > 2, true);
  check("...and every turn is a right angle", axial(around), true);

  const through = around.points.some((point, index) => index > 0
    && Math.min(around.points[index - 1][0], point[0]) < blocked.C.x + blocked.C.w
    && Math.max(around.points[index - 1][0], point[0]) > blocked.C.x
    && Math.min(around.points[index - 1][1], point[1]) < blocked.C.y + blocked.C.h
    && Math.max(around.points[index - 1][1], point[1]) > blocked.C.y);
  check("...so the box it went round is not crossed", through, false);

  // There and back again is most of what a loop in a flowchart is, and two
  // arrows drawn down the same line are one arrow.
  const spread = DD.lanes([
    { from: "A", to: "B", kind: "arrow", label: "" },
    { from: "B", to: "A", kind: "arrow", label: "" }
  ]);
  check("two arrows between the same boxes get their own lanes", spread[0] !== spread[1], true);
  check("...and one arrow does not need one", DD.lanes([{ from: "A", to: "B" }]), [0]);

  // A box that points at itself has nowhere to route to, so it goes out and
  // comes back.
  const loop = DD.routeEdge(layout, { from: "A", to: "A", kind: "arrow", label: "" });
  check("a box can point at itself", corners(loop) > 2, true);

  // The drawing is written as markup, so anything written in a box is text
  // rather than markup.
  const drawn = DD.render({
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", text: "<script>alert(1)</script>" }],
    edges: [],
    layout: { A: square(0, 0) }
  });
  check("a label is drawn as text, not as markup", drawn.includes("<script>"), false);
  check("...with the characters that made it dangerous still readable",
    drawn.includes("&lt;script&gt;"), true);
  check("a drawing is sized to what is in it", /viewBox="0 0 130 90"/.test(drawn), true);

  /* --- a colour is a classDef, and a classDef is drawn --------------------- */

  const coloured = {
    direction: "TD",
    classes: { hot: { fill: "#fbdedc", stroke: "#c0453c", color: "#4a1512" } },
    nodes: [
      { id: "A", shape: "rect", text: "Hot", classes: ["hot"] },
      { id: "B", shape: "rect", text: "Plain" }
    ],
    edges: [],
    layout: { A: square(0, 0), B: square(200, 0) }
  };

  const painted = DD.render(coloured, { layout: coloured.layout });
  const groupOf = (id) => new RegExp(`<g class="dd-node"[^>]*data-id="${id}"[^>]*>`).exec(painted)[0];

  check("a box wearing a class is drawn in its colours",
    /--dd-fill:#fbdedc;--dd-stroke:#c0453c;--dd-text:#4a1512;/.test(groupOf("A")), true);
  check("...and a box wearing none is left to the theme",
    /style=/.test(groupOf("B")), false);

  // Inline `style A fill:#f00` is about that one box, so it wins over the class.
  const over = DD.render({
    ...coloured,
    nodes: [{ id: "A", shape: "rect", text: "Hot", classes: ["hot"], style: { fill: "#00ff00" } }]
  }, { layout: { A: square(0, 0) } });
  check("a box's own style beats the class it wears",
    /--dd-fill:#00ff00;/.test(over), true);

  /* What arrives is whatever somebody wrote, and it is about to go into a style
   * attribute. A value that is not plainly a colour is dropped rather than
   * escaped-and-hoped-for: there is no legitimate diagram it costs.
   */
  const nasty = DD.render({
    direction: "TD",
    classes: { bad: { fill: "red;} body { display: none } .x {", stroke: "url(#evil)", color: "#0a0a0a" } },
    nodes: [{ id: "A", shape: "rect", text: "x", classes: ["bad"] }],
    edges: [],
    layout: { A: square(0, 0) }
  }, { layout: { A: square(0, 0) } });
  check("a fill that is not a colour is not drawn", /display/.test(nasty), false);
  check("...nor is a stroke that fetches something", /url\(/.test(nasty), false);
  check("...while the colour beside them is kept", /--dd-text:#0a0a0a;/.test(nasty), true);

  check("a colour of every shape is allowed through", [
    DD.paintOf({ style: { fill: "#abc" } }, {}),
    DD.paintOf({ style: { fill: "rebeccapurple" } }, {}),
    DD.paintOf({ style: { fill: "rgba(1, 2, 3, 0.5)" } }, {}),
    DD.paintOf({ style: { "stroke-width": "2px" } }, {}),
    DD.paintOf({ style: { "stroke-dasharray": "6 4" } }, {})
  ], [
    "--dd-fill:#abc;",
    "--dd-fill:rebeccapurple;",
    "--dd-fill:rgba(1, 2, 3, 0.5);",
    "--dd-stroke-width:2px;",
    "--dd-dash:6 4;"
  ]);

  check("...and anything else is not", [
    DD.paintOf({ style: { fill: "expression(alert(1))" } }, {}),
    DD.paintOf({ style: { "stroke-width": "2px;fill:red" } }, {}),
    DD.paintOf({ style: { fill: "" } }, {})
  ], ["", "", ""]);

  /* A document shows its diagrams without an editor anywhere near them, and a
   * colour that only appeared once you opened the editor would be a colour
   * nobody reading the document ever saw.
   */
  const fromFile = DD.renderSource([
    "flowchart TD",
    "    %% layout v1",
    "    %% @ A 40,40 90x50",
    "    classDef hot fill:#fbdedc,stroke:#c0453c",
    "    A[Hot]",
    "    class A hot"
  ].join("\n"));
  check("a diagram read straight from a file is drawn in its colours",
    /--dd-fill:#fbdedc;--dd-stroke:#c0453c;/.test(fromFile), true);

  // The round trip the whole scheme rests on: a colour written as a classDef is
  // a colour the file still has after being read and written again.
  const round = DM.parseFlowchart(DM.serializeFlowchart(coloured));
  check("a classDef survives being written and read back",
    round.classes.hot, coloured.classes.hot);
  check("...and so does the box that wears it", round.nodes[0].classes, ["hot"]);

  /* The canvas has no edges, so a box can be to the left of the origin or above
   * it. A drawing that always began at 0,0 would cut such a box off — which is
   * what made the editor forbid the position in the first place, and what left
   * a diagram unable to be moved into the space beside it.
   */
  const out = DD.render({
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", text: "Out" }],
    edges: [],
    layout: { A: { x: -300, y: -200, w: 80, h: 40 } }
  }, { natural: true });
  const seen = /viewBox="(-?\d+) (-?\d+) (\d+) (\d+)"/.exec(out);
  check("a drawing begins where the diagram does, not at the origin",
    [Number(seen[1]), Number(seen[2])], [-300, -200]);
  check("...and is large enough to hold it", [Number(seen[3]), Number(seen[4])], [110, 70]);

  // The grid is painted onto the paper, and paper that starts at the origin
  // leaves a box out to the left of it on no paper at all.
  const gridded = DD.render({
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", text: "Out" }],
    edges: [],
    layout: { A: { x: -300, y: -200, w: 80, h: 40 } }
  }, { natural: true, grid: true });
  const sheet = /<rect class="dd-paper" x="(-?\d+)" y="(-?\d+)"/.exec(gridded);
  check("...and the paper under it starts there too",
    [Number(sheet[1]), Number(sheet[2])], [-300, -200]);

  const bounds = DM.layoutBounds({ A: { x: 40, y: 40, w: 80, h: 40 } });
  check("a diagram laid out the usual way still starts at the origin",
    [bounds.x, bounds.y], [0, 0]);
  check("...and is the size it always was", [bounds.w, bounds.h], [150, 110]);
}

console.log("=== a line has two ends, and the file says so in real Mermaid ===");
{
  /* Mermaid can spell four endings: nothing, an arrow, a circle, a cross. UML
   * and ERD want five more it has no words for.
   *
   * So the ends are read off the kind — the thing every other renderer acts on
   * — and `ends` in a layout comment is the refinement on top. The kind stays
   * the nearest real link, which is why a triangle-headed line is still an
   * arrow on GitHub rather than nothing at all.
   */
  check("an arrow has a head and no tail", DD.endsOf({ kind: "arrow" }), ["none", "arrow"]);
  check("a plain line has neither", DD.endsOf({ kind: "open" }), ["none", "none"]);
  check("a dotted line has neither either", DD.endsOf({ kind: "dotted-open" }), ["none", "none"]);
  check("a both-ways link has a head at each end", DD.endsOf({ kind: "both" }), ["arrow", "arrow"]);
  check("...however it is drawn", DD.endsOf({ kind: "thick-both" }), ["arrow", "arrow"]);
  check("Mermaid's own circle ending is drawn as one", DD.endsOf({ kind: "circle" }), ["none", "circle"]);
  check("...and so is its cross", DD.endsOf({ kind: "cross" }), ["none", "cross"]);

  check("what the comment says wins over what the kind implies",
    DD.endsOf({ kind: "arrow", ends: ["diamond", "triangle"] }), ["diamond", "triangle"]);
  check("...but a name nothing draws falls back to the kind",
    DD.endsOf({ kind: "arrow", ends: ["nonsense", "alsonot"] }), ["none", "arrow"]);

  // One definition per ending actually used. A diagram of ordinary arrows costs
  // one marker however many arrows are in it.
  const plain = DD.render({
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", text: "A" }, { id: "B", shape: "rect", text: "B" },
      { id: "C", shape: "rect", text: "C" }],
    edges: [{ from: "A", to: "B", kind: "arrow", label: "" },
      { from: "B", to: "C", kind: "arrow", label: "" }],
    layout: { A: { x: 0, y: 0, w: 80, h: 40 }, B: { x: 0, y: 120, w: 80, h: 40 },
      C: { x: 0, y: 240, w: 80, h: 40 } }
  }, { natural: true });
  check("two arrows share one marker", (plain.match(/<marker /g) || []).length, 1);
  check("...which the line points at with its end and not its start",
    /marker-end="url\(#dd-end-arrow-\d+\)"/.test(plain) && !plain.includes("marker-start"), true);

  const uml = DD.render({
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", text: "A" }, { id: "B", shape: "rect", text: "B" }],
    edges: [{ from: "A", to: "B", kind: "arrow", ends: ["diamond", "triangle"], label: "" }],
    layout: { A: { x: 0, y: 0, w: 80, h: 40 }, B: { x: 0, y: 120, w: 80, h: 40 } }
  }, { natural: true });
  check("a line with a shape at each end defines both", (uml.match(/<marker /g) || []).length, 2);
  check("...and points at each from the right end",
    /marker-start="url\(#dd-end-diamond-\d+\)"/.test(uml)
    && /marker-end="url\(#dd-end-triangle-\d+\)"/.test(uml), true);
  check("...and neither of them is an arrow", uml.includes("dd-end-arrow-"), false);
  // A hollow head has to be drawn hollow, or "is a" and "is made of" are the
  // same picture.
  check("a hollow ending is drawn hollow", (uml.match(/dd-head dd-head-hollow/g) || []).length, 2);

  /* Boxes are drawn after arrows, so an arrowhead that reaches the box it
   * points at is an arrowhead with its tip painted over — and a box's border is
   * centred on its edge, so half of it is outside the box doing exactly that.
   * The line stops short instead.
   */
  const meeting = { A: { x: 100, y: 100, w: 80, h: 40 }, B: { x: 100, y: 300, w: 80, h: 40 } };
  const headed = DD.routeEdge(meeting, { from: "A", to: "B", kind: "arrow" }, 0);
  check("a line with a head on it stops short of the box",
    headed.d, "M140,140 L140,298");
  check("...though the route it took still reaches it",
    headed.points[headed.points.length - 1], [140, 300]);
  check("...and the head is anchored at its own far edge, wholly behind that",
    /refX="10"/.test(plain) && !/refX="9"/.test(plain), true);

  // Only where there is something to clear. A plain line held two pixels off
  // the box would be a gap in every diagram, for arrowheads that are not there.
  check("a line with nothing on it still meets the box",
    DD.routeEdge(meeting, { from: "A", to: "B", kind: "open" }, 0).d, "M140,140 L140,300");
  check("a line with a head at each end stops short at each end",
    DD.routeEdge(meeting, { from: "A", to: "B", kind: "both" }, 0).d, "M140,142 L140,298");

  /* Two boxes touching leave the line no length to be shortened by. Taking two
   * pixels off a segment that has none would point the arrow backwards, and off
   * a route that is a single point would be arithmetic on a segment that is not
   * there.
   */
  const touching = { A: { x: 100, y: 100, w: 80, h: 40 }, B: { x: 100, y: 140, w: 80, h: 40 } };
  check("a line with no length at all is left where it is",
    DD.routeEdge(touching, { from: "A", to: "B", kind: "arrow" }, 0).d, "M140,140");
  const hair = { A: { x: 100, y: 100, w: 80, h: 40 }, B: { x: 100, y: 141, w: 80, h: 40 } };
  check("...and so is one with less length than the clearance",
    DD.routeEdge(hair, { from: "A", to: "B", kind: "arrow" }, 0).d, "M140,140 L140,141");

  const shut = DD.render({
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", text: "A" }, { id: "B", shape: "rect", text: "B" }],
    edges: [{ from: "A", to: "B", kind: "open", label: "" }],
    layout: { A: { x: 0, y: 0, w: 80, h: 40 }, B: { x: 0, y: 120, w: 80, h: 40 } }
  }, { natural: true });
  check("a line with nothing on either end defines no markers", shut.includes("<marker "), false);
  check("...and points at none", shut.includes("marker-"), false);

  /* The line style, which is the other half of a link and the half Mermaid can
   * always say.
   */
  check("a dotted kind is drawn dotted", DM.lineStyleOf("dotted-both"), "dotted");
  check("a thick kind is drawn thick", DM.lineStyleOf("thick-open"), "thick");
  check("everything else is a solid line", [DM.lineStyleOf("arrow"), DM.lineStyleOf("circle")],
    ["solid", "solid"]);

  /* And the rule that keeps the file honest: whatever ends are asked for, what
   * is written down is the nearest link Mermaid actually has.
   */
  check("a solid line with an arrow is an arrow", DM.linkFor("solid", ["none", "arrow"]), "arrow");
  check("...with nothing on it, a line", DM.linkFor("solid", ["none", "none"]), "open");
  check("...with heads both ways, a both-ways link", DM.linkFor("solid", ["arrow", "arrow"]), "both");
  check("Mermaid's own circle is used when it fits", DM.linkFor("solid", ["none", "circle"]), "circle");
  check("...and so is its cross", DM.linkFor("solid", ["none", "cross"]), "cross");
  check("a dotted line with a UML triangle is written as a dotted arrow",
    DM.linkFor("dotted", ["none", "triangle"]), "dotted");
  check("a thick line with nothing on it is a thick line",
    DM.linkFor("thick", ["none", "none"]), "thick-open");
  check("anything at the back makes it a both-ways link",
    DM.linkFor("dotted", ["diamond", "crow"]), "dotted-both");
  // Dotted has no circle of its own, so it lands on the nearest thing it does
  // have rather than on nothing.
  check("a style with no circle of its own falls back to its arrow",
    DM.linkFor("dotted", ["none", "circle"]), "dotted");

  // Written to the file and read back: the kind is real Mermaid and the exact
  // ends are beside it, or a saved diagram loses its UML the moment it is
  // reopened.
  const uml2 = {
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", text: "A", label: "A" },
      { id: "B", shape: "rect", text: "B", label: "B" }],
    edges: [{ from: "A", to: "B", kind: "arrow", label: "", ends: ["diamond", "triangle"] }],
    layout: { A: { x: 0, y: 0, w: 80, h: 40 }, B: { x: 0, y: 120, w: 80, h: 40 } }
  };
  const written = DM.serializeFlowchart(uml2);
  check("the file carries a link Mermaid can read", /A\s+-->\s+B/.test(written), true);
  check("...and the exact ends in a comment above it",
    /%% edge 0 [^\n]*ends=diamond,triangle/.test(written), true);
  check("...which come back the same way round",
    DM.parseFlowchart(written).edges[0].ends, ["diamond", "triangle"]);
}

console.log("=== a line is drawn in the shape it is asked for ===");
{
  /* One route, three ways of drawing it. The corners a line turns to get round
   * a box are worked out once; curved is those same corners softened, which is
   * why turning a line curved cannot walk it through anything.
   *
   * Straight is the one that really is a different route, and the one that goes
   * through whatever is in the way — which is what asking for a straight line
   * between two boxes means.
   */
  const bent = { A: { x: 100, y: 100, w: 80, h: 40 }, B: { x: 300, y: 300, w: 80, h: 40 } };
  const angled = DD.routeEdge(bent, { from: "A", to: "B", kind: "arrow" }, 0);
  check("a line with nothing said about it is angled, as it always was",
    angled.d, "M140,140 L140,220 L340,220 L340,298");
  check("...and saying so outright changes nothing",
    DD.routeEdge(bent, { from: "A", to: "B", kind: "arrow", route: "angled" }, 0).d, angled.d);
  check("...and so does asking for a shape there is no such thing as",
    DD.routeEdge(bent, { from: "A", to: "B", kind: "arrow", route: "swooshy" }, 0).d, angled.d);

  const curved = DD.routeEdge(bent, { from: "A", to: "B", kind: "arrow", route: "curved" }, 0);
  check("curved turns each corner into a curve",
    curved.d, "M140,140 L140,208 Q140,220 152,220 L328,220 Q340,220 340,232 L340,298");
  check("...and starts and ends exactly where the angled one did",
    [curved.d.startsWith("M140,140"), curved.d.endsWith("L340,298")], [true, true]);
  check("...and goes through the same corners", curved.points, angled.points);

  const straight = DD.routeEdge(bent, { from: "A", to: "B", kind: "arrow", route: "straight" }, 0);
  check("straight is one segment", (straight.d.match(/[LQ]/g) || []).length, 1);
  check("...leaving each box where the line between them meets it",
    straight.d, "M160,140 L318.6,298.6");

  const square = { A: { x: 0, y: 0, w: 80, h: 40 }, B: { x: 0, y: 200, w: 80, h: 40 } };
  check("a curved line with no corners in it is the line",
    DD.routeEdge(square, { from: "A", to: "B", kind: "arrow", route: "curved" }, 0).d,
    "M40,40 L40,198");

  // And two boxes touching leave a route that is one point, which is not a line
  // and must not be drawn as one going nowhere.
  const met = { A: { x: 0, y: 0, w: 80, h: 40 }, B: { x: 0, y: 40, w: 80, h: 40 } };
  check("a curved line with no length at all is a point",
    DD.routeEdge(met, { from: "A", to: "B", kind: "arrow", route: "curved" }, 0).d, "M40,40");

  /* The corner itself, on points rather than through a route, because the two
   * ways of getting it wrong are both about the arms either side of it and a
   * route long enough to be worth drawing has arms long enough to hide both.
   *
   * Never more than half of either arm: a corner rounded past the middle of its
   * own arm eats into the corner next to it and the line doubles back on
   * itself.
   */
  check("a corner between short arms is rounded by what the arms allow",
    DD.pathCurved([[0, 0], [10, 0], [10, 10]]), "M0,0 L5,0 Q10,0 10,5 L10,10");
  check("...and one between long arms by as much as a corner ever is",
    DD.pathCurved([[0, 0], [100, 0], [100, 100]]),
    "M0,0 L88,0 Q100,0 100,12 L100,100");

  // A corner with no length on one side of it is not a corner, and rounding it
  // would be a division by nothing — which reaches the file as the word NaN.
  check("a corner with no arm to it is left as a corner",
    DD.pathCurved([[0, 0], [0, 0], [0, 40]]), "M0,0 L0,0 L0,40");
  check("...rather than drawn as arithmetic that did not work",
    /NaN/.test(DD.pathCurved([[0, 0], [0, 0], [0, 40]])), false);

  // Two lines between the same two boxes have to leave from two places or they
  // are one line, the same as the angled router already does with its lanes.
  const lane = DD.routeEdge(bent, { from: "A", to: "B", kind: "arrow", route: "straight" }, 16);
  check("a second straight line between the same two boxes is beside the first",
    lane.d === straight.d, false);

  /* The file. The shape is nobody else's business, so it goes in the layout
   * comment — and the default is left off it, or every arrow in every diagram
   * would grow a line saying it is drawn the way it has always been drawn.
   */
  const written = DM.serializeFlowchart(DM.parseFlowchart([
    "flowchart TD",
    "    %% layout v1",
    "    %% @ A 0,0 80x40",
    "    %% @ B 0,200 80x40",
    "    %% edge 0 route=curved",
    "    A[a]",
    "    B[b]",
    "    A --> B"
  ].join("\n") + "\n"));
  check("a shape survives being written and read back",
    /%% edge 0 route=curved/.test(written), true);

  const plainly = DM.parseFlowchart(written);
  plainly.edges[0].route = "angled";
  check("...and the one everything already is, is not written at all",
    /%% edge 0/.test(DM.serializeFlowchart(plainly)), false);

  // Not even on a line that has a comment anyway for some other reason, or
  // every arrow that ends in a triangle also says how it is drawn.
  plainly.edges[0].ends = ["none", "triangle"];
  const alongside = DM.serializeFlowchart(plainly);
  check("...nor beside something else that did need writing down",
    [/ends=none,triangle/.test(alongside), /route=/.test(alongside)], [true, false]);

  const nonsense = DM.parseFlowchart([
    "flowchart TD",
    "    %% layout v1",
    "    %% @ A 0,0 80x40",
    "    %% @ B 0,200 80x40",
    "    %% edge 0 route=swooshy",
    "    A[a]",
    "    B[b]",
    "    A --> B"
  ].join("\n") + "\n");
  check("a shape nothing can draw is not drawn", DD.shapeOf({ route: "swooshy" }), "angled");
  check("...and an edge with nothing said about it is angled too",
    [DD.shapeOf({}), DD.shapeOf()], ["angled", "angled"]);
  check("...nor is it read out of a file as one", nonsense.edges[0].route, undefined);
  // Dropped rather than carried, the same as a malformed side or ending: this
  // is a value of a thing the editor owns, not a thing it has no controls for.
  check("...and the line is drawn the way everything else is",
    DD.shapeOf(nonsense.edges[0]), "angled");
}

console.log("=== a line goes where it is put, when it is put anywhere ===");
{
  const apart = { A: { x: 100, y: 100, w: 80, h: 40 }, B: { x: 300, y: 300, w: 80, h: 40 } };
  const line = (edge) => DD.routeEdge(apart, { from: "A", to: "B", kind: "arrow", ...edge }, 0).d;

  check("an arrow nobody has touched is still the router's business",
    line({}), "M140,140 L140,220 L340,220 L340,298");

  /* Pinned. The auto-router is good at the ordinary case and has nothing to
   * offer once somebody has said where the line should go, so it steps aside:
   * squarely, and without trying to dodge anything. Dodging is what it is for,
   * and a line placed by hand is already where it is wanted.
   */
  check("an end pinned to a side leaves from that side",
    line({ sides: ["r", "t"] }), "M180,120 L340,120 L340,298");
  check("...and the other end pinned too", line({ sides: ["b", "l"] }),
    "M140,140 L140,320 L298,320");
  check("one end pinned leaves the other to the router",
    line({ sides: ["a", "l"] }), "M140,140 L140,320 L298,320");
  check("...and both left to it is the route it would have chosen anyway",
    line({ sides: ["a", "a"] }), line({}));
  /* Judged on two boxes side by side, where the router's own answer is "right"
   * and a name nothing recognises would come out "bottom": on two boxes one
   * above the other the two agree, and a check both answers pass is not one.
   */
  const beside = { A: { x: 0, y: 0, w: 80, h: 40 }, B: { x: 300, y: 0, w: 80, h: 40 } };
  const sideways = (edge) =>
    DD.routeEdge(beside, { from: "A", to: "B", kind: "arrow", ...edge }, 0).d;
  check("a side that is not a side is left to the router",
    sideways({ sides: ["nonsense", "l"] }), sideways({ sides: ["a", "l"] }));
  check("...which is not the same as being pinned to the bottom",
    sideways({ sides: ["b", "l"] }) === sideways({ sides: ["a", "l"] }), false);

  // Which side the router would have used, on its own, because an edge with one
  // end pinned still has to put the other somewhere sensible.
  check("the router's own answer for two boxes side by side",
    DD.autoSides({ x: 0, y: 0, w: 80, h: 40 }, { x: 200, y: 0, w: 80, h: 40 }), ["r", "l"]);
  check("...and for one above the other",
    DD.autoSides({ x: 0, y: 0, w: 80, h: 40 }, { x: 0, y: 200, w: 80, h: 40 }), ["b", "t"]);
  check("...and backwards", DD.autoSides({ x: 200, y: 0, w: 80, h: 40 },
    { x: 0, y: 0, w: 80, h: 40 }), ["l", "r"]);

  check("a side is a point on that side of the box",
    [DD.anchorOn({ x: 0, y: 0, w: 80, h: 40 }, "l", 0),
      DD.anchorOn({ x: 0, y: 0, w: 80, h: 40 }, "r", 0),
      DD.anchorOn({ x: 0, y: 0, w: 80, h: 40 }, "t", 0),
      DD.anchorOn({ x: 0, y: 0, w: 80, h: 40 }, "b", 0)],
    [[0, 20], [80, 20], [40, 0], [40, 40]]);
  // Two arrows between the same two boxes get two lanes, pinned or not.
  check("...offset along it by the lane, so two arrows are two lines",
    DD.anchorOn({ x: 0, y: 0, w: 80, h: 40 }, "t", 16), [56, 0]);
  // And never off the end of the side it is on.
  check("...but never off the end of it",
    DD.anchorOn({ x: 0, y: 0, w: 80, h: 40 }, "t", 500), [72, 0]);

  /* Corners. The line passes through them in the order they are given, which is
   * the whole of what a waypoint is.
   */
  check("a corner put in the line is a corner the line turns",
    line({ waypoints: [{ x: 60, y: 150 }] }),
    "M100,120 L82,120 L82,150 L60,150 L340,150 L340,298");
  check("...and two are turned in the order they are in",
    line({ waypoints: [{ x: 60, y: 150 }, { x: 60, y: 400 }] }),
    "M100,120 L82,120 L82,150 L60,150 L60,400 L60,320 L298,320");

  /* An end nobody pinned faces whatever the line goes to next, and once there
   * are corners in it that is the first corner rather than the other box. A
   * line dragged out to the left that still left on the right would double back
   * across the box it came from to get where it was sent.
   */
  check("a line dragged to the left leaves on the left",
    line({ waypoints: [{ x: 60, y: 150 }] }).startsWith("M100,120"), true);
  check("...and one dragged to the right leaves on the right",
    line({ waypoints: [{ x: 500, y: 200 }] }).startsWith("M180,120"), true);
  check("...unless it was pinned, in which case it was told",
    line({ sides: ["r", "a"], waypoints: [{ x: 60, y: 150 }] }).startsWith("M180,120"), true);

  const small = { x: 0, y: 0, w: 80, h: 40 };
  check("which side of a box faces a point",
    [DD.sideTowards(small, [200, 0]), DD.sideTowards(small, [0, 200]),
      DD.sideTowards(small, [-200, 0]), DD.sideTowards(small, [0, -200])],
    ["r", "b", "l", "t"]);
  // Measured against the box's own shape, or a box twice as wide as it is tall
  // answers left or right to very nearly everything.
  check("...judged by the shape of the box, not in plain pixels",
    DD.sideTowards(small, [60, 45]), "b");
  check("a corner that is not a point is not a corner",
    line({ waypoints: [{ x: "over there", y: null }] }), line({}));

  check("the model's corners are read as points to do arithmetic with",
    DD.wayPoints({ waypoints: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }), [[1, 2], [3, 4]]);
  check("...and an edge with none has none",
    [DD.wayPoints({}), DD.wayPoints()], [[], []]);

  check("what is pinned, read off an edge",
    [DD.pinnedSides({ sides: ["r", "a"] }), DD.pinnedSides({}), DD.pinnedSides()],
    [["r", null], [null, null], [null, null]]);

  /* Straight has no corners to put anywhere, so it does the same two things its
   * own way: legs through each point, and leaving from the middle of a side it
   * has been pinned to.
   */
  check("a straight line through a corner is two straight legs",
    line({ route: "straight", waypoints: [{ x: 250, y: 150 }] }),
    "M180,130.9 L250,150 L328.5,298.2");
  check("...and pinned, it leaves from the side it was pinned to",
    line({ route: "straight", sides: ["r", "t"] }), "M180,120 L338.7,298.5");
  check("...and untouched it is the line between the two boxes",
    line({ route: "straight" }), "M160,140 L318.6,298.6");

  // Curved is the same route with its corners softened, corners somebody put
  // there included.
  const bent = line({ route: "curved", waypoints: [{ x: 60, y: 150 }, { x: 60, y: 400 }] });
  check("a curved line through corners curves at them",
    (bent.match(/Q/g) || []).length, 5);
  check("...and still turns where it was told to",
    [bent.includes("60,161"), bent.includes("60,388")], [true, true]);

  /* The file. Both are ours, so both go in the layout comment — and an arrow
   * with neither still says nothing at all.
   */
  const kept = DM.serializeFlowchart(DM.parseFlowchart([
    "flowchart TD",
    "    %% layout v1",
    "    %% @ A 0,0 80x40",
    "    %% @ B 0,200 80x40",
    "    %% edge 0 sides=a,t via=60,150;60,400",
    "    A[a]",
    "    B[b]",
    "    A --> B"
  ].join("\n") + "\n"));
  check("a pinned end and its corners survive being written and read back",
    /%% edge 0 sides=a,t via=60,150;60,400/.test(kept), true);

  const loose = DM.parseFlowchart(kept);
  loose.edges[0].sides = ["a", "a"];
  delete loose.edges[0].waypoints;
  check("...and an arrow with neither says nothing at all",
    /%% edge 0/.test(DM.serializeFlowchart(loose)), false);

  const half = DM.parseFlowchart(kept);
  half.edges[0].waypoints = [];
  delete half.edges[0].sides;
  check("...nor does one whose corners have all been taken out",
    /%% edge 0/.test(DM.serializeFlowchart(half)), false);
}

};
