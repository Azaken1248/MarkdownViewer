/* Putting text into a textarea.
 *
 * Three ways of writing into the source editor's box, kept apart from what the
 * source editor does with them: nothing here knows about documents, uploads or
 * previews, only about a textarea and a caret.
 */

(function (global) {
  /* Put text into a textarea in a way the browser's own undo can see.
   *
   * Assigning to .value clears a textarea's undo history outright in every
   * engine, so the old version of this meant that pasting a picture — or using
   * any of the formatting shortcuts — silently threw away everything typed before
   * it. Ctrl+Z afterwards did nothing at all. execCommand("insertText") is
   * deprecated and is still the only way to make an edit the undo stack knows
   * about; where it is refused, the assignment is the fallback and the loss of
   * history is the lesser problem than not inserting the text.
   */
  function replaceRangeInTextarea(area, start, end, text) {
    area.focus();
    area.setSelectionRange(start, end);

    try {
      if (document.execCommand("insertText", false, text)) {
        return;
      }
    } catch {
      // Refused; fall through to the assignment below.
    }

    area.value = `${area.value.slice(0, start)}${text}${area.value.slice(end)}`;
    area.selectionStart = start + text.length;
    area.selectionEnd = area.selectionStart;
  }

  function insertIntoTextarea(area, text) {
    const at = area.selectionStart ?? area.value.length;
    const end = area.selectionEnd ?? at;
    replaceRangeInTextarea(area, at, end, text);
  }

  // Found by text rather than by the offset it went in at, because the upload is
  // away for a while and nothing stops the author typing above it in the meantime.
  function replaceInTextarea(area, find, text) {
    const at = area.value.indexOf(find);
    if (at === -1) {
      return false;
    }

    const caret = area.selectionStart ?? 0;
    replaceRangeInTextarea(area, at, at + find.length, text);

    // Keep the cursor where the typing was, allowing for the length change. The
    // insertion above left it after the replacement, which is the right place
    // only for someone whose cursor was already there.
    const shift = text.length - find.length;
    const next = caret > at ? Math.max(at, caret + shift) : caret;
    area.selectionStart = next;
    area.selectionEnd = next;
    return true;
  }

  global.AppTextarea = {
    replaceRangeInTextarea,
    insertIntoTextarea,
    replaceInTextarea
  };
})(typeof window === "undefined" ? globalThis : window);
