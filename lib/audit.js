/* The security events, one JSON line each, somewhere separate.
 *
 * The request log says what was asked and how it was answered, and
 * deliberately leaves out anything that could be a document's contents. It
 * does not say who signed in from where, whose password was changed by whom,
 * which account was locked out, or who erased a document — so after an
 * incident the question "what did this account do before we noticed?" had no
 * answer. This is the answer: an append-only line per event that matters.
 *
 * The same discipline as the request log, stated as a rule rather than left
 * to each caller: never a document's text, never a search term, never a token
 * or a password or a hash of one. A username, an address, a file name, a
 * user agent cut short — what is needed to know what happened and who did
 * it, and nothing that would make the log itself worth stealing.
 *
 * A file in the data directory by default, because the point is to still
 * have it later; AUDIT_LOG names another path, or "stderr" to hand the lines
 * to whatever collects the process's output instead. Appended with O_APPEND,
 * one write per line, so several processes can share the file without
 * interleaving. A line that cannot be written is dropped rather than allowed
 * to fail the request that caused it — the audit log is evidence, not a
 * gate, and an unwritable disk should show up as an error in the process's
 * own output, which it does.
 */

const fs = require("fs");
const path = require("path");

// Enough to recognise a browser, not enough to be a tracking record.
const USER_AGENT_LENGTH = 120;

function clip(value, length = 200) {
  const text = String(value ?? "");
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

/* The part of a request an audit line may carry.
 *
 * Address and agent, and who the session says it is. Never the query, never
 * the body, never a header that might be a credential.
 */
function actorOf(req) {
  if (!req) {
    return {};
  }

  return {
    ip: req.ip || undefined,
    userAgent: req.get ? clip(req.get("user-agent"), USER_AGENT_LENGTH) || undefined : undefined,
    user: req.auth?.user?.username || undefined,
    userId: req.auth?.user?.id || undefined
  };
}

/** What a router or store is handed to write a line with: an event name and
 * the fields that belong to it. Where nothing is wired in, `noAudit`.
 * @typedef {(event: string, fields?: Record<string, unknown>) => void} AuditFn
 */

/** @type {AuditFn} */
function noAudit(_event, _fields) {}

/** @param {{ dataDir?: string, target?: string }} [options] */
function createAudit({ dataDir, target = process.env.AUDIT_LOG || "" } = {}) {
  let write;
  let warned = false;

  if (target === "stderr") {
    write = (line) => process.stderr.write(line);
  } else if (target === "off") {
    write = () => {};
  } else {
    const filePath = target || path.join(dataDir, "audit.jsonl");
    let fd = null;
    write = (line) => {
      try {
        if (fd === null) {
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          fd = fs.openSync(filePath, "a", 0o600);
        }

        fs.writeSync(fd, line);
      } catch (error) {
        // Once, not on every event: a disk that will not take the line will
        // not take the complaint about it either, and the complaint has to be
        // read by a person.
        if (!warned) {
          warned = true;
          console.error(`Audit log is not writable (${filePath}): ${error.message}`);
        }
      }
    };
  }

  /* Record that something happened.
   *
   * `event` is a dotted name — login.ok, share.created — and `fields` is
   * whatever identifies the thing it happened to. Both are the caller's
   * words; this only adds the time and drops what is undefined.
   */
  function audit(event, fields = {}) {
    const entry = { ts: new Date().toISOString(), event };
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || value === null || value === "") {
        continue;
      }

      // Cut here, not in each caller, so the rule cannot be forgotten: a
      // user agent is recognisable at 120 characters and a tracking record at
      // more, and nothing else on an audit line has any business being long.
      entry[key] = typeof value === "string"
        ? clip(value, key === "userAgent" ? USER_AGENT_LENGTH : 200)
        : value;
    }

    write(`${JSON.stringify(entry)}\n`);
  }

  audit.actorOf = actorOf;
  return audit;
}

module.exports = { createAudit, noAudit, actorOf, USER_AGENT_LENGTH };
