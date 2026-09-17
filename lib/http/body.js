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

function coerce(name, value, rule) {
  switch (rule.type) {
    case "string": {
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
    }

    case "boolean":
      if (typeof value !== "boolean") {
        throw new HttpError(400, `${name} must be true or false.`);
      }

      return value;

    case "integer": {
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
    }

    case "array":
      if (!Array.isArray(value)) {
        throw new HttpError(400, `${name} must be a list.`);
      }

      if (rule.max !== undefined && value.length > rule.max) {
        throw new HttpError(400, `${name} has too many entries (at most ${rule.max}).`);
      }

      return value;

    // A field the store reads either way — a list, or a comma-separated
    // string of one. The edge only refuses what is neither.
    case "string-or-array":
      if (typeof value !== "string" && !Array.isArray(value)) {
        throw new HttpError(400, `${name} must be a string or a list.`);
      }

      return value;

    case "object":
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new HttpError(400, `${name} must be an object.`);
      }

      return value;

    default:
      throw new Error(`readBody: unknown type "${rule.type}" for ${name}`);
  }
}

/* The declared fields, read off the body and typed.
 *
 * `required` means present and not null; a required string may still be
 * empty, since "the name is empty" is a message the store phrases better.
 * `nullable` lets null through as null, for a field like parentId where null
 * means "the top level". `oneOf` is the only rule here that reads the value's
 * meaning, and only because an enum is a type.
 */
function readBody(req, rules) {
  const raw = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const body = {};

  for (const [name, rule] of Object.entries(rules)) {
    const has = Object.prototype.hasOwnProperty.call(raw, name) && raw[name] !== undefined;
    let value = has ? raw[name] : ABSENT;

    if (value === ABSENT || value === null) {
      if (rule.required && value !== null) {
        throw new HttpError(400, `${name} is required.`);
      }

      if (value === null && !rule.nullable) {
        if (rule.required) {
          throw new HttpError(400, `${name} is required.`);
        }

        value = ABSENT;
      }

      if (value === ABSENT) {
        if (Object.prototype.hasOwnProperty.call(rule, "default")) {
          body[name] = rule.default;
        }

        continue;
      }

      body[name] = null;
      continue;
    }

    value = coerce(name, value, rule);

    if (rule.oneOf && !rule.oneOf.includes(value)) {
      throw new HttpError(400, `${name} must be one of: ${rule.oneOf.join(", ")}.`);
    }

    body[name] = value;
  }

  return body;
}

module.exports = { readBody };
