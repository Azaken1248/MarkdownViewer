/* What a box can look like, and what an arrow can be.
 *
 * Tables of the things Mermaid's flowchart syntax offers, each entry carrying
 * both the way it is written and the way it is drawn. Everything below reads
 * from these rather than matching on the syntax a second time.
 */
(function (global) {
  "use strict";

  const DIRECTIONS = ["TB", "TD", "BT", "LR", "RL"];

  // Longest opener first, because "((" is a prefix of "(((" and "[" of "[(",
  // and the first shape that matches wins. Where one opener has two possible
  // closers — "[/" ends either "/]" or "\]" — both are listed and whichever
  // closer is actually present decides.
  const SHAPES = [
    { name: "double-circle", open: "(((", close: ")))", label: "Double circle" },
    { name: "circle", open: "((", close: "))", label: "Circle" },
    { name: "stadium", open: "([", close: "])", label: "Stadium" },
    { name: "cylinder", open: "[(", close: ")]", label: "Cylinder" },
    { name: "subroutine", open: "[[", close: "]]", label: "Subroutine" },
    { name: "lean-right", open: "[/", close: "/]", label: "Parallelogram" },
    { name: "trapezoid", open: "[/", close: "\\]", label: "Trapezoid" },
    { name: "lean-left", open: "[\\", close: "\\]", label: "Parallelogram left" },
    { name: "trapezoid-alt", open: "[\\", close: "/]", label: "Trapezoid down" },
    { name: "hexagon", open: "{{", close: "}}", label: "Hexagon" },
    { name: "asymmetric", open: ">", close: "]", label: "Flag" },
    { name: "rect", open: "[", close: "]", label: "Box" },
    { name: "round", open: "(", close: ")", label: "Rounded" },
    { name: "diamond", open: "{", close: "}", label: "Decision" }
  ];

  /* The shapes this app draws that Mermaid has no brackets for.
   *
   * A note, a cloud, an actor and a queue are ordinary vocabulary in a
   * technical diagram, and Mermaid's shape list stops well short of them. Same
   * bargain as the arrow ends: the file carries the nearest real shape, so the
   * diagram still reads as something sensible wherever else it is opened, and
   * the exact shape is said beside it in the layout comment.
   *
   * `nearest` is chosen for what it says rather than for what it looks like. A
   * queue is a cylinder lying down, so it is written as one; an actor is a
   * single person, which is nearer a stadium than a rectangle; a cloud is the
   * roundest thing Mermaid has.
   */
  const DRAWN_SHAPES = [
    { name: "note", nearest: "rect", label: "Note" },
    { name: "cloud", nearest: "circle", label: "Cloud" },
    { name: "actor", nearest: "stadium", label: "Actor" },
    { name: "queue", nearest: "cylinder", label: "Queue" }
  ];

  const DRAWN_BY_NAME = new Map(DRAWN_SHAPES.map((shape) => [shape.name, shape]));

  /* How much of an actor is its name rather than the figure, and how short one
   * can get before it stops reading as a person.
   *
   * Here rather than in the drawing because both the measuring and the drawing
   * need it and they have to agree: a figure drawn to one share of the box and
   * a label placed by another is a label written across somebody's chest.
   */
  const ACTOR_BAND = 0.28;
  const ACTOR_LEAST = 96;

  // The shapes worth offering in a menu. The rest still parse and still come
  // back out unchanged; they are just not something anyone goes looking for.
  const SHAPE_CHOICES = ["rect", "round", "stadium", "diamond", "circle", "hexagon",
    "cylinder", "subroutine", ...DRAWN_SHAPES.map((shape) => shape.name)];

  // Mermaid lets a link be drawn longer by adding dashes — "-->" and "---->"
  // are the same arrow with different rank spacing — so every token here
  // matches its family rather than one exact spelling. Order matters for the
  // same reason as the shapes: "-.->"" would otherwise be read as "---".
  const EDGE_KINDS = [
    { name: "arrow", token: "-->", head: /^-{2,}>/, label: "Arrow" },
    { name: "open", token: "---", head: /^-{3,}/, label: "Line" },
    { name: "dotted", token: "-.->", head: /^-\.-+>/, label: "Dotted arrow" },
    { name: "dotted-open", token: "-.-", head: /^-\.-+(?!>)/, label: "Dotted line" },
    { name: "thick", token: "==>", head: /^={2,}>/, label: "Thick arrow" },
    { name: "thick-open", token: "===", head: /^={3,}/, label: "Thick line" },
    // Mermaid's own circle and cross endings, which are the two endpoint styles
    // it can express and this used to refuse.
    { name: "circle", token: "--o", head: /^-{2,}o/, label: "Circle end" },
    { name: "cross", token: "--x", head: /^-{2,}x/, label: "Cross end" },
    // And the ones that point both ways.
    { name: "both", token: "<-->", head: /^<-{2,}>/, label: "Both ways" },
    { name: "dotted-both", token: "<-.->", head: /^<-\.-+>/, label: "Dotted both ways" },
    { name: "thick-both", token: "<==>", head: /^<={2,}>/, label: "Thick both ways" }
  ];

  // Tried in this order against the text after a node.
  const EDGE_ORDER = [
    "dotted-both", "thick-both", "both",
    "dotted", "dotted-open", "arrow", "circle", "cross", "open", "thick", "thick-open"
  ];

  // The "A-- yes -->B" spelling, where the label sits inside the link instead
  // of in pipes after it. Parsed, then written back the other way; there is one
  // spelling on the way out and it is the one that cannot be misread.
  const EDGE_TEXT_FORMS = [
    { name: "dotted", re: /^-\.\s*([^|]+?)\s*\.-+>/ },
    { name: "dotted-open", re: /^-\.\s*([^|]+?)\s*\.-+(?!>)/ },
    { name: "arrow", re: /^--\s*([^|]+?)\s*-{2,}>/ },
    { name: "open", re: /^--\s*([^|]+?)\s*-{3,}/ },
    { name: "thick", re: /^==\s*([^|]+?)\s*={2,}>/ },
    { name: "thick-open", re: /^==\s*([^|]+?)\s*={3,}/ }
  ];

  /* A link is a line style and two ends, and Mermaid can spell some of the
   * combinations and not others.
   *
   * The rule is that the file always carries a real link token — the nearest
   * one Mermaid has — so a diagram rendered anywhere else reads correctly, and
   * the exact ends go in a layout comment on top for the four styles Mermaid
   * cannot say. A UML "is a" arrow is written `-->` and reads as an arrow
   * elsewhere, which is the truthful approximation; writing nothing at all, or
   * inventing syntax, would not be.
   */
  const LINE_STYLES = [
    ["solid", "Solid"],
    ["dotted", "Dotted"],
    ["thick", "Thick"]
  ];

  // style -> what to write for [nothing at each end, an end forward, ends both ways]
  const LINK_BY_STYLE = {
    solid: { none: "open", forward: "arrow", both: "both", circle: "circle", cross: "cross" },
    dotted: { none: "dotted-open", forward: "dotted", both: "dotted-both" },
    thick: { none: "thick-open", forward: "thick", both: "thick-both" }
  };

  // Which of the three a kind is drawn in, whatever its ends are.
  function lineStyleOf(kind) {
    const name = String(kind || "arrow");
    if (name.startsWith("dotted")) {
      return "dotted";
    }

    return name.startsWith("thick") ? "thick" : "solid";
  }

  /* The nearest real link for a line style and a pair of ends.
   *
   * `circle` and `cross` are Mermaid's own, so they are used exactly when they
   * fit — a solid line ending in a circle is `--o` and needs no comment at all.
   * Everything else lands on an arrow or a plain line, whichever is closer to
   * what was asked for.
   */
  function linkFor(style, ends) {
    const table = LINK_BY_STYLE[style] || LINK_BY_STYLE.solid;
    const [back, forward] = Array.isArray(ends) ? ends : ["none", "arrow"];

    // Anything at all behind the line makes it a both-ways link, which is the
    // nearest real thing however unalike the two ends actually are.
    if (back !== "none") {
      return table.both;
    }

    // Every style can say "nothing"; solid can also say Mermaid's own circle
    // and cross. Everything else is nearer to an arrow than to a plain line.
    return table[forward] || table.forward;
  }

  /* The three shapes a line can be drawn in.
   *
   * Not a Mermaid idea at all — Mermaid draws a link however its renderer feels
   * like — so this lives in the layout comment with the rest of what is ours,
   * and a file that has never been near this editor is angled, which is what it
   * has always been drawn as.
   */
  const ROUTE_SHAPES = [
    ["angled", "Angled"],
    ["curved", "Curved"],
    ["straight", "Straight"]
  ];

  const ROUTE_DEFAULT = "angled";
  const ROUTE_NAMES = new Set(ROUTE_SHAPES.map(([name]) => name));

  const SHAPE_BY_NAME = new Map(SHAPES.map((shape) => [shape.name, shape]));

  /* The same shapes, grouped by opener and longest opener first.
   *
   * Two things have to be true at once. Between openers, longer wins: "((" is a
   * prefix of "(((" and would otherwise read a circle out of the front of a
   * double circle. Within one opener, nearest closer wins: "[/" ends at either
   * "/]" or "\]", and trying them in list order lets "A[/c\] --> B[/d/]" reach
   * past its own end and swallow the next node whole.
   */
  const OPENERS = (() => {
    const grouped = new Map();

    for (const shape of SHAPES) {
      if (!grouped.has(shape.open)) {
        grouped.set(shape.open, []);
      }
      grouped.get(shape.open).push(shape);
    }

    return [...grouped.entries()].sort((a, b) => b[0].length - a[0].length);
  })();
  const EDGE_BY_NAME = new Map(EDGE_KINDS.map((kind) => [kind.name, kind]));

  // Mermaid's own ids are looser than this. Keeping to a conservative subset
  // means an id this parser accepts is an id it can also write back and an id
  // no shape or link token can be mistaken for.
  //
  // The hyphen is the awkward one: it is legal inside an id and it is also the
  // first character of every solid link, so a plain [\w-]* would read "A-->B"
  // as one node called "A--" and "A----D" as one called "A----D". A hyphen is
  // therefore only part of an id when something alphanumeric follows it, which
  // takes "my-node" and leaves every run of dashes to the link parser.

  global.DmShapes = {
    DIRECTIONS, SHAPES, DRAWN_SHAPES, DRAWN_BY_NAME, ACTOR_BAND, ACTOR_LEAST, SHAPE_CHOICES,
    EDGE_KINDS, EDGE_ORDER, EDGE_TEXT_FORMS, LINE_STYLES, LINK_BY_STYLE, lineStyleOf, linkFor,
    ROUTE_SHAPES, ROUTE_DEFAULT, ROUTE_NAMES, SHAPE_BY_NAME, OPENERS, EDGE_BY_NAME
  };
})(typeof window === "undefined" ? globalThis : window);
