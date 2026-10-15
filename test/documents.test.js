/* Every way the documents and folders APIs refuse what they are given.
 *
 * The happy paths are exercised constantly — by `dom`, by `recycle`, by
 * `auth`, by anything that needs a document to exist. What nothing reached was
 * the refusals, and there are thirty of them: a name that is not a name, a
 * body over the limit, a folder that is not there, a folder that cannot hold
 * the file, a name already taken in the destination.
 *
 * They are each three lines, and each of those three lines is the difference
 * between a clear "no" and a document written somewhere nobody will find it.
 * The same reasoning as body.test.js, one layer out: that suite checks the
 * reader every route reads its input through, and this one checks what each
 * route does with what the reader hands back.
 *
 * Over real HTTP against a real server, because a route's answer is a status
 * and a sentence and those only exist at that level.
 */

const path = require("path");
const fsp = require("fs/promises");
const { makeClient } = require("./helpers/client");
const { startTestServer, SEED_USERNAME, SEED_PASSWORD, TEST_PASSWORD } = require("./helpers/server");
const { createChecker } = require("./helpers/check.js");

const { check, finish } = createChecker("DOCUMENTS");

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
    currentPassword: SEED_PASSWORD, newPassword: TEST_PASSWORD
  });

  const write = async (file, body = `# ${file}\n`, folderId = null) => {
    const made = await admin.post("/api/docs", { fileName: file, content: body, folderId });
    if (made.status !== 201) {
      throw new Error(`could not create ${file}: ${made.status}`);
    }

    return made.body.file;
  };

  const folder = async (name, parentId = null) =>
    (await admin.post("/api/folders", { name, parentId })).body.folder;

  // Where the server keeps the library, which is "docs" under its own state
  // directory.
  const exists = async (relative) => {
    try {
      await fsp.stat(path.join(server.stateDir, "docs", relative));
      return true;
    } catch {
      return false;
    }
  };

  /* A name the filesystem would take but this app will not. Each of these is
   * the shape of a real mistake or a real attempt: a path that climbs out of
   * the library, a name that is only an extension, a name of nothing.
   */
  const NOT_A_NAME = ["", "   ", ".md", "..", "../escape.md", "/etc/passwd", "a/../../b.md"];

  console.log("=== a name that is not a name ===");
  {
    for (const fileName of NOT_A_NAME) {
      const made = await admin.post("/api/docs", { fileName, content: "x" });
      check(`creating ${JSON.stringify(fileName)} is refused`, made.status, 400);
    }

    check("...and nothing is written outside the library",
      await exists("../escape.md"), false);

    // The same names on the way through a rename.
    const file = await write("renameable.md");
    for (const fileName of NOT_A_NAME) {
      const renamed = await admin.post(`/api/docs/${file}/rename`, { fileName });
      check(`renaming to ${JSON.stringify(fileName)} is refused`, renamed.status, 400);
    }

    check("...and the document keeps the name it had", await exists(file), true);
  }

  console.log("=== a document that is not there ===");
  {
    check("writing to a document that does not exist is a 404",
      (await admin.put("/api/docs/never-made.md", { content: "x" })).status, 404);
    check("...and so is renaming one",
      (await admin.post("/api/docs/never-made.md/rename", { fileName: "other.md" })).status, 404);
    check("...and filing one in a folder",
      (await admin.put("/api/docs/never-made.md/folder", { folderId: null })).status, 404);
    check("...and reading one",
      (await admin.get("/api/docs/never-made.md")).status, 404);
  }

  console.log("=== a document bigger than the limit ===");
  {
    /* Two megabytes, which is far more than any document anybody writes and
     * far less than enough to fill a disk by accident. The check is here as
     * well as in express's own body limit, because the body limit is bytes on
     * the wire and this is bytes of content.
     */
    const tooMuch = "x".repeat(2 * 1024 * 1024 + 1);

    const made = await admin.post("/api/docs", { fileName: "huge.md", content: tooMuch });
    check("creating one over the limit is refused", made.status, 413);
    check("...saying what the limit is", made.body.error.includes("2MB"), true);
    check("...and nothing is written", await exists("huge.md"), false);

    const file = await write("growable.md");
    const grown = await admin.put(`/api/docs/${file}`, { content: tooMuch });
    check("...and so is growing one past it", grown.status, 413);

    // And one exactly at the limit is fine, because a limit nobody can reach
    // is a limit written down wrong.
    const atTheLimit = "x".repeat(2 * 1024 * 1024);
    check("a document exactly at the limit is accepted",
      (await admin.put(`/api/docs/${file}`, { content: atTheLimit })).status, 200);
  }

  console.log("=== a name already in use ===");
  {
    /* Unique within its folder, not across the library: two documents called
     * README.md in two folders are two documents, and refusing the second
     * would be refusing the only name it should have.
     */
    const file = await write("twice.md");
    const again = await admin.post("/api/docs", { fileName: "twice.md", content: "# two\n" });
    check("creating a document over one of the same name is refused", again.status, 409);
    check("...saying which folder it is already in",
      again.body.error.includes("in this folder"), true);
    check("...and the one that was there is untouched",
      (await admin.get(`/api/docs/${file}`)).body.content, "# twice.md\n");

    // Unless the caller says to, which is what the editor's Save does.
    const over = await admin.post("/api/docs",
      { fileName: "twice.md", content: "# replaced\n", overwrite: true });
    check("...while a caller that asked to overwrite does", over.status, 201);
    check("...and it is the new one on disk",
      (await admin.get(`/api/docs/${file}`)).body.content, "# replaced\n");

    // And the same name in another folder is a different document.
    const elsewhere = await folder("Elsewhere");
    const beside = await admin.post("/api/docs",
      { fileName: "twice.md", content: "# beside\n", folderId: elsewhere.id });
    check("the same name in another folder is another document", beside.status, 201);
    check("...kept apart on disk",
      [await exists("twice.md"), await exists("Elsewhere/twice.md")], [true, true]);
  }

  console.log("=== a folder that cannot take it ===");
  {
    const file = await write("filed.md");

    check("filing a document in a folder id that is not one is refused",
      (await admin.put(`/api/docs/${file}/folder`, { folderId: "../../etc" })).status, 400);
    check("...and in a folder that does not exist is a 404",
      (await admin.put(`/api/docs/${file}/folder`, { folderId: "no-such-folder" })).status, 404);

    // Filing it where it already is is not a move, and is not an error either.
    const here = await admin.put(`/api/docs/${file}/folder`, { folderId: null });
    check("filing it where it already is is no move at all",
      [here.status, here.body.file], [200, file]);

    /* And a name already taken in the destination is refused rather than
     * renamed. The whole point of directories is that you keep the name you
     * chose; a silent "filed-1.md" would be the old behaviour creeping back.
     */
    const target = await folder("Somewhere");
    await write("clash.md", "# one\n", target.id);
    const clashing = await write("clash.md");
    const refused = await admin.put(`/api/docs/${clashing}/folder`, { folderId: target.id });
    check("a name already taken in the destination is refused", refused.status, 409);
    check("...saying so rather than renaming it quietly",
      refused.body.error.includes("already exists"), true);
    check("...and the document stays where it was", await exists(clashing), true);

    // A rename onto a name that is taken in the same folder is the same answer.
    await write("taken.md");
    const over = await admin.post(`/api/docs/${clashing}/rename`, { fileName: "taken.md" });
    check("renaming onto a name already in the folder is refused", over.status, 409);

    // Renaming to the name it already has is not a rename, and not an error.
    const same = await admin.post(`/api/docs/${clashing}/rename`, { fileName: clashing });
    check("renaming a document to its own name changes nothing",
      [same.status, same.body.file, same.body.previousFile], [200, clashing, clashing]);
  }

  console.log("=== and the folders themselves ===");
  {
    /* A folder is a directory now, so its name has to survive being one: the
     * same refusals as a document name, for the same reason.
     */
    for (const name of ["", "   ", "..", "../escape", "a/b"]) {
      check(`a folder called ${JSON.stringify(name)} is refused`,
        (await admin.post("/api/folders", { name })).status, 400);
    }

    check("a folder under a parent id that is not one is refused",
      (await admin.post("/api/folders", { name: "Fine", parentId: "../../etc" })).status, 400);
    check("...and under a parent that does not exist is a 404",
      (await admin.post("/api/folders", { name: "Fine", parentId: "no-such" })).status, 404);

    const outer = await folder("Outer");
    const inner = await folder("Inner", outer.id);

    check("renaming a folder that is not there is a 404",
      (await admin.put("/api/folders/no-such", { name: "x" })).status, 404);
    check("...and deleting one is too",
      (await admin.del("/api/folders/no-such")).status, 404);
    check("renaming one to a name a directory cannot have is refused",
      (await admin.put(`/api/folders/${outer.id}`, { name: "a/b" })).status, 400);
    /* An id is letters, numbers and three punctuation marks. Anything else is
     * not an id, which is a different answer from "there is no such folder" —
     * the second invites a retry and the first does not.
     */
    check("...and an id that could not be one is refused rather than looked up",
      (await admin.put("/api/folders/not%20an%20id%2A", { name: "x" })).status, 400);

    /* A folder cannot be moved inside itself, or inside anything already
     * inside it: a cycle in the tree is a library nothing can draw.
     */
    const intoItself = await admin.put(`/api/folders/${outer.id}`, { parentId: outer.id });
    check("a folder cannot be moved into itself", intoItself.status, 400);

    const intoChild = await admin.put(`/api/folders/${outer.id}`, { parentId: inner.id });
    check("...nor into something already inside it", intoChild.status, 400);
    check("...saying why rather than refusing silently",
      typeof intoChild.body.error === "string" && intoChild.body.error.length > 0, true);

    check("...while into a parent that does not exist is a 404",
      (await admin.put(`/api/folders/${inner.id}`, { parentId: "no-such" })).status, 404);

    // And out to the top level, which is what a null parent means.
    const toTop = await admin.put(`/api/folders/${inner.id}`, { parentId: null });
    check("a folder can be moved out to the top level",
      [toTop.status, toTop.body.folder.parentId], [200, null]);
  }
}
