// Part of the auth suite. See auth.test.js, which starts the server and calls
// it.
//
// Paths that try to leave the documents directory, the migration off a flat
// library, ordering, restarts, and folder upload.
//
// Everything it needs is handed to it: the suite's own check(), the server, and
// the two clients the checks are made through. Split out of one file only
// because that file had grown past a thousand lines.
const Database = require("better-sqlite3");

module.exports = async (ctx) => {
  const { check, server, admin, fsp, path, makeClient, fail } = ctx;

  console.log("=== a path from a request cannot leave the documents directory ===");
  {
    // sanitizeDocPath rebuilds the path from safe segments, and resolveDocPath
    // then checks the result is still inside. Each of these has to fail.
    const attempts = [
      ["parent traversal", "../../../etc/passwd.md"],
      ["traversal in the middle", "Notes/../../../etc/passwd.md"],
      ["a single dot segment", "./secrets.md"],
      ["a double dot segment", "Notes/../secrets.md"],
      ["an absolute path", "/etc/passwd.md"],
      ["a hidden file", ".env.md"],
      ["a hidden directory", ".ssh/id_rsa.md"],
      ["an empty segment", "Notes//secrets.md"],
      ["a trailing slash", "Notes/"],
      ["a name with no allowed extension", "Notes/passwd"],
      ["a null byte", "Notes/evil\u0000.md"],
      ["a Windows separator", "..\\..\\windows\\evil.md"]
    ];

    for (const [label, attempt] of attempts) {
      const encoded = attempt.split("/").map(encodeURIComponent).join("/");
      // getRaw, not get: `new URL()` resolves "../.." away before the request
      // is sent, so an ordinary call would test the client's normalisation
      // rather than the server's refusal.
      const res = await admin.getRaw(`/api/docs/${encoded}`);
      const refused = res.status === 400 || res.status === 404;
      if (!refused) {
        fail();
      }
      console.log(`  ${refused ? "PASS" : "FAIL"}  ${label} is refused (${res.status})`);
    }

    // Percent-encoded traversal decodes before routing, so it is the same
    // attempt wearing a disguise and must fail the same way.
    const encodedDots = await admin.get("/api/docs/%2e%2e%2f%2e%2e%2fetc%2fpasswd.md");
    check("percent-encoded traversal is refused too",
      encodedDots.status === 400 || encodedDots.status === 404, true);

    check("nothing outside the documents directory was created",
      (await fsp.readdir(server.stateDir)).sort().join(","), "data,deleted_markdowns,docs");
  }

  console.log("=== an old flat library migrates itself ===");
  {
    // What the live library looked like before this change: every document in
    // one directory, with a filename to folder map beside it. Written straight
    // to disk and picked up by a fresh server, which is exactly the path the
    // real data took.
    const { startTestServer: startAnother } = require("../helpers/server");
    const os = require("os");
    const fs = require("fs/promises");

    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "azadocs-migrate-"));
    await fs.mkdir(path.join(stateDir, "docs"), { recursive: true });
    await fs.mkdir(path.join(stateDir, "data"), { recursive: true });

    for (const name of ["top.md", "filed.md", "deep.md", "orphan.md"]) {
      await fs.writeFile(path.join(stateDir, "docs", name), `# ${name}\n`, "utf8");
    }

    await fs.writeFile(path.join(stateDir, "data", "document-organizer.json"), JSON.stringify({
      version: 2,
      folders: [
        { id: "f_notes", name: "Notes", parentId: null, order: 0 },
        { id: "f_deep", name: "Archive", parentId: "f_notes", order: 0 },
        { id: "f_empty", name: "Empty", parentId: null, order: 1 }
      ],
      fileFolders: {
        "filed.md": "f_notes",
        "deep.md": "f_deep",
        // A mapping to a folder that no longer exists: the file must survive.
        "orphan.md": "f_gone"
      }
    }, null, 2), "utf8");

    const migrated = await startAnother({ stateDir });
    try {
      const docsDir = path.join(stateDir, "docs");
      const exists = async (rel) => {
        try { await fs.access(path.join(docsDir, rel)); return true; } catch { return false; }
      };

      check("a filed document moved into its folder", await exists("Notes/filed.md"), true);
      check("...and is gone from the top level", await exists("filed.md"), false);
      check("a nested folder is rebuilt in full", await exists("Notes/Archive/deep.md"), true);
      check("an unfiled document stays put", await exists("top.md"), true);
      check("a mapping to a missing folder leaves the file alone", await exists("orphan.md"), true);
      check("an empty folder still gets its directory", await exists("Empty"), true);

      // The organizer lives in the database now; the JSON above was imported
      // on boot and set aside. What was acted on is what the row says.
      const rows = new Database(path.join(stateDir, "data", "azadocs.db"), { readonly: true });
      const organizer = JSON.parse(/** @type {any} */ (rows.prepare("SELECT state_json FROM organizer WHERE id = 1").get()).state_json);
      rows.close();
      check("the old map is dropped once it has been acted on", organizer.fileFolders, {});
      check("...and the folder tree is untouched", organizer.folders.length, 3);
      check("...and the file it came from was set aside rather than left to be imported twice",
        await exists("../data/document-organizer.json.imported"), true);

      // Running again must be a no-op rather than a second round of moves.
      await migrated.stop();
      const again = await startAnother({ stateDir });
      try {
        check("a second boot moves nothing", await exists("Notes/filed.md"), true);
        check("...and does not re-file the unfiled one", await exists("top.md"), true);
      } finally {
        await again.stop();
      }
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  }

  console.log("=== everything is listed alphabetically ===");
  {
    await admin.post("/api/folders", { name: "zeta" });
    await admin.post("/api/folders", { name: "Alpha sort" });
    await admin.post("/api/folders", { name: "middle" });

    const tops = (await admin.get("/api/docs")).body.folders
      .filter((f) => !f.parentId)
      .map((f) => f.name);
    const wanted = [...tops].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
    check("folders come back in name order", tops, wanted);
    // Case must not split the list into two runs, which a plain sort would do.
    check("...case-insensitively",
      tops.indexOf("Alpha sort") < tops.indexOf("middle")
      && tops.indexOf("middle") < tops.indexOf("zeta"), true);

    const sortFolder = (await admin.get("/api/docs")).body.folders.find((f) => f.name === "zeta").id;
    for (const name of ["page-10.md", "page-2.md", "Banana.md", "apple.md"]) {
      await admin.post("/api/docs", { fileName: name, content: `# ${name}\n`, folderId: sortFolder });
    }

    const inZeta = (await admin.get("/api/docs")).body.docs
      .filter((d) => d.file.startsWith("zeta/"))
      .map((d) => d.file.slice("zeta/".length));

    check("documents are alphabetical too, ignoring case",
      inZeta, ["apple.md", "Banana.md", "page-2.md", "page-10.md"]);

    // The last one is the point of comparing numbers as numbers: a plain
    // string sort puts page-10 before page-2.
    check("...with numbers compared as numbers",
      inZeta.indexOf("page-2.md") < inZeta.indexOf("page-10.md"), true);

    // Editing a document used to move it to the top of its folder, because the
    // list was sorted by modification time.
    await admin.put("/api/docs/zeta/page-10.md", { content: "# touched\n" });
    const afterEdit = (await admin.get("/api/docs")).body.docs
      .filter((d) => d.file.startsWith("zeta/"))
      .map((d) => d.file.slice("zeta/".length));
    check("editing a document does not move it", afterEdit, inZeta);

    // The endpoint is gone; "reorder" now just looks like a folder id that
    // does not exist. What matters is that nothing it used to do still happens.
    const beforeReorder = (await admin.get("/api/docs")).body.folders.map((f) => f.name);
    const gone = await admin.put("/api/folders/reorder", { folderIds: [sortFolder] });
    check("the reorder endpoint is gone", gone.status >= 400, true);
    check("...and the order is untouched",
      (await admin.get("/api/docs")).body.folders.map((f) => f.name), beforeReorder);
  }

  console.log("=== the store survives a restart ===");
  {
    // Sessions and accounts are files, not memory: a restart must not sign
    // everyone out or lose an account.
    const db = new Database(path.join(server.stateDir, "data", "azadocs.db"), { readonly: true });
    const accounts = /** @type {any} */ (db.prepare("SELECT COUNT(*) AS n FROM users").get()).n;
    db.close();
    check("accounts persisted", accounts >= 2, true);
    // The shared editor token is gone; presenting one must not be a way in.
    check("a bearer token is no longer an authentication path",
      (await makeClient(server.origin).get("/api/docs",
        { Authorization: "Bearer any-token-at-all" })).status, 401);
  }

  console.log("=== one file at a time goes up the same way ===");
  {
    // /api/docs/upload is the single-file endpoint the toolbar uses; the
    // folder endpoint below is the drag-a-directory one. Until the coverage
    // map was drawn, nothing exercised this one at all.
    const send = (name, content, fields = {}) => admin.postMultipart(
      "/api/docs/upload",
      [{ field: "markdownFile", name, content }],
      fields
    );

    const made = await send("uploaded-alone.md", "# Uploaded alone\n");
    check("a markdown file is taken", made.status, 201);
    check("...under its own name", made.body.file, "uploaded-alone.md");
    check("...with a title and a size", [made.body.title, made.body.size > 0], ["Uploaded Alone", true]);
    check("...and it is readable straight away",
      (await admin.get("/api/docs/uploaded-alone.md")).body.content, "# Uploaded alone\n");

    // The form may rename the file on the way in, which is what the dialog
    // does when the name on disk is not the name wanted here.
    const renamed = await send("whatever.md", "# Renamed on arrival\n", { fileName: "chosen-name.md" });
    check("the form's name wins over the file's", renamed.body.file, "chosen-name.md");

    const second = await send("uploaded-alone.md", "# The second one\n");
    check("a name already taken is kept, not overwritten", second.status, 201);
    check("...by landing under a name of its own", second.body.file !== "uploaded-alone.md", true);
    check("...leaving the first one alone",
      (await admin.get("/api/docs/uploaded-alone.md")).body.content, "# Uploaded alone\n");

    const filed = await admin.post("/api/folders", { name: "Uploads" });
    const intoFolder = await send("filed-upload.md", "# Filed\n", { folderId: filed.body.folder.id });
    check("a folder id puts it in that folder", intoFolder.body.file, "Uploads/filed-upload.md");
    check("...and says which folder that was", intoFolder.body.folderName, "Uploads");

    check("a file type this app does not hold is refused",
      (await send("notes.txt", "plain text")).status, 400);
    check("...and so is a request with no file at all",
      (await admin.postMultipart("/api/docs/upload", [], {})).status, 400);

    // multer's own limit, which is the one that protects memory: the body is
    // read into a buffer before any of this app's code sees it.
    const tooBig = await send("enormous.md", "#".repeat(2 * 1024 * 1024 + 1024));
    check("a document past the 2MB limit is refused", tooBig.status, 413);

    const reader = makeClient(server.origin);
    await admin.post("/api/users", { username: "single-upload-viewer", password: "kettle-drum-twentytwo", role: "viewer" });
    await reader.post("/api/auth/login", { username: "single-upload-viewer", password: "kettle-drum-twentytwo" });
    await reader.post("/api/auth/password", {
      currentPassword: "kettle-drum-twentytwo",
      newPassword: "single-reader-password-1"
    });
    check("a viewer cannot upload one either",
      (await reader.postMultipart("/api/docs/upload",
        [{ field: "markdownFile", name: "sneaky.md", content: "# No\n" }], {})).status, 403);
  }

  console.log("=== folder upload ===");
  {
    const upload = (entries, fields = {}) => admin.postMultipart(
      "/api/upload/folder",
      entries.map((e) => ({ name: e.path.split("/").pop(), content: e.content || `# ${e.path}\n` })),
      { paths: JSON.stringify(entries.map((e) => e.path)), ...fields }
    );

    const res = await upload([
      { path: "Handbook/readme.md" },
      { path: "Handbook/2026/q1/goals.md" },
      { path: "Handbook/2026/retro.md" }
    ]);

    check("the upload succeeds", res.status, 201);
    check("every document lands", res.body.counts.uploaded, 3);
    check("the nesting is rebuilt", res.body.counts.foldersCreated, 3);

    const placed = Object.fromEntries(res.body.uploaded.map((u) => [u.file, u.folderPath]));
    check("a top-level file goes in the root folder", placed["Handbook/readme.md"], "Handbook");
    check("a nested one goes three deep", placed["Handbook/2026/q1/goals.md"], "Handbook / 2026 / q1");
    check("...and a sibling shares the middle folder", placed["Handbook/2026/retro.md"], "Handbook / 2026");
    // The uploaded path is the identity now, and it mirrors the folder exactly.
    check("the path on disk is the path that was uploaded", Object.keys(placed).sort(),
      ["Handbook/2026/q1/goals.md", "Handbook/2026/retro.md", "Handbook/readme.md"]);

    // Uploading into an existing tree must join it, not duplicate it.
    const second = await upload([{ path: "Handbook/2026/q1/notes.md" }]);
    check("a second upload reuses the folders it finds", second.body.counts.foldersCreated, 0);
    check("...and files into the existing one",
      second.body.uploaded[0].folderPath, "Handbook / 2026 / q1");

    const folders = (await admin.get("/api/docs")).body.folders;
    check("no duplicate folder was created",
      folders.filter((f) => f.path === "Handbook / 2026 / q1").length, 1);

    console.log("=== the same name in two folders is two documents ===");
    const clash = await upload([{ path: "Other/readme.md", content: "# Different\n" }]);
    // This is what the directory layout is for: both keep the name they were
    // given, nothing is renamed and nothing is overwritten.
    check("the second readme keeps its name", clash.body.uploaded[0].file, "Other/readme.md");
    check("...and was not renamed", clash.body.uploaded[0].renamedFrom, null);

    const first = await admin.get("/api/docs/Handbook/readme.md");
    check("the first one still reads", first.status, 200);
    check("...with its own content", first.body.content.includes("Handbook/readme.md"), true);

    const other = await admin.get("/api/docs/Other/readme.md");
    check("the second one reads too", other.status, 200);
    check("...with different content", other.body.content.includes("Different"), true);

    // Within one folder the name still has to be free, and that is now the only
    // place a suffix is ever added.
    const sameFolder = await upload([{ path: "Other/readme.md", content: "# Third\n" }]);
    check("a repeat in the same folder is suffixed", sameFolder.body.uploaded[0].renamedFrom, "readme.md");
    check("...rather than overwriting", sameFolder.body.uploaded[0].file === "Other/readme.md", false);

    console.log("=== paths from the client are not trusted ===");
    for (const [label, badPath] of [
      ["parent traversal", "../../../etc/passwd.md"],
      ["traversal in the middle", "Notes/../../escape.md"],
      ["an absolute path", "/etc/shadow.md"],
      ["a Windows path", "..\\..\\windows\\system32\\evil.md"],
      ["a dot folder", "../evil.md"]
    ]) {
      const attempt = await upload([{ path: badPath }]);
      // Either refused outright, or accepted with the traversal stripped —
      // never written outside the documents directory.
      const uploaded = attempt.body?.uploaded?.[0];
      const escaped = uploaded && String(uploaded.folderPath || "").includes("..");
      const ok = !escaped;
      if (!ok) {
        fail();
      }
      console.log(`  ${ok ? "PASS" : "FAIL"}  ${label} cannot escape (${attempt.status})`);
    }

    // Whatever the paths claimed, nothing may exist outside the documents dir.
    const docsDir = path.join(server.stateDir, "docs");
    // Directories are the point now, so "nothing nested" is no longer the
    // invariant. What still has to hold is that nothing escaped: every entry
    // resolves inside the documents directory and no name carries a traversal.
    const walk = async (dir, prefix = "") => {
      const entries = await fsp.readdir(path.join(dir, prefix), { withFileTypes: true });
      const out = [];
      for (const entry of entries) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        out.push(rel);
        if (entry.isDirectory()) {
          out.push(...await walk(dir, rel));
        }
      }
      return out;
    };

    const everything = await walk(docsDir);
    check("no entry anywhere carries a traversal",
      everything.every((name) => !name.split("/").includes("..")), true);
    check("every entry resolves inside the documents directory",
      everything.every((name) => path.resolve(docsDir, name).startsWith(docsDir + path.sep)), true);
    check("nothing was written to the state root",
      (await fsp.readdir(server.stateDir)).sort().join(","), "data,deleted_markdowns,docs");

    console.log("=== an awkward folder name costs the name, never the document ===");
    for (const [label, badPath, expectedFolder] of [
      ["a folder named like the unfiled bucket", "Ungrouped/keep-a.md", "Ungrouped (uploaded)"],
      ["a name past the 80-character limit", `${"L".repeat(100)}/keep-b.md`, "L".repeat(80)],
      ["a whitespace-only segment", "Keep/   /keep-c.md", "Keep"],
      ["a segment that is just a dot", "Keep/./keep-d.md", "Keep"],
      ["a control character in the name", `Keep/we${String.fromCharCode(7)}ird/keep-e.md`, "Keep / weird"]
    ]) {
      const attempt = await upload([{ path: badPath }]);
      const placed = attempt.body?.uploaded?.[0];
      const ok = attempt.status === 201 && placed && placed.folderPath === expectedFolder;
      if (!ok) {
        fail();
      }
      console.log(`  ${ok ? "PASS" : "FAIL"}  ${label} -> ${placed ? `"${placed.folderPath}"` : `dropped (${attempt.status})`}`);
    }

    // ".." is not an awkward name, it is an attempt at something.
    const traversal = await upload([{ path: "Keep/../../escape.md" }]);
    check("but '..' is still refused outright",
      (traversal.body?.uploaded || []).length, 0);

    const adjusted = await upload([{ path: "Ungrouped/keep-f.md" }]);
    check("the adjustment is reported, not silent",
      adjusted.body.renamedFolders.some((r) => r.to === "Ungrouped (uploaded)"), true);

    console.log("=== depth ===");
    const atLimit = await upload([{ path: "n1/n2/n3/n4/n5/n6/n7/n8/at-limit.md" }]);
    check("exactly at the 8-level limit is allowed", atLimit.status, 201);
    check("...and nests all eight", atLimit.body.uploaded[0].folderPath.split(" / ").length, 8);

    console.log("=== the guards ===");
    const tooDeep = await upload([
      { path: "a/b/c/d/e/f/g/h/i/j/deep.md" }
    ]);
    check("a folder deeper than the limit is refused", tooDeep.status, 400);
    check("...with a message that says what to do",
      /nests deeper|subfolder/i.test(tooDeep.body.error), true);

    const mismatched = await admin.postMultipart("/api/upload/folder",
      [{ name: "a.md", content: "# A\n" }, { name: "b.md", content: "# B\n" }],
      { paths: JSON.stringify(["only/one.md"]) });
    check("a paths array that does not line up is refused", mismatched.status, 400);

    const noPaths = await admin.postMultipart("/api/upload/folder",
      [{ name: "a.md", content: "# A\n" }], {});
    check("a missing paths array is refused", noPaths.status, 400);

    const empty = await admin.postMultipart("/api/upload/folder", [], { paths: "[]" });
    check("an empty upload is refused", empty.status, 400);

    const binary = await admin.postMultipart("/api/upload/folder",
      [{ name: "logo.png", content: "not really a png" }],
      { paths: JSON.stringify(["Assets/logo.png"]) });
    check("an unsupported file type is refused", binary.status, 400);

    console.log("=== and it is a write, so the role applies ===");
    const reader = makeClient(server.origin);
    await admin.post("/api/users", { username: "upload-viewer", password: "kettle-drum-twentyone", role: "viewer" });
    await reader.post("/api/auth/login", { username: "upload-viewer", password: "kettle-drum-twentyone" });
    await reader.post("/api/auth/password", {
      currentPassword: "kettle-drum-twentyone",
      newPassword: "reader-own-password-1"
    });
    const refused = await reader.postMultipart("/api/upload/folder",
      [{ name: "x.md", content: "# X\n" }], { paths: JSON.stringify(["Sneaky/x.md"]) });
    check("a viewer cannot upload a folder", refused.status, 403);
  }

  console.log("=== a space somebody may not read, over real HTTP ===");
  {
    /* The policy, enforced. lib/access.js is checked on its own as a decision
     * table; this is the other half — that the routes actually ask it, that
     * they ask it about the right document, and that a collection is filtered
     * rather than refused.
     *
     * The statement is written straight into the server's database, through
     * AccessStore itself rather than by hand, because there is no route for
     * writing one yet. Which makes this also the end-to-end check for the
     * thing that worried me most about caching a policy: the server is a
     * different process, and it has to notice.
     */
    const { AccessStore } = require("../../lib/access.js");
    const policy = new AccessStore({
      db: new Database(path.join(server.stateDir, "data", "azadocs.db")),
      markdownDir: path.join(server.stateDir, "docs")
    });

    const everyone = policy.groupByName("everyone");
    check("(the baseline the server wrote at boot)",
      policy.statements().map((one) => one.level), ["manage"]);

    const inProjects = server.docPaths["delta.md"];
    const unfiled = server.docPaths["beta.md"];
    check("(a document in a space, and one in no space)",
      [inProjects.startsWith("Projects/"), unfiled.includes("/")], [true, false]);

    check("it can be read before anything is closed",
      (await admin.get(`/api/docs/${inProjects}`)).status, 200);

    const closed = policy.write({
      effect: "deny",
      subject: { kind: "group", id: everyone.id },
      spaceDir: "Projects",
      level: "read"
    });
    check("(the space is closed to everyone)", closed.ok, true);

    const got = await admin.get(`/api/docs/${inProjects}`);
    check("a document in a closed space is not found",
      got.status, 404);
    check("...and the answer says nothing about a permission, because saying so would say the document is there",
      got.body.code, undefined);
    check("...the server noticed a policy another process wrote",
      got.status === 404, true);

    check("writing to it is refused the same way",
      (await admin.put(`/api/docs/${inProjects}`, { content: "# No\n" })).status, 404);
    check("...and so is renaming it",
      (await admin.post(`/api/docs/${inProjects}/rename`, { newName: "nope.md" })).status, 404);
    check("...and publishing a link to it, which would have handed the whole document over",
      (await admin.post(`/api/docs/${inProjects}/share`)).status, 404);

    const listed = await admin.get("/api/docs");
    check("the list leaves out what may not be read",
      listed.body.docs.some((doc) => doc.file.startsWith("Projects/")), false);
    check("...and keeps the rest",
      listed.body.docs.some((doc) => doc.file === unfiled), true);

    const found = await admin.get("/api/docs/search?q=Delta");
    check("a search does not answer with it either",
      found.body.matches.some((match) => match.file === inProjects), false);
    check("...and its count is what the caller may see, not what matched",
      [found.body.total, found.body.matches.length], [0, 0]);
    check("...while a search for something outside it is untouched",
      (await admin.get("/api/docs/search?q=Beta")).body.matches.length > 0, true);

    /* The index is the library's, the filter is the caller's.
     *
     * The search reconciles the index against the list of documents it is
     * given, and anything in the index that is not in that list is gone. Hand
     * it a list with somebody's unreadable documents taken out and those
     * documents are deleted from the index — for everybody, because of who
     * happened to search. The search above ran that reconcile with the space
     * closed; this is the check that it did not eat anything.
     */
    /* The index is the library's, and this is where that is measured.
     *
     * reconcile works out what has changed by comparing the index against the
     * list of documents it is handed, and anything in the index that is not in
     * that list is gone. Hand it a list with somebody's unreadable documents
     * taken out and it deletes them — and the damage hides, because the next
     * search by anybody rebuilds them. So the row count is read straight
     * after a search by somebody who may not see them, before anything can
     * put them back.
     */
    const indexedNow = () => /** @type {any} */ (policy.db
      .prepare("SELECT COUNT(*) AS n FROM document_index WHERE scope = 'docs'").get()).n;

    const indexedBefore = indexedNow();
    check("(the index holds the library)", indexedBefore > 50, true);
    await admin.get("/api/docs/search?q=Delta");
    check("a search by somebody who may not see them leaves the index alone",
      indexedNow(), indexedBefore);

    // The scan rather than the index: a token shorter than three characters
    // is one trigrams cannot be asked about, and that path has its own filter.
    const short = await admin.get("/api/docs/search?q=de");
    check("...and the short-query path, which reads the documents itself, filters too",
      short.body.matches.some((match) => match.file.startsWith("Projects/")), false);
    check("...while still finding what is outside the closed space",
      (await admin.get("/api/docs/search?q=be")).body.matches.length > 0, true);

    policy.remove(closed.id);
    check("with the space open again the document is found",
      (await admin.get("/api/docs/search?q=Delta")).body.matches
        .some((match) => match.file === inProjects),
      true);

    const reclosed = policy.write({
      effect: "deny",
      subject: { kind: "group", id: everyone.id },
      spaceDir: "Projects",
      level: "read"
    });
    check("(closed again, for the checks below)", reclosed.ok, true);

    check("a document outside the closed space is untouched",
      (await admin.get(`/api/docs/${unfiled}`)).status, 200);

    check("lifting the statement opens it again",
      [policy.remove(reclosed.id), (await admin.get(`/api/docs/${inProjects}`)).status],
      [true, 200]);

    /* A deny on one account rather than on everyone, which is the shape that
     * leaves an admin able to look: the group everyone has every account in
     * it, this one names one.
     */
    const reader2 = makeClient(server.origin);
    await admin.post("/api/users",
      { username: "scoped-reader", password: "kettle-drum-twentytwo", role: "editor" });
    await reader2.post("/api/auth/login",
      { username: "scoped-reader", password: "kettle-drum-twentytwo" });
    await reader2.post("/api/auth/password", {
      currentPassword: "kettle-drum-twentytwo",
      newPassword: "scoped-own-password-1"
    });

    const them = policy.db.prepare("SELECT id FROM users WHERE username = 'scoped-reader'").get();
    policy.write({
      effect: "deny",
      subject: { kind: "user", id: them.id },
      spaceDir: "Projects",
      level: "read"
    });

    check("the account named is refused",
      (await reader2.get(`/api/docs/${inProjects}`)).status, 404);
    check("...and sees none of that space in the list",
      (await reader2.get("/api/docs")).body.docs.some((doc) => doc.file.startsWith("Projects/")),
      false);
    check("...while everybody else still reads it",
      (await admin.get(`/api/docs/${inProjects}`)).status, 200);
    check("...and the refusal is written down, with the statement that caused it",
      (await fsp.readFile(path.join(server.stateDir, "data", "audit.jsonl"), "utf8"))
        .split("\n").filter(Boolean).map((line) => JSON.parse(line))
        .some((entry) => entry.event === "access.denied"
          && entry.user === "scoped-reader"
          && String(entry.reason || "").includes("deny read user:")),
      true);

    policy.db.prepare("DELETE FROM grants WHERE effect = 'deny'").run();

    console.log("=== the bin, the folders and the other way in ===");
    {
      /* Three more families, and the reason each is checked rather than
       * assumed: a bin entry is not the document it was, a folder is not a
       * document at all, and /graphql is a second way to read every document
       * in the library.
       */
      const deleted = await admin.post(`/api/docs/${inProjects}/delete`, { mode: "soft" });
      check("(a document in the space is deleted)", deleted.status, 200);

      const bin = await admin.get("/api/recycle-bin");
      const entry = bin.body.docs.find((doc) => doc.originalFile === inProjects);
      check("(and is in the bin, under the path it came from)", Boolean(entry), true);

      /* Scoped to the document itself, not to the space around it.
       *
       * Which is the shape that tells the two apart. A bin entry is stored
       * under a stamped name — "Projects/20261125T…--delta.md" — so a deny on
       * the *space* hides it whether the permission is read off the entry's
       * own path or off the document's, because both begin with Projects. A
       * deny on the document says which one is being asked about: the entry's
       * own name does not match it and the document's does.
       */
      policy.write({
        effect: "deny",
        subject: { kind: "group", id: everyone.id },
        spaceDir: "Projects",
        prefix: "delta.md",
        level: "read"
      });

      check("the bin leaves out what was deleted from a closed space",
        (await admin.get("/api/recycle-bin")).body.docs
          .some((doc) => doc.originalFile === inProjects),
        false);
      check("...reading its content is refused",
        (await admin.get(`/api/recycle-bin/${entry.file}/content`)).status, 404);
      check("...and so is restoring it, which would be a way back into the space",
        (await admin.post(`/api/recycle-bin/${entry.file}/restore`)).status, 404);

      check("the bin's search answers by where the document was, not what the entry is called",
        (await admin.get("/api/docs/search?q=Delta&scope=recycle-bin")).body.matches
          .some((match) => match.originalFile === inProjects || match.file.includes("delta")),
        false);

      console.log("=== the tree, and the ancestors that have to stay in it ===");
      {
        /* The fixture nests Projects > Cart > Frontend > Components > Design >
         * Tokens, with alpha.md at the bottom. So a statement that grants the
         * bottom and nothing else is the case the rule exists for: six folders
         * are named for the sake of one document, because without them the
         * document hangs off nothing.
         */
        /* Asked as the editor and not as the admin, which is the whole point
         * of asking: an admin carries an implicit allow at the root, so an
         * admin sees the library whatever the statements say and would have
         * made every check below pass for the wrong reason.
         */
        /* Made here rather than assumed: earlier sections of this suite move
         * and rename the fixture's documents, so the deepest folder is not
         * reliably occupied by the time this runs.
         */
        const madeDeep = await admin.post("/api/docs", {
          fileName: "deep.md",
          content: "# Deep\n",
          folderId: server.folderIds.get("Tokens")
        });
        check("(a document at the bottom of the tree)", madeDeep.status, 201);
        const deepFile = madeDeep.body.file;

        policy.db.prepare("DELETE FROM grants").run();
        const theirEveryone = policy.groupByName("everyone");
        policy.write({
          effect: "allow",
          subject: { kind: "group", id: theirEveryone.id },
          spaceDir: "Projects",
          prefix: "Cart/Frontend/Components/Design/Tokens",
          level: "read"
        });

        const deep = await reader2.get("/api/docs");
        const names = deep.body.folders.map((folder) => folder.name).sort();

        check("only the document that was granted comes back",
          deep.body.docs.map((doc) => doc.file), [deepFile]);
        check("...and every folder above it, so it can be reached",
          names, ["Cart", "Components", "Design", "Frontend", "Projects", "Tokens"]);
        check("...and nothing beside them",
          deep.body.folders.some((folder) => folder.name === "Notes"), false);
        check("...with the path of a kept ancestor still right, because the whole tree computed it",
          deep.body.folders.find((folder) => folder.name === "Tokens").path,
          "Projects / Cart / Frontend / Components / Design / Tokens");
        check("...and its depth with it",
          deep.body.folders.find((folder) => folder.name === "Tokens").depth, 5);

        check("graphql's tree answers the same way, from the same rule",
          (await reader2.post("/graphql", { query: "{ folders { name } }" }))
            .body.data.folders.map((folder) => folder.name).sort(),
          names);

        /* One document, and nothing about the folder it is in.
         *
         * This is the case the documents-based half of the rule exists for. A
         * statement on the folder keeps the folder by itself — the directory
         * is readable — so a tree built only from directory permissions would
         * pass every check above and still lose a folder whose *single
         * granted document* is the only thing in it that may be read.
         */
        policy.db.prepare("DELETE FROM grants").run();
        policy.write({
          effect: "allow",
          subject: { kind: "group", id: theirEveryone.id },
          spaceDir: "Projects",
          prefix: "Cart/Frontend/Components/Design/Tokens/deep.md",
          level: "read"
        });

        const onlyOne = await reader2.get("/api/docs");
        check("a grant on one document still shows the folders it lives in",
          onlyOne.body.folders.map((folder) => folder.name).sort(),
          ["Cart", "Components", "Design", "Frontend", "Projects", "Tokens"]);
        check("...and the document itself, which would otherwise hang off nothing",
          onlyOne.body.docs.map((doc) => doc.file), [deepFile]);

        /* An empty folder somebody may write into stays on the screen: the
         * folder is readable even though no document in it is.
         */
        policy.db.prepare("DELETE FROM grants").run();
        policy.write({
          effect: "allow",
          subject: { kind: "group", id: theirEveryone.id },
          spaceDir: "",
          level: "write"
        });
        policy.write({
          effect: "allow",
          subject: { kind: "group", id: theirEveryone.id },
          spaceDir: "Notes",
          level: "write"
        });
        check("a folder with nothing in it is still shown when it may be written into",
          (await reader2.get("/api/docs")).body.folders
            .some((folder) => folder.name === "Notes"),
          true);

        policy.db.prepare("DELETE FROM grants").run();
        policy.ensureBaseline({ actor: "aza" });
        check("(the baseline is back, and with it the whole tree for everybody)",
          (await reader2.get("/api/docs")).body.folders.length,
          (await admin.get("/api/docs")).body.folders.length);
      }

      console.log("=== a folder that moves takes its policy with it ===");
      {
        /* The statements are the one thing in this app that names a path and
         * is not derived from the folder tree. Renaming a folder moves its
         * directory and every document comes along without a path being
         * rewritten anywhere — which is exactly why these have to be. A
         * statement left behind stops applying silently.
         */
        policy.db.prepare("DELETE FROM grants").run();
        policy.ensureBaseline({ actor: "aza" });
        /* The deny names one account rather than everyone.
         *
         * A deny on a space refuses the admin as well — it beats the implicit
         * allow, which is the design and is checked elsewhere — so closing it
         * to everyone would have stopped the admin renaming the folder, and
         * these checks are about what the rename does to the policy.
         */
        const them = /** @type {any} */ (policy.db
          .prepare("SELECT id FROM users WHERE username = 'scoped-reader'").get());

        const made = await admin.post("/api/folders", { name: "Minutes" });
        check("(a new top-level folder)", made.status, 201);
        const minutes = made.body.folder.id;
        check("...which is a space straight away, not after a restart",
          Boolean(policy.spaceByDir("Minutes")), true);

        const inside = await admin.post("/api/docs",
          { fileName: "january.md", content: "# January\n", folderId: minutes });
        check("(with a document in it)", inside.status, 201);

        policy.write({
          effect: "deny",
          subject: { kind: "user", id: them.id },
          spaceDir: "Minutes",
          level: "read"
        });
        check("the document is refused while the space is closed",
          (await reader2.get(`/api/docs/${inside.body.file}`)).status, 404);

        const renamed = await admin.put(`/api/folders/${minutes}`, { name: "Records" });
        check("(the folder is renamed)", renamed.status, 200);
        check("...the space is the same row under a new name",
          [Boolean(policy.spaceByDir("Records")), policy.spaceByDir("Minutes")],
          [true, null]);
        check("...and the document is still refused at the path it now has",
          (await reader2.get("/api/docs/Records/january.md")).status, 404);
        check("...while the admin can still read it, as before",
          (await admin.get("/api/docs/Records/january.md")).status, 200);

        // A folder moved inside another folder: the statement becomes a
        // prefix in the space it moved into.
        const moved = await admin.put(`/api/folders/${minutes}`,
          { name: "Records", parentId: server.folderIds.get("Notes") });
        check("(the folder is moved under another one)", moved.status, 200);
        check("...and the statement moved with it",
          policy.statements()
            .filter((one) => one.space !== null)
            .map((one) => (one.prefix ? `${one.space}/${one.prefix}` : one.space)),
          ["Notes/Records"]);
        check("...so the document is refused at its new path too",
          (await reader2.get("/api/docs/Notes/Records/january.md")).status, 404);
        check("...and nothing else in that space became unreadable",
          (await reader2.get("/api/docs")).body.docs.some((doc) => doc.file === unfiled), true);

        const removed = await admin.del(`/api/folders/${server.folderIds.get("Notes")}`);
        check("(the folder above it is deleted)", removed.status, 200);
        check("...and the space goes, with everything said about paths inside it",
          [policy.spaceByDir("Notes"), policy.statements().filter((one) => one.space !== null)],
          [null, []]);
        check("...while the document it rescued is readable at the top level",
          (await reader2.get("/api/docs/january.md")).status, 200);

        policy.db.prepare("DELETE FROM grants").run();
        policy.ensureBaseline({ actor: "aza" });
      }

      // And the folders, which need the space closed rather than one document
      // in it: a folder's permission is asked about the directory.
      policy.db.prepare("DELETE FROM grants WHERE effect = 'deny'").run();
      policy.write({
        effect: "deny",
        subject: { kind: "group", id: everyone.id },
        spaceDir: "Projects",
        level: "read"
      });

      check("a folder in a closed space cannot be renamed",
        (await admin.put(`/api/folders/${server.folderIds.get("Projects")}`,
          { name: "Projects Renamed" })).status, 404);
      check("...nor deleted",
        (await admin.del(`/api/folders/${server.folderIds.get("Projects")}`)).status, 404);
      // Its own folder, because the block above deletes the fixture's.
      const elsewhere = await admin.post("/api/folders", { name: "Elsewhere" });
      check("...while a folder elsewhere still can be",
        (await admin.put(`/api/folders/${elsewhere.body.folder.id}`,
          { name: "Elsewhere Renamed" })).status, 200);

      const asked = await admin.post("/graphql", {
        query: `{ docsCount document(file: "${inProjects}") { file } documents(limit: 200) { file } }`
      });
      check("graphql does not hand over a document from a closed space",
        asked.body.data.document, null);
      check("...nor list one",
        asked.body.data.documents.some((doc) => doc.file.startsWith("Projects/")), false);
      check("...nor count one",
        asked.body.data.docsCount,
        (await admin.get("/api/docs")).body.docs.length);

      const searched = await admin.post("/graphql",
        { query: '{ search(query: "Delta") { file } }' });
      check("...nor find one",
        searched.body.data.search.some((hit) => hit.file.startsWith("Projects/")), false);

      policy.db.prepare("DELETE FROM grants WHERE effect = 'deny'").run();
      check("and with the space open again, the bin has it back",
        (await admin.get("/api/recycle-bin")).body.docs
          .some((doc) => doc.originalFile === inProjects),
        true);
      check("...and it can be restored",
        (await admin.post(`/api/recycle-bin/${entry.file}/restore`)).status, 200);
    }

    policy.db.close();
  }

};
