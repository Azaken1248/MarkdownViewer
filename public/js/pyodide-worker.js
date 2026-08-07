/* Python for notebook cells, in a Web Worker.
 *
 * A worker, not the main thread, and the reason is containment rather than
 * responsiveness. Pyodide exposes the host JavaScript scope to Python through
 * `import js` — on the main thread that is `window`, which means a notebook
 * could reach the DOM, the session and everything else. In a worker `js` is
 * the worker's own global scope: no document, no window, no localStorage, and
 * nothing the app holds in memory.
 *
 * What Python can still do from here is issue same-origin fetches. It cannot
 * mutate anything through them: every write endpoint requires the CSRF token,
 * which lives on the main thread and is never sent in. And connect-src pins
 * outbound requests to this origin plus the CDN Pyodide loads itself from, so
 * there is no straightforward way to post data anywhere useful.
 *
 * Running it blocks this worker, not the page. There is no way to interrupt a
 * WASM loop without SharedArrayBuffer (which needs COOP/COEP headers the app
 * does not set), so an infinite loop is escaped by terminating the worker —
 * that is what "Restart" does.
 */

const PYODIDE_VERSION = "314.0.3";
const PYODIDE_INDEX = `https://cdn.jsdelivr.net/npm/pyodide@${PYODIDE_VERSION}/`;

// The loader is pinned to an exact version, but importScripts cannot carry an
// integrity attribute the way a <script> tag can, so this one asset is not
// SRI-checked. The 9.6MB WASM payload it then fetches is not checked either —
// that is inherent to how Pyodide ships, not something this app opted out of.
let pyodidePromise = null;

// One namespace per notebook, so cells in the same document share variables the
// way a real kernel does, and two open notebooks cannot collide.
const namespaces = new Map();

function post(message) {
  self.postMessage(message);
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

async function run({ id, notebookId, code }) {
  const stdout = [];
  const stderr = [];

  let pyodide;
  try {
    pyodide = await getPyodide();
  } catch (error) {
    post({ type: "result", id, ok: false, stdout: [], stderr: [], error: `Python could not start: ${error.message}` });
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
        result = repr(value);
      } catch {
        result = String(value);
      } finally {
        repr?.destroy?.();
      }
    }

    // PyProxy objects hold WASM memory that garbage collection will not
    // reclaim on its own.
    value?.destroy?.();

    post({ type: "result", id, ok: true, stdout, stderr, result });
  } catch (error) {
    // Pyodide puts the Python traceback in the message, which is what a person
    // debugging their cell actually wants to read.
    post({ type: "result", id, ok: false, stdout, stderr, error: String(error.message || error) });
  }
}

function reset(notebookId) {
  const namespace = namespaces.get(notebookId);
  namespace?.destroy?.();
  namespaces.delete(notebookId);
}

self.addEventListener("message", (event) => {
  const message = event.data || {};

  if (message.type === "run") {
    void run(message);
    return;
  }

  if (message.type === "reset") {
    reset(message.notebookId);
    post({ type: "reset-done", notebookId: message.notebookId });
    return;
  }

  if (message.type === "preload") {
    void getPyodide().catch((error) => {
      post({ type: "status", stage: "failed", error: String(error.message || error) });
    });
  }
});
