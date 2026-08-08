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

// Groups are labels, not folders: a link can be in several, because a page
// about the osu! render API belongs under both "osu" and "APIs" and picking one
// is a decision nobody wants to make while pasting a URL.
const MAX_GROUPS_PER_LINK = 8;
const MAX_GROUP_LENGTH = 40;

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

/* Clean up whatever came in and hand back a list of group names.
 *
 * Accepts an array or a comma-separated string, because the dialog offers a
 * single field ("osu, APIs") and the API takes a list. Dedupes without regard
 * to case, so typing "osu" when "OSU" already exists joins that group rather
 * than starting a second one beside it, but keeps the spelling first used —
 * the alternative is lowercasing everyone's labels for them.
 */
function normalizeGroups(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value == null ? "" : value).split(",");

  const seen = new Map();

  for (const entry of raw) {
    const name = String(entry || "").replace(/\s+/g, " ").trim().slice(0, MAX_GROUP_LENGTH);
    if (!name) {
      continue;
    }

    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, name);
    }

    if (seen.size >= MAX_GROUPS_PER_LINK) {
      break;
    }
  }

  return [...seen.values()];
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

  // Every group in use, with how many links are in each. The chip bar is built
  // from this rather than from a separate list of groups, so a group exists
  // exactly as long as something is in it and there is nothing to tidy up.
  groups() {
    const counts = new Map();

    for (const link of this.links) {
      for (const name of link.groups || []) {
        const key = name.toLowerCase();
        const existing = counts.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          counts.set(key, { name, count: 1 });
        }
      }
    }

    return [...counts.values()].sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
  }

  async create(preview, { createdBy = null, note = "", groups = [] } = {}) {
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
      groups: normalizeGroups(groups),
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

    // undefined means "leave them alone", which matters because refreshing a
    // link sends new metadata and no groups, and re-reading a page must not
    // empty the groups someone filed it under.
    if (changes.groups !== undefined) {
      link.groups = normalizeGroups(changes.groups);
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

module.exports = {
  LinkStore,
  canonicalKey,
  normalizeGroups,
  MAX_LINKS,
  MAX_NOTE_LENGTH,
  MAX_GROUPS_PER_LINK,
  MAX_GROUP_LENGTH
};
