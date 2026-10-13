/* Part of the MARKDOWN suite. See markdown.test.js, which loads this.
 *
 * A .ipynb drawn as a document. Cells become sections, outputs become the
 * things they claim to be — an image, a table, a stream of text, a traceback
 * — and every one of them arrives through the same sanitizer as ordinary
 * markdown, which is the part worth checking: a notebook is a file somebody
 * downloaded, and its outputs are whatever the kernel that made it wrote.
 */
module.exports = (check, window) => {
  const Notebook = window.MdNotebook;
  const { hooks, configure } = window.MdLazy;

  const file = (cells, metadata) => JSON.stringify({ cells, metadata });
  const render = (cells, metadata, title) =>
    Notebook.renderNotebookDocument(file(cells, metadata), title);

  const code = (source, over = {}) => ({ cell_type: "code", source, outputs: [], ...over });
  const html = (markup) => {
    const box = window.document.createElement("div");
    box.innerHTML = markup;
    return box;
  };

  // The templates are written to be read in the file, so the markup is full of
  // the indentation they are written with.
  const words = (node) => node.textContent.replace(/\s+/g, " ").trim();

  // The text of an output, as against the cell's own source, which is also a
  // <pre>.
  const outputText = (box) => words(box.querySelector(".notebook-output .notebook-output-text"));

  console.log("=== a notebook, as a document ===");
  {
    const drawn = render([
      { cell_type: "markdown", source: "# Notes\n\nSome prose." },
      code("print(1)", { execution_count: 4, outputs: [{ output_type: "stream", name: "stdout", text: "1\n" }] }),
      { cell_type: "raw", source: "left as it is" }
    ], { title: "From the metadata" }, "Measurements");

    const box = html(drawn);
    check("every cell is a section",
      [...box.querySelectorAll(".notebook-cell")].map((one) => one.className.split(" ")[1]),
      ["notebook-cell-markdown", "notebook-cell-code", "notebook-cell-raw"]);
    check("...numbered as the notebook numbers them",
      [...box.querySelectorAll(".notebook-cell-index")].map((one) => one.textContent.trim()),
      ["Cell 1", "In [4]", "Cell 3"]);
    check("...and the markdown cell went through the engine",
      Boolean(box.querySelector(".notebook-cell-markdown h1")), true);

    check("the document says what is in it",
      box.querySelector(".notebook-meta").textContent.replace(/\s+/g, " ").trim(),
      "3 cells · 1 markdown · 1 code · 1 raw");
    check("...under the name it was opened as", box.querySelector("h1").textContent, "Measurements");

    // Its own title where the page has none to give it, and a name of last
    // resort so the document is never headed by nothing.
    check("...or the name it gave itself", html(render([], { title: "From the metadata" }))
      .querySelector("h1").textContent, "From the metadata");
    check("...or simply what it is", html(render([])).querySelector("h1").textContent, "Notebook");
    check("a notebook with no cells says so",
      Boolean(html(render([])).querySelector(".notebook-empty")), true);
    check("...and one cell is one cell, not 1 cells",
      words(html(render([code("x")])).querySelector(".notebook-meta")),
      "1 cell · 0 markdown · 1 code");
    // Raw cells are rare enough that counting nought of them is noise.
    check("...while a notebook with no raw cells does not mention raw",
      words(html(render([code("x")]))).includes("raw"), false);

    // A file somebody downloaded, which a text editor may have put a byte
    // order mark on the front of.
    check("a notebook that begins with a byte order mark still parses",
      Boolean(html(Notebook.renderNotebookDocument(`\uFEFF${file([code("x")])}`))
        .querySelector(".notebook-cell")),
      true);

    let refused = "";
    try {
      Notebook.renderNotebookDocument('{"not": "a notebook"}');
    } catch (error) {
      refused = error.message;
    }
    check("...and a file with no cells in it is not a notebook", refused, "Invalid notebook file");
  }

  console.log("=== what a notebook says it is written in ===");
  {
    const languageOf = (metadata) => html(render([code("x")], metadata))
      .querySelector(".notebook-code-block code").className;

    // Three places it might say so, and Python when it says nothing, because
    // that is what a notebook is unless it says otherwise.
    check("the language_info name is the first place looked",
      languageOf({ language_info: { name: "julia" }, kernelspec: { language: "r" } }),
      "language-julia");
    check("...then the editor mode it names",
      languageOf({ language_info: { codemirror_mode: { name: "rust" } } }), "language-rust");
    check("...then the kernel's own language", languageOf({ kernelspec: { language: "r" } }),
      "language-r");
    check("...and a notebook that says nothing is Python",
      languageOf({}), "language-python");
    check("...as is one that says something empty",
      languageOf({ kernelspec: { language: "   " } }), "language-python");
    // python3, python2, "Python 3.11" — all of them are python as far as a
    // highlighter is concerned.
    check("every flavour of Python is Python",
      languageOf({ language_info: { name: "python3" } }), "language-python");
    // The engine's names for the same answers, so "js" highlights.
    check("...and a nickname becomes the name the highlighter knows",
      languageOf({ language_info: { name: "js" } }), "language-javascript");
  }

  console.log("=== an output is shown as the thing it claims to be ===");
  {
    const output = (data) => html(render([code("x", { outputs: [{ output_type: "execute_result", data }] })]));

    /* A notebook may offer the same result several ways — a chart as HTML and
     * as a PNG and as the words "a chart" — and the first of these it has is
     * the one worth showing.
     */
    const both = output({ "text/html": "<b>rich</b>", "text/plain": "plain" });
    check("the richest form offered is the one shown",
      [Boolean(both.querySelector(".notebook-output-html")),
        both.textContent.includes("plain")], [true, false]);

    // And through the same sanitizer as everything else, because an output is
    // whatever the kernel that made it wrote.
    const nasty = output({ "text/html": '<img src=x onerror="alert(1)"><b>kept</b>' });
    check("...sanitized the way the rest of the document is",
      [nasty.innerHTML.includes("onerror"), nasty.textContent.includes("kept")], [false, true]);

    const png = output({ "image/png": "AAAA\nBBBB" });
    check("a picture is a picture",
      png.querySelector("img").getAttribute("src"), "data:image/png;base64,AAAABBBB");
    check("...described for anyone who cannot see it",
      png.querySelector("img").getAttribute("alt"), "Notebook output image");
    check("...and not fetched until it is on screen",
      png.querySelector("img").getAttribute("loading"), "lazy");

    /* An SVG arrives either as base64 or as the markup itself, and the two
     * need different data URIs. Guessing wrong gives a broken image rather
     * than an error.
     */
    check("an SVG written as base64 is carried as base64",
      output({ "image/svg+xml": "PHN2Zz48L3N2Zz4=" }).querySelector("img").getAttribute("src"),
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=");
    check("...and one written as markup is carried as markup",
      output({ "image/svg+xml": "<svg><circle/></svg>" }).querySelector("img").getAttribute("src")
        .startsWith("data:image/svg+xml;charset=utf-8,"), true);

    check("markdown in an output goes through the engine",
      Boolean(output({ "text/markdown": "## A heading" }).querySelector("h2")), true);

    // JSON is pretty-printed, because a kernel writes it on one line and a
    // reader cannot read one line of it.
    check("JSON is laid out to be read",
      output({ "application/json": '{"a":1,"b":[2]}' })
        .querySelector(".notebook-output-json").textContent,
      '{\n  "a": 1,\n  "b": [\n    2\n  ]\n}');
    // Not JSON after all, which happens: shown as it was written rather than
    // dropped.
    check("...and something claiming to be JSON and not being is shown as it is",
      output({ "application/json": "{oops" }).querySelector(".notebook-output-json").textContent,
      "{oops");

    check("plain text is plain text",
      output({ "text/plain": "7" }).querySelector(".notebook-output-text").textContent, "7");
    // A source is a list of lines in the file format, and joining them is the
    // difference between the output and a comma between every line of it.
    check("...and a result written as lines is joined rather than listed",
      output({ "text/plain": ["one\n", "two\n"] })
        .querySelector(".notebook-output-text").textContent, "one\ntwo\n");

    // An output offering nothing this knows how to show is nothing to show.
    check("an output in no form at all is not drawn",
      output({ "application/vnd.plotly.v1+json": "{}" }).querySelectorAll(".notebook-output").length, 0);
    check("...nor is one with no data at all",
      html(render([code("x", { outputs: [{ output_type: "display_data" }] })]))
        .querySelectorAll(".notebook-output").length, 0);
  }

  console.log("=== and what it says while it runs, and when it stops ===");
  {
    const streamed = html(render([code("x", {
      outputs: [{ output_type: "stream", name: "stderr", text: ["a warning\n"] }]
    })]));
    check("a stream says which stream it was",
      streamed.querySelector(".notebook-output-label").textContent, "stderr");
    check("...and what was on it", outputText(streamed), "a warning");
    check("...or simply that it was one",
      html(render([code("x", { outputs: [{ output_type: "stream", text: "x" }] })]))
        .querySelector(".notebook-output-label").textContent, "stream");

    const failed = html(render([code("x", {
      outputs: [{
        output_type: "error", ename: "ValueError", evalue: "too small",
        traceback: ["Traceback:", "  line 1", "ValueError: too small"]
      }]
    })]));
    check("an error says what went wrong",
      [failed.querySelector(".notebook-output-error-name").textContent,
        failed.querySelector(".notebook-output-error-value").textContent],
      ["ValueError", "too small"]);
    check("...and where", outputText(failed).includes("line 1"), true);

    // A traceback is the useful half and is often missing; the name and the
    // value are what is left to say.
    const bare = html(render([code("x", {
      outputs: [{ output_type: "error", ename: "KeyError", evalue: "'a'" }]
    })]));
    check("an error with no traceback still says what it was",
      outputText(bare), "KeyError: 'a'");
    check("...and one that will not even say that is still an error",
      html(render([code("x", { outputs: [{ output_type: "error" }] })]))
        .querySelector(".notebook-output-error-name").textContent, "Error");
  }

  console.log("=== which cells can be run, and with what ===");
  {
    const runnable = (cells, metadata) =>
      [...html(render(cells, metadata)).querySelectorAll(".notebook-cell-code")]
        .map((one) => one.hasAttribute("data-runnable"));

    // Off unless the host page says otherwise: a share page is somebody
    // else's document and running code in it is not on offer.
    check("nothing is runnable until the page says so", runnable([code("print(1)")]), [false]);

    configure({ executableNotebooks: true });
    check("...and then a Python cell with something in it is",
      runnable([code("print(1)")]), [true]);
    check("...while an empty one is not", runnable([code("   \n")]), [false]);
    // Only Python: the worker that runs it is Pyodide.
    check("...and neither is a cell in a language there is no runner for",
      runnable([code("plot(x)")], { language_info: { name: "r" } }), [false]);

    const live = html(render([code("print(1)"), code("")]));
    check("a runnable cell gets a button",
      live.querySelectorAll(".notebook-run").length, 1);
    check("...which says which cell it runs",
      live.querySelector(".notebook-run").getAttribute("aria-label"), "Run cell 1");
    check("...and somewhere to put what comes back",
      live.querySelectorAll(".notebook-live-output[hidden]").length, 1);

    /* The source is kept so a Run handler gets the original text rather than
     * trying to reconstruct it from highlighted markup — which is how a cell
     * came to be run with its syntax colouring in it.
     */
    render([{ cell_type: "markdown", source: "# not code" }, code("print(1)"), code("print(2)")]);
    check("each code cell's own source is kept, by cell number",
      [Notebook.notebookSourceFor(2), Notebook.notebookSourceFor(3)], ["print(1)", "print(2)"]);
    check("...and a markdown cell has none to keep", Notebook.notebookSourceFor(1), "");
    check("...nor does a cell that is not there", Notebook.notebookSourceFor(99), "");

    // Fresh per document: cell 2 means cell 2 of the notebook now open, not of
    // whichever one was open before.
    render([code("print(3)")]);
    check("...and opening another notebook forgets the last one's",
      [Notebook.notebookSourceFor(1), Notebook.notebookSourceFor(2)], ["print(3)", ""]);
    configure({ executableNotebooks: false });
  }

  console.log("=== and the one door all three kinds of document come through ===");
  {
    check("a notebook is drawn as a notebook",
      Notebook.renderDocumentContent("notes.ipynb", file([code("x")]), "Notes")
        .includes("notebook-summary"), true);
    // A .mmd is not markdown, so it is fenced as a diagram rather than given
    // a renderer of its own.
    check("a diagram file is drawn as a diagram",
      /class="[^"]*mermaid/.test(Notebook.renderDocumentContent("flow.mmd", "graph TD\n A-->B")), true);
    check("and everything else is markdown",
      Notebook.renderDocumentContent("notes.md", "# Notes").includes("<h1"), true);
    void hooks;
  }
};
