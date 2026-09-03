/* Request logging. One line per request, written when the response finishes so
 * the status and the duration are real rather than assumed.
 *
 * Static assets are skipped by default: they are the overwhelming majority of
 * requests and drown out everything worth reading.
 */

const STATIC_ASSET_PATTERN = /\.(?:css|js|svg|png|jpe?g|gif|ico|woff2?|map)$/i;

// Whether to log at all is the caller's decision — this returns the middleware
// and nothing else, so that switch stays with the rest of the configuration
// rather than being read from the environment twice.
function requestLogger({ logStatic = false } = {}) {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();

    res.on("finish", () => {
      if (!logStatic && STATIC_ASSET_PATTERN.test(req.path)) {
        return;
      }

      const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
      // Query strings can carry search terms, which are the contents of the
      // user's own documents. Log the path only.
      console.log(
        `${new Date().toISOString()} ${req.method} ${req.path} ${res.statusCode} ${ms.toFixed(1)}ms`
      );
    });

    next();
  };
}

module.exports = { requestLogger, STATIC_ASSET_PATTERN };
