/* Running notebook cells.
 *
 * The Python lives in a worker (see notebook-runtime.js). This is the glue
 * between a Run button and the output area under the cell.
 *
 * Nothing runs on its own. Opening a notebook renders it and stops; a cell
 * executes because someone pressed Run on it, which is the only reason a
 * document in a library should ever execute anything.
 */

(function (global) {
  const { elements } = global.AppDom;
  const { state } = global.AppState;
  const { notify } = global.AppNotify;

  function notebookOutputFor(cellNumber) {
    return elements.docContent.querySelector(`.notebook-live-output[data-cell="${cellNumber}"]`);
  }

  function renderRunOutput(target, result) {
    target.innerHTML = "";
    target.hidden = false;

    const append = (className, text) => {
      if (!text || !String(text).trim()) {
        return;
      }

      const block = document.createElement("pre");
      block.className = className;
      block.textContent = String(text);
      target.appendChild(block);
    };

    append("notebook-run-stream", (result.stdout || []).join("\n"));
    append("notebook-run-stream is-stderr", (result.stderr || []).join("\n"));

    if (result.ok) {
      append("notebook-run-value", result.result);
    } else {
      append("notebook-run-error", result.error);
    }

    if (!target.childElementCount) {
      const empty = document.createElement("p");
      empty.className = "notebook-run-empty";
      empty.textContent = result.ok ? "Ran with no output." : "Failed with no output.";
      target.appendChild(empty);
    }
  }

  function setKernelStatus(label, { busy = false } = {}) {
    if (!elements.kernelStatus) {
      return;
    }

    elements.kernelStatus.hidden = !label;
    elements.kernelStatus.textContent = label || "";
    elements.kernelStatus.classList.toggle("is-busy", busy);
    if (elements.kernelBar) {
      elements.kernelBar.hidden = !NotebookRuntime.started;
    }
  }

  async function runNotebookCell(button) {
    const cellNumber = Number(button.dataset.cell);
    const code = MarkdownCore.notebookSourceFor(cellNumber);
    const target = notebookOutputFor(cellNumber);

    if (!code || !target) {
      return;
    }

    // Which document this run belongs to. Switching away mid-run replaces the
    // whole article, and writing into the detached node would put one notebook's
    // output under another's cell.
    const startedFor = state.activeFile;

    button.disabled = true;
    button.classList.add("is-running");
    target.hidden = false;
    target.innerHTML = '<p class="notebook-run-empty">Working…</p>';

    try {
      // The notebook's filename keys the kernel namespace, so cells in one
      // document share variables and two notebooks do not collide.
      const result = await NotebookRuntime.runCell(startedFor || "notebook", code, {
        onSlow: () => {
          if (target.isConnected) {
            target.innerHTML = "";
            const note = document.createElement("p");
            note.className = "notebook-run-empty";
            note.textContent = "Still running. Use Restart Python if it is stuck.";
            target.appendChild(note);
          }
        }
      });

      // The reader has moved on; their current notebook must not gain output
      // from the one they left.
      if (state.activeFile !== startedFor || !target.isConnected) {
        return;
      }

      renderRunOutput(target, result);

      if (!result.ok) {
        notify(`Cell ${cellNumber} failed.`, "error");
      }
    } catch (error) {
      if (target.isConnected) {
        renderRunOutput(target, { ok: false, error: error.message });
      }
    } finally {
      // Re-enabling the button that started this run; nothing else holds it.
      // eslint-disable-next-line require-atomic-updates
      button.disabled = false;
      button.classList.remove("is-running");
      setKernelStatus(NotebookRuntime.isBusy() ? "Running…" : "Python ready", { busy: NotebookRuntime.isBusy() });
    }
  }

  function bindNotebookExecution() {
    // If the runtime script failed to load, the app still has to work — running
    // Python is an extra, not a dependency. Cells simply keep their rendered
    // output and lose the Run button.
    if (typeof NotebookRuntime === "undefined") {
      MarkdownCore.configure({ executableNotebooks: false });
      return;
    }

    // Delegated, because the notebook markup is replaced wholesale every time a
    // document opens.
    elements.docContent.addEventListener("click", (event) => {
      const button = event.target.closest(".notebook-run");
      if (button) {
        void runNotebookCell(button);
      }
    });

    NotebookRuntime.onStatus((status) => {
      setKernelStatus(status.label, { busy: status.stage !== "ready" && status.stage !== "idle" });
    });

    elements.restartKernelBtn?.addEventListener("click", () => {
      NotebookRuntime.restart();
      for (const output of elements.docContent.querySelectorAll(".notebook-live-output")) {
        output.hidden = true;
        output.innerHTML = "";
      }
      notify("Python kernel stopped. The next Run starts a fresh one.", "neutral");
      setKernelStatus("");
    });
  }

  global.AppNotebook = {
    setKernelStatus,
    bindNotebookExecution
  };
})(typeof window === "undefined" ? globalThis : window);
