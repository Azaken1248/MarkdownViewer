// Part of the DOM suite. See dom.test.js, which sets all this up and calls it.
//
// Putting files into the library from the picker.
//
// links-and-roles.js checks what a folder upload *sends* — the filtering that
// keeps a folder's images and dotfiles off the wire. What nothing reached was
// everything either side of that: the single-file upload and its two refusals,
// the two refusals a folder gets before anything is sent, and the sentence the
// app writes afterwards, which is the only account anybody gets of what landed
// and what did not.
module.exports = async (ctx) => {
  const { check, waitUntil, window, doc, server, cookieHeader, get } = ctx;

  const run = (source) => window.eval(source);
  const state = () => run("window.__t.state");
  const said = () => [...doc.querySelectorAll("#toastStack .toast, #toastStackUrgent .toast")]
    .map((one) => one.querySelector(".toast-message")?.textContent || "");
  const clearToasts = () => doc.querySelectorAll(".toast").forEach((one) => one.remove());
  const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

  const csrf = () => state().csrfToken;
  const folderNamed = async (name) => (await server.request("POST", "/api/folders",
    { name }, { Cookie: cookieHeader(), "X-CSRF-Token": csrf() })).body.folder;
  const onDisk = async (file) => {
    const answer = await get(`/api/docs/${file.split("/").map(encodeURIComponent).join("/")}`);
    return answer.status === 200 ? JSON.parse(answer.body).content : answer.status;
  };

  // The picker hands back File objects; the folder one puts the path within
  // the chosen folder on each.
  const fileNamed = (name, content = "# doc\n", relativePath = null) => {
    const file = new window.File([content], name.split("/").pop(), { type: "text/markdown" });
    if (relativePath) {
      Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
    }
    return file;
  };
  const hand = (value) => { window.__picked = value; };

  /* A file input's value cannot be set by a test — a browser will not let
   * script put a path into one, and jsdom will not either. What matters here
   * is that the app clears it, so the element records being cleared instead.
   */
  const picker = doc.getElementById("uploadInput");
  let clearings = 0;
  Object.defineProperty(picker, "value", {
    configurable: true,
    get: () => "",
    set: (written) => { if (written === "") clearings += 1; }
  });

  console.log("=== one document at a time ===");
  {
    clearToasts();
    hand(fileNamed("uploaded-alone.md", "# Uploaded alone\n"));
    await run("window.__t.uploadMarkdown(window.__picked)");
    await waitUntil(() => said().length > 0, 8000);

    check("the file is in the library", await onDisk("uploaded-alone.md"), "# Uploaded alone\n");
    check("...and the app says so", said().at(-1), "Uploaded uploaded-alone.md.");
    /* The picker is emptied afterwards. A file input that still holds the
     * last file will not fire a change event when the same file is chosen
     * again, so the second upload of a corrected file does nothing.
     */
    check("...and the picker is emptied, so the same file can be chosen again",
      [clearings > 0, state().pendingUploadFile], [true, null]);

    const folder = await folderNamed("Uploads Go Here");
    await run("window.__t.refreshDocs({ preserveSearch: true })");
    clearToasts();
    hand(fileNamed("uploaded-filed.md", "# Uploaded filed\n"));
    await run(`window.__t.uploadMarkdown(window.__picked, ${JSON.stringify(folder.id)})`);
    await waitUntil(() => said().length > 0, 8000);
    check("one uploaded into a folder lands in it",
      await onDisk("Uploads Go Here/uploaded-filed.md"), "# Uploaded filed\n");
    check("...and the message names the folder it went to",
      said().at(-1), "Uploaded Uploads Go Here/uploaded-filed.md to Uploads Go Here.");

    // Nothing chosen is not an upload, and not an error either.
    clearToasts();
    await run("window.__t.uploadMarkdown(null)");
    await settle();
    check("no file is no upload and nothing said", said(), []);

    // An upload the server refuses says why and leaves the picker clear.
    clearToasts();
    hand(fileNamed("rejected.exe", "not markdown at all"));
    await run("window.__t.uploadMarkdown(window.__picked)");
    await waitUntil(() => said().length > 0, 8000);
    check("one the server refuses says so", said().length > 0, true);
    const clearedBefore = clearings;
    check("...and still clears the picker for the next try",
      [clearings > clearedBefore - 1, state().pendingUploadFile], [true, null]);
  }

  console.log("=== a whole folder, and the two ways it is refused ===");
  {
    /* Both refusals happen here rather than at the server: a real folder is
     * mostly images and lock files, and a thousand-file folder would be a
     * thousand files uploaded before being told no. The server checks too —
     * this is the convenience, not the boundary.
     */
    clearToasts();
    hand([fileNamed("beach.png", "", "Trip/photos/beach.png"),
      fileNamed(".DS_Store", "", "Trip/.DS_Store")]);
    await run("window.__t.uploadFolder(window.__picked)");
    await waitUntil(() => said().length > 0, 6000);
    check("a folder with nothing this app holds in it is refused before anything is sent",
      said().at(-1),
      "Nothing to upload — none of those 2 file(s) are markdown, Mermaid or notebook files.");

    clearToasts();
    const limit = run("window.__t.MAX_FOLDER_UPLOAD_FILES");
    hand(Array.from({ length: limit + 1 },
      (_, index) => fileNamed(`doc-${index}.md`, "# doc\n", `Big/doc-${index}.md`)));
    await run("window.__t.uploadFolder(window.__picked)");
    await waitUntil(() => said().length > 0, 6000);
    check("...and one past the limit is refused with the limit in the sentence",
      said().at(-1),
      `That folder has ${limit + 1} documents; the limit is ${limit}. Upload a subfolder instead.`);
  }

  console.log("=== and the account it gives of what landed ===");
  {
    /* The server's answer is stood in for, because what is being read here is
     * the sentence the app builds from it: every clause is a different thing
     * going not-quite-right, and the only place a person is told about any of
     * them. The real route is the `documents` suite's job.
     */
    const realFetch = window.fetch;
    const useFetch = (fn) => { window.fetch = fn; };
    const answerWith = (payload, status = 201) => useFetch(async (url, options = {}) => (
      String(url).includes("/api/upload/folder")
        ? { status, ok: status < 300, async json() { return payload; },
          async text() { return JSON.stringify(payload); } }
        : realFetch(url, options)));

    const uploadOf = async (picked, payload, status) => {
      answerWith(payload, status);
      clearToasts();
      hand(picked);
      await run("window.__t.uploadFolder(window.__picked)");
      await waitUntil(() => said().length > 1, 8000);
      useFetch(realFetch);
      return said().at(-1);
    };

    const picked = [fileNamed("notes.md", "# notes\n", "Trip/notes.md"),
      fileNamed("skip.png", "", "Trip/skip.png")];

    check("what arrived is one sentence of clauses",
      await uploadOf(picked, {
        uploaded: [{ file: "Trip/notes.md" }], renamedFolders: [],
        counts: { uploaded: 1, foldersCreated: 1, skipped: 0 }
      }),
      "Uploaded 1 document(s), created 1 folder(s), skipped 1 unsupported file(s).");

    check("...a file the server refused is counted in it",
      await uploadOf([fileNamed("a.md", "# a\n", "Trip/a.md")], {
        uploaded: [], renamedFolders: [], counts: { uploaded: 0, foldersCreated: 0, skipped: 1 }
      }),
      "Uploaded 0 document(s), 1 rejected.");

    /* A name that had to change is the one a person has to be told about:
     * the document is in the library under something other than what they
     * uploaded, and nothing else on screen would say so.
     */
    check("...so is a document renamed to avoid a clash",
      await uploadOf([fileNamed("b.md", "# b\n", "Trip/b.md")], {
        uploaded: [{ file: "Trip/b-1.md", renamedFrom: "Trip/b.md" }], renamedFolders: [],
        counts: { uploaded: 1, foldersCreated: 0, skipped: 0 }
      }),
      "Uploaded 1 document(s), 1 renamed to avoid a clash.");

    check("...and a folder name this app had to adjust, which it names",
      await uploadOf([fileNamed("c.md", "# c\n", "Trip/c.md")], {
        uploaded: [{ file: "Trip/c.md" }],
        renamedFolders: [{ from: "C:on", to: "Con" }, { from: "a/b", to: "a-b" }],
        counts: { uploaded: 1, foldersCreated: 2, skipped: 0 }
      }),
      'Uploaded 1 document(s), created 2 folder(s), 2 folder name(s) adjusted ("Con", "a-b").');

    check("an upload the server refuses outright says why",
      await uploadOf([fileNamed("d.md", "# d\n", "Trip/d.md")],
        { error: "That upload was too large." }, 413),
      "That upload was too large.");

    useFetch(realFetch);
  }

  console.log("=== and the folder it made is opened, not left collapsed ===");
  {
    /* Uploading a folder and being left looking at a collapsed tree is the
     * upload appearing to have done nothing. The tree is opened at the folder
     * that was just made.
     */
    clearToasts();
    hand([fileNamed("inside.md", "# Inside\n", "Revealed/inside.md"),
      fileNamed("deeper.md", "# Deeper\n", "Revealed/under/deeper.md")]);
    await run("window.__t.uploadFolder(window.__picked)");
    await waitUntil(() => said().some((one) => /^Uploaded 2/.test(one)), 10000);

    check("both documents are in the library",
      [await onDisk("Revealed/inside.md"), await onDisk("Revealed/under/deeper.md")],
      ["# Inside\n", "# Deeper\n"]);

    const made = state().folders.find((one) => one.name === "Revealed" && !one.parentId);
    check("...the folder was made at the top level", Boolean(made), true);
    check("...and it is open in the tree rather than collapsed",
      state().collapsedFolderIds.has(made.id), false);
    /* Opened *and* pointed at: the tree is scrolled to the new folder and its
     * row takes the focus, which is what makes twenty new documents findable
     * rather than somewhere in a list.
     */
    const row = [...doc.querySelectorAll(".tree-row-folder")]
      .find((one) => one.dataset.folderId === made.id);
    check("...with the tree pointed at it", doc.activeElement, row.querySelector(".tree-row-btn"));
  }

  console.log("=== a folder dropped inside another, and loose files ===");
  {
    const parent = await folderNamed("Parent Of Uploads");
    await run("window.__t.refreshDocs({ preserveSearch: true })");

    clearToasts();
    hand([fileNamed("nested.md", "# Nested\n", "Child/nested.md")]);
    await run(`window.__t.uploadFolder(window.__picked, ${JSON.stringify(parent.id)})`);
    await waitUntil(() => said().some((one) => /^Uploaded 1/.test(one)), 10000);
    check("a folder uploaded into another is made inside it",
      await onDisk("Parent Of Uploads/Child/nested.md"), "# Nested\n");

    /* A plain multi-file selection has no path on any of the files, which is
     * a perfectly good upload of loose files: the name is the path, and the
     * folder they are "from" is the file itself rather than a directory.
     */
    clearToasts();
    hand([fileNamed("loose-one.md", "# Loose one\n"),
      fileNamed("loose-two.md", "# Loose two\n")]);
    await run("window.__t.uploadFolder(window.__picked)");
    await waitUntil(() => said().some((one) => /^Uploaded 2/.test(one)), 10000);
    check("files chosen without a folder go in as they are",
      [await onDisk("loose-one.md"), await onDisk("loose-two.md")],
      ["# Loose one\n", "# Loose two\n"]);
  }

  for (const file of ["uploaded-alone.md", "Uploads Go Here/uploaded-filed.md",
    "Parent Of Uploads/Child/nested.md", "loose-one.md", "loose-two.md",
    "Revealed/inside.md", "Revealed/under/deeper.md"]) {
    await server.request("POST",
      `/api/docs/${file.split("/").map(encodeURIComponent).join("/")}/delete`,
      { mode: "soft" }, { Cookie: cookieHeader(), "X-CSRF-Token": csrf() });
  }
  await run("window.__t.refreshDocs({ preserveSearch: true })");
};
