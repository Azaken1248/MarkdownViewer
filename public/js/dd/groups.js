/* Subgraphs: the box drawn around a set of boxes.
 *
 * A group has no coordinates of its own — it is wherever its members are — so
 * its box is computed from them, and nested groups are drawn outermost first
 * so an inner one is not hidden under the one containing it.
 */
(function (global) {
  "use strict";

  const { LABEL_CHAR, escapeText, round } = global.DdBase;

  const areaOf = (at) => at.w * at.h;

  const surrounds = (outer, inner) => outer.x <= inner.x && outer.y <= inner.y
    && (outer.x + outer.w) >= (inner.x + inner.w)
    && (outer.y + outer.h) >= (inner.y + inner.h)
    && areaOf(outer) > areaOf(inner);

  function nestingDepths(nodes, layout) {
    const placed = (nodes || []).filter((node) => layout[node.id]);
    const depths = new Map();

    for (const node of placed) {
      depths.set(node.id, placed.filter((other) =>
        surrounds(layout[other.id], layout[node.id])).length);
    }

    return depths;
  }

  /* --- Groups ------------------------------------------------------------- */

  /* A group has no position of its own.
   *
   * Its frame is worked out from what is inside it, every time it is drawn.
   * That is the whole answer to padding that creeps: there is no stored
   * rectangle to add the padding to a second time, so the frame is the same
   * width after nine edits as after one. Move a box and the frame follows it;
   * take the last box out and there is no frame at all, because a group with
   * nothing in it encloses nothing.
   */
  const GROUP_PAD = 18;
  // Room above the contents for the name, which sits inside the frame rather
  // than on its edge: a name on the edge has to be drawn over the line, and
  // the line is what says where the group ends.
  const GROUP_HEAD = 22;
  const GROUP_NAME_DROP = 7;

  /* How deep in the tree of groups each group sits.
   *
   * A group inside a group inside nothing is 2. Walking up rather than down
   * because a parent is a single field and children are a search, and because
   * a group that is its own ancestor stops the walk instead of running it
   * forever — such a diagram cannot be drawn sensibly, but it must not hang
   * the page that opened it.
   */
  function groupDepths(groups) {
    const byId = new Map(groups.map((group) => [group.id, group]));
    const depths = new Map();

    for (const group of groups) {
      const seen = new Set([group.id]);
      let above = byId.get(group.parent);
      let depth = 0;

      while (above && !seen.has(above.id)) {
        seen.add(above.id);
        depth += 1;
        above = byId.get(above.parent);
      }

      depths.set(group.id, depth);
    }

    return depths;
  }

  /* Every group's frame, worked out from the boxes in it.
   *
   * Innermost first, so a group holding another group fits around the frame
   * the inner one has just been given rather than around the boxes inside it —
   * otherwise the inner name and its own padding would stick out of the outer
   * frame. A group nothing is in gets no entry, and so is never drawn.
   */
  function groupBoxes(model, layout) {
    const groups = Array.isArray(model?.groups) ? model.groups : [];
    const nodes = Array.isArray(model?.nodes) ? model.nodes : [];
    const boxes = {};

    if (groups.length === 0) {
      return boxes;
    }

    const depths = groupDepths(groups);
    const inward = [...groups].sort((one, two) =>
      (depths.get(two.id) || 0) - (depths.get(one.id) || 0));

    for (const group of inward) {
      const held = nodes
        .filter((node) => node.parent === group.id)
        .map((node) => layout[node.id])
        .concat(groups
          .filter((other) => other.parent === group.id)
          .map((other) => boxes[other.id]))
        .filter(Boolean);

      if (held.length === 0) {
        continue;
      }

      const left = Math.min(...held.map((at) => at.x));
      const top = Math.min(...held.map((at) => at.y));
      const right = Math.max(...held.map((at) => at.x + at.w));
      const bottom = Math.max(...held.map((at) => at.y + at.h));
      // A name longer than the contents widens the frame rather than hanging
      // out of it.
      const named = (groupName(group).length * LABEL_CHAR) + (GROUP_PAD * 2);

      boxes[group.id] = {
        x: left - GROUP_PAD,
        y: top - GROUP_PAD - GROUP_HEAD,
        w: Math.max(right - left + (GROUP_PAD * 2), named),
        h: bottom - top + (GROUP_PAD * 2) + GROUP_HEAD
      };
    }

    return boxes;
  }

  // A group written without brackets is labelled with its own id by the parser,
  // which is what Mermaid draws too — so by the time a group is drawn it always
  // has a label, and an empty one is a name somebody has rubbed out.
  const groupName = (group) => String(group?.label ?? "");

  function groupMarkup(group, at) {
    const name = groupName(group);

    return `<g class="dd-group" data-group="${escapeText(group.id)}">`
      + `<rect class="dd-group-box" x="${round(at.x)}" y="${round(at.y)}"`
      + ` width="${round(at.w)}" height="${round(at.h)}" rx="8"/>`
      + (name
        ? `<text class="dd-group-name" x="${round(at.x + GROUP_PAD)}"`
          + ` y="${round(at.y + GROUP_HEAD - GROUP_NAME_DROP)}">${escapeText(name)}</text>`
        : "")
      + `</g>`;
  }

  /* --- The whole drawing -------------------------------------------------- */

  /* How much of the diagram is on screen, and where.
   *
   * A diagram is not a picture on a page here, it is a place you are looking
   * at part of. `x`, `y` and `scale` say which part: a point p in the diagram
   * is drawn at p * scale + (x, y). One transform on one group moves the whole
   * drawing, which is what makes panning and zooming cost the same whether
   * there are six boxes or six hundred.
   */
  function viewOf(view) {
    const scale = Number(view?.scale);
    return {
      x: Number(view?.x) || 0,
      y: Number(view?.y) || 0,
      scale: Number.isFinite(scale) && scale > 0 ? scale : 1
    };
  }


  global.DdGroups = {
    areaOf, surrounds, nestingDepths, GROUP_PAD, GROUP_HEAD, groupDepths, groupBoxes,
    groupName, groupMarkup, viewOf
  };
})(typeof window === "undefined" ? globalThis : window);
