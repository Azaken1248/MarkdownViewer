// Part of the visual-editor suite. See visual.test.js, which loads the modules
// and calls it.
//
// A flowchart as a model: what it can say, where its boxes go, and finding one
// again after the document moved under it.
//
// Everything it needs is handed to it: the suite's own check(), the three
// modules under test, and the fixtures walker. Split out of one file only
// because that file had grown past a thousand lines.
module.exports = (ctx) => {
  const {
    check, VE, DM, DD, JSDOM
  } = ctx;

console.log("=== a diagram says more than boxes and arrows ===");
{
  /* Everything here is real Mermaid, and that is the whole point of reading it.
   * A colour written as a classDef is a colour every other renderer can see; a
   * group written as a subgraph is a group GitHub draws. Only what Mermaid
   * cannot say at all — where a box is, what icon is on it — goes in comments.
   */

  // --- groups ---------------------------------------------------------------
  const grouped = DM.parseFlowchart([
    "flowchart LR",
    "  subgraph Backend [\"The back end\"]",
    "    direction TB",
    "    A[Postgres]",
    "    subgraph Inner",
    "      B[Cache]",
    "    end",
    "  end",
    "  C[Client]",
    "  C --> A"
  ].join("\n"));

  check("a subgraph is a group", grouped.ok && grouped.groups.map((g) => g.id), ["Backend", "Inner"]);
  check("...with the label it was given", grouped.groups[0].label, "The back end");
  check("...and one that names itself when it was given none", grouped.groups[1].label, "Inner");
  check("...nested where it was nested", grouped.groups[1].parent, "Backend");
  check("...keeping the direction it asked for", grouped.groups[0].direction, "TB");
  check("a box inside one belongs to it",
    grouped.nodes.map((node) => [node.id, node.parent || null]),
    [["C", null], ["A", "Backend"], ["B", "Inner"]]);

  // Mermaid lets a subgraph be nothing but a title, and invents an id for it.
  // So does this — and it writes that id into the file, so the group keeps the
  // same name from then on rather than being renamed on every save.
  const titled = DM.parseFlowchart([
    "flowchart TD",
    "  subgraph \"Query phase (60 fps)\"",
    "    A --> B",
    "  end"
  ].join("\n"));

  // Two of them in one diagram are two different groups, and two groups with
  // one name between them is a diagram that loses one of them on the next save.
  const twoTitles = DM.parseFlowchart([
    "flowchart TD",
    "  subgraph \"First\"",
    "    A[One]",
    "  end",
    "  subgraph \"Second\"",
    "    B[Two]",
    "  end"
  ].join("\n"));
  check("two subgraphs that are only titles get a name each",
    twoTitles.ok && twoTitles.groups.map((group) => group.id), ["group1", "group2"]);
  check("...and each keeps the boxes that were inside it",
    twoTitles.nodes.map((node) => [node.id, node.parent]), [["A", "group1"], ["B", "group2"]]);

  check("a subgraph that is only a title still opens", titled.ok, true);
  check("...with a name nothing else is using", titled.groups[0].id, "group1");
  check("...and the title as its label", titled.groups[0].label, "Query phase (60 fps)");
  check("...written into the file so it stays that way",
    DM.serializeFlowchart(titled).includes("subgraph group1 [\"Query phase (60 fps)\"]"), true);

  /* Whether a group is locked is about editing it rather than about drawing it,
   * so it rides in a comment beside the subgraph and every other renderer is
   * right to ignore it. There is no position and no size to write down — the
   * frame is worked out from what is in it — so this is the whole of what a
   * group has to say for itself.
   */
  const locked = DM.parseFlowchart([
    "flowchart TD",
    "  %% layout v1",
    "  %% group shut lock=1",
    "  subgraph shut [\"Shut\"]",
    "    A[One]",
    "  end",
    "  B[Two]"
  ].join("\n"));

  check("a group can be locked", locked.ok && locked.groups[0].lock, true);
  check("...and the one that is not says nothing about it",
    "lock" in DM.parseFlowchart("flowchart TD\n  subgraph open\n    A[One]\n  end").groups[0],
    false);
  check("...written back beside the subgraph rather than inside it",
    DM.serializeFlowchart(locked).includes("%% group shut lock=1"), true);
  check("...leaving the subgraph itself ordinary Mermaid",
    DM.serializeFlowchart(locked).includes("subgraph shut [Shut]"), true);

  const unlocked = DM.parseFlowchart(DM.serializeFlowchart(locked));
  delete unlocked.groups[0].lock;
  check("...and a group nobody locked writes no line at all",
    DM.serializeFlowchart(unlocked).includes("%% group"), false);

  /* A group's frame is worked out from what is in it, every time it is drawn.
   *
   * Which is the answer to padding that creeps: there is no rectangle stored
   * anywhere for a second helping of padding to be added to. Drawing the same
   * model twice gives the same frame, and drawing it after a box has moved
   * gives a frame that has moved with it and is no bigger than it was.
   */
  const nested = DM.parseFlowchart([
    "flowchart TD",
    "  %% layout v1",
    "  %% @ A 100,100 100x40",
    "  %% @ B 100,200 100x40",
    "  %% @ C 400,100 100x40",
    "  subgraph outer [\"Outer\"]",
    "    A[One]",
    "    subgraph inner [\"In\"]",
    "      B[Two]",
    "    end",
    "  end",
    "  C[Three]"
  ].join("\n"));

  const framesOf = (model) => DD.groupBoxes(model, DM.ensureLayout(model));
  const frames = framesOf(nested);

  check("a group's frame goes round what is in it",
    [frames.inner.x, frames.inner.y, frames.inner.w, frames.inner.h],
    [100 - DD.GROUP_PAD, 200 - DD.GROUP_PAD - DD.GROUP_HEAD,
      100 + (DD.GROUP_PAD * 2), 40 + (DD.GROUP_PAD * 2) + DD.GROUP_HEAD]);
  check("...and a group holding a group goes round the inner frame, not its boxes",
    [frames.outer.x, frames.outer.y], [frames.inner.x - DD.GROUP_PAD,
      100 - DD.GROUP_PAD - DD.GROUP_HEAD]);
  check("...reaching to the bottom of what is inside it",
    frames.outer.y + frames.outer.h, frames.inner.y + frames.inner.h + DD.GROUP_PAD);
  check("...and leaving out the box that is in neither", frames.outer.x + frames.outer.w < 400, true);
  check("a box in no group has no frame of its own", Object.keys(frames).sort(), ["inner", "outer"]);

  // Drawn twice, the same. This is the check that would catch a frame kept in
  // the model and topped up with padding on every pass.
  check("...and the same frame however many times it is worked out",
    JSON.stringify(framesOf(nested)), JSON.stringify(frames));

  const moved = DM.parseFlowchart(DM.serializeFlowchart(nested));
  moved.layout.B.y = 300;
  const after = framesOf(moved);
  check("a box moved inside a group takes the frame with it",
    after.inner.h - frames.inner.h, 0);
  check("...and the group above it grows to hold it",
    after.outer.h - frames.outer.h, 100);

  // A name wider than the boxes under it widens the frame rather than hanging
  // out of the side of it.
  const longName = DM.parseFlowchart([
    "flowchart TD",
    "  %% layout v1",
    "  %% @ A 100,100 40x40",
    "  subgraph wordy [\"A name considerably wider than the box beneath it\"]",
    "    A[x]",
    "  end"
  ].join("\n"));
  check("a frame is at least as wide as the name on it",
    framesOf(longName).wordy.w > 40 + (DD.GROUP_PAD * 2), true);

  // A group nothing is in encloses nothing, so there is nothing to draw.
  const emptied = DM.parseFlowchart(DM.serializeFlowchart(nested));
  emptied.nodes = emptied.nodes.filter((node) => node.id !== "B");
  delete emptied.layout.B;
  check("a group with nothing in it gets no frame",
    Object.keys(framesOf(emptied)).sort(), ["outer"]);

  // A group that is its own ancestor cannot be drawn sensibly, but a page that
  // opened one must not hang working that out.
  const eating = { nodes: [], groups: [{ id: "a", parent: "b" }, { id: "b", parent: "a" }] };
  check("a group inside itself is measured without hanging",
    Object.keys(DD.groupBoxes(eating, {})), []);

  // --- colours --------------------------------------------------------------
  const coloured = DM.parseFlowchart([
    "flowchart TD",
    "  A[One]:::blue",
    "  B[Two]",
    "  A --> B",
    "  classDef blue fill:#2b6cb0,stroke:#1a365d",
    "  classDef bold stroke-width:3px",
    "  class B blue",
    "  class A bold",
    "  style B fill:#eee"
  ].join("\n"));

  check("a classDef is a colour", coloured.ok && coloured.classes.blue,
    { fill: "#2b6cb0", stroke: "#1a365d" });
  check("...and a box can wear more than one", coloured.nodes[0].classes, ["blue", "bold"]);
  check("...whether it was written inline or as a statement",
    coloured.nodes[1].classes, ["blue"]);
  check("a style is a colour on one box", coloured.nodes[1].style, { fill: "#eee" });

  // Two styles on one box are two halves of one look, not one replacing the
  // other — which is what Mermaid draws, and what anyone writing the second
  // line meant by writing it.
  const twice = DM.parseFlowchart([
    "flowchart TD",
    "  A[One]",
    "  style A fill:#eee",
    "  style A stroke:#333,stroke-width:2px"
  ].join("\n"));
  check("a second style on a box adds to the first",
    twice.ok && twice.nodes[0].style,
    { fill: "#eee", stroke: "#333", "stroke-width": "2px" });

  // The order a box's classes arrive in is the order they happen to be written
  // in, which is not the order they will be written back in: the file groups
  // them by class. So they are put into the file's order while they are read,
  // and the box that arrives wearing them backwards still comes back the same.
  const backwards = DM.parseFlowchart([
    "flowchart TD",
    "  A[One]:::bold",
    "  classDef blue fill:#2b6cb0",
    "  classDef bold stroke-width:3px",
    "  class A blue"
  ].join("\n"));
  check("the classes on a box are in the order the file will list them",
    backwards.ok && backwards.nodes[0].classes, ["blue", "bold"]);
  check("...so a box wearing them backwards still survives the round trip",
    JSON.stringify(DM.parseFlowchart(DM.serializeFlowchart(backwards))),
    JSON.stringify(backwards));

  // --- links ----------------------------------------------------------------
  const links = DM.parseFlowchart("flowchart TD\n  A <--> B\n  B <-.-> C\n  C --o D\n  D --x E\n");
  check("an arrow can point both ways",
    links.ok && links.edges.map((edge) => edge.kind),
    ["both", "dotted-both", "circle", "cross"]);

  // "A & B --> C & D" is four arrows. It is read as four and written back as
  // four, which draws identically — the shorthand is a spelling.
  const fanned = DM.parseFlowchart("flowchart TD\n  A & B --> C & D\n");
  check("a fan-out is every left to every right",
    fanned.ok && fanned.edges.map((edge) => `${edge.from}${edge.to}`),
    ["AC", "AD", "BC", "BD"]);

  // --- what Mermaid cannot say ---------------------------------------------
  const rich = [
    "flowchart TD",
    "    %% layout v1",
    "    %% @ A 40,40 160x56 kind=table icon=lucide:database layer=2 z=3",
    "    %% @ B 240,40 160x56 image=/assets/ab12cd.png",
    "    %% edge 0 sides=r,l via=210,68;210,120 ends=none,crow",
    "    %% layer 2 \"Back end\" locked hidden",
    "    A[\"Thing<br/>field: type\"]",
    "    B[Picture]",
    "    A --> B"
  ].join("\n");

  const model = DM.parseFlowchart(rich);
  check("a box can be a table, and says so on its own line", model.ok && model.nodes[0].kind, "table");
  check("...carry an icon", model.nodes[0].icon, "lucide:database");
  check("...belong to a layer, at a depth", [model.nodes[0].layer, model.nodes[0].z], [2, 3]);
  check("...and be a picture", model.nodes[1].image, "/assets/ab12cd.png");
  check("an arrow can leave and arrive by a named side", model.edges[0].sides, ["r", "l"]);
  check("...bend where it was bent",
    model.edges[0].waypoints, [{ x: 210, y: 68 }, { x: 210, y: 120 }]);
  check("...and end in something Mermaid has no spelling for", model.edges[0].ends, ["none", "crow"]);
  check("a layer has a name, and can be locked or hidden",
    model.layers, [{ id: 2, name: "Back end", locked: true, hidden: true }]);

  // The first version of the layout line put `table` on the end as a bare word.
  // Those files are out there, and they still open.
  const older = DM.parseFlowchart([
    "flowchart TD", "    %% layout v1", "    %% @ A 40,40 160x56 table", "    A[Rows]"
  ].join("\n"));
  check("a layout line from the first version of the format still reads",
    older.ok && older.nodes[0].kind, "table");

  // An editor that meets a key it has never heard of must not eat it: a diagram
  // written by a newer version and opened by an older one has to come back
  // whole, and the only way to promise that is never to throw anything away.
  const future = DM.parseFlowchart([
    "flowchart TD",
    "    %% layout v1",
    "    %% @ A 40,40 160x56 shadow=soft corner=\"top left\"",
    "    %% edge 0 curve=bezier",
    "    A[One]",
    "    B[Two]",
    "    A --> B"
  ].join("\n"));

  check("a key this version has never heard of is kept",
    future.ok && future.nodes[0].extra, { shadow: "soft", corner: "top left" });
  check("...on arrows too", future.edges[0].extra, { curve: "bezier" });
  check("...and written back exactly as it was found",
    DM.serializeFlowchart(future).includes("shadow=soft corner=\"top left\""), true);

  // An editor that takes a group apart can leave a box pointing at a group that
  // is no longer there. Whatever else that costs, it must not cost the box: a
  // file that has quietly lost one is worse than a box that has lost its group.
  const orphaned = DM.serializeFlowchart({
    direction: "TD",
    nodes: [
      { id: "A", shape: "rect", text: "Kept", parent: "Gone" },
      { id: "B", shape: "rect", text: "Here", parent: "Real" }
    ],
    edges: [],
    groups: [{ id: "Real", label: "Real", parent: "Gone" }]
  });
  check("a box in a group that is not there is still written down",
    /^\s+A\[Kept\]$/m.test(orphaned), true);
  check("...and so is a group whose own group is not there",
    orphaned.includes("subgraph Real"), true);
  check("...and reading it back finds both boxes",
    DM.parseFlowchart(orphaned).nodes.map((node) => node.id), ["A", "B"]);

  // A group inside itself is nowhere in the tree, so a walk of the tree never
  // arrives at it or at anything in it. Nobody can draw that diagram, but they
  // can open it and put it right — as long as the boxes are still in the file.
  const looped = DM.serializeFlowchart({
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", text: "Inside", parent: "Loop" }],
    edges: [],
    groups: [{ id: "Loop", label: "Loop", parent: "Loop" }]
  });
  check("a box in a group that contains itself is still written down",
    DM.parseFlowchart(looped).nodes.map((node) => node.id), ["A"]);

  // --- and all of it, twice --------------------------------------------------
  for (const [label, source] of Object.entries({
    "a grouped diagram": grouped,
    "a coloured one": coloured,
    "one with both-ways arrows": links,
    "a fanned-out one": fanned,
    "one carrying everything Mermaid cannot say": model,
    "one written by a later version": future
  })) {
    const back = DM.parseFlowchart(DM.serializeFlowchart(source));
    check(`${label} survives the round trip`, JSON.stringify(back), JSON.stringify(source));
  }

  // What comes out is a flowchart, not a flowchart with our things bolted on.
  const written = DM.serializeFlowchart(model);
  check("what is written is still a diagram Mermaid reads",
    /^flowchart TD\n(?:\s*%%.*\n)+\s+A\[/.test(written), true);
  check("...with every one of our lines a comment",
    written.split("\n").filter((line) => /^\s*%%/.test(line)).length, 5);
}

console.log("=== finding a diagram again after the document moved under it ===");
{
  /* A diagram is edited on a page of its own, and the way back to the block it
   * came from is a line in the address bar. A block index alone will not do it:
   * insert a paragraph above while the editor is open and the index now points
   * at something else, and saving would write the diagram over a block nobody
   * touched. So the address carries the index and a hash of what was in the
   * fence, and the index is only believed while the hash still agrees.
   */
  const doc = [
    "# Title",
    "",
    "```mermaid",
    "flowchart TD",
    "  A --> B",
    "```",
    "",
    "Some prose.",
    "",
    "```mermaid",
    "flowchart LR",
    "  C --> D",
    "```",
    "",
    "```js",
    "notADiagram();",
    "```",
    ""
  ].join("\n");

  const found = VE.diagramFences(doc);
  check("every diagram in a document, and only the diagrams",
    found.map((one) => one.body.split("\n")[0]), ["flowchart TD", "flowchart LR"]);
  check("...each one saying where in the document it is",
    found.map((one) => one.index), [2, 6]);

  const second = VE.diagramAddress(found[1]);
  check("an address is the index and what was in the fence", /^6-[0-9a-z]+$/.test(second), true);

  check("the address finds the diagram it was made from",
    VE.findDiagram(doc, second).body, "flowchart LR\n  C --> D");

  // The dangerous case, and the reason the hash is there at all.
  const shifted = doc.replace("Some prose.\n", "Some prose.\n\nAnd more of it.\n");
  check("...and still finds it after something was inserted above it",
    VE.findDiagram(shifted, second).body, "flowchart LR\n  C --> D");
  check("...at its new index rather than its old one",
    VE.findDiagram(shifted, second).index, 8);

  // Two diagrams that happen to say the same thing are the same diagram as far
  // as a hash can tell, so the index has to break the tie.
  const twins = "```mermaid\nflowchart TD\n  A --> B\n```\n\n```mermaid\nflowchart TD\n  A --> B\n```\n";
  const both = VE.diagramFences(twins);
  check("two diagrams that say the same thing still have different addresses",
    VE.diagramAddress(both[0]) !== VE.diagramAddress(both[1]), true);
  check("...and each address finds its own",
    [VE.findDiagram(twins, VE.diagramAddress(both[0])).index,
      VE.findDiagram(twins, VE.diagramAddress(both[1])).index], [0, 2]);

  // A block that has been edited to something else is not the block that was
  // opened, and writing over it would be the exact accident this prevents.
  const gone = doc.replace("flowchart LR\n  C --> D", "flowchart LR\n  C --> Z");
  check("a diagram that has been changed underneath is not found",
    VE.findDiagram(gone, second), null);
  check("...and a document it is not in cannot be written to",
    VE.replaceDiagram(gone, second, "flowchart TD\n  X --> Y"), null);
  check("...nor can one whose block was deleted",
    VE.replaceDiagram("# Title\n", second, "flowchart TD\n  X --> Y"), null);
  check("a malformed address finds nothing", VE.findDiagram(doc, "not-an-address"), null);

  // And the whole point: one block changes and the document is otherwise the
  // document, byte for byte.
  const written = VE.replaceDiagram(doc, second, "flowchart LR\n  C --> E");
  check("writing one diagram back changes that diagram",
    VE.findDiagram(written, VE.diagramAddress(VE.diagramFences(written)[1])).body,
    "flowchart LR\n  C --> E");
  check("...and nothing else in the document",
    written.replace("C --> E", "C --> D"), doc);

  // The fence's own shape is not the diagram's business either: a tilde fence
  // with an info string comes back a tilde fence with an info string.
  const tilded = "~~~~mermaid render\nflowchart TD\n  A --> B\n~~~~\n";
  const address = VE.diagramAddress(VE.diagramFences(tilded)[0]);
  check("a diagram keeps the fence it was written in",
    VE.replaceDiagram(tilded, address, "flowchart TD\n  A --> C"),
    "~~~~mermaid render\nflowchart TD\n  A --> C\n~~~~\n");
}

console.log("=== a diagram can say where its own boxes go ===");
{
  /* Mermaid has no coordinates in it, and every Mermaid parser throws comments
   * away. So the arrangement lives in comments: still a flowchart everywhere
   * else, drawn where it was left here.
   */
  const arranged = [
    "flowchart TD",
    "    %% layout v1",
    "    %% @ A 40,40 160x56",
    "    %% @ B 40,220 200x90 table",
    "    A[Start]",
    "    B[\"Person<br/>name: string\"]",
    "    A --> B"
  ].join("\n");

  const model = DM.parseFlowchart(arranged);
  check("a laid-out diagram still reads as a diagram", model.ok, true);
  check("...with the boxes it always had", model.nodes.map((node) => node.id), ["A", "B"]);
  check("...and where each of them is",
    model.layout.A, { x: 40, y: 40, w: 160, h: 56 });
  check("...while what each of them is belongs to the box, not to the place",
    model.nodes.find((node) => node.id === "B").kind, "table");
  check("a diagram nobody has arranged says so by having no layout at all",
    Object.prototype.hasOwnProperty.call(DM.parseFlowchart("flowchart TD\n  A --> B\n"), "layout"), false);
  check("...and is told apart without being parsed", DM.hasLayout(arranged), true);
  check("...from one that has not been", DM.hasLayout("flowchart TD\n  A --> B\n"), false);

  // Everything else beginning with %% is still refused, because keeping a
  // comment we do not understand means writing it back somewhere and there is
  // no somewhere.
  check("a comment that is not ours is still refused",
    DM.parseFlowchart("flowchart TD\n  %% a note\n  A --> B\n").ok, false);
  check("...including an init directive",
    DM.parseFlowchart("flowchart TD\n  %%{init: {'theme':'dark'}}%%\n  A --> B\n").ok, false);
  check("...and a position with no header above it",
    DM.parseFlowchart("flowchart TD\n  %% @ A 10,10 90x50\n  A --> B\n").ok, false);

  // A position for a box that is not in the diagram is a position for nothing.
  const stray = DM.parseFlowchart([
    "flowchart TD",
    "    %% layout v1",
    "    %% @ A 40,40 160x56",
    "    %% @ ghost 10,10 90x50",
    "    A[Start]"
  ].join("\n"));
  check("a position for a box that is not there is dropped",
    Object.keys(stray.layout), ["A"]);

  // The identity that matters, extended: what comes back out has to be what
  // went in, positions included, or dragging one box moves another.
  const trips = [
    arranged,
    "flowchart LR\n    %% layout v1\n    %% @ A -20,0 90x50\n    A[Only]",
    "flowchart TD\n    %% layout v1\n    A[No positions yet]"
  ];

  for (const source of trips) {
    const first = DM.parseFlowchart(source);
    const back = DM.parseFlowchart(DM.serializeFlowchart(first));
    check(`a laid-out diagram survives the round trip: ${source.split("\n")[0]} (${Object.keys(first.layout).length} placed)`,
      JSON.stringify(back), JSON.stringify(first));
  }

  // The format has no room for half a pixel, and half a pixel is not a
  // position anybody chose.
  const rounded = DM.serializeFlowchart({
    direction: "TD",
    nodes: [{ id: "A", shape: "rect", text: "A" }],
    edges: [],
    layout: { A: { x: 40.4, y: 39.6, w: 90.2, h: 50.7, kind: "box" } }
  });
  check("a position is written as whole numbers", rounded.includes("%% @ A 40,40 90x51"), true);

  // A whole-file .mmd document is wrapped in a fence before it is rendered, and
  // the wrapper indents what it wraps. So every line of a laid-out diagram can
  // arrive with whitespace in front of it, including the lines that say where
  // the boxes are.
  const indented = arranged.split("\n").map((line) => `  ${line}`).join("\n");
  check("a diagram indented inside a fence is still a laid-out one",
    DM.hasLayout(indented), true);
  check("...and still reads the same", JSON.stringify(DM.parseFlowchart(indented).layout),
    JSON.stringify(model.layout));

  // And the comments go inside the diagram, after the line that says what it
  // is — the one place every Mermaid parser is certain to allow them.
  check("the layout is written under the header, not above it",
    rounded.indexOf("flowchart TD") < rounded.indexOf("%% layout v1"), true);
}

console.log("=== a diagram nobody has arranged is arranged on the way in ===");
{
  const model = DM.parseFlowchart("flowchart TD\n  A[Start] --> B[Middle] --> C[End]\n");
  const layout = DM.autoLayout(model);

  check("every box gets a place", Object.keys(layout).sort(), ["A", "B", "C"]);
  check("...following the flow of the diagram",
    layout.A.y < layout.B.y && layout.B.y < layout.C.y, true);
  check("...on the grid it will be dragged on",
    Object.values(layout).every((at) => at.x % DM.GRID === 0 && at.y % DM.GRID === 0), true);
  check("...clear of the edge of the paper",
    Object.values(layout).every((at) => at.x >= 0 && at.y >= 0), true);

  const overlapping = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const places = Object.values(layout);
  check("...and not on top of each other",
    places.some((a, i) => places.slice(i + 1).some((b) => overlapping(a, b))), false);

  const sideways = DM.autoLayout(DM.parseFlowchart("flowchart LR\n  A --> B\n"));
  check("a left-to-right diagram is laid out left to right",
    sideways.A.x < sideways.B.x && sideways.A.y === sideways.B.y, true);

  // A flowchart with a loop in it has no longest path. Ranking one anyway walks
  // the boxes round and round until a cap stops it, and the first step ends up
  // somewhere in the middle of the picture.
  const looped = DM.autoLayout(DM.parseFlowchart("flowchart TD\n  A --> B\n  B --> C\n  C --> A\n"));
  check("a loop does not scramble the order it is drawn in",
    looped.A.y < looped.B.y && looped.B.y < looped.C.y, true);

  // A box can arrive without a position — somebody edited the source by hand.
  // It has to be drawn somewhere, and somewhere is out of the way of everything
  // that already has one.
  const partial = DM.parseFlowchart([
    "flowchart TD",
    "    %% layout v1",
    "    %% @ A 40,40 160x56",
    "    A[Start]",
    "    B[Added by hand]",
    "    A --> B"
  ].join("\n"));
  const filled = DM.ensureLayout(partial);
  check("a box with no position gets one", Boolean(filled.B), true);
  check("...without moving the boxes that had one", filled.A, partial.layout.A);
  check("...and clear of them", filled.B.y >= filled.A.y + filled.A.h, true);

  // Bigger text needs a bigger box, and a box is only ever measured to start
  // with: a size somebody dragged to is a size they chose.
  const small = DM.measureNode({ text: "Go", shape: "rect" }, "box");
  const large = DM.measureNode({ text: "A much longer label than that", shape: "rect" }, "box");
  check("a longer label starts in a wider box", large.w > small.w, true);
  check("...and more lines in a taller one",
    DM.measureNode({ text: "one<br/>two<br/>three", shape: "rect" }, "box").h > small.h, true);
  check("a table's rows are the lines in its label",
    DM.textRows("Person<br/>name: string"), ["Person", "name: string"]);
  check("...and are written back the way Mermaid writes a line break",
    DM.joinRows(["Person", "name: string"]), "Person<br/>name: string");
}

console.log("=== a box lines itself up with the ones already there ===");
{
  /* Six lines matter on any box: left, centre, right, top, middle, bottom.
   * When one of the six on the box being moved comes close to one of the six
   * on a box that is not, the moving box goes exactly on it. That is the whole
   * of the difference between a diagram that looks arranged and one that looks
   * nearly arranged.
   */
  const anchor = { x: 100, y: 100, w: 80, h: 40 };
  const guide = (moving, others = [anchor], within = 6) => DM.alignGuides(moving, others, within);

  check("a box three pixels off another box's left edge is put on it",
    guide({ x: 103, y: 300, w: 80, h: 40 }).x, 100);
  check("...and says which line it went to",
    guide({ x: 103, y: 300, w: 80, h: 40 }).guides.map((one) => [one.axis, one.at]), [["x", 100]]);
  check("...with a line long enough to reach both boxes",
    guide({ x: 103, y: 300, w: 80, h: 40 }).guides[0], { axis: "x", at: 100, from: 100, to: 340 });
  // And from the other side, where the box that is not moving is the far end:
  // a line that stops at the box under the hand explains nothing.
  check("...whichever of the two is further along",
    guide({ x: 103, y: 20, w: 80, h: 40 }).guides[0], { axis: "x", at: 100, from: 20, to: 140 });

  check("a box seven pixels off is left where it is",
    guide({ x: 107, y: 300, w: 80, h: 40 }).x, 107);
  check("...with nothing to explain", guide({ x: 107, y: 300, w: 80, h: 40 }).guides, []);

  // Centres and far edges count as much as near ones, which is what lets a
  // wide box be centred under a narrow one.
  check("a box can line up by its centre",
    guide({ x: 85, y: 300, w: 120, h: 40 }).x, 80);
  check("...or by its right edge against another's right edge",
    guide({ x: 22, y: 300, w: 160, h: 40 }).x, 20);
  check("...or by its left edge against another's right edge",
    guide({ x: 178, y: 300, w: 60, h: 40 }).x, 180);

  // Both axes at once, and they are decided independently: a box can be level
  // with one thing and in line with another.
  const corner = guide({ x: 103, y: 97, w: 80, h: 40 });
  check("a box can line up both ways at once", [corner.x, corner.y], [100, 100]);
  check("...and says so twice", corner.guides.map((one) => one.axis), ["x", "y"]);

  const two = guide({ x: 103, y: 138, w: 80, h: 40 }, [anchor, { x: 400, y: 140, w: 80, h: 40 }]);
  check("...against different boxes on each axis", [two.x, two.y], [100, 140]);

  // The nearest wins, so a box between two others does not flicker between
  // them while the hand shakes.
  const between = guide({ x: 104, y: 300, w: 80, h: 40 }, [anchor, { x: 108, y: 500, w: 80, h: 40 }]);
  check("the nearest line wins", between.x, 104 - 4);

  check("a box with nothing to line up against stays put",
    [guide({ x: 103, y: 300, w: 80, h: 40 }, []).x, guide({ x: 103, y: 300, w: 80, h: 40 }, []).guides.length],
    [103, 0]);

  // How close counts is the caller's business, because on screen it depends on
  // the zoom: at half size, six pixels of file is three pixels of hand.
  check("how close counts can be widened",
    guide({ x: 112, y: 300, w: 80, h: 40 }, [anchor], 20).x, 100);
  check("...and narrowed", guide({ x: 103, y: 300, w: 80, h: 40 }, [anchor], 1).x, 103);
}

console.log("=== a diagram is a place, not a picture ===");
{
  /* On the page a diagram has no edges: it is somewhere you are looking at part
   * of, and the part you are looking at is one transform. That matters more
   * than it sounds — it is what makes panning and zooming cost the same at six
   * boxes and at six hundred, because neither one redraws anything.
   */
  const model = DM.parseFlowchart([
    "flowchart TD",
    "    %% layout v1",
    "    %% @ A 100,100 120x60",
    "    %% @ B 100,300 120x60",
    "    A[One]",
    "    B[Two]",
    "    A --> B"
  ].join("\n"));

  const drawn = DD.render(model, {
    layout: model.layout,
    viewport: true,
    view: { x: 40, y: -25, scale: 1.5 },
    grid: true
  });

  check("a viewport fills whatever it is given",
    /<svg[^>]*width="100%"[^>]*height="100%"/.test(drawn), true);
  // A viewBox would be a second scale to undo, and two scales is one too many
  // for "a pixel on the screen is this point in the diagram" to stay simple.
  check("...with no viewBox, so one unit is one pixel",
    /viewBox/.test(drawn.slice(0, drawn.indexOf(">"))), false);
  check("...and says it is somewhere to work rather than a picture",
    /role="application"/.test(drawn), true);

  check("everything in the diagram moves together",
    /<g class="dd-view" transform="translate\(40,-25\) scale\(1.5\)">/.test(drawn), true);
  // Inside it, not merely after it: a group that moves with nothing in it moves
  // nothing, and the difference is invisible in the text of the file.
  const parsed = new JSDOM(`<!doctype html><body>${drawn}</body>`).window.document;
  check("...and every box and arrow is inside that one group",
    ["dd-nodes", "dd-edges", "dd-marks"].map((part) =>
      Boolean(parsed.querySelector(`.dd-view > .${part}`)) || !parsed.querySelector(`.${part}`)),
    [true, true, true]);
  check("...so moving it is the whole of moving the diagram",
    parsed.querySelectorAll(".dd-view .dd-node").length, 2);

  // The grid is the one thing that must not be inside it: a rectangle big
  // enough to be under an endless canvas is a rectangle of no particular size.
  // So the paper stays still and the pattern on it moves.
  check("the paper is the whole window and stays there",
    /<rect class="dd-paper" x="0" y="0" width="100%" height="100%"/.test(drawn), true);
  check("...while the grid on it moves with the diagram",
    /<pattern[^>]*patternTransform="translate\(40,-25\) scale\(1.5\)"/.test(drawn), true);
  check("...so nothing had to decide how big an endless canvas is",
    /dd-paper[^>]*width="\d+"/.test(drawn), false);

  // A view nobody has set is the diagram at its own size at the origin, which
  // is also what a broken one has to come out as rather than NaN.
  for (const [what, bad] of Object.entries({
    "no view at all": undefined,
    "a scale of zero": { x: 0, y: 0, scale: 0 },
    "a scale that is not a number": { x: 1, y: 2, scale: "wide" },
    "positions that are not numbers": { x: "left", y: null, scale: 2 }
  })) {
    const view = DD.viewOf(bad);
    check(`${what} is still somewhere to look from`,
      Number.isFinite(view.x) && Number.isFinite(view.y) && view.scale > 0, true);
  }

  check("a scale that is not a number is life size", DD.viewOf({ scale: "wide" }).scale, 1);
  check("...and a position that is not a number is the origin",
    [DD.viewOf({ x: "left" }).x, DD.viewOf({ y: null }).y], [0, 0]);

  // And the old way still works, because the editor inside a document still
  // uses it and this phase was not supposed to touch that.
  const inPage = DD.render(model, { layout: model.layout, natural: true, grid: true, pad: 200 });
  check("a diagram drawn at its own size still is",
    /<svg[^>]*viewBox="0 0 \d+ \d+"[^>]* width="\d+" height="\d+"/.test(inPage), true);
  check("...with nothing moved out from under it",
    /class="dd-view"/.test(inPage), false);
}

};
