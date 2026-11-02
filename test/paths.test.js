/* What a path may be, which is the layer under every route that takes one.
 *
 * A document is identified by its path relative to the documents directory,
 * and that path arrives from outside: a URL, an upload, a folder name
 * somebody typed. lib/docs/paths.js is what stands between those and the
 * filesystem — it rebuilds a path segment by segment out of characters known
 * to be safe, and then confirms the result is still inside the directory it
 * is supposed to be in.
 *
 * Every refusal in it was unreached. The routes above it are covered by the
 * `documents` and `recycle` suites, which drive the paths an API accepts;
 * what nothing asked was what this module refuses, and the cost of being
 * wrong here is reading and writing arbitrary files.
 */

const path = require("path");
const paths = require("../lib/docs/paths.js");
const { createChecker } = require("./helpers/check.js");

const { check, finish } = createChecker("PATHS");

console.log("=== a filename, and the six things one may not be ===");
{
  check("an ordinary name is kept", paths.sanitizeFilename("notes.md"), "notes.md");
  check("...with its accents in one spelling, so the disk and the tree agree",
    paths.sanitizeFilename("café.md"), "café.md");
  check("...and its surrounding space taken off", paths.sanitizeFilename("  notes.md  "), "notes.md");

  /* Refused rather than repaired. Both are safe, but "../../etc/passwd.md"
   * quietly becoming "passwd.md" is a surprising success: the caller asked
   * for one thing and got another, and nothing said so.
   */
  check("a name with a separator in it is refused, not trimmed down to its base",
    [paths.sanitizeFilename("../../etc/passwd.md"), paths.sanitizeFilename("dir\\note.md")],
    [null, null]);
  check("...and so is a name that merely contains ..",
    paths.sanitizeFilename("no..te.md"), null);
  for (const dots of [".", ".."]) {
    check(`...and "${dots}" on its own`, paths.sanitizeFilename(dots), null);
  }

  check("nothing is not a name", [paths.sanitizeFilename(""), paths.sanitizeFilename(null)],
    [null, null]);
  check("a name longer than the limit is refused",
    paths.sanitizeFilename(`${"n".repeat(paths.MAX_FILENAME_LENGTH)}.md`), null);
  check("...while one on the limit is kept",
    paths.sanitizeFilename(`${"n".repeat(paths.MAX_FILENAME_LENGTH - 3)}.md`)?.length,
    paths.MAX_FILENAME_LENGTH);

  /* A name the filesystem would quietly change. A trailing dot or space is
   * dropped by Windows and by some network shares, so the file written would
   * not be the file asked for, and nothing would ever find it again; a
   * leading dot hides it from the library it was uploaded to.
   */
  check("a name the filesystem would silently alter is refused",
    [paths.sanitizeFilename(".hidden.md"), paths.sanitizeFilename("notes.md.")],
    [null, null]);

  /* A lookup takes the name as it is written. Only creation and upload add
   * the extension, so a name this app does not hold is not a document here.
   */
  check("a name whose extension this app does not hold is not a filename",
    paths.sanitizeFilename("notes.txt"), null);

  check("a control character is refused", paths.sanitizeFilename("no\u0007te.md"), null);
  check("...and the characters a filesystem will not take",
    ["a:b.md", "a*b.md", "a?b.md", 'a"b.md', "a<b.md", "a>b.md", "a|b.md"]
      .map((name) => paths.sanitizeFilename(name)),
    [null, null, null, null, null, null, null]);

  /* The Windows device names, which are illegal with or without an extension
   * — and which this app refuses on every platform, because the library is
   * copied between them and a name that works here and not there is a
   * document somebody loses on the way.
   */
  check("a reserved device name is refused, extension or not",
    ["con", "CON.md", "prn.md", "aux.md", "nul.md", "com1.md", "lpt9.md"]
      .map((name) => paths.sanitizeFilename(name)),
    [null, null, null, null, null, null, null]);
  check("...while a name that merely starts like one is fine",
    paths.sanitizeFilename("console.md"), "console.md");
}

console.log("=== and the one that is being created, which may arrive bare ===");
{
  /* Creation and upload take a bare name and default it to markdown. A lookup
   * does not: letting /api/docs/foo resolve to foo.md gives one file two
   * addresses and makes .mmd and .ipynb files unaddressable by their names.
   */
  check("a bare name becomes markdown", paths.sanitizeNewFilename("notes"), "notes.md");
  check("...and one that already says what it is keeps it",
    ["notes.md", "flow.mmd", "sums.ipynb"].map((name) => paths.sanitizeNewFilename(name)),
    ["notes.md", "flow.mmd", "sums.ipynb"]);
  check("...and an extension this app does not hold is part of the name",
    paths.sanitizeNewFilename("notes.txt"), "notes.txt.md");
  check("nothing is still nothing",
    [paths.sanitizeNewFilename("   "), paths.sanitizeNewFilename(null)], [null, null]);
  check("...and the refusals above still apply",
    paths.sanitizeNewFilename("../escape"), null);
}

console.log("=== a path, rebuilt a segment at a time ===");
{
  check("a path in a folder is kept", paths.sanitizeDocPath("Projects/notes.md"),
    "Projects/notes.md");
  check("...and a Windows-style one is understood rather than refused",
    paths.sanitizeDocPath("Projects\\Cart\\notes.md"), "Projects/Cart/notes.md");

  check("an absolute path is not a document path", paths.sanitizeDocPath("/etc/passwd.md"), null);
  check("...nor is one with an empty segment in it",
    [paths.sanitizeDocPath("Projects//notes.md"), paths.sanitizeDocPath("Projects/notes.md/")],
    [null, null]);
  check("...nor one that climbs out", paths.sanitizeDocPath("../../etc/passwd.md"), null);
  check("...nor one that climbs out halfway along",
    paths.sanitizeDocPath("Projects/../../etc/passwd.md"), null);
  check("...and nothing is not a path", paths.sanitizeDocPath(""), null);

  /* Deeper than a folder can be. Unbounded depth is a way to make the tree
   * unusable in a 280px sidebar and to make path computation quadratic, so
   * the limit is the folder limit plus the document itself.
   */
  const deep = (levels) => `${Array.from({ length: levels }, (_, i) => `d${i}`).join("/")}/notes.md`;
  check("a path at the depth limit is a path",
    paths.sanitizeDocPath(deep(paths.MAX_FOLDER_DEPTH)) !== null, true);
  check("...and one deeper than it is not",
    paths.sanitizeDocPath(deep(paths.MAX_FOLDER_DEPTH + 1)), null);

  check("a path whose file is refused is refused, not shortened to its folder",
    paths.sanitizeDocPath("Projects/.hidden.md"), null);

  // A directory in the path is held to the same rules as a filename.
  check("a segment on its own is held to the same rules",
    [paths.sanitizePathSegment("Projects"), paths.sanitizePathSegment(null)],
    ["Projects", null]);
  check("a folder with an unsafe character in it is refused",
    paths.sanitizeDocPath("Pro:jects/notes.md"), null);
  check("...and one that is a device name", paths.sanitizeDocPath("con/notes.md"), null);
  check("...and one that merely contains .., which is refused rather than reasoned about",
    paths.sanitizeDocPath("Pro..jects/notes.md"), null);
  check("...and one that is too long",
    paths.sanitizeDocPath(`${"d".repeat(paths.MAX_FILENAME_LENGTH + 1)}/notes.md`), null);
  check("...and one the filesystem would silently alter",
    [paths.sanitizeDocPath(".hidden/notes.md"), paths.sanitizeDocPath("Projects./notes.md")],
    [null, null]);
}

console.log("=== and resolved against the directory it must stay inside ===");
{
  const base = path.resolve("/srv/library/docs");

  check("a document resolves inside the library",
    paths.resolveDocPath("Projects/notes.md", base),
    path.join(base, "Projects", "notes.md"));
  check("a path the sanitiser refuses resolves to nothing",
    paths.resolveDocPath("../../etc/passwd.md", base), null);

  /* The belt to the sanitiser's braces. It has rebuilt the path out of safe
   * segments already, so this should never be the thing that catches an
   * attack — but it is the check that does not depend on having thought of
   * every trick, which is why it stays.
   */
  check("a sibling directory that merely starts with the same letters is outside",
    paths.resolveDocPath("notes.md", base)?.startsWith(`${base}${path.sep}`), true);

  /* What that guard actually catches, now that the sanitiser has rebuilt the
   * path: a base directory that is not an absolute, un-suffixed path. It
   * refuses rather than resolving against the working directory, so a caller
   * that forgot to resolve its base gets nothing instead of a file somewhere
   * else entirely.
   */
  check("a base that is not an absolute directory resolves to nothing",
    [paths.resolveDocPath("notes.md", "docs"), paths.resolveDocPath("notes.md", `${base}${path.sep}`)],
    [null, null]);
}

console.log("=== a path out of a request ===");
{
  // The routes use a wildcard, so Express hands over the segments rather than
  // one percent-encoded lump: %2F is the kind of thing a proxy rewrites.
  const asRequest = (file) => ({ params: { file } });

  check("the segments of a wildcard are joined back into a path",
    paths.paramDocPath(asRequest(["Projects", "notes.md"])), "Projects/notes.md");
  check("...and a single segment is a path too",
    paths.paramDocPath(asRequest(["notes.md"])), "notes.md");
  check("...and one that climbs out is refused here as well",
    paths.paramDocPath(asRequest(["..", "..", "etc", "passwd.md"])), null);
  check("a request with no path at all is nothing",
    paths.paramDocPath(asRequest(undefined)), null);

  // The bin and the archive take the same wildcard, holding the folder the
  // document was deleted from.
  const asEntryRequest = (entry) => ({ params: { entry } });
  const stamped = "20260101000000-abcdef--notes.md";

  check("a bin entry arrives the same way",
    paths.paramEntryPath(asEntryRequest(["Projects", stamped])), `Projects/${stamped}`);
  check("...and is refused on the same terms",
    [paths.paramEntryPath(asEntryRequest(["..", stamped])),
      paths.paramEntryPath(asEntryRequest(undefined))],
    [null, null]);
}

console.log("=== the name a deleted document is filed under ===");
{
  const stamped = paths.createRecycleEntryFilename("notes.md");
  check("a binned document is stamped so two of the same name can sit together",
    /^\d{14,}-[a-z0-9]{6}--notes\.md$/.test(stamped), true);
  check("...and the name it had comes back out",
    paths.parseOriginalFilenameFromRecycleEntry(stamped), "notes.md");
  check("...with the folder it was in still on the front",
    paths.parseOriginalFilenameFromRecycleEntry(`Projects/${stamped}`), "Projects/notes.md");
  check("...and a name with no stamp on it is its own original",
    paths.parseOriginalFilenameFromRecycleEntry("notes.md"), "notes.md");

  /* The name is read back for display, not to be opened with: whatever the
   * entry turns out to hold, the person is told something rather than
   * nothing, and the path that is acted on is the sanitised entry name.
   */
  check("...and an original the sanitiser will not take is still shown as it reads",
    [paths.parseOriginalFilenameFromRecycleEntry("20260101000000-abcdef--..md"),
      paths.parseOriginalFilenameFromRecycleEntry(null)],
    ["..md", ""]);

  check("the stamped name is accepted", paths.sanitizeRecycleEntryName(stamped), stamped);
  check("...and so is one in a folder",
    paths.sanitizeRecycleEntryName(`Projects/${stamped}`), `Projects/${stamped}`);

  /* Only the shape this app generates. An entry name reaches the filesystem
   * the same way a document path does, and the archive is the one place a
   * file is deleted for good.
   */
  check("an absolute entry is refused", paths.sanitizeRecycleEntryName("/etc/passwd.md"), null);
  check("...and one that climbs out", paths.sanitizeRecycleEntryName("../passwd.md"), null);
  check("...and one with an empty segment", paths.sanitizeRecycleEntryName("a//b.md"), null);
  check("...and one deeper than a folder can be",
    paths.sanitizeRecycleEntryName(
      `${Array.from({ length: paths.MAX_FOLDER_DEPTH + 1 }, (_, i) => `d${i}`).join("/")}/${stamped}`),
    null);
  check("...and one whose extension this app does not hold",
    paths.sanitizeRecycleEntryName("20260101000000-abcdef--notes.txt"), null);
  check("...and one that climbs out in the name rather than the folder",
    paths.sanitizeRecycleEntryName("20260101000000-abcdef--no..te.md"), null);
  check("...and one with a character the stamped names never contain",
    paths.sanitizeRecycleEntryName("20260101000000-abcdef--no(te).md"), null);
  check("...and nothing", paths.sanitizeRecycleEntryName(""), null);

  const binBase = path.resolve("/srv/library/deleted");
  check("an entry resolves inside the bin",
    paths.resolveRecyclePath(stamped, binBase), path.join(binBase, stamped));
  check("...and one the sanitiser refused resolves to nothing",
    paths.resolveRecyclePath("../passwd.md", binBase), null);
  check("...and so does a base that is not an absolute directory",
    paths.resolveRecyclePath(stamped, "deleted"), null);
}

console.log("=== and the small ones every caller uses ===");
{
  check("the directory of a path, and of one that has none",
    [paths.docDirOf("Projects/Cart/notes.md"), paths.docDirOf("notes.md")],
    ["Projects/Cart", ""]);
  check("the name at the end of one",
    [paths.docBaseOf("Projects/Cart/notes.md"), paths.docBaseOf("notes.md")],
    ["notes.md", "notes.md"]);
  check("joining a name to a directory, or to none",
    [paths.joinDocPath("Projects", "notes.md"), paths.joinDocPath("", "notes.md")],
    ["Projects/notes.md", "notes.md"]);
  check("the title a document is shown under, which is the name made readable",
    [paths.toDocTitle("Projects/my-notes.md"), paths.toDocTitle("sums_and_things.ipynb")],
    ["My Notes", "Sums And Things"]);
}

process.exit(finish());
