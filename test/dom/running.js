// Part of the DOM suite. See dom.test.js, which sets all this up and calls it.
//
// Running a notebook cell: the Run button, the worker it talks to, and the
// output area under the cell.
//
// The Python itself is covered to the line by the `worker` suite, which runs
// pyodide-worker.js in a vm. This is the other side of that conversation, and
// two rules shape all of it. Nothing runs on its own: a cell executes because
// somebody pressed Run on it, and opening a notebook must never execute code
// that came with the document. And the runtime is not downloaded until it is
// needed, which is why the worker is only built on the first run.
//
// jsdom has no Worker, so there is one here: it writes down what it was sent
// and lets the test answer.
module.exports = async (ctx) => {
  const { check, waitUntil, window, doc, server, cookieHeader, consoleErrors } = ctx;

  const run = (source) => window.eval(source);
  const state = () => run("window.__t.state");
  const el = (id) => doc.getElementById(id);

  const said = () => [...doc.querySelectorAll("#toastStack .toast, #toastStackUrgent .toast")]
    .map((one) => one.querySelector(".toast-message")?.textContent || "");
  const saidThat = (text) => said().some((one) => one.includes(text));
  const clearToasts = () => doc.querySelectorAll(".toast").forEach((one) => one.remove());

  /* --- the worker jsdom has not got -------------------------------------- */

  const built = [];
  /** @type {any[]} */
  const workers = [];

  class FakeWorker {
    constructor(url) {
      this.url = url;
      this.sent = [];
      this.alive = true;
      this.listeners = { message: [], error: [] };
      built.push(url);
      workers.push(this);
    }

    addEventListener(type, listener) {
      this.listeners[type]?.push(listener);
    }

    postMessage(message) {
      this.sent.push(message);
    }

    terminate() {
      this.alive = false;
    }

    // What the worker would send back, from the test's side.
    answer(message) {
      for (const listener of this.listeners.message) {
        listener({ data: message });
      }
    }

    fail(message) {
      for (const listener of this.listeners.error) {
        listener({ message });
      }
    }
  }

  Object.assign(window, { Worker: FakeWorker });
  const latest = () => workers[workers.length - 1];

  // The slow-cell timer is twenty seconds, which is not a wait worth having in
  // a suite: it is captured and fired by hand.
  const slowTimers = [];
  const realTimeout = window.setTimeout;
  Object.assign(window, {
    setTimeout: (fn, ms) => {
      if (ms === 20000) {
        slowTimers.push(fn);
        return slowTimers.length;
      }

      return realTimeout(fn, ms);
    }
  });

  /* --- a notebook to run ------------------------------------------------- */

  const notebook = JSON.stringify({
    cells: [
      { cell_type: "markdown", source: "# Sums\n" },
      { cell_type: "code", source: "print(1 + 1)\n", outputs: [] },
      { cell_type: "code", source: "1 / 0\n", outputs: [] }
    ],
    metadata: { language_info: { name: "python" } }
  });

  run("MarkdownCore.configure({ executableNotebooks: true })");
  await server.request("POST", "/api/docs",
    { fileName: "sums.ipynb", overwrite: true, content: notebook },
    { Cookie: cookieHeader(), "X-CSRF-Token": state().csrfToken });
  await run("window.__t.refreshDocs({ preserveSearch: true })");
  await run('window.__t.openDocument("sums.ipynb", true)');
  await waitUntil(() => state().activeFile === "sums.ipynb");

  const buttons = () => [...el("docContent").querySelectorAll(".notebook-run")];
  const outputFor = (cell) => el("docContent")
    .querySelector(`.notebook-live-output[data-cell="${cell}"]`);
  const press = (node) => node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  // Put back after the section that replaces it, below.
  run("window.__realRunCell = NotebookRuntime.runCell");

  console.log("=== opening a notebook runs nothing ===");
  {
    check("the notebook is on screen", buttons().length, 2);
    /* Which is the whole rule: a document in a library must never execute code
     * that came with it, so the worker does not even exist yet — and that is
     * also the ten megabytes nobody opening a markdown file should pay for.
     */
    check("...and no worker has been started", built, []);
    check("...with nothing under the cells", outputFor(2).hidden, true);
  }

  console.log("=== and pressing Run on one runs that one ===");
  {
    press(buttons()[0]);
    check("pressing Run starts the worker", built, ["/js/pyodide-worker.js"]);
    check("...and sends it the cell's own source",
      [latest().sent[0].type, latest().sent[0].code], ["run", "print(1 + 1)\n"]);
    /* Keyed by the document, so cells in one notebook share variables and two
     * notebooks open at once do not collide.
     */
    check("...keyed by the notebook it belongs to", latest().sent[0].notebookId, "sums.ipynb");
    check("the cell says it is working",
      outputFor(2).textContent.includes("Working"), true);
    check("...and the button cannot be pressed again while it is",
      buttons()[0].disabled, true);

    latest().answer({ type: "result", id: latest().sent[0].id, ok: true,
      stdout: ["2"], stderr: [], result: "" });
    await waitUntil(() => !buttons()[0].disabled);

    check("what it printed goes under the cell",
      outputFor(2).querySelector(".notebook-run-stream").textContent, "2");
    check("...and the button comes back", buttons()[0].disabled, false);
    check("...with the kernel saying it is ready",
      el("kernelStatus").textContent, "Python ready");
  }

  console.log("=== a cell that fails says so, under the cell and in a toast ===");
  {
    clearToasts();
    press(buttons()[1]);
    const sent = latest().sent[latest().sent.length - 1];
    latest().answer({ type: "result", id: sent.id, ok: false,
      stdout: [], stderr: ["Traceback..."], error: "ZeroDivisionError: division by zero" });
    await waitUntil(() => !buttons()[1].disabled);

    check("the error goes under the cell",
      outputFor(3).querySelector(".notebook-run-error").textContent,
      "ZeroDivisionError: division by zero");
    check("...with whatever was on stderr",
      outputFor(3).querySelector(".is-stderr")?.textContent ?? "", "Traceback...");
    // And a toast, because the output area may be below the fold.
    check("...and the reader is told which cell it was", saidThat("Cell 3 failed."), true);
  }

  console.log("=== and one that printed nothing says that rather than nothing ===");
  {
    press(buttons()[0]);
    let sent = latest().sent[latest().sent.length - 1];
    latest().answer({ type: "result", id: sent.id, ok: true, stdout: [], stderr: [], result: "" });
    await waitUntil(() => !buttons()[0].disabled);
    check("a cell that ran and printed nothing says so",
      outputFor(2).querySelector(".notebook-run-empty").textContent, "Ran with no output.");

    press(buttons()[0]);
    sent = latest().sent[latest().sent.length - 1];
    latest().answer({ type: "result", id: sent.id, ok: false, stdout: [], stderr: [] });
    await waitUntil(() => !buttons()[0].disabled);
    check("...and one that failed with nothing to say says that",
      outputFor(2).querySelector(".notebook-run-empty").textContent, "Failed with no output.");

    // A value rather than printed output is shown as the value it is.
    press(buttons()[0]);
    sent = latest().sent[latest().sent.length - 1];
    latest().answer({ type: "result", id: sent.id, ok: true, stdout: [], stderr: [], result: "42" });
    await waitUntil(() => !buttons()[0].disabled);
    check("a cell whose value is the answer shows the value",
      outputFor(2).querySelector(".notebook-run-value").textContent, "42");
  }

  console.log("=== a cell that is taking a while is told so, not killed ===");
  {
    /* Not a kill: a real computation can legitimately take a while, and
     * terminating somebody's work because it was slow would be worse than the
     * silence. The cell is told it is still going and that Restart is the way
     * out.
     */
    slowTimers.splice(0);
    press(buttons()[0]);
    check("a run arms a timer rather than a deadline", slowTimers.length, 1);

    slowTimers[0]();
    check("...and once it fires the cell says it is still going",
      outputFor(2).textContent.includes("Still running"), true);
    check("...and says what to do about it",
      outputFor(2).textContent.includes("Restart Python"), true);
    check("...while the cell is still running", buttons()[0].disabled, true);

    const sent = latest().sent[latest().sent.length - 1];
    latest().answer({ type: "result", id: sent.id, ok: true, stdout: ["done"], stderr: [] });
    await waitUntil(() => !buttons()[0].disabled);
    check("...and it still finishes when it finishes",
      outputFor(2).querySelector(".notebook-run-stream").textContent, "done");
  }

  console.log("=== the kernel's own progress, as the worker reports it ===");
  {
    for (const [stage, label] of [
      ["downloading", "Downloading Python…"],
      ["starting", "Starting Python…"],
      ["packages", "Fetching packages…"],
      ["running", "Running…"],
      ["ready", "Python ready"]
    ]) {
      latest().answer({ type: "status", stage });
      check(`the bar says "${label}" while ${stage}`, el("kernelStatus").textContent, label);
    }

    // A stage nothing has a sentence for is shown as itself rather than as
    // nothing: a new one added to the worker is still visible.
    latest().answer({ type: "status", stage: "compiling" });
    check("...and a stage with no words of its own is shown as itself",
      el("kernelStatus").textContent, "compiling");

    // Only "ready" and "idle" are not busy; everything else is.
    latest().answer({ type: "status", stage: "ready" });
    check("the bar stops saying it is busy once it is ready",
      el("kernelStatus").classList.contains("is-busy"), false);
    latest().answer({ type: "status", stage: "running" });
    check("...and says so while it is", el("kernelStatus").classList.contains("is-busy"), true);

    // And the kernel bar itself is only shown once there is a kernel.
    check("the kernel bar is shown now there is one", el("kernelBar").hidden, false);
  }

  console.log("=== restarting it, which is the only way out of a runaway cell ===");
  {
    /* Terminating is the only way out: WASM cannot be interrupted without
     * SharedArrayBuffer, which needs headers this app does not set.
     */
    clearToasts();
    press(buttons()[0]);
    const before = latest();
    check("a cell is running", before.sent.length > 0, true);

    press(el("restartKernelBtn"));
    await waitUntil(() => !buttons()[0].disabled);

    check("restarting terminates the worker", before.alive, false);
    /* And the cell that was in flight is told why, rather than being left
     * saying "Working…" with nothing coming.
     */
    check("...and the cell that was running is told why",
      outputFor(2).textContent.includes("Kernel restarted before this cell finished"), true);
    check("...with the reader told the next Run starts a fresh one",
      saidThat("The next Run starts a fresh one"), true);
    // The bar goes away with the kernel: it is only shown while there is one.
    check("...and the bar goes away with the kernel", el("kernelBar").hidden, true);

    // The next run builds another one, which is what "fresh" means.
    const count = built.length;
    press(buttons()[0]);
    check("the next Run starts a new worker", built.length, count + 1);
    const sent = latest().sent[latest().sent.length - 1];
    latest().answer({ type: "result", id: sent.id, ok: true, stdout: ["again"], stderr: [] });
    await waitUntil(() => !buttons()[0].disabled);
    check("...which runs the cell", outputFor(2).textContent.includes("again"), true);
  }

  console.log("=== a worker that will not start at all ===");
  {
    /* Every queued run would otherwise hang forever. There is no answer
     * coming, so the runs are answered here.
     */
    press(buttons()[0]);
    latest().fail("SyntaxError in pyodide-worker.js");
    await waitUntil(() => !buttons()[0].disabled);

    check("a worker that fails to start does not leave the cell hanging",
      (outputFor(2).querySelector(".notebook-run-error")?.textContent ?? "")
        .includes("Python worker failed"), true);
    /* Which is where it has to be said. The bar is told too, but the run's own
     * finally runs after that and puts "Python ready" back — so the cell is
     * the only place the reader is sure to see it.
     */
    check("...naming the worker rather than blaming the cell",
      (outputFor(2).querySelector(".notebook-run-error")?.textContent ?? "")
        .includes("SyntaxError in pyodide-worker.js"), true);
  }

  console.log("=== and the reader who moves on mid-run ===");
  {
    /* Switching away replaces the whole article, so the output area the run
     * was started against is no longer on the page. Writing into it would put
     * one notebook's output under another's cell.
     */
    await server.request("POST", "/api/docs",
      { fileName: "elsewhere-notebook.md", overwrite: true, content: "# Elsewhere\n" },
      { Cookie: cookieHeader(), "X-CSRF-Token": state().csrfToken });
    await run("window.__t.refreshDocs({ preserveSearch: true })");

    press(buttons()[0]);
    const sent = latest().sent[latest().sent.length - 1];
    const abandoned = outputFor(2);

    await run('window.__t.openDocument("elsewhere-notebook.md", true)');
    await waitUntil(() => state().activeFile === "elsewhere-notebook.md");

    latest().answer({ type: "result", id: sent.id, ok: true, stdout: ["late"], stderr: [] });
    await new Promise((done) => realTimeout(done, 50));

    check("output for a notebook the reader has left is dropped",
      abandoned.textContent.includes("late"), false);
    check("...and the document they are on now is untouched",
      el("docContent").textContent.includes("late"), false);
  }

  console.log("=== and the two things a page can ask of the runtime directly ===");
  {
    await run('window.__t.openDocument("sums.ipynb", true)');
    await waitUntil(() => state().activeFile === "sums.ipynb");

    /* Downloading ten megabytes takes a while, so there is a deliberate "start
     * it now" for a page that knows a run is coming.
     */
    run("NotebookRuntime.restart()");
    const count = built.length;
    run("NotebookRuntime.preload()");
    check("preloading starts the worker before anything is run",
      [built.length, latest().sent[0].type], [count + 1, "preload"]);

    // Resetting the namespace is a message, not a restart: the worker stays.
    run('NotebookRuntime.resetNamespace("sums.ipynb")');
    check("resetting a notebook's namespace asks the worker to",
      latest().sent[latest().sent.length - 1],
      { type: "reset", notebookId: "sums.ipynb" });
    latest().answer({ type: "reset-done" });
    check("...and the worker saying it is done is shown",
      el("kernelStatus").textContent, "Kernel restarted");

    // With no worker there is nothing to reset, and asking is not an error.
    run("NotebookRuntime.restart()");
    const idle = built.length;
    run('NotebookRuntime.resetNamespace("sums.ipynb")');
    check("...while with no kernel there is nothing to reset", built.length, idle);
    check("...and the runtime says it has not started",
      run("NotebookRuntime.started"), false);
  }

  console.log("=== and the four things that can go wrong around the edges ===");
  {
    /* A listener that throws must not stop the others hearing. Status goes to
     * everything that asked, and one bad listener taking the rest down would
     * leave the bar stuck on whatever it last said.
     */
    const heard = [];
    run("NotebookRuntime.preload()");
    const stop = run(`NotebookRuntime.onStatus(() => { throw new Error("listener fell over"); })`);
    run(`window.__heard = []; NotebookRuntime.onStatus((s) => window.__heard.push(s.stage));`);
    latest().answer({ type: "status", stage: "ready" });
    heard.push(...run("window.__heard"));
    check("a status listener that throws does not stop the others hearing",
      heard, ["ready"]);
    run("(" + String(stop) + ")");

    /* The slow-cell callback is the caller's, so it is the caller's to get
     * wrong — and a run must not fail because the thing that was going to say
     * "still running" threw.
     */
    slowTimers.splice(0);
    const running = run(`NotebookRuntime.runCell("x.ipynb", "1", {
      onSlow: () => { throw new Error("callback fell over"); } })`);
    slowTimers[0]();
    const sent = latest().sent[latest().sent.length - 1];
    latest().answer({ type: "result", id: sent.id, ok: true, stdout: ["still fine"], stderr: [] });
    check("a slow-cell callback that throws does not fail the run",
      (await running).stdout, ["still fine"]);

    /* A Run button for a cell whose source is not there. The source is kept
     * per notebook as it is rendered, so this is what a button left over from
     * another document looks like.
     */
    const stray = doc.createElement("button");
    stray.className = "notebook-run";
    stray.dataset.cell = "99";
    el("docContent").appendChild(stray);
    const before = latest().sent.length;
    press(stray);
    check("a Run button with no source behind it runs nothing",
      latest().sent.length, before);
    stray.remove();

    /* And the run itself refusing to start, which is different from a cell
     * that failed: there is no result to render, so the error is rendered
     * instead.
     */
    /* Both of those are written down rather than swallowed: a listener or a
     * callback that throws is somebody's bug, and the page carrying on without
     * saying so is how it stays one.
     */
    check("...and both of them are written down",
      ["Notebook status listener failed", "Slow-cell callback failed"]
        .every((said) => consoleErrors.some((one) => one.includes(said))), true);

    // Taken off the list the last check in this suite reads, since they were
    // asked for here.
    for (const said of ["Notebook status listener failed", "Slow-cell callback failed"]) {
      const at = consoleErrors.findIndex((one) => one.includes(said));
      consoleErrors.splice(at, 1);
    }

    const realRun = run("NotebookRuntime.runCell");
    run(`NotebookRuntime.runCell = () => { throw new Error("no kernel to run in"); }`);
    press(buttons()[0]);
    await waitUntil(() => !buttons()[0].disabled);
    check("a run that cannot start says so under the cell",
      outputFor(2).querySelector(".notebook-run-error")?.textContent ?? "",
      "no kernel to run in");
    run("NotebookRuntime.runCell = window.__realRunCell");
    void realRun;
  }

  Object.assign(window, { setTimeout: realTimeout });
  run("MarkdownCore.configure({ executableNotebooks: false })");
};
