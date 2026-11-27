/* What a request holding a share token is told, when the policy refuses it.
 *
 * A share link is a statement rather than an authority. Possession of the
 * token used to *be* the permission; now the token says which document the
 * request is about and which audience the link names, and `decide()` answers.
 * Which means a link can stop working without being revoked — a
 * `deny read public` written above it, a space whose public links were
 * switched off, an account that left the group the link was for.
 *
 * There are two refusals, and the difference between them is what each one
 * confirms:
 *
 *   * **"You no longer have access to this document"** says the document is
 *     there. Somebody who once qualified already knew that, so this is served
 *     only to a request carrying a valid session.
 *   * **"This share link is not valid"** confirms nothing, and is what a
 *     stranger gets. It is deliberately the same answer, word for word, as a
 *     revoked token and a typo: a closed link that read differently from a
 *     made-up one would tell anybody holding a URL that the document exists.
 *
 * Both are spelled once, here, for that reason — two copies would drift apart
 * and the drift is the leak.
 */

const NOT_VALID = {
  status: 404,
  json: { error: "This share link is not valid." },
  page: {
    heading: "This share link is not valid",
    message: "It may have been revoked, or the document behind it may have been deleted.",
    detail: "Ask whoever sent it for a new link."
  }
};

const NO_LONGER = {
  status: 403,
  json: { error: "You no longer have access to this document.", code: "share_closed" },
  page: {
    heading: "You no longer have access to this document",
    message: "The link still exists, but who it is shared with has changed.",
    detail: "Ask whoever shared it whether you should still be able to open it."
  }
};

/* The refusal this request gets, or null when the link still works.
 *
 * `req.access` is built once per request by attachAccess, so this asks the
 * same resolver every other route asks. A share-shaped permission check
 * written here instead would be the second copy of the rule that the one
 * guard exists to avoid.
 */
function shareRefusal(req, share) {
  if (req.access.forShare(share).allowed) {
    return null;
  }

  return req.auth ? NO_LONGER : NOT_VALID;
}

module.exports = { shareRefusal, NOT_VALID, NO_LONGER };
