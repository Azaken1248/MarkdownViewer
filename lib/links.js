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
const path = require("path");
const { importJsonOnce } = require("./db");

const MAX_LINKS = 2000;
const MAX_NOTE_LENGTH = 500;

// The site's icon, carried as a data URI so a card renders from disk like the
// rest of it. Base64 costs a third on top of the bytes, and lib/link-preview.js
// will not hand over more than 96KB; this is the same limit expressed here, so
// a caller that has not read that file still cannot fill the store with images.
const MAX_ICON_LENGTH = 140_000;

function normalizeIcon(value) {
  const icon = String(value || "");
  return /^data:image\/[a-z0-9+.-]+;base64,/i.test(icon) && icon.length <= MAX_ICON_LENGTH ? icon : "";
}

// Groups are labels, not folders: a link can be in several, because a page
// about the osu! render API belongs under both "osu" and "APIs" and picking one
// is a decision nobody wants to make while pasting a URL.
const MAX_GROUPS_PER_LINK = 8;
const MAX_GROUP_LENGTH = 40;

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

// A row as every caller already expects a link to look.
function toLink(row) {
  if (!row) {
    return null;
  }

  let groups = [];
  try {
    groups = JSON.parse(row.groups_json);
  } catch {
    // A row whose groups will not parse is a link with no groups, not a
    // request that fails. The card is still worth showing.
    groups = [];
  }

  return {
    id: row.id,
    url: row.url,
    resolvedUrl: row.resolved_url,
    title: row.title,
    description: row.description,
    siteName: row.site_name,
    // NULL is 'never asked' and has to come back as undefined, because that
    // is what needingIcons() looks for. See the column comment in lib/db.js.
    icon: row.icon === null ? undefined : row.icon,
    note: row.note,
    groups: Array.isArray(groups) ? groups : [],
    fetched: Boolean(row.fetched),
    fetchError: row.fetch_error,
    createdAt: row.created_at,
    createdBy: row.created_by,
    refreshedAt: row.refreshed_at
  };
}

const LINK_COLUMNS = `id, url, canonical_key, resolved_url, title, description, site_name,
  icon, note, groups_json, fetched, fetch_error, created_at, created_by, refreshed_at`;

function linkValues(link) {
  return [
    link.id, link.url, canonicalKey(link.url), link.resolvedUrl ?? null,
    link.title || "", link.description || "", link.siteName || "",
    link.icon === undefined ? null : (link.icon || ""),
    link.note || "", JSON.stringify(normalizeGroups(link.groups)),
    link.fetched ? 1 : 0, link.fetchError ?? null,
    link.createdAt, link.createdBy ?? null, link.refreshedAt ?? null
  ];
}

class LinkStore {
  /* `db` is optional. The server opens one database and hands the same handle
   * to every store, which is what makes them one transactional world. Given
   * only a dataDir this opens its own — the same contract the constructor had
   * when the store owned a file, and what lets it be used on its own.
   */
  constructor({ dataDir, db = null }) {
    this.db = db || require("./db").open(dataDir);
    this.filePath = path.join(dataDir, "links.json");
  }

  // See ShareStore.withLock: the guarantee it stood for is now the database's.
  async withLock(fn) {
    return fn();
  }

  async load() {
    importJsonOnce(this.db, {
      filePath: this.filePath,
      isEmpty: () => this.db.prepare("SELECT COUNT(*) AS n FROM links").get().n === 0,
      load: (parsed) => {
        const links = Array.isArray(parsed.links) ? parsed.links : [];
        const insert = this.db.prepare(
          `INSERT OR REPLACE INTO links (${LINK_COLUMNS})
           VALUES (${new Array(15).fill("?").join(", ")})`);
        this.db.transaction((rows) => {
          for (const link of rows) {
            insert.run(linkValues(link));
          }
        })(links);
        return links.length;
      }
    });
  }

  list() {
    return this.db.prepare("SELECT * FROM links").all()
      .map(toLink)
      .sort((left, right) =>
        String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
  }

  find(id) {
    return toLink(this.db.prepare("SELECT * FROM links WHERE id = ?").get(id));
  }

  findByUrl(url) {
    return toLink(this.db.prepare("SELECT * FROM links WHERE canonical_key = ?")
      .get(canonicalKey(url)));
  }

  // Every group in use, with how many links are in each. The chip bar is built
  // from this rather than from a separate list of groups, so a group exists
  // exactly as long as something is in it and there is nothing to tidy up.
  groups() {
    const counts = new Map();

    for (const link of this.list()) {
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

  /* Links that have never had an icon fetched at all.
   *
   * Missing, not empty. An empty string is a settled answer — the page was
   * read and offered nothing usable — so this list empties permanently once
   * every link saved before icons existed has been asked.
   */
  needingIcons() {
    return this.db.prepare("SELECT id FROM links WHERE icon IS NULL").all().map((row) => row.id);
  }

  /* Record a batch of answers, and write once.
   *
   * One save for the whole batch rather than one per link: the file is written
   * whole and fsynced, and doing that seven times over to store seven small
   * pictures is seven times the work for the same result.
   *
   * An empty answer is stored as an empty string rather than skipped, because
   * "asked, and there was none" is the thing that stops it being asked again.
   */
  async setIcons(answers) {
    // One transaction for the batch, which is what the single write it used to
    // end with was for: seven answers are one commit, not seven.
    const set = this.db.prepare(
      "UPDATE links SET icon = ? WHERE id = ?");
    return this.db.transaction((rows) => {
      let changed = 0;
      for (const { id, icon } of rows) {
        const link = this.find(id);
        if (!link) {
          continue;
        }

        set.run(normalizeIcon(icon) || link.icon || "", id);
        changed += 1;
      }

      return changed;
    })(answers);
  }

  async create(preview, { createdBy = null, note = "", groups = [] } = {}) {
    if (this.db.prepare("SELECT COUNT(*) AS n FROM links").get().n >= MAX_LINKS) {
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
      icon: normalizeIcon(preview.icon),
      note: String(note || "").slice(0, MAX_NOTE_LENGTH),
      groups: normalizeGroups(groups),
      fetched: Boolean(preview.fetched),
      fetchError: preview.error || null,
      createdAt: new Date().toISOString(),
      createdBy,
      refreshedAt: preview.fetchedAt || null
    };

    this.db.prepare(`INSERT INTO links (${LINK_COLUMNS})
      VALUES (${new Array(15).fill("?").join(", ")})`).run(linkValues(link));
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

    // An icon that came back empty means the fetch did not manage one this
    // time, not that the site has stopped having one — a timeout on a refresh
    // should not strip the picture off a card that was fine a minute ago. So
    // only a real icon replaces what is there.
    if (typeof changes.icon === "string") {
      link.icon = normalizeIcon(changes.icon) || link.icon || "";
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

    // The whole row, because the block above has been editing a copy of it and
    // this is where that copy becomes the record.
    this.db.prepare(`INSERT OR REPLACE INTO links (${LINK_COLUMNS})
      VALUES (${new Array(15).fill("?").join(", ")})`).run(linkValues(link));
    return link;
  }

  async remove(id) {
    return this.db.prepare("DELETE FROM links WHERE id = ?").run(id).changes > 0;
  }
}

module.exports = {
  LinkStore,
  canonicalKey,
  normalizeGroups,
  normalizeIcon,
  MAX_ICON_LENGTH,
  MAX_LINKS,
  MAX_NOTE_LENGTH,
  MAX_GROUPS_PER_LINK,
  MAX_GROUP_LENGTH
};
