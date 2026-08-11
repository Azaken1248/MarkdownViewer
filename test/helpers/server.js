// Spins up a real server against a throwaway state directory.
//
// The DOM suite used to run against whatever was on port 4321, which meant it
// could only ever be read-only (the write paths went untested) and it depended
// on the operator's own documents happening to look a certain way. This seeds a
// known corpus instead, so the whole suite runs everywhere including CI, and a
// test can never touch a real document: MDVIEWER_STATE_DIR points the server's
// documents, recycle bin and organizer at a temp directory that is deleted
// afterwards.

const fs = require("fs/promises");
const fsSync = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const REPO_ROOT = path.join(__dirname, "..", "..");

// The password the seeded admin starts with. Public by construction — it is in
// the source and in the README — which is exactly why the app forces it to be
// changed at first sign-in.
const SEED_USERNAME = "aza";
const SEED_PASSWORD = "lolface123";
// What the DOM suite changes it to, so it can get past the forced change.
const TEST_PASSWORD = "harness-password-9134";

// Folder tree the DOM suite expects. Six levels deep so the breadcrumb overflow
// has something to fold, plus a sibling to paste into.
const FOLDERS = [
  { name: "Projects", parent: null },
  { name: "Cart", parent: "Projects" },
  { name: "Frontend", parent: "Cart" },
  { name: "Components", parent: "Frontend" },
  { name: "Design", parent: "Components" },
  { name: "Tokens", parent: "Design" },
  { name: "Notes", parent: null }
];

const DOCS = [
  // Deepest folder, so its breadcrumb trail is long enough to overflow.
  { file: "alpha.md", folder: "Tokens", body: "# Alpha\n\nDeepest document in the fixture tree.\n" },
  // Unfiled, so it exercises the two-crumb trail.
  { file: "beta.md", folder: null, body: "# Beta\n\nA top-level document.\n" },
  // Adjacent siblings, for shift-range selection and cut/paste.
  { file: "delta.md", folder: "Projects", body: "# Delta\n\nSelection fixture.\n" },
  { file: "epsilon.md", folder: "Projects", body: "# Epsilon\n\nSelection fixture.\n" }
];

// One folder needs more than DOC_LIST_PAGE_SIZE (50) rows for the paging check.
const PAGED_FOLDER = "Cart";
const PAGED_DOC_COUNT = 55;

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function request(origin, method, pathname, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, origin);
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
          ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
          ...headers
        }
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          let parsed = null;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = null;
          }
          resolve({ status: res.statusCode, body: parsed, raw: data, headers: res.headers });
        });
      }
    );
    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function waitForHealth(origin, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await request(origin, "GET", "/healthz");
      if (res.status === 200) {
        return;
      }
    } catch {
      // Not listening yet.
    }

    await new Promise((r) => setTimeout(r, 120));
  }

  throw new Error(`Server did not become healthy within ${timeoutMs}ms`);
}

// Seeding happens on disk, before the server starts, rather than over the API.
// Two reasons: it needs no credentials, so the accounts file stays exactly as a
// first boot leaves it (which is what the auth suite is there to check), and it
// is a great deal faster than 59 HTTP round trips.
async function seedOnDisk(stateDir) {
  const docsDir = path.join(stateDir, "docs");
  const dataDir = path.join(stateDir, "data");
  await fs.mkdir(docsDir, { recursive: true });
  await fs.mkdir(dataDir, { recursive: true });

  const now = new Date().toISOString();
  const folderIds = new Map();
  const folders = FOLDERS.map((folder, index) => {
    const id = `folder_test_${index}`;
    folderIds.set(folder.name, id);
    return { id, name: folder.name, order: index, createdAt: now, updatedAt: now };
  });

  for (const folder of FOLDERS) {
    const record = folders.find((entry) => entry.name === folder.name);
    record.parentId = folder.parent ? folderIds.get(folder.parent) : null;
  }

  const documents = [
    ...DOCS,
    ...Array.from({ length: PAGED_DOC_COUNT }, (_, i) => ({
      file: `paged-${String(i).padStart(3, "0")}.md`,
      folder: PAGED_FOLDER,
      body: `# Paged ${i}\n\nFiller document so the tree has more than one page.\n`
    }))
  ];

  // Folders are real directories, so the fixture writes documents where they
  // actually live. The organizer carries the tree (ids, order, nesting); a
  // document's folder is read off its path.
  const dirFor = (name) => {
    const parts = [];
    let current = folders.find((entry) => entry.name === name);
    while (current) {
      parts.unshift(current.name);
      current = current.parentId ? folders.find((entry) => entry.id === current.parentId) : null;
    }
    return parts.join("/");
  };

  const docPaths = {};
  for (const document of documents) {
    const dir = document.folder ? dirFor(document.folder) : "";
    const relative = dir ? `${dir}/${document.file}` : document.file;
    await fs.mkdir(path.join(docsDir, dir), { recursive: true });
    await fs.writeFile(path.join(docsDir, relative), document.body, "utf8");
    docPaths[document.file] = relative;
  }

  // Empty of files but present in the tree, so a folder with no documents is
  // exercised too.
  for (const folder of FOLDERS) {
    await fs.mkdir(path.join(docsDir, dirFor(folder.name)), { recursive: true });
  }

  await fs.writeFile(
    path.join(dataDir, "document-organizer.json"),
    JSON.stringify({ version: 2, folders, fileFolders: {} }, null, 2),
    "utf8"
  );

  return { folderIds, docPaths };
}

/* Spawn a server.
 *
 * `stateDir` lets a caller supply a directory it has already laid out, which is
 * how the migration is tested: an old flat library is written to disk and a
 * fresh server is pointed at it, exactly as the real data was.
 */
async function startTestServer({ stateDir: existingStateDir = null } = {}) {
  const stateDir = existingStateDir || await fs.mkdtemp(path.join(os.tmpdir(), "azadocs-test-"));
  const { folderIds, docPaths } = existingStateDir
    ? { folderIds: new Map(), docPaths: {} }
    : await seedOnDisk(stateDir);
  const port = await findFreePort();
  const origin = `http://127.0.0.1:${port}`;

  const child = spawn(process.execPath, [path.join(REPO_ROOT, "server.js")], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      MDVIEWER_STATE_DIR: stateDir,
      // The suite prints its own output; per-request lines just bury it.
      LOG_REQUESTS: "false"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const startupLog = [];
  child.stdout.on("data", (chunk) => startupLog.push(String(chunk)));
  child.stderr.on("data", (chunk) => startupLog.push(String(chunk)));

  const exitedEarly = new Promise((_, reject) => {
    child.once("exit", (code) => {
      reject(new Error(`Server exited before becoming ready (code ${code}):\n${startupLog.join("")}`));
    });
  });

  async function stop() {
    if (!child.killed && child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 5000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }

    // Guard against ever deleting something outside the temp directory, and
    // never delete a directory the caller made and still owns.
    if (!existingStateDir && stateDir.startsWith(os.tmpdir()) && fsSync.existsSync(stateDir)) {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  }

  try {
    await Promise.race([waitForHealth(origin), exitedEarly]);
    return { origin, stateDir, folderIds, docPaths, stop, request: (m, p, b, h) => request(origin, m, p, b, h) };
  } catch (error) {
    await stop();
    throw error;
  }
}

module.exports = { startTestServer, SEED_USERNAME, SEED_PASSWORD, TEST_PASSWORD };
