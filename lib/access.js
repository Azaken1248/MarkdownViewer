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

/* A space, as something two scopes can be compared by.
 *
 * `null` is the root — the whole library — and `""` is the reserved space
 * holding the documents that are in no directory. Both are falsy and they are
 * not the same scope, which is why this is a named step rather than `|| null`
 * on each side: that reduced the empty string to null on the statement's side
 * only, so a statement about the reserved space read as one about the root
 * (closing the whole library) while a statement about one loose document
 * matched nothing at all.
 */
const spaceOf = (space) => (space === null || space === undefined ? null : String(space));

const sameScope = (statement, scope) =>
  spaceOf(statement.space) === spaceOf(scope.space)
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

  /* What a question is asked with.
   *
   * `extra` is for a statement that is true of this request rather than of the
   * library: PUBLIC_READS is the only one so far, and it is the operator
   * saying the whole library is readable without an account. It is handed in
   * rather than written to the database because it is not the owner's policy
   * — it goes away when the variable does — and it is a statement rather than
   * a branch in the guard so that the one algorithm still explains the answer.
   */
  parts(user, { now = Date.now(), extra = [] } = {}) {
    return {
      user,
      groups: user ? this.groupsOf(user.id) : [],
      statements: extra.length > 0 ? [...this.statements(), ...extra] : this.statements(),
      now
    };
  }

  /** The decision for a real account against a real document. */
  decide(user, docPath, action, options = {}) {
    return decide({ ...this.parts(user, options), docPath, action });
  }

  effectiveLevel(user, docPath, options = {}) {
    return effectiveLevel({ ...this.parts(user, options), docPath });
  }

  /** A predicate for a list, so a collection is filtered rather than guarded. */
  allowFilter(user, action = "doc:read", options = {}) {
    const asked = this.parts(user, options);
    return (docPath) => decide({ ...asked, docPath, action }).allowed;
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
  visibleSpaces(user, options = {}) {
    const allowed = this.allowFilter(user, "doc:read", options);
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

  /* --- the policy follows the directories -----------------------------
   *
   * A space owns one top-level directory and a statement is scoped by a path
   * inside one, so a folder that is created, renamed, moved or deleted is a
   * change to the policy's own vocabulary. Nothing here decides anything: it
   * keeps the rows describing the library that exists.
   */

  /** A space for a top-level directory that has just appeared. */
  ensureSpaceForDir(dirName, { actor = null } = {}) {
    // Only the top level. A folder inside a space is a path within it, and
    // paths do not need rows.
    if (!dirName || dirName.includes("/") || this.spaceByDir(dirName)) {
      return null;
    }

    return this.insertSpace({
      dirName,
      name: dirName,
      actor,
      now: new Date().toISOString()
    });
  }

  /* Directories that arrived from outside the app.
   *
   * The library is deliberately a directory of ordinary files: moving one in
   * with `mv` is supposed to work, and the app agrees with the disk on the
   * next load. So a top-level directory can appear without any route here
   * having been called, and until it has a space row nobody can write a
   * statement about it — the documents in it are readable, because the root
   * statement covers them, and there is no way to close them.
   *
   * Reconciled where the app already reconciles with the disk: the listing
   * walks the directories, so it says what it saw. A write on a read path,
   * which the search index does for the same reason and with the same shape —
   * only an actual new directory costs an insert.
   */
  reconcileSpaces(dirNames, { actor = null } = {}) {
    const added = [];

    for (const dirName of new Set(dirNames)) {
      if (this.ensureSpaceForDir(dirName, { actor })) {
        added.push(dirName);
      }
    }

    return added;
  }

  /* A top-level directory that has gone.
   *
   * Its statements go with it, by the foreign key: the directory does not
   * exist any more, so neither does anything said about paths inside it. The
   * documents that were in it have been moved to the top level by the route
   * that deleted the folder, and the root space is what covers them there.
   */
  forgetSpace(dirName) {
    const space = dirName ? this.spaceByDir(dirName) : null;
    if (!space || !dirName || dirName.includes("/")) {
      return false;
    }

    const statements = this.db
      .prepare("SELECT COUNT(*) AS n FROM grants WHERE space_id = ?").get(space.id);
    this.db.prepare("DELETE FROM spaces WHERE id = ?").run(space.id);
    this.forget();
    this.audit("access.space.deleted", {
      space: dirName,
      id: space.id,
      statements: /** @type {any} */ (statements).n
    });
    return true;
  }

  /* A directory that has moved, and the statements that were about it.
   *
   * Renaming a folder moves its directory and every document inside it comes
   * along without a path being rewritten anywhere — which is exactly why the
   * statements have to be: they are the one thing that names a path and is not
   * derived from the tree. A statement left behind stops applying silently,
   * which is an allow that quietly stops allowing and a deny that quietly
   * stops denying.
   *
   * Three shapes, and this is one operation because they overlap: the top
   * level renamed (a space is renamed), a space moved inside another space
   * (its statements become prefixes in that one and the row goes), and a
   * folder moved anywhere within or between spaces (prefixes are rewritten).
   */
  followFolderMove(previousDir, nextDir, { actor = null } = {}) {
    if (!previousDir || !nextDir || previousDir === nextDir) {
      return { renamedSpace: false, rewritten: 0 };
    }

    const atTop = (dir) => !dir.includes("/");
    let renamedSpace = false;
    let rewritten = 0;

    this.db.transaction(() => {
      const space = this.spaceByDir(previousDir);

      /* The common case, and the one where nothing else has to happen: a
       * space keeps its identity and changes its name. Every statement in it
       * is stored against the row rather than against the name, so renaming
       * the row is the whole of it — rewriting them as well would be
       * rewriting them to what they already say.
       */
      if (atTop(previousDir) && atTop(nextDir)) {
        if (space) {
          this.db.prepare("UPDATE spaces SET dir_name = ?, name = ? WHERE id = ?")
            .run(nextDir, nextDir, space.id);
          renamedSpace = true;
        }

        this.forget();
        return;
      }

      /* Whatever owns the destination has to exist before anything can be
       * scoped into it: a folder promoted to the top level is a new space, and
       * a folder moved under a top-level directory that somehow has no row
       * needs that row made rather than its statements quietly placed in the
       * reserved space — where they would resolve to nothing and stop
       * applying, which is the one outcome worth preventing.
       */
      this.ensureSpaceForDir(nextDir.split("/")[0], { actor });

      rewritten = this.rewriteScopesUnder(previousDir, nextDir);

      // Last, because the foreign key would have taken its statements with it:
      // a space that is now a folder inside another space.
      if (atTop(previousDir) && space) {
        this.db.prepare("DELETE FROM spaces WHERE id = ?").run(space.id);
      }

      this.forget();
    }).immediate();

    this.forget();

    if (renamedSpace || rewritten > 0) {
      this.audit("access.policy.followed", {
        from: previousDir,
        to: nextDir,
        renamedSpace,
        statements: rewritten,
        actor
      });
    }

    return { renamedSpace, rewritten };
  }

  /* Every statement at or under one path, moved to the same place under
   * another.
   *
   * Read as whole paths rather than as space-and-prefix, because a move can
   * cross from one space into another and the pair has to be worked out again
   * on the other side. A statement whose new space has no row is left where it
   * is rather than dropped: `unresolved` exists to show that kind of thing,
   * and silently discarding a deny is the worst available answer.
   */
  rewriteScopesUnder(previousDir, nextDir) {
    const update = this.db.prepare(
      "UPDATE grants SET space_id = ?, path_prefix = ? WHERE id = ?");
    let rewritten = 0;

    for (const statement of this.statements()) {
      // The root is about the whole library, and no move changes that.
      const was = statement.space === null
        ? null
        : (statement.prefix ? `${statement.space}/${statement.prefix}` : statement.space);

      if (was === null || !(was === previousDir || was.startsWith(`${previousDir}/`))) {
        continue;
      }

      const placed = this.placeScope(`${nextDir}${was.slice(previousDir.length)}`);
      if (placed) {
        update.run(placed.spaceId, placed.prefix, statement.id);
        rewritten += 1;
      }
    }

    return rewritten;
  }

  /* A whole path, back as the space and prefix a statement is stored with.
   *
   * Which space a path belongs to is a question for the rows and not for the
   * shape of the path: "Ballots" is a space when something owns that
   * directory and a document at the library root when nothing does. Deciding
   * it by counting segments — one means the root, more means a space — turned
   * a statement about the whole of a space into one about a file called
   * "Ballots" in the reserved space, which the suite caught.
   */
  placeScope(fullPath) {
    const parts = String(fullPath || "").split("/").filter(Boolean);
    if (parts.length === 0) {
      return null;
    }

    const owner = this.spaceByDir(parts[0]);
    if (owner) {
      return { spaceId: owner.id, prefix: parts.slice(1).join("/") || null };
    }

    // Nothing owns that directory, so it is a path inside the reserved space
    // the documents at the library root live in.
    const root = this.spaceByDir(ROOT_SPACE_DIR);
    return root ? { spaceId: root.id, prefix: parts.join("/") } : null;
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
