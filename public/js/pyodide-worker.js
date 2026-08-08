/* Python for notebook cells, in a Web Worker.
 *
 * A worker, not the main thread, and the reason is containment rather than
 * responsiveness. Pyodide exposes the host JavaScript scope to Python through
 * `import js` — on the main thread that is `window`, which means a notebook
 * could reach the DOM, the session and everything else. In a worker `js` is
 * the worker's own global scope: no document, no window, no localStorage, and
 * nothing the app holds.
 *
 * On top of that, once Pyodide has finished loading, this worker takes its own
 * network away (see installNetworkGuard). Without that, `import js` plus
 * js.fetch would let a notebook read every document in the library with the
 * reader's cookies attached.
 *
 * Runs are serialised. Pyodide's stdout handler belongs to the interpreter, not
 * to a call, so two overlapping runs would capture each other's output — and
 * they did: a cell that awaited lost its entire output to whichever cell was
 * started next.
 *
 * There is no way to interrupt a WASM loop without SharedArrayBuffer (which
 * needs COOP/COEP headers the app does not set), so an infinite loop is escaped
 * by terminating the worker — that is what "Restart" does.
 */

const PYODIDE_VERSION = "314.0.3";
const PYODIDE_ORIGIN = "https://cdn.jsdelivr.net";
const PYODIDE_INDEX = `${PYODIDE_ORIGIN}/npm/pyodide@${PYODIDE_VERSION}/`;

// Enough for real output, small enough that one runaway print loop cannot build
// a string that freezes the page when it is rendered.
const MAX_STREAM_CHARS = 200000;
const MAX_RESULT_CHARS = 20000;

// The loader is pinned to an exact version, but importScripts cannot carry an
// integrity attribute the way a <script> tag can, so this one asset is not
// SRI-checked. The 9.6MB WASM payload it then fetches is not checked either —
// that is inherent to how Pyodide ships, not something this app opted out of.
let pyodidePromise = null;

// One namespace per notebook, so cells in the same document share variables the
// way a real kernel does, and two open notebooks cannot collide.
const namespaces = new Map();

// Runs execute one at a time; see the header.
let queue = Promise.resolve();

function post(message) {
  self.postMessage(message);
}

/* Takes the network away from notebook code.
 *
 * Installed after Pyodide has loaded, so its own startup is unaffected, and it
 * still permits the CDN because `loadPackagesFromImports` fetches wheels from
 * there on demand. Everything else — this origin above all — is refused.
 *
 * Without this, `import js; js.fetch("/api/docs")` reads the whole library,
 * with the reader's session cookie attached. It could not *change* anything
 * (writes need the CSRF token, which never enters this worker), but reading was
 * enough to matter.
 */
function installNetworkGuard() {
  const realFetch = self.fetch.bind(self);
  const blocked = () => new TypeError(
    "Network access is not available to notebook code."
  );

  self.fetch = (input, init) => {
    let href = "";
    try {
      href = new URL(typeof input === "string" ? input : input?.url || "", self.location.href).href;
    } catch {
      return Promise.reject(blocked());
    }

    if (!href.startsWith(`${PYODIDE_ORIGIN}/`)) {
      return Promise.reject(blocked());
    }

    return realFetch(input, init);
  };

  // XHR predates fetch and would otherwise be an open side door. Same for the
  // streaming transports, and for importScripts, which would pull in more code.
  for (const name of ["XMLHttpRequest", "WebSocket", "EventSource"]) {
    if (name in self) {
      self[name] = function BlockedTransport() {
        throw blocked();
      };
    }
  }

  self.importScripts = () => {
    throw blocked();
  };
}

async function getPyodide() {
  if (pyodidePromise) {
    return pyodidePromise;
  }

  pyodidePromise = (async () => {
    post({ type: "status", stage: "downloading" });
    self.importScripts(`${PYODIDE_INDEX}pyodide.js`);

    post({ type: "status", stage: "starting" });
    const pyodide = await self.loadPyodide({ indexURL: PYODIDE_INDEX });

    // Only now: Pyodide needed the real network to get here.
    installNetworkGuard();

    post({ type: "status", stage: "ready", version: pyodide.version });
    return pyodide;
  })();

  return pyodidePromise;
}

function namespaceFor(pyodide, notebookId) {
  if (!namespaces.has(notebookId)) {
    const namespace = pyodide.globals.get("dict")();
    // __name__ is what makes `if __name__ == "__main__":` behave the way it
    // does in a notebook.
    namespace.set("__name__", "__main__");
    namespaces.set(notebookId, namespace);
  }

  return namespaces.get(notebookId);
}

// Collects a stream, stops growing at the cap, and says so once.
function makeSink(limit) {
  const lines = [];
  let length = 0;
  let truncated = false;

  return {
    push(line) {
      if (truncated) {
        return;
      }

      const text = String(line);
      if (length + text.length > limit) {
        lines.push(text.slice(0, Math.max(0, limit - length)));
        lines.push(`… output truncated at ${limit.toLocaleString()} characters.`);
        truncated = true;
        return;
      }

      lines.push(text);
      length += text.length;
    },
    get value() {
      return lines;
    }
  };
}

async function execute({ id, notebookId, code }) {
  const stdout = makeSink(MAX_STREAM_CHARS);
  const stderr = makeSink(MAX_STREAM_CHARS);

  let pyodide;
  try {
    pyodide = await getPyodide();
  } catch (error) {
    post({
      type: "result",
      id,
      ok: false,
      stdout: [],
      stderr: [],
      error: `Python could not start: ${error.message}`
    });
    return;
  }

  pyodide.setStdout({ batched: (line) => stdout.push(line) });
  pyodide.setStderr({ batched: (line) => stderr.push(line) });

  try {
    // Installs numpy, pandas and friends on demand, straight from the CDN, the
    // first time a cell imports them.
    post({ type: "status", stage: "packages", id });
    await pyodide.loadPackagesFromImports(code, {
      messageCallback: () => {},
      errorCallback: (message) => stderr.push(String(message))
    });
  } catch (error) {
    // A missing package is the cell's problem to report, not a reason to
    // refuse to run it — the import will raise and show a normal traceback.
    stderr.push(`Could not preload packages: ${error.message}`);
  }

  post({ type: "status", stage: "running", id });

  try {
    const namespace = namespaceFor(pyodide, notebookId);
    const value = await pyodide.runPythonAsync(code, { globals: namespace });

    let result = null;
    if (value !== undefined && value !== null) {
      // repr, not str: this is the value echoed by the last expression, and a
      // notebook shows it the way the REPL would.
      const repr = pyodide.globals.get("repr");
      try {
        result = String(repr(value));
      } catch {
        result = String(value);
      } finally {
        repr?.destroy?.();
      }

      if (result.length > MAX_RESULT_CHARS) {
        result = `${result.slice(0, MAX_RESULT_CHARS)}… (truncated)`;
      }
    }

    // PyProxy objects hold WASM memory that garbage collection will not
    // reclaim on its own.
    value?.destroy?.();

    post({ type: "result", id, ok: true, stdout: stdout.value, stderr: stderr.value, result });
  } catch (error) {
    // Pyodide puts the Python traceback in the message, which is what a person
    // debugging their cell actually wants to read.
    post({
      type: "result",
      id,
      ok: false,
      stdout: stdout.value,
      stderr: stderr.value,
      error: String(error?.message || error)
    });
  } finally {
    // Leaving a dead closure installed would send a later cell's output into
    // this run's arrays.
    pyodide.setStdout({});
    pyodide.setStderr({});
  }
}

function enqueue(message) {
  // Chained rather than parallel. Failures are already reported inside
  // execute(), so the chain itself must never reject and stall the queue.
  queue = queue.then(() => execute(message)).catch((error) => {
    post({
      type: "result",
      id: message.id,
      ok: false,
      stdout: [],
      stderr: [],
      error: String(error?.message || error)
    });
  });

  return queue;
}

function reset(notebookId) {
  const namespace = namespaces.get(notebookId);
  namespace?.destroy?.();
  namespaces.delete(notebookId);
}

self.addEventListener("message", (event) => {
  const message = event.data || {};

  if (message.type === "run") {
    void enqueue(message);
    return;
  }

  if (message.type === "reset") {
    // Behind the queue too, or it would clear a namespace mid-run.
    queue = queue.then(() => {
      reset(message.notebookId);
      post({ type: "reset-done", notebookId: message.notebookId });
    });
    return;
  }

  if (message.type === "preload") {
    void getPyodide().catch((error) => {
      post({ type: "status", stage: "failed", error: String(error?.message || error) });
    });
  }
});
