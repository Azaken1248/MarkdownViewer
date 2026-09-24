/* What an endpoint accepts, said once, at the top of its handler.
 *
 * Every handler used to read `req.body?.field` and coerce it on the spot:
 * `String(x || "")` here, a bare `x` there, `x !== false` for a boolean. It
 * worked, and it was a kind of validation, but it was spread across sixty
 * handlers, so "what does this endpoint take" had no single place to be
 * answered and no two handlers quite agreed on how to answer it.
 *
 * Now a handler declares its fields and gets back exactly those, typed:
 *
 *   const body = readBody(req, {
 *     username: { type: "string", required: true },
 *     role:     { type: "string", default: "viewer", oneOf: ROLES },
 *     disabled: { type: "boolean" }
 *   });
 *
 * A field of the wrong type is a 400 that names the field, which is what a
 * client sending `{ "password": { "$gt": "" } }` deserves rather than a
 * password of "[object Object]". A field not declared is ignored: the API is
 * private and both sides ship together, so an extra key is somebody's
 * work-in-progress, not an attack.
 *
 * This is typing at the edge and nothing more. Whether a username is
 * acceptable, a password strong enough, a folder id real — those are the
 * stores' decisions and stay there.
 */

const { HttpError } = require("./errors");

// A missing field. Distinct from undefined so `default: undefined` can mean
// "leave it out" and an absent optional field comes back as undefined.
const ABSENT = Symbol("absent");

/* One typed field, per type.
 *
 * Each takes the name (for the message), the value, and the rule it was
 * declared with, and either answers the value or refuses with the sentence a
 * person will read. Split by type rather than written as one switch, so that
 * "what does this app accept as an integer" is one function.
 */
const TYPES = {
  string(name, value, rule) {
    if (typeof value !== "string") {
      throw new HttpError(400, `${name} must be a string.`);
    }

    // Not trimmed unless asked. A password may begin with a space, and a
    // document's text is the document's; the fields that want trimming say
    // so, and the stores trim the names they normalise anyway.
    const text = rule.trim ? value.trim() : value;
    if (rule.max !== undefined && text.length > rule.max) {
      throw new HttpError(400, `${name} is too long (at most ${rule.max} characters).`);
    }

    return text;
  },

  boolean(name, value) {
    if (typeof value !== "boolean") {
      throw new HttpError(400, `${name} must be true or false.`);
    }

    return value;
  },

  integer(name, value, rule) {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      throw new HttpError(400, `${name} must be a whole number.`);
    }

    if (rule.min !== undefined && value < rule.min) {
      throw new HttpError(400, `${name} must be at least ${rule.min}.`);
    }

    if (rule.max !== undefined && value > rule.max) {
      throw new HttpError(400, `${name} must be at most ${rule.max}.`);
    }

    return value;
  },

  array(name, value, rule) {
    if (!Array.isArray(value)) {
      throw new HttpError(400, `${name} must be a list.`);
    }

    if (rule.max !== undefined && value.length > rule.max) {
      throw new HttpError(400, `${name} has too many entries (at most ${rule.max}).`);
    }

    return value;
  },

  // A field the store reads either way — a list, or a comma-separated string
  // of one. The edge only refuses what is neither.
  "string-or-array": function stringOrArray(name, value) {
    if (typeof value !== "string" && !Array.isArray(value)) {
      throw new HttpError(400, `${name} must be a string or a list.`);
    }

    return value;
  },

  object(name, value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new HttpError(400, `${name} must be an object.`);
    }

    return value;
  }
};

function coerce(name, value, rule) {
  const typed = TYPES[rule.type];
  if (!typed) {
    throw new Error(`readBody: unknown type "${rule.type}" for ${name}`);
  }

  return typed(name, value, rule);
}

/* The declared fields, read off the body and typed.
 *
 * `required` means present and not null; a required string may still be
 * empty, since "the name is empty" is a message the store phrases better.
 * `nullable` lets null through as null, for a field like parentId where null
 * means "the top level". `oneOf` is the only rule here that reads the value's
 * meaning, and only because an enum is a type.
 */
/* A field that is absent or null, which is the half of this that is about
 * what was not sent rather than about what was.
 *
 * Answers what to put in the body — a value, or NOTHING for a field that is
 * simply not there — and refuses when the field was required.
 */
const NOTHING = Symbol("nothing");

function missingField(name, value, rule) {
  if (rule.required && value !== null) {
    throw new HttpError(400, `${name} is required.`);
  }

  if (value === null) {
    if (rule.nullable) {
      return null;
    }

    if (rule.required) {
      throw new HttpError(400, `${name} is required.`);
    }
  }

  // Absent, or null where null is not allowed: the default if there is one,
  // and otherwise nothing at all — which is not the same as undefined, since
  // a field nobody sent should not appear in the body at all.
  return Object.prototype.hasOwnProperty.call(rule, "default") ? rule.default : NOTHING;
}

function readBody(req, rules) {
  const raw = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const body = {};

  for (const [name, rule] of Object.entries(rules)) {
    const has = Object.prototype.hasOwnProperty.call(raw, name) && raw[name] !== undefined;
    const value = has ? raw[name] : ABSENT;

    if (value === ABSENT || value === null) {
      const missing = missingField(name, value, rule);
      if (missing !== NOTHING) {
        body[name] = missing;
      }

      continue;
    }

    const typed = coerce(name, value, rule);

    if (rule.oneOf && !rule.oneOf.includes(typed)) {
      throw new HttpError(400, `${name} must be one of: ${rule.oneOf.join(", ")}.`);
    }

    body[name] = typed;
  }

  return body;
}

module.exports = { readBody };
