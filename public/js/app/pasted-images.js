// Pasted images.
//
// Paste a screenshot into a document and it should just be in the document, the
// way it is everywhere people already paste screenshots. The picture is
// uploaded, and what lands in the markdown is an ordinary image link.
//
// The upload takes as long as it takes, so a placeholder goes in at the cursor
// straight away and is swapped for the real link when the bytes are up. Typing
// carries on around it, which is why the placeholder is found again by text
// rather than held as a position.

(function (global) {
  const { requestJson } = global.AppApi;

  const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);

  function imagesFromTransfer(transfer) {
    if (!transfer) {
      return [];
    }

    const files = [...(transfer.files || [])];
    // A clipboard image arrives as an item with no file list on some browsers.
    const fromItems = [...(transfer.items || [])]
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter(Boolean);

    const all = files.length > 0 ? files : fromItems;
    return all.filter((file) => IMAGE_TYPES.has(String(file.type || "").toLowerCase()));
  }

  function uploadPlaceholder(file) {
    return `![Uploading ${imageName(file)}...]()`;
  }

  function imageName(file) {
    const name = String(file?.name || "").trim();
    return name || "image";
  }

  async function uploadImage(file) {
    const body = new FormData();
    body.append("image", file, imageName(file));

    const payload = await requestJson("/api/assets", { method: "POST", body });
    return String(payload.url || "");
  }

  // The alt text is the file's name without its extension, which is what a
  // screenshot tool's name gives you and better than nothing for a reader who
  // cannot see the picture.
  function imageMarkdown(file, url) {
    const alt = imageName(file).replace(/\.[^.]+$/, "");
    return `![${alt}](${url})`;
  }

  global.AppPastedImages = {
    imagesFromTransfer,
    imageName,
    uploadPlaceholder,
    uploadImage,
    imageMarkdown
  };
})(typeof window === "undefined" ? globalThis : window);
