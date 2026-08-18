# AzaDocs

A personal markdown library. Browse a nested file tree, search across every
document's contents, and edit in place — with Mermaid diagrams, LaTeX and
Jupyter notebooks rendered inline.

Live at **<https://md.azaken.com>**.

- Vanilla JavaScript on the client. No framework, no bundler, no build step.
- Notebook code cells run Python in the browser via Pyodide, on request.
- A Links section for the docs sites you keep coming back to, saved as cards
  carrying each page's own title and description, filed into groups.
- Documents are edited in place, on the page you read them on — tables as
  tables, code as code — rewriting only the blocks you actually touch, or as
  markdown source, one button away.
- Task list checkboxes are live while you read: click one and that single
  character changes in the file, with no editor to open and nothing to save.
- Screenshots can be pasted or dropped straight into a document, stored by
  content hash so the same picture is only ever kept once.
- Express 5 on the server, with the documents themselves as the source of truth
  and JSON files for folder structure, accounts and sessions.
- Every document has a real address — `/Azalea/Roadmap/day-008.md` — that can
  be typed, refreshed and shared, with all navigation staying on one page.
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
| `npm test <suite>` | Run one suite: `layout`, `mobile`, `theme`, `diagrams`, `loading`, `auth`, `links`, `assets`, `code`, `visual`, `dom` |
| `npm run images` | Redraw the PNGs that link previews use |
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
header is attacker-controlled, and building the canonical or oEmbed URL from it
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
│   │   ├── visual-editor.js  # Block splitting + markdown serialization
│   │   ├── notebook-runtime.js   # Talks to the Python worker
│   │   ├── pyodide-worker.js     # Python (Pyodide/WASM), isolated from the DOM
│   │   ├── share.js          # The share page
│   │   └── theme-boot.js     # Applies the stored theme before first paint
│   ├── favicon.svg
│   ├── img/                  # PNGs for link previews (see npm run images)
│   └── docs/                 # Your documents, in folders (gitignored)
├── lib/
│   ├── auth.js               # Accounts, sessions, RBAC, login rate limiting
│   ├── excerpt.js            # Title and summary for link previews
│   ├── link-preview.js       # Fetches a URL safely and reads its og: tags
│   ├── links.js              # Saved links
│   ├── passwords.js          # scrypt hashing and the password policy
│   └── shares.js             # Per-document share links
├── data/                     # All gitignored
│   ├── document-organizer.json   # The folder tree (ids, names, nesting, order)
│   ├── users.json            # Accounts and password hashes
│   ├── sessions.json         # Live sessions, ids stored hashed
│   ├── shares.json           # Share links, tokens stored hashed
│   └── links.json            # Saved links
├── deleted_markdowns/
│   ├── soft/                 # Recycle bin (gitignored)
│   └── hard/                 # Archive (gitignored)
├── assets/                   # Pasted images, named by content hash (gitignored)
├── test/
│   ├── run.js                # Runner: `npm test`
│   ├── helpers/server.js     # Spawns a real server against a temp state dir
│   └── *.test.js             # The eleven suites
├── tools/
│   └── make-embed-images.js  # Draws public/img/*.png. No dependencies.
├── server.js                 # Express app, ~2,400 lines
├── eslint.config.js
├── package.json
├── package-lock.json         # Tracked — `npm ci` needs it
└── .github/workflows/ci.yml
```

`public/docs/`, `data/`, `deleted_markdowns/` and `assets/` are gitignored: they
are your documents and your runtime state, not part of the project. The server
recreates them on boot.

> **The organizer file has no backup.** `data/document-organizer.json` holds
> the folder tree and its ordering, and it is gitignored, so nothing
> version-controls it. Losing it no longer loses which documents are in which
> folder — the directories say that — but it does lose the folders' ids,
> ordering and any empty ones. Back it up if you care about those.

---

## Storage model

Documents are plain files in `public/docs/`, in real directories that mirror the
folders you see. Nothing is in a database, and the library is readable,
editable and re-organisable with any tool — `mv` a file between directories and
the app agrees on the next load.

A document is identified by its path: `Azalea/Roadmap/README.md`. That is what
makes two documents with the same name in different folders possible, which a
flat directory could not express — the second used to become `README-1.md`.
Names have to be unique within a folder, which is the filesystem's own rule
rather than one this app adds.

`data/document-organizer.json` still holds the folder tree — ids, names and
nesting — because a folder needs a stable identity that survives being renamed.
But it no longer records where any document lives: the directory a file sits in
*is* the answer, so the two can never disagree. Folders nest up to 8 levels.

Folders and documents are listed **alphabetically**, case-insensitively, with
numbers compared as numbers so `page-2.md` comes before `page-10.md`. There is
no manual ordering and nothing to drag: the list is wherever the alphabet puts
it, which is also where you will look for something. Editing a document does
not move it — the list used to be sorted by modification time within a folder,
so saving a file sent it to the top.

Renaming or moving a folder is one `rename` on disk and no paths rewritten
anywhere. Deleting one moves its documents back to the top level rather than
deleting them, and only there does a name ever get a `-1` suffix, because two
documents from two subfolders can arrive with the same name.

> **Upgrading from a flat library?** The first boot moves every document into
> its folder's directory and clears the old filename → folder map, reporting
> what it did. It is safe to run repeatedly and safe to interrupt, and it never
> renames or deletes anything: a file whose destination is somehow occupied is
> left where it is and named in the log.

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

## Editing

The pencil in the toolbar makes **the document you are reading editable where it
is**. Same column, same width, same type, same rendering — diagrams still drawn,
code still highlighted, tables still tables. Nothing moves when you start,
because nothing about the page has changed: the article element, its class and
its layout are the ones that were already on screen. A formatting bar appears
under the toolbar and the cursor goes into the text.

**Markdown** in that bar hands what is on screen to the source editor: the
markdown, with a live preview beside it. Below 1160px the two become **Write**
and **Preview** tabs, so each gets the whole pane. Edits made on the page come
with you.

### Keyboard shortcuts

The same keys do the same thing in both editors, because which one is open is
not something anyone's fingers keep track of.

| Key | On the page | In the source editor |
| --- | --- | --- |
| `Ctrl+S` | Save without leaving | Save without closing — from the filename field too |
| `Esc` | Leave, asking first if there is anything to lose | Leave, asking first |
| `Ctrl+Z` | Undo | Undo (the textarea's own) |
| `Ctrl+Shift+Z` / `Ctrl+Y` | Redo | Redo (the textarea's own) |
| `Ctrl+B` / `Ctrl+I` | Bold / italic | Wrap the selection in `**` / `*` |
| `Ctrl+E` | Inline code | Wrap the selection in backticks |
| `Ctrl+K` | Link | Link |

`Ctrl+B`, `Ctrl+I` and `Ctrl+E` in the source editor **unwrap** when the
selection is already wrapped, so pressing one twice leaves the text as it was
found rather than as `****text****`. With nothing selected they insert a
placeholder and select it, so it can be typed straight over.

#### Saving and leaving are two different things

`Ctrl+S` is pressed mid-sentence, out of habit, dozens of times in one sitting.
It means "write this down", not "I have finished", so it **writes the file and
leaves you exactly where you were** — same caret, same scroll, same undo
history, no re-render. On the page nothing on screen moves at all: the save
updates what "unsaved" means and what the rest of the app believes is on disk,
and touches nothing else. In the source editor the modal stays open, and a
document saved for the first time becomes an edit of the file it just created,
so a second `Ctrl+S` writes to it instead of trying to create it again.

The **Save button** — pressed once, deliberately, when the writing is done — is
the only thing that finishes and closes.

#### Every way out asks

Leaving either editor with unsaved work asks first, and offers three answers
rather than two: **Save Changes**, **Discard Changes**, or Cancel and stay. A
Discard-or-Cancel pair leaves no way to keep the work *and* still leave, which
is the thing most people are actually trying to do. The keeping answer holds the
focus, so `Enter` on that dialog can never throw the work away, and a save that
fails leaves you in the editor with your edits rather than losing them anyway.

The question is asked on every exit, not just the obvious one: the Cancel
button, `Esc`, the editor's backdrop, opening another document, and switching to
the recycle bin or the links view.

#### Undo on the page

A browser's undo belongs to one editing host, and the page editor is not one:
it is a stack of separate contenteditable blocks with table cells, source boxes
and a language field among them. Native `Ctrl+Z` could never cross a block
boundary, and could not see the app's own edits at all — adding a block,
deleting a table row, dropping in an image, or the live highlighter replacing
the markup inside a fence.

So the history is the document, not the DOM. **An entry is the markdown that
`collectPageMarkdown()` would write** — the same string the save button sends —
so an undo can only ever produce a document this editor could have produced by
typing. Restoring goes back through `renderPageEditor`, the same path that
opened the editor.

What that costs is a re-render, and two things follow from it. The scroll
position is carried across, or every undo would throw you to the top of a long
file. And the caret is put back, by the block it was in and its offset in that
block's text — not by an offset into the markdown, because a block's rendered
text and its source are different strings (`**bold**` is six characters on
screen and ten in the file) and there is no mapping between them to be had.

A burst of typing is one step: the history closes a step off after a pause,
and anything structural closes one immediately so it lands on its own rather
than folded into whatever was being typed just before it. A picture that is
still uploading is never recorded, since a `blob:` URL will not exist in a
minute and an undo restoring one would point at nothing.

Inside a `<textarea>` or an `<input>` — a source box, the language field — `Ctrl+Z`
is deliberately left to the browser. Their own undo is character-accurate and
keeps the caret exactly; a whole-document step would be a downgrade. The one
thing that was ever wrong with it in the source editor was that the app used to
wipe it: assigning to a textarea's `.value` clears its undo history outright,
so pasting a picture silently threw away everything typed before it. Insertions
now go in as edits the browser knows about.

### Pasting a picture

Paste a screenshot into a document and it is in the document — in the source
editor and on the page you read it on, and dropping a file works the same way.
The picture appears at the cursor straight away, from a local copy, while the
bytes go up behind it; what lands in the markdown is an ordinary
`![alt](/api/assets/…)` image. In the source editor the stand-in is a visible
`![Uploading …]()`, found again by text when the upload returns, so typing
around it while it uploads does not strand it. An upload that fails takes its
own placeholder back out rather than leaving a lie in the file.

Images are stored **outside the documents and outside the static root**, and
named by the SHA-256 of their bytes. So the same screenshot pasted into four
documents is stored once, re-uploading is idempotent, and the name says nothing
about who uploaded it or what it was called on their disk. The bytes behind a
URL can never change, which is what lets them be cached permanently.

Only PNG, JPEG, GIF, WebP and AVIF are accepted, up to 10MB. **SVG is refused**:
it is a document format that can carry script, and serving one inline from this
origin would hand an author a way to run code in every reader's session.

Attaching needs `doc:write`; reading an image needs whatever reading a document
needs. A picture inside a *shared* document is the exception worth stating —
whoever opens a share link has no account, so those images are served through a
share-scoped address instead. That route checks the image actually appears in
the document that was shared, so a link to one document is not a key to every
picture in the library.

### Task lists tick without opening anything

A `- [ ]` renders as a checkbox, and the checkbox works — while you are reading,
with no editor to open, nothing to save and no dialog in the way. Click it and
the file changes. It works inside the editor too, where the tick counts as part
of the edit rather than a save of its own.

Ticking is a **one-character** edit: the box is located as an offset into the
source and that single character is replaced, so every other byte of the file is
untouched by construction rather than by care. The page is not re-rendered
either — the box you clicked is the box that changes, and your scroll position
stays where it was.

Which character is the whole problem, because a `- [ ]` inside a code fence is
text rather than a checkbox. So the markers are counted by walking the same
blocks the editor uses, skipping the ones a renderer never turns into list
items, which keeps the count in step with what is actually on the page. Before
any box is made live the two are checked against each other — same number of
boxes as markers, each in the same state — and if they disagree the boxes stay
inert rather than risk ticking the wrong line of a file. Read-only accounts,
notebooks and the recycle bin keep them inert as well.

### What editing will not do to your documents

Every WYSIWYG markdown editor faces the same problem: parse the document into a
tree, edit one word, write the tree back, and the whole file returns subtly
different — list markers swapped, emphasis re-spelled, wrapping redone, a table
realigned. For documents you did not write in this app, that is not cosmetic; it
is an unasked-for diff on every file you open.

So this one does not round-trip the document. **It round-trips only the blocks
you touched.**

The source is cut into blocks — including the blank runs between them — and each
block keeps its exact text. Joining them back reproduces the input byte for
byte, which is asserted against every markdown document in the library on every
test run, not just against fixtures. Editing a block replaces that block and
nothing else. Fix a typo in one paragraph and the diff is that paragraph.

**Tables** are edited as tables. The cells are typed into where they sit, and
controls on the block add or delete a row or a column and set a column's
alignment — the one thing about a table its rendering cannot show back to you.
The header row cannot be deleted, because what is left would not be a markdown
table. A table you edit is written out tidily: columns padded to a common width,
delimiter row rebuilt, alignment preserved. A table you do not touch keeps
whatever spacing it was typed with, to the byte.

**Code fences** are edited as code. You type into the highlighted block itself,
and the language sits in a field on the block rather than buried in the source,
so changing it rewrites the fence and not a character of the code. The colours
keep up as you type — see [Code blocks](#code-blocks) for what that costs and
why it costs so little. Indented fences, tilde fences, unclosed
fences and fences with no trailing newline all come back exactly as they were —
asserted against every fence in the library on every test run.

Blocks with no editable rendering at all — **math, raw HTML, front matter,
mermaid diagrams**, and paragraphs of nothing but link definitions — stay
rendered and offer their markdown in a box on request, with the rendering
redrawn as you type. A link-definition paragraph, which renders to nothing, is
marked rather than left as an invisible thing you could delete without seeing it
happen. Definitions from the bottom of the file are handed to every block while
it renders, so a `[reference][link]` halfway up still resolves even though each
block is rendered on its own.

The toolbar covers bold, italic, inline code, links, headings, lists, quotes and
dividers, with `Ctrl+B`, `Ctrl+I` and `Ctrl+K`. Pasting inserts plain text: the
formatting from wherever you copied is not the formatting this document uses.

Beside those are buttons that put something new into the document — a **code
block**, a **table**, a **formula**, a **diagram** or an **image**. Each lands
below the block the cursor is in, or at the end when the cursor is nowhere, and
leaves the cursor where you are about to type: in the code, in the table's first
cell, or in the source box for the two that have no rendering to type into. Each
is inserted as its markdown and then parsed by the same splitter the document
went through, so a block you add is rendered and written back by exactly the
same path as one that was already in the file — there is no second idea of what
a table is.

The block wrappers carry no border, padding, background or overflow, which is
what lets the children's margins collapse through them exactly as they do
between siblings — the reason the text does not move by a pixel when editing
starts. The focus mark is drawn out of the flow, in the margin. The layout suite
checks all of that, because it is a promise a stylesheet can quietly break.

---

## Saved links

The library has two halves, and the **Files / Links** switch in the header is
both the way between them and the thing that says which one you are in. Links
is for the pages you keep going back to — a framework's docs, an RFC, a GitHub
repo. Paste an address and it is saved as a card carrying the page's own icon,
title and description, with an optional note of your own. Clicking the card
opens the site.

### Getting there

The links live at **`/links`**. That is a real address, so it can be
bookmarked, pasted to someone, typed, refreshed, and — the part that matters
most day to day — walked back out of with the browser's own Back button. They
used to be a mode you turned on from a sixth icon in the sidebar drawer, which
made them somewhere you had to already know about rather than somewhere you
could see, and made leaving them the one navigation in this app the browser
could not undo.

Since nothing in this pane is a document, nothing that acts on one is on screen
with it: New, Edit, Upload and the folder controls step aside, and the header
search filters the links instead of searching the library. Each half keeps its
own query, so a trip to the links does not wipe a document search you were in
the middle of.

Switching back is **free**. Nothing is torn down to show the links — the
article is hidden, not emptied — so coming back is that one class going back
on, the tree redrawn from the list already in memory, and the scroll put back.
No request, and nothing rendered twice. Only a genuinely cold start waits: a
tab that opened straight at `/links` and then pressed Files, or Back landing
on a document other than the one that was open. When a switch does have to
wait, it says so — the switcher's own glyph becomes the spinner, and the pane
being entered shows what it is waiting for.

### What a card knows

The page is read **once**, when you add it. The card renders from that
snapshot, so opening this section makes no request to any of the sites in it —
which matters both for speed and because a section that quietly pinged twenty
sites every time you looked at it is a section that tells twenty sites when you
are online. **Re-read** on a card asks for a fresh copy.

`og:title` and `og:description` are preferred, then `twitter:`, then the
ordinary `<title>` and `<meta name="description">`, then the hostname — so a
page with no metadata still produces a usable card. A page that cannot be read
at all is still saved, with the hostname as its title and a marker saying so:
the link is the point, and the metadata is a convenience.

### Icons

The site's own favicon is fetched by the **server**, at the same moment and
through the same guards as the rest of the metadata, and stored with the link
as a data URI. The browser never goes and gets it: forty cards pointing at
forty `https://` images would be forty requests announcing to forty sites that
someone opened this page, which is the thing the snapshot exists to avoid.

`<link rel="icon">` is preferred, then `shortcut icon`, then
`apple-touch-icon`, and `/favicon.ico` is always tried last so a page whose
head says nothing still gets one. Within a `rel`, the smallest icon at least
32px across wins — big enough not to blur on a 2x screen, small enough that a
512px PNG is not stored to draw an 18px thumbnail of. What comes back is
identified **by its bytes**, not by its `Content-Type`: `.ico` is served as
half a dozen different types by different servers, and a site with no icon
usually answers its own HTML 404 page with a `200`. Anything that is not a
PNG, JPEG, GIF, WebP, ICO or SVG is dropped, as is anything over 96KB. A site
with no usable icon gets the first letter of its hostname instead.

A re-read that comes back without an icon leaves the one already on the card
alone: an empty answer means the fetch did not manage it this time, not that
the site has stopped having one.

Links saved before this existed have never had an icon fetched at all. Those
are collected once, in the background, the first time the pane is opened —
one page at a time, because this is the same fetch adding a link makes and the
server allows twenty of those a minute. Every answer is written back, including
"this site has none", so it happens once and never again.

That distinction is the whole mechanism: a **missing** icon means nobody has
ever looked, an **empty** one means the page was read and offered nothing
usable. Treating the two the same would turn a one-off migration into a request
per card per visit, which is what the stored snapshot exists to avoid. To try a
site again after that, **Re-read** on the card.

### Grouping

Links can be filed into **groups**, and into more than one at a time — a page
about an osu! render API belongs under both `osu` and `APIs`, and being made to
pick one while pasting a URL is exactly the friction that stops anything being
filed at all.

There are three ways to do it, in ascending order of effort:

- **Drag a card onto a group chip.** No dialog, no typing. The fastest way
  through a backlog.
- **The tag button on a card** turns its chip row into a text field. Enter
  saves, Escape puts it back.
- **The Groups field in the Add dialog**, comma separated, with the existing
  groups offered as you type. Adding while a group is selected pre-fills it,
  because adding a link while looking at a group nearly always means "into this
  one".

The chip bar above the grid filters: **All**, one chip per group with its count,
and **Ungrouped** when anything is unfiled. Clicking the selected chip clears
it. A chip on a card jumps to that group. The text filter searches group names
too, so a group can be found by typing rather than by hunting along the bar.

Groups are derived from the links themselves, not kept in a list of their own: a
group exists exactly as long as something is in it, and the last link leaving
takes it with it. There is nothing to create, rename or tidy up. Names are
matched without regard to case, so typing `osu` when `OSU` already exists joins
that group rather than starting a second one beside it — the spelling first used
is the one kept. Up to 8 groups per link, 40 characters each.

Re-reading a page replaces what the page said about itself and leaves the filing
alone.

Links are the same for everyone: any signed-in account sees the list, and
`doc:write` (editor or admin) is needed to add, edit, file, re-read or remove
one.

### What the server will not fetch

Adding a link is the only place this app makes an outbound request to an
address someone else chose, which makes it the only place server-side request
forgery is possible. The server sits inside a network you do not otherwise
reach from a browser: other services on `localhost`, other machines on the LAN,
and — on a cloud host — the instance metadata endpoint at `169.254.169.254`,
which hands out credentials to anything that asks.

So `lib/link-preview.js` checks the **address**, not the hostname:

- **Only `http` and `https`**, and only on ports 80 and 443. `file:`, `gopher:`
  and friends are refused, and restricting the port stops the endpoint being
  useful as a scanner.
- **Private, loopback, link-local, carrier-NAT and multicast ranges are
  refused**, for IPv4 and IPv6, including the forms that disguise one as the
  other: `::ffff:127.0.0.1`, `2002::/16` (6to4) and `64:ff9b::/96` (NAT64).
- **The check happens inside the socket lookup**, not before it. Checking a
  hostname and then handing the same hostname to an HTTP client leaves a gap: a
  DNS server that answers publicly once and privately the second time passes
  the check and connects somewhere else. Validating in `lookup` means the
  address that was approved is the address the socket gets.
- **Redirects are followed by hand**, up to four hops, each re-validated. A
  public URL that 302s to `http://127.0.0.1:6379/` is the same attack with an
  extra step, and every HTTP client follows redirects by default.
- **Credentials in the URL are refused**, and the request carries no cookies,
  no authentication and no referrer.
- **The response is capped** at 1MB and 8 seconds, and anything that is not
  HTML is dropped unread.
- **Addresses are read the way a browser reads them**, which is a correctness
  matter and a security one: an icon `href` is resolved against `<base href>`
  when the page has one, and an attribute's value runs to its *matching* quote
  rather than to whichever kind comes first. Reading "up to either quote"
  truncates `content="Python's docs"` at the apostrophe — and truncates an
  inline `data:image/svg+xml` icon at its first `xmlns='...'`, which is
  exactly how Cloudflare Access writes one.
- **The icon goes through all of it too.** An icon `href` is an address the
  page chose, so it is resolved and then put through the same gate as the
  address that was typed — a page pointing its icon at `169.254.169.254` is
  the same attack with a smaller file at the end of it. It gets its own,
  tighter budget: 96KB, 4 seconds a hop, three candidates and six seconds
  overall, because a card is worth keeping whether or not its picture arrived.

On top of that, adding is limited to 20 fetches a minute per account, so an
account cannot use the endpoint as a general-purpose proxy.

The `links` test suite covers every one of those refusals, without touching the
network.

---

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
document's own H1 (falling back to its filename) and `og:description` is the
opening prose with the markdown stripped out. Front matter, code fences and
tables are excluded from the summary, since a preview reading `## Overview` is
worse than none. Notebooks are summarised from their first markdown cell and
diagram sources are labelled by type.

`og:image` is the app's own card, not anything from the document — a shared
link is often the first thing someone sees of this, and the document's own
pictures are not public.

There was an earlier attempt at a per-document **SVG** card, and Slack, Discord
and X all decline to render an SVG `og:image` — which is most of the places a
link actually gets pasted. That was resolved by removing the image, which meant
previews went out with nothing at all. The actual fix is a raster image, so
there is now a PNG: see [Link preview images](#link-preview-images).

Revoking a link takes the preview with it: a dead token renders a generic
"not found" page that names neither the document nor its contents.

---

## Link preview images

Every unfurler — Discord, Slack, X, iMessage — wants a **raster** image, and
this app's only picture was `favicon.svg`. That is why links to it came out
with an empty space where the card should be, and why iOS showed a screenshot
instead of an icon for `apple-touch-icon`.

So the images that previews use are PNGs, drawn by a generator rather than
committed as binaries nobody can inspect or change:

```bash
node tools/make-embed-images.js
```

It writes `public/img/embed-card.png` (1200×630, the size crawlers document and
the one that earns a full-width card) and two square icons, from the same tile,
page, fold and text lines as `favicon.svg`, in the same four colours. Output is
deterministic, so regenerating after a palette change produces a clean diff or
none at all. There are no dependencies: `zlib` is Node's, and a PNG is a
signature, three chunks and a CRC.

Three things have to hold at once or the card is blank, and all three are
asserted in the `auth` suite against a server with no session, which is the
only state a crawler is ever in:

- the image is a **PNG** — an SVG shows nothing,
- the URL is **absolute** — a crawler resolves it against nothing,
- the file is **readable without signing in** — and the images live in the
  static root rather than behind `requireRead`, unlike documents and unlike
  pasted attachments.

The declared `og:image:width` / `og:image:height` are checked against the PNG's
actual header too, since a crawler that lays out a card from the tags and then
receives a different size draws a broken one. `/oembed` hands out the raster
icon for the same reason.

## Addresses

A document's address is its path:

```
https://md.azaken.com/Azalea/Roadmap/day-008.md
```

It used to be a fragment — `/#Azalea/Roadmap/day-008.md` — which no server ever
sees. The address bar was really just a note the client left itself, and a link
sent to someone else worked only because the client read that note back on the
other end.

Navigating is still entirely in-page. Opening a document changes the address
with `pushState` and fetches nothing but the document; **Back** and **Forward**
move between documents without reloading anything. The address is pushed when
you ask for a document and replaced when the app simply lands on one, so the
address always names what is on screen without inventing history entries nobody
navigated to. Old `#name.md` links still work and quietly become real addresses
when they land.

The saved links are the other place with an address of its own, `/links`, and
it works the same way: pushed when you go there, followed when the browser goes
back, and served as the app shell when it is typed or refreshed.

**Back** as far as the library closes the document, because an address saying
nothing is open while a document is still on screen is how a refresh lands
somewhere the last click never went. The one exception is unsaved work: a
history move within one page never triggers `beforeunload`, so a stray Back
during an edit puts the address back rather than tearing the document down
underneath it.

Because that one page is now served at every document address, everything it
asks for is asked for **absolutely**. A relative `css/app.css` in `index.html`
is `/Azalea/Roadmap/css/app.css` when the page is served at a document, which
404s — the app arrives unstyled with none of its scripts. The `auth` suite
fetches the shell at a nested address, resolves every local `href` and `src`
against it, and insists each one still answers 200.

The matching server route exists only for when that address is typed,
refreshed, or opened from a link somewhere else. It sits after the static
files, so a real file always wins, and it answers with the app shell rather
than the document: which documents exist and what is in them stays behind the
session.

It deliberately **does not check whether the document exists.** Serving a shell
for a real path and a 404 for an imaginary one would tell anyone who asked —
signed in or not — exactly which documents are in the library, which is the one
thing the read guard exists to prevent. So every document-shaped path gets a
byte-identical answer, and the client says "not found" only after asking the
API as itself. The `auth` suite compares the two responses to make sure they
stay indistinguishable.

A path only gets the shell if it could name a document: the right extension,
and a name `sanitizeDocPath` accepts. Anything else — a typo, a directory, a
path with traversal in it — gets the ordinary error page, and `/api/*` still
answers in JSON.

---

## What loads, and when

Opening a document by address takes three round trips — the session, the
library, then the document — so the shell ships already saying it is waiting,
and `initialize()` names the document as soon as it has read the address:

> **Opening Notes/day-one.md**
> Fetching this document from the library.

That matters most where the static markup used to say "No file selected", which
at `/Notes/day-one.md` is both untrue and an instruction to do the thing the
reader has already done. The panel spins until something settles it, and
everything settles it through `showEmptyState`, which clears the spinner — so a
state added later cannot forget to.

**The critical path is a budget, not a habit.** A `<script defer>` blocks every
later `<script defer>`, so anything in the head sits in front of `app.js`, the
file that draws the whole interface. Mermaid alone is 3.5MB, and with KaTeX,
highlight.js and svg-pan-zoom beside it every visit was downloading close to 4MB
of rendering libraries before it could show a word — including the visits to
documents with no diagram, no equation and no code in them.

All four are now fetched by `markdown-core.js` the first time a render actually
needs one, from the `LAZY_LIBRARIES` table there. A render asks for the diagram
engine only after finding a diagram, the highlighter only after finding a code
block, and so on; a document that needs none of them never fetches any. What is
left in the head is the font, the icon font, and marked and DOMPurify — because
nothing renders at all without those two.

Two details are load-bearing. The engine is settled **before** any Mermaid block
is promoted, because promoting rewrites a fenced block into a bare `<div>` and
doing it first would leave the diagram's source as loose body text on a page
that turned out not to be able to draw it. And a library that is already loaded
is used synchronously rather than a microtask later, because the editor preview
repaints on every keystroke and measures its own scroll height immediately
afterwards.

A dynamically created `<script>` checks nothing unless told to, so the loader
sets the same `integrity` and `crossorigin` the head tags carried; the hashes
moved into `LAZY_LIBRARIES` and are recomputed the same way. A failed load is
not cached — a CDN blip costs one document its syntax colours, not the session
— and the render degrades exactly as it did when the library was simply absent.

The `loading` suite holds all of this: it asserts the critical path against an
allow-list rather than a list of forbidden libraries, so the fifth thing someone
adds next year fails too.

---

## Code blocks

### Taking the code away

Every rendered code block carries a copy button, and the toolbar carries one for
the whole document. The document button copies **markdown**, not the rendered
text: this is a markdown library, and the source is the thing that pastes into
another document and comes back the same. It reads the cache the page was
rendered from, so the copy always matches what is on screen.

Two details that are easy to get wrong:

**The clipboard is asked for twice.** `navigator.clipboard` does not exist
outside a secure context, and this app is most often reached at
`http://<some-lan-address>:4321`, which is not one. The deprecated
`execCommand` path is therefore not a courtesy to old browsers — it is the path
that actually runs for a lot of people. It is also the fallback when a secure
origin refuses permission. Selecting the hidden textarea it uses would throw the
reader's own selection away, so that is saved and put back.

**The button lives in a wrapper around the `<pre>`, not inside it.** A `<pre>`
scrolls sideways and an absolutely positioned child of a scroll container
scrolls away with the content, so a button inside would slide off the edge of
any block with one long line in it. The wrapper carries no margin of its own, so
wrapping a block changes nothing about where it sits — including the zero margin
a notebook cell gives it.

Blocks that are not code you would paste anywhere are skipped: a notebook's
output pane, a Mermaid fallback, and code that is currently being typed into.

### Colour while it is being typed

In the visual editor a code block stays highlighted as you type it, rather than
only once you leave it. Highlighting rebuilds the markup the caret is standing
in, which is what used to make that impossible. Three things make it affordable:

- **The caret is remembered as a character offset** into the block's text and
  put back after the swap, so rebuilding the markup no longer moves it. A
  selection keeps both of its ends.
- **The language is settled at most once per block, never re-guessed.**
  `highlightAuto()` runs every grammar the library has against the text, which
  is the expensive call — and against half-typed code it also keeps changing its
  mind, so a block would flicker between Python and Ruby as it was written. A
  fence that names a language uses it; one that does not is guessed once, and a
  guess the detector is not confident about is refused rather than committed to.
  Having failed, it does not try again until the block has really grown.
- **Text that has not changed is not repainted.** Arrow keys, clicks and every
  keystroke that leaves the text alone cost nothing at all.

The timing is the editor's, not the renderer's: a pause rather than a keystroke,
never during IME composition (replacing the markup under a composition cancels
the word being composed), and never on a block belonging to a document that has
since been re-rendered. A block past 20,000 characters is a file someone pasted
in, and keeps the on-blur behaviour. Leaving a block still runs the full pass —
including the auto-detector — but only when the live pass would not have painted
it, so the colours do not change identity as the caret leaves.

The highlighter is still lazy. It is fetched when the caret arrives in a code
block, so it is there by the time the first pause is.

---

## API

Reads require a session unless `PUBLIC_READS=true`. Writes require a session
with the right role, plus the `X-CSRF-Token` header.

### Documents

| Method | Path | |
| --- | --- | --- |
| `GET` | `/api/docs` | List all documents with their folder assignments |
| `GET` | `/api/docs/search?q=` | Full-text search across contents, filenames and titles |
| `GET` | `/api/docs/*file` | Document content |
| `POST` | `/api/docs` | Create. Accepts `fileName`, `content`, `folderId` |
| `PUT` | `/api/docs/*file` | Update content |
| `POST` | `/api/docs/*file/rename` | Rename within its folder |
| `POST` | `/api/docs/upload` | Multipart upload of one file. Accepts `folderId` |
| `POST` | `/api/upload/folder` | Multipart upload of a whole folder. See below |
| `PUT` | `/api/docs/*file/folder` | Move to a folder. `409` if the name is taken there |
| `POST` | `/api/docs/*file/delete` | `mode: "soft" \| "hard"` |

`*file` is the document's path within the library, with its extension:
`/api/docs/Azalea/notes.md`, not `/api/docs/notes`. A wildcard rather than one
percent-encoded segment, because `%2F` is the kind of thing a reverse proxy
rewrites on the way through, and a library that stops resolving its own URLs
depending on what sits in front of it is not worth a tidier route pattern.

### Folders

| Method | Path | |
| --- | --- | --- |
| `POST` | `/api/folders` | Create. Accepts `parentId` for nesting |
| `PUT` | `/api/folders/:folderId` | Rename and/or reparent |
| `DELETE` | `/api/folders/:folderId` | Delete the subtree. Documents are unfiled, never deleted |

### Recycle bin and archive

| Method | Path | |
| --- | --- | --- |
| `GET` | `/api/recycle-bin` | List soft-deleted documents |
| `GET` | `/api/recycle-bin/*entry/content` | Read one |
| `POST` | `/api/recycle-bin/*entry/restore` | Restore to `public/docs/` |
| `POST` | `/api/recycle-bin/*entry/hard-delete` | Move to the archive |
| `GET` | `/api/archive` | List archived documents |
| `GET` | `/api/archive/*entry/content` | Read one |
| `POST` | `/api/archive/*entry/restore` | Restore |
| `DELETE` | `/api/archive/*entry` | **Erase from disk.** Requires a `confirmFile` echo of the original name |

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
| `GET` | `/api/links` | List saved links |
| `POST` | `/api/links` | Save a link, reading the page for its metadata (editor) |
| `PATCH` | `/api/links/:id` | Edit a card or its groups, or `{"refresh":true}` to re-read the page (editor) |
| `DELETE` | `/api/links/:id` | Remove a saved link (editor) |
| `GET` | `/api/shares` | List published documents (editor) |
| `POST` | `/api/docs/*file/share` | Publish or rotate a share link (editor) |
| `DELETE` | `/api/docs/*file/share` | Revoke a share link (editor) |
| `GET` | `/api/share/:token` | **Public.** The shared document |
| `GET` | `/s/:token` | **Public.** The standalone share page |
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

Eleven suites, ~1,600 checks, under a minute. No browser required, and no
network: the suite is deterministic on a runner with no egress.

| Suite | What it covers |
| --- | --- |
| `layout` | Shell geometry, which element owns each scroll, the z-index scale |
| `mobile` | Drawer behaviour, touch target sizes, the dark palette |
| `theme` | Light and dark tokens, contrast ratios (including syntax highlighting), target sizes, the print stylesheet |
| `diagrams` | Mermaid sizing maths and the per-theme diagram palettes |
| `loading` | What the first paint is allowed to fetch, the lazy libraries and their SRI hashes, the loading state |
| `auth` | Password hashing, sessions, CSRF, RBAC, rate limiting, share links |
| `links` | What the link fetcher refuses to reach, metadata parsing, grouping, storage, RBAC |
| `assets` | Pasted images: what may be uploaded, size and type refusals, deduplication, RBAC, share scoping |
| `code` | Copy buttons, both clipboard paths, and the live-highlighting policy |
| `visual` | The block round trip, over fixtures and over every real document |
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
SRI hash, so a hash mismatch also blocks the script. The engine is fetched on
demand rather than up front, so this shows up as a toast when a document with a
diagram is opened, not as a failure at startup — and the same goes for maths and
syntax highlighting.

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
