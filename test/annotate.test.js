/* Writing on a shared document: the maths, and where it is kept.
 *
 * The two halves of this feature that can be checked without a pointer. The
 * geometry is pure — points in, points out — and it is where the feature is
 * most likely to be subtly wrong: shape recognition that fires on handwriting
 * is worse than shape recognition that never fires at all, and neither shows
 * up as an error anywhere. So the strokes here are drawn by hand, in code,
 * with a repeatable wobble on them, and the suite asserts what is made of
 * each one.
 *
 * The pointer, the toolbar and the SVG are the share page's business and are
 * checked in the DOM suite.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createChecker } = require("./helpers/check.js");

const { check, finish } = createChecker("ANNOTATE");
const ROOT = path.join(__dirname, "..", "public", "js");

// Plain scripts whose top-level `var` is the namespace, run the way a page
// runs them rather than required.
global.window = /** @type {any} */ (globalThis);
for (const file of ["annotate/geometry.js", "annotate/store.js"]) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, file), "utf8"), { filename: file });
}

const G = globalThis.AnnotateGeometry;
const Store = globalThis.AnnotateStore;

/* A hand that shakes the same way every run.
 *
 * Random jitter would make this suite pass and fail on its own schedule, so
 * the wobble comes from a fixed sequence: the strokes below are always the
 * same strokes.
 */
let seed = 7;
function wobble(amount) {
  seed = ((seed * 1103515245) + 12345) % 2147483648;
  return (((seed / 2147483648) - 0.5) * 2) * amount;
}

const drawLine = (from, to, count, jitter) => Array.from({ length: count }, (_, i) => {
  const t = i / (count - 1);
  return [
    from[0] + ((to[0] - from[0]) * t) + wobble(jitter),
    from[1] + ((to[1] - from[1]) * t) + wobble(jitter)
  ];
});

function drawPolygon(corners, perSide, jitter) {
  const out = [];
  for (let i = 0; i < corners.length; i += 1) {
    const from = corners[i];
    const to = corners[(i + 1) % corners.length];
    out.push(...drawLine(from, to, perSide, jitter).slice(0, -1));
  }

  out.push(corners[0]);
  return out;
}

// Centre and radii as pairs rather than four loose numbers: six parameters is
// over the limit the `limits` suite holds at zero, and a centre is one thing.
const drawEllipse = ([cx, cy], [rx, ry], count, jitter) => Array.from({ length: count }, (_, i) => {
  const angle = (i / (count - 1)) * Math.PI * 2;
  return [cx + (rx * Math.cos(angle)) + wobble(jitter), cy + (ry * Math.sin(angle)) + wobble(jitter)];
});

// The thing that must never be mistaken for a shape.
const drawHandwriting = (count) => Array.from({ length: count }, (_, i) => {
  const t = i / count;
  return [20 + (t * 180), 60 + (Math.sin(t * 22) * 18) + wobble(3)];
});

const kindOf = (points) => (G.recognise(points) || {}).kind || null;

console.log("=== a stroke is turned into what it was meant to be ===");

check("a line drawn by hand is a line", kindOf(drawLine([10, 10], [220, 60], 60, 1.5)), "line");
check("...and still is when the hand is unsteady",
  kindOf(drawLine([10, 10], [220, 60], 60, 6)), "line");
check("a circle is an ellipse", kindOf(drawEllipse([100, 100], [60, 60], 80, 2)), "ellipse");

/* An oval used to come back as nothing.
 *
 * The roundness test measured the spread of the distances from the centre,
 * which for something 90 wide and 40 tall is enormous however neatly it was
 * drawn — so only circles were ever recognised. Squashing the bounding box
 * into a square first asks the question that was meant.
 */
check("...and so is an oval", kindOf(drawEllipse([100, 100], [90, 40], 80, 2)), "ellipse");

check("a rectangle is a rectangle",
  kindOf(drawPolygon([[20, 20], [200, 20], [200, 120], [20, 120]], 25, 2)), "rectangle");
check("a triangle is a triangle",
  kindOf(drawPolygon([[100, 20], [190, 150], [10, 150]], 30, 2)), "triangle");

console.log("=== and left alone when it was not meant to be anything ===");

/* The bias that matters. Turning somebody's handwriting into a rectangle is
 * far worse than leaving a wonky rectangle wonky, so every rule has to be
 * clearly met rather than merely the closest fit.
 */
check("handwriting is not a shape", kindOf(drawHandwriting(200)), null);
check("an arc is not a line", kindOf(Array.from({ length: 60 }, (_, i) => {
  const t = i / 59;
  return [10 + (t * 210), 10 + (Math.sin(t * Math.PI) * 70)];
})), null);
check("a tap is not a shape", kindOf([[5, 5], [6, 5], [6, 6], [5, 6]]), null);
check("two points are not a shape", kindOf([[0, 0], [50, 50]]), null);

console.log("=== a recognised shape comes back clean ===");

const circle = G.recognise(drawEllipse([200, 200], [70, 70], 80, 3));
const cleaned = G.shapePoints(circle);
check("an ellipse is redrawn as a proper one", cleaned.length > 40, true);
check("...centred where it was drawn",
  G.centroidOf(cleaned).map((n) => Math.round(n / 10) * 10), [200, 200]);

const boxy = G.recognise(drawPolygon([[20, 20], [200, 20], [200, 120], [20, 120]], 25, 2));
const corners = G.shapePoints(boxy);
check("a rectangle is redrawn square", corners.length, 5);
check("...closing back on its first corner", corners[0], corners[corners.length - 1]);

console.log("=== handwriting enhancement ===");

const rough = drawLine([0, 0], [200, 0], 80, 5);
const smoothed = G.enhance(rough);
const interiorWobble = (points) => Math.sqrt(points.slice(1, -1)
  .reduce((sum, point) => sum + (point[1] * point[1]), 0) / (points.length - 2));

check("the shake is taken out", interiorWobble(smoothed) < interiorWobble(rough) * 0.75, true);

// The ends are where the pen landed and where it left. Moving those makes a
// stroke that does not start where it was aimed.
check("the first point is exactly where the pen went down", smoothed[0], rough[0]);
check("...and the last is where it came up",
  smoothed[smoothed.length - 1], rough[rough.length - 1]);

// Resampling is what makes the smoothing even-handed: a slow hand leaves a
// dense clump of samples and a fast one a sparse dash.
const uneven = [[0, 0], [1, 0], [2, 0], [3, 0], [100, 0]];
const even = G.resample(uneven, 10);
const gaps = even.slice(1).map((point, i) => G.distance(even[i], point));
check("resampling spaces the points evenly",
  gaps.every((gap) => gap > 9 && gap < 11), true);

console.log("=== drawing it ===");

check("a single point still draws, as a dot", G.toPath([[5, 5]]).startsWith("M 5 5 L"), true);
check("nothing draws nothing", G.toPath([]), "");
check("a stroke is curves rather than corners",
  (G.toPath(drawLine([0, 0], [100, 100], 20, 1)).match(/Q/g) || []).length > 10, true);

console.log("=== what the eraser touches ===");

const stroke = [[0, 0], [100, 0]];
check("a rub across the middle of a segment finds it", G.nearPoint(stroke, [50, 4], 6), true);
check("...and one well away from it does not", G.nearPoint(stroke, [50, 40], 6), false);
check("a dot is found by what lands on it", G.nearPoint([[10, 10]], [12, 12], 6), true);

console.log("=== a shape drawn on purpose ===");

check("a dragged rectangle has five corners",
  G.shapeFromDrag("rectangle", [10, 10], [50, 40]).length, 5);
check("...and is the right way round however it was dragged",
  G.boundsOf(G.shapeFromDrag("rectangle", [50, 40], [10, 10])),
  G.boundsOf(G.shapeFromDrag("rectangle", [10, 10], [50, 40])));
check("a dragged line is two points", G.shapeFromDrag("line", [0, 0], [10, 10]).length, 2);
check("an arrowhead is two strokes", G.arrowHead([0, 0], [100, 0]).length, 2);

console.log("=== where the marks are kept ===");

/* localStorage, standing in. The real one belongs to a browser; what is under
 * test is that a stroke survives the round trip and that a broken entry is
 * treated as no entry rather than as an error.
 */
const saved = new Map();
globalThis.window.localStorage = /** @type {any} */ ({
  getItem: (key) => (saved.has(key) ? saved.get(key) : null),
  setItem: (key, value) => saved.set(key, String(value)),
  removeItem: (key) => saved.delete(key)
});

const strokes = [
  { tool: "pen", colour: "#eb6f6a", width: 4, points: [[1.234, 2.345], [10, 20]] },
  { tool: "highlighter", colour: "#e0a94a", width: 8, points: [[5, 5], [50, 5]] }
];

check("saving says it saved", Store.save("token-a", strokes).saved, true);
check("...and it comes back", Store.load("token-a").length, 2);
check("...with the tools it went in with",
  Store.load("token-a").map((one) => one.tool), ["pen", "highlighter"]);
check("...rounded to a tenth of a pixel, which is past what anyone can point at",
  Store.load("token-a")[0].points[0], [1.2, 2.3]);

// Two shared documents in one browser keep their own marks.
Store.save("token-b", [strokes[0]]);
check("another document has its own", Store.load("token-b").length, 1);
check("...and has not disturbed the first", Store.load("token-a").length, 2);

check("a document nobody drew on has nothing", Store.load("token-c"), []);
check("clearing empties it", [Store.clear("token-a").saved, Store.load("token-a")], [true, []]);

// Saving nothing is clearing, so an undo back to the start leaves no leftovers.
Store.save("token-d", [strokes[0]]);
Store.save("token-d", []);
check("saving an empty document removes it rather than storing nothing",
  Store.load("token-d"), []);

console.log("=== and what it refuses to trust ===");

saved.set(Store.keyFor("bad-json"), "{not json");
check("unreadable storage is no storage", Store.load("bad-json"), []);

saved.set(Store.keyFor("wrong-version"), JSON.stringify({ v: 99, strokes: [strokes[0]] }));
check("a version this does not know is not read", Store.load("wrong-version"), []);

saved.set(Store.keyFor("junk"), JSON.stringify({
  v: Store.VERSION,
  strokes: [
    strokes[0],
    { tool: "pen" },
    { tool: "pen", colour: "#fff", width: "wide", points: [[0, 0]] },
    { tool: "pen", colour: "#fff", width: 2, points: [["x", 0]] }
  ]
}));
check("a stroke that is not a stroke is dropped, and the rest kept",
  Store.load("junk").length, 1);

// localStorage is a few megabytes for the whole origin and is shared with the
// theme and the outline; one document's ink must not take the lot.
const huge = [{
  tool: "pen", colour: "#fff", width: 2,
  points: Array.from({ length: 40000 }, (_, i) => [i, i])
}];
check("more ink than there is room for is refused rather than half-written",
  Store.save("token-huge", huge), { saved: false, reason: "too-big" });
check("...and nothing was written", Store.load("token-huge"), []);

process.exit(finish());
