// Part of the DOM suite. See dom.test.js, which sets all this up and calls it.
//
// The folder dialog and the requests behind it, on the paths a person reaches
// by getting something wrong.
//
// One dialog does four jobs — create, rename, move, upload — and which one it
// is at any moment is in state. Nothing reached any of them: not the empty
// name, the rename with nothing selected, the name that collides, the picker
// in a mode where it must not be clickable or a move the server refuses, and
// not the four successes either. The tree checks drive folders by clicking
// rows; this dialog is the other way in, and it was the 28% in the coverage
// map.
module.exports = async (ctx) => {
  const { check, waitUntil, window, doc, server, cookieHeader } = ctx;

  const run = (source) => window.eval(source);
  const state = () => run("window.__t.state");
  const el = (id) => doc.getElementById(id);

  // What the app put on screen, loudest first. Errors go to the urgent stack.
  const toasts = () => [...doc.querySelectorAll("#toastStackUrgent .toast, #toastStack .toast")]
    .map((one) => one.querySelector(".toast-message")?.textContent || "");
  // Errors go to the assertive stack, so "it complained" is a different
  // question from "something appeared" — and a success toast is what a check
  // that only counted toasts would have accepted.
  const complaints = () => [...doc.querySelectorAll("#toastStackUrgent .toast")]
    .map((one) => one.querySelector(".toast-message")?.textContent || "");
  const cheers = () => [...doc.querySelectorAll("#toastStack .toast")]
    .map((one) => one.querySelector(".toast-message")?.textContent || "");
  const clearToasts = () => doc.querySelectorAll(".toast").forEach((one) => one.remove());

  /* Every request the app makes while something is being driven.
   *
   * Several of these checks are about a request that must not happen — a name
   * that is empty is refused here rather than sent — and "the server said no"
   * and "nothing was asked" look identical from the outside unless the asking
   * is counted.
   */
  const asked = [];
  const realFetch = window.fetch;
  let recording = true;
  window.fetch = (url, options) => {
    if (recording) {
      asked.push(`${String(options?.method || "GET").toUpperCase()} ${String(url)}`);
    }
    return realFetch(url, options);
  };
  const watching = (made) => {
    const from = asked.length;
    return made().then(() => asked.slice(from));
  };

  // Whatever the files before this one left behind. The session is the real
  // one again, which the checks that write need.
  await run("window.__t.refreshSession()");
  await run("window.__t.refreshDocs({ preserveSearch: false })");
  await waitUntil(() => state().folders.length > 0);
  clearToasts();

  const folderNamed = (name) => state().folders.find((one) => one.name === name);

  console.log("=== the folder dialog dresses itself for the job it is doing ===");
  {
    run('window.__t.openFolderModal({ mode: "create" })');
    check("creating: the plain title", el("folderTitle").textContent, "Create folder");
    check("...with no folder picker, because there is nothing to pick",
      [el("folderPicker").hidden, el("moveToRootBtn").hidden], [true, true]);
    check("...and an empty name", el("folderNameInput").value, "");
    run("window.__t.closeFolderModal()");

    const projects = folderNamed("Projects");
    run(`window.__t.openFolderModal({ mode: "create", parentId: ${JSON.stringify(projects.id)} })`);
    check("creating inside one says which", el("folderTitle").textContent, "New folder in Projects");
    run("window.__t.closeFolderModal()");

    run(`window.__t.openFolderModal({ mode: "rename", folderId: ${JSON.stringify(projects.id)} })`);
    check("renaming: the folder's own name in the title",
      el("folderTitle").textContent, "Rename Projects");
    check("...and in the box, so it is edited rather than retyped",
      el("folderNameInput").value, "Projects");
    run("window.__t.closeFolderModal()");

    const file = state().docs[0].file;
    run(`window.__t.openFolderModal({ mode: "move", file: ${JSON.stringify(file)} })`);
    check("moving: the picker is the point, so it is shown",
      [el("folderPicker").hidden, el("moveToRootBtn").hidden], [false, false]);
    check("...and the way out of every folder is offered",
      el("moveToRootBtn").textContent.trim(), "Move To Ungrouped");
    run("window.__t.closeFolderModal()");
  }

  console.log("=== the picker lists the tree, and is only clickable where it means something ===");
  {
    run('window.__t.openFolderModal({ mode: "create" })');
    const inCreate = [...doc.querySelectorAll("#folderPickerList .folder-choice")];
    check("in create mode every choice is disabled", inCreate.every((one) => one.disabled), true);
    check("(there are choices to disable)", inCreate.length > 0, true);
    run("window.__t.closeFolderModal()");

    run(`window.__t.openFolderModal({ mode: "move", file: ${JSON.stringify(state().docs[0].file)} })`);
    const inMove = [...doc.querySelectorAll("#folderPickerList .folder-choice")];
    check("in move mode they are not", inMove.some((one) => one.disabled), false);

    // Depth-first, so the list reads like the tree rather than like the table
    // it came out of: Projects, then what is inside Projects.
    const depths = inMove.map((one) => Number(one.style.getPropertyValue("--depth")));
    const names = inMove.map((one) => one.querySelector(".folder-choice-title").textContent.trim());
    check("a nested folder is indented under its parent",
      depths[names.indexOf("Cart")] > depths[names.indexOf("Projects")], true);
    check("...and its title is the whole path, for the two called the same thing",
      inMove[names.indexOf("Cart")].getAttribute("title"), "Projects / Cart");
    run("window.__t.closeFolderModal()");
  }

  console.log("=== a name that is not a name is refused here, not at the server ===");
  {
    clearToasts();
    run('window.__t.openFolderModal({ mode: "create" })');
    el("folderNameInput").value = "   ";

    const sent = await watching(() => run("window.__t.handleFolderModalAction()"));
    check("nothing is asked of the server", sent.filter((one) => one.includes("/api/folders")), []);
    check("...and it says what is missing", toasts()[0], "Folder name is required.");
    check("...and the dialog stays open to be corrected", state().folderModalOpen, true);
    run("window.__t.closeFolderModal()");
  }

  console.log("=== a rename with nothing selected is refused the same way ===");
  {
    clearToasts();
    run('window.__t.openFolderModal({ mode: "rename" })');
    el("folderNameInput").value = "Anything";

    const sent = await watching(() => run("window.__t.handleFolderModalAction()"));
    check("nothing is asked", sent.filter((one) => one.includes("/api/folders")), []);
    check("...and it says what to do first", toasts()[0], "Select a folder to rename.");
    run("window.__t.closeFolderModal()");
  }

  console.log("=== a name the server refuses leaves the dialog open ===");
  {
    clearToasts();
    run('window.__t.openFolderModal({ mode: "create" })');
    el("folderNameInput").value = "Projects";

    await run("window.__t.handleFolderModalAction()");
    await waitUntil(() => complaints().length > 0);

    check("the server's own words are what is shown", complaints()[0].length > 0, true);
    /* Open, because a dialog that closes on a refusal throws away what was
     * typed and the reason it was refused in the same movement. Everything
     * here closes on success only.
     */
    check("the dialog is still open", state().folderModalOpen, true);
    check("...still holding what was typed", el("folderNameInput").value, "Projects");
    run("window.__t.closeFolderModal()");
  }

  console.log("=== and so does a rename onto a name already taken ===");
  {
    clearToasts();
    const notes = folderNamed("Notes");
    run(`window.__t.openFolderModal({ mode: "rename", folderId: ${JSON.stringify(notes.id)} })`);
    el("folderNameInput").value = "Projects";

    await run("window.__t.handleFolderModalAction()");
    await waitUntil(() => complaints().length > 0);

    check("it is refused", complaints()[0].length > 0, true);
    check("...and Notes is still called Notes", folderNamed("Notes")?.id, notes.id);
    check("...with the dialog open", state().folderModalOpen, true);
    run("window.__t.closeFolderModal()");
  }

  console.log("=== and the three things it is asked to do, when they work ===");
  {
    clearToasts();
    run('window.__t.openFolderModal({ mode: "create" })');
    el("folderNameInput").value = "Correspondence";
    await run("window.__t.handleFolderModalAction()");
    await waitUntil(() => Boolean(folderNamed("Correspondence")));

    check("a folder is created", Boolean(folderNamed("Correspondence")), true);
    check("...and the dialog closes behind it", state().folderModalOpen, false);
    check("...with a word saying so",
      cheers().some((one) => one.includes("Correspondence")), true);

    // Nested, because the message is different and says where it went.
    clearToasts();
    const parent = folderNamed("Correspondence");
    run(`window.__t.openFolderModal({ mode: "create", parentId: ${JSON.stringify(parent.id)} })`);
    el("folderNameInput").value = "Sent";
    await run("window.__t.handleFolderModalAction()");
    await waitUntil(() => Boolean(folderNamed("Sent")));
    check("one inside another says which one",
      cheers().some((one) => one.includes("Correspondence")), true);

    clearToasts();
    run(`window.__t.openFolderModal({ mode: "rename", folderId: ${JSON.stringify(parent.id)} })`);
    el("folderNameInput").value = "Letters";
    await run("window.__t.handleFolderModalAction()");
    await waitUntil(() => Boolean(folderNamed("Letters")));

    check("a rename takes", Boolean(folderNamed("Letters")), true);
    check("...and the old name is gone rather than kept beside it",
      Boolean(folderNamed("Correspondence")), false);
    check("...and it is the same folder, not a new one", folderNamed("Letters").id, parent.id);
    check("...with the dialog closed", state().folderModalOpen, false);

    /* Create and move in one go, which is the whole reason this dialog has a
     * name field as well as a picker: somewhere to put this that does not
     * exist yet.
     */
    clearToasts();
    const wanderer = state().docs.find((one) => one.file.endsWith(".md"));
    run(`window.__t.openFolderModal({ mode: "move", file: ${JSON.stringify(wanderer.file)} })`);
    el("folderNameInput").value = "Somewhere New";
    await run("window.__t.handleFolderModalAction()");
    await waitUntil(() => Boolean(folderNamed("Somewhere New")));

    const made = folderNamed("Somewhere New");
    const landed = state().docs.find((one) => one.file.endsWith(wanderer.file.split("/").pop()));
    check("the folder is made", Boolean(made), true);
    check("...and the document is in it", landed.folderId, made.id);
    check("...and the dialog is done with", state().folderModalOpen, false);
  }

  console.log("=== abandoning an upload lets go of the file it was holding ===");
  {
    run(`window.__t.state.pendingUploadFile = { name: "notes.md" }`);
    run('window.__t.openFolderModal({ mode: "upload" })');
    check("the dialog says which file it is about",
      el("folderTitle").textContent, "Upload notes.md");

    run("window.__t.closeFolderModal()");
    /* The <input type=file> has to be cleared as well as the state.
     *
     * A browser does not fire `change` for the same file twice, so a file
     * chosen, abandoned and chosen again would silently do nothing with the
     * input still holding it.
     */
    check("closing drops the file", state().pendingUploadFile, null);
    check("...and empties the input that was holding it", el("uploadInput").value, "");
  }

  console.log("=== a move the server refuses says so and keeps the dialog ===");
  {
    clearToasts();
    const doomed = state().docs[0].file;
    run(`window.__t.openFolderModal({ mode: "move", file: ${JSON.stringify(doomed)} })`);

    // Refused by the server, not by the harness: the file is gone by the time
    // the picker is clicked, which is the race this path exists for.
    const csrf = state().csrfToken;
    // Each segment encoded but the slashes kept, which is the shape the route
    // matches — the whole path as one component is a 400.
    const asUrl = doomed.split("/").map(encodeURIComponent).join("/");
    const gone = await server.request("POST", `/api/docs/${asUrl}/delete`,
      { mode: "soft" }, { Cookie: cookieHeader(), "X-CSRF-Token": csrf });
    check("(the document is in the bin before the picker is clicked)", gone.status, 200);

    const choice = doc.querySelector("#folderPickerList .folder-choice");
    choice.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitUntil(() => complaints().length > 0);

    check("the refusal reaches the screen", complaints()[0].length > 0, true);
    check("...and the dialog is still there", state().folderModalOpen, true);
    run("window.__t.closeFolderModal()");

    // Put it back, because everything after this reads the library.
    await server.request("POST", `/api/recycle-bin/${asUrl}/restore`,
      {}, { Cookie: cookieHeader(), "X-CSRF-Token": csrf });
    await run("window.__t.refreshDocs({ preserveSearch: false })");
  }

  console.log("=== moving the document being read follows it; moving another does not ===");
  {
    clearToasts();
    const moving = state().docs.find((one) => !one.folderId) || state().docs[0];
    const destination = folderNamed("Notes");

    await run(`window.__t.openDocument(${JSON.stringify(moving.file)}, false)`);
    await waitUntil(() => state().activeFile === moving.file);

    const landed = await run(`window.__t.moveDocumentToFolder(${JSON.stringify(moving.file)}, `
      + `${JSON.stringify(destination.id)})`);
    check("the document that moved is the one still open", state().activeFile, landed.file);
    check("...and it is where it was sent", landed.folderName, "Notes");

    // And one that is not open: what is open must not change underneath.
    const other = state().docs.find((one) => one.file !== state().activeFile);
    const openBefore = state().activeFile;
    await run(`window.__t.moveDocumentToFolder(${JSON.stringify(other.file)}, null)`);
    check("moving something else leaves the reader where they were",
      state().activeFile, openBefore);
  }

  // Left in place rather than put back: it delegates, so the only thing
  // unhooking it would change is which array the next file's requests land in.
  recording = false;
};
