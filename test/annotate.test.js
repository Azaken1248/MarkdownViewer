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

const path = require("path");
const { createChecker } = require("./helpers/check.js");
const { runAsScript } = require("./app-source.js");

const { check, finish } = createChecker("ANNOTATE");
const ROOT = path.join(__dirname, "..", "public", "js");

// Plain scripts whose top-level `var` is the namespace, run the way a page
// runs them rather than required. runAsScript names the file as it goes, so
// what this suite exercises is counted against it.
global.window = /** @type {any} */ (globalThis);
for (const file of ["annotate/geometry.js", "annotate/store.js"]) {
  runAsScript(path.join(ROOT, file));
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
// A letter is round, closed and about as regular as a hand-drawn ring — the
// only thing that tells them apart is how big they are.
check("a handwritten o is a letter, not a ring",
  kindOf(drawEllipse([100, 100], [14, 17], 40, 1.5)), null);
check("...and a ring drawn round a word is a ring",
  kindOf(drawEllipse([100, 100], [70, 40], 80, 2)), "ellipse");
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

/* Tidying has to leave the shape where it was drawn.
 *
 * The first version fitted everything into the stroke's upright bounding box,
 * so a box drawn at a slant came back upright and half again as large. These
 * draw the same rectangle at an angle and check it comes back the same size,
 * still at that angle.
 */
const tilt = (points, angle, [cx, cy]) => points.map(([x, y]) => [
  cx + ((x - cx) * Math.cos(angle)) - ((y - cy) * Math.sin(angle)),
  cy + ((x - cx) * Math.sin(angle)) + ((y - cy) * Math.cos(angle))
]);

const upright = [[20, 20], [200, 20], [200, 120], [20, 120]];
const slanted = G.shapePoints(G.recognise(tilt(drawPolygon(upright, 25, 2), 0.52, [110, 70])));
const sides = [0, 1, 2, 3].map((i) => G.distance(slanted[i], slanted[i + 1]));

check("a box drawn at a slant is still 180 by 100",
  sides.map((side) => Math.round(side / 10) * 10).sort((a, b) => a - b),
  [100, 100, 180, 180]);
check("...and is still at a slant, rather than stood upright",
  Math.round(G.boundsOf(slanted).width) > 200, true);

const nearly = G.shapePoints(G.recognise(tilt(drawPolygon(upright, 25, 1), 0.05, [110, 70])));
check("a box drawn three degrees off square is drawn square",
  nearly.slice(0, 4).map(([x]) => Math.round(x)).sort((a, b) => a - b).filter((x, i, all) => all.indexOf(x) === i).length,
  2);

// A hand lifts off sideways at the end of a stroke, and a line drawn from the
// first point to the last leans by however far that hook went.
const hooked = drawLine([10, 100], [210, 100], 40, 0.5).concat([[212, 105], [213, 109]]);
const ruled = G.fitLine(hooked);
check("a line drawn nearly flat is ruled flat", Math.round(ruled[0][1] - ruled[1][1]), 0);
check("...and one drawn on a slant keeps its slant",
  Math.round(G.fitLine(drawLine([0, 0], [200, 100], 40, 0.5))[1][1]) > 80, true);

console.log("=== drawn as the shape it became ===");

check("a tidied box is drawn with corners rather than curves",
  /Q/.test(G.cornerPath(slanted)), false);
check("...and closes on itself", G.cornerPath(slanted).endsWith("Z"), true);
check("a line is not closed", G.cornerPath([[0, 0], [10, 10]]).endsWith("Z"), false);
check("ink is still drawn as curves", /Q/.test(G.toPath(drawLine([0, 0], [100, 0], 20, 1))), true);

console.log("=== handwriting enhancement ===");

const rough = drawLine([0, 0], [200, 0], 80, 5);
const smoothed = G.enhance(rough);
const interiorWobble = (points) => Math.sqrt(points.slice(1, -1)
  .reduce((sum, point) => sum + (point[1] * point[1]), 0) / (points.length - 2));

check("the shake is taken out", interiorWobble(smoothed) < interiorWobble(rough) * 0.75, true);

/* The nib lands and lifts rather than appearing at full width, but only just:
 * a long taper down to a hairline made every letter wispy at the size
 * somebody actually writes at.
 */
const nib = G.nibWidths(G.enhance(drawLine([0, 0], [200, 0], 80, 1)), 6, null);
check("a stroke is thinner at its ends than in its middle",
  nib[0] < Math.max(...nib), true);
check("...but does not end in a hairline",
  Math.min(...nib) / Math.max(...nib) > 0.6, true);

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

/* The point eraser cuts the line, not the samples that happen to be left of
 * it. A stroke is simplified before it is stored, so a long underline is two
 * points a hundred pixels apart; rubbing at its middle has to divide it
 * first or it comes away with nothing.
 */
const long = [[0, 0], [100, 0]];
check("a long segment is divided into pieces the eraser can reach",
  G.densify(long, 10).length, 11);
check("...each one exactly on the line it came from",
  G.densify(long, 10).every(([, y]) => y === 0), true);
check("...and the ends left where they were",
  [G.densify(long, 10)[0], G.densify(long, 10)[10]], long);
check("a segment already short enough is left alone",
  G.densify([[0, 0], [4, 0]], 10), [[0, 0], [4, 0]]);
check("dividing an already divided stroke adds nothing",
  G.densify(G.densify(long, 10), 10).length, 11);
check("pressure is carried into the samples it makes",
  G.densify([[0, 0, 0.2], [10, 0, 0.8]], 5)[1].map((n) => Math.round(n * 100) / 100),
  [5, 0, 0.5]);

console.log("=== a shape drawn on purpose ===");

check("a dragged rectangle has five corners",
  G.shapeFromDrag("rectangle", [10, 10], [50, 40]).length, 5);
check("...and is the right way round however it was dragged",
  G.boundsOf(G.shapeFromDrag("rectangle", [50, 40], [10, 10])),
  G.boundsOf(G.shapeFromDrag("rectangle", [10, 10], [50, 40])));
check("a dragged line is two points", G.shapeFromDrag("line", [0, 0], [10, 10]).length, 2);
check("an arrowhead is two strokes", G.arrowHead([0, 0], [100, 0]).length, 2);

/* Joined-up writing is loops — the round of an e, the turn at the bottom of a
 * u — and an average wide enough to take a tremor out is wide enough to
 * flatten one. A tight wave stands in for them: the shake has to go and the
 * loop has to keep its size.
 */
const wave = (wavelength, jitter) => Array.from({ length: 300 }, (_, i) => {
  const x = i * 0.9;
  return [x, (Math.sin((x / wavelength) * Math.PI * 2) * 8) + wobble(jitter)];
});

const amplitude = (points) => {
  const ys = points.map(([, y]) => y);
  return (Math.max(...ys) - Math.min(...ys)) / 2;
};

check("a loop the size of a letter keeps its size",
  Math.abs(amplitude(G.enhance(wave(24, 1.5))) - 8) < 1, true);
check("...and so does an open hand", Math.abs(amplitude(G.enhance(wave(48, 1.5))) - 8) < 1, true);

// How hard the pen was pressed has to reach the nib. Resampling and smoothing
// both used to drop it on the floor, so a stylus drew the same line a mouse
// did.
const pressed = G.enhance(Array.from({ length: 60 }, (_, i) => [i * 3, 0, 0.1 + (i / 70)]));
check("pressure survives being resampled and smoothed",
  pressed.every((point) => point.length === 3), true);
check("...and still rises across the stroke",
  pressed[pressed.length - 1][2] > pressed[0][2] + 0.5, true);

const forces = G.nibWidths(pressed, 6, pressed.map((point) => point[2]));
check("...and a harder-pressed end draws wider",
  forces[forces.length - 3] > forces[2] * 1.2, true);

console.log("=== and the degenerate strokes every one of these has to survive ===");

/* A pointer can report the same place twice, a tap is one point, and a tool
 * that was pressed and released without moving is none at all. Every function
 * above is handed one of those sooner or later, and the answer has to be a
 * stroke rather than a crash or a NaN in a path — one bad `d` attribute takes
 * the whole layer with it, because an SVG with an unparseable path draws
 * nothing from that point on.
 */
check("a tap is a dot the size of the nib", G.inkOutline([[10, 10]], 6, null).startsWith("M"), true);
check("...and nothing at all is nothing", G.inkOutline([], 6, null), "");
check("one point is a move and no line", G.throughPointsCubic([[5, 5]]), "M 5 5");
check("...and none is an empty path", G.throughPointsCubic([]), "");
check("the walk without an opening move still opens one when it has to",
  G.throughPoints([[0, 0], [10, 0], [20, 10]]), "M 0 0 Q 10 0 15 5 L 20 10");
check("...and answers the same way for one point and for none",
  [G.throughPoints([[5, 5]]), G.throughPoints([])], ["M 5 5", ""]);

/* A pointer that reported the same place twice, which every one of these
 * walks a segment of. A segment of no length has no direction and nowhere to
 * put a sample on it, and dividing by its length is how NaN gets into a path.
 */
check("a repeated point is walked over rather than divided by",
  G.resample([[0, 0], [0, 0], [10, 0]], 2).every((point) => point.every(Number.isFinite)), true);
check("...and the stroke still comes back the length it was",
  Math.round(G.pathLength(G.resample([[0, 0], [0, 0], [10, 0]], 2))), 10);

check("a stroke of one point cannot be made denser", G.densify([[1, 1]], 2), [[1, 1]]);
check("...nor can one with no spacing to divide by",
  G.densify([[0, 0], [10, 0]], 0), [[0, 0], [10, 0]]);
// A pointer that reported the same place twice: a segment of no length has
// nowhere to put a sample, and dividing by it is how NaN gets into a path.
check("...and a repeated point adds nothing",
  G.densify([[0, 0], [0, 0], [10, 0]], 5).every((point) => point.every(Number.isFinite)), true);

check("a stroke too short to simplify comes back as it was",
  G.simplify([[0, 0], [5, 5]], 1), [[0, 0], [5, 5]]);
check("a hull of two points is the two points",
  G.convexHull([[0, 0], [5, 5]]), [[0, 0], [5, 5]]);
check("a point measured against a segment of no length is measured against the point",
  G.distanceToSegment([3, 4], [0, 0], [0, 0]), 5);

/* Roundness is a ratio, and both halves of it can be zero: a stroke drawn
 * along one line has no height, and one drawn on the spot has no radius at
 * all. Infinity is "not round", which is the answer that stops a straight
 * line being tidied into a circle.
 */
check("a stroke with no height is not round",
  G.radialSpread([[0, 0], [10, 0], [20, 0]]), Infinity);
check("...and neither is one drawn on the spot",
  G.radialSpread([[5, 5], [5, 5]]), Infinity);

// Scaling by nothing is not scaling, and a reflow that changed nothing should
// not rebuild every stroke in the document.
const unmoved = [[1, 2], [3, 4]];
check("a stroke scaled by one is the same stroke", G.scalePoints(unmoved, 1, 1), unmoved);
// The third value is nib pressure, not a coordinate: a page half as wide does
// not mean a pen half as hard.
check("...and a scaled stroke keeps how hard the pen was pressed",
  G.scalePoints([[10, 20, 0.4]], 2, 3), [[20, 60, 0.4]]);

/* The direction across the stroke, which is what the nib is drawn along. Two
 * samples in the same place have no direction between them, and a nib drawn
 * along a normal of NaN is a path the browser throws away whole.
 */
check("two samples in the same place have no direction across them",
  G.normalAt([[5, 5], [5, 5]], 0), [0, 0]);

// A box round nothing has no angle to be off square by.
check("a box round a single point is square to the page", G.orientedBox([[4, 4]]), 0);
check("...and so is a box round nothing at all", G.orientedBox([]), 0);

console.log("=== a shape drawn on purpose, in each of its kinds ===");

/* The clean version of what was drawn, which is a different function for each
 * kind — and the kind a drag asks for directly rather than being recognised.
 */
check("a dragged ellipse is a ring", G.shapeFromDrag("ellipse", [0, 0], [40, 20]).length > 8, true);
check("...inside the box it was dragged in",
  [Math.round(G.boundsOf(G.shapeFromDrag("ellipse", [0, 0], [40, 20])).width),
    Math.round(G.boundsOf(G.shapeFromDrag("ellipse", [0, 0], [40, 20])).height)], [40, 20]);
check("a dragged arrow is a line, with the head drawn separately",
  G.shapeFromDrag("arrow", [0, 0], [30, 0]).length, 2);

// shapePoints answers for a kind rather than for a drag, and the three it has
// a special answer for are the three that are not an ellipse.
check("a recognised line is cleaned to its two ends",
  G.shapePoints({ kind: "line", ink: [[0, 0], [5, 1], [10, 0]], outline: [] }).length, 2);
check("...a recognised triangle to its three corners and back to the first",
  G.shapePoints({
    kind: "triangle", ink: [], outline: [[0, 0], [10, 0], [5, 10], [0, 0]]
  }), [[0, 0], [10, 0], [5, 10], [0, 0]]);
// A triangle whose hull came back with fewer than three corners is not a
// triangle, and the outline it did come back with is better than nothing.
check("...and a triangle with no three corners keeps the outline it has",
  G.shapePoints({ kind: "triangle", ink: [], outline: [[0, 0], [1, 1]] }), [[0, 0], [1, 1]]);

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

console.log("=== the reader's own colours ===");

/* Kept for the whole browser rather than for the document, so they are the
 * one thing here that is not filed under a share token. What comes back out
 * ends up as a CSS colour and an SVG attribute, so it is checked on the way
 * in and again on the way out.
 */
check("colours are saved and come back in order",
  Store.savePalette(["#ff8800", "#3355ff"]).colours, ["#ff8800", "#3355ff"]);
check("...and load the same way", Store.loadPalette(), ["#ff8800", "#3355ff"]);

check("what is not a colour is not saved",
  Store.savePalette(["#ff8800", "red", "javascript:alert(1)", "#GGGGGG", 7, null]).colours,
  ["#ff8800"]);
check("...and is not loaded either, whatever put it there", (() => {
  saved.set(Store.PALETTE_KEY, JSON.stringify({ v: 1, colours: ["#ff8800", "url(x)"] }));
  return Store.loadPalette();
})(), ["#ff8800"]);

check("three hexits are not six", Store.savePalette(["#f80"]).colours, []);
check("a palette longer than the menu is trimmed",
  Store.savePalette(Array.from({ length: 40 }, (_, i) =>
    `#${i.toString(16).padStart(2, "0")}0000`)).colours.length,
  Store.MAX_COLOURS);

saved.set(Store.PALETTE_KEY, "{not json");
check("an unreadable palette is no palette", Store.loadPalette(), []);

saved.set(Store.PALETTE_KEY, JSON.stringify({ v: 99, colours: ["#ff8800"] }));
check("a version this does not know is not read", Store.loadPalette(), []);

saved.delete(Store.PALETTE_KEY);
check("a reader who has mixed nothing has nothing", Store.loadPalette(), []);

console.log("=== and a browser that will not store anything at all ===");

/* Private mode, a blocked origin, or a quota that is gone. Every one of these
 * is a refusal rather than an exception, because the marks are a convenience
 * on top of somebody else's document: they stay on screen for this visit, and
 * nothing about the document itself stops working.
 */
const refusing = () => {
  throw new Error("this browser will not store anything");
};

globalThis.window.localStorage = /** @type {any} */ ({
  getItem: refusing, setItem: refusing, removeItem: refusing
});

check("marks that cannot be read are no marks", Store.load("token-a"), []);
check("...and marks that cannot be written are a refusal, not a throw",
  Store.save("token-a", strokes), { saved: false, reason: "refused" });
check("...as is clearing them", Store.clear("token-a"), { saved: false, reason: "refused" });
check("a palette that cannot be read is no palette", Store.loadPalette(), []);
// The colours are still in hand for this visit; only the remembering failed.
check("...and one that cannot be written comes back anyway",
  Store.savePalette(["#ff8800"]), { saved: false, reason: "refused", colours: ["#ff8800"] });

// And a document with no token to file them under, which is a page this
// module was loaded on by some route it does not know about.
check("marks with nothing to file them under are not looked for", Store.load(""), []);

/* And the layer it is all drawn on, which wants a document.
 *
 * Everything above is pure — points in, points out — and runs in this
 * process's own scope. The surface turns those numbers into SVG and answers a
 * pointer, so it gets a jsdom of its own rather than a fake document here.
 */
require("./annotate/surface.js")(check);

/* And the part on top of all three: tools, undo and the toolbar. Its own
 * window too, with a real geometry, a real store and a real surface under it.
 */
require("./annotate/tools.js")(check).then(() => process.exit(finish()));
