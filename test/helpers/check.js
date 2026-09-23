/* One check(), shared by every suite, that compares values properly.
 *
 * Each suite used to carry its own copy of this:
 *
 *     const ok = JSON.stringify(actual) === JSON.stringify(expected);
 *
 * which reads well and is wrong in four ways that matter here. JSON.stringify
 * makes key order significant, so `{a:1,b:2}` and `{b:2,a:1}` are different
 * answers; it drops `undefined`, so `{parent: undefined}` equals `{}` and
 * `[1, undefined]` becomes `[1, null]` — in a file format where
 * `delete node.parent` and `node.parent = null` mean different things, that is
 * a blind spot rather than a nicety; it turns every Map and every Set into
 * `{}`, so two different maps are equal; and it turns NaN into null, so a
 * measurement that went wrong equals a measurement that was not taken.
 *
 * What replaces it is a structural comparison that says where the difference
 * is, and does not care which realm a value came from — the DOM suites compare
 * arrays built inside a jsdom window against arrays built here, and those have
 * different prototypes for the same shape, which is why this checks what a
 * value *is* rather than which constructor made it. (That is also why it is
 * not assert.deepStrictEqual, which compares prototypes and would refuse the
 * pair.)
 *
 * The output is unchanged: one line per check, PASS or FAIL, with what was got
 * and what was wanted. A failure that has somewhere to point also says where.
 */

// How long a printed value may be before it is cut short. Long enough for a
// small object, short enough that a failing check stays one line.
const PRINT_LIMIT = 220;

function tagOf(value) {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  const type = typeof value;
  if (type !== "object") {
    return type;
  }

  // Cross-realm safe: an Array from a jsdom window is not `instanceof Array`
  // here, and a Map from there is not `instanceof Map` either.
  const tag = Object.prototype.toString.call(value);
  if (tag === "[object Map]") return "map";
  if (tag === "[object Set]") return "set";
  if (tag === "[object Date]") return "date";
  if (tag === "[object RegExp]") return "regexp";
  if (tag === "[object Error]") return "error";
  if (ArrayBuffer.isView(value)) return "bytes";
  return "object";
}

// Every own enumerable key, including the ones whose value is undefined —
// which is the distinction JSON.stringify throws away.
function keysOf(value) {
  return Object.keys(value).sort();
}

function joinPath(path, step) {
  return `${path}${step}`;
}

/* How each kind of value is compared, once the two have been found to be the
 * same kind. Each answers where inside itself the difference is, or null.
 *
 * Everything not in here is a primitive, and two primitives that are not `===`
 * differ — which the caller has already established by the time it looks.
 */
const COMPARE = {
  // NaN is equal to NaN here: a measurement that failed twice is the same
  // answer twice, and a check that wanted NaN wanted NaN. (-0 and 0 are the
  // same number, which is the arithmetic every caller means.)
  number: (actual, expected, path) =>
    (Number.isNaN(actual) && Number.isNaN(expected) ? null : path),

  date: (actual, expected, path) => (actual.getTime() === expected.getTime() ? null : path),

  regexp: (actual, expected, path) => (String(actual) === String(expected) ? null : path),

  error: (actual, expected, path) =>
    (actual.message === expected.message ? null : joinPath(path, ".message")),

  bytes: (actual, expected, path) => {
    if (actual.byteLength !== expected.byteLength) {
      return joinPath(path, ".byteLength");
    }

    const left = Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength);
    const right = Buffer.from(expected.buffer, expected.byteOffset, expected.byteLength);
    return left.equals(right) ? null : path;
  },

  array: (actual, expected, path, seen) => {
    if (actual.length !== expected.length) {
      return joinPath(path, ".length");
    }

    for (let index = 0; index < actual.length; index += 1) {
      const where = firstDifference(actual[index], expected[index],
        joinPath(path, `[${index}]`), seen);
      if (where) {
        return where;
      }
    }

    return null;
  },

  set: (actual, expected, path, seen) => sameCollection(
    [...actual].map((one) => [one]), [...expected].map((one) => [one]), path, seen, "set"),

  map: (actual, expected, path, seen) =>
    sameCollection([...actual], [...expected], path, seen, "map"),

  object: (actual, expected, path, seen) => {
    const actualKeys = keysOf(actual);
    const expectedKeys = keysOf(expected);

    if (actualKeys.length !== expectedKeys.length
      || actualKeys.some((key, i) => key !== expectedKeys[i])) {
      // Name the key that is on one side and not the other; that is almost
      // always what the difference is about.
      const odd = actualKeys.find((key) => !expectedKeys.includes(key))
        || expectedKeys.find((key) => !actualKeys.includes(key));
      return joinPath(path, odd === undefined ? "" : `.${odd}`) || ".";
    }

    for (const key of actualKeys) {
      const where = firstDifference(actual[key], expected[key], joinPath(path, `.${key}`), seen);
      if (where) {
        return where;
      }
    }

    return null;
  }
};

// Which kinds hold other values, and so can be walked into — and can refer to
// each other, which is what the cycle guard below is for.
const NESTED = new Set(["object", "array", "map", "set"]);

/* Where two values first differ, or null if they do not.
 *
 * Returns a path like `.docs[0].title` — what to look at, rather than two
 * whole values to read side by side.
 */
function firstDifference(actual, expected, path = "", seen = new Set()) {
  if (actual === expected) {
    return null;
  }

  const tag = tagOf(actual);
  const here = path || ".";

  if (tag !== tagOf(expected)) {
    return here;
  }

  const compare = COMPARE[tag];
  if (!compare) {
    return here;
  }

  if (!NESTED.has(tag)) {
    return compare(actual, expected, here, seen);
  }

  // A pair already being compared higher up the stack: two values that refer
  // to each other are equal as far as this can tell.
  const pair = `${idOf(actual)}|${idOf(expected)}`;
  if (seen.has(pair)) {
    return null;
  }

  seen.add(pair);
  return compare(actual, expected, path, seen);
}

/* Maps and sets: unordered, so each entry on one side has to find an unused
 * partner on the other. Quadratic, which for the sizes a test compares is
 * nothing, and it is the only way to be right about a Map keyed by objects.
 */
function sameCollection(actualEntries, expectedEntries, path, seen, kind) {
  if (actualEntries.length !== expectedEntries.length) {
    return joinPath(path, ".size");
  }

  const taken = new Set();
  for (const entry of actualEntries) {
    const match = expectedEntries.findIndex((candidate, index) => !taken.has(index)
      && entry.every((part, at) => firstDifference(part, candidate[at], "", new Set()) === null));

    if (match < 0) {
      return joinPath(path, `(${kind} entry ${print(entry[0])})`);
    }

    taken.add(match);
  }

  return null;
}

// Object identity for the cycle guard, without holding the objects themselves.
const ids = new WeakMap();
let nextId = 1;
function idOf(value) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return String(value);
  }

  if (!ids.has(value)) {
    ids.set(value, nextId++);
  }

  return `#${ids.get(value)}`;
}

/* What a value looks like in a failure line.
 *
 * Close to JSON, but it shows the things JSON hides — undefined, NaN, a Map's
 * contents — because those are exactly the failures this exists to explain.
 */
function print(value, depth = 0) {
  const tag = tagOf(value);

  switch (tag) {
    case "undefined": return "undefined";
    case "null": return "null";
    case "number": return Object.is(value, -0) ? "-0" : String(value);
    case "bigint": return `${value}n`;
    case "string": return JSON.stringify(value);
    case "boolean": return String(value);
    case "symbol": return String(value);
    case "function": return `[function ${value.name || "anonymous"}]`;
    case "date": return `Date(${value.toISOString()})`;
    case "regexp": return String(value);
    case "error": return `Error(${JSON.stringify(value.message)})`;
    case "bytes": return `bytes(${value.byteLength})`;
    default: break;
  }

  if (depth > 4) {
    return tag === "array" ? "[...]" : "{...}";
  }

  if (tag === "array") {
    return `[${value.map((one) => print(one, depth + 1)).join(", ")}]`;
  }

  if (tag === "set") {
    return `Set{${[...value].map((one) => print(one, depth + 1)).join(", ")}}`;
  }

  if (tag === "map") {
    return `Map{${[...value].map(([k, v]) => `${print(k, depth + 1)} => ${print(v, depth + 1)}`).join(", ")}}`;
  }

  return `{${keysOf(value).map((key) => `${key}: ${print(value[key], depth + 1)}`).join(", ")}}`;
}

function clip(text) {
  return text.length > PRINT_LIMIT ? `${text.slice(0, PRINT_LIMIT)}…` : text;
}

// Whatever the path points at, for the "at" line under a long failure.
function at(value, path) {
  if (!path || path === ".") {
    return value;
  }

  let current = value;
  for (const [, key, index] of path.matchAll(/\.([^.[]+)|\[(\d+)\]/g)) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    current = index === undefined ? current[key] : current[Number(index)];
  }

  return current;
}

/* Which checks to print, when somebody is working on one of them.
 *
 * `npm test dom -- --only "recycle bin"` sets this. It hides the lines that
 * passed and do not match; it does not skip them, because most of these
 * suites are one long session — each check stands on what the ones before it
 * left on the page — and running a third of it would be running something
 * else. A failure always prints, matching or not.
 */
const only = process.env.TEST_ONLY ? new RegExp(process.env.TEST_ONLY, "i") : null;

/* A suite's counter, its check(), and the summary line it ends with.
 *
 * `subject` is what the suite calls itself in that last line: "AUTH" gives
 * "ALL AUTH CHECKS PASSED" or "3 AUTH CHECK(S) FAILED", which is the wording
 * every suite already printed and which CI greps for.
 */
function createChecker(subject = "") {
  let failures = 0;
  let hidden = 0;

  function check(label, actual, expected) {
    const where = firstDifference(actual, expected);
    if (!where) {
      if (only && !only.test(label)) {
        hidden += 1;
        return true;
      }

      console.log(`  PASS  ${label}`);
      return true;
    }

    failures += 1;
    const got = clip(print(actual));
    const want = clip(print(expected));
    console.log(`  FAIL  ${label} (got ${got}, want ${want})`);

    // Two long values side by side are not a difference, they are homework.
    // When there is somewhere to point, point.
    if (where !== "." && (got.length + want.length > 120)) {
      console.log(`        at ${where}: ${clip(print(at(actual, where)))}`
        + ` vs ${clip(print(at(expected, where)))}`);
    }

    return false;
  }

  // For the loops that print their own line and only need to say a failure
  // happened.
  function fail() {
    failures += 1;
  }

  function failed() {
    return failures;
  }

  // The last line, and the exit code that goes with it.
  function finish() {
    const name = subject ? `${subject} ` : "";
    if (hidden > 0) {
      console.log(`\n  (${hidden} passing check${hidden === 1 ? "" : "s"} ran but are not shown, `
        + `because --only ${process.env.TEST_ONLY} was asked for)`);
    }

    console.log(failures === 0
      ? `\nALL ${name}CHECKS PASSED`
      : `\n${failures} ${name}CHECK(S) FAILED`);
    return failures === 0 ? 0 : 1;
  }

  return { check, fail, failed, finish };
}

module.exports = { createChecker, firstDifference, print };
