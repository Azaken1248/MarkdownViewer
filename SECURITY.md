# Security policy

## Reporting a vulnerability

Please do not open a public issue. A public report is readable by everyone,
including on a live deployment, for as long as it takes to read it.

Report it privately through GitHub:

1. Go to the [Security tab](https://github.com/Azaken1248/MarkdownViewer/security).
2. Choose **Report a vulnerability**.

That creates a private advisory only the maintainer can see. If private
reporting is not available to you, open an issue that says only that you have
found a security problem and asks for a private channel, with no details in it.

Useful to include, if you have them: what the impact is, the steps to
reproduce, and which version or commit you were on.

## What to expect

This is a personal project maintained by one person, so there is no support
contract behind any of this. What is reasonable to expect:

- An acknowledgement within a week.
- An assessment of whether it is a vulnerability, and of how serious, once the
  report has been reproduced.
- A fix for anything confirmed as high or critical before anything else.
- Credit in the release notes, unless you would rather not be named.

Please give a fix a reasonable chance to ship before publishing.

## Scope

In scope: this repository, and the deployment at <https://md.azaken.com>.

Out of scope, because they are already known and are choices rather than
oversights:

- **`PUBLIC_READS=true` makes every document readable without a session.** It
  is off by default and documented as what it is.
- **A `<form>` in a rendered document survives sanitization.** DOMPurify allows
  it, and `form-action 'self'` in the Content-Security-Policy is what stops it
  posting anywhere. Both halves are covered by the `sanitizer` suite.
- **`data:` URIs on `<img>`.** `ADD_DATA_URI_TAGS: ["img"]` allows any `data:`
  type there, which is what makes a pasted screenshot work. A browser will not
  execute markup handed to it as an image.
- **Anything requiring an existing admin session.** An admin can already do
  everything an admin can do.

Reports about libraries loaded from a CDN are welcome, but check
`npm run audit:cdn` first — it checks the pinned versions against the advisory
database and verifies each file against its subresource integrity hash, and it
runs in CI.

## What is already done

So a report can start from what is there rather than from zero:

- Every read requires a session unless `PUBLIC_READS` is on.
- Passwords are hashed with scrypt; failed logins are rate-limited per account
  and per address, with a lockout that survives a restart.
- Share links are stored as hashes, so the database does not contain a usable
  token.
- CSRF is checked against a configured list of origins, and the check does not
  turn itself off behind a proxy.
- The Content-Security-Policy allows no inline script. The one allowance it
  does make is checked by the `headers` suite on every run, with its reasons
  written down.
- Rendered markdown goes through DOMPurify with options the `sanitizer` suite
  exercises against real payloads.
- Interpolated `innerHTML` is refused by `eslint-plugin-no-unsanitized`; the
  handful of deliberate exceptions each carry a written reason.
- Security events — sign-ins, failures, lockouts, permission refusals — are
  written to a separate JSON-lines log that holds nothing worth stealing.
