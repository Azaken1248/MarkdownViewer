// The recycle bin and the archive: everything a deleted document does after
// it stops being a document, and every way back.
//
// This suite exists because the coverage map said it had to. Nothing reached
// /api/recycle-bin/*/restore, /api/recycle-bin/*/hard-delete, any of
// /api/archive/*, or restoreFromBin in the store — the routes that move
// somebody's work around and the one route in the app that erases a file for
// good were the least exercised code in it.
//
// Everything goes over real HTTP against a real server, like the auth suite:
// what is worth checking here is the path a file takes across three
// directories, and that only exists at that level.

const fsp = require("fs/promises");
const path = require("path");
const { makeClient } = require("./helpers/client");
const { startTestServer, SEED_USERNAME, SEED_PASSWORD, TEST_PASSWORD } = require("./helpers/server");
const { createChecker } = require("./helpers/check.js");

const { check, finish } = createChecker("RECYCLE");

(async () => {
  const server = await startTestServer();
  console.log(`  (test server on ${server.origin})`);

  try {
    await run(server);
  } finally {
    await server.stop();
  }

  process.exit(finish());
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function run(server) {
  const admin = makeClient(server.origin);
  await admin.post("/api/auth/login", { username: SEED_USERNAME, password: SEED_PASSWORD });
  await admin.post("/api/auth/password", {
    currentPassword: SEED_PASSWORD,
    newPassword: TEST_PASSWORD
  });

  const exists = async (relative) => {
    try {
      await fsp.stat(path.join(server.stateDir, relative));
      return true;
    } catch {
      return false;
    }
  };

  // A document of our own for each part of this, so nothing here depends on
  // what another check left behind.
  const write = async (file, body, folderId = null) => {
    const made = await admin.post("/api/docs", { fileName: file, content: body, folderId });
    if (made.status !== 201) {
      throw new Error(`could not create ${file}: ${made.status} ${made.raw}`);
    }
    return made.body.file;
  };

  const binEntryFor = async (file) => {
    const bin = await admin.get("/api/recycle-bin");
    return bin.body.docs.find((doc) => doc.originalFile === file);
  };

  const archiveEntryFor = async (file) => {
    const archive = await admin.get("/api/archive");
    return archive.body.docs.find((doc) => doc.originalFile === file);
  };

  console.log("=== a soft delete puts the document in the bin, whole ===");
  {
    const file = await write("bin-round-trip.md", "# In the bin\n\nStill here.\n");
    const deleted = await admin.post(`/api/docs/${file}/delete`, { mode: "soft" });
    check("the delete is accepted", deleted.status, 200);
    check("...and says where it went", deleted.body.message, `${file} moved to recycle bin`);
    check("...and the document is gone from the library", await exists(`docs/${file}`), false);

    const entry = await binEntryFor(file);
    check("the bin lists it", Boolean(entry), true);
    check("...under the name it had", entry.originalFile, file);
    check("...with a title, a size and a date", [
      entry.title, entry.size > 0, Boolean(Date.parse(entry.deletedAt))
    ], ["Bin Round Trip", true, true]);

    // The content route is what the app reads to show a deleted document
    // without restoring it first.
    const content = await admin.get(`/api/recycle-bin/${entry.file}/content`);
    check("its text can still be read", content.status, 200);
    check("...and is the text that was deleted", content.body.content, "# In the bin\n\nStill here.\n");
    check("...named by where it came from", content.body.originalFile, file);

    const missing = await admin.get("/api/recycle-bin/nothing-like-this.md/content");
    check("a bin entry that is not there is a 404", missing.status, 404);
  }

  console.log("=== and a restore brings it back where it was ===");
  {
    const file = await write("bin-restore.md", "# Restore me\n");
    await admin.post(`/api/docs/${file}/delete`, { mode: "soft" });
    const entry = await binEntryFor(file);

    const restored = await admin.post(`/api/recycle-bin/${entry.file}/restore`);
    check("the restore is accepted", restored.status, 200);
    check("...under the original name", restored.body.file, file);
    check("...and says what it was restored from", restored.body.restoredFrom, entry.file);
    check("...the file is in the library again", await exists(`docs/${file}`), true);
    check("...and the bin no longer holds it", Boolean(await binEntryFor(file)), false);

    const content = await admin.get(`/api/docs/${file}`);
    check("...with its text intact", content.body.content, "# Restore me\n");

    const again = await admin.post(`/api/recycle-bin/${entry.file}/restore`);
    check("restoring the same entry twice is a 404, not a second copy", again.status, 404);
  }

  console.log("=== a document deleted from a folder goes back into that folder ===");
  {
    const folder = await admin.post("/api/folders", { name: "Bin Folder" });
    check("(a folder to delete from)", folder.status, 201);
    // A document is named on its own and filed by folder id; the path it ends
    // up at is the folder's directory, which is what makes the restore below
    // a question about directories rather than about names.
    const file = await write("filed.md", "# Filed\n", folder.body.folder.id);
    check("(the document is in it)", file, "Bin Folder/filed.md");

    await admin.post(`/api/docs/${file}/delete`, { mode: "soft" });
    const entry = await binEntryFor(file);
    check("the bin remembers which folder it came from", entry.folderName, "Bin Folder");

    const restored = await admin.post(`/api/recycle-bin/${entry.file}/restore`);
    check("...and the restore puts it back there", restored.body.file, file);
    check("...as a real file in that directory", await exists(`docs/${file}`), true);
    check("...filed under the same folder", restored.body.folderName, "Bin Folder");
  }

  console.log("=== a name taken since the delete does not overwrite anything ===");
  {
    const file = await write("taken-name.md", "# The first one\n");
    await admin.post(`/api/docs/${file}/delete`, { mode: "soft" });
    const entry = await binEntryFor(file);

    // Somebody makes a new document with the same name while the old one is in
    // the bin. Restoring must not land on top of it.
    await write("taken-name.md", "# The second one\n");

    const restored = await admin.post(`/api/recycle-bin/${entry.file}/restore`);
    check("the restore succeeds", restored.status, 200);
    check("...under a name of its own", restored.body.file !== file, true);
    check("...beside the one that took the name", await exists("docs/taken-name.md"), true);

    const standing = await admin.get("/api/docs/taken-name.md");
    check("...which is untouched", standing.body.content, "# The second one\n");
    const moved = await admin.get(`/api/docs/${restored.body.file}`);
    check("...and the restored text is the deleted one", moved.body.content, "# The first one\n");
  }

  console.log("=== hard-delete moves a bin entry on to the archive ===");
  {
    const file = await write("to-the-archive.md", "# Archive me\n");
    await admin.post(`/api/docs/${file}/delete`, { mode: "soft" });
    const entry = await binEntryFor(file);

    const hard = await admin.post(`/api/recycle-bin/${entry.file}/hard-delete`);
    check("the hard delete is accepted", hard.status, 200);
    check("...and says so in the words the app shows", hard.body.message, `${file} moved to the archive`);
    check("...it is out of the bin", Boolean(await binEntryFor(file)), false);

    const archived = await archiveEntryFor(file);
    check("...and in the archive", Boolean(archived), true);
    check("...still readable", (await admin.get(`/api/archive/${archived.file}/content`)).body.content,
      "# Archive me\n");

    const missing = await admin.post("/api/recycle-bin/not-there.md/hard-delete");
    check("hard-deleting nothing is a 404", missing.status, 404);
  }

  console.log("=== a delete may go straight to the archive ===");
  {
    const file = await write("straight-to-archive.md", "# Straight there\n");
    const deleted = await admin.post(`/api/docs/${file}/delete`, { mode: "hard" });
    check("the delete is accepted", deleted.status, 200);
    check("...and says where it went", deleted.body.message, `${file} moved to the archive`);
    check("...it never appears in the bin", Boolean(await binEntryFor(file)), false);
    check("...and it is in the archive", Boolean(await archiveEntryFor(file)), true);

    check("a mode that is neither is refused",
      (await admin.post(`/api/docs/${file}/delete`, { mode: "sideways" })).status, 400);
    check("...and so is a delete of a document that is not there",
      (await admin.post("/api/docs/never-existed.md/delete", { mode: "soft" })).status, 404);
  }

  console.log("=== the archive restores too ===");
  {
    const file = await write("archive-restore.md", "# Back from the archive\n");
    await admin.post(`/api/docs/${file}/delete`, { mode: "hard" });
    const archived = await archiveEntryFor(file);

    const restored = await admin.post(`/api/archive/${archived.file}/restore`);
    check("the restore is accepted", restored.status, 200);
    check("...under the original name", restored.body.file, file);
    check("...the file is back", await exists(`docs/${file}`), true);
    check("...and the archive has let go of it", Boolean(await archiveEntryFor(file)), false);
    check("...with its text", (await admin.get(`/api/docs/${file}`)).body.content,
      "# Back from the archive\n");

    check("restoring an archive entry that is not there is a 404",
      (await admin.post("/api/archive/no-such-entry.md/restore")).status, 404);
    check("...and so is reading one", (await admin.get("/api/archive/no-such-entry.md/content")).status, 404);
  }

  console.log("=== erasing is the one thing that cannot be undone, so it is confirmed ===");
  {
    const file = await write("erase-me.md", "# Gone for good\n");
    await admin.post(`/api/docs/${file}/delete`, { mode: "hard" });
    const archived = await archiveEntryFor(file);

    const unconfirmed = await admin.del(`/api/archive/${archived.file}`);
    check("a DELETE with no confirmation is refused", unconfirmed.status, 400);
    check("...and says what to echo back", unconfirmed.body.error.includes(`"${file}"`), true);
    check("...leaving the file where it was", Boolean(await archiveEntryFor(file)), true);

    const wrong = await admin.del(`/api/archive/${archived.file}`, { confirmFile: "something-else.md" });
    check("the wrong name is refused as well", wrong.status, 400);
    check("...and the file is still there", Boolean(await archiveEntryFor(file)), true);

    const erased = await admin.del(`/api/archive/${archived.file}`, { confirmFile: file });
    check("the right name erases it", erased.status, 200);
    check("...the archive is empty of it", Boolean(await archiveEntryFor(file)), false);
    check("...and so is the disk", await exists(`deleted_markdowns/hard/${archived.file}`), false);

    check("erasing it again is a 404",
      (await admin.del(`/api/archive/${archived.file}`, { confirmFile: file })).status, 404);
  }

  console.log("=== a share link does not survive the delete ===");
  {
    const file = await write("shared-then-deleted.md", "# Shared\n");
    const made = await admin.post(`/api/docs/${file}/share`);
    check("(the document is shared)", made.status, 201);
    const token = made.body.url.split("/").pop();
    check("(and the link works)", (await makeClient(server.origin).get(`/api/share/${token}`)).status, 200);

    await admin.post(`/api/docs/${file}/delete`, { mode: "soft" });
    const anon = makeClient(server.origin);
    check("the link stops working the moment it is deleted",
      (await anon.get(`/api/share/${token}`)).status, 404);
    check("...and the page behind it says so, not what used to be there",
      (await anon.get(`/s/${token}`)).status, 404);
  }

  console.log("=== and none of it is open to a reader ===");
  {
    const file = await write("role-check.md", "# Roles\n");
    await admin.post(`/api/docs/${file}/delete`, { mode: "soft" });
    const entry = await binEntryFor(file);

    await admin.post("/api/users", { username: "bin-viewer", password: "kettle-drum-thirty", role: "viewer" });
    const viewer = makeClient(server.origin);
    await viewer.post("/api/auth/login", { username: "bin-viewer", password: "kettle-drum-thirty" });
    await viewer.post("/api/auth/password", {
      currentPassword: "kettle-drum-thirty",
      newPassword: "viewer-own-password-1"
    });

    check("a viewer may look in the bin", (await viewer.get("/api/recycle-bin")).status, 200);
    check("...and read what is in it", (await viewer.get(`/api/recycle-bin/${entry.file}/content`)).status, 200);
    check("...but not restore from it", (await viewer.post(`/api/recycle-bin/${entry.file}/restore`)).status, 403);
    check("...nor hard-delete", (await viewer.post(`/api/recycle-bin/${entry.file}/hard-delete`)).status, 403);
    check("...nor delete a document in the first place",
      (await viewer.post("/api/docs/role-check.md/delete", { mode: "soft" })).status, 403);

    // An editor may move things about but not erase: doc:erase is the admin's.
    await admin.post("/api/users", { username: "bin-editor", password: "kettle-drum-thirtyone", role: "editor" });
    const editor = makeClient(server.origin);
    await editor.post("/api/auth/login", { username: "bin-editor", password: "kettle-drum-thirtyone" });
    await editor.post("/api/auth/password", {
      currentPassword: "kettle-drum-thirtyone",
      newPassword: "editor-own-password-1"
    });

    check("an editor may restore", (await editor.post(`/api/recycle-bin/${entry.file}/restore`)).status, 200);

    const doomed = await write("editor-cannot-erase.md", "# Not yours to erase\n");
    await editor.post(`/api/docs/${doomed}/delete`, { mode: "hard" });
    const archived = await archiveEntryFor(doomed);
    check("...but not erase", (await editor.del(`/api/archive/${archived.file}`, { confirmFile: doomed })).status, 403);
    check("...and the file is still in the archive", Boolean(await archiveEntryFor(doomed)), true);
  }

  console.log("=== an entry name that tries to leave its directory is refused ===");
  {
    // The bin and the archive are addressed by entry name, which is user input
    // in the same way a document path is.
    for (const [what, where] of [["the bin", "recycle-bin"], ["the archive", "archive"]]) {
      const escape = await admin.getRaw(`/api/${where}/..%2F..%2Fserver.js/content`);
      check(`${what} refuses a name that climbs out`, escape.status >= 400, true);
      check(`...without serving anything`, /require\(/.test(escape.raw), false);
    }
  }
}
