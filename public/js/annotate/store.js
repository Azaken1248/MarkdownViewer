/* Where the annotations live: this browser, and nowhere else.
 *
 * A shared link is somebody else's document. Marking it up is the reader's
 * own business, so the marks stay on the reader's machine — they are never
 * sent anywhere, and the person who shared the document cannot see them. That
 * is a deliberate limit rather than a missing feature: the alternative is
 * writing to a document you do not own.
 *
 * Keyed by share token, so two shared documents open in the same browser keep
 * their own marks.
 */

/* exported AnnotateStore */
var AnnotateStore = (function () {
  "use strict";

  const PREFIX = "mdviewer.ink.";
  const VERSION = 1;

  /* localStorage is a few megabytes for the whole origin, shared with the
   * theme, the outline and everything else. A cap well under that keeps one
   * enthusiastically annotated document from taking the lot — and, more to
   * the point, from being the reason the theme cannot be saved.
   */
  const MAX_BYTES = 512 * 1024;

  const keyFor = (token) => `${PREFIX}${token}`;

  // Coordinates to one decimal. A tenth of a pixel is past what anyone can
  // point at, and it is roughly half the size on disk.
  const trim = (value) => Math.round(value * 10) / 10;

  function packed(strokes) {
    return JSON.stringify({
      v: VERSION,
      strokes: strokes.map((stroke) => ({
        tool: stroke.tool,
        shape: stroke.shape,
        colour: stroke.colour,
        width: stroke.width,
        // The third number, where there is one, is how hard the pen was
        // pressed. Dropping it made a stroke come back from storage thinner
        // and flatter than the one that was drawn.
        points: stroke.points.map(([x, y, force]) =>
          (force === undefined ? [trim(x), trim(y)] : [trim(x), trim(y), Math.round(force * 100) / 100]))
      }))
    });
  }

  /* What was saved, or nothing.
   *
   * Anything unreadable is treated as nothing rather than as an error: this
   * is a convenience on top of somebody else's document, and refusing to show
   * the document because the marks on it will not parse is the wrong trade.
   */
  function load(token) {
    if (!token) {
      return [];
    }

    let raw = null;
    try {
      raw = window.localStorage.getItem(keyFor(token));
    } catch {
      return [];
    }

    if (!raw) {
      return [];
    }

    try {
      const saved = JSON.parse(raw);
      if (!saved || saved.v !== VERSION || !Array.isArray(saved.strokes)) {
        return [];
      }

      return saved.strokes.filter(isStroke);
    } catch {
      return [];
    }
  }

  // What came out of storage was put there by an earlier version of this file,
  // or by somebody with the console open. Neither is trusted to be the shape
  // it should be.
  function isStroke(stroke) {
    return Boolean(stroke)
      && typeof stroke.tool === "string"
      && (stroke.shape === undefined || typeof stroke.shape === "string")
      && typeof stroke.colour === "string"
      && Number.isFinite(stroke.width)
      && Array.isArray(stroke.points)
      && stroke.points.length > 0
      && stroke.points.every((point) =>
        Array.isArray(point) && point.length >= 2 && point.length <= 3
        && point.every(Number.isFinite));
  }

  /* Saving answers what happened, because the caller has something to say
   * about each outcome: nothing, a full disk, or a document with more ink on
   * it than there is room for.
   */
  function save(token, strokes) {
    if (!token) {
      return { saved: false, reason: "no-token" };
    }

    if (strokes.length === 0) {
      return clear(token);
    }

    const body = packed(strokes);
    if (body.length > MAX_BYTES) {
      return { saved: false, reason: "too-big" };
    }

    try {
      window.localStorage.setItem(keyFor(token), body);
      return { saved: true, bytes: body.length };
    } catch {
      // Private mode, or the origin's quota is gone. The marks stay on screen
      // for this visit either way.
      return { saved: false, reason: "refused" };
    }
  }

  function clear(token) {
    try {
      window.localStorage.removeItem(keyFor(token));
      return { saved: true, bytes: 0 };
    } catch {
      return { saved: false, reason: "refused" };
    }
  }

  return { load, save, clear, packed, isStroke, MAX_BYTES, VERSION, keyFor };
})();
