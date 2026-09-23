/* Markup with the escaping already done, so the safe way is the short way.
 *
 * This app writes a lot of small pieces of interface as strings — a button
 * with an icon in it, a row with a name on it — and every one of those is an
 * assignment to innerHTML. Most interpolate something the app itself produced
 * and are harmless; the trouble is that nothing said which were which, so the
 * next one was always one careless template literal away from being a hole.
 * `no-unsanitized/property` (see eslint.config.js) now refuses an innerHTML
 * built out of a value, and this is the way to write the ones that must be:
 *
 *     node.innerHTML = html`<i class="ph ${icon}"></i><span>${label}</span>`;
 *
 * Every interpolation is escaped, so a label containing a `<` is a label
 * containing a `<` rather than the start of a tag.
 *
 * An array is joined as markup, which is how a list is built:
 *
 *     list.innerHTML = html`<ul>${rows.map((row) => html`<li>${row.name}</li>`)}</ul>`;
 *
 * The rule is: a string is text and gets escaped, an array is pieces of markup
 * and is joined as it is. So the pieces of an array have to come from `html`
 * themselves — which is the only place this can be got wrong, and the reason
 * it is written down here.
 *
 * Markup that is already safe for a reason of its own — DOMPurify's output, a
 * diagram this app drew, a highlighter's spans — does not come through here.
 * Those assign directly, with an eslint-disable naming the reason, so each one
 * is a decision somebody wrote down rather than a line nobody looked at.
 *
 * The one case in between is a piece of markup this app built, escaping as it
 * went, that has to go inside something else — search results, where the
 * matched words are wrapped in <mark> around text that is already escaped.
 * `trusted()` is how that is said:
 *
 *     html`<span>${trusted(highlightMatches(title, terms))}</span>`
 *
 * It is a claim, not a check, so it is worth grepping for: `trusted` marks
 * every place where something other than this file did the escaping.
 */

/* exported DomHtml */
var DomHtml = (function () {
  "use strict";

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /* Markup somebody else escaped. See the note above: a claim, not a check. */
  function trusted(value) {
    return { markup: String(value ?? "") };
  }

  // Nothing at all: false, null and undefined are how a conditional says
  // "nothing here", and writing "false" into the page is never what was meant.
  function isNothing(value) {
    return value === null || value === undefined || value === false;
  }

  function unwrapped(value) {
    return value && typeof value === "object" && typeof value.markup === "string"
      ? value.markup
      : null;
  }

  /* One piece of an array: markup, joined as it is.
   *
   * This is the half of the contract that can be got wrong — a plain string in
   * an array goes in unescaped — which is why the array form is for
   * `.map(one => html`...`)` and nothing else. A value to escape goes in as a
   * value, not as a list of one.
   */
  function markupPiece(value) {
    if (Array.isArray(value)) {
      return value.map(markupPiece).join("");
    }

    return isNothing(value) ? "" : (unwrapped(value) ?? String(value));
  }

  function piece(value) {
    if (Array.isArray(value)) {
      return markupPiece(value);
    }

    if (isNothing(value)) {
      return "";
    }

    return unwrapped(value) ?? escapeHtml(value);
  }

  function html(strings, ...values) {
    return strings.reduce((out, text, index) => out + piece(values[index - 1]) + text);
  }

  return { html, trusted, escapeHtml };
})();
