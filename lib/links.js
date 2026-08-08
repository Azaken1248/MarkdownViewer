/* Saved links.
 *
 * A link is a URL plus whatever the page said about itself when it was added.
 * The metadata is a snapshot, not a live read: a card must render from disk
 * without touching the network, or opening the section would fire a request at
 * every site in the list. Refreshing is a deliberate action.
 *
 * Same storage shape as the other stores here — one JSON file, written whole
 * and atomically, with a write lock so two requests cannot interleave a
 * read-modify-write and lose one of them.
 */

const crypto = require("crypto");
const fsp = require("fs/promises");
const path = require("path");

const LINKS_VERSION = 1;
const MAX_LINKS = 2000;
const MAX_NOTE_LENGTH = 500;

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

// Two URLs that differ only by a trailing slash or by case in the host are the
// same page, and saving both is clutter rather than a feature.
function canonicalKey(url) {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${pathname}${parsed.search}`;
  } catch {
    return String(url);
  }
}

class LinkStore {
  constructor({ dataDir }) {
    this.filePath = path.join(dataDir, "links.json");
    this.links = [];
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
      this.links = Array.isArray(parsed.links) ? parsed.links : [];
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }

      this.links = [];
    }
  }

  async save() {
    await writeJsonAtomic(this.filePath, { version: LINKS_VERSION, links: this.links });
  }

  list() {
    return [...this.links].sort((left, right) =>
      String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
  }

  find(id) {
    return this.links.find((link) => link.id === id) || null;
  }

  findByUrl(url) {
    const key = canonicalKey(url);
    return this.links.find((link) => canonicalKey(link.url) === key) || null;
  }

  async create(preview, { createdBy = null, note = "" } = {}) {
    if (this.links.length >= MAX_LINKS) {
      const error = new Error(`This library holds at most ${MAX_LINKS} links.`);
      error.status = 400;
      throw error;
    }

    const existing = this.findByUrl(preview.url);
    if (existing) {
      const error = new Error("That link is already saved.");
      error.status = 409;
      error.existingId = existing.id;
      throw error;
    }

    const link = {
      id: crypto.randomBytes(9).toString("base64url"),
      url: preview.url,
      resolvedUrl: preview.resolvedUrl || null,
      title: preview.title || "",
      description: preview.description || "",
      siteName: preview.siteName || "",
      note: String(note || "").slice(0, MAX_NOTE_LENGTH),
      fetched: Boolean(preview.fetched),
      fetchError: preview.error || null,
      createdAt: new Date().toISOString(),
      createdBy,
      refreshedAt: preview.fetchedAt || null
    };

    this.links.push(link);
    await this.save();
    return link;
  }

  // Used both by "refresh" (new metadata from the page) and by editing the card
  // by hand, which is the escape hatch for a site whose own title is useless.
  async update(id, changes) {
    const link = this.find(id);
    if (!link) {
      return null;
    }

    for (const key of ["title", "description", "siteName", "note"]) {
      if (typeof changes[key] === "string") {
        link[key] = changes[key].slice(0, key === "note" ? MAX_NOTE_LENGTH : 600);
      }
    }

    if (typeof changes.fetched === "boolean") {
      link.fetched = changes.fetched;
      link.fetchError = changes.error || null;
      link.refreshedAt = changes.fetchedAt || new Date().toISOString();
      link.resolvedUrl = changes.resolvedUrl || null;
    }

    await this.save();
    return link;
  }

  async remove(id) {
    const before = this.links.length;
    this.links = this.links.filter((link) => link.id !== id);

    if (this.links.length === before) {
      return false;
    }

    await this.save();
    return true;
  }
}

module.exports = { LinkStore, canonicalKey, MAX_LINKS, MAX_NOTE_LENGTH };
