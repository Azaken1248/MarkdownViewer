/* Who may do what, and where.
 *
 * Authorization used to be three global roles and nothing else: a signed-in
 * account saw the whole library at one of three levels. This is the middle
 * case — *these people, these documents* — and it is the thing an identity
 * provider's groups are eventually mapped onto.
 *
 * The evaluation order is AWS IAM's, because it is the one model in wide use
 * that is explicit about the order of operations and can therefore be traced
 * rather than argued about. Three properties are copied exactly:
 *
 *   1. Deny by default. Nothing is permitted unless something permits it.
 *   2. An explicit deny beats everything, whatever else applies and wherever
 *      it sits. Not "the nearest statement wins" — there is no ordering by
 *      specificity at all, which is what makes the answer independent of how
 *      the statements happen to be arranged.
 *   3. A boundary intersects rather than grants. The global role is one: a
 *      viewer granted write on a space still cannot write, and the role table
 *      in lib/auth.js keeps meaning exactly what it says.
 *
 * Nothing here enforces anything yet. This module answers questions; the
 * routes that ask them come next.
 *
 * `decide` is deliberately pure — statements in, a decision and its reason
 * out, no database and no clock of its own. That is what lets the suite be a
 * decision table rather than a set of scenarios, and a decision table is how
 * this kind of logic is checked everywhere it is taken seriously.
 */

const crypto = require("crypto");
const fs = require("fs");
const { ROLE_PERMISSIONS } = require("./auth");
const { noAudit } = require("./audit");

/* What a level lets a subject do.
 *
 * The levels are a ladder, so the actions are cumulative. `doc:erase` sits
 * under `manage` rather than being left out: an admin's access is an ordinary
 * statement here, so an action no level allows is an action no admin has
 * either. The role boundary is what keeps it admin-only — `doc:erase` is not
 * in any other role.
 *
 * `user:manage` is deliberately absent and always will be. It is not about
 * documents, so it is not a question this module answers: it stays a role
 * permission, checked where it always was.
 */
const ALLOWED_BY = {
  read: ["doc:read"],
  write: ["doc:read", "doc:write"],
  manage: ["doc:read", "doc:write", "share:manage", "doc:erase"]
};

/* ...and what a level at the other effect takes away.
 *
 * Not the same table reversed, and the asymmetry is the point. An allow is
 * read downwards — `manage` implies the lesser actions — while a deny is read
 * *upwards*: denying read denies everything, because "may not read this" is not
 * a sentence that leaves writing available. Denying write leaves reading
 * alone, which is how a space is made read-only for somebody.
 */
const DENIED_BY = {
  read: ["doc:read", "doc:write", "share:manage", "doc:erase"],
  write: ["doc:write", "share:manage", "doc:erase"],
  manage: ["share:manage", "doc:erase"]
};

const LEVELS = ["read", "write", "manage"];

/* The action a level is *for*, rather than every action it implies.
 *
 * "May this person manage here" is the share:manage question. Named rather
 * than taken from the end of ALLOWED_BY, because the end of that list is
 * `doc:erase` — which only one role carries, so asking it would report every
 * editor's `manage` as `write`.
 */
const LEVEL_ACTION = { read: "doc:read", write: "doc:write", manage: "share:manage" };
const ROOT_SPACE_DIR = "";
const EVERYONE_GROUP = "everyone";

const newId = (prefix) => `${prefix}_${crypto.randomBytes(8).toString("hex")}`;

/* A path this cannot reduce.
 *
 * `..` and `.` are not names: a path containing either does not say where the
 * document is, it says where to look from somewhere else. `Public/../Secret/
 * notes.md` names a document in Secret and would be attributed to the space
 * called Public, which is a deny on Secret walked straight around.
 *
 * Nothing routes such a path here today — lib/docs/paths.js rebuilds every
 * path segment by segment and refuses what escapes the library, long before a
 * permission is asked about. This is not that check repeated. It is this
 * layer declining to decide about input it cannot reduce, because a security
 * boundary that is only correct while its callers are correct is one bug away
 * from not being a boundary.
 */
function unreducible(docPath) {
  return String(docPath || "").split("/").some((part) => part === "." || part === "..");
}

/* The scopes a document is subject to, widest last.
 *
 * A statement applies to a document if its scope is one of these. The order is
 * not consulted when deciding — deny wins wherever it sits — but it is the
 * order a reader expects to see them explained in.
 */
function scopeChain(docPath) {
  const parts = String(docPath || "").split("/").filter(Boolean);
  if (parts.length === 0) {
    return [{ space: ROOT_SPACE_DIR, prefix: null }, { space: null, prefix: null }];
  }

  // A document with no directory at all belongs to the reserved space, whose
  // directory name is the empty string.
  const dir = parts.length === 1 ? ROOT_SPACE_DIR : parts[0];
  const rest = parts.length === 1 ? parts : parts.slice(1);

  const chain = [];
  // Every prefix of the path inside the space, narrowest first: a statement
  // can name a single document as readily as a folder.
  for (let taken = rest.length; taken > 0; taken -= 1) {
    chain.push({ space: dir, prefix: rest.slice(0, taken).join("/") });
  }

  chain.push({ space: dir, prefix: null });
  chain.push({ space: null, prefix: null });
  return chain;
}

const sameScope = (statement, scope) =>
  (statement.space || null) === (scope.space === ROOT_SPACE_DIR ? ROOT_SPACE_DIR : scope.space || null)
  && (statement.prefix || null) === (scope.prefix || null);

const scopeName = (scope) => {
  if (scope.space === null) {
    return "<root>";
  }

  const space = scope.space === ROOT_SPACE_DIR ? "<ungrouped>" : scope.space;
  return scope.prefix ? `${space}/${scope.prefix}` : space;
};

const principalName = (statement) => statement.subject.kind === "public"
  ? "public"
  : `${statement.subject.kind}:${statement.subject.id}`;

/** The one-line rendering. Read, never parsed: see PERMISSIONS_PLAN.md. */
function renderStatement(statement) {
  const scope = scopeName({ space: statement.space ?? null, prefix: statement.prefix ?? null });
  const until = statement.expires ? ` until ${String(statement.expires).slice(0, 10)}` : "";
  return `${statement.effect} ${statement.level} ${principalName(statement)} on ${scope}${until}`;
}

const expired = (statement, now) =>
  Boolean(statement.expires) && new Date(statement.expires).getTime() <= now;

function namesSubject(statement, subjects) {
  if (statement.subject.kind === "public") {
    return subjects.some((one) => one.kind === "public");
  }

  return subjects.some((one) => one.kind === statement.subject.kind && one.id === statement.subject.id);
}

/* The boundary, before any statement is read.
 *
 * A role that does not carry an action cannot be given it by a space, which is
 * what keeps the role table the truth about what an account can do. Returns
 * the refusal, or null when the role is not what refuses.
 */
function boundaryRefusal(user, action) {
  if (!user) {
    // A request with no account is the public principal, which has no role and
    // therefore no boundary. The statements written for it are the whole of
    // what it may do.
    return null;
  }

  if (user.disabled) {
    return { allowed: false, reason: "the account is disabled", considered: [] };
  }

  const boundary = ROLE_PERMISSIONS[user.role] || [];
  if (boundary.includes(action)) {
    return null;
  }

  return {
    allowed: false,
    reason: `role boundary: a ${user.role} may not ${action}`,
    boundary,
    considered: []
  };
}

/* Admin is not a branch in the decision.
 *
 * It is a statement like any other, so the same algorithm explains an admin's
 * access, there is no bypass to audit separately, and locking yourself out of
 * your own library is not possible: the statement is always there.
 */
function withImplicitAdmin(statements, user) {
  if (!user || user.role !== "admin") {
    return statements;
  }

  return [...statements, {
    id: "implicit_admin",
    effect: "allow",
    subject: { kind: "user", id: user.id },
    space: null,
    prefix: null,
    level: "manage",
    expires: null
  }];
}

/* Every statement that names this subject and this document, unexpired. */
function applicable({ user, groups, statements, docPath, now }) {
  const subjects = user
    ? [{ kind: "user", id: user.id }, ...groups.map((id) => ({ kind: "group", id }))]
    : [{ kind: "public" }];

  const chain = scopeChain(docPath);

  return withImplicitAdmin(statements, user).filter((statement) =>
    namesSubject(statement, subjects)
    && !expired(statement, now)
    && chain.some((scope) => sameScope(statement, scope)));
}

/* The decision, and why.
 *
 * `user` is null for a request with no account at all, which is the public
 * principal and not a degraded account: it is subject to the statements
 * written for `public` and to no others.
 */
function decide({ user = null, groups = [], statements = [], docPath = "", action, now = Date.now() }) {
  if (unreducible(docPath)) {
    return {
      allowed: false,
      reason: `the path is not one this can decide about: ${docPath}`,
      considered: []
    };
  }

  const refused = boundaryRefusal(user, action);
  if (refused) {
    return refused;
  }

  const considered = applicable({ user, groups, statements, docPath, now });

  const denying = considered.find((one) =>
    one.effect === "deny" && DENIED_BY[one.level].includes(action));
  if (denying) {
    return { allowed: false, reason: `denied by: ${renderStatement(denying)}`, considered };
  }

  const allowing = considered.find((one) =>
    one.effect === "allow" && ALLOWED_BY[one.level].includes(action));
  if (allowing) {
    return { allowed: true, reason: `allowed by: ${renderStatement(allowing)}`, considered };
  }

  return { allowed: false, reason: "nothing grants it", considered };
}

/* The highest level that answers, which is what a user interface wants: one
 * word for what somebody may do here, rather than three questions.
 */
function effectiveLevel(parts) {
  const answers = LEVELS.map((level) => ({
    level,
    allowed: decide({ ...parts, action: LEVEL_ACTION[level] }).allowed
  }));

  const highest = [...answers].reverse().find((one) => one.allowed);
  return highest ? highest.level : "none";
}

/* --- The store ------------------------------------------------------------
 *
 * Rows in, statements out. The decision above never sees the database, and
 * this never decides anything: the split is what lets the suite check the
 * logic as a table and the storage as storage.
 */
class AccessStore {
  /** @param {{ db: any, markdownDir: string, audit?: Function }} parts */
  /* The audit hook is not optional in the sense that matters.
   *
   * Every change to who may read what is a security event, and a change to a
   * policy that leaves no trace is the one kind of change an incident review
   * cannot reconstruct. `noAudit` is the default so a suite or a tool can make
   * a store without one, and the server always passes the real thing.
   *
   * Decisions are not logged, only changes. A line per permission check would
   * be a line per request, which is a log nobody reads and a disk nobody
   * expected to fill; `explain` is how a decision is accounted for.
   */
  constructor({ db, markdownDir, audit = noAudit }) {
    this.db = db;
    this.markdownDir = markdownDir;
    this.audit = audit;
    this.cache = null;
    // Bumped by this process's own writes. SQLite's data_version covers the
    // other processes but deliberately does not move for changes made on this
    // connection, so one of the two alone would be a stale read.
    this.generation = 0;
  }

  dataVersion() {
    return this.db.pragma("data_version", { simple: true });
  }

  forget() {
    this.generation += 1;
    this.cache = null;
  }

  /* Every statement in the library, as the decision wants them.
   *
   * Cached, because this is read on the way to answering almost any request
   * and the table is small. The key is both version counters together: a
   * write here and a write from another process both invalidate it, and a
   * stale permission is the one kind of staleness that is not acceptable.
   */
  statements() {
    const key = `${this.dataVersion()}:${this.generation}`;
    if (this.cache && this.cache.key === key) {
      return this.cache.rows;
    }

    /* The join on groups is what lets everything above this work in names.
     * A group's name is unique, so the mapping is lossless, and it is what
     * makes a statement render as something a person can read — `group:
     * everyone` rather than `group:grp_5a8fe47c`. A user is still named by id,
     * because an id is what a session carries.
     */
    const rows = this.db.prepare(`
      SELECT g.id, g.effect, g.subject_kind, g.subject_id, g.path_prefix,
             g.level, g.expires_at, s.dir_name, gr.name AS group_name
        FROM grants g
        LEFT JOIN spaces s ON s.id = g.space_id
        LEFT JOIN groups gr ON gr.id = g.subject_id AND g.subject_kind = 'group'
    `).all().map((row) => ({
      id: row.id,
      effect: row.effect,
      subject: {
        kind: row.subject_kind,
        id: row.subject_kind === "group" ? row.group_name : (row.subject_id || null)
      },
      // The decision works in directory names, not space ids: it is handed a
      // document's path and nothing else.
      space: row.dir_name === undefined || row.dir_name === null ? null : row.dir_name,
      prefix: row.path_prefix || null,
      level: row.level,
      expires: row.expires_at || null
    }));

    this.cache = { key, rows };
    return rows;
  }

  listSpaces() {
    return this.db.prepare("SELECT * FROM spaces ORDER BY dir_name").all();
  }

  spaceByDir(dirName) {
    return this.db.prepare("SELECT * FROM spaces WHERE dir_name = ?").get(dirName) || null;
  }

  /* Statements naming something that no longer exists.
   *
   * The triggers in lib/db.js are what stop these being written in the first
   * place, and this is the second half of the same concern: if one ever does
   * appear — a hand-edited database, a restore from a backup made before the
   * triggers existed — it must be visible rather than quietly inert. An
   * unresolvable statement applies to nobody, which means an allow stops
   * allowing and a deny stops denying, and neither announces itself.
   */
  unresolved() {
    return this.statements().filter((one) =>
      (one.subject.kind === "group" || one.subject.kind === "user") && !one.subject.id);
  }

  deleteGroup(groupId) {
    // The trigger takes the statements; this is here so a caller has one thing
    // to call and the audit line has one place to be written.
    const group = this.db.prepare("SELECT name FROM groups WHERE id = ?").get(groupId);
    if (!group) {
      return false;
    }

    this.db.prepare("DELETE FROM groups WHERE id = ?").run(groupId);
    this.forget();
    // Its statements went with it, by the trigger in lib/db.js: a deleted
    // group is a policy change and not only an account change.
    this.audit("access.group.deleted", { group: group.name, id: groupId });
    return true;
  }

  /* A subject as the log and the statements list spell it.
   *
   * A caller writes a statement against a group's *id*, because that is what
   * the row holds; everything a person reads says the *name*. statements()
   * does that mapping with a join, and an audit line has to do the same one or
   * the log is full of `group:grp_fc72f0b9` — which the suite caught.
   */
  named(subject) {
    if (subject.kind !== "group") {
      return subject;
    }

    const group = this.db.prepare("SELECT name FROM groups WHERE id = ?").get(subject.id);
    return { kind: "group", id: group ? group.name : subject.id };
  }

  listGroups() {
    return this.db.prepare("SELECT * FROM groups ORDER BY name").all();
  }

  groupByName(name) {
    return this.db.prepare("SELECT * FROM groups WHERE name = ?").get(name) || null;
  }

  /* The groups an account is in, by name.
   *
   * `everyone` is answered rather than stored per account: a group whose
   * membership is "every account, including the ones made later" is a fact
   * about the account table, and writing a row per user would be a second
   * copy of it that can disagree.
   */
  groupsOf(userId) {
    const named = this.db.prepare(`
      SELECT gr.name FROM group_members gm
        JOIN groups gr ON gr.id = gm.group_id
       WHERE gm.user_id = ?
    `).all(userId).map((row) => row.name);

    return named.includes(EVERYONE_GROUP) ? named : [EVERYONE_GROUP, ...named];
  }

  /** The decision for a real account against a real document. */
  decide(user, docPath, action, now = Date.now()) {
    return decide({
      user,
      groups: user ? this.groupsOf(user.id) : [],
      statements: this.statements(),
      docPath,
      action,
      now
    });
  }

  effectiveLevel(user, docPath, now = Date.now()) {
    return effectiveLevel({
      user,
      groups: user ? this.groupsOf(user.id) : [],
      statements: this.statements(),
      docPath,
      now
    });
  }

  /** A predicate for a list, so a collection is filtered rather than guarded. */
  allowFilter(user, action = "doc:read", now = Date.now()) {
    const groups = user ? this.groupsOf(user.id) : [];
    const statements = this.statements();
    return (docPath) => decide({ user, groups, statements, docPath, action, now }).allowed;
  }

  /* Which spaces to show at all.
   *
   * A space is visible if **anything** in it can be read, not only if the
   * whole of it can. A space granted at one folder — `allow read on
   * Elections/06-release` and nothing wider — was invisible, which made the
   * one thing somebody could read unreachable: this is the tree's half of
   * the same rule, that an ancestor of something visible has to be visible or
   * the child cannot be got to.
   *
   * Asked of the scopes that statements actually name, rather than of a made
   * up filename. The earlier version probed `<space>/.probe`, which answered
   * for the space and the root and missed every statement set deeper — and
   * would have collided with a real document called `.probe`.
   */
  visibleSpaces(user, now = Date.now()) {
    const allowed = this.allowFilter(user, "doc:read", now);
    const prefixes = new Map();

    for (const statement of this.statements()) {
      if (statement.space === null) {
        continue;
      }

      const here = prefixes.get(statement.space) || new Set();
      // A document immediately inside the scope the statement names, which is
      // the cheapest path whose chain contains that scope.
      here.add(statement.prefix ? `${statement.prefix}/a` : "a");
      prefixes.set(statement.space, here);
    }

    return new Set(this.listSpaces().filter((space) => {
      const within = [...(prefixes.get(space.dir_name) || new Set()), "a"];
      return within.some((rest) =>
        allowed(space.dir_name ? `${space.dir_name}/${rest}` : rest));
    }).map((space) => space.id));
  }

  /* --- the one migration -------------------------------------------------
   *
   * A space per top-level directory, the reserved space for documents that are
   * in no directory, the `everyone` group, and one statement at the root.
   *
   * That statement is what reconciles deny-by-default with this repository's
   * rule that a migration does not take anything away. It is written at
   * `manage` rather than at `write` deliberately: an editor can manage a share
   * link on any document today, and `write` would have quietly removed that.
   * The role boundary is what makes one broad statement safe — a viewer in
   * `everyone` still only reads, and `doc:erase` stays with the one role that
   * carries it.
   *
   * Idempotent in every part, so it is safe on a database that has had it.
   */
  ensureBaseline({ actor = null, directories = null } = {}) {
    const now = new Date().toISOString();
    const dirs = directories || this.topLevelDirectories();
    const added = [];
    let statementWritten = null;

    this.db.transaction(() => {
      // The reserved space first, and named the way the tree already names
      // documents that are in no folder.
      if (!this.spaceByDir(ROOT_SPACE_DIR)) {
        this.insertSpace({ dirName: ROOT_SPACE_DIR, name: "Ungrouped", actor, now });
        added.push(ROOT_SPACE_DIR);
      }

      for (const dirName of dirs) {
        if (!this.spaceByDir(dirName)) {
          this.insertSpace({ dirName, name: dirName, actor, now });
          added.push(dirName);
        }
      }

      const everyone = this.groupByName(EVERYONE_GROUP) || this.insertGroup(EVERYONE_GROUP, now);

      // INSERT OR IGNORE against the uniqueness of (effect, subject, scope,
      // level): running this twice writes one statement, not two.
      const wrote = this.db.prepare(`
        INSERT OR IGNORE INTO grants
          (id, effect, subject_kind, subject_id, space_id, path_prefix, level,
           expires_at, granted_by, granted_at)
        VALUES (?, 'allow', 'group', ?, NULL, NULL, 'manage', NULL, ?, ?)
      `).run(newId("stmt"), everyone.id, actor, now).changes;

      // Audited here rather than left to `write`, because this insert is the
      // one that has to be idempotent and so cannot go through it. A migration
      // that opens the whole library to everyone is the single most consequential
      // line this log will ever carry; it was missing until the suite asked.
      if (wrote > 0) {
        statementWritten = renderStatement({
          effect: "allow",
          subject: { kind: "group", id: EVERYONE_GROUP },
          space: null,
          prefix: null,
          level: "manage",
          expires: null
        });
      }
    }).immediate();

    this.forget();

    if (added.length > 0) {
      this.audit("access.baseline", { spaces: added.length, actor });
    }

    if (statementWritten) {
      this.audit("access.statement.written", { statement: statementWritten, actor });
    }

    return { spacesAdded: added, statementWritten };
  }

  topLevelDirectories() {
    try {
      return fs.readdirSync(this.markdownDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        // Nothing a document path can start with, so nothing a statement
        // could be written against.
        .filter((name) => !name.startsWith("."));
    } catch {
      // A library directory that is not there yet is a library with no spaces
      // in it, which is a state the first boot is allowed to be in.
      return [];
    }
  }

  insertSpace({ dirName, name, actor, now }) {
    const id = newId("spc");
    this.db.prepare(`
      INSERT INTO spaces (id, name, dir_name, description, public_links_allowed, created_at, created_by)
      VALUES (?, ?, ?, '', 1, ?, ?)
    `).run(id, name, dirName, now, actor);
    this.forget();
    this.audit("access.space.created", { space: dirName || "<ungrouped>", id, actor });
    return this.spaceByDir(dirName);
  }

  insertGroup(name, now = new Date().toISOString(), source = "local", externalId = null) {
    this.db.prepare(`
      INSERT INTO groups (id, name, source, external_id, created_at) VALUES (?, ?, ?, ?, ?)
    `).run(newId("grp"), name, source, externalId, now);
    this.forget();
    this.audit("access.group.created", { group: name, source });
    return this.groupByName(name);
  }

  addMember(groupId, userId, source = "local") {
    this.db.prepare(`
      INSERT OR IGNORE INTO group_members (group_id, user_id, source, added_at)
      VALUES (?, ?, ?, ?)
    `).run(groupId, userId, source, new Date().toISOString());
    this.forget();
    this.audit("access.group.joined", { group: groupId, user: userId, source });
  }

  /* Writing a statement.
   *
   * Only the shape is settled here; who is permitted to write one is the
   * per-space delegation, and it lives with the routes that offer it.
   */
  write({ effect, subject, spaceDir = null, prefix = null, level, expires = null, actor = null }) {
    const space = spaceDir === null ? null : this.spaceByDir(spaceDir);
    if (spaceDir !== null && !space) {
      return { ok: false, error: `No space owns the directory "${spaceDir}".` };
    }

    const id = newId("stmt");
    this.db.prepare(`
      INSERT OR IGNORE INTO grants
        (id, effect, subject_kind, subject_id, space_id, path_prefix, level,
         expires_at, granted_by, granted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, effect, subject.kind, subject.id || null, space ? space.id : null,
      prefix, level, expires, actor, new Date().toISOString());

    this.forget();

    // The rendering, so the log reads as the policy rather than as a row: one
    // line per change, in the same words the statements list shows.
    this.audit("access.statement.written", {
      statement: renderStatement({
        effect, subject: this.named(subject), space: spaceDir, prefix, level, expires
      }),
      id,
      actor
    });

    return { ok: true, id };
  }

  remove(statementId) {
    // Read before it goes, so the line says what was taken away rather than
    // only that something was. Looked up first and deleted after, so there is
    // one path through here and no branch that cannot happen.
    const going = this.statements().find((one) => one.id === statementId);
    if (!going) {
      return false;
    }

    this.db.prepare("DELETE FROM grants WHERE id = ?").run(statementId);
    this.forget();
    this.audit("access.statement.removed", { statement: renderStatement(going), id: statementId });
    return true;
  }
}

module.exports = {
  AccessStore,
  decide,
  effectiveLevel,
  scopeChain,
  scopeName,
  unreducible,
  renderStatement,
  newId,
  ALLOWED_BY,
  DENIED_BY,
  LEVEL_ACTION,
  LEVELS,
  ROOT_SPACE_DIR,
  EVERYONE_GROUP
};
