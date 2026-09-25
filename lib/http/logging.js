/* Request logging: one line per request, written when the response finishes so
 * the status and the duration are real rather than assumed.
 *
 * Static assets are skipped by default: they are the overwhelming majority of
 * requests and drown out everything worth reading.
 *
 * Three things were missing and are the reason this file grew. A 500 in the
 * log could not be tied to the stack trace printed beside it, so "the error at
 * 12:04" was as close as anyone could get; there was no way to turn the volume
 * down without editing code; and the line was prose, so nothing could count
 * it. All three are the same fix — give the request a name, and let the line
 * be written as data when somebody is collecting it.
 *
 * What does not change is what a line may carry. Query strings hold search
 * terms, which are the contents of somebody's own documents; bodies hold the
 * documents themselves; headers hold credentials. None of those appear here,
 * and the fields that do are the same ones lib/audit.js decided were safe.
 */

const crypto = require("crypto");

const STATIC_ASSET_PATTERN = /\.(?:css|js|svg|png|jpe?g|gif|ico|woff2?|map)$/i;

// Ordered, so a threshold is a comparison rather than a list membership test.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const DEFAULT_LEVEL = "info";

/* An id somebody can quote.
 *
 * A short hex string rather than a UUID: it is read aloud off a screen and
 * pasted into a message, and sixteen hex characters is already far more than
 * enough to be unique among the requests anybody will ever grep at once.
 */
function newRequestId() {
  return crypto.randomBytes(8).toString("hex");
}

/* An inbound id is trusted exactly as far as X-Forwarded-* is.
 *
 * A proxy that already tagged the request should keep its tag, so one request
 * is one id across the whole chain. A client that made one up should not get
 * to choose what its line says — or to write newlines into the log, which is
 * what the shape check is for.
 */
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,64}$/;

function requestIds({ trustProxy = false } = {}) {
  return (req, res, next) => {
    const sent = trustProxy ? req.get("x-request-id") : null;
    req.id = sent && SAFE_ID.test(sent) ? sent : newRequestId();

    // Echoed so a person reporting a failure has something to quote, and so a
    // caller can tie its own logs to these.
    res.setHeader("X-Request-Id", req.id);
    next();
  };
}

function jsonLine(level, message, fields) {
  // The message is a field like any other, so a collector does not have to
  // parse prose back out of it.
  return `${JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...fields
  })}\n`;
}

function textLine(level, message, fields) {
  const rest = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");

  const prefix = level === "info" ? "" : `${level.toUpperCase()} `;
  return `${new Date().toISOString()} ${prefix}${message}${rest ? ` ${rest}` : ""}\n`;
}

/** Somewhere a line can go. A stream is one; so is an array in a test.
 * @typedef {{ write: (line: string) => unknown }} LineSink
 */

/* The logger itself.
 *
 * `format` is text by default because the thing reading it is usually a person
 * with `docker compose logs`, and json when something is collecting it.
 * `level` is how the volume is turned down without a deploy.
 *
 * @param {{ level?: string, format?: string, out?: LineSink, errorOut?: LineSink }} [options]
 */
function createLog({ level = DEFAULT_LEVEL, format = "text", out = null, errorOut = null } = {}) {
  // Defaulted here rather than in the signature: a parameter whose default is
  // process.stdout is a parameter the checker decides must be a WriteStream,
  // and what this needs is anything that can be written a line.
  const info = out || process.stdout;
  const problems = errorOut || process.stderr;
  const threshold = LEVELS[level] ?? LEVELS[DEFAULT_LEVEL];
  const render = format === "json" ? jsonLine : textLine;

  function at(name) {
    return (message, fields = {}) => {
      if (LEVELS[name] < threshold) {
        return;
      }

      // Warnings and errors go to stderr, so a pipeline that separates the two
      // keeps doing that.
      const stream = LEVELS[name] >= LEVELS.warn ? problems : info;
      stream.write(render(name, message, fields));
    };
  }

  return {
    debug: at("debug"),
    info: at("info"),
    warn: at("warn"),
    error: at("error"),
    level,
    format,
    enabled: (name) => (LEVELS[name] ?? 0) >= threshold
  };
}

// A logger that says nothing, for the suites and for anything that takes one
// and is not being watched.
const nowhere = { write: () => true };
const silentLog = createLog({ level: "error", out: nowhere, errorOut: nowhere });

/* Whether to log at all is the caller's decision — this returns the middleware
 * and nothing else, so that switch stays with the rest of the configuration
 * rather than being read from the environment twice.
 */
function requestLogger({ logStatic = false, log = silentLog, onFinished = null } = {}) {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();

    res.on("finish", () => {
      const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const isStatic = STATIC_ASSET_PATTERN.test(req.path);

      // Measured whether or not it is written: a static asset that is not worth
      // a line is still worth counting.
      onFinished?.({ req, res, ms, isStatic });

      if (!logStatic && isStatic) {
        return;
      }

      log.info(`${req.method} ${req.path}`, {
        status: res.statusCode,
        ms: ms.toFixed(1),
        id: req.id,
        // Who did it, when there is a session. The same two fields the audit
        // log carries, and for the same reason: "who did this" is otherwise
        // unanswerable.
        user: req.auth?.user?.username,
        userId: req.auth?.user?.id
      });
    });

    next();
  };
}

module.exports = {
  requestLogger, requestIds, createLog, silentLog, newRequestId,
  STATIC_ASSET_PATTERN, LEVELS
};
