# AzaDocs

A personal markdown library. Browse a nested file tree, search across every
document's contents, and edit in place — with Mermaid diagrams, LaTeX and
Jupyter notebooks rendered inline.

Live at **<https://md.azaken.com>**.

- Vanilla JavaScript on the client. No framework, no bundler, no build step.
- Express 5 on the server, with the documents themselves as the source of truth
  and a single JSON file for the folder structure.
- Reads are public; every write is behind a bearer token.

---

## Running it

Requires Node 20 or newer.

```bash
npm install
npm start
```

Then open <http://localhost:4321>.

On first boot the server prints a generated editor token, because it refuses to
run with writes wide open:

```
  MDVIEWER_TOKEN is not set, so a temporary editor token was generated:

      7f3a1c...

  Reads are public; creating, editing and deleting require this token.
  It changes on every restart - set MDVIEWER_TOKEN to keep it stable.
```

Paste it into the padlock button in the header to unlock editing. Set
`MDVIEWER_TOKEN` yourself to keep it stable across restarts.

### Scripts

| Script | What it does |
| --- | --- |
| `npm start` | Run the server |
| `npm test` | Run every test suite |
| `npm test <suite>` | Run one suite: `layout`, `mobile`, `theme`, `diagrams`, `dom` |
| `npm run lint` | ESLint over the server, the client and the tests |
| `npm run lint:fix` | The same, applying the fixes it can |

---

## Configuration

Everything is environment variables; there is no config file.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `4321` | Port to listen on. |
| `MDVIEWER_TOKEN` | generated per boot | Bearer token required by every write endpoint. If unset, one is generated and printed at startup — so the app never runs open, but the token changes on every restart. |
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
│   ├── js/
│   │   ├── app.js            # The client
│   │   └── theme-boot.js     # Applies the stored theme before first paint
│   ├── favicon.svg
│   ├── social-card.svg       # og:image
│   └── docs/                 # Your documents (gitignored)
├── data/
│   └── document-organizer.json   # Folder tree + file→folder mappings (gitignored)
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

## API

Reads are public. Writes require `Authorization: Bearer <MDVIEWER_TOKEN>`.

### Documents

| Method | Path | |
| --- | --- | --- |
| `GET` | `/api/docs` | List all documents with their folder assignments |
| `GET` | `/api/docs/search?q=` | Full-text search across contents, filenames and titles |
| `GET` | `/api/docs/:file` | Document content |
| `POST` | `/api/docs` | Create. Accepts `fileName`, `content`, `folderId` |
| `PUT` | `/api/docs/:file` | Update content |
| `POST` | `/api/docs/:file/rename` | Rename on disk, carrying the folder assignment |
| `POST` | `/api/docs/upload` | Multipart upload. Accepts `folderId` |
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
| `GET` | `/api/session` | Whether this session can write |
| `GET` | `/healthz` | Health check. `503` when document storage is unreadable |
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

Five suites, ~290 checks, about 14 seconds. No browser required.

| Suite | What it covers |
| --- | --- |
| `layout` | Shell geometry, which element owns each scroll, the z-index scale |
| `mobile` | Drawer behaviour, touch target sizes, the dark palette |
| `theme` | Light and dark tokens, contrast ratios, target sizes, the print stylesheet |
| `diagrams` | Mermaid sizing maths and the per-theme diagram palettes |
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
MDVIEWER_TOKEN=<a long random string> \
TRUST_PROXY=true \
pm2 start server.js --name azadocs --update-env
```

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

**Editing is greyed out.** The session is locked. Click the padlock and enter
`MDVIEWER_TOKEN`. If you did not set one, it is in the startup log and changed on
the last restart.

**Link previews point at the wrong host.** `PUBLIC_BASE_URL` wins over
everything, including the request. Check what it is set to.

---

## License

Personal project. All rights reserved — not licensed for reuse.
