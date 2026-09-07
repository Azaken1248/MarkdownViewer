/* What an arrow has on its ends, and how much room that takes.
 *
 * An arrowhead sits outside the line it belongs to, so a route has to stop
 * short of the box by however much its head is about to occupy.
 */
(function (global) {
  "use strict";

  const END_ANCHOR = 10;

  const END_KINDS = [
    { name: "none", label: "Nothing" },
    { name: "arrow", label: "Arrow", fill: true, d: "M0,0 L10,5 L0,10 z" },
    { name: "open-arrow", label: "Open arrow", fill: false, d: "M0,0 L10,5 L0,10" },
    { name: "circle", label: "Circle", fill: true,
      d: "M0,5 A 5,5 0 1 0 10,5 A 5,5 0 1 0 0,5 z" },
    { name: "cross", label: "Cross", fill: false, d: "M1,1 L9,9 M9,1 L1,9" },
    // UML: a hollow triangle is "is a", a hollow diamond is "has a", a filled
    // diamond is "is made of".
    { name: "triangle", label: "Triangle (is a)", fill: false, d: "M0,0 L10,5 L0,10 z" },
    { name: "diamond", label: "Diamond (has a)", fill: false,
      d: "M0,5 L5,0 L10,5 L5,10 z" },
    { name: "diamond-filled", label: "Solid diamond (made of)", fill: true,
      d: "M0,5 L5,0 L10,5 L5,10 z" },
    // ERD: the fork that says "many of these".
    { name: "crow", label: "Crow's foot (many)", fill: false,
      d: "M10,0 L0,5 L10,10 M0,5 L10,5" }
  ];

  const END_BY_NAME = new Map(END_KINDS.map((one) => [one.name, one]));

  /* Which ends a link has when nothing has said otherwise.
   *
   * Read from the kind, because the kind is what the file says in Mermaid's own
   * words and it is the thing every other renderer will act on. `ends` in a
   * layout comment is the refinement on top, for the four this cannot spell.
   */
  function endsOf(edge) {
    const kind = String(edge?.kind || "arrow");
    const asked = Array.isArray(edge?.ends) ? edge.ends : null;

    const back = /^<|both$/.test(kind) ? "arrow" : "none";
    let forward = "arrow";

    if (/open$/.test(kind)) {
      forward = "none";
    } else if (kind === "circle") {
      forward = "circle";
    } else if (kind === "cross") {
      forward = "cross";
    }

    const named = (value, fallback) =>
      (typeof value === "string" && END_BY_NAME.has(value) ? value : fallback);

    return asked
      ? [named(asked[0], back), named(asked[1], forward)]
      : [back, forward];
  }

  // The markers a drawing actually needs, defined once each. Every end style in
  // every edge, and nothing else: a diagram of plain arrows carries one marker.

  global.DdEnds = {
    END_ANCHOR, END_KINDS, END_BY_NAME, endsOf
  };
})(typeof window === "undefined" ? globalThis : window);
