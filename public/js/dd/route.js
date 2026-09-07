/* Getting an arrow from one box to another without going through a third.
 *
 * Which side to leave from, which side to arrive at, where to turn, and what
 * to do when the straight line is blocked. A route the diagram pinned is
 * honoured as written; everything else is decided here.
 */
(function (global) {
  "use strict";

  const { CLEARANCE, STANDOFF, round } = global.DdBase;
  const { endsOf } = global.DdEnds;

  const hits = (segment, box) => {
    const [[x1, y1], [x2, y2]] = segment;
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);

    return right > box.x - CLEARANCE
      && left < box.x + box.w + CLEARANCE
      && bottom > box.y - CLEARANCE
      && top < box.y + box.h + CLEARANCE;
  };

  function clear(points, obstacles) {
    for (let index = 0; index < points.length - 1; index += 1) {
      const segment = [points[index], points[index + 1]];

      for (const box of obstacles) {
        if (hits(segment, box)) {
          return false;
        }
      }
    }

    return true;
  }

  // Two points on the same line and a point between them is not a corner.
  function tidy(points) {
    const out = [];

    for (const point of points) {
      const last = out[out.length - 1];
      if (last && Math.abs(last[0] - point[0]) < 0.5 && Math.abs(last[1] - point[1]) < 0.5) {
        continue;
      }
      out.push(point);
    }

    // Collinear is not enough: a point on the same line as its neighbours but
    // past one of them is a place the line goes out to and comes back from,
    // which is exactly what a corner somebody dropped there is for.
    const within = (a, b, c) => b >= Math.min(a, c) - 0.5 && b <= Math.max(a, c) + 0.5;

    for (let index = 1; index < out.length - 1;) {
      const [ax, ay] = out[index - 1];
      const [bx, by] = out[index];
      const [cx, cy] = out[index + 1];
      const straight =
        (Math.abs(ax - bx) < 0.5 && Math.abs(bx - cx) < 0.5 && within(ay, by, cy))
        || (Math.abs(ay - by) < 0.5 && Math.abs(by - cy) < 0.5 && within(ax, bx, cx));

      if (straight) {
        out.splice(index, 1);
      } else {
        index += 1;
      }
    }

    return out;
  }

  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

  function selfLoop(box) {
    const right = box.x + box.w;
    const top = box.y;
    const out = right + STANDOFF + 12;
    const up = top - STANDOFF - 12;

    return [
      [right, box.y + (box.h / 3)],
      [out, box.y + (box.h / 3)],
      [out, up],
      [box.x + (box.w / 2), up],
      [box.x + (box.w / 2), top]
    ];
  }

  function routeBetween(a, b, obstacles, spread) {
    if (a === b) {
      return selfLoop(a);
    }

    // Two boxes joined twice — there and back again, which is most of what a
    // loop in a flowchart is — would otherwise be one arrow drawn on top of
    // another. Each one leaves and arrives a little to the side of the middle
    // instead, near enough to still read as joining those two boxes.
    const lane = (box, size) => clamp(spread || 0, -(size / 2) + 10, (size / 2) - 10);
    const acx = a.x + (a.w / 2) + lane(a, a.w);
    const acy = a.y + (a.h / 2) + lane(a, a.h);
    const bcx = b.x + (b.w / 2) + lane(b, b.w);
    const bcy = b.y + (b.h / 2) + lane(b, b.h);
    const dx = (b.x + (b.w / 2)) - (a.x + (a.w / 2));
    const dy = (b.y + (b.h / 2)) - (a.y + (a.h / 2));

    // The gap between the two boxes on each axis. Whichever they are actually
    // separated on is the one an arrow can leave and arrive at squarely.
    const across = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
    const down = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
    const horizontal = across >= down;

    const candidates = [];

    if (horizontal) {
      const start = dx >= 0 ? a.x + a.w : a.x;
      const end = dx >= 0 ? b.x : b.x + b.w;
      const mid = (start + end) / 2;

      candidates.push([[start, acy], [mid, acy], [mid, bcy], [end, bcy]]);
      candidates.push([[start, acy], [start + (dx >= 0 ? STANDOFF : -STANDOFF), acy],
        [start + (dx >= 0 ? STANDOFF : -STANDOFF), bcy], [end, bcy]]);
      candidates.push([[start, acy], [end - (dx >= 0 ? STANDOFF : -STANDOFF), acy],
        [end - (dx >= 0 ? STANDOFF : -STANDOFF), bcy], [end, bcy]]);

      const over = Math.min(a.y, b.y) - STANDOFF - CLEARANCE;
      const under = Math.max(a.y + a.h, b.y + b.h) + STANDOFF + CLEARANCE;
      const outward = start + (dx >= 0 ? STANDOFF : -STANDOFF);
      const inward = end - (dx >= 0 ? STANDOFF : -STANDOFF);

      for (const lane of [over, under]) {
        candidates.push([[start, acy], [outward, acy], [outward, lane],
          [inward, lane], [inward, bcy], [end, bcy]]);
      }
    } else {
      const start = dy >= 0 ? a.y + a.h : a.y;
      const end = dy >= 0 ? b.y : b.y + b.h;
      const mid = (start + end) / 2;

      candidates.push([[acx, start], [acx, mid], [bcx, mid], [bcx, end]]);
      candidates.push([[acx, start], [acx, start + (dy >= 0 ? STANDOFF : -STANDOFF)],
        [bcx, start + (dy >= 0 ? STANDOFF : -STANDOFF)], [bcx, end]]);
      candidates.push([[acx, start], [acx, end - (dy >= 0 ? STANDOFF : -STANDOFF)],
        [bcx, end - (dy >= 0 ? STANDOFF : -STANDOFF)], [bcx, end]]);

      const left = Math.min(a.x, b.x) - STANDOFF - CLEARANCE;
      const right = Math.max(a.x + a.w, b.x + b.w) + STANDOFF + CLEARANCE;
      const outward = start + (dy >= 0 ? STANDOFF : -STANDOFF);
      const inward = end - (dy >= 0 ? STANDOFF : -STANDOFF);

      for (const lane of [left, right]) {
        candidates.push([[acx, start], [acx, outward], [lane, outward],
          [lane, inward], [bcx, inward], [bcx, end]]);
      }
    }

    for (const candidate of candidates) {
      const points = tidy(candidate);
      if (clear(points, obstacles)) {
        return points;
      }
    }

    return tidy(candidates[0]);
  }

  /* --- A route somebody chose ----------------------------------------------
   *
   * The auto-router is good at the ordinary case and has no opinions to offer
   * once somebody has said where the line should go. So when an end is pinned
   * to a side, or the line has been dragged through a point, this builds the
   * route asked for instead — squarely, but without trying to dodge anything.
   * Dodging is what the auto-router is for, and a line somebody has placed by
   * hand is already where they want it.
   */
  const SIDES = { l: [-1, 0], r: [1, 0], t: [0, -1], b: [0, 1] };

  const sideAxis = (side) => (side === "l" || side === "r" ? "x" : "y");

  const away = ([x, y], side, by) =>
    [x + (SIDES[side][0] * by), y + (SIDES[side][1] * by)];

  // Where on a side a line meets it. Offset along the side by the lane, the
  // same way the auto-router spreads two arrows between the same two boxes.
  function anchorOn(box, side, spread) {
    const along = spread || 0;
    const x = clamp(box.x + (box.w / 2) + along, box.x + 8, box.x + box.w - 8);
    const y = clamp(box.y + (box.h / 2) + along, box.y + 8, box.y + box.h - 8);

    if (side === "l") {
      return [box.x, y];
    }
    if (side === "r") {
      return [box.x + box.w, y];
    }

    return side === "t" ? [x, box.y] : [x, box.y + box.h];
  }

  // Which sides the auto-router would have used, so an edge with one end pinned
  // and one not still leaves the other end somewhere sensible.
  function autoSides(a, b) {
    const dx = (b.x + (b.w / 2)) - (a.x + (a.w / 2));
    const dy = (b.y + (b.h / 2)) - (a.y + (a.h / 2));
    const across = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
    const down = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));

    if (across >= down) {
      return dx >= 0 ? ["r", "l"] : ["l", "r"];
    }

    return dy >= 0 ? ["b", "t"] : ["t", "b"];
  }

  // The model keeps a waypoint as a point with names; the arithmetic here works
  // in pairs, the same as every other point in this file.
  const wayPoints = (edge) => (Array.isArray(edge?.waypoints) ? edge.waypoints : [])
    .filter((one) => Number.isFinite(one?.x) && Number.isFinite(one?.y))
    .map((one) => [one.x, one.y]);

  /* Which side of a box faces a point.
   *
   * Measured against the box's own half-width and half-height rather than in
   * plain pixels, or a box twice as wide as it is tall would answer left or
   * right to very nearly everything.
   */
  function sideTowards(box, [x, y]) {
    const dx = x - (box.x + (box.w / 2));
    const dy = y - (box.y + (box.h / 2));

    if (Math.abs(dx) / (box.w || 1) >= Math.abs(dy) / (box.h || 1)) {
      return dx >= 0 ? "r" : "l";
    }

    return dy >= 0 ? "b" : "t";
  }

  function pinnedSides(edge) {
    const said = Array.isArray(edge?.sides) ? edge.sides : [];
    const one = (value) => (SIDES[value] ? value : null);
    return [one(said[0]), one(said[1])];
  }

  /* The corner between two points, given which way the line is travelling when
   * it reaches the first of them.
   *
   * It turns onto the other axis first and finishes on the one it was already
   * on, so it never sets off back the way it came: a line that leaves a box
   * downwards and then has to go down further does not go down, up, and down
   * again to collect a corner on the way.
   */
  const turnTo = (from, to, heading) =>
    (heading === "y" ? [to[0], from[1]] : [from[0], to[1]]);

  function guidedRoute(a, b, edge, spread) {
    const auto = autoSides(a, b);
    const pinned = pinnedSides(edge);
    const via = wayPoints(edge);

    /* An end nobody pinned faces whatever the line goes to next, which once
     * there are corners in it is the first corner rather than the other box.
     * Otherwise a line dragged out to the left still leaves on the right and
     * doubles back on itself to get there.
     */
    const out = pinned[0] || (via.length > 0 ? sideTowards(a, via[0]) : auto[0]);
    const into = pinned[1]
      || (via.length > 0 ? sideTowards(b, via[via.length - 1]) : auto[1]);

    const start = anchorOn(a, out, spread);
    const end = anchorOn(b, into, spread);

    // Both ends leave and arrive squarely, standing off the box far enough that
    // the line reads as coming out of that side rather than out of the corner.
    const last = away(end, into, STANDOFF);
    const points = [start, away(start, out, STANDOFF)];
    const heading = sideAxis(out);

    for (const stop of via) {
      points.push(turnTo(points[points.length - 1], stop, heading), stop);
    }

    // The last leg has to run along the side it is arriving at, so the turn
    // before it is on the other one.
    points.push(turnTo(points[points.length - 1], last, sideAxis(into)));
    points.push(last, end);

    return tidy(points);
  }

  // The obstacles for one arrow: every box except the two it joins, which it is
  // allowed to touch because that is where it starts and stops.
  function obstaclesFor(layout, fromId, toId) {
    const out = [];

    for (const [id, at] of Object.entries(layout)) {
      if (id !== fromId && id !== toId) {
        out.push(at);
      }
    }

    return out;
  }

  const pathData = (points) => points
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${round(x)},${round(y)}`)
    .join(" ");

  /* --- What shape the line is drawn in --------------------------------------
   *
   * Three, and the route is the same route in all three: the corners a line
   * turns to get round a box are worked out once, and then drawn square, drawn
   * round, or ignored in favour of the shortest way there. Which means turning
   * a line curved cannot walk it through something, because the curve is the
   * same line with its corners softened.
   *
   * Straight is the one that really is a different route, and it is the one
   * that goes through whatever is in the way. That is what asking for a
   * straight line means.
   */
  const CORNER = 12;

  function pathCurved(points) {
    if (points.length < 3) {
      return pathData(points);
    }

    let d = `M${round(points[0][0])},${round(points[0][1])}`;

    for (let index = 1; index < points.length - 1; index += 1) {
      const [px, py] = points[index - 1];
      const [x, y] = points[index];
      const [nx, ny] = points[index + 1];
      const before = Math.hypot(x - px, y - py);
      const after = Math.hypot(nx - x, ny - y);

      // A corner between two segments one of which has no length is not a
      // corner, and rounding it is a division by nothing.
      if (before === 0 || after === 0) {
        d += ` L${round(x)},${round(y)}`;
        continue;
      }

      // Never more than half of either arm, or two corners close together eat
      // into each other and the line doubles back.
      const radius = Math.min(CORNER, before / 2, after / 2);
      d += ` L${round(x + (((px - x) / before) * radius))},`
        + `${round(y + (((py - y) / before) * radius))}`
        + ` Q${round(x)},${round(y)}`
        + ` ${round(x + (((nx - x) / after) * radius))},`
        + `${round(y + (((ny - y) / after) * radius))}`;
    }

    const last = points[points.length - 1];
    return `${d} L${round(last[0])},${round(last[1])}`;
  }

  const middleOf = (box) => [box.x + (box.w / 2), box.y + (box.h / 2)];

  // Where a ray from a point inside a box leaves it. The point is inside rather
  // than the middle because two straight lines between the same two boxes have
  // to leave from two different places or they are one line.
  function leaves(box, from, towards) {
    const dx = towards[0] - from[0];
    const dy = towards[1] - from[1];

    const reach = Math.min(
      dx === 0 ? Infinity : Math.max((box.x - from[0]) / dx, ((box.x + box.w) - from[0]) / dx),
      dy === 0 ? Infinity : Math.max((box.y - from[1]) / dy, ((box.y + box.h) - from[1]) / dy));

    return Number.isFinite(reach)
      ? [from[0] + (dx * reach), from[1] + (dy * reach)]
      : [from[0], from[1]];
  }

  function straightBetween(a, b, spread) {
    const here = middleOf(a);
    const there = middleOf(b);
    const length = Math.hypot(there[0] - here[0], there[1] - here[1]) || 1;

    // Two boxes joined twice get two lines, side by side, the same way the
    // angled router gives them two lanes.
    const off = spread || 0;
    const across = [(-(there[1] - here[1]) / length) * off,
      ((there[0] - here[0]) / length) * off];
    const from = [here[0] + across[0], here[1] + across[1]];
    const to = [there[0] + across[0], there[1] + across[1]];

    return [leaves(a, from, to), leaves(b, to, from)];
  }

  /* A straight line asked to go through somewhere goes through it, in
   * straight legs. Asked to leave a particular side, it leaves from the middle
   * of that side — a straight line has no corner to put anywhere else.
   */
  function straightThrough(a, b, edge, spread) {
    const via = wayPoints(edge);
    const pinned = pinnedSides(edge);

    if (via.length === 0 && !pinned[0] && !pinned[1]) {
      return straightBetween(a, b, spread);
    }

    const here = pinned[0] ? anchorOn(a, pinned[0], spread) : middleOf(a);
    const there = pinned[1] ? anchorOn(b, pinned[1], spread) : middleOf(b);
    const stops = [here, ...via, there];

    return tidy([
      pinned[0] ? here : leaves(a, here, stops[1]),
      ...via,
      pinned[1] ? there : leaves(b, there, stops[stops.length - 2])
    ]);
  }

  const shapeOf = (edge) => (edge?.route === "curved" || edge?.route === "straight"
    ? edge.route
    : "angled");

  // Halfway along, measured rather than guessed, so a label on a route that
  // goes the long way round is on the part of it that goes the long way round.
  function midpoint(points) {
    const lengths = [];
    let total = 0;

    for (let index = 0; index < points.length - 1; index += 1) {
      const length = Math.hypot(points[index + 1][0] - points[index][0],
        points[index + 1][1] - points[index][1]);
      lengths.push(length);
      total += length;
    }

    let walked = 0;

    for (let index = 0; index < lengths.length; index += 1) {
      if (walked + lengths[index] >= total / 2) {
        const into = lengths[index] === 0 ? 0 : ((total / 2) - walked) / lengths[index];
        return {
          x: points[index][0] + ((points[index + 1][0] - points[index][0]) * into),
          y: points[index][1] + ((points[index + 1][1] - points[index][1]) * into)
        };
      }

      walked += lengths[index];
    }

    return { x: points[0][0], y: points[0][1] };
  }

  /* One arrow's geometry, on its own, so that dragging a box can re-route the
   * arrows that touch it without redrawing anything else.
   */
  function routeEdge(layout, edge, spread) {
    const from = layout[edge.from];
    const to = layout[edge.to];

    if (!from || !to) {
      return null;
    }

    const shape = shapeOf(edge);
    const guided = from !== to
      && (pinnedSides(edge).some(Boolean) || wayPoints(edge).length > 0);

    let points;
    if (shape === "straight" && from !== to) {
      points = straightThrough(from, to, edge, spread);
    } else if (guided) {
      points = guidedRoute(from, to, edge, spread);
    } else {
      points = routeBetween(from, to, obstaclesFor(layout, edge.from, edge.to), spread);
    }

    const drawn = stopShort(points, edge);
    return {
      points,
      d: shape === "curved" ? pathCurved(drawn) : pathData(drawn),
      mid: midpoint(points)
    };
  }

  /* How far short of the box a line stops when there is a shape drawn at that
   * end.
   *
   * A box's border is centred on its edge, so half of it is drawn outside the
   * box — over the arrowhead, if the arrowhead is right up against it. And the
   * boxes are drawn after the arrows, so what is drawn over wins. Two pixels
   * clears the ordinary 1.5px border, the 2.5px one a box being pointed at
   * wears, and the 4px one a box can be given.
   *
   * Only where there is something to clear: a plain line still meets the box it
   * joins, or every line in every diagram would hold itself two pixels away for
   * the sake of arrowheads that are not there.
   */
  const END_CLEARANCE = 2;

  function pullBack(points, amount) {
    const last = points.length - 1;
    if (last < 1) {
      return points;
    }

    const [x1, y1] = points[last - 1];
    const [x2, y2] = points[last];
    const length = Math.hypot(x2 - x1, y2 - y1);

    // A segment shorter than the clearance is one where moving the end back
    // would put it behind its own start.
    if (!(length > amount)) {
      return points;
    }

    const left = (length - amount) / length;
    const shorter = points.slice();
    shorter[last] = [x1 + ((x2 - x1) * left), y1 + ((y2 - y1) * left)];
    return shorter;
  }

  function stopShort(points, edge) {
    const [back, forward] = endsOf(edge);
    let drawn = points;

    if (forward !== "none") {
      drawn = pullBack(drawn, END_CLEARANCE);
    }

    if (back !== "none") {
      drawn = pullBack([...drawn].reverse(), END_CLEARANCE).reverse();
    }

    return drawn;
  }

  /* How far off the middle each arrow leaves its box.
   *
   * Worked out for the whole list at once, because the answer for one arrow
   * depends on how many others join the same two boxes. Keyed on the pair
   * without regard to which way round it is: an arrow back is still the same
   * pair of boxes and still needs its own lane.
   */

  global.DdRoute = {
    hits, clear, tidy, selfLoop, routeBetween, anchorOn, autoSides, wayPoints, sideTowards,
    pinnedSides, guidedRoute, pathData, pathCurved, middleOf, straightBetween,
    straightThrough, shapeOf, midpoint, routeEdge, pullBack, stopShort
  };
})(typeof window === "undefined" ? globalThis : window);
