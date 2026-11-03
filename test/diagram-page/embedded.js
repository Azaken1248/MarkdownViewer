// Part of the diagram-page suite. See diagram-page.test.js, which sets all this
// up and calls it.
//
// The editor mounted somewhere that is not this page.
//
// The file's own first paragraph says what it is for: "it is handed a string
// and hands back a string. That is what lets one canvas serve a fence inside a
// document and a .mmd file on its own." Only the second of those exists today
// — a fence in a document is handed over to this page rather than edited in
// place — so the host options for the first were never used by anything, and
// the parts of the editor that depend on them were never built.
//
// They are an API rather than a feature, so this drives them as one: a second
// editor, mounted into a plain element in the page's own window, with the
// options a host other than this page would pass.
module.exports = async (ctx) => {
  const { check, server, cookie, origin, openPage, csrfFor, until } = ctx;

  console.log("=== an editor mounted as a host other than this page would ===");
  {
    await server.request("POST", "/api/docs",
      { fileName: "hosted.mmd", overwrite: true, content: [
        "flowchart TD",
        "    %% layout v1",
        "    %% @ A 100,100 80x40",
        "    %% @ B 300,100 80x40",
        "    A[One]",
        "    B[Two]",
        "    A --> B"
      ].join("\n") + "\n" },
      { Cookie: cookie, "X-CSRF-Token": await csrfFor(server, cookie) });

    // A page, for the window: it carries the editor and everything the editor
    // is built out of, loaded the way the page loads them.
    const page = await openPage({ url: `${origin}/diagram/file/hosted.mmd`, cookie, origin });
    const { window, document } = page;

    const source = [
      "flowchart LR",
      "    %% layout v1",
      "    %% @ X 40,40 80x40",
      "    X[Only]"
    ].join("\n");

    const host = document.createElement("div");
    document.body.appendChild(host);

    let doneCalled = 0;
    const editor = window.DiagramEditor.mount(host, {
      source,
      title: "notes.md",
      // Not a window onto an endless sheet: a strip of a document, as tall as
      // the diagram needs and no taller.
      viewport: false,
      onDone: () => {
        doneCalled += 1;
      }
    });

    check("the editor mounts into an element that is not this page's canvas",
      Boolean(editor), true);
    check("...and draws the diagram it was handed",
      [...host.querySelectorAll(".dd-node")].map((one) => one.dataset.id), ["X"]);

    /* The bar says which document it is editing, which only matters when the
     * editor is inside one: on a page of its own the address bar and the
     * heading have said so already, and a name on the bar as well is the same
     * word three times.
     */
    const name = host.querySelector(".ve-diagram-name");
    check("a hosted editor says on its bar what it is editing", Boolean(name), true);
    check("...which is the title the host gave it", name.textContent, "notes.md");
    // Counted across the whole document, which holds both editors: the page's
    // own bar must not have one, or the name is said three times.
    check("...and the page's own editor still does not",
      document.querySelectorAll(".ve-diagram-name").length, 1);

    /* And it offers a way out, because the host asked for one. The page has no
     * Done — leaving is the Back button and the save — so this is the control
     * that only exists for an editor inside something else.
     */
    const done = [...host.querySelectorAll("button")]
      .find((one) => one.className === "ve-embed-done");
    check("...and a way to say it is finished", Boolean(done), true);

    done.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("pressing it tells the host, which is the only thing it does",
      doneCalled, 1);

    /* What it does not have. The zoom and the step-through are about looking
     * at a diagram too big for the screen, which is a page's problem; a strip
     * in a document is as big as the diagram.
     */
    check("a hosted editor has no zoom, which is a window's business",
      Boolean(host.querySelector(".ve-diagram-zoom")), false);
    check("...and no step-through either",
      Boolean(host.querySelector(".ve-diagram-steps")), false);

    // It is still an editor: the string it hands back is the string it would
    // write, and an edit changes it.
    check("it hands back what it was handed, until something is edited",
      editor.source().trim(), source);

    const box = host.querySelector('.dd-node[data-id="X"]');
    const canvas = host.querySelector(".ve-diagram-canvas");
    const spot = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(box.getAttribute("transform"));
    const x = Number(spot[1]) + 10;
    const y = Number(spot[2]) + 10;
    box.dispatchEvent(new window.MouseEvent("pointerdown", { clientX: x, clientY: y, bubbles: true }));
    canvas.dispatchEvent(new window.MouseEvent("pointermove", { clientX: x + 80, clientY: y, bubbles: true }));
    canvas.dispatchEvent(new window.MouseEvent("pointerup", { clientX: x + 80, clientY: y, bubbles: true }));

    await until(window, () => editor.source().trim() !== source);
    check("...and an edit in it changes what it hands back",
      editor.source().includes("@ X 40,40") === false, true);

    /* And it can be taken away. A host that swaps one block for another leaves
     * a redraw queued against an element nobody holds any more, which is a
     * diagram drawn into nothing — and, on a long-lived page, one of those per
     * block opened.
     */
    editor.destroy();
    check("destroying it empties the element it was mounted in", host.childElementCount, 0);

    host.remove();
    page.window.close();
  }

};
