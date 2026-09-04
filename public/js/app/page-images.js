/* Putting a picture into a document.
 *
 * The same act — paste, drop, or pick a file — arriving in two places that
 * take it differently. Into the source editor it goes as markdown, through a
 * placeholder that is replaced when the upload lands. Into the page it goes as
 * a real img element, so the picture is where it will be rather than a line of
 * markup standing in for it; the serializer already writes an img back out as
 * ![alt](src).
 */

(function (global) {
  const { elements } = global.AppDom;
  const { insertIntoTextarea, replaceInTextarea } = global.AppTextarea;
  const { uploadPlaceholder, uploadImage, imageMarkdown, imageName } = global.AppPastedImages;
  const { setStatus } = global.AppNotify;

  async function attachImagesToSource(files) {
    for (const file of files) {
      const placeholder = uploadPlaceholder(file);
      insertIntoTextarea(elements.editorInput, placeholder);
      App.scheduleEditorPreview();

      try {
        const url = await uploadImage(file);
        replaceInTextarea(elements.editorInput, placeholder, imageMarkdown(file, url));
        setStatus(`Attached ${imageName(file)}.`, "success");
      } catch (error) {
        // Leaving "Uploading..." in the text would be a lie that saves to the file.
        replaceInTextarea(elements.editorInput, placeholder, "");
        setStatus(error.message, "error");
      }

      App.scheduleEditorPreview();
    }
  }

  // --- Into the document being edited on the page ----------------------------

  // An image in a rich block goes in as a real img element, so the picture is
  // where it will be rather than a line of markup standing in for it. The
  // serializer already writes an img back out as ![alt](src).
  function insertNodeAtCaret(node) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return false;
    }

    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  // Inserting a node is a change to the block, but the browser only fires input
  // for changes a person made. Saying so explicitly is what marks the block dirty
  // and updates the bar, through exactly the path typing already uses.
  function announceEdit(host) {
    host?.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function attachImagesToPage(files) {
    // The document without the picture is worth a step of its own, since undoing
    // a paste is one of the more likely things anyone wants back.
    App.commitPageHistory();

    for (const file of files) {
      const image = document.createElement("img");
      // A local preview means the picture is on the page before the upload
      // finishes, which is the whole feel of pasting one. Guarded because losing
      // the preview should cost the preview, not the paste.
      const preview = window.URL?.createObjectURL ? URL.createObjectURL(file) : "";
      if (preview) {
        image.src = preview;
      }
      image.alt = imageName(file).replace(/\.[^.]+$/, "");
      image.dataset.uploading = "true";

      const release = () => {
        if (preview) {
          URL.revokeObjectURL(preview);
        }
      };

      if (!insertNodeAtCaret(image)) {
        release();
        return;
      }

      // Held now, because a failed upload takes the image back out of the
      // document and there would be nothing left to ask.
      const host = image.closest('[contenteditable="true"]');
      announceEdit(host);

      try {
        const url = await uploadImage(file);
        image.src = url;
        delete image.dataset.uploading;
        announceEdit(host);
        setStatus(`Attached ${imageName(file)}.`, "success");
      } catch (error) {
        // The picture never made it, so it must not be left sitting in the
        // document looking as though it did.
        image.remove();
        announceEdit(host);
        setStatus(error.message, "error");
      } finally {
        release();
      }
    }
  }

  global.AppPageImages = {
    attachImagesToSource,
    insertNodeAtCaret,
    announceEdit,
    attachImagesToPage
  };
})(typeof window === "undefined" ? globalThis : window);
