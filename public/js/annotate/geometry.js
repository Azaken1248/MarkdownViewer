/* The maths behind the ink: smoothing it, drawing it, and guessing what it was.
 *
 * All of it is pure — points in, points or a path string out — so the part of
 * this feature most likely to be subtly wrong is the part that can be checked
 * without a browser, a pointer or a canvas. The suite feeds it synthetic
 * strokes and asserts what it makes of them.
 *
 * Coordinates are in the document's own space rather than the viewport's, so a
 * stroke stays on the paragraph it was drawn over while the page scrolls.
 */

/* exported AnnotateGeometry */
var AnnotateGeometry = (function () {
  "use strict";

  const distance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

  function pathLength(points) {
    let total = 0;
    for (let i = 1; i < points.length; i += 1) {
      total += distance(points[i - 1], points[i]);
    }

    return total;
  }

  function boundsOf(points) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const [x, y] of points) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }

    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  }

  const centroidOf = (points) => [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length
  ];

  /* --- Handwriting enhancement -------------------------------------------
   *
   * A pointer reports a jagged line: the hand shakes, and the device samples
   * on its own schedule rather than on the hand's. Two passes fix most of it.
   *
   * First the points are resampled to an even spacing, because a slow hand
   * leaves a dense clump and a fast one a sparse dash, and a smoother that
   * averages over a count rather than a distance treats those differently.
   * Then a moving average takes out the tremor.
   */
  function resample(points, spacing) {
    if (points.length < 2 || spacing <= 0) {
      return points.slice();
    }

    const out = [points[0]];
    let carried = 0;

    for (let i = 1; i < points.length; i += 1) {
      const from = points[i - 1];
      const to = points[i];
      const segment = distance(from, to);

      if (segment === 0) {
        continue;
      }

      let travelled = spacing - carried;
      while (travelled <= segment) {
        const t = travelled / segment;
        out.push([from[0] + ((to[0] - from[0]) * t), from[1] + ((to[1] - from[1]) * t)]);
        travelled += spacing;
      }

      carried = segment - (travelled - spacing);
    }

    /* A stroke ends where the pen came up, always.
     *
     * The even spacing almost never divides the last segment exactly, and
     * dropping the remainder left the stroke ending up to half a step short
     * of where it was drawn to. If there is room for one more sample it is
     * the real end; if there is not, the sample nearest it is moved onto it.
     */
    const last = points[points.length - 1];
    if (distance(out[out.length - 1], last) > spacing / 2) {
      out.push(last);
    } else if (out.length > 1) {
      out[out.length - 1] = last;
    }

    return out;
  }

  /* A curve through the points, as cubics.
   *
   * The quadratic version of this put its control point on the sample and its
   * ends on the midpoints either side, which is cheap and always slightly
   * wrong: the curve passes through the midpoints and only near the samples,
   * so every bend is flattened a little and a loop of handwriting comes out
   * looking deflated.
   *
   * Catmull-Rom passes through every sample, and converts to a cubic bezier
   * exactly — the two control points are a sixth of the way along the
   * neighbouring span. That is the difference between ink that follows the
   * hand and ink that approximates it.
   */
  function throughPointsCubic(points) {
    if (points.length < 2) {
      return points.length === 1 ? `M ${round(points[0][0])} ${round(points[0][1])}` : "";
    }

    let d = `M ${round(points[0][0])} ${round(points[0][1])}`;

    for (let i = 0; i < points.length - 1; i += 1) {
      const before = points[Math.max(0, i - 1)];
      const from = points[i];
      const to = points[i + 1];
      const after = points[Math.min(points.length - 1, i + 2)];

      const c1 = [from[0] + ((to[0] - before[0]) / 6), from[1] + ((to[1] - before[1]) / 6)];
      const c2 = [to[0] - ((after[0] - from[0]) / 6), to[1] - ((after[1] - from[1]) / 6)];

      d += ` C ${round(c1[0])} ${round(c1[1])} ${round(c2[0])} ${round(c2[1])}`
        + ` ${round(to[0])} ${round(to[1])}`;
    }

    return d;
  }

  // The ends are left alone: a stroke that starts where the pen landed is a
  // stroke that goes where it was aimed.
  function smooth(points, window = 2) {
    if (points.length < 3) {
      return points.slice();
    }

    const out = [points[0]];

    for (let i = 1; i < points.length - 1; i += 1) {
      const from = Math.max(0, i - window);
      const to = Math.min(points.length - 1, i + window);
      let x = 0;
      let y = 0;

      for (let at = from; at <= to; at += 1) {
        x += points[at][0];
        y += points[at][1];
      }

      out.push([x / (to - from + 1), y / (to - from + 1)]);
    }

    out.push(points[points.length - 1]);
    return out;
  }

  /* Smoothed twice, the second time gently.
   *
   * One wide averaging window takes the shake out but rounds off the corners
   * of a letter with it. Two narrow passes come to much the same strength
   * while following the line more closely, because a box filter applied twice
   * is a bell rather than a rectangle.
   */
  const enhance = (points, spacing = 2.5) => smooth(smooth(resample(points, spacing)), 1);

  /* More samples along the same line, so the point eraser has something to cut.
   *
   * A stroke is simplified before it is stored, so a straight underline is two
   * samples a hundred pixels apart. Rubbing at its middle touched neither of
   * them and the line survived whole: the eraser has to work against the line,
   * not against whichever samples happen to be left of it. Only segments
   * longer than `step` are divided, and every sample added sits exactly on the
   * segment it came from, so the shape is untouched.
   */
  function densify(points, step) {
    if (points.length < 2 || step <= 0) {
      return points.slice();
    }

    const out = [points[0]];

    for (let i = 1; i < points.length; i += 1) {
      const pieces = Math.ceil(distance(points[i - 1], points[i]) / step);

      for (let piece = 1; piece < pieces; piece += 1) {
        out.push(between(points[i - 1], points[i], piece / pieces));
      }

      out.push(points[i]);
    }

    return out;
  }

  // Every component, pressure included: a sample that arrived without one
  // would be a thin spot in the middle of a line nobody pressed differently.
  function between(from, to, t) {
    const at = [from[0] + ((to[0] - from[0]) * t), from[1] + ((to[1] - from[1]) * t)];

    if (from.length > 2 && to.length > 2) {
      at.push(from[2] + ((to[2] - from[2]) * t));
    }

    return at;
  }

  /* The same marks on a surface that has changed size.
   *
   * Zooming the page, or resizing the window, reflows the document under the
   * ink: the column gets narrower, the text takes more lines, and everything
   * moves. Strokes held at fixed coordinates then sit over the wrong words,
   * which reads as the annotations breaking.
   *
   * They cannot be kept exactly — text reflows in ways no transform can
   * follow — but they can keep their place in the document instead of their
   * place on a page that no longer exists. Each stroke remembers the size of
   * the surface it was drawn on, and is scaled by how that has changed, so a
   * note two thirds of the way down stays two thirds of the way down.
   */
  function scalePoints(points, factorX, factorY) {
    if (factorX === 1 && factorY === 1) {
      return points;
    }

    return points.map((point) => {
      const scaled = [point[0] * factorX, point[1] * factorY];
      // The third value is nib pressure, not a coordinate, so it is carried
      // across untouched.
      return point.length > 2 ? scaled.concat(point.slice(2)) : scaled;
    });
  }

  /* --- Drawing ------------------------------------------------------------
   *
   * A path through the points rather than between them: straight segments
   * show every sample as a corner, and at handwriting size that reads as a
   * wobble. Each step is a quadratic curve whose control point is the sample
   * and whose ends are the midpoints either side of it — the cheapest curve
   * that passes smoothly through a run of points.
   */
  const round = (value) => Math.round(value * 10) / 10;

  function toPath(points) {
    if (points.length === 0) {
      return "";
    }

    if (points.length === 1) {
      // A tap is a dot, and a path of no length draws nothing — so it is drawn
      // as the shortest line there is and made round by the line cap.
      const [x, y] = points[0];
      return `M ${round(x)} ${round(y)} L ${round(x + 0.01)} ${round(y)}`;
    }

    let d = `M ${round(points[0][0])} ${round(points[0][1])}`;

    for (let i = 1; i < points.length - 1; i += 1) {
      const [cx, cy] = points[i];
      const midX = (cx + points[i + 1][0]) / 2;
      const midY = (cy + points[i + 1][1]) / 2;
      d += ` Q ${round(cx)} ${round(cy)} ${round(midX)} ${round(midY)}`;
    }

    const last = points[points.length - 1];
    return `${d} L ${round(last[0])} ${round(last[1])}`;
  }

  /* --- What ink actually looks like ---------------------------------------
   *
   * A stroked path of one width is a wire, not a pen. Every real writing
   * instrument puts down more ink where the hand slows and less where it
   * hurries, and it is that taper — not the smoothing — that makes a stroke
   * read as handwriting rather than as a plotted line.
   *
   * So a stroke is drawn as a filled outline instead: the centreline is
   * walked, a half-width is taken at each point, and the two offset edges are
   * joined into one closed shape. The half-width comes from the speed of the
   * hand, and from stylus pressure where the device reports it.
   */

  // A unit vector at right angles to the direction of travel.
  function normalAt(points, index) {
    const before = points[Math.max(0, index - 1)];
    const after = points[Math.min(points.length - 1, index + 1)];
    const dx = after[0] - before[0];
    const dy = after[1] - before[1];
    const span = Math.hypot(dx, dy);

    return span === 0 ? [0, 0] : [-dy / span, dx / span];
  }

  /* How wide the nib is along the stroke.
   *
   * Fast is thin, slow is fat, and the change is eased rather than followed
   * exactly — a nib that tracks every jitter in the sampling rate wobbles in
   * width, which looks worse than no taper at all. `pressures` is used when
   * the device gave any; a mouse gives none and gets speed alone.
   */
  // How many samples at each end the nib is lifting over. A pen touching down
  // and leaving leaves a point, not a blunt end, and this is what draws that.
  /* How far in from each end the nib lifts, in samples, and how far it lifts.
   *
   * A pen lands and leaves, so a stroke of one width to both its ends looks
   * printed rather than written. But fifteen pixels of taper down to a
   * hairline made every letter wispy at the size somebody actually writes at,
   * which is the wrong end of the trade: the taper is shorter now and stops
   * well short of nothing.
   */
  const TAPER = 3;
  const TAPER_FLOOR = 0.6;

  function taperAt(index, count) {
    const fromStart = Math.min(1, (index + 1) / TAPER);
    const fromEnd = Math.min(1, (count - index) / TAPER);
    // Eased rather than linear: a straight ramp makes a wedge, a curve makes
    // a nib.
    return TAPER_FLOOR + ((1 - TAPER_FLOOR) * Math.sqrt(Math.min(fromStart, fromEnd)));
  }

  function nibWidths(points, baseWidth, pressures) {
    const widths = [];
    const half = baseWidth / 2;
    let eased = half * 0.8;

    for (let i = 0; i < points.length; i += 1) {
      const step = i === 0 ? 0 : distance(points[i - 1], points[i]);
      // Beyond this the hand is moving fast enough that the line is at its
      // thinnest; below it, at its fattest.
      const hurry = Math.min(1, step / 9);
      const fromSpeed = 1 - (hurry * 0.45);
      const fromPressure = pressures && pressures[i] > 0
        ? 0.55 + (pressures[i] * 0.75)
        : 1;

      /* Eased gently, because the nib should not follow every sample.
       *
       * At 0.35 the width tracked the sampling noise and the stroke rippled
       * along its length — worse than no taper at all. A slower follow means
       * the thickness changes over the length of a letter rather than over
       * three samples, which is what a real pen does.
       */
      const wanted = half * fromSpeed * fromPressure;
      eased += (wanted - eased) * 0.12;
      widths.push(Math.max(baseWidth * 0.3, eased * taperAt(i, points.length)));
    }

    return widths;
  }

  /* The two edges of the nib, joined into one closed shape.
   *
   * Out along one side and back along the other, with the ends rounded off so
   * a stroke starts and stops like a pen leaving paper rather than like a cut
   * length of tape.
   */
  function inkOutline(points, baseWidth, pressures) {
    if (points.length === 0) {
      return "";
    }

    if (points.length === 1) {
      // A tap is a dot the size of the nib.
      const [x, y] = points[0];
      const r = round(baseWidth / 2);
      return `M ${round(x - (baseWidth / 2))} ${round(y)} a ${r} ${r} 0 1 0 ${round(baseWidth)} 0`
        + ` a ${r} ${r} 0 1 0 ${round(-baseWidth)} 0 Z`;
    }

    const widths = nibWidths(points, baseWidth, pressures);
    const left = [];
    const right = [];

    for (let i = 0; i < points.length; i += 1) {
      const [nx, ny] = normalAt(points, i);
      const half = widths[i];
      left.push([points[i][0] + (nx * half), points[i][1] + (ny * half)]);
      right.push([points[i][0] - (nx * half), points[i][1] - (ny * half)]);
    }

    const end = points.length - 1;
    const capAt = (side, i, sweep) =>
      `A ${round(widths[i])} ${round(widths[i])} 0 0 ${sweep} ${round(side[i][0])} ${round(side[i][1])}`;

    // Out along one edge, round the end, back along the other, round again.
    // Cubics on both edges, so the outline follows the hand as closely as the
    // centreline does.
    return `${throughPointsCubic(left)} ${capAt(right, end, 1)}`
      + ` ${throughPointsCubic(right.slice().reverse()).replace(/^M [^ ]+ [^ ]+/, "")}`
      + ` ${capAt(left, 0, 1)} Z`;
  }

  // The same smooth walk toPath uses, without the opening move when it is
  // being appended to something already under way.
  function throughPoints(points) {
    if (points.length < 2) {
      return points.length === 1 ? `M ${round(points[0][0])} ${round(points[0][1])}` : "";
    }

    let d = `M ${round(points[0][0])} ${round(points[0][1])}`;
    for (let i = 1; i < points.length - 1; i += 1) {
      const [cx, cy] = points[i];
      const midX = (cx + points[i + 1][0]) / 2;
      const midY = (cy + points[i + 1][1]) / 2;
      d += ` Q ${round(cx)} ${round(cy)} ${round(midX)} ${round(midY)}`;
    }

    const last = points[points.length - 1];
    return `${d} L ${round(last[0])} ${round(last[1])}`;
  }

  /* --- Ink to shape -------------------------------------------------------
   *
   * What a stroke was probably meant to be. The decision is made on the
   * simplified outline rather than on the samples: a hand-drawn rectangle has
   * four corners and several hundred points, and it is the corners that say
   * what it is.
   */

  function perpendicularDistance(point, from, to) {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const span = Math.hypot(dx, dy);

    if (span === 0) {
      return distance(point, from);
    }

    return Math.abs((dy * point[0]) - (dx * point[1]) + (to[0] * from[1]) - (to[1] * from[0])) / span;
  }

  // Ramer-Douglas-Peucker: drop every point within `tolerance` of the line
  // between the points that survive, which is what leaves the corners.
  function simplify(points, tolerance) {
    if (points.length < 3) {
      return points.slice();
    }

    const first = points[0];
    const last = points[points.length - 1];
    let worst = 0;
    let at = 0;

    for (let i = 1; i < points.length - 1; i += 1) {
      const away = perpendicularDistance(points[i], first, last);
      if (away > worst) {
        worst = away;
        at = i;
      }
    }

    if (worst <= tolerance) {
      return [first, last];
    }

    return simplify(points.slice(0, at + 1), tolerance)
      .slice(0, -1)
      .concat(simplify(points.slice(at), tolerance));
  }

  // How far the stroke strays from the straight line between its ends, as a
  // fraction of how long that line is.
  function straightness(points) {
    const span = distance(points[0], points[points.length - 1]);
    if (span === 0) {
      return Infinity;
    }

    let worst = 0;
    for (const point of points) {
      worst = Math.max(worst, perpendicularDistance(point, points[0], points[points.length - 1]));
    }

    return worst / span;
  }

  // A stroke that ends near where it started, relative to how far it went.
  const isClosed = (points) =>
    distance(points[0], points[points.length - 1]) < pathLength(points) * 0.22;

  /* How elliptical a closed stroke is: the spread of its distances from the
   * centre, once the bounding box has been squashed into a square.
   *
   * Measured raw, this only ever recognised circles — an oval 90 wide and 40
   * tall has radii from 40 to 90 and a spread far past any sensible thresh-
   * old, so every ellipse that was not round was left as ink. Dividing each
   * axis by its own half-extent first makes the question "is this the same
   * shape all the way round" rather than "is this the same size all the way
   * round", which is the one that was meant.
   *
   * A rectangle still fails it: normalised, its corners sit at 1.41 and the
   * middles of its edges at 1.0.
   */
  function radialSpread(points) {
    /* Measured in the shape's own frame.
     *
     * Normalising by the upright bounding box only makes an oval round again
     * when the oval was drawn upright: a ring drawn at a slant came out with
     * a spread far too wide to be recognised, and stayed a wobbly freehand
     * loop. Turning it flat first asks the question that was meant — is this
     * round? — rather than is this round and square to the page.
     */
    return spreadOf(points.map((point) => turn(point, -orientedBox(points))));
  }

  function spreadOf(points) {
    const bounds = boundsOf(points);
    const rx = bounds.width / 2;
    const ry = bounds.height / 2;

    if (rx === 0 || ry === 0) {
      return Infinity;
    }

    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const radii = points.map(([x, y]) => Math.hypot((x - cx) / rx, (y - cy) / ry));
    const mean = radii.reduce((sum, radius) => sum + radius, 0) / radii.length;

    if (mean === 0) {
      return Infinity;
    }

    const variance = radii.reduce((sum, radius) => sum + ((radius - mean) ** 2), 0) / radii.length;
    return Math.sqrt(variance) / mean;
  }

  /* The rules, in the order they are asked.
   *
   * Deliberately hard to satisfy: turning somebody's handwriting into a
   * rectangle is far worse than leaving a wonky rectangle alone, so each of
   * these has to be clearly met rather than merely the closest match.
   */
  const SHAPE_RULES = [
    { kind: "line", matches: (facts) => !facts.closed && facts.straightness < 0.06 },

    /* Corners before curves.
     *
     * A rectangle passes the ellipse test: squashed into a square its corners
     * sit at 1.41 and the middles of its edges at 1.0, which is a tighter
     * spread than it sounds. What actually tells the two apart is that a
     * rectangle has four corners and a circle has none — so the shapes that
     * are defined by their corners are asked about first, and the ellipse
     * takes what is left and has to be round as well.
     */
    { kind: "triangle", matches: (facts) => facts.closed && facts.corners === 3 },
    { kind: "rectangle", matches: (facts) => facts.closed && facts.corners >= 4 && facts.corners <= 5 },
    { kind: "ellipse", matches: (facts) => facts.closed && facts.corners >= 6 && facts.radialSpread < 0.16 }
  ];

  // Too small to have been aimed at anything.
  /* Below this, a stroke is taken for writing rather than for a shape.
   *
   * At twelve pixels it was anything at all, and a handwritten O became a
   * perfect ellipse while an l became a ruled line — which is not tidying
   * somebody's handwriting, it is replacing it. A deliberate shape drawn to
   * mark up a document is a ring round a word or a box round a paragraph, and
   * both are far bigger than the letters they are drawn over. Sixty pixels
   * is above a comfortably written capital and well below a ring round a
   * word, which is the gap this has to sit in.
   */
  const TOO_SMALL = 60;

  function factsAbout(points, diagonal) {
    const closed = isClosed(points);
    const outline = simplify(points, diagonal * 0.07);

    return {
      closed,
      outline,
      straightness: straightness(points),
      radialSpread: closed ? radialSpread(points) : Infinity,
      // A closed outline repeats its first point at the end; the corners are
      // what is left once that is discounted.
      corners: Math.max(0, outline.length - (closed ? 1 : 0))
    };
  }

  /* What this stroke looks like, or null for "leave it as ink". */
  function recognise(points) {
    if (points.length < 4) {
      return null;
    }

    const bounds = boundsOf(points);
    const diagonal = Math.hypot(bounds.width, bounds.height);

    if (diagonal < TOO_SMALL) {
      return null;
    }

    const facts = factsAbout(points, diagonal);
    const rule = SHAPE_RULES.find((one) => one.matches(facts));
    return rule ? { kind: rule.kind, bounds, outline: facts.outline, ink: points } : null;
  }

  /* --- Fitting the tidy shape to the ink ---------------------------------
   *
   * The first version drew every shape inside the stroke's axis-aligned
   * bounding box, which is only right when the shape was drawn square to the
   * page. A box drawn at a slant came back upright and half again as large,
   * because the bounding box of a tilted rectangle is much bigger than the
   * rectangle inside it. These fit the shape to the ink instead: its own
   * angle, its own middle, and a nudge to square only when it was very nearly
   * square already.
   */

  const cross = (o, a, b) =>
    (((a[0] - o[0]) * (b[1] - o[1])) - ((a[1] - o[1]) * (b[0] - o[0])));

  const turn = (point, angle) => [
    (point[0] * Math.cos(angle)) - (point[1] * Math.sin(angle)),
    (point[0] * Math.sin(angle)) + (point[1] * Math.cos(angle))
  ];

  // The smallest convex ring the ink fits inside (Andrew's monotone chain).
  function convexHull(points) {
    const sorted = points.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));

    if (sorted.length < 3) {
      return sorted;
    }

    return halfHull(sorted).concat(halfHull(sorted.slice().reverse()));
  }

  function halfHull(sorted) {
    const out = [];

    for (const point of sorted) {
      while (out.length > 1 && cross(out[out.length - 2], out[out.length - 1], point) <= 0) {
        out.pop();
      }

      out.push(point);
    }

    out.pop();
    return out;
  }

  /* The smallest box round the ink, at whatever angle that box happens to be.
   *
   * One side of the smallest box always lies along an edge of the hull, which
   * is what makes this a search over a handful of angles rather than over all
   * of them.
   */
  function orientedBox(points) {
    const hull = convexHull(points);
    let best = null;

    for (let i = 0; i < hull.length; i += 1) {
      const from = hull[i];
      const to = hull[(i + 1) % hull.length];
      const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
      const box = boundsOf(hull.map((point) => turn(point, -angle)));
      const area = box.width * box.height;

      if (!best || area < best.area) {
        best = { area, angle, box };
      }
    }

    return best ? best.angle : 0;
  }

  /* Five degrees. Nobody drawing a box round a paragraph means it to be three
   * degrees off square, and anybody who tilts one on purpose tilts it further
   * than this.
   */
  const SQUARE_ENOUGH = 0.09;

  function squared(angle, step) {
    const nearest = Math.round(angle / step) * step;
    return Math.abs(angle - nearest) < SQUARE_ENOUGH ? nearest : angle;
  }

  // The ink measured along its own angle: where the shape sits, and how big it
  // is, in the frame it is going to be drawn in.
  function framed(points, angle) {
    const box = boundsOf(points.map((point) => turn(point, -angle)));
    return {
      angle,
      cx: (box.minX + box.maxX) / 2,
      cy: (box.minY + box.maxY) / 2,
      halfWidth: box.width / 2,
      halfHeight: box.height / 2
    };
  }

  const frameFor = (points) => framed(points, squared(orientedBox(points), Math.PI / 2));

  const placed = (frame, dx, dy) => turn([frame.cx + dx, frame.cy + dy], frame.angle);

  function fitRectangle(points) {
    const frame = frameFor(points);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
      .map(([x, y]) => placed(frame, x * frame.halfWidth, y * frame.halfHeight));

    return corners.concat([corners[0]]);
  }

  // An ellipse as points, so it draws, erases and saves the way everything
  // else does rather than being a second kind of thing.
  function ringOf(frame, steps = 48) {
    const out = [];

    for (let i = 0; i <= steps; i += 1) {
      const angle = (i / steps) * Math.PI * 2;
      out.push(placed(frame,
        frame.halfWidth * Math.cos(angle),
        frame.halfHeight * Math.sin(angle)));
    }

    return out;
  }

  const fitEllipse = (points) => ringOf(frameFor(points));

  // A drag is square to the page by definition: the two corners are all it
  // says, and there is no angle to find.
  const ellipseIn = (bounds) => ringOf({
    angle: 0,
    cx: (bounds.minX + bounds.maxX) / 2,
    cy: (bounds.minY + bounds.maxY) / 2,
    halfWidth: bounds.width / 2,
    halfHeight: bounds.height / 2
  });

  /* A straight line through the ink rather than between its ends.
   *
   * A stroke almost always hooks as the pen comes up, and a line drawn from
   * the first point to the last leans by however far that hook went. This is
   * the line the ink is scattered about — and if that is within five degrees
   * of flat, upright or a true diagonal, it is drawn as exactly that, which
   * is what somebody ruling a line under a sentence wanted.
   */
  function fitLine(points) {
    const middle = centroidOf(points);
    const angle = squared(principalAngle(points, middle), Math.PI / 4);
    const along = points.map((point) =>
      ((point[0] - middle[0]) * Math.cos(angle)) + ((point[1] - middle[1]) * Math.sin(angle)));

    return [Math.min(...along), Math.max(...along)].map((reach) => [
      middle[0] + (reach * Math.cos(angle)),
      middle[1] + (reach * Math.sin(angle))
    ]);
  }

  // The direction the ink mostly runs in: the first principal axis, which is
  // the least-squares line without the special case for a vertical one.
  function principalAngle(points, middle) {
    let xx = 0;
    let yy = 0;
    let xy = 0;

    for (const point of points) {
      const dx = point[0] - middle[0];
      const dy = point[1] - middle[1];
      xx += dx * dx;
      yy += dy * dy;
      xy += dx * dy;
    }

    return 0.5 * Math.atan2(2 * xy, xx - yy);
  }

  /* Straight from point to point, and closed if it comes back where it
   * started.
   *
   * `toPath` smooths a stroke through the middles of its segments, which is
   * right for ink and wrong for a shape: a rectangle drawn that way has no
   * corners left at all — five points became a blob. A shape that was tidied
   * into corners is drawn with them.
   */
  function cornerPath(points) {
    if (points.length < 2) {
      return toPath(points);
    }

    const closed = distance(points[0], points[points.length - 1]) < 0.5;
    const ring = closed ? points.slice(0, -1) : points;
    const d = ring
      .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${round(x)} ${round(y)}`)
      .join(" ");

    return closed ? `${d} Z` : d;
  }

  /* The clean version of what was drawn. */
  function shapePoints(shape) {
    if (shape.kind === "line") {
      return fitLine(shape.ink);
    }

    if (shape.kind === "rectangle") {
      return fitRectangle(shape.ink);
    }

    if (shape.kind === "triangle") {
      const corners = shape.outline.slice(0, 3);
      return corners.length === 3 ? corners.concat([corners[0]]) : shape.outline;
    }

    return fitEllipse(shape.ink);
  }

  /* A shape drawn on purpose, from the two corners of a drag.
   *
   * The same point lists the freehand tools produce, so everything downstream
   * — drawing, erasing, undo, saving — has one kind of thing to deal with.
   */
  function shapeFromDrag(kind, from, to) {
    const bounds = boundsOf([from, to]);

    if (kind === "line" || kind === "arrow") {
      return [from, to];
    }

    if (kind === "rectangle") {
      return [
        [bounds.minX, bounds.minY], [bounds.maxX, bounds.minY],
        [bounds.maxX, bounds.maxY], [bounds.minX, bounds.maxY],
        [bounds.minX, bounds.minY]
      ];
    }

    return ellipseIn(bounds);
  }

  /* The two short strokes of an arrowhead at the end of a line. */
  function arrowHead(from, to, size = 12) {
    const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
    const span = distance(from, to);
    // On a short arrow the head is the arrow, so it is kept in proportion.
    const length = Math.min(size, span * 0.4);
    const spread = Math.PI / 7;

    return [
      [to, [to[0] - (length * Math.cos(angle - spread)), to[1] - (length * Math.sin(angle - spread))]],
      [to, [to[0] - (length * Math.cos(angle + spread)), to[1] - (length * Math.sin(angle + spread))]]
    ];
  }

  function distanceToSegment(point, from, to) {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const lengthSquared = (dx * dx) + (dy * dy);

    if (lengthSquared === 0) {
      return distance(point, from);
    }

    let t = (((point[0] - from[0]) * dx) + ((point[1] - from[1]) * dy)) / lengthSquared;
    t = Math.max(0, Math.min(1, t));
    return distance(point, [from[0] + (t * dx), from[1] + (t * dy)]);
  }

  /* Does this stroke come within `radius` of this point?
   *
   * What the eraser asks. Distance to each segment rather than to each sample,
   * or a quick drag across a straight line would pass between two points and
   * rub out nothing.
   */
  function nearPoint(points, target, radius) {
    if (points.length === 1) {
      return distance(points[0], target) <= radius;
    }

    for (let i = 1; i < points.length; i += 1) {
      if (distanceToSegment(target, points[i - 1], points[i]) <= radius) {
        return true;
      }
    }

    return false;
  }

  return {
    distance, pathLength, boundsOf, centroidOf,
    resample, densify, smooth, enhance, toPath, cornerPath,
    normalAt, nibWidths, inkOutline, throughPoints, throughPointsCubic, taperAt,
    scalePoints,
    simplify, perpendicularDistance, straightness, isClosed, radialSpread,
    recognise, shapePoints, shapeFromDrag, arrowHead,
    convexHull, orientedBox, fitLine, fitRectangle, fitEllipse,
    nearPoint, distanceToSegment
  };
})();
