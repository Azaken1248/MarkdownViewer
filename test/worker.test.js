/* The Python worker, executed.
 *
 * `public/js/pyodide-worker.js` is the only place this app runs code somebody
 * else wrote, and until this suite it was the only file nothing had ever
 * opened: 291 lines at nought per cent, because jsdom has no Web Worker and
 * every client suite is jsdom.
 *
 * It does not need one. What the worker does with a message is a function of
 * the message — it reads `self`, `postMessage`, `importScripts` and
 * `loadPyodide`, all of which can be handed to it — so the protocol, both
 * output caps, the error paths, the queue and the network guard are all
 * reachable in a `vm` with no browser and no twelve megabyte download. The
 * same technique `headers.test.js` uses to load `dom-html.js`.
 *
 * What that cannot say is whether Pyodide runs. That is one check in the
 * browser suite, where a real worker loads the real thing and prints, because
 * "the fake agrees with the protocol" and "Python works" are different claims.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { pathToFileURL } = require("url");
const { createChecker } = require("./helpers/check.js");

const { check, finish } = createChecker("WORKER");

const WORKER_PATH = path.join(__dirname, "..", "public", "js", "pyodide-worker.js");

/* The sourceURL is what makes this file's coverage count.
 *
 * V8 attributes what ran to the URL the script was compiled under, and a `vm`
 * script has none — c8 then drops it and the file reads 0% however much of it
 * executed, which is the state this suite exists to end. `app-source.js` does
 * the same thing for the scripts it evaluates in jsdom, for the same reason.
 */
const SOURCE = `${fs.readFileSync(WORKER_PATH, "utf8")}\n//# sourceURL=${pathToFileURL(WORKER_PATH).href}`;

/* A Pyodide that answers, and nothing more.
 *
 * Enough of one that the worker's own code runs: a globals table that hands
 * back `dict` and `repr`, stdout and stderr handlers it can install, and a
 * runPythonAsync whose behaviour each check decides. Everything it is asked
 * is recorded, because several of the checks below are about what the worker
 * does to Pyodide rather than what it sends back.
 */
function fakePyodide(behaviour = {}) {
  const log = { stdout: [], stderr: [], cleared: 0, destroyed: 0, namespaces: 0 };
  let sinks = {};

  const namespace = () => {
    log.namespaces += 1;
    return {
      entries: new Map(),
      set(key, value) {
        this.entries.set(key, value);
      },
      destroy() {
        log.destroyed += 1;
      }
    };
  };

  const pyodide = {
    version: "0.0.0-fake",
    log,
    globals: {
      get(name) {
        if (name === "dict") {
          return namespace;
        }

        if (name === "repr") {
          const repr = (value) => (behaviour.repr ? behaviour.repr(value) : `repr(${value})`);
          repr.destroy = () => {};
          return repr;
        }

        return undefined;
      }
    },
    setStdout(handler) {
      if (!handler.batched) {
        log.cleared += 1;
      }

      sinks.out = handler.batched;
    },
    setStderr(handler) {
      sinks.err = handler.batched;
    },
    async loadPackagesFromImports(code, options) {
      if (behaviour.packages) {
        await behaviour.packages(options);
      }
    },
    async runPythonAsync() {
      // What a cell prints, pushed through the handlers the worker installed.
      for (const line of behaviour.prints || []) {
        sinks.out?.(line);
      }

      for (const line of behaviour.warns || []) {
        sinks.err?.(line);
      }

      if (behaviour.raises) {
        throw behaviour.raises;
      }

      return behaviour.returns === undefined ? undefined : behaviour.returns;
    }
  };

  sinks = {};
  return pyodide;
}

/* The worker, loaded into a scope it believes is a worker's.
 *
 * Returns the handle each check drives it through: the messages it posted,
 * and a `send` that is what the browser would do when a message arrives.
 */
function loadWorker({ behaviour = {}, loader = null, globals = {} } = {}) {
  const posted = [];
  let onMessage = null;

  /** @type {any} The scope the worker believes it is running in. */
  const self = {
    location: { href: "https://example.test/js/pyodide-worker.js" },
    postMessage: (message) => posted.push(message),
    addEventListener: (type, handler) => {
      if (type === "message") {
        onMessage = handler;
      }
    },
    importScripts: () => {},
    fetch: async () => ({ ok: true }),
    ...globals
  };

  const pyodide = fakePyodide(behaviour);
  self.loadPyodide = loader || (async () => pyodide);

  const sandbox = { self, console, URL, TypeError, Promise, setTimeout };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: WORKER_PATH });

  return {
    self,
    posted,
    pyodide,
    send: (data) => onMessage?.({ data }),
    // The worker chains its runs, so a check waits for the chain rather than
    // for a timer: everything it does happens on resolved promises.
    settle: async () => {
      for (let turn = 0; turn < 50; turn += 1) {
        await Promise.resolve();
      }
    },
    of: (type) => posted.filter((message) => message.type === type),
    stages: () => posted.filter((m) => m.type === "status").map((m) => m.stage)
  };
}

async function run(worker, message) {
  worker.send({ type: "run", id: "cell-1", notebookId: "n1", code: "print(1)", ...message });
  await worker.settle();
}

/* --- The protocol -------------------------------------------------------- */

async function theProtocol() {
  console.log("=== a cell runs, and says so on the way ===");

  const worker = loadWorker({ behaviour: { prints: ["hello"], returns: 42 } });
  await run(worker, { code: "print('hello')\n42" });

  check("it says what it is doing, in order",
    worker.stages(), ["downloading", "starting", "ready", "packages", "running"]);
  check("...and the version it started", worker.of("status")[2].version, "0.0.0-fake");

  const [result] = worker.of("result");
  check("one result comes back", worker.of("result").length, 1);
  check("...for the cell that was run", result.id, "cell-1");
  check("...saying it worked", result.ok, true);
  check("...with what the cell printed", result.stdout, ["hello"]);
  check("...and the value of its last expression, as the REPL would show it",
    result.result, "repr(42)");

  // A dead handler left installed sends the next cell's output into this run's
  // arrays, which is a bug this file's own comment records.
  check("the output handlers are taken off afterwards", worker.pyodide.log.cleared > 0, true);

  const quiet = loadWorker({ behaviour: {} });
  await run(quiet, { code: "x = 1" });
  check("a cell that evaluates to nothing has no result to show",
    quiet.of("result")[0].result, null);
}

/* --- The caps ------------------------------------------------------------ */

async function theCaps() {
  console.log("=== a runaway cell is cut off rather than passed on ===");

  /* 200,000 characters of stdout and 20,000 of result. Neither had ever been
   * reached by a test, and a runaway print loop is the whole reason they are
   * there: the string it builds is one the page then has to render.
   */
  const spam = loadWorker({
    behaviour: { prints: Array.from({ length: 400 }, () => "x".repeat(1000)) }
  });

  await run(spam, { code: "while True: print('x' * 1000)" });
  const streamed = spam.of("result")[0].stdout;
  const streamedChars = streamed.join("").length;

  check("the stream stops at its cap", streamedChars < 210000, true);
  check("...having kept what fits", streamedChars > 190000, true);
  check("...and says it was cut off, once",
    streamed.filter((line) => line.includes("output truncated")).length, 1);

  const huge = loadWorker({ behaviour: { returns: 1, repr: () => "y".repeat(50000) } });
  await run(huge, { code: "'y' * 50000" });
  const shown = huge.of("result")[0].result;

  check("a result too long to show is shortened", shown.length < 21000, true);
  check("...and says so", shown.endsWith("… (truncated)"), true);
}

/* --- What goes wrong ----------------------------------------------------- */

async function theFailures() {
  console.log("=== what comes back when the cell, or Python, goes wrong ===");

  const raised = loadWorker({
    behaviour: {
      prints: ["before the error"],
      raises: new Error("Traceback (most recent call last):\n  ZeroDivisionError: division by zero")
    }
  });

  await run(raised, { code: "1/0" });
  const failure = raised.of("result")[0];

  check("a cell that raises comes back as a failure", failure.ok, false);
  // Pyodide puts the Python traceback in the message, which is what somebody
  // debugging their cell actually wants to read.
  check("...with the traceback", failure.error.includes("ZeroDivisionError"), true);
  check("...and what it managed to print first", failure.stdout, ["before the error"]);

  const broken = loadWorker({
    loader: async () => {
      throw new Error("the CDN is not there");
    }
  });

  await run(broken, { code: "print(1)" });
  const dead = broken.of("result")[0];
  check("a Python that will not start is reported, not swallowed", dead.ok, false);
  check("...in words that say which half failed",
    dead.error.startsWith("Python could not start"), true);

  // A missing package is the cell's problem to report. Refusing to run it
  // would hide the traceback that explains it.
  const noPackage = loadWorker({
    behaviour: {
      packages: async () => {
        throw new Error("no such wheel");
      },
      prints: ["ran anyway"]
    }
  });

  await run(noPackage, { code: "import nope" });
  check("a package that will not preload does not stop the cell",
    noPackage.of("result")[0].ok, true);
  check("...and is mentioned on stderr",
    noPackage.of("result")[0].stderr.some((line) => line.includes("no such wheel")), true);
}

/* --- One at a time, and starting over ------------------------------------ */

async function theQueueAndReset() {
  console.log("=== runs are serialised, and a notebook can start over ===");

  /* Two overlapping runs would capture each other's output: Pyodide's stdout
   * handler belongs to the interpreter rather than to a call, and a cell that
   * awaited used to lose its output to whichever cell was started next.
   */
  const worker = loadWorker({ behaviour: { prints: ["out"] } });
  worker.send({ type: "run", id: "a", notebookId: "n1", code: "1" });
  worker.send({ type: "run", id: "b", notebookId: "n1", code: "2" });
  await worker.settle();

  check("both runs answer", worker.of("result").map((r) => r.id), ["a", "b"]);
  check("...each with its own output",
    worker.of("result").every((r) => r.stdout.length === 1), true);

  // Cells in one notebook share variables the way a kernel does, so the
  // namespace is made once and kept.
  check("one namespace serves the notebook", worker.pyodide.log.namespaces, 1);

  worker.send({ type: "reset", notebookId: "n1" });
  await worker.settle();

  check("resetting says it is done", worker.of("reset-done").length, 1);
  check("...for the notebook that asked", worker.of("reset-done")[0].notebookId, "n1");
  check("...and the namespace is released rather than dropped",
    worker.pyodide.log.destroyed, 1);

  await run(worker, { id: "c", notebookId: "n1", code: "x" });
  check("the next run starts a fresh one", worker.pyodide.log.namespaces, 2);

  const preload = loadWorker({});
  preload.send({ type: "preload" });
  await preload.settle();
  check("a notebook can warm Python up before anybody runs a cell",
    preload.stages(), ["downloading", "starting", "ready"]);

  const coldStart = loadWorker({
    loader: async () => {
      throw new Error("offline");
    }
  });

  coldStart.send({ type: "preload" });
  await coldStart.settle();
  // Warming up is something the app does on its own behalf, so its failure is
  // a status rather than a result: there is no cell waiting to be told.
  check("...and a warm-up that fails says so without a cell to blame",
    coldStart.stages(), ["downloading", "starting", "failed"]);
  check("...naming what went wrong",
    coldStart.of("status").at(-1).error.includes("offline"), true);

  const ignored = loadWorker({});
  ignored.send({ type: "nonsense" });
  await ignored.settle();
  check("a message it does not know is ignored rather than thrown over",
    ignored.posted, []);
}

/* --- The network it takes away from itself -------------------------------- */

async function theNetworkGuard() {
  console.log("=== notebook code gets no network ===");

  /* The reason this file exists in a worker at all. Pyodide hands Python the
   * host scope through `import js`; without this guard `js.fetch("/api/docs")`
   * reads the whole library with the reader's cookie attached. It could not
   * write — that needs the CSRF token, which never enters this worker — but
   * reading was enough to matter.
   */
  const asked = [];
  const worker = loadWorker({
    globals: {
      fetch: async (input) => {
        asked.push(String(input));
        return { ok: true };
      },
      XMLHttpRequest: function Real() {},
      WebSocket: function Real() {},
      EventSource: function Real() {}
    }
  });

  await run(worker, { code: "print(1)" });

  /** @param {() => any} attempt */
  const refused = async (attempt) => {
    try {
      await attempt();
      return null;
    } catch (error) {
      return String(error.message);
    }
  };

  const ownOrigin = await refused(() => worker.self.fetch("https://example.test/api/docs"));
  check("fetching this app's own API is refused",
    ownOrigin?.includes("Network access is not available"), true);
  check("...and nothing was asked for", asked, []);

  check("so is anywhere else",
    (await refused(() => worker.self.fetch("https://elsewhere.test/")))
      ?.includes("Network access"), true);
  check("...and a URL that is not one",
    (await refused(() => worker.self.fetch("::::")))?.includes("Network access"), true);

  // Pyodide fetches wheels from the CDN on demand, so that one origin stays
  // open or `import numpy` stops working.
  await worker.self.fetch("https://cdn.jsdelivr.net/pyodide/numpy.whl");
  check("the CDN it loads packages from is still reachable", asked.length, 1);

  for (const name of ["XMLHttpRequest", "WebSocket", "EventSource"]) {
    check(`${name} is a door that is closed too`,
      (await refused(async () => new worker.self[name]()))?.includes("Network access"), true);
  }

  check("and it cannot pull in more code",
    (await refused(async () => worker.self.importScripts("https://elsewhere.test/x.js")))
      ?.includes("Network access"), true);
}

async function main() {
  await theProtocol();
  await theCaps();
  await theFailures();
  await theQueueAndReset();
  await theNetworkGuard();
  process.exit(finish());
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
