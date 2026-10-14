# Tests, and the machinery that keeps them honest

How the suites are run and what each one covers, followed by the checks that
run beside them: types, complexity limits, the escaping rule, the dependency
audits and the sanitizer.

For contributing conventions see [../CONTRIBUTING.md](../CONTRIBUTING.md).

---

## Tests

```bash
npm test
```

Thirty-four suites, about three minutes. All but two need no browser and no
network, and are deterministic on a runner with no egress. The exceptions are
`browser` and `accessibility`, which drive a real Chromium; with none installed
they say so and pass, because the step that installs it lives in the workflow
where its absence is visible.

| Suite | What it covers |
| --- | --- |
| `layout` | Shell geometry, which element owns each scroll, the z-index scale |
| `mobile` | Breakpoints, spacing, touch target sizes, safe areas, the dark palette |
| `theme` | Light and dark tokens, contrast ratios (including syntax highlighting), target sizes, the print stylesheet |
| `diagrams` | Mermaid sizing maths and the per-theme diagram palettes |
| `loading` | What the first paint is allowed to fetch, the lazy libraries and their SRI hashes, the loading state |
| `auth` | Password hashing, sessions, CSRF, RBAC, rate limiting, share links |
| `links` | What the link fetcher refuses to reach, metadata parsing, grouping, storage, RBAC |
| `assets` | Pasted images: what may be uploaded, size and type refusals, deduplication, RBAC, share scoping |
| `code` | Copy buttons, both clipboard paths, and the live-highlighting policy |
| `visual` | The block round trip, over fixtures and over every real document |
| `recycle` | The recycle bin and the archive: delete, restore, erase, and who may do which |
| `limits` | How complicated the code is allowed to get, and the budget that keeps it a decision |
| `dom` | The real `index.html` + `app.js` in jsdom against a real server, and the share view in a window of its own |
| `diagram-page` | The diagram editor page, its address, and the document handoff |
| `export` | Taking a copy away: the snapshot's stylesheets, the paginator's arithmetic, the zip a .docx is |
| `worker` | The Python worker: the message protocol, both output caps, and the network it takes away from itself |
| `browser` | The five things jsdom cannot answer, in a real browser |
| `accessibility` | axe over six page states in both themes, the skip link, reduced motion, 200% zoom and forced colours |

### jsdom, and the two that are not

Every client suite but two runs in jsdom, which is a JavaScript implementation
of the DOM rather than a browser. That is the right trade for almost
everything: it is fast, it runs every check in one window against one server,
and thirty-odd suites in three minutes is worth keeping.

It cannot do five things, and they are not small ones. It does not lay
anything out, so `getBoundingClientRect()` answers zeroes and every
measurement the app makes is unverifiable. It parses a Content-Security-Policy
and ignores it, so the app's main defence has never been seen to refuse
anything. It does not run a Web Worker. It does not paint. And its event loop
is not a browser's, so anything timing-dependent passes or fails for reasons
that are not the app's.

`browser` is five checks against exactly those gaps — the console is empty,
the CSP refuses an injected script, the layout measures what the stylesheet is
read to mean, a document renders with the real libraries fetched and their SRI
hashes enforced, and the theme toggle changes painted colours. The first page
it ever loaded found a defect: the app's own icons, written as absolute URLs
from `PUBLIC_BASE_URL`, were refused by the app's own `img-src 'self'` on any
other hostname. `layout` and `mobile` keep their reasoning about the
stylesheet — it is fast and it catches a different class — and `browser`
measures the same claims, so the two have to agree.

Install the browser with `npx playwright install chromium --only-shell`. It is
266MB, needs no system packages, and is the same one the server uses to draw
PDF exports.

### What axe says, and what nothing says

`accessibility` is the other suite that needs the browser, for the same
reason: the rules it checks are about what was painted. It runs axe-core over
six page states — signed out, the shell, a document, the editor, the diagram
editor, the error page — in both themes, against a budget of accepted
violations that is empty and is written down so that it cannot quietly stop
being empty. Four more checks go beyond what axe decides: that
`prefers-reduced-motion` actually stops the motion, measured off computed
styles rather than read out of a stylesheet; that the layout at 200% zoom has
nothing sticking out sideways; that the first Tab reaches a way past the
explorer and that following it moves the focus rather than only the scroll; and
that with the colours taken over by the system there is still something drawn
to read.

It found four defects on its first run. `--fg-subtle` was 3.8:1 behind
metadata lines in the dark theme and 4.4:1 in the light one; the share and
error pages declared no language; two of the five buttons in the mobile dock
were named something that did not contain the word printed on them, which is
what a voice-control user says; and the diagram editor's panel separator was
focusable with a focusable button inside it, so a screen reader reading the
separator would never have offered the button that brings a shut panel back.
A keyboard pass beside it found a fifth, which axe cannot see: opening a folder
with the right arrow rebuilt the list and lost the focus.

What it cannot say is most of it: axe decides perhaps a third of WCAG, and
nothing in this repository has ever been put in front of a screen reader.
`docs/ACCESSIBILITY.md` is the honest list of what is checked, what is
accepted, and what is not known.

### The Python worker, which is both

`public/js/pyodide-worker.js` is the only place this app runs code somebody
else wrote, and it was the only file nothing had ever opened — jsdom has no Web
Worker, so 291 lines sat at nought per cent.

It does not need a browser for most of it. What the worker does with a message
is a function of the message, so the `worker` suite loads it into a `vm` with a
scope it believes is a worker's and a Pyodide that answers and nothing more.
That reaches the protocol, both output caps, the error paths, the queue and the
network guard, with no browser and no twelve megabyte download — the same
technique `headers` uses to load `dom-html.js`.

It is the one file in this repository at **100%** — every line, every branch,
every function. That is worth doing here and is not worth doing everywhere: it
is 291 lines, it is a pure function of the messages it is sent, and it is the
only place this app runs code somebody else wrote. Getting the last four per
cent meant naming four real things rather than four lines — a URL the parser
will not read, a value whose `__repr__` raises, trouble fetching a wheel, and
a failure in the cleanup that must not stall every cell after it.

What it cannot say is whether Python runs. That is one check in `browser`,
where a real Worker loads the real thing from the CDN and prints: "the fake
agrees with the protocol" and "a cell prints" are different claims, and only
the second is about the feature working.

The `dom` suite spawns its own server against a throwaway `MDVIEWER_STATE_DIR`
seeded with a known corpus, so it exercises the write paths for real and can
never touch actual documents. The others parse the stylesheet and the client
source directly — `test/app-source.js` reads the script order out of
`index.html`, so "the client source" means every module the page loads and not
one filename — several of them assert things a human cannot check by looking,
like WCAG contrast ratios and rendered diagram box sizes.

Run one at a time with `npm test theme`, or a file directly with
`node test/theme.test.js`. The runner starts several at once — they are
separate processes that share nothing, and each one that needs a server starts
its own on a free port against its own temporary directory — holding each
suite's output until it finishes so the log reads the same as it would have
one at a time. That took the whole run from about 225s to about 85s.
`npm test -- --serial` turns it off.

`npm test dom -- --only "recycle bin"` prints only the checks whose label
matches. Everything still runs: most of these suites are one long session
rather than a set of independent cases — a check three hundred lines in stands
on what the ones before it left on the page — so running a third of one would
be running something else. What the flag does is hide the passing lines that
are not the one being worked on; a failure always prints.

Because several suites run at once, every wait in them has a ceiling that
means *this is never going to happen* rather than *this machine is slow*: a
page that boots in 200ms on an idle machine can take a few seconds with three
other jsdom suites between it and a core, and a tight deadline there catches
nothing a loose one misses.

Every suite gets its `check()` from `test/helpers/check.js` rather than
declaring one. The line it prints is the same as it always was; what it does
behind that line is a structural comparison rather than `JSON.stringify` on
both sides, because that equality was wrong in four ways worth naming: key
order counted, `undefined` disappeared (so `{parent: undefined}` equalled `{}`,
in a file format where `delete node.parent` and `node.parent = null` mean
different things), every `Map` and `Set` flattened to `{}`, and `NaN` became
`null`. It also compares across realms, which the plain `assert.deepStrictEqual`
would not: the DOM suites hold arrays built inside a jsdom window against
arrays built outside one, and those have different prototypes for the same
shape.

### What the suite never reaches

```bash
npm run coverage
```

The same suite under [c8](https://github.com/bcoe/c8), which reads the
coverage V8 already collects — nothing is instrumented or rewritten, and the
server the DOM suite spawns is counted too, because `NODE_V8_COVERAGE` is
inherited by child processes. The report is `coverage/index.html`; CI runs it
as its own job and attaches the report to the run.

There is a load harness beside it, `tools/load.js`, which asks a different
question — what happens when more than one person is using this at once. It is
not part of `npm test`: it takes a minute per corpus size and its numbers
depend on the machine. What it found is written into
[OPERATIONS.md](OPERATIONS.md#how-many-people-can-use-this), and the one claim
worth a check went into the `search` suite — the index opens zero documents
where the scan it replaced opens a thousand.

It is a map, not a target. There is no threshold and there will not be one: a
percentage that has to go up is a percentage people write tests to raise, and
the value here is the other thing — the list of what a suite this thorough
still does not touch, which is where confidence exceeds evidence.

On its first run the map named four places, all of them now covered by tests
written because it named them:

| What it found | Where the tests are now |
| --- | --- |
| Nothing reached restore, hard-delete or erase — the routes that move somebody's work about, and the only route in the app that deletes a file for good | the `recycle` suite |
| `restoreFromBin` in the store, including a restore into a folder and onto a name taken since the delete | the `recycle` suite |
| The single-file `/api/docs/upload` route | `test/auth/library.js` |
| `public/js/share.js` — the entire client a visitor following a share link runs, evaluated by no suite at all | `test/dom/share-page.js` |

That moved `lib/routes/recycle.js` from 55% to 88%, the store from 83% to 92%,
and the share client from nothing to 87%. The security-adjacent code — guards,
sessions, the limiter, headers, the CSRF check — is in the nineties. What is
left low is mostly the app's own interface modules, which the `dom` suite
reaches only as far as it drives them; the section below says which of those
were worth going after and which are thin on purpose.

`pyodide-worker.js` was the exception and is no longer: it ran in a Web Worker
that jsdom does not implement, so nothing had executed a line of the one file
that runs code somebody else wrote. The `worker` suite executes it in a `vm`
instead, and it is now the one file here at 100% of lines, branches and
functions.

### Which parts of the client are thin on purpose

The other thing the map named was the interface: `public/js/app/` at 73%, three
thousand lines nothing reached. That number is not a defect on its own, and the
honest reading of it took a while to arrive at — the `dom` suite drives the
paths a person takes, so what it misses is mostly the branches around them: the
confirmation that was declined, the name that collided, the request the server
refused, the session that ended halfway through.

So the three worth writing were picked by consequence rather than by
percentage:

| Area | Why it, and not the lowest number | Now |
| --- | --- | --- |
| `app/users.js` | It creates accounts, changes roles, disables people and resets passwords. The `auth` suite covers what the server allows; nothing covered what an administrator is *shown*, or what the table does when the server says no. `test/dom/accounts.js` | 19% → 97% |
| `app/session.js` | Sign-in, sign-out, the forced change, expiry. The unreached half was the failure half, and a session ending mid-edit is a thing that happens. `test/dom/session.js` | 41% → 96% |
| `app/folder-ops.js`, `app/folder-modal.js` | Moving and deleting folders is the operation that can lose the most work at once, and the dialog is the way in that the tree checks do not use. `test/dom/folders.js` | 28% → 95% and 94% |

Writing them found a defect on exactly the kind of path they were written for.
A 401 and a password-change 403 were thrown without the status every other
refusal carries, so the background hydration that warms the offline search —
which already skips a 404, because a document deleted while it was being read
is not a fault — could not do the same for a session ending. One sign-out
mid-hydrate wrote "Sign in to continue." to the console once per document still
in the queue, which is how a real error gets buried.

The rest is left where it is, deliberately, and this is the list so the number
is a decision rather than an oversight:

- **`app/jump.js`** (50%) steps between matches inside the open document and
  across into the next one that matches. The finding and the marking are
  checked now, in `test/dom/jump.js`: what is skipped, which term wins where
  two could match, and that clearing puts the document back as it was. The
  stepping is still geometry against a rendered document, which is the thing
  jsdom is worst at — that half belongs in `browser` or in nothing.
- **`app/doc-actions.js`** (25%) and **`app/file-actions.js`** (32%) are the
  two halves of delete and restore — by open document and by name. What they
  ask of the server is covered thoroughly by `recycle`; what is unreached is
  which view you are left looking at afterwards.
- **`app/notebook.js`** (31%) is the glue between a Run button and the output
  under the cell. The worker it drives is covered by `worker` and run for real
  once in `browser`; the glue is reached only as far as rendering.

The workflows are read rather than run — nothing here can start a runner — so
what `operations` checks about them is what can be read: that every action in
every workflow is pinned to a commit with the version beside it, which is the
rule that matters most in `release.yml`, the one that signs in to a registry
and pushes an image.

None of that is a promise to leave them alone. It is a statement that the
numbers were looked at and the answer was "not yet", which is a different thing
from not having looked. There is still no threshold in CI and should not be one.

### And three the map kept pointing at

Picked the same way — by what a defect in them would cost, not by their number.

| | | What is checked |
| --- | --- | --- |
| `annotate/surface.js` | 53% → 94% | The layer the ink is drawn on, which no suite had opened. The two erasers (whole strokes against points), the laser ageing its own trail rather than capping it, and the resize that collapses the layer before measuring the surface it sits inside. `test/annotate/surface.js` |
| `export/snapshot.js` | 51% → 65%, and since to 100% | The half that wants a document: where the copy's box is once ink drawn in the margins is counted, and how big a sheet is. `test/export/sheets.js`, and then the four files below |
| `app/jump.js` | 27% → 50% | Above. `test/dom/jump.js` |

Two of those files run in a jsdom of their own rather than in the suite's
process, for the same reason the DOM suites do: they build elements. What they
measure is supplied rather than asked for, because jsdom lays nothing out —
which is what makes the arithmetic checkable at all, and is the same trick
`export.test.js` already used for a diagram's bounds.

### The export path, all four files

The export is the one area taken to the end, and it is worth saying what that
took, because the four files are the clearest example in the repository of code
that is not hard to test and had not been tested.

| | | What was missing |
| --- | --- | --- |
| `export/paginate.js` | 61% → 100% lines, branches **and** functions | The arithmetic for where pages break was covered. The measuring was not: the margins `getBoundingClientRect` leaves out, the four tries an oversized block is given, the floor under how small it may go, and the correction pass |
| `export/snapshot.js` | 65% → 100% lines and functions | The fetching and the building — stylesheets, fonts, pictures, diagrams, the ink laid over each sheet, and every way each of those can fail |
| `export/pdf.js` | 69% → 100% lines and functions | The page: the typography the sheets have nothing to inherit from, the sheets as XML, and the text layer |
| `export/formats.js` | 75% → 100% lines, branches and functions | The handing over: the link made and pressed and taken away, the object URL given back a minute later, and the three ways the server can refuse to draw a PDF |
| `export.js` | 60% → 100% lines, branches and functions | The button itself: the menu, every way of closing it, the one collection at a time, and what it says while it works — including on a share page, which has no toasts and says it in the menu instead |

Four things are stood in for, and they are the four a browser does and Node
does not: the network as a table of what each URL answers with, the rasteriser
as a canvas that answers the same thing every time, the image loader as one
that answers on the next tick, and the layout as twenty lines of block stacking
in `test/export/layout.js`.

That last one earns its place rather than being a convenience. `settle` exists
because a height measured in the frame is now and then a few pixels short of
the height the block has on the sheet — which is a clipped descender at the
foot of a page — and it asks each sheet whether what it holds still fits.
Asking that of a document where nothing has a position is asking nothing.

Writing it taught us something about the code, too. A `zoom` scales the lengths
inside it, so a block in a wrapper at two thirds has half again as much room to
lay itself out in — which is why the paginator shrinks, measures again, and
almost always stops there. The first version of the test had it converging the
wrong way and the code was right.

### The diagram editor's ninth file

`diagram-editor.js` is the biggest file in the repository and was already at
91%, driven by eight files under `test/diagram-page/`. `reaching.js` is the
ninth, and takes it to **94.4%**.

It adds no machinery: everything in it is a right-click, a drag or a press on
something those eight already know how to find. What it reaches is the part of
the editor that is a gesture rather than a button —

- the band dragged round several boxes at once, in the diagram's own
  coordinates rather than the page's, since the view is translated and scaled;
- the corner an arrow was *already* bent at when the diagram was opened, which
  is the same handle as bending a straight one and a different path through the
  code, because the gesture starts on a dot rather than on a line;
- which box is in front of which, which has no z-index to set: an SVG draws in
  document order, so the only way to put one box in front is to move it in the
  file;
- a box drawn by pulling an arrow into empty paper, and the next one moved
  along rather than dropped exactly on top of it;
- a shape dragged off the palette, with the ghost that follows the pointer and
  goes with the gesture when the browser takes it away;
- a picture chosen from the file dialogue — the dialogue is the browser's, so
  what is stood in for is the file coming back from it, and the upload runs
  against the real server from there;
- and the PNG, which is the same SVG the other button saves put through a
  canvas. jsdom has no rasteriser and fetches nothing, not even a data URI, so
  both the canvas and the `<img>` load are the suite's to answer.

One small thing was added to the shared harness: `openPage` takes a `before`
callback, for anything that has to be on the window before the page's own
scripts read it. The editor reaches for a `ResizeObserver` while it is being
built, and jsdom has not got one.

### The rendering path, run rather than read

`diagrams` and `loading` both read these files as text, and for the stylesheet
and the palettes that is the right thing to do: a rule is a rule, and the
contrast arithmetic is over the numbers in the palette table. But a dozen
checks in `diagrams` had drifted into reading the *engine's source* for the
lines that do the work — `js.includes("svg.viewBox?.baseVal")`,
`repaint.indexOf("destroyPanZoomInstances();") < repaint.indexOf(…)` — which
is a test of the text and passes a rename that breaks the page.

Those are gone, replaced by `test/diagrams/rendering.js`, which runs the
modules. Four libraries are stood in for, and all four are ones the page
fetches from a CDN when a document turns out to need them: Mermaid,
svg-pan-zoom, KaTeX and highlight.js. Each answers the smallest thing the app
asks of it and writes down what it was asked — what Mermaid *draws* is
Mermaid's business, and whether the block it drew into has a height of its own
is ours. The CDN is stood in for as well, because jsdom fetches nothing and a
`<script>` it appends fires neither event: a table says which assets arrive,
so the paths where one does not are reachable at all.

| | |
| --- | --- |
| `md/mermaid.js` | 64% → **100%** of lines and functions |
| `md/diagram-theme.js` | 99% → **100%** of lines and functions |
| `md/panzoom.js` | 74% → 99.4% |
| `md/math.js` | 75% → 98.2% |
| `md/code.js` | 90% → 99.6% |

What that reaches which reading the source could not: the ER simplifier's
second attempt (the common failure — Mermaid's ER parser refuses a type it does
not know and then refuses the whole diagram for it); the box a diagram is given
before it is drawn, including the three fallbacks when it will not say how big
it is; the wheel that is on only while Ctrl is held, and is not left stuck on
when the window loses focus mid-press; the pan-zoom instances being let go of,
which were once leaked on every re-render; and the four steps of the theme
repaint in the order they have to happen in.

`md/code.js` came with it, in `test/code/edges.js`: the paths a reader only
meets when something has gone wrong. No highlighter on the page, which is every
page until a document turns out to have code in it; one that falls over, which
has its own `try` on the live path because that runs on every keystroke and a
throw there would take the editor with it; a clipboard that refuses on a secure
origin, where the older `execCommand` path is not subject to the same policy
and is tried instead — and gives the reader back the selection it had to take
to do it; and a caret in a block that was edited out from under it.

Four lines are left in the area and all four are guards their only caller has
already settled: `renderLoadedMathBlocks` checks for a root that
`renderMathBlocks` has already checked, `applyLoadedPanZoom` skips an SVG
marked as already initialized which the `destroyPanZoomInstances` two lines
above it has just unmarked, and `highlightLoadedCodeBlocks` checks for a
highlighter that the loader resolving `true` has already guaranteed.

### The renderer's own three

| | | What was missing |
| --- | --- | --- |
| `md/notebook.js` | 68% → **100%** of lines and functions | A .ipynb drawn as a document: every output kind, every place a notebook says what language it is in, and which cells get a Run button |
| `md/text.js` | 93% → **100%** of lines and functions | The corners of the maths walk — an escaped dollar, an unclosed one, a fence opened with tildes — and the base64 round trip the TeX makes |
| `md/lazy.js` | 83% → 87% in its own suite | The loader itself, which nothing had ever run |

The loader is the interesting one, and it changed what `loading` is. That suite
reads these files as text, because a critical-path budget is about what is *in*
them — and three of its checks had drifted into reading the loader's source for
the lines that set `integrity` and `crossOrigin`. They are now checked by
running it: the suite evaluates `md/lazy.js` in a window and hands it a `head`
that answers, so whether an asset arrives is the suite's to decide. That is
what makes the failure path checkable at all, and it is the path that matters —
a library that will not load has to degrade the document rather than fail it,
tell the reader which part of the page is not what it should be, and *not*
remember the failure, so that a document opened after the network comes back
tries again.

### Writing on a shared document, all four files

The same treatment, and the one that found a defect.

| | | What was missing |
| --- | --- | --- |
| `annotate.js` | 64% → 99.8% lines and 100% functions | All of it: the toolbar, the tools, the pointer, the history, the palette, the reflow |
| `annotate/geometry.js` | 94% → 99.8% | The degenerate strokes — a tap, a repeated point, a stroke with no height — which every function in there is handed sooner or later |
| `annotate/surface.js` | 94% → 99.5% | The layer put back after a re-render, a pointer event with no stroke under way, and the laser's own clock |
| `annotate/store.js` | 91% → **100%** of lines, branches and functions | A browser that will not store anything: private mode, a blocked origin, a quota that is gone |

The feature is a transparency over somebody else's document, so nothing here
goes to the server and the whole of it is a browser. What that costs the suite
is four stand-ins: `PointerEvent`, which jsdom has not got and which is
assembled out of a `MouseEvent`; `ResizeObserver`, so the page can be made to
change shape on purpose; `window.confirm`, since erasing everything asks; and
`setTimeout`, so the two waits in the module can be brought forward. The
laser's clock is left to run for real — a quarter of a second of wall clock,
once, for the one part of the feature that *is* a clock.

**The defect it found.** "One drag is one undo step, however many strokes it
rubs out" was the comment, and the snapshot was taken at the first stroke
actually rubbed out. On a drag that crosses nothing there is no first stroke
rubbed out, so the snapshot was taken on *every* `pointermove` instead: one
drag across a blank margin put a hundred identical copies of the document on
the undo stack, and undo then did nothing, a hundred times over. The snapshot
is now taken when the drag begins and taken back off if the drag turned out to
rub nothing out, which is both correct and one branch shorter.

Eight lines and four branches are left across the four files, and every one is
a guard on something its only caller has already settled: `say` checks for a
status line that `buildToolbar` always makes; the keyboard handler defaults
`document.activeElement?.tagName` when a document always has a body;
`radialSpread` guards a mean of zero that cannot happen once the bounds are
non-zero; and the point eraser's "nothing was actually removed" path cannot be
reached because the `densify` two lines above it guarantees a sample within
reach of anything `nearPoint` said yes to.

#### The two branches left in the export path, and why they stay

Lines and functions are at 100% across all four files, and `paginate.js` and
`formats.js` are at 100% of branches as well. Two branches are not reached, and
both are unreachable rather than unwritten:

- `intoSheets`, in `snapshot.js`, reads `sheet.dataset.docTop || 0` — and
  `intoPages`, two lines above, always sets that attribute. The fallback
  protects nothing.
- `wordAt`, in `pdf.js`, divides by `natural` and falls back to a scale of 100
  when it is zero. `natural` is a word's length times a size that is at least
  one, and the words come from `\S+`, so it cannot be zero.

Both are a guard on something the only caller has already guaranteed. Reaching
either would mean calling a private function from outside, so they are left
where they are and written down here instead.

`intoSheets` is worth one more sentence, because it used to be the thing left
alone on purpose: it is where the decision "give this sheet the ink only if the
ink reaches it" is made — the fix that stopped a three megabyte export becoming
a hundred and six — and it is not exported. It is now driven for real, through
`build({ paged: true })` with ink on the page, rather than only at the number
the decision is made on.

Two things make the client's numbers mean something. `test/app-source.js`
evaluates each script with a `//# sourceURL` naming the file, so V8 attributes
what ran to `public/js/…` rather than to an anonymous eval. And the `all`
option lists every file under `lib/`, `public/js/` and `server.js` whether or
not anything loaded it, so a module nothing exercises shows as 0% instead of
not showing.

The first of those is easy to leave out and expensive to leave out. Four
suites loaded a client file into a `vm` or a window of their own rather than
through `loadScript`, and `vm`'s `filename` option is not a URL: V8 recorded
what ran under an empty one and c8 dropped all of it. The loss was not
partial. `annotate/geometry.js` read as 40% with every one of its fifty
functions never called, for a suite that exists to drive it; `export/pdf.js`
read as 34%, `export/snapshot.js` as 30%. Naming the files — `runAsScript` in
`test/app-source.js`, beside `loadScript` — moved the repository from 82.7% to
85.2% without a single new check, because the tests were already there. A
number that is wrong in this direction is worse than no number: it points
work at the places that are already covered.

---

---

## What runs beside the suites

### Types, without TypeScript

There is no TypeScript and no compile step: what the browser loads is what is
in the repository. The types are JSDoc comments in the source — `@typedef` for
the shapes that cross module boundaries (the diagram model, the user and
session records, a link preview, `req.auth`) and `@param`/`@returns` where a
signature is not obvious — checked by `tsc --checkJs` through `jsconfig.json`.
`npm run typecheck` runs it, and CI runs it after lint.

Two things follow from wanting that check. Each browser module is
`var Name = (function () { ... return { ... }; })();` rather than assigning to
`window`, because a top-level `var` is a declaration the checker can read the
type of, and a classic script's top-level `var` is still a property of the
window, so nothing about how the page loads has changed. And ESLint allows
`var` at the top level of those files and nowhere else, which is the rule that
keeps it to that one use.

`strict` is off. This is a check for the mistake that spans two files — a field
added to the model in one place and not read in another — not an exhaustive
proof, and the error count had to be something a person could finish.

The names that arrive from outside the source — the CDN libraries, the worker's
own scope, `req.auth` — are declared in `types/globals.d.ts`.

---

### How complicated a function may get

ESLint warns — not errors — about a function that is too branchy (`complexity`
15), too long (120 lines), too deeply nested (4) or takes too many arguments
(5). That severity is deliberate: a long function is sometimes exactly right,
and an error there is a rule to be argued with rather than advice to be read.

The rules went in with seventy-four warnings outstanding. There are none now,
and the `limits` suite keeps it that way: it runs ESLint and fails if the
count is above zero, so a function that grows past a limit shows up as a
failing check rather than in a list nobody reads. Raising one of those numbers
is a decision, to be made in a commit that says why.

What they bought, in order of how much the next person would have thanked us:
the diagram editor's keyboard dispatcher (complexity 62) and its pointer
handler (53), the two halves of the diagram file format — `parseFlowchart`
(59) and `serializeFlowchart` (67) — the tree's keyboard handler (55) and the
markdown block splitter (51), each now a named piece per thing it handles: a
table of commands, one scanner per kind of block, one reader per kind of line.
Then the seven route modules, where every handler moved out of its factory and
takes the same injected dependencies, so what is left in `create…Routes` is
the list of addresses and who may use them. Then two dozen smaller ones, most
of which became a table: what a shape costs to draw, what a search match is
worth, what each kind of notebook output looks like.

Four places answered the rules instead of satisfying them, with a disable and
a reason above it: the diagram editor's `mount`, the guards, the document
store and the search index. Each was a module written as one long closure —
what the rule saw was a huge function, and what was there was a module — which
was true, and still left four functions nobody could read. So each is now the
thing it said it was. The three on the server keep their state in an object
the module builds and their functions take it, and the factory returns the few
of them the rest of the app calls. The diagram editor does the same with `ed`:
one editor is one `ed`, every function takes it first, and `mount` is six named
steps — start the state, bind the canvas, build the rail, build the bar, put it
together, hand back the handle. The `limits` suite holds the list of places
that switch a limit off, and the list is now empty, so the first one is a
change to that file rather than a quiet addition. A test suite is exempt for a
different reason: it is a script, and its branches are its checks.

---

### Markup built as strings

There are about a hundred assignments to `innerHTML` in the client — a button
with an icon in it, a row with a filename on it — and there is no framework
here to hide them. Rendered markdown goes through DOMPurify and a diagram's
SVG escapes its own labels, so the interesting question was never whether
today's hundred are safe; it was what stops the hundred-and-first.

`eslint-plugin-no-unsanitized` stops it. `no-unsanitized/property` permits a
static string and refuses one built out of a value, which is exactly the line
that matters, and the one way past it is `html` in
[`public/js/dom-html.js`](../public/js/dom-html.js):

```js
node.innerHTML = html`<i class="ph ${icon}"></i><span>${label}</span>`;
```

Every interpolation is escaped; an array is joined as markup, which is how a
list is built from `.map(one => html`…`)`; and `trusted(value)` is the one way
to put markup inside markup, so `grep trusted public/js` lists every place
something other than that file did the escaping. Markup that was sanitized
elsewhere — DOMPurify's output, highlight.js's spans, a diagram this app drew
— assigns directly with an `eslint-disable-next-line` naming the reason. The
`headers` suite checks that the rule is on, that the helper escapes what it
promises to, and that every opt-out has a sentence above it.

---

### One owner for a rule two pages apply

Four pages have a theme and only two of them load `app.js`, so the cycle, the
key it is remembered under, the resolving of `auto` and the
`<meta name="theme-color">` all live in
[`theme-boot.js`](../public/js/theme-boot.js) — the script that already runs in
`<head>` on every one of them. `app/theme.js` and `share.js` call it.

That was not free advice. `share.js` had carried its own copy of all four, and
the copy had fallen behind: `ThemeSwitch.apply` moves the `theme-color` meta
and `share.html` has one, so switching the theme on a shared document left the
browser chrome on the colour it had before. Consolidating fixed it, which is
the argument for consolidating. The `theme` suite now checks that neither page
keeps a second copy.

The same shape twice more:

- The Mermaid repaint. A theme change means drawing every diagram again — four
  steps in an order that matters — and it was written out in both
  `app/theme.js` and `share.js`. It is now `repaintMermaidForTheme` in the
  render engine, which both pages hand their own panels to.
- `escapeHtml`. The server filled its four HTML templates with its own six
  lines of it, and the two had drifted: the server wrote `String(value || "")`,
  so a substitution of `0` or `false` escaped to nothing at all, while the
  client wrote `?? ""` and escaped it to `"0"`. `lib/http/html.js` now requires
  [`public/js/dom-html.js`](../public/js/dom-html.js), the way `lib/docs/paths.js`
  already requires `doc-kinds.js` — a plain script in the browser and a
  CommonJS module on the server, which is the seam for the two rules about text
  that both sides have to apply the same way. The `headers` suite runs both
  through the same inputs.

The render engine deliberately does **not** join in: it reads `data-theme` off
`<html>` rather than calling `ThemeSwitch`, because it renders the same
documents on the share page, where most of the app's globals are not loaded. A
renderer that needs one of them is a renderer that works on one page.

---

### What the linter is asked to catch

`@eslint/js` recommended, plus the rules that catch a class of bug rather than
a habit: `eqeqeq`, `no-var`, `prefer-const`, `require-atomic-updates` (a
missing `await` on a write is data loss, not style), `no-unsanitized/property`
above, and `no-console` on the client only — `console.error` in a catch is how
this app reports a renderer falling over, a `console.log` is something
somebody forgot.

`eslint-plugin-security` is on selectively, and the selection is written down
in `eslint.config.js` rather than left to be rediscovered. Nine of its rules
report nothing here and are errors, which is the point: each refuses a thing
this app has no business doing, starting with the first time somebody does it.
Three more are off because they are a syntax census rather than a finding —
`detect-object-injection` flags every `obj[key]` (230), and
`detect-non-literal-fs-filename` flags every `fs` call in a file server (130),
where what actually stops traversal is `resolveDocPath` and `sanitizeFilename`
and the suites that test them.

The one that earned its place is `detect-unsafe-regex`. It found a real bug:
`decodeDataUri` in [`lib/link-preview.js`](../lib/link-preview.js) read a `data:`
URI's parameters with `(?:;[^,]*)*`, where a parameter could itself contain
the separator — so `data:image/png;a;a;a…` with no comma had exponentially
many readings. Twenty-four of them took a quarter of a second, forty would
have taken hours, and the address comes off a page a stranger asked the server
to preview. It is now `(?:;[^,;]*)*`, which can be read one way, and the same
input takes half a millisecond. The plugin reports twelve more; each was
handed sixty thousand characters down the path that has to fail and the worst
took two milliseconds. That list is pinned in the `limits` suite, so the
fourteenth is a regex somebody has to look at.

`no-await-in-loop` is the one suggestion that was declined, with the audit
instead of a shrug: all twenty-seven loops outside the test suites were read,
and none of them is the N-round-trips-that-should-be-`Promise.all` the rule is
for. Most are sequential because the iteration before allocates a filename the
next one must see; some stop early; two are bounded worker pools already
running under `Promise.all`, which is the shape the rule wants and cannot see.
Twenty-seven disables would have said less than the paragraph in the config
does.

ESLint and its two plugins are pinned to exact versions. A major version of a
linter changes what CI accepts without anybody changing a line of source, and
that should be a commit.

---

### Dependencies, and the ones `npm audit` cannot see

The runtime surface is four packages — `express`, `multer`, `better-sqlite3`,
`graphql` — and it is kept that small on purpose. CI runs `npm audit
--audit-level=high` after lint, so a high or critical advisory fails the build
and a lower one shows in the log; Dependabot opens a weekly pull request for
anything behind.

That covers `package.json` and nothing else. Eight more libraries arrive in the
browser as `<script>` tags or lazily fetched URLs, and `npm audit` had never
looked at one of them:

| | version | loaded by | when |
| --- | --- | --- | --- |
| marked | 15.0.12 | index, share | eagerly — nothing renders without it |
| DOMPurify | 3.4.16 | index, share | eagerly — same |
| @phosphor-icons/web | 2.1.2 | every page | eagerly, as CSS |
| mermaid | 11.16.1 | `md/lazy.js` | first diagram |
| KaTeX | 0.16.47 | `md/lazy.js` | first equation |
| highlight.js | 11.11.1 | `md/lazy.js` | first code block |
| svg-pan-zoom | 3.6.1 | `md/lazy.js` | first diagram |
| pyodide | 314.0.3 | `pyodide-worker.js` | first Python cell |

Every one is pinned to an exact version and checked with subresource
integrity, which stops a compromised CDN serving different bytes — and does
nothing at all about a vulnerability in the library itself.

`npm run audit:cdn` closes that. It reads the versions back out of the source
rather than from a list beside it, writes them into a manifest nobody installs,
and asks the same advisory database the real audit uses. It also fetches each
pinned asset and checks the bytes against the hash beside it, because bumping
a version means editing a URL and an opaque string next to it, and getting the
second one wrong is a script the browser silently refuses to run. CI runs it
after `npm audit`, at `--level=moderate` rather than high: this is eight
packages, all of them running in a reader's browser over somebody else's
document, so the noise is bounded and the blast radius is not.

The first run was not academic. DOMPurify was pinned at 3.1.6 with **twenty
XSS advisories** outstanding against it — in the one library whose entire job
here is refusing a document's script — and KaTeX at 0.16.11, where `\htmlData`
did not validate attribute names. Both are now on the fixed versions.

---

### The sanitizer, actually run

Six suites render markdown and all six stub DOMPurify with
`{ sanitize: (html) => html }`, which is right for what each of them is testing
and meant the app's real defence against a document carrying a script was never
once exercised. DOMPurify is now a devDependency, pinned to the same version
the pages load — the `sanitizer` suite checks that those two agree first, then
takes the options out of `md/lazy.js` and runs the real thing.

Thirteen payloads go in and nothing executable comes out. The more useful half
is what the suite writes down about the things that *do* survive, each of which
looks wrong until you find the layer that actually stops it:

- A `<form>` is on DOMPurify's default allow-list, so a shared document can
  render something that looks like a sign-in box. `form-action 'self'` in the
  CSP is what stops it posting anywhere.
- `ADD_DATA_URI_TAGS: ["img"]` is what makes a pasted image work, and it allows
  any `data:` type on an `<img>` — the image-type list in
  `ALLOWED_URI_REGEXP` does not gate that tag. A browser will not run HTML it
  was handed as an image, so this is a thing to know rather than a hole.
- A `data:` image is allowed on an `<a>`, where every current browser refuses
  a top-level navigation to `data:`.

The libraries the browser loads from a CDN are not in `package.json`, so
`npm audit` never sees them. They are pinned to exact versions and checked by
SRI hash, which defends against a compromised CDN but not against a
vulnerability in the library itself. This is the list to check an advisory
against:

| Library | Version | Loaded |
| --- | --- | --- |
| marked | 15.0.12 | on every page |
| DOMPurify | 3.1.6 | on every page |
| Phosphor icons | 2.1.2 | on every page |
| Mermaid | 11.16.1 | only when a document has a diagram |
| KaTeX | 0.16.11 | only when a document has maths |
| highlight.js | 11.11.1 | only when a document has code |
| svg-pan-zoom | 3.6.1 | only when a diagram is drawn |
| Pyodide | 314.0.3 | only when a notebook cell is run |

Bumping one means changing the version in the tag and recomputing the hash —
`public/index.html` says how, beside the tags.
