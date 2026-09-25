# HTTP API

Every route the server answers, what it takes and what it gives back. All of
it is behind a session unless the table says otherwise.

---

## API

> **`/api/*` is private.** It is the contract between this server and this
> client, which ship together, and it changes whenever the app needs it to —
> no version prefix, no deprecation period, no stability promise. Build
> against it and you are building against a moving part. The table below is a
> description of what exists, not an offer.

Reads require a session unless `PUBLIC_READS=true`. Writes require a session
with the right role, plus the `X-CSRF-Token` header.

Every handler reads its request body through one helper, `lib/http/body.js`,
which declares the fields the endpoint takes and their types at the top of the
handler. A field of the wrong type is a `400` that names the field; a field
nobody declared is ignored. That is typing at the edge and nothing more —
whether a username is acceptable or a folder id is real is the store's
decision, and the message for that comes from the store.

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
| `GET` | `/api/links/:id/icon` | The site icon stored with a link |
| `POST` | `/api/links/icons` | Fetch the icons of links that have never had one (editor) |
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
| `POST` | `/graphql` | A read-only graph of the library — see below. Introspection is off by default |
| `GET` | `/oembed?url=` | oEmbed metadata for link-preview consumers |

---


### The graph

`POST /graphql` is a read-only view of the same library, for a script that
wants it in one question rather than a walk over several endpoints. It is
behind the same read policy as everything else (a session, or `PUBLIC_READS`),
answers with exactly what the REST reads answer with — the same functions, not
a parallel set — and has no mutations. Writes belong to REST, where CSRF and
roles already live; because the graph changes nothing, a session alone is
enough to ask it and no CSRF token is needed.

```graphql
{
  documents(folderId: "folder_x", limit: 50) { file title size updatedAt }
  document(file: "Notes/day-one.md") { content }
  folders { id name path depth }
  search(query: "deploy") { file score snippet }
  links(group: "reading") { url title groups }
}
```

`content` is read only when a query asks for it, so listing a thousand
documents opens no files and asking for one does. A query may not nest deeper
than 6, may not name more than 200 fields (aliases included — an alias is how
one request asks for the same thing ten thousand times), and must be a POST,
so it cannot be put in a URL and land in a proxy log. List limits are clamped
to 1,000. The `graphql` suite checks each of these against a real server, and
checks that the schema still has no mutation type — the day one is added, the
CSRF exemption has to go with it, and that is the test that says so.
