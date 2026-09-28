/* The edge that decides what an endpoint accepts.
 *
 * lib/http/body.js is what seven route modules read their input through, and
 * the coverage map said every one of its refusals was unreached: `required`,
 * `oneOf`, every length and range check, and each "that is not the type I
 * asked for". They all worked — this file was written after checking them by
 * hand — but nothing in the suite would have noticed one breaking, and the
 * refusals are the entire reason the module exists.
 *
 * The happy paths are exercised constantly by the route suites. What is here
 * is the other half.
 */

const { readBody } = require("../lib/http/body.js");
const { createChecker } = require("./helpers/check.js");

const { check, finish } = createChecker("BODY");

// What readBody did, or the status and sentence it refused with.
function read(body, rules) {
  try {
    return { ok: readBody({ body }, rules) };
  } catch (error) {
    return { status: error.statusCode || 500, message: error.message };
  }
}

console.log("=== a field that has to be there ===");
check("a missing required field is a 400 that names it",
  read({}, { username: { type: "string", required: true } }),
  { status: 400, message: "username is required." });
check("...and so is a null one, unless null is allowed",
  read({ username: null }, { username: { type: "string", required: true } }),
  { status: 400, message: "username is required." });
check("an optional field simply is not in the answer",
  read({}, { nickname: { type: "string" } }), { ok: {} });
check("...unless it was given a default",
  read({}, { role: { type: "string", default: "viewer" } }), { ok: { role: "viewer" } });
check("null is null where the rule says null means something",
  read({ parentId: null }, { parentId: { type: "string", nullable: true } }),
  { ok: { parentId: null } });
check("...and is absent where it does not",
  read({ parentId: null }, { parentId: { type: "string" } }), { ok: {} });

console.log("=== a field that has to be the type it was asked for ===");
for (const [label, body, rules, message] of [
  ["a string given a number", { a: 1 }, { a: { type: "string" } }, "a must be a string."],
  ["a string given an object — which is how a query is smuggled in",
    { a: { $gt: "" } }, { a: { type: "string" } }, "a must be a string."],
  ["a boolean given the word true", { a: "true" }, { a: { type: "boolean" } }, "a must be true or false."],
  ["an integer given a string", { a: "7" }, { a: { type: "integer" } }, "a must be a whole number."],
  ["an integer given a fraction", { a: 1.5 }, { a: { type: "integer" } }, "a must be a whole number."],
  ["a list given a string", { a: "x" }, { a: { type: "array" } }, "a must be a list."],
  ["an object given a list", { a: [] }, { a: { type: "object" } }, "a must be an object."],
  ["a string-or-list given neither", { a: 1 }, { a: { type: "string-or-array" } },
    "a must be a string or a list."]
]) {
  check(label, read(body, rules), { status: 400, message });
}

console.log("=== and within the bounds it was given ===");
check("a string too long", read({ a: "x".repeat(11) }, { a: { type: "string", max: 10 } }),
  { status: 400, message: "a is too long (at most 10 characters)." });
check("...measured after trimming, when trimming was asked for",
  read({ a: `${" ".repeat(20)}ok` }, { a: { type: "string", max: 10, trim: true } }),
  { ok: { a: "ok" } });
check("a string is not trimmed unless asked — a password may start with a space",
  read({ a: " pw" }, { a: { type: "string" } }), { ok: { a: " pw" } });

check("an integer below its floor", read({ a: 0 }, { a: { type: "integer", min: 1 } }),
  { status: 400, message: "a must be at least 1." });
check("an integer above its ceiling", read({ a: 11 }, { a: { type: "integer", max: 10 } }),
  { status: 400, message: "a must be at most 10." });
check("one on the boundary is inside it",
  read({ a: 10 }, { a: { type: "integer", min: 1, max: 10 } }), { ok: { a: 10 } });

check("a list with too many entries", read({ a: [1, 2, 3] }, { a: { type: "array", max: 2 } }),
  { status: 400, message: "a has too many entries (at most 2)." });

check("a value outside the set it may take",
  read({ role: "wizard" }, { role: { type: "string", oneOf: ["admin", "viewer"] } }),
  { status: 400, message: "role must be one of: admin, viewer." });
check("...and one inside it", read({ role: "admin" },
  { role: { type: "string", oneOf: ["admin", "viewer"] } }), { ok: { role: "admin" } });

console.log("=== what it does with what it was not asked about ===");
check("a key nobody declared is dropped rather than passed on",
  read({ a: "keep", injected: "drop" }, { a: { type: "string" } }), { ok: { a: "keep" } });
check("a body that is not an object at all is an empty one",
  read("not a body", { a: { type: "string" } }), { ok: {} });
check("...including a list, which has keys but is not a record",
  read([1, 2], { a: { type: "string" } }), { ok: {} });
check("a body that is missing entirely is the same",
  read(undefined, { a: { type: "string" } }), { ok: {} });

/* A rule type this module does not have is the programmer's mistake, not the
 * caller's, so it is a 500 rather than a 400 — and it has to stay that way,
 * because a typo'd rule silently accepting anything is the failure that
 * matters here.
 */
const unknown = read({ a: 1 }, { a: { type: "whatever" } });
check("a rule naming a type that does not exist is not a 400", unknown.status !== 400, true);
check("...and says which rule and which field", unknown.message,
  'readBody: unknown type "whatever" for a');

process.exit(finish());
