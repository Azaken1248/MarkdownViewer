/* Putting files into the library from the file picker.
 *
 * Two ways in: one document at a time, and a whole folder at once. The folder
 * case does the filtering here rather than sending everything and letting the
 * server say no — a real folder is mostly images and dotfiles, and there is no
 * reason to spend the bandwidth. The server still checks; this is convenience.
 */
/* exported AppUploads */
var AppUploads = (function () {

const { UPLOADABLE_EXTENSIONS } = AppText;
const { elements } = AppDom;
const { state } = AppState;
const { requestJson } = AppApi;
const { notify, setStatus } = AppNotify;
const { revealFolderInTree } = AppViewerHeader;
const { refreshDocs } = AppRefresh;

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

/* What the upload did, as the clauses of one sentence.
 *
 * Everything that happened and is worth knowing: what landed, what was made
 * to put it in, and everything that did not go in as it was — a file this app
 * does not hold, one the server refused, a name that had to change to avoid a
 * clash, and a folder name this app had to adjust to accept, which is named
 * so that a folder appearing under a different name is explained rather than
 * mysterious.
 */
function whatArrived(payload, ignored) {
  const renamed = payload.uploaded.filter((entry) => entry.renamedFrom).length;
  const adjusted = payload.renamedFolders || [];

  const clauses = [
    [true, `Uploaded ${payload.counts.uploaded} document(s)`],
    [payload.counts.foldersCreated > 0, `created ${payload.counts.foldersCreated} folder(s)`],
    [ignored > 0, `skipped ${ignored} unsupported file(s)`],
    [payload.counts.skipped > 0, `${payload.counts.skipped} rejected`],
    [renamed > 0, `${renamed} renamed to avoid a clash`],
    [adjusted.length > 0, `${adjusted.length} folder name(s) adjusted (${
      adjusted.slice(0, 2).map((one) => `"${one.to}"`).join(", ")
    })`]
  ];

  return clauses.filter(([worth]) => worth).map(([, said]) => said);
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

    notify(`${whatArrived(payload, ignored).join(", ")}.`, "success");

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


return {
  MAX_FOLDER_UPLOAD_FILES, uploadMarkdown, isUploadableFile, relativePathFor, uploadFolder
};

})();
