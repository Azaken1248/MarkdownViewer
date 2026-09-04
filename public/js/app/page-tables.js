/* Tables.
 *
 * A table is a grid of text with an alignment per column, and both of those
 * survive being edited as a grid. So the table is not shown as markdown: the
 * cells are typed into where they are, and rows, columns and alignment are
 * changed with controls on the table itself.
 *
 * What does not survive the trip is the spacing of the source. That is why a
 * table is only rewritten once it has actually been edited — an untouched
 * table is emitted exactly as it was found, however irregularly it was typed.
 */

(function (global) {
  const { markPageEditDirty } = global.AppPageBlocks;
  function renderTableBlock(block, index) {
    const node = document.createElement("div");
    node.className = "ve-block ve-table";
    node.dataset.index = String(index);
    node.setAttribute("contenteditable", "false");
    // The declared alignment of each column, which the cells are drawn with and
    // the serializer writes back. Read from the source rather than from the
    // rendered table: the renderer expresses it in a way sanitizing may drop.
    block.align = VisualEditor.tableAlignments(block.source);
    node.innerHTML = MarkdownCore.renderMarkdown(block.source);

    const table = node.querySelector("table");
    if (!table) {
      // Not a table after all once rendered. Fall back to source editing rather
      // than putting controls on something that is not there.
      return AppPageEmbeds.renderEmbedBlock(block, index);
    }

    const touched = () => {
      block.dirty = true;
      markPageEditDirty();
    };

    const paint = () => paintTable(node, block);
    paint();

    node.append(buildTableTools(node, block, paint, touched));

    node.addEventListener("input", (event) => {
      if (event.target.closest("th, td")) {
        touched();
      }
    });

    node.addEventListener("focusin", (event) => {
      const cell = event.target.closest?.("th, td");
      if (cell) {
        block.lastCell = cell;
      }
    });

    block.serialize = () => VisualEditor.tableElementToMarkdown(node.querySelector("table"), block.align);
    return node;
  }

  // Every cell editable, and every cell drawn with its column's alignment.
  function paintTable(node, block) {
    const table = node.querySelector("table");
    if (!table) {
      return;
    }

    for (const row of table.querySelectorAll("tr")) {
      [...row.children].forEach((cell, column) => {
        cell.setAttribute("contenteditable", "true");
        cell.style.textAlign = block.align[column] || "";
      });
    }
  }

  /* Which cell the controls act on.
   *
   * The cursor is the answer while it is in the table, and the last cell it was
   * in once it is not — clicking a control is not a reason for "this column" to
   * stop meaning the column you were just typing in.
   */
  function focusedCell(node, block) {
    const active = document.activeElement;
    const current = active && node.contains(active) ? active.closest("th, td") : null;
    if (current) {
      return current;
    }

    return block.lastCell && node.contains(block.lastCell) ? block.lastCell : null;
  }

  function cellPosition(cell) {
    const row = cell.closest("tr");
    const table = row.closest("table");
    return {
      row: [...table.querySelectorAll("tr")].indexOf(row),
      column: [...row.children].indexOf(cell)
    };
  }

  function buildTableTools(node, block, paint, touched) {
    const tools = document.createElement("div");
    tools.className = "ve-table-tools";
    tools.setAttribute("contenteditable", "false");

    const button = (icon, label, run) => {
      const control = document.createElement("button");
      control.type = "button";
      control.className = "ve-table-tool";
      control.title = label;
      control.setAttribute("aria-label", label);
      control.innerHTML = `<i class="ph ${icon}" aria-hidden="true"></i>`;
      // The cell has to keep the focus, because every one of these acts on the
      // cell the cursor is in.
      control.addEventListener("mousedown", (event) => event.preventDefault());
      control.addEventListener("click", () => {
        const table = node.querySelector("table");
        const cell = focusedCell(node, block) || table.querySelector("th, td");
        const at = cell ? cellPosition(cell) : { row: 0, column: 0 };
        // Losing a row is not typing, and undoing it should not also undo the
        // sentence written just before it.
        AppPageHistory.commitPageHistory();
        run(table, at);
        paint();
        touched();
        AppPageHistory.commitPageHistory();

        // Whatever the cursor was in may have just been deleted. Put it in the
        // cell that took its place, so the next control still means "here".
        const rows = [...table.querySelectorAll("tr")];
        const row = rows[Math.min(at.row, rows.length - 1)];
        row?.children[Math.min(at.column, row.children.length - 1)]?.focus();
      });
      return control;
    };

    const separator = () => {
      const line = document.createElement("span");
      line.className = "ve-table-sep";
      line.setAttribute("aria-hidden", "true");
      return line;
    };

    tools.append(
      button("ph-rows-plus-bottom", "Add row below", (table, at) => insertTableRow(table, at.row)),
      button("ph-rows", "Delete this row", (table, at) => deleteTableRow(table, at.row)),
      button("ph-columns-plus-right", "Add column to the right", (table, at) => {
        insertTableColumn(table, at.column);
        block.align.splice(at.column + 1, 0, "");
      }),
      button("ph-columns", "Delete this column", (table, at) => {
        deleteTableColumn(table, at.column);
        block.align.splice(at.column, 1);
      }),
      separator(),
      button("ph-text-align-left", "Align this column left", (table, at) => {
        block.align[at.column] = "left";
      }),
      button("ph-text-align-center", "Centre this column", (table, at) => {
        block.align[at.column] = "center";
      }),
      button("ph-text-align-right", "Align this column right", (table, at) => {
        block.align[at.column] = "right";
      })
    );

    return tools;
  }

  function insertTableRow(table, afterIndex) {
    const rows = [...table.querySelectorAll("tr")];
    const reference = rows[Math.max(1, afterIndex)] || rows[rows.length - 1];
    if (!reference) {
      return;
    }

    const fresh = document.createElement("tr");
    for (let i = 0; i < reference.children.length; i += 1) {
      fresh.appendChild(document.createElement("td"));
    }

    reference.parentNode.insertBefore(fresh, reference.nextSibling);
  }

  function deleteTableRow(table, index) {
    const rows = [...table.querySelectorAll("tr")];
    // The header row is the table's column names; a table without one is not a
    // markdown table at all.
    if (index <= 0 || rows.length <= 2) {
      return;
    }

    rows[index].remove();
  }

  function insertTableColumn(table, afterIndex) {
    for (const row of table.querySelectorAll("tr")) {
      const isHeader = Boolean(row.querySelector("th"));
      const cell = document.createElement(isHeader ? "th" : "td");
      const reference = row.children[afterIndex];

      if (reference) {
        row.insertBefore(cell, reference.nextSibling);
      } else {
        row.appendChild(cell);
      }
    }
  }

  function deleteTableColumn(table, index) {
    const rows = [...table.querySelectorAll("tr")];
    if (rows.length === 0 || rows[0].children.length <= 1) {
      return;
    }

    for (const row of rows) {
      row.children[index]?.remove();
    }
  }

  global.AppPageTables = {
    renderTableBlock
  };
})(typeof window === "undefined" ? globalThis : window);
