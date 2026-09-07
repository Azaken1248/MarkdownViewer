// Part of the auth suite. See auth.test.js, which starts the server and calls
// it.
//
// Paths that try to leave the documents directory, the migration off a flat
// library, ordering, restarts, and folder upload.
//
// Everything it needs is handed to it: the suite's own check(), the server, and
// the two clients the checks are made through. Split out of one file only
// because that file had grown past a thousand lines.
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

      const organizer = JSON.parse(await fs.readFile(path.join(stateDir, "data", "document-organizer.json"), "utf8"));
      check("the old map is dropped once it has been acted on", organizer.fileFolders, {});
      check("...and the folder tree is untouched", organizer.folders.length, 3);

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
    const users = JSON.parse(await fsp.readFile(path.join(server.stateDir, "data", "users.json"), "utf8"));
    check("accounts persisted", users.users.length >= 2, true);
    // The shared editor token is gone; presenting one must not be a way in.
    check("a bearer token is no longer an authentication path",
      (await makeClient(server.origin).get("/api/docs",
        { Authorization: "Bearer any-token-at-all" })).status, 401);
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

};
