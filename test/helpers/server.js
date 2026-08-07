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
const WRITE_TOKEN = "test-token-do-not-use-in-production";

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

function request(origin, method, pathname, body) {
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
          Authorization: `Bearer ${WRITE_TOKEN}`,
          ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {})
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
          resolve({ status: res.statusCode, body: parsed, raw: data });
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

async function seed(origin) {
  const folderIds = new Map();

  for (const folder of FOLDERS) {
    const res = await request(origin, "POST", "/api/folders", {
      name: folder.name,
      parentId: folder.parent ? folderIds.get(folder.parent) : null
    });

    if (res.status !== 201) {
      throw new Error(`Seeding folder "${folder.name}" failed: ${res.status} ${res.raw}`);
    }

    folderIds.set(folder.name, res.body.folder.id);
  }

  const documents = [
    ...DOCS,
    ...Array.from({ length: PAGED_DOC_COUNT }, (_, i) => ({
      file: `paged-${String(i).padStart(3, "0")}.md`,
      folder: PAGED_FOLDER,
      body: `# Paged ${i}\n\nFiller document so the tree has more than one page.\n`
    }))
  ];

  for (const document of documents) {
    const res = await request(origin, "POST", "/api/docs", {
      fileName: document.file,
      content: document.body,
      folderId: document.folder ? folderIds.get(document.folder) : null
    });

    if (res.status !== 201) {
      throw new Error(`Seeding document "${document.file}" failed: ${res.status} ${res.raw}`);
    }
  }

  return folderIds;
}

async function startTestServer() {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "azadocs-test-"));
  const port = await findFreePort();
  const origin = `http://127.0.0.1:${port}`;

  const child = spawn(process.execPath, [path.join(REPO_ROOT, "server.js")], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      MDVIEWER_STATE_DIR: stateDir,
      MDVIEWER_TOKEN: WRITE_TOKEN,
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

    // Guard against ever deleting something outside the temp directory.
    if (stateDir.startsWith(os.tmpdir()) && fsSync.existsSync(stateDir)) {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  }

  try {
    await Promise.race([waitForHealth(origin), exitedEarly]);
    const folderIds = await seed(origin);
    return { origin, stateDir, token: WRITE_TOKEN, folderIds, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

module.exports = { startTestServer, WRITE_TOKEN };
