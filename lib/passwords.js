// Password hashing.
//
// scrypt, from Node's own crypto. The stronger choice would be Argon2id, but
// that means a native dependency and a compiler on every machine that installs
// this; scrypt is on OWASP's accepted list and ships with the runtime.
//
// Parameters follow OWASP's "Password Storage" cheat sheet, which accepts
// N=2^15, r=8, p=3 as one of its configurations. N is what costs memory
// (128 * N * r bytes ≈ 33MB here), so it is also what bounds how many logins
// can be verified at once — hence the rate limiting in front of it.
//
// The encoded form carries its own parameters, so these can be raised later
// without invalidating existing hashes: an old hash still verifies against the
// values it was made with, and needsRehash() reports that it should be upgraded
// the next time the password is known (i.e. at login).

const crypto = require("crypto");
const { promisify } = require("util");

const scrypt = promisify(crypto.scrypt);

const CURRENT_PARAMS = { N: 32768, r: 8, p: 3 };
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
// 128 * N * r with headroom. Node's default maxmem (32MB) is below what these
// parameters need, so scrypt would throw without this.
const MAX_MEM = 96 * 1024 * 1024;

// OWASP's minimum length, and a ceiling so a huge body cannot be turned into
// CPU time. bcrypt's 72-byte truncation does not apply to scrypt, so the cap is
// purely a denial-of-service guard.
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 1024;

function encode(params, salt, hash) {
  return [
    "scrypt",
    `N=${params.N},r=${params.r},p=${params.p}`,
    salt.toString("base64"),
    hash.toString("base64")
  ].join("$");
}

function decode(encoded) {
  const parts = String(encoded || "").split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") {
    return null;
  }

  const params = {};
  for (const pair of parts[1].split(",")) {
    const [key, value] = pair.split("=");
    params[key] = Number(value);
  }

  if (!Number.isInteger(params.N) || !Number.isInteger(params.r) || !Number.isInteger(params.p)) {
    return null;
  }

  try {
    return {
      params,
      salt: Buffer.from(parts[2], "base64"),
      hash: Buffer.from(parts[3], "base64")
    };
  } catch {
    return null;
  }
}

async function derive(password, salt, params) {
  return scrypt(String(password), salt, KEY_LENGTH, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: MAX_MEM
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const hash = await derive(password, salt, CURRENT_PARAMS);
  return encode(CURRENT_PARAMS, salt, hash);
}

async function verifyPassword(password, encoded) {
  const decoded = decode(encoded);
  if (!decoded) {
    return false;
  }

  let candidate;
  try {
    candidate = await derive(password, decoded.salt, decoded.params);
  } catch {
    // Stored parameters that this build will not run (e.g. beyond maxmem).
    return false;
  }

  if (candidate.length !== decoded.hash.length) {
    return false;
  }

  return crypto.timingSafeEqual(candidate, decoded.hash);
}

// Burns the same work as a real verification against a throwaway hash, so a
// login attempt for a username that does not exist takes as long as one that
// does. Without it, response time answers "is this a real account?".
let dummyHashPromise = null;

async function dummyVerify(password) {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword(crypto.randomBytes(32).toString("hex"));
  }

  await verifyPassword(password, await dummyHashPromise);
  return false;
}

function needsRehash(encoded) {
  const decoded = decode(encoded);
  if (!decoded) {
    return true;
  }

  return decoded.params.N < CURRENT_PARAMS.N
    || decoded.params.r < CURRENT_PARAMS.r
    || decoded.params.p < CURRENT_PARAMS.p;
}

// Deliberately not a complexity rule. NIST 800-63B advises against forced
// character-class requirements — they push people toward predictable
// substitutions — and recommends length plus a block list instead.
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "12345678", "123456789", "1234567890",
  "qwertyui", "qwerty123", "letmein1", "iloveyou", "admin123", "welcome1",
  "abc12345", "passw0rd", "changeme", "trustno1", "sunshine", "princess",
  "football", "baseball", "superman", "michael1", "shadow12", "monkey12"
]);

function validatePassword(password, { username = "" } = {}) {
  const value = String(password || "");

  if (value.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }

  if (value.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at most ${MAX_PASSWORD_LENGTH} characters.` };
  }

  if (COMMON_PASSWORDS.has(value.toLowerCase())) {
    return { ok: false, error: "That password is too common. Choose something less guessable." };
  }

  if (username && value.toLowerCase().includes(String(username).toLowerCase())) {
    return { ok: false, error: "Password must not contain your username." };
  }

  return { ok: true };
}

module.exports = {
  hashPassword,
  verifyPassword,
  dummyVerify,
  needsRehash,
  validatePassword,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  CURRENT_PARAMS
};
