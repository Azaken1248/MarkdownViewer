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

Thirty-eight suites, about four minutes. All but two need no browser and no
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

One kind of value is not a bag of other values, and treating it as one made a
whole family of checks say nothing. Nothing about a DOM element is an own
enumerable key, so two different elements compared as two empty objects —
equal. Every `check("...has the focus", doc.activeElement, theField)` in the
DOM suites passed whatever had the focus, including nothing at all: eleven
checks across six files, all of them green and none of them asking anything.
A node is now compared by identity and printed as `<input#newPassword>`, which
is both the only question anyone asks of a node and the only answer worth
reading in a failure line. All eleven were in fact correct — they simply were
not evidence until now.

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

This list used to be the rest, left where it was deliberately, so that the
number was a decision rather than an oversight. Every entry on it has since
been written, and what each one says now is where it went and what the original
reasoning got wrong — which is more useful to keep than to delete, because the
reasoning is the part that was mistaken:

- **`app/jump.js`** is no longer on this list. The claim that the stepping was
  "geometry against a rendered document" turned out to be wrong: it is class
  toggling and index arithmetic, and the one part that *is* geometry —
  `scrollIntoView` — does nothing in jsdom and nothing is asked of it. See
  "Stepping between matches" below.
- **`app/doc-actions.js`** and **`app/file-actions.js`** are no longer on this
  list either. They were 25% and 32% when it was written — the two halves of
  delete and restore, by open document and by name — and the thing left
  unreached was which view you are left looking at afterwards. Both are now at
  100%, driven through the rows in the bin and the archive. See "Dragging a
  row" and "Opening a document" below.
- **`app/notebook.js`** has gone the same way, from 31% to 97%: the glue
  between a Run button and the output under the cell. See "Running a notebook
  cell".

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

### The outline, and the heading you are reading

`doc-index.js` draws a document's headings as a tree you can collapse and jump
from, and the existing checks covered the drawing: one entry per heading, the
nesting, what starts collapsed. What nothing reached was the jumping and the
following — 88% → 100% of lines.

A click has to scroll the right thing. The share page scrolls a container of
its own rather than the window, which is the whole reason the module is handed
a `scroller`: the jump is the distance between the heading and the top of that
container, less twelve pixels so the heading is not flush with the edge. Handed
no scroller it asks the heading to bring itself into view instead, which is
what a window-scrolling page gets. Both are checked, and so is the reader who
has asked for less movement: the jump still happens, without the animation.

The scroll-spy is the part worth the most. It is an `IntersectionObserver`,
which jsdom has not got, so what stands in for it hands the callback back and
the suite says what came into view. The arithmetic over those entries is not
obvious and it is the whole feature:

- The *last* heading showing wins, because that is the one scrolled furthest up
  the page — mark the first and the outline lags a section behind the reader.
- With none of them in the band at the top, the next heading *below* the fold
  is the answer. Without that, a reader in the middle of a long section sees
  nothing marked at all.
- Scrolled past every heading, nothing is marked — rather than the first one
  being marked again as though the reader had gone back to it.
- The band is the top fifth of the window (`0px 0px -80% 0px`), which is what
  makes "the heading being read" mean the one near the top rather than any
  heading on screen.

The last piece is a browser that refuses to store anything. Whether the reader
wants the outline is per-viewer taste, so private mode means "not remembered"
rather than an error on a page somebody is only trying to read: the outline
starts shut and still opens when asked. Driving that meant making
`window.localStorage` throw on access, which is closer to what a blocked
origin actually does than an empty store is. And the panel's own close button
hands the focus back to the control that opens it — without which closing the
outline from the keyboard leaves the focus on an element that is now hidden.

Two of these checks catch the exception instead of letting it through, for the
same reason as the page editor's: without its `try`, a browser that refuses
storage throws out of `refresh()`, and a check that dies on that takes the rest
of the file with it rather than naming the guard that went.

### The share page's pen, its footer and its two silences

`public/js/share.js` is the whole of the client a visitor following a link ever
runs, and the `share-page` suite covered the document, the outline and the
theme. The rest of it had never run — 82% → 100% of lines — and all of it is
what a stranger sees when something is not quite right.

The pen is the largest piece. A shared link is usually something somebody is
reading, so the tools stay off screen until the button asks for them, and the
button is also the way back: pressed again it puts them away *and puts the pen
down*. That second half is the one worth a check — a toolbar that is gone
while a drag still draws is a document whose words cannot be selected any
more, with nothing on screen to explain why. What the check reads is the thing
a reader would feel: whether the ink layer is taking the pointer.

The footer is three clauses and each one can be nothing. A document with no
bytes in it says its name and nothing about its size; a document the server
gave no date for, or gave rubbish for, says nothing about when it changed,
because "Updated Invalid Date" under somebody's document is worse than no date
at all. Those two needed an answer this server will not give, so the harness
grew a way to stand in for the network — the same seam that drives the
request which never arrives at all, as against one the server refuses.

Two silences are now checked. A diagram that will not draw says so, in words
about this page rather than about the document, which needed the other new
seam: a callback that runs on the window after the stubs are in and before the
page's own scripts, so `mermaid.render` can be made to fail. And the copy a
link may or may not offer is read from the page as published — the server
decides and the page asks, since a button the client hid would be a permission
enforced by the client.

One check here was written reading the button the moment the content appeared,
which is before the offer is made: the export button is the last thing the
load does, after the diagrams and the ink. It waits for the button now. That
is the second time this session a check has read its answer too early, and
both times the symptom was a failure that looked like the app's.

The stand-in for marked in this suite also learnt one thing: a fence now comes
out as marked leaves one, a `<code>` carrying its language. Promoting a
mermaid block to a diagram is the app's own work on that element, and a
stand-in that never produced one meant the app's diagram path was never
reached from this page.

Twelve of the thirteen deliberate breaks on this file fail a check. The
thirteenth is worth recording rather than chasing: deleting `if (!value)
return ""` from `formatDate` changes nothing, because a missing date reaches
`new Date(undefined)` and the `Number.isNaN(date.getTime())` guard two lines
below answers for it. "A document with no date says nothing about when it
changed" is true and is checked; it is simply pinned by the second guard. That
is the third line found this way — the others are in `setLinkGroups` and
`intoSheets` — and all three are guards on something another line has already
settled.

### Every reason the page editor will not start

`test/dom/page-editor.js` drives editing a document on the page: the blocks,
the history, the save, the handoff to the canvas. The other half of
`app/page-edit.js` had never run — 88% → 99.6% of lines — and it is almost
entirely refusals, which is a good sign about where the risk is in that file.

The four reasons it will not start are one list in the source rather than a
run of guards, and the order is deliberate: the recycle bin comes before
"nothing is open", because a bin row *is* open and the answer about it is the
useful one. Each is checked for its own sentence, including the notebook —
which is refused in a neutral tone rather than as an error, because wanting to
edit one is a reasonable thing to have wanted.

Two paths are not refusals but look like them. Pressing Edit while already
editing does nothing at all rather than starting a second editor over the
first, and leaving an editor nobody opened answers yes rather than refusing.

A `.mmd` file goes somewhere else entirely: the whole file is the diagram, so
Edit means the canvas — when the canvas can read it. When it cannot, the
source editor opens instead, because a canvas that opened a diagram it
half-understood would save a flowchart over somebody's sequence diagram. jsdom
will not let a test stand in for `window.location` (href is unforgeable) and
its navigation complaint carries no URL, so what is read here is that a
navigation was attempted at all and that the two files part company. Where it
goes is the `diagram-page` suite's half.

The rest is what happens when the ground moves. A document the server will not
give up does not open an editor. A reader who clicks Edit and then clicks
another document must not find themselves editing the one they left — the
content arrives for a file that is no longer on screen, and the check makes
that race happen rather than hoping for it. A save the server refuses leaves
the editing where it is, because that is where the work is, with the Save
button usable again rather than stuck.

And the formatting bar, which exists to be refused. With the cursor nowhere it
says where to put it rather than formatting whichever block it finds first.
Code with nothing selected asks for a selection, since marking a whole
paragraph as code because nothing was selected is a paragraph destroyed by a
click. A link whose address was not given writes nothing, and one with nothing
selected writes the address as its own words so the link is visible rather
than an anchor around no text. jsdom runs no `execCommand`, so the suite's
stand-in now records the value as well as the name, and that last check reads
the exact HTML the app asked for.

Two of these checks catch the exception a broken build throws instead of
letting it through. Without its guard, a block format reaches into a block
that is not there — and a check that dies on that takes the rest of the file
with it rather than saying which guard went missing.

### Eleven sessions, not one

The diagram-page suite started failing on CI and nowhere else, as a save that
never finished. What the page actually said, once the runner stopped
truncating it, was "Too many saves just now. Wait a minute and try again."

Writes are rate limited per session — a hundred and twenty a minute — and
this suite is eleven files of a page that saves, with one session between
them. Locally the suite takes about four minutes, so the saves are spread
over four windows and nothing notices. On CI it takes a hundred seconds, so
they land in one.

The limit is not what is being tested here; the `limiter` suite owns it, and
it is not wrong either — a person saving by hand cannot reach it, and the
editor's autosave is debounced. So each part file signs in for itself, which
is eleven budgets instead of one and also what eleven people would be. The
ten requires became a list and a loop while that went in, because the cookie
is now per file rather than per run.

It is worth saying plainly that this was a real bug in the suite, found only
because CI is faster than this machine: a test that passes because it is slow
is a test that will fail somewhere quicker.

### The other half of the shape menu

The shape menu's "No frame" was driven and the rest of it was not, which is
backwards: "no frame" is the unusual choice and a shape is the ordinary one.
Thirteen lines, the largest unreached block in the file.

Choosing a shape is not only setting a shape. The frame is not a shape, so
choosing one has to put the frame back — which is checked on the fixture's
frameless box that carries a picture, since that one keeps its menu where
words lose theirs. And a table is on the same menu, because to a file a table
is a kind of box, so choosing it sets the kind, and choosing anything else
over it takes the kind off again: a table chosen by mistake would otherwise
be a table for good.

A box of one word becomes a table of one cell, which has no rules in it to
look at — the lines are drawn *between* rows and columns — so the check reads
the node's own kind instead, which is the thing the drawing and the file agree
on. It also has to grow, because a grid in a box the size of a label is a grid
nobody can read. That one is measured out of the file rather than off the
paper: a table is drawn to fit its grid whatever the layout says, so the
rectangle on screen is the wrong thing to look at. What has to grow is the box
itself, which is the size that gets written down and the size it will be when
the file is opened again.

Six deliberate breaks, five caught. The sixth removes the `grow` call, and the
box grows anyway — the written size is the same with it and without it, so
something else on the redraw-and-save path sizes a table too. The check is
still worth having: it pins that the box grows, which is what a person sees,
rather than which line did the growing. Two places arriving at the same number
is worth knowing about on its own.

### Which way the diagram runs

The one control on the bar that changes the file rather than the view, and
nothing had touched it: the direction was read out of the file and written
back, and the select that changes it was drawn and never used.

Four checks are about the control telling the truth. It shows the direction
the file is written in — tested on a file written `LR` as well as the usual
`TD`, because a select with no value set shows its first option, which *is*
`TD`, so a control that never reads the file at all looks right on almost
every diagram there is. It offers the four a flowchart can run in. Choosing
another has to be an edit the page knows it has to keep, which is asked before
the save rather than after it: an edit that never reached the page is a Save
button that stays disabled, and the wait for "Saved" would then be a wait for
something nobody started. And the file afterwards says `flowchart LR`, with
the old line gone rather than left above it.

The fifth is about fidelity. `TB` and `TD` mean the same thing to Mermaid and
only one of them is on the menu, so a file written with the other keeps it:
the direction shows as `TB`, the menu carries it beside the four rather than
instead of one of them, and saving the diagram after an unrelated edit writes
`flowchart TB` back. Opening somebody's diagram and nudging a box is not a
reason to rewrite the first line of their file.

Four deliberate breaks, all four caught. Two of them were caught twice over,
once the save-is-possible check went in: without it they stopped the suite at
a wait instead of failing a check that says what it wanted.

### An arrow, changed from the panel

Everything in the arrows file changes an arrow on the paper: dragged, bent,
pulled out of a box, carried with the box it touches. The panel has the same
arrow as a row of controls — where it starts, where it ends, what it says, and
a button to take it away — and that row is the only way to move an arrow's end
to a box nowhere near it, or to give one a label at all. None of it had been
reached.

Both ends are chosen from a list of every box in the diagram, so the check
reads the options as well as the value: a select that offers only the box it
is already on is a control that cannot do the one thing it is for. The far end
is moved to a third box, then the near end to another, and each has to land on
the paper and in the file.

The label is typed rather than chosen, and it is wired to `input` rather than
`change` — it has to land on every keystroke, because anything else loses the
last word typed when the panel is repainted under you. The check types and
then waits for the words to appear on the arrow itself, and the file afterwards
says `B -->|then| C`.

The button on the row is the only way to remove an arrow without going near
it. Afterwards the arrow is off the paper, out of the file, and gone from the
panel, and both boxes it joined are still there — a break that filters the
list the other way round takes away every arrow *except* the one asked for,
which is the kind of mistake that looks right until there are two arrows.

Nine deliberate breaks, all nine caught. Eight of them, though, stopped the
suite rather than failing a check, which is what prompted the harness's second
wait.

### A wait that returns, beside the one that throws

`waitFor` throws when what it is waiting for never happens, which is right
when the page never got far enough for any check to mean anything. It is
wrong immediately before a check: a throw stops the suite with a sentence, so
the run says which file failed and no more, while the check it was standing in
front of would have said what it wanted and what it got.

That is not hypothetical. The breaks above were all caught, and eight of the
nine were caught as a stopped suite with no FAIL line in it — and the same
shape turned up in CI, where a `diagram-page` failure arrived as a summary
line naming the suite and nothing else.

So the harness has `until` as well: the same loop, returning false at the
deadline instead of throwing, for the places where the next line is a check.
The ceiling is lower too, because nothing after it depends on the condition
holding, so there is no cost to finding out sooner. `waitFor` keeps the jobs
it is right for — a page booting, a save finishing — where there is nothing
useful to check if it never happens.

### Tab, in a dialog

`app/modal.js` is the smallest security-relevant file in the client and it
had the largest hole in it: the layer stack and the inertness were checked,
and the focus trap — the reason the file exists — had never been pressed.
A quarter of the module was unreached, all of it `trapModalTab`.

The trap is what makes `aria-modal="true"` true. Without it Tab walks out of
an open dialog into the page behind, which is inert, so the focus lands
somewhere nothing can be done with and getting back in takes a mouse. Four
behaviours, each now pressed in `test/dom/chrome.js`: Tab on the last control
goes back to the first, Shift+Tab on the first goes round to the last,
Shift+Tab when the focus is not in the dialog at all brings it back in, and a
Tab anywhere in the middle is left alone — taking every Tab would mean
reimplementing the order the page already has, and getting it wrong for
anything the stylesheet reorders.

Two more are about the edges of the stack. A dialog with nothing a browser
would focus still swallows Tab, because the dialog is the only live thing on
the page and the key has nowhere to go. And a dialog that is no longer the
top layer keeps its own listener, since it will be the top again, so a Tab
arriving there has to be left alone: wrapping the focus round a dialog nobody
is looking at would move it out of the one they are.

One jsdom gap is filled rather than worked around. The trap asks each
candidate whether it is visible — `offsetParent`, or failing that a box — and
jsdom has neither for anything, so the dialog's own controls are told they
have a box. That is the single thing a browser knows and jsdom does not;
everything else is the real module, and a mutation that drops the visibility
test fails the suite.

Eight deliberate breaks, all eight caught. One branch is left uncovered on purpose: the opener
is only remembered when it is an HTMLElement, and the editor's SVG canvas is
not one — but jsdom does not move the focus out of an inert subtree, so both
sides of that condition look identical from outside, and a check that cannot
fail is worse than a line that is not covered.

### A failing run that said nothing

Two pushes failed CI with no sign of what failed: the step said "Process
completed with exit code 1", the annotations the workflow builds out of the
FAIL lines were empty, and the same commit passed `npm test` locally every
time. The log that was supposed to explain it was missing its last page.

The cause is in the runner, not in any suite. `test/run.js` printed the output
of the suite that finished last, then the summary line, then called
`process.exit`. Node writes to stdout synchronously when it is a file or a
terminal and **asynchronously when it is a pipe**, and `process.exit`
abandons whatever is still queued. Locally the suite is run into a file or a
terminal, so nothing is lost. CI pipes it — `npm test | tee` — so the tail
went in the bin, and the tail is exactly where a failing run says what
happened: a suite's output is buffered and printed when it finishes, so the
whole report of the slowest suite, plus the summary, is written in the last
moment before the exit.

Measured rather than reasoned about: `node -e 'console.log("x".repeat(300000));
process.exit(1)'` writes 300,001 bytes to a file and 65,536 bytes — one pipe
buffer — through a pipe.

So the runner now sets `process.exitCode` and returns. Every lane has been
awaited and every child has exited by then, so the process ends as soon as
stdout drains, which is the same exit status a moment later with the output
intact.

The workflow has the other half: a failing run with no FAIL line in it is a
run that *died* rather than one that disagreed — killed, out of memory, or
exiting on a status before saying why — so instead of annotating nothing, it
annotates the last lines of the log and says that is what it is doing.

Which found the next layer of the same problem. With the output intact, CI
said "1 of 38 suite(s) FAILED in 86.5s: diagram-page" and no more, because
there was no FAIL line to annotate: the suite had thrown. Annotating the tail
as well then annotated the wrong tail — a suite's output is printed when it
finishes, and the one that finishes last is rarely the one that failed, so the
end of the run was another suite's passing checks.

So the runner keeps the last dozen lines of each failing suite and reprints
them after everything else, under "the last of what *name* said". A suite
that failed a check has already said so in its own output and saying it twice
is cheap; a suite that threw, or was killed, said it in a line nothing else
repeats. The end of a run is what gets read, and now it is the part worth
reading.

### And what those pages logged

The DOM suite has read its own console since it was written: an error the page
logged is the page saying something went wrong somewhere it had no other way
to report, and a suite that ignores them can pass while the page throws a
TypeError on every pointer move.

The diagram-page suite was not reading anything. It opens dozens of pages
across ten files, each a jsdom window with the default console, which prints
to the runner's output and is read by nobody. So every page now gets a
virtual console that collects `console.error` and jsdom's own errors, tagged
with the page it came from, and one check at the end says the list is empty —
jsdom's two standing complaints aside, which are about its missing CSS parser
and its missing layout rather than about this app.

Today the list is empty, so this finds nothing of its own. What it adds is
that an exception thrown inside a handler is no longer invisible: jsdom
reports one as a `jsdomError` on the page's console, so a guard removed from
the editor in a way that throws without changing any answer the checks read
now fails the suite instead of passing it. Both halves of that — a logged
error and an uncaught throw in a listener — were confirmed to arrive before
this went in, since a collector nothing has ever caught anything with is a
collector nobody knows is wired up.

### What the diagram editor will not do

`diagram-editor.js` is the largest file in the client and the one with the
most lines nothing reaches — not because the editor is untested (nine files
drive it) but because what they drive is the editor *doing* things. The lines
left over are mostly the places it declines, and they are reached by trying
something perfectly reasonable rather than by anything exotic.

`test/diagram-page/refusing.js` takes four of them.

The two caps are the grammar's rather than the editor's: sixty boxes and a
hundred and twenty arrows are what the parser will read back, so a diagram
grown past either would be one the editor could no longer open. The checks
open a diagram already at each cap and ask for one more — through the palette
for a box, through the arrow tool for an arrow, which are the two gestures
that do not go through a menu — and the editor has to say so and change
nothing. The paper still looks like it has room, which is why the message
matters: without it the gesture simply does nothing and the person tries
again.

The clipboard is three keys people press out of habit at a moment when they
have not selected anything. All three have to be nothing-happens rather than
something-breaks. What makes the guards worth having is not the boxes — an
empty paste puts nothing down either way — it is that every edit tells the
page, and the page clears the line it was using to talk and starts the clock
on an autosave. So the check saves, waits for the page to say "Saved", lets go
of everything, and presses Ctrl+V: the word on screen is what somebody is
reading, and the save it would schedule is a write of a document nobody
changed.

A picture is the one that fails for real. The paper takes any file that says
it is an image, because it has no way to know better; the store sniffs the
bytes and refuses what is not one. So the check drops eight bytes called
`pretend.png` and the refusal comes back from the real asset endpoint, through
the real upload, to the hint line — which is the only place this page can say
anything, there being no toast on it. And the other way in is the file
dialogue, where the commonest thing anybody does is close it again: choosing
nothing has to add nothing and say nothing.

Seven deliberate breaks, six caught. The survivor is the usual pair: the copy
refuses to fill the clipboard from an empty selection *and* the paste refuses
to work from an empty clipboard, so either guard alone is enough and no check
can say which one answered.

What this suite cannot catch is a break that throws rather than returns.
Nothing on the diagram page collects what the page logs, the way the DOM suite
fails on an unexpected `console.error`, so a guard removed in a way that
raises a TypeError inside a handler is invisible here — one of the seven was
caught only because a `waitFor` ran out, which says the right thing but says
it as a stopped suite rather than a failed check. Collecting the page's own
errors is worth doing on its own rather than worked around in each check.

### Every route against a library that will not answer

Each API router is built from a bag of dependencies the server hands it: read
the organizer, move a file, find a share. Any of those can fail for reasons
that have nothing to do with the request — a full disk, a database locked by
another process, a file somebody removed between the check and the read. The
routes are written for it: every handler is a `try` around its body and a
`next(error)` under it, and that line was unreached in ten route files,
thirty-eight times.

The line is not the interesting part; the promise it makes is. A request whose
dependencies fail has to get an *answer*. The alternative is not a wrong
answer, it is no answer at all — a fetch that never settles, a spinner that
spins until the tab is closed, and a server holding a connection open for a
request it stopped working on. That is the one failure mode a person cannot
work around and cannot report usefully.

`test/faults.test.js` mounts each of the nine routers on an app of its own,
with every dependency replaced by one that throws, and asks for every route it
registers. The routes come from the router rather than from a list in the
suite: Express knows what it mounted, and a list kept here would go stale the
first time somebody adds a handler — which is exactly the handler this suite
is for. Forty routes, and every request carries a five-second deadline,
because a test that waits for a request that never answers does not fail, it
hangs, and takes the run with it.

Three answers are acceptable and one is not. Handing the failure to the error
handler is the case under test, and thirty-nine of the forty do that. Refusing
the request before the library is touched is not under test at all — one
route does that, `GET /api/assets/:name`, which turns a missing image into
"that image is not here" rather than an error, on purpose. Answering with a
500 of its own is honest too. What fails the suite is a 2xx: the library
failed and the route said it went fine, which is how a person is told their
document was saved when it was not.

The guards are let through, since "may this person do this" is answered before
the library is touched, and they also stand in for what the real ones leave
on the request — a handler that reads the signed-in account would fall over on
the way to the library otherwise. The three routes behind multer are sent a
real multipart body, with real PNG magic bytes for the image one, because the
store sniffs the file rather than trusting its name: without that, those are
the routes this suite would never actually ask anything of. That is why the
counts are printed and why one check insists the library was reached by at
least one route per router.

Five deliberate breaks, three caught: swallowing the error (the request hangs),
answering 200 (a failure called a success), and a handler replaced by one that
answers without doing the work. The two that survive are properties of the
design rather than holes. A route that catches its own failure and answers 500
is allowed, as above. And a route that is deleted outright is simply not asked
for — the suite checks every route that exists, which is what makes it total
for new handlers and blind to removed ones; that a route is *there* is what
the `documents`, `recycle` and `dom` suites are for.

### A name that is not a name, in the address

`documents` already drove every refusal a name meets in a request *body*:
creating one called `..`, renaming to `/etc/passwd`, a name that is only an
extension. What nothing asked was the same question one layer out, where the
name is the address itself.

That layer is not the same code. These routes take the path as a wildcard —
`/api/docs/*file` — rather than one percent-encoded segment, because `%2F` is
the kind of thing a reverse proxy rewrites on the way through, and a library
that stops resolving its own URLs depending on what is in front of it is not
worth the tidier route pattern. The consequence is that `..%2Fsecret.md`
reaches the handler already decoded and already split, as `../secret.md`, and
every route that takes a path has to ask the sanitiser about it — not just the
ones somebody remembered to think about.

So both suites now ask every one of them. In `documents`: reading, writing,
renaming and filing, against a climb out, the same climb with its dots
encoded, a character no filesystem here will take, and a reserved device name.
In `recycle`: restoring and erasing, in the bin and in the archive, against
the same names plus one that is simply not the shape this app stamps on a
deleted file. Each has to answer 400 and say which kind of name it wanted, and
afterwards nothing may have been written outside the library.

Reading an entry out had been the only one of those with a check, which is the
wrong one to have if you only get one: restore *writes* a file back into the
library under a name it read out of the entry, and erase deletes the file it
resolves. Those are the two that cost something when the name is taken on
trust.

The rules themselves are checked in `test/paths.test.js`, one layer further
in. These checks are not about which names are legal; they are about every
route asking.

One route in that list answers differently on purpose. The way *into* the bin
is a document path rather than an entry name, so parentheses are an ordinary
thing to call a document there, and a name that is merely not in the library
is a 404 rather than a refusal — a 404 invites a retry and a 400 does not.

### Renaming in place, and the four ways it comes to nothing

`app/inline-rename.js` is F2: the label becomes a text box where it sits,
which is what makes renaming feel like a filesystem rather than a document
workflow. The tree suite already renamed a document and watched it land — and
that one check had already earned its keep, catching a request that sent
`name` where the endpoint reads `fileName`, so every rename typed into the
tree came back "Invalid document file name" and had since the tree was built.

What nothing reached was the rest of the module, which is the part a person
meets by making a mistake: 72% → 100% of lines and branches.

A second F2 while a box is open has to leave it alone, because the first thing
opening one does is empty the label — a second pass would throw away whatever
had been typed and reseed the box with the old name. Escape settles the edit,
and the blur that follows it (the box leaving the document *is* a blur) must
not then commit what Escape just refused; the listener answers both, so only
the settled flag stands between them. A blur on its own does commit, because
the alternative is losing what was typed to a click somewhere else on the
page. And a keystroke in the box is the box's: the tree's own shortcuts listen
on the same path, Delete among them, and the box sits inside the row Delete
would send to the bin.

Both lookups walk the rendered rows and can come back empty — the menu that
offers Rename was built from a list that may have been refetched since, and
F2 arrives at whatever has the focus — so both are asked for a row that is not
there. Both refusals are driven by the real endpoints: a colon in a filename
and `con` as a folder name are refused by the path sanitiser, so the words in
the toast are the server's own, and the row is drawn again under the name it
still has with no box left open on it.

The one case that has to follow the rename is the document that is open: the
refetch has to be told to open it under its new name, or the page is left
showing a document that no longer exists. Renaming anything else leaves the
open document where it is.

The folder half of the module had nothing at all. It is driven through F2 on a
focused folder row, so the one shortcut that reaches a folder is pressed at
least once, and against a folder made for the test and taken away again
afterwards — a folder's name is its directory, so renaming a seeded one would
move the documents inside it, and the checks that follow still use their
paths. A folder name has no extension, which is the other half of the
preselection rule: all of it is selected, there being no dot to hold back.

Twenty-four deliberate breaks, twenty caught. The four that survive are each a
redundancy or a distinction without a difference, and they are worth naming
because the first reading of each was that a check was missing.

Both entry points check the row they found before calling `beginInlineEdit`,
which checks it again — either guard alone makes a row that is not there do
nothing, and the second of them guards a row drawn from a list the folder has
since left, which is a stale tree rather than anything a person can do here.
The box stops a keystroke propagating *and* the tree's own handler returns at
once for an event from a rename input, so Delete pressed in the box cannot
reach the bin even with one of them gone; what that check pins is that the
document survives the keystroke, not which guard saved it. And the
preselection's `dot > 0` differs from a bare `dot` only for a name beginning
with a dot, which the path sanitiser refuses, so no such name is ever in the
tree to select.

Two of the first pass survived for a better reason: nothing checked that a
commit which changes nothing stays quiet. The endpoint answers an unchanged
name with a 200 and an empty one with a 400, so either would put a toast on
screen — one that lies about having renamed something, or one that reports a
failure nobody asked for. Both have a check now, and both are made on a
document this file has not renamed: a toast replaces one that says the same
thing, so "Renamed to alpha.md." already being on screen would have hidden
exactly the toast the check was looking for. The first version of that check
counted the toasts instead, and a toast expiring mid-check could move the
count on its own.

### What a path may be, which is the layer under everything that takes one

A document is identified by its path relative to the documents directory, and
that path arrives from outside: a URL, an upload, a folder name somebody
typed. `lib/docs/paths.js` is the one place that decides whether a string may
become a filesystem path at all — it rebuilds the path segment by segment out
of characters known to be safe, then confirms the result is still inside the
directory it is supposed to be in.

Every refusal in it was unreached. The routes above it are covered: the
`documents` and `recycle` suites drive the paths an API accepts and the ones it
turns into a 400. What nothing asked was what this module itself refuses, and
it is worth asking separately, because the cost of being wrong here is reading
and writing arbitrary files — `test/paths.test.js`, 100% of lines and
branches.

It is the shape of `body.test.js` and `organizer.test.js`: a leaf module whose
refusals are the whole point, so the suite is a list of them. A name with a
separator in it, or two dots anywhere in it; one longer than the limit, or
empty; the characters a filesystem will not take, and the control characters
that are the entire reason that guard exists; a leading dot or a trailing dot
or space, which some filesystems silently drop, so that the file written would
not be the file asked for; the Windows device names, refused on every platform
because a library is copied between them and a name that works here and not
there is a document somebody loses on the way. Then the same list again for a
folder segment, and again for a recycle-bin entry, which has the narrower rule
of all: only the stamped shape this app writes itself.

Twenty-eight deliberate breaks, one per guard. Three of them pass the suite,
and they are the same break three times: a leading "/" always produces an
empty first segment, and an empty segment is refused by the per-segment
sanitiser regardless. Either guard alone catches an absolute path, which is
what belt and braces means here — the pair is deliberate, and no check can
tell them apart without asserting the implementation rather than the
behaviour.

The one guard that does not refuse anything is the extension list, which is
why `sanitizeNewFilename` is separate: creation and upload take a bare name
and default it to markdown, and a lookup does not. Letting `/api/docs/foo`
resolve to `foo.md` would give one file two addresses and make `.mmd` and
`.ipynb` documents unaddressable by their real names.

### The four places, and what a move puts back when it fails

`app/places.js` moves between the two halves of the library and the two
detours — documents, links, the recycle bin, the archive. Everything above
drove it by calling it; what nothing reached was the controls, the question a
move has to ask, and the rollback — 87% → 99% of lines.

The switcher's two halves are real links, so they can be copied, bookmarked
and opened in a new tab, and an ordinary click is handled in-page because
nothing about the move needs a reload. That makes the modifier guard the
interesting line: a ctrl-, meta-, shift- or alt-click, and a middle-click,
have to be left to the browser, or the one thing an address is good for stops
working. All five are checked, and so is the plain click they are the
exception to.

Moving takes the document being edited off the screen, so it asks what closing
the editor would ask — and takes no for an answer, which is the half that
matters: the move is refused, the editing is still running, and the view has
not changed. The detours ask the same question with the same answer.

The rollback is the rest. A move writes the mode, the address and the search
box before it knows whether the library will answer; when it does not, every
one of those goes back to what it was. Which is why `rollbackPlace` takes them
as arguments rather than reading them: everything it restores was read before
the await that failed, and reading them afterwards would be reading what the
failed move had already written. Both rollbacks are driven by refusing the
request the move depends on.

The three ways back to the documents are worth their own checks because two of
them are about *not* doing work: coming back from the links with the same
document open asks the server for nothing at all — the library is loaded and
the article is still rendered underneath — while Back landing on a different
document is one request, and coming back with nothing open says so rather than
leaving the last document's markup on screen with no document behind it.

### Copy, New, Edit, and the two pickers that hand something back

`app.js` is the wiring between a person's finger and the operations every other
file in this suite calls directly, and `test/dom/shell-wiring.js` already
presses most of it. Five things it did not: 88% → 91% of lines.

Copy had four answers and none of them were checked. It takes the markdown the
page was made from, read out of the same cache the renderer read rather than
fetched again — so what is on the clipboard cannot disagree with what is on
screen — and when the cache has gone it reads it back, which is the path a
document opened before a reload takes. The other two are the failures: nothing
open, and a clipboard the browser refuses, which is the one case where the app
has nowhere else to put the text.

The pickers were covered for both cancellations and for the question a file
asks when there are folders to choose between. What was left was each one
actually handing something back: a folder, which asks nothing because the tree
it carries is the answer, and a file when the library has no folders at all,
where there is nothing to ask. That last one is about what the library holds
rather than about the file, which is why the state is what the check moves.

New and Edit are one line each and go to the two editors. They are here
because a line each is exactly the kind of thing that gets wired to the wrong
one, and because swapping them in the source is a mutation this suite could
not see until now.

Writing this found something worth saying about the suite's shape rather than
the app's. The first version was a new file of its own, and two thirds of it
turned out to be checks `shell-wiring.js` and `editing.js` already made — the
upload menu, the pickers, Back into unsaved work. The deliberate breaks are
what showed it: each one failed two checks with different wording, in two
files. The file is gone and what was left of it is in the section that owns
that area, which is where CONTRIBUTING says to put it.

One more thing came out of a full run rather than this file. The suite's last
check said an error had been logged — "The error has been logged. Trying again
is usually worth a shot.", which is the sentence the server gives a reader and
says nothing about what was asked for. The shim now records every 5xx the page
is answered with, and the check beside that one names them. It has not fired
since, which is its own small problem: the run it was written for passed on
every retry.

### What an upload says it did

`test/dom/links-and-roles.js` checks what a folder upload *sends* — the
filtering that keeps a folder's images and lock files off the wire. Either
side of that had never run: `app/uploads.js`, 85% → 100% of lines.

The single-file upload is four lines and one of them matters more than the
rest. The picker is emptied afterwards, because a file input that still holds
the last file fires no `change` event when the same file is chosen again — so
the second upload of a corrected file does nothing at all, and it is the
`finally` that stops that being a bug. It is checked after a success and
after a refusal.

A folder gets two refusals before anything is sent: nothing this app holds,
and more documents than the limit. Both happen in the browser rather than at
the server, because a real folder is mostly images and a thousand-file folder
would be a thousand files uploaded before being told no. The server checks
too; this is the convenience, not the boundary — so the checks here are that
nothing is sent and the sentence names the limit.

The sentence is the rest of the section. Every clause of it is a different
thing going not-quite-right — files skipped, files the server refused, a
document renamed to avoid a clash, a folder name this app had to adjust — and
it is the only account anybody gets of any of them. A document that arrives
under a name other than the one it was uploaded as is the clearest case:
nothing else on screen would say so. Those clauses are driven against a
stand-in for the server's answer, because what is being read is the sentence
the app builds, not the route that produced the numbers; the route is the
`documents` suite's.

The last check is that the folder just uploaded is open in the tree. Uploading
twenty documents and being left looking at a collapsed row is the upload
appearing to have done nothing.

Two of these checks only became checks after a mutation walked past them. A
file input's value cannot be set by a test — no browser lets script put a path
into one, and jsdom does not either — so "the picker is emptied" was reading an
emptiness nothing had filled; the element now records being cleared instead.
And "the uploaded folder is open" was true before the upload as well, since a
folder that has just been made was never collapsed. What the reveal actually
does that nothing else does is put the focus on that folder's row, and that is
what is checked now.

### The sidebar's own furniture

`test/dom/folders.js` drives the folder operations and `test/dom/tree.js` the
rows. The controls around them had not been pressed: `app/sidebar.js`, 72% →
99% of lines.

The part that earns a section is the folder dialog's *Move to Ungrouped*
button, which means three different things depending on why the dialog was
opened. In move mode it takes a document out of its folder; with no document
named it does nothing at all, rather than moving whichever one happens to be
open; and in upload mode it uploads the file the dialog is holding into no
folder. The first two are one `if` apart, and the third shares the button with
them, so each is driven and read back from the server rather than from the
toast.

Refresh is the same shape, one level up: four lists behind one button, and the
sentence it prints is the only thing on screen that says which one it
refreshed. All four are checked, and so is the failure — a refresh that falls
over has to say so rather than leaving the list as it was with nothing said.

The empty space under the rows is the smallest thing here and the most easily
broken: a mousedown there clears the selection the way a file manager does,
and a mousedown on a row must be left to the row. Both are checked, in both
directions.

One guard cannot be reached: the delegated `contextmenu` listener on the list
checks that the click was not on a row, and a row's own handler calls
`stopPropagation`, so the delegated one never sees it. It is correct and it is
second in line.

A helper in this file is worth copying and worth a warning. "Which folder is
this document in" reads the answer back from `/api/docs`, and `folderName` is
`null` for a document in none — so `?? "(not there)"` turned "at the top of
the library" into "not in the library at all", and two checks failed for a
reason that had nothing to do with the app.

### The menu everything is reached from

Signing in and out, changing a password, managing accounts and sharing a
document are four modules with suites of their own, and every one of those
suites drives the module by calling into it. The menu a person actually
reaches them through had never been clicked: none of `app/account-menu.js`
ran, so an item wired to the wrong function — or to nothing — would have been
found by somebody using the app. It is now at 100% of lines.

There is not much to say about each check, which is rather the point: the
button drops the menu and says `aria-expanded`, the first item takes the
focus, a click inside leaves it open and a click anywhere else closes it, and
each item opens the thing it is named after and puts the menu away. What the
file is worth is that it is all of them, in one place, pressed.

Three are worth more than the rest. Every dialog here is a `<form>`, so a
submit that is not taken off the browser reloads the page and loses the
session — checked for all three. The share dialog's export toggle is sent as
it is flipped rather than on a save button, and it is read back through the
link itself, since the shared page is the only thing that cares. And Copy has
two answers: jsdom has no clipboard, so the suite's stand-in records what was
copied, and a clipboard that refuses has to say "press Ctrl+C" rather than
claiming it worked, with the link already selected so that Ctrl+C does.

The last section signs out through the menu and back in through the form,
which is the only way to reach the signed-out account button — where it opens
the sign-in dialog rather than a menu. One branch is left: the menu's identity
line has a fallback for no user, and the menu cannot be opened while there is
none.

### Opening a document, and reading a deleted one

`app/opening.js` puts every document on the screen, so the ordinary path
through it runs in every other file in this suite. The rest had never run —
77% → 99% of lines — and it is all the parts that are about something going
wrong, plus the whole of the recycle bin's reader, which is the only way to
look at a deleted document before deciding whether to restore it.

Two of the checks are races, and they are the reason the request id exists.
Opening two documents in quick succession must leave the second one on screen:
the first one's content arriving late must not paint over it, and the first
one's *failure* arriving late must not put "could not load this" over a
document that loaded perfectly. Against a local server both answers come back
in the same millisecond, so the slow one is made slow — a `fetch` that waits
400ms for that one URL, and for the second check answers 500 after waiting.

The bin's reader is the other half. A row in the bin opens the deleted
document, rendered through the same sanitizer as anything else, and the title
and the message say where it is being read from — the buttons on screen mean
different things in the bin and in the archive, so the two say different
things. The empty states are the same story: "Recycle bin is empty" and
"Archive is empty" are two sentences one branch apart, and reading them meant
emptying both, which is what turned up the archiving defect fixed in the
commit before this one.

One guard is left unreached and cannot be driven: `searchWhatIsAlreadyOpen`
checks the request id, and everything it does after that check is synchronous,
so nothing can move the id underneath it. It mirrors the check in the async
path beside it, where the race is real.

### The editor's keyboard, pressed rather than called

`test/dom/editing.js` calls the formatting functions directly and pastes a
picture into the text. The surface around them had never run: the keys as
somebody presses them, the tabs, a picture dropped rather than pasted, the two
panes scrolling together, and the six buttons —
`app/editor-keys.js`, 72% → 100% of lines.

Calling `toggleMarkdownWrap` is not the same test as pressing Ctrl+B, because
the interesting decision is not in the wrapping. One listener on the modal
decides what is a shortcut and what belongs to the field it was pressed in:
Ctrl+S saves from the filename field too — it is at least as likely to be
pressed there, having just been typed in — while Ctrl+B in that same field is
the browser's. A key the editor has no use for is left alone, or Ctrl+F would
stop working inside the editor, and a key pressed at a modal that is closed
does nothing, because the listener stays on the element after the editor goes
away.

Ctrl+K is the one shortcut that asks a question, and jsdom has no `prompt`, so
the suite is the one answering. Both silences are checked — Escape and an
empty box — because writing `[words]()` for somebody who cancelled leaves a
broken link in their document.

Two stand-ins carry the rest. A dropped file is a `dataTransfer` built by
hand, since jsdom has none; the picture goes up for real and comes back as a
markdown image pointing at a URL the server will serve. And the linked scroll
is arithmetic over heights that jsdom does not have, so the heights are given:
a preview twice as long as the text, with halfway down one being halfway down
the other. The check that matters there is the third — the pane being followed
must not turn round and follow back, which is what the lock released a frame
later is for.

### The folder tree, and the file it will not overwrite

`lib/docs/organizer.js` is two things with one name. Above the factory are
pure functions over an array of folder records — the names and ids it accepts,
and the repairs it makes to a tree that is not one. Below it is the only
record of which document lives in which folder. The `documents` suite covers
the API around it and `db` covers the three-process write; sixty lines in the
middle had never run, and they are the ones that decide what a hand-edited or
half-written state costs somebody. The new `organizer` suite takes the file to
100%.

The repairs are the interesting half, because each of them is a thing that
would otherwise hang a walk over the tree: a folder that is its own parent, a
parent that is not there, a two-folder loop, a three-folder loop, and a chain
nested past the cap. In every case the parent reference is dropped and the
folder is kept — a folder whose parent vanished becomes top level rather than
disappearing with every document filed inside it.

One check here exists because everything else about loops passed without it.
Deleting the line that breaks a cycle changed nothing the suite could see: the
depth cap catches a walk that goes round forever and lifts that folder to the
top, so a two- or three-folder loop comes out the same either way. What tells
them apart is a folder *hanging off* a loop. Breaking the cycle properly costs
the one link that closes it, and that folder keeps its parent; leaving it to
the depth cap lifts the innocent folder to the top as well, which is somebody's
folder moving out from under them for a loop it was not part of.

The other half is the quarantine, and it is checked on disk rather than in
principle: a JSON file from before is imported once and renamed `.imported`,
and a second one put back afterwards is left alone. A file that will not parse
reads as no folders at all — so the library stays browsable with every
document unfiled — and refuses every write with a 503 naming the file to fix,
while the bytes stay exactly where they are. A row in the database that will
not parse behaves the same way and names the row instead. And a mutator that
returns a promise is refused rather than awaited, because better-sqlite3
cannot hold a transaction across an await and the write would land outside the
lock the whole design rests on.

### The save that renames, and the one that replaces

`test/dom/editing.js` drives the source editor's keys and one plain save of a
document that already exists. The rest of `app/editor-save.js` was unreached —
87 of its 226 lines — and it is not a quiet file: it renames, it creates, and
it is the only place in this app where a save can land on top of somebody
else's document. `test/dom/saving.js` takes it to 100% of lines and branches.

The order inside a save is the part worth writing down. A changed name is a
rename, and the rename goes first so the write lands on the new path; the
editor is then told what it is now editing, or the next Ctrl+S writes to a
file that is no longer there. A save that stays open also turns a create into
an edit, and without that a second Ctrl+S on a new document asks to replace
the file it wrote a moment ago.

The collision is the dangerous one. A create the server refuses with "already
exists" becomes a question with the file's name in it and a button that says
Replace File; every other refusal is rethrown and shown, because a dialog
offering to replace a name the server will not accept at all asks a question
whose yes cannot work. Both answers are driven here, and the "no" is checked
by reading the file afterwards rather than by trusting the sentence.

Two of the checks here exist because a mutation survived without them. One is
the rename that lands with a write that does not: the editor has to be holding
the new name by then, or the next Ctrl+S renames a file that is no longer
there and the text has nowhere to go. Only the PUT is refused, by a `fetch`
that passes everything else through, so the rename is real. The other is the
refusal that is not a collision, which must not open the replace dialog.

That second one taught the more useful lesson. Written as `await` on the save
and then a check, it did not fail against the broken build — it *hung*, because
the save was waiting for an answer to a question the test did not know had been
asked. It now starts the save, waits for either a toast or an open dialog, and
answers the dialog before awaiting. A check that hangs says nothing about
anything.

Three things cost a little care:

- The editor is a modal that earlier sections leave open or closed as they
  please, so every refusal is checked from a closed editor. Reading
  `editorOpen` without shutting it first is reading the previous section's
  answer.
- `getDocByFile` looks in the collection the current view is showing, so the
  recycle bin's "restore it first" refusal has to be driven with a row that is
  actually in the bin. A document from the normal library is refused one line
  earlier, for not existing.
- Refreshing the library starts a read of the documents in it. Emptying
  `contentCache` before that read lands puts the text straight back, which is
  why the one check that needs a document to be missing waits for the cache to
  stay empty rather than clearing it once.

### The links pane, past what a fake row can reach

`test/dom/links-and-roles.js` covers the chips, the filter and the grid, all of
it against rows put straight into `state`. Everything that waits on an answer
was unreached: filing a card, re-reading one, removing one, the icon sweep, and
the four sentences the empty grid picks between — 83% → 99% of lines.

The answers cannot come from the real server here, and that is worth being
precise about. Adding a link makes the server read the page; the only addresses
this machine can reach are the ones `link-preview.js` refuses on purpose, and
the one public address that would work is the internet, which no test may need.
So `test/dom/linking.js` stands in for the answer rather than the behaviour: a
table of rows that answers the five link endpoints the way `lib/routes/links.js`
answers them, using the server's own `normalizeGroups` so the test is not
inventing a second rule for what "osu, APIs" means. The server's half of this
is the `links` suite's job, and it does it against the real routes.

What that reaches is the part of the pane that is about recovering:

- A filing the server refuses puts the card back under the groups it had. The
  optimistic render has already happened by then, and a card quietly showing a
  group the server rejected is worse than the error.
- The group field is a chip row that turned into a text box. Enter saves,
  Escape puts it back, and clicking away saves too — nothing about the box says
  the typing is provisional, so losing it on a stray click is losing work. It
  may only save once: Enter and the blur that follows it are two finishes.
- A card can outlive the list it was drawn from, which is what the two `if
  (!link) return` guards in `refreshLink` and `removeLink` are for. Driving
  them is a matter of keeping the button and refreshing the list out from under
  it.
- The icon sweep has four answers — found some, found some with more to come,
  found none, fell over — and the one that matters is the third: a sweep that
  found nothing still has to be marked as finished, or the next visit runs it
  again.

One thing the breaks found, which is a note rather than a defect. Deleting
`link.groups = before` from the failure path in `setLinkGroups` breaks nothing,
because nothing sets `link.groups` optimistically any more — the comment above
it still says the drag case renders before the server answers, and the drag
case does not. The line is a guard on a thing that no longer happens, and the
check beside it asserts where the card ends up rather than which line put it
there.

Eight lines are left, and they are four copies of the same one: `renderLinks`,
`showLinksLoading`, `renderGroupChips` and `syncGroupDatalist` each begin by
checking that the element they draw into exists. Every one of them is in
`index.html`, which is the only page that loads this file, so the guard is for a
page that does not exist yet.

### Dragging a row, and the keys that do the same thing

`app/tree.js` draws the library, and `test/dom/tree.js` covers what it draws
and what clicking a row does. What nothing reached was the other two ways the
same move is made: dragging a row onto a folder, and the file-manager keys —
78% → 96% of lines.

A drag is three events that have to agree, so `test/dom/dragging.js` carries a
`DataTransfer` of its own (jsdom has none): a `Map` with `setData`, `getData`
and a `types` getter. The checks are about the agreement rather than the
mechanics — the pick-up selects the row it started on and announces a move,
the zone marks itself while the pointer is over it and unmarks itself when the
pointer leaves but *not* when it crosses to a child inside the zone, and the
drop lands the document in the folder.

The half that matters is the offer that must not be made. A folder cannot be
dropped into itself, or into any folder below itself, because that would cut
the branch off from the tree. The server refuses it as well, but by then the
row has been dragged, the zone has lit up and a person has been told it would
work. `canDropOnFolder` is what stops the offer, and it is now driven through
the real `dragover` with a real ancestor chain, both refusals and the two
drops that are allowed.

The keyboard is the same operations without the pointer: Ctrl+A, Ctrl+X,
Ctrl+V, F2, Delete, Shift+Delete, and the arrows that walk the rows and open
and close a folder.

The last section is the one view where the same row means something else.
In the recycle bin the two buttons are Restore and Archive; in the archive
they are Restore and Delete forever, and the dangerous one asks a question
that says it cannot be undone. One wrong answer to "which view am I in"
erases a document somebody meant to keep, which is why each button is pressed
in each view and the sentence it produces is read. Entering those views is
done with `switchViewMode` and waited on, not by assigning to `state` — the
tree is redrawn by the switch, and a test that sets the flag itself reads the
rows the old view left behind.

Two things this cost us, both worth writing down. A binned file is stored
under a timestamped name, so the row is found by what the document was called
before it was thrown away, not by `data-file`. And every `waitUntil` on a
toast matches the whole sentence: "moved to recycle bin" was still on screen
from the delete three lines above, so a wait for `/recycle bin/` returned at
once and the check that followed read the silence before the restore as the
answer.

Twenty-nine lines are left in the file. Most are the row buttons' callbacks,
which are reached from the context menu in `test/dom/tree.js` and not through
the button; the rest are the share-only row a reader with `share:manage` and
no `doc:write` sees, and the focus-walking edges at the two ends of the list.

### Running a notebook cell

`pyodide-worker.js` is covered to the line by the `worker` suite, which runs it
in a `vm`. The other side of that conversation — the Run button, the thing that
talks to the worker, the output area under the cell — was not.

| | |
| --- | --- |
| `notebook-runtime.js` | 47% → **100%** of lines and functions |
| `app/notebook.js` | 31% → 97% lines, **100%** of functions |

jsdom has no `Worker`, so `test/dom/running.js` has one: it writes down what it
was sent and lets the suite answer. That makes the two rules in the comment at
the top of the runtime checkable rather than aspirational. *Nothing runs on its
own* — opening the notebook starts no worker at all, which is the same check as
"a document in a library never executes code that came with it". And *the
runtime is not downloaded until it is needed* — the worker is built on the
first Run and not before, which is the ten megabytes nobody opening a markdown
file should pay for.

The rest is what happens when it does not go well, and every one of those paths
leaves a promise hanging if it is got wrong. A worker that fails to start has
to answer every queued run, or the cell says "Working…" forever. A restart has
to answer them too, and say why. A cell that is slow is *told* it is slow
rather than killed, because terminating somebody's computation for being slow
is worse than the silence. And a result that arrives after the reader has
opened another document is dropped, because writing it into a detached node
would put one notebook's output under another's cell.

Two of the checks make the app log an error on purpose — a status listener that
throws, and a slow-cell callback that throws — and both assert it was written
down and then take it off the list the suite's last check reads. A page that
carries on without saying anything is how somebody's bug stays one.

### The accounts and sessions a boot before this one left

`db` already covered the JSON import for shares and links. The one for accounts
and sessions was unreached, and it is the one with a *rule* in it: an expired
session was dropped on load before the database existed, and has to be dropped
on the way in too — or importing resurrects a session somebody's logout had
ended.

Three more rules came with it, each now held. A session whose account did not
survive the import would fail the foreign key and is dead either way, so it is
skipped rather than attempted. A file whose sessions had *all* expired is still
set aside, because it has been dealt with and leaving it means reading it again
on every boot for the life of the install. And a session that expires while it
is open takes its row with it when it is next asked for, rather than sitting in
the table until something else happens to notice.

Those assertions are made against the rows rather than through `getSession`,
because a session's id in the database is a hash of its token and these ids
came out of a file written by an older build. That is the right level for an
import test: the question is which rows landed.

### Every way the documents API refuses what it is given

The happy paths are exercised constantly — by `dom`, by `recycle`, by `auth`,
by anything that needs a document to exist. What nothing reached was the
refusals, and there are thirty of them: a name that is not a name, a body over
the limit, a folder that is not there, a folder that cannot hold the file, a
name already taken in the destination.

They are each three lines, and each of those three lines is the difference
between a clear "no" and a document written somewhere nobody will find it. So
there is a thirty-fifth suite, `documents`, which is the same reasoning as
`body.test.js` one layer out: that suite checks the reader every route reads
its input through, and this one checks what each route does with what the
reader hands back.

Two of its checks are about *not* refusing, and they are the ones worth
keeping. Filing a document in the folder it is already in is not a move and not
an error. Renaming a document to the name it already has is not a rename and
not an error. Both of those are things a client does by accident, and a 400 in
reply is a dialog somebody has to dismiss for no reason.

And one is about a name being unique within its folder rather than across the
library: two documents called README.md in two folders are two documents, and
refusing the second would be refusing the only name it should have.

### The three endpoints that fetch something

`links.test.js` drives the API over HTTP against a real server, and could only
ever drive the *refusals*: adding a link needs the page to be fetched, and
nothing in this suite touches the internet.

So `test/links/routes.js` mounts the router in this process, with the preview
stood in for — `describeUrl` and `iconForUrl` are covered to the line in
`fetching.js` beside it, and what is left to check is the route: what it asks
of the store, what it answers with, and the budget it spends.

| | |
| --- | --- |
| `lib/routes/links.js` | 76% → 96% |
| `lib/links.js` | 97% → 98% |

Two things in there are worth knowing. The first is that the icon sweep only
ever has work for rows written *before* there was an icon column: a link added
now has its icon already, because `describeUrl` fetches it, and `needingIcons()`
looks for `icon IS NULL`, which only a migration leaves behind. The suite
models that by nulling the column, and says so.

The second is about the test's own error handler. It answers 500 for anything
that reaches it, deliberately: turning a preview's own refusal into its own
status is the *route's* job, and a handler that passed the status through would
hide a route that had stopped doing it. That is not a hypothetical — it is
exactly the mutation that survived until the handler was changed.

### The link preview's network, which the guard made untestable

`lib/link-preview.js` fetches a page somebody pasted a URL to, reads its
`<head>`, and finds its icon. Half of it was covered — what a URL is allowed to
be, which addresses are refused, what is read out of a page — and the half that
is a network was not.

Not because it is hard. Because *the guard works*. `guardedLookup` is handed to
Node as the request's own `lookup`, so whatever it approves is what the socket
connects to, and it refuses every private address — loopback included. A test
server on 127.0.0.1 is precisely what the module exists to refuse.

So `test/links/fetching.js` stands in for the transport. `sendRequest` reads
`http.request` off the module at call time, and the stand-in is handed the same
options Node would be — *including* the `lookup` function, which it calls. The
guard is driven for real rather than skipped: a hostname resolving to one
private and one public address keeps the public one, a hostname resolving only
inside a private network is refused, and the refusal reaches the person rather
than being saved as a card saying the site could not be read. That last one is
the DNS-rebinding case, and it is the reason the lookup is handed in at all.

| | |
| --- | --- |
| `lib/link-preview.js` | 84% → **100%** of lines and functions |

Everything else a site can do instead of answering is now a check: a 404, a
500, a response that never ends (read to the ceiling and no further, because
everything worth reading is in `<head>`), a video (stopped at the header, so it
is never pulled into memory), a timeout, a dead domain, a redirect to something
that is not an address, and a chain that never arrives.

### The wiring file itself

`app.js` is where the page is wired together, and a wiring file is only ever
wrong at the wiring: a handler bound to the wrong element, a shortcut that
fires while somebody is typing, a menu that cannot be dismissed. None of that
shows up anywhere else, because every module it calls is tested on its own.

| | |
| --- | --- |
| `app.js` | 64% → 88% |

`test/dom/shell-wiring.js` presses it. The slash that focuses the search box
and the Escape that works back out one rung at a time; the upload menu and the
two pickers behind it; the three buttons above the document, which mean
different things in the library, the recycle bin and the archive — the wrong
answer there archives a document somebody meant to restore; the swipe across a
document that steps between matches on a phone, and the four gestures that must
*not* be one; a picture picked or dropped into a document being edited in
place; the shortcuts that contenteditable does not handle and the browser would
otherwise take; `beforeunload`, which must ask only when there is something to
lose; and the back button, which `pushState` does not fire.

Two things in writing it are worth repeating. A check that something did *not*
happen has to give it a moment to have happened in — five of the swipe checks
passed against a broken build until they waited, because stepping is a round
trip and the toast had not arrived yet. And a keystroke dispatched at the
window is not the same as one dispatched at an element: the second has to
bubble, so the suite now presses a key on the page as well as at the window,
or a check can pass by never reaching the handler at all.

### Stepping between matches

`test/dom/jump.js` covers the finding and the marking. `test/dom/stepping.js`
covers the walk, which this document used to say belonged in a real browser.
It does not.

| | |
| --- | --- |
| `app/jump.js` | 50% → 94.7% lines, **100%** of functions |
| `app/match-nav.js` | 41% → 86% lines, **100%** of functions |

The walk is two walks. Inside a document it steps between marks and wraps
round both ends, because a search that stops at the last match is a search you
have to start again. Past the ends it opens the next document in the list that
has a match in it — passing over the ones that do not — which is a walk of
*openings* rather than of searches, since opening a document is what marks it.

Three things in there are easy to get wrong and are now held. The marks are
reused when the same query is asked of the same document and its marks are
still attached, because remaking them moves the scroll position for nothing;
but marks whose document has been redrawn under them are not marks any more,
and stepping onto one has to answer "not found" rather than lighting up a node
nobody can see. And moving *within* a document says only where you are, while
moving *between* documents says which one — the name is worth saying exactly
once, when it changes.

### Delete and restore, which is the only place this app can lose work

There are three places a document can be — the library, the recycle bin and the
archive — and five verbs for moving between them, because getting out of the
last two is not the same as getting into the first. What the *server* does with
each is covered thoroughly by `recycle`. What was not covered at all is the
side a person sees: which view they are left looking at afterwards, what they
are asked before anything is lost, and what they are told when it could not be
done.

| | |
| --- | --- |
| `app/doc-actions.js` | 25% → **100%** of lines and functions |
| `app/deletion.js` | 39% → **100%** of lines and functions |
| `app/file-actions.js` | 32% → **100%** of lines and functions |

`test/dom/discarding.js` drives all five verbs from both entry points — the
toolbar above the open document, and a row in the tree — because they are
different functions doing the same job and each has its own refusals. Every
destructive one is asked about first, and each check answers the dialog both
ways: a no has to leave the document where it was and say so, because a
cancelled delete that silently does nothing is indistinguishable from a
cancelled delete that worked.

**A harness defect came out of it.** The dom suite's `fetch` shim did not send
`Content-Length`, so Node sent the body chunked — and body-parser reads a
chunked body on a POST and *not* on a DELETE. `req.body` arrived `undefined`,
the server saw its field missing and refused with a 400. That made the one app
path which sends a body with a DELETE — erasing an archived document, which the
server makes you echo the filename back for — impossible to drive from the
suite, and it looked exactly like a server refusing a correct request. The shim
now sends a length for a string body, which is what a browser does.

Two lines in `file-actions.js` are covered and cannot be pinned by a check:
the `state.activeFile = null` before `refreshDeletedDocs`, which clears the
same field on the next line. The guard is redundant rather than wrong.

### The share dialog

A share link publishes one document at an unguessable URL. The token is the
credential, so the server stores only its hash and hands back the full URL
exactly once — which is the whole reason the dialog is shaped the way it is,
and none of that shape was held by anything. What the *server* does with a
share is covered thoroughly by `auth`; `test/dom/sharing.js` is the side a
person sees.

| | |
| --- | --- |
| `app/share.js` | 37.5% → 97.6% lines, **100%** of functions |

The checks worth having are the ones about saying so. The URL is shown once
with a line saying it is the only time it will be. Sharing an
already-shared document is a *rotation*, so it asks first — the current link
stops working immediately and anybody still using it gets a page saying it is
not valid. And the one switch in the dialog is saved as it is switched rather
than behind a Save button, so a write the server refuses puts the box back to
what the server still says: there is no other pending state in this dialog, and
a button to confirm one checkbox would only be a way to think you had changed
something and not have.

One thing is deliberately silent. Reading the list of shares is best-effort: if
it fails the page still works and the share button simply does not show a
published state. A toast on load about a feature nobody asked for is a toast
nobody wants, and there is now a check saying so rather than an absence.

### The scorer the library falls back to

`public/js/app/search.js` says at the top that it is "the same idea as the
server's scorer (lib/docs/search.js) and deliberately the same shape, so the
offline fallback ranks a library the way the server would". Nothing was holding
that: the file was at 40%, and the `search` suite was entirely about the
server's index.

`test/search/client.js` runs it, in the same suite, for the same reason the
comparison between the scan and the index lives there — these are two answers
to one question and they have to agree.

| | |
| --- | --- |
| `app/search.js` | 40% → **100%** of lines and functions |

The checks are about the ordering, because that is what a scorer *is*: a title
that starts with the query beats a folder that contains it, which beats a body
that mentions it; a filename counts as well as a title, since a document
renamed in the library keeps the name it was uploaded under; and the loose
match — the letters in order, anywhere in the name — is reached only when
nothing else matched at all, and looks at the name rather than the text,
because otherwise every query matches every document that has any.

Two of them are about what goes on the page. The text of a result is escaped,
*including the part that matched*, which is the half that is easy to forget: a
document called `<img onerror=…>` found by searching for `<img` would otherwise
put that inside the mark. And a search term is taken as text rather than as a
pattern, so searching for `.*` finds documents called `.*`.

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
| DOMPurify | 3.4.17 | index, share | eagerly — same |
| @phosphor-icons/web | 2.1.2 | every page | eagerly, as CSS |
| mermaid | 11.16.1 | `md/lazy.js` | first diagram |
| KaTeX | 0.19.1 | `md/lazy.js` | first equation |
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
did not validate attribute names. Both have been on the fixed versions since,
and both have been moved again by this check: DOMPurify to 3.4.17 for a
critical advisory, KaTeX to 0.19.1 for a low one.

One note stays after that last bump, and it is worth writing down so the next
person does not chase it. `audit:cdn` at `--level=low` still reports a KaTeX
advisory, and it is not ours: `mermaid` depends on its own KaTeX and bundles
it into the three and a half megabytes the browser downloads, so the tree has
two copies — ours at 0.19.1, mermaid's at 0.16.47. Nothing here can move
mermaid's; the version that does is mermaid 12, which is a major bump of the
diagram engine and a piece of work in its own right. The threshold is
moderate, so it does not fail the build, and the advisory needs `trust`
enabled, which neither copy has.

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
vulnerability in the library itself.

Which versions those are is not written here. It was, in a second table that
said the same thing as the one in [Dependencies](#dependencies-and-the-ones-npm-audit-cannot-see)
above, and the second copy is the one that went stale: it still claimed
DOMPurify 3.1.6 and KaTeX 0.16.11 long after both had moved, which is the
failure `tools/cdn-pins.js` argues against in its own header — "a list
somebody maintains beside the pins is a list that is wrong the first time
somebody bumps one and forgets". `npm run audit:cdn` prints the versions it
reads out of the source, which is the answer that cannot drift.

Bumping one means changing the version in the tag and recomputing the hash —
`public/index.html` says how, beside the tags.
