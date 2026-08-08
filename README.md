# AzaDocs

A personal markdown library. Browse a nested file tree, search across every
document's contents, and edit in place — with Mermaid diagrams, LaTeX and
Jupyter notebooks rendered inline.

Live at **<https://md.azaken.com>**.

- Vanilla JavaScript on the client. No framework, no bundler, no build step.
- Notebook code cells run Python in the browser via Pyodide, on request.
- Express 5 on the server, with the documents themselves as the source of truth
  and JSON files for folder structure, accounts and sessions.
- Private by default: accounts with roles, and individual documents can be
  published as standalone share links.

---

## Running it

Requires Node 20 or newer.

```bash
npm install
npm start
```

Then open <http://localhost:4321>.

On first boot, with no accounts on disk, the server creates an admin and prints
its credentials:

```
  No accounts existed, so an admin was created:

      username: aza
      password: lolface123

  This password is in the source and the README, so it is public
  knowledge. You will be required to change it at first login.
```

Sign in with those, and the app will make you replace the password before it
lets you do anything else — that password is in this file, so treat it as
already known to everyone.

### Scripts

| Script | What it does |
| --- | --- |
| `npm start` | Run the server |
| `npm test` | Run every test suite |
| `npm test <suite>` | Run one suite: `layout`, `mobile`, `theme`, `diagrams`, `auth`, `dom` |
| `npm run lint` | ESLint over the server, the client and the tests |
| `npm run lint:fix` | The same, applying the fixes it can |

---

## Configuration

Everything is environment variables; there is no config file.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `4321` | Port to listen on. |
| `PUBLIC_READS` | `false` | When `true`, anyone can read every document without signing in — the behaviour before accounts existed. Leave it off unless you want the whole library public; individual documents can be shared without it. |
| `PUBLIC_BASE_URL` | `https://md.azaken.com` | Origin used to build canonical, `og:*` and oEmbed URLs. Set it to `http://localhost:4321` when working locally if you want link previews to point at your own machine. |
| `TRUST_PROXY` | `false` | Set to `true` (or an Express trust-proxy value like `loopback`) only when running behind a reverse proxy. Controls whether `X-Forwarded-*` is honoured. |
| `MDVIEWER_STATE_DIR` | the checkout | Moves the documents, recycle bin and organizer somewhere else, so runtime state can live outside the repo. The test suite uses it to point at a temp directory. |
| `LOG_REQUESTS` | `true` | One log line per request, written when the response finishes. |
| `LOG_STATIC` | `false` | Include static assets in that log. Off by default because they drown out everything else. |
| `ENABLE_GRAPHQL_INTROSPECTION` | `false` | Re-enables GraphQL schema introspection for local schema work. |

### Notes on the public deployment

The canonical origin is baked in rather than read from the request. A `Host`
header is attacker-controlled, and building `og:image` or the oEmbed URL from it
lets someone else decide where a link preview points. `PUBLIC_BASE_URL`
overrides the default; nothing else does.

Behind a reverse proxy, set `TRUST_PROXY` — otherwise `req.protocol` reports the
proxy hop rather than the client's scheme.

---

## Project structure

```
├── public/
│   ├── index.html            # The whole app shell. Embed meta is templated in at request time.
│   ├── css/app.css           # One stylesheet. Design tokens at the top, light + dark.
│   ├── share.html            # The standalone share page
│   ├── error.html            # 404 and friends, for browsers
│   ├── js/
│   │   ├── app.js            # The client
│   │   ├── markdown-core.js  # Render engine shared by both pages
│   │   ├── notebook-runtime.js   # Talks to the Python worker
│   │   ├── pyodide-worker.js     # Python (Pyodide/WASM), isolated from the DOM
│   │   ├── share.js          # The share page
│   │   └── theme-boot.js     # Applies the stored theme before first paint
│   ├── favicon.svg
│   ├── social-card.svg       # og:image
│   └── docs/                 # Your documents (gitignored)
├── lib/
│   ├── auth.js               # Accounts, sessions, RBAC, login rate limiting
│   ├── excerpt.js            # Title and summary for link previews
│   ├── passwords.js          # scrypt hashing and the password policy
│   └── shares.js             # Per-document share links
├── data/                     # All gitignored
│   ├── document-organizer.json   # Folder tree + file→folder mappings
│   ├── users.json            # Accounts and password hashes
│   ├── sessions.json         # Live sessions, ids stored hashed
│   └── shares.json           # Share links, tokens stored hashed
├── deleted_markdowns/
│   ├── soft/                 # Recycle bin (gitignored)
│   └── hard/                 # Archive (gitignored)
├── test/
│   ├── run.js                # Runner: `npm test`
│   ├── helpers/server.js     # Spawns a real server against a temp state dir
│   └── *.test.js             # The five suites
├── server.js                 # Express app, ~2,400 lines
├── eslint.config.js
├── package.json
├── package-lock.json         # Tracked — `npm ci` needs it
└── .github/workflows/ci.yml
```

`public/docs/`, `data/` and `deleted_markdowns/` are gitignored: they are your
documents and your runtime state, not part of the project. The server recreates
them on boot.

> **The organizer file has no backup.** `data/document-organizer.json` holds
> every folder and every file→folder mapping, and it is gitignored, so nothing
> version-controls it. If you care about the folder structure, back that file up
> somewhere.

---

## Storage model

Documents are plain files in `public/docs/`. Nothing is in a database, and the
files are readable and editable without this app.

Folders exist only in `data/document-organizer.json`, which maps folder IDs to
names, parents and ordering, plus a filename → folder ID table. Folders nest up
to 8 levels.

Deleting is two-stage and never destroys anything by accident:

1. **Move to recycle bin** — the file moves to `deleted_markdowns/soft/`.
2. **Archive** — it moves to `deleted_markdowns/hard/`.

Only the Archive view can actually erase a file, and that requires typing the
original filename back. Everywhere else, "delete" is a `rename` between
directories — the only other `unlink` calls are cleaning up a failed atomic
write and completing a cross-filesystem move.

---

## Accounts and roles

Authentication is username and password. Passwords are hashed with scrypt
(N=2^15, r=8, p=3 — one of OWASP's accepted configurations) using a per-account
salt, and the encoded hash carries its own parameters, so they can be raised
later without invalidating anyone's password.

A session is a random 256-bit token in an `httpOnly`, `SameSite=Strict` cookie.
Script cannot read it, so an XSS bug cannot steal a session; the server stores
only its SHA-256, so a leak of `sessions.json` does not hand over live sessions.
Writes additionally carry a double-submit CSRF token and an `Origin` check.

| Role | Can |
| --- | --- |
| `viewer` | Read documents |
| `editor` | Read, create, edit, delete, move, and publish share links |
| `admin` | All of the above, plus erase from the archive and manage accounts |

Admins manage accounts from the account menu → **Accounts**: create, change
role, disable, delete, and reset passwords. A few things are deliberately
impossible, because each is a way to lock everyone out permanently:

- demoting, disabling or deleting your own account;
- demoting or removing the last remaining admin.

Anyone whose password was set by someone else — the seeded admin, or a new
account — must choose their own before they can do anything. Changing a password
ends every other session on that account.

Sign-in is rate limited: 8 failed attempts locks that **account** for 15
minutes. The per-address limit is much higher (40), because everyone behind one
NAT or reverse proxy shares an address and an 8-strike rule there would let any
passer-by lock out the household.

## Uploading a folder

The upload button offers **Upload a file** and **Upload a folder**. Picking a
folder walks it recursively and rebuilds its structure as nested folders, up to
the 8-level limit.

Only document files are sent — a real folder is full of images, `.DS_Store` and
lock files, and there is no reason to spend bandwidth uploading things the app
cannot render. The count of what was skipped comes back in the confirmation.

Folders are matched by name, so uploading into a tree that already contains
`Handbook/2026` adds to it rather than creating a second one. A filename that
already exists is uploaded under a new name rather than overwriting anything,
and the response says which files that happened to.

A folder name this app will not take verbatim is repaired rather than costing
the document: over-long names are truncated, control characters stripped, `.`
and empty segments skipped (the file goes to the parent), and a folder called
`Ungrouped` becomes `Ungrouped (uploaded)` so it cannot masquerade as the
virtual group unfiled documents live under. Every adjustment is reported. Only
`..` is refused outright — that is not an awkward name.

**Empty directories are not uploaded.** The browser's directory picker only
reports files, so a folder with nothing in it has nothing to send. Folders are
created for the paths documents actually have.

`POST /api/upload/folder` takes the files as `files` and their relative paths as
a `paths` field — a JSON array, index-aligned with the files. The paths are not
carried as multipart filenames, since whether a filename survives with its
slashes intact varies by client. Every path segment is treated as hostile and
rebuilt from sanitised names; documents are stored flat on disk regardless, with
the tree living in the organizer, so a traversal attempt has nowhere to go.

Limits: 200 files per upload, 2MB per file.

## Running Python in notebooks

Code cells in a `.ipynb` with a Python kernel get a **Run** button. Python runs
in the browser through [Pyodide](https://pyodide.org) — CPython compiled to
WebAssembly — so there is no Python on the server and nothing is executed there.

Cells in one notebook share a namespace, so a variable set in one is visible in
the next, like a real kernel. `stdout`, `stderr` and the value of the last
expression are shown below the cell. Importing `numpy`, `pandas` and the rest of
the Pyodide package set installs them on demand, on first use.

**Nothing runs on its own.** Opening a notebook renders it and stops. A cell
executes because you pressed Run on it — a document in a library must never
execute code just because you looked at it.

**Python runs in a Web Worker, and that is the security boundary.** Pyodide
exposes the host JavaScript scope to Python via `import js`. On the main thread
that is `window`, which would give a notebook the DOM, the session and
everything the app holds in memory. In a worker it is the worker's own scope:
no document, no window, no storage.

**The worker then takes its own network away.** A worker scope has no DOM, but
it does have `fetch` — and on a same-origin request the reader's session cookie
rides along, so `import js; js.fetch("/api/docs")` could read every document in
the library. Once Pyodide has finished loading, the worker replaces `fetch` with
one that permits only the Pyodide CDN (package wheels are still fetched on
demand) and refuses everything else, and replaces `XMLHttpRequest`, `WebSocket`,
`EventSource` and `importScripts` with stubs that throw. Writing was never
possible: every write endpoint requires the CSRF token, which lives on the main
thread and is never passed in.

**The share page cannot run anything.** Executable cells are opt-in per page and
the share page leaves them off, so someone following a link is never handed a
Run button for code they did not write. The default in the render engine is off,
so forgetting to configure it fails safe.

Practical limits:

- The runtime is about 10MB and is not downloaded until the first Run.
- Output is text: `stdout`, `stderr`, and the last expression's `repr`. Rich
  display — matplotlib figures, `_repr_html_` — is not wired up. Outputs already
  saved in the `.ipynb` still render as before.
- Running never writes back to the file. The notebook on disk is unchanged.
- Cells run one at a time, even if you press Run on several. Pyodide's `stdout`
  handler belongs to the interpreter rather than to a call, so overlapping runs
  would capture each other's output — a cell that awaited would lose its output
  entirely to whichever cell was started next.
- Output is capped at 200,000 characters per stream and 20,000 for the echoed
  value, and says so where it was cut. One runaway `print` loop should not
  build a string that freezes the page when it is rendered.
- A cell still running after 20 seconds says so under the cell. That is a
  notice, not a timeout — a real computation may legitimately take longer, and
  killing it would be worse than the silence.
- A runaway loop cannot be interrupted; WebAssembly needs `SharedArrayBuffer`
  for that, which needs COOP/COEP headers this app does not set. **Restart
  Python** terminates the worker, which is the way out.
- Switching to another document mid-run discards that run's result rather than
  writing it under an unrelated notebook.

This costs three CSP allowances, all narrow: `'wasm-unsafe-eval'` in
`script-src` (WebAssembly compilation only — `'unsafe-eval'` is still refused),
the Pyodide CDN in `connect-src`, and `worker-src 'self'`. The Pyodide loader is
pinned to an exact version but cannot carry an SRI hash, because `importScripts`
has no integrity attribute; the WASM payload it fetches is not integrity-checked
either, which is inherent to how Pyodide ships rather than something given up
here.

## Sharing a single document

With the library private, a share link is the deliberate exception. From the
viewer toolbar, **Share this document** publishes that one document at
`/s/<token>`, readable by anyone with the URL and no sign-in.

The share page is a separate page, not a mode of the app: no explorer, no
editor, no search, and no route back into the library. It is served `noindex`,
since an unguessable URL stops being unguessable once a crawler files it.

The token is the credential, so the server stores only its hash and shows you
the full URL exactly once. Losing it means creating a new link, which revokes
the old one. Renaming a document carries its share across; deleting one revokes
it.

The link preview describes **the document**, not the app: `og:title` is the
document's own H1 (falling back to its filename), `og:description` is the
opening prose with the markdown stripped out, and `og:image` is a card
generated per document at `/s/<token>/card.svg` carrying its title. Front
matter, code fences and tables are excluded from the summary, since a preview
reading `## Overview` is worse than none. Notebooks are summarised from their
first markdown cell and diagram sources are labelled by type.

The card is an SVG, because this app has no image toolchain and adding one for
a preview would be a poor trade. Some unfurlers (Slack, Discord, X) will not
render an SVG `og:image` and show no picture — the title, description and site
name still come through.

Revoking a link takes the preview with it: a dead token renders a generic
"not found" page that names neither the document nor its contents.

## API

Reads require a session unless `PUBLIC_READS=true`. Writes require a session
with the right role, plus the `X-CSRF-Token` header.

### Documents

| Method | Path | |
| --- | --- | --- |
| `GET` | `/api/docs` | List all documents with their folder assignments |
| `GET` | `/api/docs/search?q=` | Full-text search across contents, filenames and titles |
| `GET` | `/api/docs/:file` | Document content |
| `POST` | `/api/docs` | Create. Accepts `fileName`, `content`, `folderId` |
| `PUT` | `/api/docs/:file` | Update content |
| `POST` | `/api/docs/:file/rename` | Rename on disk, carrying the folder assignment |
| `POST` | `/api/docs/upload` | Multipart upload of one file. Accepts `folderId` |
| `POST` | `/api/upload/folder` | Multipart upload of a whole folder. See below |
| `PUT` | `/api/docs/:file/folder` | Move to a folder |
| `POST` | `/api/docs/:file/delete` | `mode: "soft" \| "hard"` |

`:file` needs its extension — `/api/docs/notes.md`, not `/api/docs/notes`.

### Folders

| Method | Path | |
| --- | --- | --- |
| `POST` | `/api/folders` | Create. Accepts `parentId` for nesting |
| `PUT` | `/api/folders/:folderId` | Rename and/or reparent |
| `PUT` | `/api/folders/reorder` | Reorder within one parent |
| `DELETE` | `/api/folders/:folderId` | Delete the subtree. Documents are unfiled, never deleted |

### Recycle bin and archive

| Method | Path | |
| --- | --- | --- |
| `GET` | `/api/recycle-bin` | List soft-deleted documents |
| `GET` | `/api/recycle-bin/:entry/content` | Read one |
| `POST` | `/api/recycle-bin/:entry/restore` | Restore to `public/docs/` |
| `POST` | `/api/recycle-bin/:entry/hard-delete` | Move to the archive |
| `GET` | `/api/archive` | List archived documents |
| `GET` | `/api/archive/:entry/content` | Read one |
| `POST` | `/api/archive/:entry/restore` | Restore |
| `DELETE` | `/api/archive/:entry` | **Erase from disk.** Requires a `confirmFile` echo of the original name |

### Other

| Method | Path | |
| --- | --- | --- |
| `GET` | `/api/session` | Who you are, what you may do, and a CSRF token |
| `POST` | `/api/auth/login` | Sign in. Sets the session cookie |
| `POST` | `/api/auth/logout` | Sign out and revoke the session |
| `POST` | `/api/auth/password` | Change your own password |
| `GET` | `/api/users` | List accounts (admin) |
| `POST` | `/api/users` | Create an account (admin) |
| `PATCH` | `/api/users/:id` | Change role or disabled state (admin) |
| `POST` | `/api/users/:id/password` | Reset someone's password (admin) |
| `DELETE` | `/api/users/:id` | Delete an account (admin) |
| `GET` | `/api/shares` | List published documents (editor) |
| `POST` | `/api/docs/:file/share` | Publish or rotate a share link (editor) |
| `DELETE` | `/api/docs/:file/share` | Revoke a share link (editor) |
| `GET` | `/api/share/:token` | **Public.** The shared document |
| `GET` | `/s/:token` | **Public.** The standalone share page |
| `GET` | `/s/:token/card.svg` | **Public.** The `og:image` for that document |
| `GET` | `/healthz` | Health check. `503` when document storage is unreadable |

### Errors

One handler decides what an error looks like, based on who is asking. Anything
under `/api`, plus `/healthz`, `/graphql` and `/oembed`, always answers with
`{"error": "..."}` JSON — a `fetch()` sending a default `Accept` header would
otherwise be handed a web page. Everything else content-negotiates: a browser
gets a styled page, a program gets JSON.

The error page loads no application script, only the theme boot, so it still
renders when whatever failed is the app itself. A `500` reports the status and
nothing more; the stack goes to the log.
| `ALL` | `/graphql` | `embedMeta`, `docsCount`, `health`. Introspection is off by default |
| `GET` | `/oembed?url=` | oEmbed metadata for link-preview consumers |

---

## Supported file types

`.md`, `.markdown`, `.mmd`, `.mermaid`, `.ipynb`.

Filenames are validated by what is actually unsafe — path separators, control
characters, the dot names, Windows reserved device names, and a 180-character
cap. Accents, CJK, parentheses, ampersands and plus signs are all fine:
`café-notes.md`, `My Doc (v2).md` and `日本語.md` all work.

---

## Tests

```bash
npm test
```

Six suites, ~390 checks, about 30 seconds. No browser required.

| Suite | What it covers |
| --- | --- |
| `layout` | Shell geometry, which element owns each scroll, the z-index scale |
| `mobile` | Drawer behaviour, touch target sizes, the dark palette |
| `theme` | Light and dark tokens, contrast ratios, target sizes, the print stylesheet |
| `diagrams` | Mermaid sizing maths and the per-theme diagram palettes |
| `auth` | Password hashing, sessions, CSRF, RBAC, rate limiting, share links |
| `dom` | The real `index.html` + `app.js` in jsdom against a real server |

The `dom` suite spawns its own server against a throwaway `MDVIEWER_STATE_DIR`
seeded with a known corpus, so it exercises the write paths for real and can
never touch actual documents. The others parse the stylesheet and the client
source directly — several of them assert things a human cannot check by looking,
like WCAG contrast ratios and rendered diagram box sizes.

Run one at a time with `npm test theme`, or a file directly with
`node test/theme.test.js`.

---

## Deploying

```bash
npm ci
pm2 start server.js --name azadocs --update-env
pm2 save
```

With a reverse proxy in front:

```bash
TRUST_PROXY=true pm2 start server.js --name azadocs --update-env
```

Set `TRUST_PROXY` when there is a proxy in front, or `req.ip` is the proxy's
address for everyone — which makes the per-address rate limit meaningless — and
the session cookie's `Secure` flag is decided from `PUBLIC_BASE_URL`, so serve
over HTTPS.

`SIGTERM` and `SIGINT` shut down gracefully: the server stops accepting
connections, lets in-flight requests finish, and exits — with a 10-second
backstop. This matters because organizer writes are read-modify-write behind a
lock, and killing the process mid-write is exactly the corruption that used to
wipe every folder assignment.

---

## Troubleshooting

**Diagrams do not render.** Check the browser console for Mermaid parse errors —
a block that fails to parse falls back to showing its source. If nothing renders
at all, the CDN is likely unreachable; every third-party asset is pinned with an
SRI hash, so a hash mismatch also blocks the script.

**A notebook does not render.** It has to be valid `.ipynb` JSON. Very large
outputs are worth trimming before upload.

**Documents do not appear.** They must be in `public/docs/` (or
`$MDVIEWER_STATE_DIR/docs/`) with a supported extension. The list is served from
disk on each request, so a refresh is enough — no restart needed.

**Editing controls are missing.** They are hidden rather than disabled for
accounts that cannot use them. Check the role on your account — a `viewer` sees
no create, upload or edit buttons.

**Locked out entirely.** If the last admin password is lost, stop the server and
delete `data/users.json`. The next boot seeds a fresh admin and prints its
credentials. Documents, folders and shares are untouched.

**"Too many failed attempts."** That account is locked for 15 minutes. It clears
on a server restart, since the limiter is in memory.

**Link previews point at the wrong host.** `PUBLIC_BASE_URL` wins over
everything, including the request. Check what it is set to.

---

## License

Personal project. All rights reserved — not licensed for reuse.
