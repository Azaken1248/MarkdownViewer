# Accessibility

What is checked, what is accepted, and what nobody knows. The last section is
the longest, which is the honest shape of this document: an app with a passing
axe run is an app where the machine-decidable third of WCAG passes.

The target is WCAG 2.1 AA.

## What a machine checks, every run

`test/accessibility.test.js` runs axe-core inside a real Chromium over six page
states in both themes:

| State | What it is |
| --- | --- |
| signed out | the login form, the only page a stranger reaches |
| the shell | the explorer, the toolbar, the search field |
| a document | rendered markdown, which is what the app is for |
| the editor | the textarea, its toolbar and the live preview |
| the diagram page | the diagram editor, opened on a real `.mmd` file |
| a dead link | the error page, which is also the share page's template |

Only the WCAG rule sets — `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`. Not
axe's `best-practice` tag, which holds opinions that are worth reading and are
not conformance; mixing the two would stop the result being a statement about
anything.

Two more checks go past what axe decides:

- **`prefers-reduced-motion`** is honoured, measured off computed styles rather
  than read out of a stylesheet — a reduce rule that a later rule overrides is
  a rule that does nothing, and only the cascade knows. The check has a control
  on the other side: without the preference, dozens of elements in the shell do.
- **200% zoom**, which is the 1400px layout at 700. Nothing may stick out
  sideways, because a reader zoomed in panning left and right along every line
  has lost the page. axe runs again at that size.
- **The way past the explorer** (WCAG 2.4.1): the first Tab reaches a skip
  link, taking it brings the link onto the screen, and following it puts the
  *focus* on the document rather than only the scroll.
- **Forced colours**, as a smoke check and no more — see below.

### The budget

`BUDGET` in that file is how many nodes each rule may fail, per page state and
per theme. It is empty.

It exists so that it cannot quietly stop being empty. A new violation fails the
suite, and somebody then has to either fix it or write a line saying which
rule, how many nodes, and why that is the right answer. A number nobody had to
type is a number that drifted.

### What the first run found

axe-core has been a devDependency since the outline panel was built — run by
hand, over that one panel, and never since. Run over the whole app it found
four defects, all fixed, none of which any other suite could have seen:

- `--fg-subtle` was **3.8:1** behind the metadata lines in the dark theme and
  **4.4:1** in the light one, at 11px and 10.5px. `theme.test.js` had been
  computing contrast from the token file for a long time and passing, because
  it checks the pairs somebody thought to list; axe checks the pair that is
  actually painted. Both themes now clear 4.5:1 against every surface token,
  including `--raised-hover`, rather than against the two a particular page
  happens to use.
- `public/share.html` and `public/error.html` declared **no language**. Neither
  has an `<html>` element written out — the parser supplies one — and an
  attribute cannot be supplied. A page with no language is read aloud in
  whatever the screen reader happens to be set to.
- Two of the five buttons in the mobile dock were **named something that did
  not contain the word printed on them**: "Files" was called "Open file list",
  "New" was called "Create document". Somebody using voice control says what
  they can see, and nothing happened. (WCAG 2.5.3.)
- The diagram editor's panel separator was **focusable with a focusable button
  inside it**. A screen reader reading the splitter would never have offered
  the chevron inside it — and the chevron is the only thing that brings a shut
  panel back. The bar and the chevron are now siblings inside a holder.

## What a person checked, once

A keyboard pass in Chromium on 2026-10-06, recorded rather than asserted. This
is the part that goes stale; what it found is in the suites, the pass itself is
not repeated automatically.

**Tab order** through the shell is the reading order: brand, the two places,
search, theme, account, then the sidebar's seven controls, then the tree. Every
stop has a visible focus indicator. The search field's is on its wrapper
(`.search-wrap:focus-within`) rather than on the input, which has
`outline: none` — a computed-style check on the input alone reports no
indicator and is wrong.

**A dialog** behaves: opening "New folder" moves the focus to the first field,
Tab cycles within four stops and never leaves, Escape closes it, and the focus
returns to the button that opened it.

**The tree** answers ArrowUp/ArrowDown between rows, ArrowRight/ArrowLeft to
open and close a folder, and Home/End to the ends. The pass found a defect
here: opening a folder with ArrowRight rebuilt the list, which threw away the
button the key had arrived at, so the focus fell to the body and every arrow
key after it did nothing — the tree stopped answering, having just answered.
Fixed, and `test/dom/tree.js` now holds it.

## What is not checked

The list, in the order it ought to be worked through.

**No screen reader has ever been run against this app.** Not NVDA, not
VoiceOver, not Orca. Every claim above about what something is "read as" is
read off the markup, which is where that kind of claim stops being evidence.
This is the largest single gap and no automated check will close it.

**axe decides perhaps a third of WCAG.** It is good at the rules with a
machine-checkable answer — contrast, names, roles, language, duplicate ids —
and silent on almost everything about meaning: whether a heading describes what
is under it, whether alt text says the useful thing, whether an error message
tells you what to do, whether the focus order makes sense to somebody who
cannot see the layout.

**~~There is no skip link.~~** Fixed. The page had landmarks, which is what
satisfies axe's `bypass` rule and what a screen reader's landmark navigation
uses — and a keyboard user without a screen reader had neither, with each
folder row costing four Tab stops (the row and its three actions), so reaching
the document past an open tree was dozens of presses.

There is one now, on the library page and on the share page: the first stop in
the tab order, off the top of the screen until it has focus. The part that is
easy to get wrong and was wrong first time is the landing — `#docContent` and
`#shareMain` carry `tabindex="-1"`, without which following the link changes
the hash, scrolls the page, and leaves the focus exactly where it was, so the
next Tab goes straight back into the explorer. The suite checks the focus, not
the scroll, for that reason.

**Ink and annotation are pointer-only.** Drawing on a document with a keyboard
is not a thing this app offers, and it is not obvious what it would mean.
Everything the ink toolbar does to an existing drawing — choose a tool, a
colour, a width, undo, clear — is reachable.

**The visual page editor is `contenteditable`.** Nine modules build on it. How
it behaves under a screen reader is simply unknown.

**The diagram editor's canvas** has arrow-key movement, Tab between boxes and
Enter to type into one, covered by `diagram-page`. Whether the shape of a
diagram can be *understood* without seeing it is a different question, and the
answer is probably no.

**Pasted images** take the file's name without its extension as alt text,
which is what a screenshot tool gives you. Better than nothing, and nothing
prompts for better.

**Forced colours is checked, but only as a smoke test.** Windows High Contrast
and anything else that has the OS pick the colours overrides every `color` and
`background-color` the app sets — which is most of what it sets, since it
paints with custom properties throughout. The suite asks whether the headings,
the prose, the toolbar buttons and the explorer rows are still drawn and still
have a colour the system gave them. That catches the common failure in an app
built this way: a border drawn as a `box-shadow`, or a background on a
pseudo-element, neither of which is forced, both of which then keep a colour
nothing else has.

What it does not ask is whether the result is *good*. Nobody has looked at this
app in a real high-contrast theme, and axe is little help here because contrast
is the system's business in this mode and the rule knows it.

## Running it

```bash
npm test accessibility
```

Needs the browser the PDF renderer already needs:

```bash
npx playwright install chromium --only-shell
```

With none installed the suite says so and passes, because the step that
installs it lives in the workflow where its absence is visible. It reads what
the server serves, which with a build in `public/build` is the bundle — so run
`npm run build` first, or a stale bundle gives a stale answer.
