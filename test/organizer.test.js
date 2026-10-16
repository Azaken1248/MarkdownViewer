/* The folder tree, and the file it is kept in.
 *
 * lib/docs/organizer.js is two things. Above the factory are pure functions
 * over an array of folder records: the names and ids it will accept, and the
 * repairs it makes to a tree that is not one. Below it is the only record of
 * which document lives in which folder, with the rule that a state it cannot
 * parse is damage to be left alone rather than a reason to start fresh.
 *
 * The API around it is covered by the `documents` suite, and the three-process
 * write is covered by `db`. What neither reaches is what this file is for: the
 * refusals, the repairs, and the quarantine. Sixty lines of it had never run,
 * and they are the lines that decide whether a hand-edited or half-written
 * state costs somebody their folders.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const db = require("../lib/db");
const {
  ROOT_FOLDER_LABEL,
  UNFILED_FOLDER_ORDER,
  ORGANIZER_VERSION,
  normalizeFolderName,
  normalizeFolderId,
  normalizeOrganizerState,
  isFolderWithinSubtree,
  getFolderRecordById,
  resolveFolderInfo,
  folderDirFor,
  folderIdForDir,
  createOrganizerFile
} = require("../lib/docs/organizer");
const { MAX_FOLDER_DEPTH } = require("../lib/docs/paths");
const { createChecker } = require("./helpers/check.js");

const { check, finish } = createChecker("ORGANIZER");

// A folder record as the file holds one, with only what matters named.
const folder = (id, name, parentId = null, extra = {}) => ({
  id, name, parentId, order: 0, createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z", ...extra
});
const parentsOf = (state) => Object.fromEntries(
  state.folders.map((one) => [one.id, one.parentId]));

(async () => {
console.log("=== the names a folder may not have ===");
{
  check("a name is kept, with its spacing tidied", normalizeFolderName("  Osu   notes "), "Osu notes");
  check("nothing is not a name", normalizeFolderName("   "), null);
  check("neither is one that is far too long", normalizeFolderName("n".repeat(81)), null);
  check("...while one on the limit is fine", normalizeFolderName("n".repeat(80))?.length, 80);

  /* A folder name is never used as a path segment on its own — the directory
   * comes from the tree — but a control character or a slash in one would
   * travel into the directory it derives, so they are refused where the name
   * is made rather than where it is used.
   */
  check("a name with a slash in it is refused", normalizeFolderName("a/b"), null);
  check("...and one with a control character", normalizeFolderName("a\u0007b"), null);
  for (const dots of [".", ".."]) {
    check(`...and "${dots}", which names a directory rather than a folder`,
      normalizeFolderName(dots), null);
  }

  /* "Ungrouped" is the heading unfiled documents are shown under. A real
   * folder by that name draws a second heading that looks exactly like it,
   * and nothing on screen says which of the two anything is in.
   */
  check("the name the unfiled documents are shown under is refused",
    normalizeFolderName(ROOT_FOLDER_LABEL), null);
  check("...in whatever case it is typed", normalizeFolderName("ungrouped"), null);
  /* Loading is not making: a folder by that name in a state written by an
   * older build keeps its name, because dropping it here would take every
   * document filed inside it along with it.
   */
  check("...but kept when it is already in the state being loaded",
    normalizeFolderName(ROOT_FOLDER_LABEL, { allowRootLabel: true }), ROOT_FOLDER_LABEL);
}

console.log("=== and the ids it will not take ===");
{
  check("an id is kept", normalizeFolderId("folder_abc-1.2"), "folder_abc-1.2");
  check("an empty one is not an id", normalizeFolderId(""), null);
  check("...nor is a missing one", normalizeFolderId(undefined), null);
  for (const dots of [".", ".."]) {
    check(`...nor "${dots}"`, normalizeFolderId(dots), null);
  }
  check("an id with a slash in it is refused", normalizeFolderId("../etc"), null);
  check("...and one with a space", normalizeFolderId("folder one"), null);
}

console.log("=== a state off disk, read with every doubt ===");
{
  const state = normalizeOrganizerState({
    version: 1,
    folders: [
      folder("keep", "Keep"),
      folder("", "No id"),
      folder("no-name", "   "),
      { id: "bare", name: "Bare" }
    ],
    fileFolders: {
      "one.md": "keep",
      "two.md": "folder-that-is-gone",
      "three.md": "bare"
    }
  });

  // In the stored order, which a record with none of its own takes from
  // where it sat in the file.
  check("a folder with no id is dropped, and one with no name",
    state.folders.map((one) => one.id), ["keep", "bare"]);
  check("...rather than the whole state being refused", state.folders.length, 2);
  check("a record with no dates is given them",
    typeof getFolderRecordById(state, "bare").createdAt, "string");
  check("...and the two agree when only one was written",
    getFolderRecordById(state, "bare").createdAt,
    getFolderRecordById(state, "bare").updatedAt);
  check("the state is written back at the current version", state.version, ORGANIZER_VERSION);

  check("a file mapped into a folder that is not there is dropped",
    Object.keys(state.fileFolders).sort(), ["one.md", "three.md"]);

  check("a state with nothing in it at all is an empty one",
    normalizeOrganizerState(null), { version: ORGANIZER_VERSION, folders: [], fileFolders: {} });
  check("...and so is one whose folders are not a list",
    normalizeOrganizerState({ folders: "nope", fileFolders: { "a.md": "x" } }).folders, []);
}

console.log("=== a tree that is not a tree ===");
{
  /* Hand-edited state is where these come from, and every one of them would
   * hang a walk over the tree or hide a folder from it. A parent reference is
   * only ever dropped, never the folder itself: a folder whose parent went
   * missing becomes top level rather than disappearing with every document
   * filed inside it.
   */
  const itsOwnParent = normalizeOrganizerState({
    folders: [folder("a", "A", "a")], fileFolders: {}
  });
  check("a folder that is its own parent is put at the top",
    parentsOf(itsOwnParent), { a: null });

  const orphan = normalizeOrganizerState({
    folders: [folder("a", "A", "nowhere")], fileFolders: {}
  });
  check("...and so is one whose parent is not there", parentsOf(orphan), { a: null });

  const pair = normalizeOrganizerState({
    folders: [folder("a", "A", "b"), folder("b", "B", "a")], fileFolders: {}
  });
  check("a two-folder loop is broken, and only one link of it",
    Object.values(parentsOf(pair)).filter((one) => one === null).length, 1);
  check("...leaving both folders where a walk can reach them",
    Object.keys(parentsOf(pair)).sort(), ["a", "b"]);

  /* A folder hanging off a loop keeps its parent. Breaking the loop costs
   * the one link that closes it and nothing else — the depth cap alone would
   * lift this folder to the top as well, which is a folder moving out from
   * under somebody for a loop it was not part of.
   */
  const hangingOff = normalizeOrganizerState({
    folders: [folder("d", "D", "a"), folder("a", "A", "b"), folder("b", "B", "a")],
    fileFolders: {}
  });
  check("a folder hanging off a loop keeps the parent it had",
    parentsOf(hangingOff).d, "a");
  check("...and only the link that closed the loop is dropped",
    Object.values(parentsOf(hangingOff)).filter((one) => one === null).length, 1);

  const ring = normalizeOrganizerState({
    folders: [folder("a", "A", "c"), folder("b", "B", "a"), folder("c", "C", "b")],
    fileFolders: {}
  });
  check("a three-folder loop is broken too",
    Object.values(parentsOf(ring)).filter((one) => one === null).length, 1);

  // A chain one deeper than the cap, which is what an import from a deeper
  // tree looks like. The folder past the cap is lifted rather than refused.
  const chain = [];
  for (let level = 0; level <= MAX_FOLDER_DEPTH + 1; level += 1) {
    chain.push(folder(`f${level}`, `F${level}`, level === 0 ? null : `f${level - 1}`));
  }
  const capped = normalizeOrganizerState({ folders: chain, fileFolders: {} });
  const lifted = capped.folders.filter((one) => one.parentId === null).map((one) => one.id);
  check("a folder nested past the cap is lifted to the top rather than dropped",
    [lifted.includes("f0"), lifted.includes(`f${MAX_FOLDER_DEPTH + 1}`), capped.folders.length],
    [true, true, chain.length]);
}

console.log("=== where a folder is, and where a document is ===");
{
  const state = normalizeOrganizerState({
    folders: [folder("top", "Top"), folder("mid", "Mid", "top"), folder("other", "Other")],
    fileFolders: {}
  });

  check("a folder is within itself, which is what refuses a drop onto itself",
    isFolderWithinSubtree(state.folders, "top", "top"), true);
  check("...and within the one above it", isFolderWithinSubtree(state.folders, "mid", "top"), true);
  check("...but not within its own child", isFolderWithinSubtree(state.folders, "top", "mid"), false);
  /* Asked about nothing, the answer is no. Said the other way round — a
   * missing id counting as "inside" — every move would be refused the moment
   * one side of the question was not a folder.
   */
  check("nothing is not inside anything", isFolderWithinSubtree(state.folders, null, "top"), false);
  check("...and nothing contains anything", isFolderWithinSubtree(state.folders, "mid", ""), false);

  check("a folder is found by its id", getFolderRecordById(state, "mid").name, "Mid");
  check("an id that is not an id finds nothing", getFolderRecordById(state, "../etc"), null);
  check("...and one that is simply not there", getFolderRecordById(state, "missing"), null);

  check("the directory of a folder is its names, joined", folderDirFor(state, "mid"), "Top/Mid");
  check("no folder is the top of the library", folderDirFor(state, null), "");
  check("...and so is a folder that is not there", folderDirFor(state, "missing"), "");
  check("a directory nobody owns belongs to no folder",
    folderIdForDir(state, "Made/By/Hand"), null);
  check("...and the top of the library is not a folder either",
    folderIdForDir(state, ""), null);

  check("a document in a folder's directory is in that folder",
    resolveFolderInfo(state, "Top/Mid/notes.md"),
    { folderId: "mid", folderName: "Mid", folderPath: "Top / Mid", folderOrder: 0 });
  /* A directory made by hand outside the app shows its documents as unfiled
   * rather than inventing a folder for them.
   */
  check("one in a directory the tree does not know is unfiled",
    resolveFolderInfo(state, "Made/By/Hand/notes.md"),
    { folderId: null, folderName: null, folderPath: null, folderOrder: UNFILED_FOLDER_ORDER });
  check("...and so is one at the top", resolveFolderInfo(state, "notes.md").folderId, null);

  /* A state that did not come through readOrganizerState — one built by hand,
   * or read from a file an older build wrote — can hold a folder whose id is
   * not one this build would accept. The directory still matches, so the
   * lookup finds it and the record then does not: the document is unfiled
   * rather than carrying half a folder.
   */
  const handBuilt = {
    version: ORGANIZER_VERSION,
    folders: [{ id: "not an id", name: "Odd", parentId: null, order: 0 }],
    fileFolders: {}
  };
  check("a folder whose id this build will not take leaves its documents unfiled",
    resolveFolderInfo(handBuilt, "Odd/notes.md"),
    { folderId: null, folderName: null, folderPath: null, folderOrder: UNFILED_FOLDER_ORDER });
}

console.log("=== the file it will not overwrite ===");
{
  // Everything below is a real database in a real directory, because the
  // quarantine is about what is on disk afterwards.
  const made = [];
  const dataDir = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "azadocs-organizer-"));
    made.push(dir);
    return dir;
  };
  const jsonPath = (dir) => path.join(dir, "document-organizer.json");

  // What the import prints is part of the behaviour, but it is not worth
  // printing in the middle of a passing suite.
  const complaints = [];
  const realError = console.error;
  // Put back through a function, so restoring it is not an assignment made
  // after an await.
  const sayWith = (fn) => { console.error = fn; };
  sayWith((...args) => complaints.push(args.join(" ")));

  try {
    {
      const dir = dataDir();
      fs.writeFileSync(jsonPath(dir), JSON.stringify({
        version: 1,
        folders: [folder("kept", "Kept")],
        fileFolders: { "one.md": "kept" }
      }));

      const organizer = createOrganizerFile({ filePath: jsonPath(dir), db: db.open(dir) });
      const state = await organizer.readOrganizerState();
      check("a file from before is read into the database",
        state.folders.map((one) => one.name), ["Kept"]);
      check("...and set aside, so it is not imported twice",
        [fs.existsSync(jsonPath(dir)), fs.existsSync(`${jsonPath(dir)}.imported`)], [false, true]);

      // The row is now the record. A file put back beside it is left alone.
      fs.writeFileSync(jsonPath(dir), JSON.stringify({
        version: 1, folders: [folder("late", "Late")], fileFolders: {}
      }));
      const again = await organizer.readOrganizerState();
      check("a file that turns up once the database has state is not imported",
        again.folders.map((one) => one.name), ["Kept"]);
      check("...and is left where it was put", fs.existsSync(jsonPath(dir)), true);
    }

    {
      const dir = dataDir();
      fs.writeFileSync(jsonPath(dir), "{ not json at all");
      const organizer = createOrganizerFile({ filePath: jsonPath(dir), db: db.open(dir) });

      /* Reads degrade so the library stays browsable: every document is
       * unfiled rather than unreachable. Writes are refused outright, because
       * this file is the only record of the folders and overwriting it with a
       * fresh one would be the loss it is protecting against.
       */
      check("a file that will not parse reads as no folders at all",
        (await organizer.readOrganizerState()).folders, []);
      check("...and the file is left exactly where it is",
        [fs.existsSync(jsonPath(dir)), fs.readFileSync(jsonPath(dir), "utf8")],
        [true, "{ not json at all"]);

      const refused = await organizer.mutateOrganizerState((state) => {
        state.folders.push(folder("new", "New"));
      }).catch((error) => error);
      check("a write is refused rather than attempted",
        [refused.statusCode || refused.status, /damaged/i.test(refused.message)], [503, true]);
      check("...and says which file to fix",
        refused.message.includes("document-organizer.json"), true);
      check("...which was said once, on the way in",
        complaints.filter((one) => /could not be parsed/i.test(one)).length, 1);
    }

    {
      const dir = dataDir();
      const handle = db.open(dir);
      handle.prepare(
        `INSERT INTO organizer (id, state_json, updated_at) VALUES (1, ?, ?)`
      ).run("{ not json either", new Date().toISOString());

      const organizer = createOrganizerFile({ filePath: jsonPath(dir), db: handle });
      check("a row this process cannot parse reads the same way",
        (await organizer.readOrganizerState()).folders, []);

      const refused = await organizer.mutateOrganizerState((state) => {
        state.folders.push(folder("new", "New"));
      }).catch((error) => error);
      check("...and refuses the write with the row named rather than the file",
        [refused.statusCode || refused.status, /organizer row/i.test(refused.message)],
        [503, true]);
      const row = /** @type {any} */ (
        handle.prepare("SELECT state_json FROM organizer WHERE id = 1").get());
      check("...leaving the row as it was", row.state_json, "{ not json either");
    }

    {
      /* A mutator that returns a promise is refused rather than awaited.
       * better-sqlite3 cannot hold a transaction across an await, so the
       * write would land outside the lock the whole design rests on.
       */
      const dir = dataDir();
      const organizer = createOrganizerFile({ filePath: jsonPath(dir), db: db.open(dir) });
      const refused = await organizer.mutateOrganizerState(async () => {}).catch((error) => error);
      check("a mutator that is not synchronous is refused",
        /must be synchronous/.test(refused.message), true);

      const after = await organizer.readOrganizerState();
      check("...and the state it was given is not written", after.folders, []);

      // And the ordinary case, so the refusals above are not the only path.
      const { result } = await organizer.mutateOrganizerState((state) => {
        state.folders.push(folder("real", "Real"));
        return "done";
      });
      check("a synchronous one writes and hands its answer back", result, "done");
      check("...and the state comes back with it",
        (await organizer.readOrganizerState()).folders.map((one) => one.name), ["Real"]);

      /* The lock callers still ask for. One mutation at a time is what the
       * transaction gives them now, so this runs the task and nothing else —
       * but it has to keep running it, because the callers have not changed.
       */
      check("the lock the callers still take runs what it is given",
        await organizer.withOrganizerLock(() => "ran"), "ran");
    }
  } finally {
    sayWith(realError);
    for (const dir of made) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

process.exit(finish());
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
