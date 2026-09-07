/* Putting files into the library from the file picker.
 *
 * Two ways in: one document at a time, and a whole folder at once. The folder
 * case does the filtering here rather than sending everything and letting the
 * server say no — a real folder is mostly images and dotfiles, and there is no
 * reason to spend the bandwidth. The server still checks; this is convenience.
 */
(function (global) {

const { UPLOADABLE_EXTENSIONS } = global.AppText;
const { elements } = global.AppDom;
const { state } = global.AppState;
const { requestJson } = global.AppApi;
const { notify, setStatus } = global.AppNotify;
const { revealFolderInTree } = global.AppViewerHeader;
const { refreshDocs } = global.AppRefresh;

async function uploadMarkdown(file, folderId = null) {
  if (!file) {
    return;
  }

  const formData = new FormData();
  formData.append("markdownFile", file);
  if (folderId) {
    formData.append("folderId", folderId);
  }

  try {
    const payload = await requestJson("/api/docs/upload", {
      method: "POST",
      body: formData
    });

    await refreshDocs({ openFile: payload.file, preserveSearch: false });
    setStatus(payload.folderName
      ? `Uploaded ${payload.file} to ${payload.folderName}.`
      : `Uploaded ${payload.file}.`, "success");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    state.pendingUploadFile = null;
    elements.uploadInput.value = "";
  }
}

/* --------------------------------------------------------------------------
   Folder upload

   The picker hands back a flat list of File objects, each carrying its path
   within the chosen folder in webkitRelativePath. The tree is rebuilt from
   those paths server-side.

   Unsupported files are dropped here rather than sent and rejected: a real
   folder is full of images, .DS_Store and lock files, and there is no reason
   to spend upload bandwidth on them. The server still checks — this is
   convenience, not the security boundary.
   -------------------------------------------------------------------------- */

// Mirrors MAX_FOLDER_UPLOAD_FILES on the server; checked here so a huge folder
// fails immediately instead of after uploading everything.
const MAX_FOLDER_UPLOAD_FILES = 200;

function isUploadableFile(file) {
  const name = String(file?.name || "").toLowerCase();
  return UPLOADABLE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

function relativePathFor(file) {
  // webkitRelativePath is empty for a plain multi-file selection, which is a
  // perfectly good upload of loose files into the destination folder.
  return file.webkitRelativePath || file.name;
}

async function uploadFolder(picked, folderId = null) {
  const documents = picked.filter(isUploadableFile);
  const ignored = picked.length - documents.length;

  if (documents.length === 0) {
    notify(
      `Nothing to upload — none of those ${picked.length} file(s) are markdown, Mermaid or notebook files.`,
      "warning"
    );
    return;
  }

  if (documents.length > MAX_FOLDER_UPLOAD_FILES) {
    notify(
      `That folder has ${documents.length} documents; the limit is ${MAX_FOLDER_UPLOAD_FILES}. Upload a subfolder instead.`,
      "error"
    );
    return;
  }

  const rootName = relativePathFor(documents[0]).split("/")[0] || "folder";
  notify(`Uploading ${documents.length} document(s) from "${rootName}"…`, "info");

  const formData = new FormData();
  for (const file of documents) {
    formData.append("files", file);
  }
  // Index-aligned with the files above, in the same order.
  formData.append("paths", JSON.stringify(documents.map(relativePathFor)));
  if (folderId) {
    formData.append("parentId", folderId);
  }

  try {
    const payload = await requestJson("/api/upload/folder", {
      method: "POST",
      body: formData
    });

    await refreshDocs({ preserveSearch: false });

    const parts = [`Uploaded ${payload.counts.uploaded} document(s)`];
    if (payload.counts.foldersCreated > 0) {
      parts.push(`created ${payload.counts.foldersCreated} folder(s)`);
    }
    if (ignored > 0) {
      parts.push(`skipped ${ignored} unsupported file(s)`);
    }
    if (payload.counts.skipped > 0) {
      parts.push(`${payload.counts.skipped} rejected`);
    }

    const renamed = payload.uploaded.filter((entry) => entry.renamedFrom);
    if (renamed.length > 0) {
      parts.push(`${renamed.length} renamed to avoid a clash`);
    }

    const adjustedFolders = payload.renamedFolders || [];
    if (adjustedFolders.length > 0) {
      // Say which, so a folder appearing under a different name is explained.
      parts.push(`${adjustedFolders.length} folder name(s) adjusted (${
        adjustedFolders.slice(0, 2).map((r) => `"${r.to}"`).join(", ")
      })`);
    }

    notify(`${parts.join(", ")}.`, "success");

    // Open the uploaded tree rather than leaving it collapsed out of sight.
    for (const folder of state.folders) {
      if (folder.name === rootName && !folder.parentId) {
        revealFolderInTree(folder.id);
        break;
      }
    }
  } catch (error) {
    notify(error.message, "error");
  }
}


global.AppUploads = {
  MAX_FOLDER_UPLOAD_FILES, uploadMarkdown, isUploadableFile, relativePathFor, uploadFolder
};

})(typeof window === "undefined" ? globalThis : window);
