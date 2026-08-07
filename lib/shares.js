// Per-document public share links.
//
// With PUBLIC_READS off, the whole app sits behind a login. A share link is the
// deliberate exception: one document, published at an unguessable URL, rendered
// on its own page with no explorer, no editor and no way to reach anything else.
//
// The share id is a 32-byte random token, so the URL *is* the credential. That
// means:
//   * it is stored hashed, so a leak of shares.json does not publish anything;
//   * the full token is returned exactly once, when the link is created;
//   * revoking is deleting the record, and rotating is revoke-then-create.
//
// Share pages are marked noindex, because "unguessable" stops being true the
// moment a crawler files it.

const crypto = require("crypto");
const fsp = require("fs/promises");
const path = require("path");

const SHARES_VERSION = 1;
const SHARE_TOKEN_BYTES = 32;

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

async function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  let handle = null;

  try {
    handle = await fsp.open(tempPath, "w");
    await handle.writeFile(JSON.stringify(value, null, 2), "utf8");
    await handle.sync();
  } finally {
    await handle?.close();
  }

  try {
    await fsp.rename(tempPath, filePath);
  } catch (error) {
    await fsp.unlink(tempPath).catch(() => {});
    throw error;
  }
}

class ShareStore {
  constructor({ dataDir }) {
    this.filePath = path.join(dataDir, "shares.json");
    this.shares = [];
    this.writeLock = Promise.resolve();
  }

  async withLock(fn) {
    const run = this.writeLock.then(fn, fn);
    this.writeLock = run.then(() => {}, () => {});
    return run;
  }

  async load() {
    try {
      const parsed = JSON.parse(await fsp.readFile(this.filePath, "utf8"));
      this.shares = Array.isArray(parsed.shares) ? parsed.shares : [];
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }

      this.shares = [];
    }
  }

  async save() {
    await writeJsonAtomic(this.filePath, { version: SHARES_VERSION, shares: this.shares });
  }

  findByFile(file) {
    return this.shares.find((share) => share.file === file) || null;
  }

  findByToken(token) {
    if (!token) {
      return null;
    }

    return this.shares.find((share) => share.tokenHash === hashToken(token)) || null;
  }

  // A document's share state as the API reports it. Never includes the token —
  // that is only ever returned by create().
  describe(file) {
    const share = this.findByFile(file);
    if (!share) {
      return { shared: false };
    }

    return {
      shared: true,
      createdAt: share.createdAt,
      createdBy: share.createdBy || null,
      views: share.views || 0,
      lastViewedAt: share.lastViewedAt || null
    };
  }

  // Creating a share for a document that already has one rotates it: the old
  // URL stops working immediately. That is the only way to "un-leak" a link.
  async create(file, { createdBy = null } = {}) {
    const token = crypto.randomBytes(SHARE_TOKEN_BYTES).toString("base64url");

    this.shares = this.shares.filter((share) => share.file !== file);
    this.shares.push({
      file,
      tokenHash: hashToken(token),
      createdAt: new Date().toISOString(),
      createdBy,
      views: 0,
      lastViewedAt: null
    });

    await this.save();
    return token;
  }

  async revoke(file) {
    const before = this.shares.length;
    this.shares = this.shares.filter((share) => share.file !== file);

    if (this.shares.length === before) {
      return false;
    }

    await this.save();
    return true;
  }

  // Renaming a document must carry its share across, or the link 404s with no
  // explanation. Deleting one must revoke it, or a soft-deleted document stays
  // readable by anyone holding the URL.
  async rename(fromFile, toFile) {
    const share = this.findByFile(fromFile);
    if (!share) {
      return false;
    }

    share.file = toFile;
    await this.save();
    return true;
  }

  async recordView(file) {
    const share = this.findByFile(file);
    if (!share) {
      return;
    }

    share.views = (share.views || 0) + 1;
    share.lastViewedAt = new Date().toISOString();
    await this.save();
  }

  listShares() {
    return this.shares
      .slice()
      .sort((left, right) => String(left.file).localeCompare(String(right.file)))
      .map((share) => ({
        file: share.file,
        createdAt: share.createdAt,
        createdBy: share.createdBy || null,
        views: share.views || 0,
        lastViewedAt: share.lastViewedAt || null
      }));
  }
}

module.exports = { ShareStore, hashToken };
