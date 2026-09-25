# How AzaDocs is built

The decisions behind the layout, and why each one was taken. For the interface
see [USAGE.md](USAGE.md); for the HTTP surface see [API.md](API.md).

---

## Project structure

```
├── public/
│   ├── index.html            # The whole app shell. Embed meta is templated in at request time.
│   ├── css/app.css           # One stylesheet. Design tokens at the top, light + dark.
│   ├── share.html            # The standalone share page
│   ├── error.html            # 404 and friends, for browsers
│   ├── js/
│   │   ├── app.js            # Wires the modules below together and boots
│   │   ├── app/              # What the client is made of
│   │   │   ├── text.js       # Title, icon, size, sort order — from a name alone
│   │   │   ├── dom.js        # Every element the interface reaches for
│   │   │   ├── state.js      # The one object the interface is drawn from
│   │   │   ├── api.js        # Every request, and what a 401 or 403 means
│   │   │   ├── library.js    # Which document, which folder, what shape the tree is
│   │   │   ├── search.js     # Scoring the corpus against a typed query
│   │   │   ├── location.js   # The address bar
│   │   │   ├── selection.js  # Click, Ctrl-click, Shift-range
│   │   │   ├── tooltips.js   # One body-level tooltip, adopted from title=
│   │   │   ├── modal.js      # Focus containment, as a stack of layers
│   │   │   ├── shell.js      # Sidebar open, body lock, the search meta line
│   │   │   ├── notify.js     # Toasts, and the confirmation dialog
│   │   │   ├── links.js      # Saved links
│   │   │   ├── share.js      # Share links
│   │   │   └── pasted-images.js  # A screenshot becomes an image link
│   │   ├── doc-kinds.js          # What a document is, by its name — loaded by the server too
│   │   ├── dom-html.js           # The html`` tag: escaping for markup built as strings
│   ├── markdown-core.js  # Render engine shared by both pages
│   │   ├── visual-editor.js  # Block splitting + markdown serialization
│   │   ├── diagram-model.js  # Mermaid flowcharts as steps, arrows and positions
│   │   ├── diagram-draw.js   # Draws the ones that carry their own layout
│   │   ├── notebook-runtime.js   # Talks to the Python worker
│   │   ├── pyodide-worker.js     # Python (Pyodide/WASM), isolated from the DOM
│   │   ├── share.js          # The share page
│   │   └── theme-boot.js     # Applies the stored theme before first paint
│   ├── favicon.svg
│   ├── img/                  # PNGs for link previews (see npm run images)
│   └── docs/                 # Your documents, in folders (gitignored)
├── lib/
│   ├── docs/                 # The library as it exists on disk
│   │   ├── paths.js          # Sanitizing and resolving a document path
│   │   ├── store.js          # Files, folders on disk, recycle, uniqueness
│   │   ├── organizer.js      # The folder tree and the file that records it
│   │   ├── search.js         # Scoring documents server-side
│   │   └── content.js        # The read caches
│   ├── http/                 # The shapes a response can take
│   │   ├── headers.js        # CSP and the rest of the security headers
│   │   ├── logging.js        # The request log
│   │   ├── errors.js         # HttpError, the error page, the handler
│   │   ├── html.js           # Escaping and the template cache
│   │   ├── urls.js           # Absolute URLs and the base-URL resolver
│   │   └── embed.js          # og:/twitter: meta for a document
│   ├── routes/               # The addresses, one router per area
│   │   └── auth.js users.js docs.js folders.js recycle.js shares.js
│   │       links.js assets.js upload.js meta.js pages.js
│   ├── guards.js             # Who may: sessions, CSRF, permissions
│   ├── auth.js               # Accounts, sessions, RBAC, login rate limiting
│   ├── excerpt.js            # Title and summary for link previews
│   ├── link-preview.js       # Fetches a URL safely and reads its og: tags
│   ├── links.js              # Saved links
│   ├── db.js                 # The one SQLite database the metadata lives in
│   ├── lru.js                # The byte-budgeted cache the read caches use
│   ├── passwords.js          # scrypt hashing and the password policy
│   ├── shares.js             # Per-document share links
│   └── site.js               # The name and icons this site calls itself by
├── data/                     # All gitignored
│   ├── azadocs.db            # The metadata: accounts, sessions (ids hashed),
│   │                         # share links (tokens hashed), saved links, and
│   │                         # the folder tree. SQLite, WAL mode; see lib/db.js
│   └── *.json.imported       # The files those used to be, set aside on first boot
├── deleted_markdowns/
│   ├── soft/                 # Recycle bin (gitignored)
│   └── hard/                 # Archive (gitignored)
├── assets/                   # Pasted images, named by content hash (gitignored)
├── test/
│   ├── run.js                # Runner: `npm test`
│   ├── helpers/server.js     # Spawns a real server against a temp state dir
│   ├── app-source.js         # Reads the client's script order out of index.html
│   └── *.test.js             # The twenty-one suites
├── tools/
│   └── make-embed-images.js  # Draws public/img/*.png. No dependencies.
├── types/                    # What the checker cannot read off the source
├── server.js                 # Configuration, middleware order, mounts, boot
├── eslint.config.js
├── jsconfig.json             # `npm run typecheck`: checkJs over everything
├── package.json
├── package-lock.json         # Tracked — `npm ci` needs it
└── .github/workflows/ci.yml
```

`public/docs/`, `data/`, `deleted_markdowns/` and `assets/` are gitignored: they
are your documents and your runtime state, not part of the project. The server
recreates them on boot.

> **The database has no backup.** `data/azadocs.db` holds the accounts, the
> share links and the folder tree, and it is gitignored, so nothing
> version-controls it. Losing it no longer loses which documents are in which
> folder — the directories say that — but it does lose every account, every
> share link and the folders' ids and ordering. Back it up if you care about
> those: it is one file, and `sqlite3 data/azadocs.db ".backup copy.db"` takes
> a consistent copy while the app is running.

### How the client is put together

`app.js` is the last script the page loads and the only one that wires anything:
it names what the modules in `public/js/app/` export, registers the listeners,
and boots. Everything it still contains is on its way out to a module of its
own.

A module is a plain script that closes over its own names and puts one object on
the page:

```js
(function (global) {
  const { state } = global.AppState;

  function setSelection(files) { /* ... */ }

  global.AppSelection = { setSelection };
})(typeof window === "undefined" ? globalThis : window);
```

Two rules keep that honest. A module takes what it needs from the namespaces at
the top, never from whatever happens to be in scope by the time it runs — which
is why `index.html` is the one place that says what loads in what order, and why
the tests read that order out of the page rather than keeping a list of their
own. And a module reaches downward only: `notify.js` is handed the modal layers,
the modal layers know nothing about toasts.

**Not ES modules**, though `import`/`export` would state the order better than a
script tag can. jsdom does not execute `<script type="module">`, and seven of
the suites drive the real client in jsdom — so `type="module"` would mean
either a bundler in the test path or seven suites that quietly stop testing
anything. The namespaces are what the four diagram modules already used, and
they cost nothing at runtime.

### The optional build

Nothing here needs building. The pages name their scripts and stylesheets, the
server serves them, and the source in the browser is the source in this
repository — which is worth more day to day than the bytes a build saves.

What it costs is requests: the shell names 86 deferred scripts and 19
stylesheets, and over HTTP/1.1 that is a lot of round trips before anything
draws. So `npm run build` is there for deployments that care:

```
npm run build      # writes public/build, which is gitignored
```

It reads each page for what that page already loads, in the order it already
loads it, concatenates and minifies, and leaves a manifest saying which tags
each bundle stands in for. The server swaps them in as it serves. Delete
`public/build` and the individual files come back — no restart, no flag, no
"dev mode" that rots from disuse. Both paths are the same HTML.

| | requests | brotli |
| --- | --- | --- |
| unbundled | 106 | 297,782 |
| built | 3 | 113,830 |

`theme-boot.js` is deliberately left out of the bundle: it is the one script
that is not deferred, because it settles the theme before the stylesheet
paints, and folding it into a deferred bundle would put back the flash it
exists to prevent.

The `build` suite is what makes shipping a bundle safe. It loads the individual
scripts into one window and the bundle into another and requires the two to
offer the same namespaces with the same keys — so a minifier that dropped
something, or a concatenation in the wrong order, fails the build rather than
the deploy.

---

---

---

## Storage model

Documents are plain files in `public/docs/`, in real directories that mirror the
folders you see. The documents are never in a database, and the library is
readable, editable and re-organisable with any tool — `mv` a file between
directories and the app agrees on the next load.

The metadata around them — accounts, sessions, share links, saved links and the
folder tree — lives in one SQLite file, `data/azadocs.db`, in WAL mode. It used
to be four JSON files, each rewritten whole under an in-process lock, which was
safe in one process and silently lossy in two. That is the whole reason for the
database: **the app can now be run as more than one process** — under
`cluster`, under PM2 in cluster mode, or as several containers sharing the data
directory — and the `db` suite proves it by running three processes against
one database at once and requiring that nothing any of them wrote is lost.

A library from before is picked up on the first boot: each JSON file is
imported and renamed to `.imported` rather than deleted, so a rollback needs no
backup anyone remembered to take. A file that will not parse is left exactly
where it is, under its own name, for a person to look at.

The search index lives there too, as an FTS5 table over trigrams — which is
what keeps the search box meaning what it always meant: any three or more
characters, in any case, anywhere in a title, a folder name or the text. A
query used to read every document in the library to find out which ones
matched; it now asks the index and reads none. The index keeps itself honest
against the disk without watching it: the listing a search starts from already
carries every document's mtime and size, so a file edited, moved or deleted
outside the app is re-read, re-keyed or dropped on the next search, and a
library that has not changed costs nothing to check. The order of the results
is not the index's — FTS5 would rank by how often a word appears — but the same
name-first, folder-second, text-third ladder the scan used; the index only says
which documents could match, and the `search` suite runs the same queries
through both and requires them to agree. A query with a word under three
characters is too short for trigrams and takes the scan instead.

A document is identified by its path: `Azalea/Roadmap/README.md`. That is what
makes two documents with the same name in different folders possible, which a
flat directory could not express — the second used to become `README-1.md`.
Names have to be unique within a folder, which is the filesystem's own rule
rather than one this app adds.

The folder tree — ids, names and nesting — is kept because a folder needs a
stable identity that survives being renamed. But it does not record where any
document lives: the directory a file sits in *is* the answer, so the two can
never disagree. Folders nest up to 8 levels.

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
