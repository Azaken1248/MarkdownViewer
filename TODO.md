# TODO / Issues To Fix

Full audit of the Markdown Viewer project — server, frontend, styling, and project hygiene.
Runtime bugs marked **confirmed** were reproduced by running the server locally.

Audit date: 2026-08-06 · Files reviewed: `server.js`, `public/js/app.js`, `public/css/app.css`, `public/index.html`

---

## Quick wins — fix these five first

*(all five done, commit `0999ee2`)*

- [x] **`server.js:721`** — move `.filter(Boolean)` before `.sort()`. One line restores search entirely.
- [x] **Wire `matchNextBtn` and `matchCloseBtn`** — two missing `addEventListener` calls.
- [x] **Call `hydrateSearchContent()`**, or drop the "full-text search" claim from the README.
- [x] **Add a dirty check to `closeEditor()`** — silent unsaved-work loss is the worst bug class here.
- [x] **`.gitignore` `data/`, `deleted_markdowns/`, `public/docs/`** and `git rm --cached data/document-organizer.json`.

---

## 🔴 Broken — confirmed by testing

- [x] **1. Server-side search is 100% broken — every query returns HTTP 500.**
  `server.js:721` sorts the match array *before* filtering out nulls, so the comparator dereferences `null.score`.
  ```
  TypeError: Cannot read properties of null (reading 'score')
      at server.js:722:15  →  GET /api/docs/search?q=cart  →  500
  ```
  Any query where at least one doc doesn't match crashes. With 93 docs, that's every query.

- [x] **2. The failure is invisible because the client silently degrades.**
  `applySearch` (`app.js:2426`) catches the 500 and falls back to `buildSuperSearchMatches`, which scores against `state.contentCache` — a cache that is **never populated**, because `hydrateSearchContent()` and `hydrateDeletedSearchContent()` (`app.js:1474`, `1486`) are defined and never called. Net effect: **advertised "full-text search" only ever matches filenames, titles, and folder names.**

- [x] **3. The "next match" and "exit search" buttons do nothing.**
  `matchNextBtn` and `matchCloseBtn` are looked up (`app.js:21-22`) and their `disabled` state is managed, but **no click listener is ever registered** — only `matchPrevBtn` has one (`app.js:3278`). You can go backwards through matches but not forwards, and you can't dismiss the widget.

- [x] **4. Swipe-to-navigate throws a ReferenceError.**
  `docSwipeStart` is read at `app.js:3283` but is **never declared and there is no `touchstart` handler** that sets it. Every touch on the document body throws `ReferenceError: docSwipeStart is not defined`. The feature has never worked.

- [x] **5. The match-nav widget becomes an undismissable floating turd.**
  `updateJumpNavigationUI` (`app.js:744`) shows it whenever a query exists, even with zero matches. So you get a fixed-position "0 / 0" box with both arrows disabled and a close button that isn't wired (#3). On mobile it's pinned `top: 0.78rem; right: 0.75rem` (`app.css:2045`) — directly on top of the sticky header.

---

## 🔴 Security

- [x] **6. Zero authentication on every mutating endpoint.** Anyone who can reach the port can create, overwrite, delete, and hard-delete documents and folders. No auth, no CSRF token, no rate limiting.

- [x] **7. Host-header injection into canonical/OG/oEmbed URLs.** `app.set("trust proxy", true)` is unconditional (`server.js:32`), and `getBaseUrlFromRequest` reads `x-forwarded-host` / `x-forwarded-proto` straight from the request (`server.js:773-776`). An attacker controls `og:image`, `canonical`, and the oEmbed URL by sending a header.

- [x] **8. Stored XSS via Mermaid.** `securityLevel: "loose"` (`app.js:1813`) permits raw HTML in node labels and `click ... "javascript:..."` directives. Mermaid renders **after** DOMPurify runs, so it bypasses sanitization entirely. Combined with #6, any unauthenticated user can upload a `.md` that executes script for every viewer.

- [x] **9. ~~GraphiQL is exposed in production~~ → schema introspection is open** (`server.js`) on `app.all("/graphql")`, no auth.
  *Correction: the original finding was partly wrong. `graphql-http` has no `graphiql` option, so `graphiql: true` was always a no-op and no UI was ever served. The real exposure was **introspection**, which was confirmed live. Fixed with `NoSchemaIntrospectionCustomRule`, opt-out via `ENABLE_GRAPHQL_INTROSPECTION=true`.*

- [x] **10. Seven CDN dependencies with no SRI hashes and no `crossorigin`** (`index.html:30-47`). A compromise of jsdelivr or cdnjs is full app takeover. There's also no CSP, no `helmet`.

- [x] **11. `marked` is loaded completely unpinned** — `npm/marked/marked.min.js` resolves to *latest*. The app can break on any upstream release with zero code change. `mermaid@11` floats on minor versions too.

---

## 🟠 Data integrity / data loss

- [x] **12. A corrupted organizer file silently wipes all folder structure.** `readOrganizerState` (`server.js:161-168`) does `catch { return createDefaultOrganizerState() }`. A partial write or malformed JSON silently discards all 17 folders and 77 file→folder mappings with no error, and the next write persists the empty state.
  - Fixed: a parse failure quarantines the file to `document-organizer.json.corrupt-<stamp>`, leaves the original untouched, degrades reads to an empty structure, and refuses writes with 503 rather than overwriting.

- [x] **13. Organizer writes are non-atomic and unlocked.** `writeOrganizerState` (`server.js:170`) does a plain `writeFile` with no temp-file+rename. Every mutation is a full read-modify-write with no locking, so concurrent requests lose updates. A crash mid-write triggers #12.
  - Fixed: writes go to a temp file, `fsync`, then `rename(2)`; every mutation runs through `mutateOrganizerState` behind a promise-chain lock. Verified with 20 parallel folder creates — all 20 persisted with contiguous ordering.

- [x] **14. The editor discards unsaved work with no warning.** Escape (`app.js:3430`), the backdrop click (`3490`), and the X button (`3486`) all call `closeEditor()` immediately. No dirty check, no confirmation, no `beforeunload` guard.
  - Fixed: `isEditorDirty()` + `requestEditorClose()` confirm before discarding, and a `beforeunload` handler guards tab close.

- [x] **15. "Permanently delete" never deletes anything.** Hard delete just moves files to `deleted_markdowns/hard` (`server.js:1230`), which has no purge UI and no expiry. The tooltip on `hardDeleteDocBtn` says "Permanently delete" — it's a lie, and the files accumulate forever.
  - Fixed: the action is now called **Archive** everywhere (viewer button, recycle-bin rows, confirmation copy). A new **Archive** view (sidebar toggle → `GET /api/archive`) lists the hard-archived files, and only there can a file actually be erased — `DELETE /api/archive/:entry`, the app's single `unlink` call, gated behind the write token plus a `confirmFile` echo of the original name.

- [x] **16. `deleted_markdowns/`, `data/`, and `public/docs/` are not gitignored.** Deleted documents, app state, and 93 personal documents are all staged for commit. `data/document-organizer.json` is already tracked, so every single folder move dirties the repo.
  - Fixed: `data/`, `deleted_markdowns/`, and `public/docs/` are in `.gitignore` and untracked.

---

## 🟠 Behavior bugs

- [x] **17. Common filenames are rejected outright.** `sanitizeFilename` requires `^[A-Za-z0-9 _.-]+$` (`server.js:396`). Confirmed rejected with 400: `café-notes.md`, `My Doc (v2).md`. No unicode, no parentheses, no `&`, no `+`. Same restriction on folder names (`Café` → 400). For a tool whose entire job is ingesting arbitrary user documents, this is crippling.
  - Fixed: names are now validated by what is actually unsafe — path separators, control characters, the dot names, Windows reserved device names, and a 180-char cap — instead of an allowlist. `café-notes.md`, `My Doc (v2).md`, `R&D + notes.md` and `日本語.md` all create with 201; `../../etc/passwd.md`, `a\b.md`, `.hidden.md`, `CON.md` and `evil.exe` are still refused. Names are NFC-normalized so the organizer and the filesystem agree on one spelling. All 93 existing filenames still validate.

- [x] **18. You can create a folder literally named "Ungrouped."** Confirmed created with 201. It collides with `ROOT_FOLDER_LABEL`, producing two visually identical "Ungrouped" groups in the sidebar.
  - Fixed: `normalizeFolderName` rejects the root label case-insensitively (400). Loading existing state passes `allowRootLabel`, so a folder created by an older build is never silently dropped along with its file mappings.

- [x] **19. Saving a document larger than the body limit returns 500, not 413.** `express.json({limit:"2mb"})` (`server.js:33`) equals `MAX_DOC_BYTES`, so the JSON envelope always exceeds the limit before the app's own 413 check at `server.js:1274` can fire. Express's PayloadTooLarge error isn't a `MulterError`, so the error handler falls through to `res.status(500).json({error:"Internal server error"})`.
  - Fixed: the JSON envelope limit is now `MAX_DOC_BYTES * 2 + 64KB`, so JSON escaping can't push a legal document past the parser before the app's own check runs. A 3MB document returns 413 with the real message; a just-under-2MB document still saves.

- [x] **20. `state.activeFile` is set *after* awaiting Mermaid rendering** (`app.js:2542-2547`). On a doc with big diagrams there's a multi-second window where Edit/Delete operate on the *previously* open document.
  - Fixed: the document is claimed the moment its HTML is in the DOM, before the awaited Mermaid pass. Same fix applied to the recycle-bin/archive viewer.

- [x] **21. `/api/docs/foo` and `/api/docs/foo.md` are the same resource.** `sanitizeFilename` appends `.md` to anything without a known extension (`server.js:382-385`), so the URL space is ambiguous — and a `.mmd` or `.ipynb` file can never be addressed without its extension.
  - Fixed: lookups use a strict `sanitizeFilename` that requires a real extension, so `/api/docs/alpha` is now 400 and `/api/docs/alpha.md` is 200. Creation and upload keep the convenience via `sanitizeNewFilename`, which defaults a bare name to `.md`.

- [x] **22. Acronyms get mangled.** `toDocTitle` (`server.js:409`) and `filenameToTitle` (`app.js:138`) title-case every word: `API_Specification.md` → "Api Specification", `IPL EDA.md` → "Ipl Eda", `BRD.md` → "Brd". Visible across the entire current doc list.
  - **Not a bug — this audit entry was wrong.** `\b\w` only ever uppercases, so nothing is lowercased: `API_Specification.md` renders as "API Specification", `BRD.md` as "BRD", `IPL EDA.md` as "IPL EDA". Verified against all 93 live documents; no acronym is mangled. No change made.

- [x] **23. There is no rename feature anywhere.** The editor's filename field is `disabled` in edit mode (`app.js:2858`) with no explanation, and no rename endpoint exists.
  - Fixed: `POST /api/docs/:file/rename` renames on disk and carries the folder assignment to the new key, refusing collisions with 409. The editor's filename field is editable in edit mode; saving renames first, then writes the content.

- [x] **24. New and uploaded documents can't be placed in a folder.** `POST /api/docs` and `/api/docs/upload` accept no `folderId`, so everything lands in Ungrouped and needs a second Move action.
  - Fixed: both endpoints accept `folderId` (404 on an unknown folder). The editor shows a folder picker when creating, and uploading opens the folder chooser first, with "Upload To Ungrouped" and "Create And Upload" as the other two paths.

- [x] **25. Ungrouped is permanently pinned above every real folder** — `resolveFolderInfo` returns `folderOrder: -1` for unfiled docs (`server.js:192`). There is also no UI to reorder folders at all; `order` is only ever set at creation.
  - Fixed: unfiled documents now sort *after* every real folder on both sides (`UNFILED_FOLDER_ORDER`), and `PUT /api/folders/reorder` persists an explicit ordering — folders omitted from the list keep their relative position, so a partial list can never drop one. Up/down buttons on each folder header drive it.

- [x] **26. Escape key handling has a fall-through bug.** `app.js:3420` closes the nav without `return`, so a single Escape can close the sidebar *and* the folder modal *and* the search panel simultaneously. Handler order is arbitrary.
  - Fixed: one early return for non-Escape keys, then a single ordered chain — confirm, unlock, folder modal, editor, search panel, nav — each with its own `return`. Verified across all layer combinations.

- [x] **27. The search input fires three redundant handlers** — `input`, `search`, and `change` all bound to `handleSearchEvent` (`app.js:3230-3232`) — plus an undebounced `applySearch` on every `focus` (`3234`).
  - Fixed: only the debounced `input` handler remains. `input` already covers typing, pasting and the native clear button.

- [x] **28. Four dead functions in server.js:** `setDocumentFolder`, `createFolder`, `renameFolder`, `deleteFolder` (`server.js:591-686`) are never called; every route reimplements the logic inline. Two divergent copies of the same rules.
  - Fixed: all four removed (97 lines). The routes were already the only implementation.

- [x] **29. Vestigial `markdowns/` directory and `manifest.json`.** The server reads `public/docs`; `markdowns/` is dead. Status messages still say "Uploaded X to **markdowns folder**" and "No markdown files in **markdowns folder** yet" (`app.js:2933`, `2899`).
  - Fixed: `markdowns/` and its `manifest.json` are deleted — both `.md` files in it were byte-identical duplicates of documents already live in `public/docs/`, verified by sha256 before removal. The three "markdowns folder" status strings now describe what actually happened.

- [x] **30. `TREE_MENU_HOLD_DELAY` (`app.js:103`) is dead.** There's no long-press handler.
  - Fixed: removed.

---

## 🟠 Performance

- [x] **31. Every keystroke re-reads and lowercases every document on the server.** `searchDocuments` (`server.js:704`) reads all 93 files and calls `normalizeSearchText(content)` on each, per request, debounced at only 160ms. No index. The `SEARCH_RESULT_LIMIT` is applied *after* the full scan.
  - Fixed: a `docSearchIndex` caches each document's lowercased text keyed by mtime+size, so a keystroke walks strings already in memory instead of re-reading and re-lowercasing 93 files. Snippets are now cut only for results that survive the limit, from a separate small cache. Measured against a copy of the real corpus: **mean 110ms -> 19ms, p95 145ms -> 26ms** (50 requests simulating typing "application"), with output byte-identical to the old implementation across 10 queries and 424 matches.

- [x] **32. `docContentCache` is unbounded** (`server.js:343`) — never evicted, grows to the size of the entire corpus in RSS, permanently.
  - Fixed: all three caches (content, search index, snippet sources) are byte-budgeted LRUs — 32MB / 48MB / 16MB. Eviction is unit-tested for recency ordering, overwrite accounting, oversized items, and 5000-insert churn. RSS now plateaus instead of growing without limit; on this corpus it settles ~40MB above the old figure, which is the deliberate cost of the index that makes search 5.7x faster — and unlike before, it is bounded.

- [x] **33. The editor preview re-parses the full markdown *and* re-runs Mermaid on every keystroke** — `input` → `renderEditorPreview` (`app.js:3470`) with no debounce. On any document with diagrams, typing freezes the browser. Concurrent async renders also race each other.
  - Fixed: typing schedules a cheap markdown-only repaint at 120ms and defers Mermaid/KaTeX to 420ms, so a burst of 40 keystrokes produces one of each instead of 40. Every render takes a generation number and abandons its work if a newer render started, so a slow diagram pass can no longer overwrite newer text. Queued renders are cancelled when the editor closes.

- [x] **34. svg-pan-zoom instances are never destroyed.** `applyPanZoom` (`app.js:2065`) creates a new instance per SVG per render and never calls `.destroy()`. `state.panZoomCounter` grows monotonically. Switching documents leaks handlers indefinitely.
  - Fixed: live instances are tracked in a Map and `.destroy()`d before re-rendering a container, before any `innerHTML` replacement that would detach their SVGs, and whenever a tracked node has left the document. Verified that 200 simulated re-renders leave zero instances live and never hold more than one at a time.

- [x] **35. The full sidebar list is torn down and rebuilt on every document open.** `renderDocList()` does `innerHTML = ""` then recreates 93 rows × ~5 buttons with fresh listeners (`app.js:2147`). **Side effect: the sidebar scroll position jumps back to the top every time you click a doc.**
  - Fixed: opening a document now calls `updateActiveRowHighlight()`, which toggles two classes on existing rows instead of rebuilding them. Rows carry `data-file` so they can be found without a re-render. Genuine rebuilds (search, folder collapse) additionally save and restore both the sidebar's own scroll offset and the window's.

- [x] **36. No pagination or virtualization** for the document list.
  - Fixed: each folder group renders at most `DOC_LIST_PAGE_SIZE` (50) rows with a "Show N more" control for the rest, so row count stays bounded no matter how large the corpus grows. The open document is always rendered even when it falls past the cut, and reveal offsets reset when the result set changes.

---

## 🟡 UI / design principles

### Accessibility

- [x] **37. Scrollbars are globally suppressed** — `scrollbar-width: none` and `::-webkit-scrollbar { width: 0 }` applied to `*` (`app.css:32-44`). Every scrollable region — sidebar, code blocks, editor textarea, modals, search results — loses its affordance. Nothing signals that content continues, and mouse users can't drag to scroll.
  - Fixed: scrollbars are visible again, styled thin (10px, `--border` thumb) rather than removed. Every scrollable region now shows it scrolls.

- [x] **38. Focus indicators are removed and replaced with a 1px border tint.** `outline: none` appears on `.icon-btn`, `.btn`, `.doc-item`, `.folder-choice`, `.supersearch-item`, `.search-clear`, `.folder-group-toggle`. A subtle border color shift on a dark background fails WCAG 2.4.7 / 2.4.11.
  - Fixed: one `:focus-visible` rule provides a 2px accent ring app-wide. The three surviving `outline: none` declarations are all on inputs whose focus is signalled by a border + ring instead (`.search-wrap:focus-within`, `.field input:focus`, `#editorInput:focus`).

- [x] **39. All three modals stay in the tab order while invisible.** `.editor-modal`, `.confirm-modal`, `.folder-modal` use `opacity: 0; pointer-events: none` (`app.css:1399`, `1469`, `1663`) — opacity-0 elements remain focusable. Tabbing through the closed app drops focus into invisible dialogs. Same bug on `.search-clear` (`app.css:186`).
  - Fixed: modals are `display: none` until `.open`, so nothing invisible stays in the tab order. `.search-clear` is `display: none` until the box has a value.

- [x] **40. No focus trap, no focus restore, no `inert` on the background.** The dialogs declare `aria-modal="true"` but screen readers can still traverse the entire page behind them, and closing a modal drops focus to `<body>`.
  - Fixed: `enterModalLayer` / `exitModalLayer` keep a stack (the editor can open a confirm on top of itself), mark every body-level sibling below the top dialog `inert`, cycle Tab within it, and hand focus back to the element that opened it. The toast region is deliberately exempt so it stays announceable. Verified for the stacked case: closing the inner dialog revives the outer one but not the app.

- [x] **41. `aria-live="polite"` on the entire `#docContent` article** (`index.html:190`). Every document load announces the whole document to screen readers.
  - Fixed: the article is no longer a live region. The same defect was present on the whole `#superSearchPanel`, which re-announced all eight result rows on every keystroke — now only the result tally is live.

- [x] **42. Touch targets are undersized.** `.row-quick-actions .icon-btn` is 1.8rem ≈ 29px (`app.css:481`); `.icon-btn` is 2.2rem ≈ 35px. Both under the 44px minimum — and the 29px ones are the edit/move/**delete** row actions.
  - Fixed: on touch, tree rows are 44px, the row overflow button is 40px and sidebar icon buttons are 36px. On a fine pointer the bar is WCAG 2.5.8's 24px rather than 2.5.5's 44px, which is the criterion that actually applies to a mouse; `.tree-action` (22px), `.search-clear` (20px), `.crumb` and the new filter chip were all raised to clear it.

- [x] **43. `prefers-reduced-motion` is never honored** (0 occurrences). Hover lifts, 220ms slide-ins, and `scrollIntoView({behavior:"smooth"})` all run unconditionally.
  - Fixed: a `prefers-reduced-motion` block reduces every transition and animation to ~0ms, and the dock's `scrollIntoView` now passes `behavior: "auto"` when the query matches.

- [x] **44. Contrast failures.** `.tag-chip { opacity: 0.6 }` (`app.css:740`) on `--text` over `--mantle` lands near 3:1. `.doc-file { opacity: 0.7 }` on `--subtext` is worse.
  - Fixed by removal: the opacity-dimmed `.tag-chip` / `.doc-file` text is gone. Secondary text is now `--fg-muted` (#8b949e), which clears 4.5:1 on `--canvas`.

### Interaction design

- [x] **45. Destructive actions are visually indistinguishable from safe ones.** Soft delete (`fa-trash-can`) and hard delete (`fa-trash`) sit adjacent, same size, same shape, differing only by a faint red tint and one tooltip word. Three different trash-family icons are in play (`trash-can`, `trash`, `box-archive`) with no legend anywhere.
  - Fixed: the three destructive actions are now distinct icons with distinct wording — `ph-trash` "Move to recycle bin", `ph-archive-box` "Archive", `ph-trash` "Delete forever" (archive view only) — and every destructive control carries `.danger`, which turns it red on hover instead of tinting it faintly at rest.

- [x] **46. Every action is icon-only with no text label** — header, sidebar, viewer toolbar, and row hover menus. Nothing is discoverable without hovering.
  - Fixed: a tooltip layer adopts the existing `title` attributes — on first hover the text moves to `data-tip` (which also stops the native tooltip, so they can never double up) and is drawn in one body-level element, positioned against the viewport so the sidebar's own scroll container cannot clip it. It shows on keyboard focus too, and is `aria-hidden` because `aria-label` already carries the accessible name. Skipped on touch, where the mobile dock has visible text labels instead.

- [x] **47. Two competing search UIs render the same data simultaneously** — the supersearch overlay panel *and* the filtered sidebar list.
  - Fixed by making the relationship explicit rather than deleting one of them: they do different jobs (snippets and keyboard jump vs. folder context and file actions), and the tree now carries a "Filtered" chip that says it is showing a subset and clears the query in one click. Clicking anywhere outside the panel already dismissed it, so the two are rarely on screen together.

- [x] **48. Supersearch caps at 8 results but reports the full count** (`SUPERSEARCH_LIMIT`, `app.js:104` / `1110`). "42 result(s)" with 8 rows and no "show more."
  - Fixed: the tally reads "Showing 8 of 42" whenever it is holding results back, and a "Show 34 more" control reveals another 12 at a time, moving focus to the first newly-revealed row. A new query resets the reveal; re-rendering the same one keeps it.

- [x] **49. Wheel-zoom hijacking.** svg-pan-zoom is initialized without `mouseWheelZoomEnabled: false`, so scrolling the page with the cursor over a diagram zooms it instead. Made worse by #50.
  - Fixed: wheel zoom is off by default, so scrolling past a diagram scrolls the page. Holding Ctrl/Cmd arms it for as long as the key is down (the gesture maps use), and the +/- control icons work regardless. A window blur disarms it, since a keyup that happens unfocused never arrives.

- [x] **50. Every Mermaid diagram is forced to 65vh with a 500px minimum** (`app.css:1200-1213`), regardless of content. A three-node flowchart occupies half the screen, and the block is nearly unavoidable as a wheel trap.
  - Fixed: the forced `65vh` / `500px` minimum is gone. Diagrams size to their content (`height: auto`), so a three-node flowchart takes three nodes' worth of space.

- [x] **51. Enter-to-jump-to-next-match in the search box (`app.js:3240`) is completely undiscoverable** — no hint, no shortcut legend anywhere in the app.
  - Fixed: the results panel carries a hint row that names the keys, and it changes with the mode — "Enter open top result" normally, "Enter next match · Shift+Enter previous" once you are reading a document that matches the query. The `/` focus shortcut is on the search box itself.

- [x] **52. The status bar reserves 1.9rem permanently** (`app.css:893`) even when empty, and narrates routine actions ("Viewing X") into an `aria-live` region.
  - Fixed: the permanently-reserved status bar is gone entirely, replaced by toasts that occupy no layout when there is nothing to say.

- [x] **53. No print stylesheet** (0 `@media print`) — for a document viewer.
  - Fixed: chrome comes off, the fixed shell's height clamp and overflow clip are released so the document flows across sheets (without this only the first page prints), the dark palette inverts, link destinations are printed after the link text, and code blocks, table rows and diagrams get `break-inside: avoid`.

- [x] **54. Hardcoded dark theme only.** No `prefers-color-scheme`, no toggle, despite `theme-color` being set.
  - Fixed: a header toggle cycles dark -> light -> auto, persisted in `localStorage`. **Dark stays the default** so nothing changes for an existing user; only "auto" follows the operating system. Because every colour already goes through a custom property, the light theme is a token swap and no component knows which theme is running — the same teal, darkened until it carries text weight on a pale surface. Two things do not follow automatically and are handled explicitly: the `theme-color` meta, and Mermaid, which bakes hex into its SVG and so is redrawn from source on a theme change.
  - `js/theme-boot.js` applies the stored preference before first paint, and resolves "auto" to a concrete value there, so the stylesheet never has to carry a second copy of the palette inside a `prefers-color-scheme` query. It is a separate file rather than an inline script because the CSP has no `'unsafe-inline'` for scripts.
  - Contrast measured on both themes: light body text 16.43:1, accent 6.64:1 on canvas, 5.83:1 on a selected row, primary button label 6.17:1. Scrollbar thumbs got their own token so they could reach the 3:1 that WCAG 1.4.11 asks of a control without thickening every hairline border in the app.

### Layout / CSS

- [x] **55. The header grid has a phantom empty column.** `grid-template-columns: auto 1fr minmax(220px, 360px) auto` (`app.css:114`) has 4 tracks, but on desktop `#toggleSidebar` is `.mobile-only { display: none }` — so only 3 items exist. Search lands in the `1fr` track and the 3-button action group gets the 220–360px track. The sizing intent is inverted and the 4th track is dead.
  - Fixed: the header is flexbox now. The phantom track cannot recur, because a `display: none` flex item simply closes up instead of shifting later items into the wrong column.

- [x] **56. Feature parity breaks across breakpoints.** `.header-actions { display: none }` on mobile (`app.css:1923`), and the dock hides its Search and Edit buttons via `.dock-redundant` (`app.css:2202`). `elements.dockEdit.disabled` is still being managed in JS for a permanently hidden element.
  - Fixed: `.dock-redundant` is gone and the mobile dock shows all five actions, so `elements.dockEdit.disabled` now controls something a user can actually see.

- [x] **57. The nth-child icon-color rotation is broken by folder grouping.** `.doc-list li:nth-child(4n+1) .doc-icon i` etc. (`app.css:651-665`) — `.doc-list`'s children are now `.doc-group` wrappers, so the color applies per *group* and cascades to every doc inside it. Icon color now conveys nothing and fights the semantic icons from `inferIcon`.
  - Fixed by removal: the `nth-child` icon-colour rotation is deleted. Icon colour is now semantic only — `--accent` for folders and the open file, `--fg-muted` otherwise.

- [x] **58. `--subtext1` is used but never defined.** `.svg-pan-zoom-control-element { fill: var(--subtext1) }` (`app.css:1251`) — the variable doesn't exist, so the pan/zoom control icons fall back to black on a dark background.
  - Fixed: `--subtext1` is gone; the pan/zoom controls use `--fg-muted` and go `--accent` on hover.

- [x] **59. Dead CSS for markup that no longer exists:** `.doc-main`, `.doc-head`, `.doc-file`, `.folder-choice.is-root`, `.viewer-toolbar .btn`. Confirmed zero matches in `app.js`.
  - Fixed by rewrite: the stylesheet was rebuilt from scratch, so no dead rules survived. Verified by cross-checking every class referenced in `app.js` and `index.html` against the stylesheet — the only unmatched names are Mermaid's own `.mermaid` hook and four unstyled notebook modifiers.

- [x] **60. The mobile sidebar's `padding-top: 4.9rem`** (`app.css:1945`) is a hardcoded guess at the sticky header height. Any header wrap hides content underneath.
  - Fixed: the mobile sidebar is a full-height fixed panel with its own header row, so there is no hardcoded guess at the app header's height to get wrong.

- [x] **61. Ad-hoc z-index scale with no system:** 0, 1, 2, 20, 45, 52, 55, 60, 70, 75, 80. The match-nav at 52 sits below the sidebar at 60 and the overlay at 55.
  - Fixed: a single ascending scale — 20 viewer toolbar, 25 search results, 30 header, 45 dock, 55 overlay, 60 sidebar, 100 modals, 200 toasts. The overlay now sits below the sidebar it dims, which is the ordering the old scale got backwards.

- [x] **62. Three modals, three different visual languages** — the confirm dialog has an eyebrow/title/description structure the folder and editor dialogs don't share.
  - Fixed: all four modals share one `.modal` / `.dialog` structure. The eyebrow labels are gone.

---

## 🟡 Project hygiene

- [ ] **63. README documents port 3000; the actual default is 4321** (`server.js:11`). The stated URL simply doesn't work.

- [ ] **64. README documents `npm test`, which isn't defined in package.json** — running it errors.

- [ ] **65. No tests, no linter, no CI, no formatter config.** Zero.

- [ ] **66. `.gitignore` excludes `package-lock.json`** (confirmed untracked) while the README lists it as part of the project structure. Reproducible installs are broken.

- [ ] **67. Three different product names:** package.json `cart-docs-viewer`, README "Cart Documentation Viewer", UI "Markdown Docs Viewer", plus `document.title` says "Cart Docs Viewer" (`app.js:2491`) while recycle-bin mode says "Markdown Docs Viewer" (`app.js:2599`).

- [ ] **68. Leftover corporate boilerplate from an unrelated template.** `author_name: "7-Eleven, Inc."` is hardcoded in the oEmbed response (`server.js:880`) and the README declares "Proprietary - 7-Eleven, Inc." — on a personal repo.

- [ ] **69. `EMBED_DESCRIPTION` is stale** — "Browse, search, and share **cart** documentation" (`server.js:27`), served as the OG description on every page.

- [ ] **70. README omits half the API** — no folder endpoints, no `/api/docs/search`, and the project structure diagram omits `data/`, `deleted_markdowns/`, and `markdowns/`.

- [ ] **71. README troubleshooting is wrong** — it lists supported extensions without `.ipynb`, which the app does support.

- [ ] **72. No request logging, no health check beyond the GraphQL `health` field, no graceful shutdown.**

---

## Configuration added by the security fixes

| Env var | Default | Purpose |
|---|---|---|
| `MDVIEWER_TOKEN` | random per boot | Bearer token required for all write endpoints. If unset, one is generated and printed to the log at startup, so the app never runs open — but it changes on every restart. |
| `TRUST_PROXY` | `false` | Set to `true` (or an express trust-proxy value like `loopback`) only when behind a reverse proxy. Controls whether `X-Forwarded-*` is honoured when building canonical/oEmbed URLs. |
| `ENABLE_GRAPHQL_INTROSPECTION` | `false` | Re-enables GraphQL schema introspection for local schema work. |
| `PUBLIC_BASE_URL` | unset | Pre-existing. Overrides the request host entirely when building embed URLs — the most robust defence against host-header spoofing. |

Reads (`GET`) stay public so shared links, social cards and oEmbed unfurls keep working.
