/* Running notebook cells.
 *
 * The Python itself lives in pyodide-worker.js; this is the part that talks to
 * it and puts the output on the page.
 *
 * Two rules shape everything here:
 *
 *   Nothing runs on its own. A cell executes because someone pressed Run on
 *   it. A notebook is a document like any other in this library, and opening a
 *   document must never execute code that came with it.
 *
 *   The runtime is not downloaded until it is needed. Pyodide is about 10MB
 *   before a single package, which is not a cost to impose on someone opening
 *   a markdown file.
 */

(function (global) {
  "use strict";

  const WORKER_URL = "/js/pyodide-worker.js";

  const STATUS_LABELS = {
    downloading: "Downloading Python…",
    starting: "Starting Python…",
    packages: "Fetching packages…",
    running: "Running…",
    ready: "Python ready"
  };

  let worker = null;
  let nextRunId = 1;
  const pending = new Map();
  const statusListeners = new Set();

  function notifyStatus(state) {
    for (const listener of statusListeners) {
      try {
        listener(state);
      } catch (error) {
        console.error("Notebook status listener failed", error);
      }
    }
  }

  function ensureWorker() {
    if (worker) {
      return worker;
    }

    worker = new global.Worker(WORKER_URL);

    worker.addEventListener("message", (event) => {
      const message = event.data || {};

      if (message.type === "status") {
        notifyStatus({
          stage: message.stage,
          label: STATUS_LABELS[message.stage] || message.stage,
          id: message.id,
          error: message.error
        });
        return;
      }

      if (message.type === "result") {
        const resolve = pending.get(message.id);
        pending.delete(message.id);
        resolve?.(message);
        return;
      }

      if (message.type === "reset-done") {
        notifyStatus({ stage: "reset", label: "Kernel restarted" });
      }
    });

    worker.addEventListener("error", (event) => {
      // A worker that failed to start leaves every queued run hanging.
      for (const [, resolve] of pending) {
        resolve({ ok: false, stdout: [], stderr: [], error: `Python worker failed: ${event.message}` });
      }
      pending.clear();
      notifyStatus({ stage: "failed", label: "Python failed to start", error: event.message });
    });

    return worker;
  }

  function onStatus(listener) {
    statusListeners.add(listener);
    return () => statusListeners.delete(listener);
  }

  function runCell(notebookId, code) {
    const id = nextRunId++;
    const target = ensureWorker();

    return new Promise((resolve) => {
      pending.set(id, resolve);
      target.postMessage({ type: "run", id, notebookId, code });
    });
  }

  // Terminating is the only way out of a runaway loop: WASM cannot be
  // interrupted without SharedArrayBuffer, which needs COOP/COEP headers this
  // app does not set.
  function restart() {
    if (worker) {
      worker.terminate();
      worker = null;
    }

    for (const [, resolve] of pending) {
      resolve({ ok: false, stdout: [], stderr: [], error: "Kernel restarted before this cell finished." });
    }
    pending.clear();

    notifyStatus({ stage: "idle", label: "Kernel stopped" });
  }

  function resetNamespace(notebookId) {
    if (!worker) {
      return;
    }

    worker.postMessage({ type: "reset", notebookId });
  }

  function isBusy() {
    return pending.size > 0;
  }

  // Downloading ~10MB takes a while, so a deliberate "start it now" exists for
  // when someone knows they are about to run something.
  function preload() {
    ensureWorker().postMessage({ type: "preload" });
  }

  global.NotebookRuntime = {
    runCell,
    restart,
    resetNamespace,
    onStatus,
    isBusy,
    preload,
    get started() {
      return worker !== null;
    }
  };
})(window);
