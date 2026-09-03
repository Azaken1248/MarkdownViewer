/* Turning a template file into a response body.
 *
 * Three pages are served this way — the app shell, a share page and the error
 * page — and each is a static HTML file with __TOKENS__ in it, read from disk
 * and cached against its own mtime. They had three copies of the same reader
 * and the same substitution loop; this is that code, once.
 *
 * Substitution always escapes. There is no "raw" variant on purpose: a token
 * that must carry markup would be an argument for a template engine, not for a
 * hole in this one.
 */

const fsp = require("fs/promises");

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// An idempotent read-through cache: concurrent misses both read the same file
// and store the same string, so there is no lock and no torn state. A changed
// file is picked up on the next request because the mtime no longer matches,
// which is what makes editing a template in place work without a restart.
function templateReader(filePath) {
  let cached = null;
  let cachedMtimeMs = 0;

  return async function readTemplate() {
    const stat = await fsp.stat(filePath);
    if (cached !== null && cachedMtimeMs === stat.mtimeMs) {
      return cached;
    }

    const text = await fsp.readFile(filePath, "utf8");
    // Two concurrent misses read the same file and store the same string, so
    // the "race" the rule is warning about has no losing side.
    // eslint-disable-next-line require-atomic-updates
    cached = text;
    // eslint-disable-next-line require-atomic-updates
    cachedMtimeMs = stat.mtimeMs;
    return text;
  };
}

function fillTemplate(template, replacements) {
  let rendered = template;
  for (const [token, value] of Object.entries(replacements)) {
    rendered = rendered.split(token).join(escapeHtml(value));
  }

  return rendered;
}

module.exports = { escapeHtml, templateReader, fillTemplate };
