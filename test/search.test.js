/* Finding a document by what is in it, through the index.
 *
 * The index is FTS5 over trigrams, which means it has to mean exactly what the
 * scan it replaces meant: any substring of three characters or more, in any
 * case, in the title, the folder name or the text. And the order has to be the
 * scorer's, not the index's. So the central check here is a comparison — the
 * same library and the same queries through the scan and through the index,
 * required to agree on which documents match and in what order.
 *
 * The other thing an index can get wrong is going stale. Documents are files,
 * and files are edited, renamed and deleted outside this app; the checks below
 * do all three between searches and expect the next search to know.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const db = require("../lib/db");
const { createDocumentCache } = require("../lib/docs/content");
const { createSearch, ftsMatchExpression, FTS_MIN_QUERY } = require("../lib/docs/search");
const { createChecker } = require("./helpers/check.js");

const { check, finish } = createChecker("SEARCH");

const LIBRARY = {
  "deploy.md": { title: "Deployment", folderName: "Ops", body: "# Deployment\n\nWe deploy with Kubernetes on Fridays.\nRollback is one command.\n" },
  "Ops/runbook.md": { title: "Runbook", folderName: "Ops", body: "# Runbook\n\nWhen the cluster is unhappy, check the deploy log first.\n" },
  "shopping.md": { title: "Shopping", folderName: "", body: "milk, eggs, bread, and a deployable amount of coffee\n" },
  "Notes/kube.md": { title: "Kubernetes notes", folderName: "Notes", body: "pods, services, ingress. nothing about deploys here.\n" },
  "Notes/empty.md": { title: "Empty", folderName: "Notes", body: "" }
};

function writeLibrary(dir) {
  for (const [file, { body }] of Object.entries(LIBRARY)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), body);
  }
}

// What the app's walk hands the search: the listing, with mtime and size.
function listDocs(dir, files = Object.keys(LIBRARY)) {
  return files.filter((file) => fs.existsSync(path.join(dir, file))).map((file) => {
    const stat = fs.statSync(path.join(dir, file));
    return {
      file,
      title: LIBRARY[file]?.title || path.basename(file, ".md"),
      folderName: LIBRARY[file]?.folderName || "",
      size: stat.size,
      updatedAt: stat.mtime.toISOString()
    };
  });
}

function makeSearch(dir, withDb) {
  const cache = createDocumentCache({ contentMaxBytes: 1 << 20, indexMaxBytes: 1 << 20, snippetMaxBytes: 1 << 20 });
  return createSearch({
    db: withDb ? db.open(path.join(dir, "data")) : null,
    readSearchIndexEntry: cache.readSearchIndexEntry,
    readSnippetSource: cache.readSnippetSource,
    readContent: async (fullPath) => (await cache.readCachedTextFile(fullPath)).content,
    resultLimit: 200
  }).searchDocuments;
}

const order = (result) => result.matches.map((match) => match.file);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "azadocs-search-"));
  const docsDir = path.join(dir, "docs");
  writeLibrary(docsDir);

  const scan = makeSearch(dir, false);
  const indexed = makeSearch(dir, true);

  console.log("=== the index and the scan agree on every query ===");
  for (const query of ["deploy", "DEPLOY", "ploy", "kube", "ops", "Fridays", "rollback command",
    "deploy kube", "nothing", "zzz", "coffee", "Runbook", "deploy a", "is unhappy", "ku deploy"]) {
    const viaScan = await scan({ query, docs: listDocs(docsDir), scopeDir: docsDir });
    const viaIndex = await indexed({ query, docs: listDocs(docsDir), scopeDir: docsDir });
    check(`"${query}" -> ${JSON.stringify(order(viaScan))}`, order(viaIndex), order(viaScan));
  }

  console.log("=== what the index means ===");
  {
    const r = await indexed({ query: "ploy", docs: listDocs(docsDir), scopeDir: docsDir });
    check("a substring inside a word matches", order(r).includes("deploy.md"), true);
    check("...and so does one inside a different word", order(r).includes("shopping.md"), true);

    const upper = await indexed({ query: "KUBERNETES", docs: listDocs(docsDir), scopeDir: docsDir });
    check("case does not matter", order(upper).length, 2);

    const named = await indexed({ query: "deploy", docs: listDocs(docsDir), scopeDir: docsDir });
    check("a document named for the query comes before one that only mentions it",
      order(named)[0], "deploy.md");
    check("the snippet keeps the document's own case",
      named.matches[0].snippet.includes("Kubernetes"), true);

    const folder = await indexed({ query: "ops", docs: listDocs(docsDir), scopeDir: docsDir });
    check("a folder name is searchable", order(folder).length >= 2, true);
  }

  console.log("=== a short query falls back to the scan ===");
  {
    check("the threshold is three characters", FTS_MIN_QUERY, 3);
    check("a two-character term contributes nothing to the index query",
      ftsMatchExpression(["de", "deploy"]), '"deploy"');
    check("...and a quote inside a term cannot escape it",
      ftsMatchExpression(['say"hi']), '"say""hi"');
    const short = await indexed({ query: "ku", docs: listDocs(docsDir), scopeDir: docsDir });
    const shortScan = await scan({ query: "ku", docs: listDocs(docsDir), scopeDir: docsDir });
    check("a two-character query still finds what the scan finds", order(short), order(shortScan));
    check("...which is not nothing", order(short).length > 0, true);
  }

  console.log("=== the index keeps up with the disk ===");
  {
    await new Promise((resolve) => setTimeout(resolve, 20));
    fs.writeFileSync(path.join(docsDir, "shopping.md"), "milk, eggs, bread, and a spare turboencabulator\n");
    const edited = await indexed({ query: "turboencabulator", docs: listDocs(docsDir), scopeDir: docsDir });
    check("a document edited outside the app is found by its new text", order(edited), ["shopping.md"]);
    const gone = await indexed({ query: "coffee", docs: listDocs(docsDir), scopeDir: docsDir });
    check("...and no longer by its old text", order(gone), []);

    fs.renameSync(path.join(docsDir, "deploy.md"), path.join(docsDir, "Ops", "deploy.md"));
    const moved = listDocs(docsDir, [...Object.keys(LIBRARY).filter((f) => f !== "deploy.md"), "Ops/deploy.md"]);
    const afterMove = await indexed({ query: "Fridays", docs: moved, scopeDir: docsDir });
    check("a document moved outside the app is found under its new path", order(afterMove), ["Ops/deploy.md"]);

    fs.unlinkSync(path.join(docsDir, "Notes", "kube.md"));
    const afterDelete = await indexed({ query: "ingress", docs: listDocs(docsDir), scopeDir: docsDir });
    check("a document deleted outside the app is gone from the results", order(afterDelete), []);

    const handle = db.open(path.join(dir, "data"));
    check("...and from the index itself",
      /** @type {any} */ (handle.prepare("SELECT COUNT(*) AS n FROM document_index WHERE file = ?").get("Notes/kube.md")).n, 0);
    check("nothing is indexed twice",
      /** @type {any} */ (handle.prepare("SELECT COUNT(*) AS n FROM documents_fts").get()).n,
      /** @type {any} */ (handle.prepare("SELECT COUNT(*) AS n FROM document_index").get()).n);
  }

  console.log("=== the recycle bin is not the library ===");
  {
    const binDir = path.join(dir, "bin");
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, "old.md"), "a retired document about deploys\n");
    const binDocs = [{ file: "old.md", title: "Old", folderName: "", size: 33, updatedAt: fs.statSync(path.join(binDir, "old.md")).mtime.toISOString() }];
    const inBin = await indexed({ query: "retired", docs: binDocs, scopeDir: binDir, scope: "recycle-bin" });
    check("a search of the bin finds what is in the bin", order(inBin), ["old.md"]);
    const inLibrary = await indexed({ query: "retired", docs: listDocs(docsDir), scopeDir: docsDir });
    check("...and a search of the library does not", order(inLibrary), []);
  }

  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(finish());
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
