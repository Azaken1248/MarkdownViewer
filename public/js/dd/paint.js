/* Reading a classDef back off a node, and what it means for the drawing.
 *
 * The colours, the border, the font: all of it arrives as a Mermaid style
 * string, which is the only place it can be written and still be a flowchart
 * anything else can render. This is where that string is read.
 */
(function (global) {
  "use strict";

  const { Model } = global.DdBase;

  const COLOUR_RE = /^(#[0-9a-f]{3,8}|[a-z]+|(?:rgb|hsl)a?\([0-9.,%/\s]+\))$/i;
  const WIDTH_RE = /^[0-9.]+(?:px)?$/i;
  const DASH_RE = /^[0-9.,\s]+$/;

  /* The type. Held to the three generic families and nothing else: a classDef
   * comes out of a file, and a font name out of a file is a string on its way
   * into a style attribute. The three that every renderer has are also the
   * three anyone means — a diagram set in sans, in serif, or in the font code
   * is written in.
   */
  const SIZE_RE = /^[0-9]{1,3}(?:\.[0-9]+)?px$/i;
  const WEIGHT_RE = /^(?:normal|bold|[1-9]00)$/i;
  const FAMILY_RE = /^(?:sans-serif|serif|monospace)$/i;
  const STYLE_RE = /^(?:normal|italic)$/i;

  // The size a label is set in unless it says otherwise. Written here rather
  // than only in the stylesheet because clipping a word to its cell means
  // knowing how wide the word is, and there is a check that holds the two
  // together.
  const TEXT_SIZE = 13;
  // Roughly how wide a character is, as a share of the size it is set in. An
  // approximation, and it only has to be one: it decides where a word is cut
  // off, and a cut half a character early is a cut nobody can see.
  const CHAR_RATIO = 0.48;

  // Which declaration goes where. A classDef speaks CSS, and the two names that
  // do not line up are `color`, which is the text rather than the shape, and
  // `fill`, which SVG has and CSS text does not.
  const PAINTED = [
    ["fill", "--dd-fill", COLOUR_RE],
    ["stroke", "--dd-stroke", COLOUR_RE],
    ["color", "--dd-text", COLOUR_RE],
    ["stroke-width", "--dd-stroke-width", WIDTH_RE],
    ["stroke-dasharray", "--dd-dash", DASH_RE],
    ["font-size", "--dd-font-size", SIZE_RE],
    ["font-weight", "--dd-font-weight", WEIGHT_RE],
    ["font-family", "--dd-font-family", FAMILY_RE],
    ["font-style", "--dd-font-style", STYLE_RE]
  ];

  /* What a box is actually wearing: every class it names, in the order it names
   * them, and then its own inline style — which is what `style A fill:#f00`
   * means in Mermaid, and it wins because it is about that one box.
   */
  function wornBy(node, classes) {
    const worn = {};

    for (const name of node.classes || []) {
      Object.assign(worn, (classes || {})[name] || {});
    }

    Object.assign(worn, node.style || {});
    return worn;
  }

  // How wide a character is on this box, which is what says where a word is too
  // long for the cell it is in. A box set in a bigger font runs out of room
  // sooner, and a box that keeps the same clipping at every size is a box whose
  // words go over the wall the moment anyone enlarges them.
  // What size a box is set in: its own, if it named one this file is willing to
  // write into a style attribute, and the standard otherwise. Both how wide a
  // character is and how far apart the lines sit are worked out from this one
  // number, so a box set larger is spaced as well as clipped for the size it is
  // actually drawn at.
  function sizeOf(node, classes) {
    const said = wornBy(node, classes)["font-size"];
    return SIZE_RE.test(String(said || "").trim()) ? parseFloat(said) : TEXT_SIZE;
  }


  /* What one cell of a table wears, checked exactly the way the box's own is.
   *
   * The four font entries and no others: a cell may be set in another type, and
   * a cell may not repaint the table it is in. Same custom properties as the
   * box sets, so a cell that says nothing about its weight inherits the one the
   * box chose — which is what makes "bold this cell" a thing you can say on top
   * of "this table is bold" rather than instead of it.
   */
  const CELL_PAINTED = PAINTED.filter(([key]) => key.startsWith("font-"));

  function cellPaint(token) {
    const said = Model.cellDeclarations(token);

    let out = "";
    for (const [key, property, allowed] of CELL_PAINTED) {
      const value = said[key];
      if (typeof value === "string" && allowed.test(value.trim())) {
        out += `${property}:${value.trim()};`;
      }
    }

    return out;
  }

  /* How big this cell's type is: its own size if it set one, the box's
   * otherwise. Asked here rather than worked out again wherever it is wanted,
   * because the field typed into a cell has to open at the size the cell is
   * drawn at or the words change size the moment you stop typing.
   */
  function cellSize(token, size) {
    const said = Model.cellDeclarations(token)["font-size"];
    return SIZE_RE.test(String(said || "")) ? parseFloat(said) : size;
  }

  // How wide a character is in this cell. A cell set larger that kept the box's
  // character width would be a cell whose words are cut too late, and so
  // written over the wall.
  function cellChar(token, size) {
    return cellSize(token, size) * CHAR_RATIO;
  }

  function paintOf(node, classes) {
    const worn = wornBy(node, classes);

    let out = "";
    for (const [key, property, allowed] of PAINTED) {
      const value = worn[key];
      if (typeof value === "string" && allowed.test(value.trim())) {
        out += `${property}:${value.trim()};`;
      }
    }

    return out;
  }


  global.DdPaint = {
    PAINTED, wornBy, sizeOf, CELL_PAINTED, cellPaint, cellSize, cellChar, paintOf, COLOUR_RE,
    TEXT_SIZE
  };
})(typeof window === "undefined" ? globalThis : window);
