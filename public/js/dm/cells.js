/* A table box: its rows, its cells, and the styling of one cell.
 *
 * A table is one node whose label carries its whole grid, so all of this is
 * text arithmetic — splitting a label into rows and cells, and putting it back
 * together without losing an empty one.
 */
(function (global) {
  "use strict";

  const { ROW_BREAK, ROW_SPLIT_RE } = global.DmGrammar;

  function textRows(text) {
    const rows = String(text ?? "").split(ROW_SPLIT_RE).map((row) => row.trim());
    return rows.length === 0 ? [""] : rows;
  }

  function joinRows(rows) {
    return rows.map((row) => String(row).trim()).join(ROW_BREAK);
  }

  /* A table's rows are cells, separated by a pipe.
   *
   * In the label, where the rows already are, rather than in a comment beside
   * it. Two reasons. A renderer that knows nothing about this app shows
   * "Name | Type" on a line, which is what that row says; and the number of
   * columns is then something the text answers rather than something a second
   * line has to keep agreeing with it about. A pipe forces the label to be
   * quoted, which the row break already did.
   */
  const CELL_BREAK = " | ";
  const CELL_SPLIT_RE = /\s*\|\s*/;

  function textCells(text) {
    return textRows(text).map((row) => row.split(CELL_SPLIT_RE));
  }

  function joinCells(grid) {
    return joinRows(grid.map((cells) =>
      cells.map((cell) => String(cell ?? "").trim()).join(CELL_BREAK)));
  }

  /* How many columns a grid has: as many as its widest row. A row with fewer
   * cells than that is a row with empty ones on the end, which is a thing a
   * table is allowed to be.
   *
   * Never none. A grid of no rows has no widest row to ask, and a table of no
   * columns is not a table — it is a division by zero in everything that lays
   * one out.
   */
  function columnsOf(grid) {
    return grid.reduce((most, cells) => Math.max(most, cells.length), 1);
  }

  /* The type one cell is set in.
   *
   * Mermaid has a classDef, and a classDef dresses a node. There is no such
   * thing as a class on a cell, because as far as Mermaid is concerned a table
   * is a box with pipes in its label — so this is one of the few things that
   * genuinely cannot be said in the real syntax, and it is said beside it.
   *
   * Written as `cells=1.0:b;2.1:m14`: the row, the column, and what that one
   * cell wears. Letters for the marks and digits for the size, in that order,
   * because a cell's whole appearance then fits in a token short enough to
   * read at a glance in the file.
   */
  const CELL_MARKS = [
    ["b", "font-weight", "700"],
    ["i", "font-style", "italic"],
    ["n", "font-family", "sans-serif"],
    ["m", "font-family", "monospace"],
    ["s", "font-family", "serif"]
  ];
  const CELL_SIZE = { least: 8, most: 48 };
  const CELL_ONE_RE = /^(\d+)\.(\d+):([bimns]{0,5})(\d{0,2})$/;
  const CELL_JOIN = ";";

  const cellKey = (row, column) => `${row}.${column}`;

  /* What the file says each cell is wearing.
   *
   * Anything that is not one of the shapes above is dropped rather than kept
   * and passed on. The token becomes a style attribute on a <text>, and a file
   * is something anyone can hand you.
   */
  function readCellStyles(said) {
    const out = {};

    for (const one of String(said || "").split(CELL_JOIN)) {
      const found = CELL_ONE_RE.exec(one.trim());
      if (!found) {
        continue;
      }

      // A cell that says it wears nothing is a cell with no entry, not an
      // entry that says nothing.
      const [, row, column, marks, digits] = found;
      if (marks === "" && digits === "") {
        continue;
      }

      const size = Number(digits);
      if (digits !== "" && (size < CELL_SIZE.least || size > CELL_SIZE.most)) {
        continue;
      }

      out[cellKey(Number(row), Number(column))] = marks + digits;
    }

    return out;
  }

  /* Back to a token, in a fixed order, and only for cells the table still has.
   *
   * A row deleted takes its cells' type with it. Keeping the entry would mean
   * that adding the row back later brings the old bold with it — which is a
   * surprise, and worse, it means the file grows a line of dressing for parts
   * of a table nobody can see.
   */
  function writeCellStyles(styles, grid) {
    const rows = grid || [];
    const columns = columnsOf(rows);

    const kept = Object.entries(styles || {}).flatMap(([key, token]) => {
      const found = /^(\d+)\.(\d+)$/.exec(key);
      if (!found || !token) {
        return [];
      }

      const row = Number(found[1]);
      const column = Number(found[2]);
      // The title spans the table, so it is the one cell of row zero.
      const wide = row === 0 ? 1 : columns;
      if (row >= rows.length || column >= wide) {
        return [];
      }

      return [[row, column, String(token)]];
    });

    kept.sort((one, two) => (one[0] - two[0]) || (one[1] - two[1]));
    return kept.map(([row, column, token]) =>
      `${cellKey(row, column)}:${token}`).join(CELL_JOIN);
  }

  // A token spelled out as the declarations it stands for. The same property
  // names a classDef uses, so a cell and the box around it are dressed by one
  // vocabulary rather than two.
  function cellDeclarations(token) {
    const said = String(token || "");
    const out = {};

    for (const [letter, key, value] of CELL_MARKS) {
      if (said.includes(letter)) {
        out[key] = value;
      }
    }

    const digits = said.replace(/\D/g, "");
    if (digits !== "") {
      out["font-size"] = `${Number(digits)}px`;
    }

    return out;
  }

  // The token a cell would wear given what is asked of it: the marks it keeps,
  // plus the size. One place builds a token, so there is one spelling of one.
  function cellToken(marks, size) {
    const letters = CELL_MARKS
      .filter(([letter]) => (marks || []).includes(letter))
      .map(([letter]) => letter)
      .join("");

    const number = Number(size);
    const said = Number.isFinite(number) && number >= CELL_SIZE.least
      && number <= CELL_SIZE.most ? String(Math.round(number)) : "";

    return letters + said;
  }

  /* A table's grid, of exactly this many rows and columns.
   *
   * Rows and cells are added empty and removed from the end, so growing and
   * shrinking are each other's undo for as long as nothing was typed into what
   * was dropped.
   *
   * The first row is the title and spans the whole table, so it is one cell
   * however many columns there are. Padded to the width of the rest it would
   * be written out as "Person |", which says there is an empty cell beside the
   * title — and there is no beside, that is what spanning means.
   */
  function resizeGrid(grid, rows, columns) {
    const out = [];

    for (let row = 0; row < rows; row += 1) {
      const from = grid[row] || [];
      const wide = row === 0 ? 1 : columns;
      out.push(Array.from({ length: wide }, (ignored, cell) => from[cell] || ""));
    }

    return out;
  }

  /* How much bigger than the standard a box's own type is.
   *
   * A number out of a file, so it is read rather than believed: anything that
   * is not a plain size within the bounds the panel offers counts as no size
   * at all, and the box is measured for the type it will actually be drawn in.
   */
  const TEXT_SIZE = 13;
  const FONT_SIZE = { least: 8, most: 96 };

  function fontScale(said) {
    const found = /^([0-9]{1,3}(?:\.[0-9]+)?)px$/i.exec(String(said || "").trim());
    const size = found ? parseFloat(found[1]) : 0;
    return size >= FONT_SIZE.least && size <= FONT_SIZE.most ? size / TEXT_SIZE : 1;
  }

  /* How big a box has to be to hold what is written in it.
   *
   * Only ever a starting size. Everything here can be dragged to another one,
   * and once it has been, this is not consulted about that box again.
   */

  global.DmCells = {
    textRows, joinRows, textCells, joinCells, columnsOf, CELL_MARKS, CELL_SIZE, cellKey,
    readCellStyles, writeCellStyles, cellDeclarations, cellToken, resizeGrid, TEXT_SIZE,
    FONT_SIZE, fontScale
  };
})(typeof window === "undefined" ? globalThis : window);
