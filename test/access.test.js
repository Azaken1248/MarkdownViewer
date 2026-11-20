/* Who may do what, and where.
 *
 * Two halves, deliberately checked in two ways.
 *
 * The decision is a pure function — statements in, a decision and its reason
 * out — so it is checked as a **decision table**: a list of rows, each naming
 * the statements that exist, the account asking, what it is asking for, and
 * the one answer. That is how AWS documents its own evaluation logic, and it
 * is the only shape in which "an explicit deny beats everything, wherever it
 * sits" can be read off the page rather than inferred from a scenario.
 *
 * The store is checked as storage: the migration that makes a space per
 * top-level directory, the reserved space for documents in no directory, the
 * statement that keeps the library behaving exactly as it did, and the cache
 * that must never answer with a permission that has been taken away.
 *
 * Nothing here enforces anything. No route consults any of this yet.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const access = require("../lib/access.js");
const db = require("../lib/db.js");
const { createChecker } = require("./helpers/check.js");

const { check, finish } = createChecker("ACCESS");

const { decide, effectiveLevel, scopeChain, renderStatement, AccessStore } = access;

/* --- the people ---------------------------------------------------------- */

const viewer = { id: "u_view", role: "viewer", disabled: false };
const editor = { id: "u_edit", role: "editor", disabled: false };
const admin = { id: "u_admin", role: "admin", disabled: false };
const nobody = null;

/* --- the statements, written the way the plan writes them ----------------- */

const stmt = (effect, level, subject, space = null, where = {}) => ({
  id: `s${effect}${level}${space || "root"}${where.prefix || ""}`,
  effect,
  subject,
  space,
  prefix: where.prefix || null,
  level,
  expires: where.until || null
});

const group = (id) => ({ kind: "group", id });
const user = (id) => ({ kind: "user", id });
const PUBLIC = { kind: "public" };

// What the migration writes, and what everything below is read against.
const EVERYONE_AT_ROOT = stmt("allow", "manage", group("everyone"));

const DOC = "Contra NES Extension/decisions/ADR-004.md";
const LOOSE = "notes.md";

console.log("=== the scopes a document is subject to ===");
{
  check("a document in a folder in a space, narrowest scope first",
    scopeChain(DOC).map((one) => `${one.space}|${one.prefix}`),
    [
      "Contra NES Extension|decisions/ADR-004.md",
      "Contra NES Extension|decisions",
      "Contra NES Extension|null",
      "null|null"
    ]);

  check("a document in no directory belongs to the reserved space",
    scopeChain(LOOSE).map((one) => `${one.space}|${one.prefix}`),
    ["|notes.md", "|null", "null|null"]);

  check("...and so does nothing at all, rather than throwing",
    scopeChain("").map((one) => `${one.space}|${one.prefix}`),
    ["|null", "null|null"]);

  check("a leading or doubled separator is not a scope of its own",
    scopeChain("//Elections//a.md/").map((one) => `${one.space}|${one.prefix}`),
    ["Elections|a.md", "Elections|null", "null|null"]);
}

console.log("=== the decision table: statements in, a decision and a reason out ===");

/* Each row is: what the library says, who is asking, about what, for which
 * action — and the one answer. The reason is checked too, because a decision
 * nobody can trace is the thing this design exists to avoid.
 */
const TABLE = [
  // -- nothing at all ------------------------------------------------------
  {
    says: "with no statements anywhere",
    statements: [],
    who: editor, action: "doc:read", on: DOC,
    allowed: false, reason: "nothing grants it"
  },
  {
    says: "...and for an admin, whose access is a statement like any other",
    statements: [],
    who: admin, action: "doc:read", on: DOC,
    allowed: true, reason: "allowed by: allow manage user:u_admin on <root>"
  },

  // -- the baseline the migration writes -----------------------------------
  {
    says: "the one statement the migration writes lets an editor read",
    statements: [EVERYONE_AT_ROOT],
    who: editor, action: "doc:read", on: DOC,
    allowed: true, reason: "allowed by: allow manage group:everyone on <root>"
  },
  {
    says: "...and write",
    statements: [EVERYONE_AT_ROOT], who: editor, action: "doc:write", on: DOC,
    allowed: true
  },
  {
    says: "...and manage the share link, which an editor could always do",
    statements: [EVERYONE_AT_ROOT], who: editor, action: "share:manage", on: DOC,
    allowed: true
  },
  {
    says: "...while a viewer under the same statement still only reads",
    statements: [EVERYONE_AT_ROOT], who: viewer, action: "doc:write", on: DOC,
    allowed: false, reason: "role boundary: a viewer may not doc:write"
  },
  {
    says: "...and only an admin may erase, because only that role carries it",
    statements: [EVERYONE_AT_ROOT], who: editor, action: "doc:erase", on: DOC,
    allowed: false, reason: "role boundary: a editor may not doc:erase"
  },
  {
    says: "...which an admin may",
    statements: [EVERYONE_AT_ROOT], who: admin, action: "doc:erase", on: DOC,
    allowed: true
  },

  // -- closing a space -----------------------------------------------------
  {
    says: "a deny on the space beats the allow at the root above it",
    statements: [EVERYONE_AT_ROOT, stmt("deny", "read", group("everyone"), "Contra NES Extension")],
    who: editor, action: "doc:read", on: DOC,
    allowed: false, reason: "denied by: deny read group:everyone on Contra NES Extension"
  },
  {
    says: "...and the order the statements are written in makes no difference",
    statements: [stmt("deny", "read", group("everyone"), "Contra NES Extension"), EVERYONE_AT_ROOT],
    who: editor, action: "doc:read", on: DOC,
    allowed: false
  },
  {
    says: "...nor does a second allow written at the space itself",
    statements: [
      EVERYONE_AT_ROOT,
      stmt("deny", "read", group("everyone"), "Contra NES Extension"),
      stmt("allow", "write", group("everyone"), "Contra NES Extension")
    ],
    who: editor, action: "doc:read", on: DOC,
    allowed: false
  },
  {
    says: "a space closed to everyone is still open to a group named on it",
    statements: [
      EVERYONE_AT_ROOT,
      stmt("deny", "read", group("everyone"), "Contra NES Extension"),
      stmt("allow", "write", group("contributors"), "Contra NES Extension")
    ],
    who: editor, groups: ["everyone", "contributors"], action: "doc:read", on: DOC,
    // The deny names a group this account is also in, and a deny beats
    // everything: this is the case where being in both means refused.
    allowed: false
  },
  {
    says: "...and to an account named directly, when the deny does not name it",
    statements: [
      stmt("deny", "read", group("outsiders"), "Contra NES Extension"),
      stmt("allow", "write", user("u_edit"), "Contra NES Extension")
    ],
    who: editor, groups: ["everyone"], action: "doc:write", on: DOC,
    allowed: true, reason: "allowed by: allow write user:u_edit on Contra NES Extension"
  },

  // -- nesting, at any depth -----------------------------------------------
  {
    says: "a deny deeper in removes what the space above allowed",
    statements: [
      stmt("allow", "write", group("everyone"), "Contra NES Extension"),
      stmt("deny", "read", group("everyone"), "Contra NES Extension", { prefix: "decisions" })
    ],
    who: editor, action: "doc:read", on: DOC,
    allowed: false, reason: "denied by: deny read group:everyone on Contra NES Extension/decisions"
  },
  {
    says: "...and leaves a sibling folder alone",
    statements: [
      stmt("allow", "write", group("everyone"), "Contra NES Extension"),
      stmt("deny", "read", group("everyone"), "Contra NES Extension", { prefix: "decisions" })
    ],
    who: editor, action: "doc:read", on: "Contra NES Extension/06-release/notes.md",
    allowed: true
  },
  {
    says: "an allow deeper in adds where the space above says nothing",
    statements: [stmt("allow", "read", group("everyone"), "Contra NES Extension", { prefix: "06-release" })],
    who: editor, action: "doc:read", on: "Contra NES Extension/06-release/notes.md",
    allowed: true
  },
  {
    says: "...and a statement naming one document reaches exactly it",
    statements: [stmt("allow", "read", group("everyone"), "Contra NES Extension", { prefix: "decisions/ADR-004.md" })],
    who: editor, action: "doc:read", on: DOC,
    allowed: true
  },
  {
    says: "...but not its neighbour",
    statements: [stmt("allow", "read", group("everyone"), "Contra NES Extension", { prefix: "decisions/ADR-004.md" })],
    who: editor, action: "doc:read", on: "Contra NES Extension/decisions/ADR-005.md",
    allowed: false
  },
  {
    says: "a prefix is a path segment, not a string: 'decision' is not 'decisions'",
    statements: [stmt("allow", "read", group("everyone"), "Contra NES Extension", { prefix: "decision" })],
    who: editor, action: "doc:read", on: DOC,
    allowed: false
  },

  // -- the ladder, read both ways ------------------------------------------
  {
    says: "an allow at read does not carry writing with it",
    statements: [stmt("allow", "read", group("everyone"))],
    who: editor, action: "doc:write", on: DOC,
    allowed: false, reason: "nothing grants it"
  },
  {
    says: "a deny at write leaves reading alone, which is how a space is made read-only",
    statements: [EVERYONE_AT_ROOT, stmt("deny", "write", group("everyone"), "Elections")],
    who: editor, action: "doc:read", on: "Elections/a.md",
    allowed: true
  },
  {
    says: "...and refuses the writing",
    statements: [EVERYONE_AT_ROOT, stmt("deny", "write", group("everyone"), "Elections")],
    who: editor, action: "doc:write", on: "Elections/a.md",
    allowed: false, reason: "denied by: deny write group:everyone on Elections"
  },
  {
    says: "...and the share link with it, because managing one is not less than writing",
    statements: [EVERYONE_AT_ROOT, stmt("deny", "write", group("everyone"), "Elections")],
    who: editor, action: "share:manage", on: "Elections/a.md",
    allowed: false
  },
  {
    says: "a deny at manage refuses only the managing",
    statements: [EVERYONE_AT_ROOT, stmt("deny", "manage", group("everyone"), "Elections")],
    who: editor, action: "doc:write", on: "Elections/a.md",
    allowed: true
  },
  {
    says: "...including for an admin, whose implicit allow does not outrank a deny",
    statements: [EVERYONE_AT_ROOT, stmt("deny", "read", group("everyone"), "Elections")],
    who: admin, groups: ["everyone"], action: "doc:read", on: "Elections/a.md",
    allowed: false
  },

  // -- the principal with no account ---------------------------------------
  {
    says: "a request with no account is refused by the statement for everyone",
    statements: [EVERYONE_AT_ROOT],
    who: nobody, action: "doc:read", on: DOC,
    allowed: false, reason: "nothing grants it"
  },
  {
    says: "...and allowed only by a statement written for the public",
    statements: [EVERYONE_AT_ROOT, stmt("allow", "read", PUBLIC, "Elections")],
    who: nobody, action: "doc:read", on: "Elections/a.md",
    allowed: true, reason: "allowed by: allow read public on Elections"
  },
  {
    says: "...which does not let it write",
    statements: [stmt("allow", "read", PUBLIC, "Elections")],
    who: nobody, action: "doc:write", on: "Elections/a.md",
    allowed: false
  },
  {
    says: "a deny for the public at the root is the one row that blocks every public link",
    statements: [stmt("allow", "read", PUBLIC, "Elections"), stmt("deny", "read", PUBLIC)],
    who: nobody, action: "doc:read", on: "Elections/a.md",
    allowed: false, reason: "denied by: deny read public on <root>"
  },
  {
    says: "...and leaves the accounts alone, because principals are independent",
    statements: [EVERYONE_AT_ROOT, stmt("deny", "read", PUBLIC)],
    who: editor, action: "doc:read", on: "Elections/a.md",
    allowed: true
  },
  {
    says: "a space closed to accounts can still be open to the world",
    statements: [stmt("deny", "read", group("everyone")), stmt("allow", "read", PUBLIC, "Elections")],
    who: nobody, action: "doc:read", on: "Elections/a.md",
    allowed: true
  },

  // -- expiry ---------------------------------------------------------------
  {
    says: "a statement past its expiry is not consulted",
    statements: [stmt("allow", "manage", group("everyone"), null, { until: "2020-01-01T00:00:00.000Z" })],
    who: editor, action: "doc:read", on: DOC,
    allowed: false, reason: "nothing grants it"
  },
  {
    says: "...and one that has not expired is",
    statements: [stmt("allow", "manage", group("everyone"), null, { until: "2999-01-01T00:00:00.000Z" })],
    who: editor, action: "doc:read", on: DOC,
    allowed: true
  },
  {
    says: "...and an expired deny stops refusing",
    statements: [
      EVERYONE_AT_ROOT,
      stmt("deny", "read", group("everyone"), "Elections", { until: "2020-01-01T00:00:00.000Z" })
    ],
    who: editor, action: "doc:read", on: "Elections/a.md",
    allowed: true
  },

  // -- the account itself ---------------------------------------------------
  {
    says: "a disabled account is refused before any statement is read",
    statements: [EVERYONE_AT_ROOT],
    who: { id: "u_off", role: "admin", disabled: true }, action: "doc:read", on: DOC,
    allowed: false, reason: "the account is disabled"
  },
  {
    says: "a role nobody recognises carries no actions at all",
    statements: [EVERYONE_AT_ROOT],
    who: { id: "u_odd", role: "wizard", disabled: false }, action: "doc:read", on: DOC,
    allowed: false, reason: "role boundary: a wizard may not doc:read"
  },
  {
    says: "user:manage is never a question this answers",
    statements: [EVERYONE_AT_ROOT],
    who: admin, action: "user:manage", on: DOC,
    // The role carries it, so the boundary lets it past; no level grants it,
    // so nothing allows it. It stays a role permission, checked elsewhere.
    allowed: false, reason: "nothing grants it"
  },
  {
    says: "a statement naming another account is not this account's",
    statements: [stmt("allow", "manage", user("u_someone_else"))],
    who: editor, action: "doc:read", on: DOC,
    allowed: false
  },
  {
    says: "a statement naming a group this account is not in does nothing",
    statements: [stmt("allow", "manage", group("contributors"))],
    who: editor, groups: ["everyone"], action: "doc:read", on: DOC,
    allowed: false
  }
];

for (const row of TABLE) {
  const answer = decide({
    user: row.who,
    groups: row.groups || (row.who ? ["everyone"] : []),
    statements: row.statements,
    docPath: row.on,
    action: row.action
  });

  if (row.reason === undefined) {
    check(row.says, answer.allowed, row.allowed);
  } else {
    check(row.says, [answer.allowed, answer.reason], [row.allowed, row.reason]);
  }
}

console.log("=== what was considered, which is what an explanation is made of ===");
{
  const answer = decide({
    user: editor,
    groups: ["everyone", "contributors"],
    statements: [
      EVERYONE_AT_ROOT,
      stmt("deny", "read", group("everyone"), "Contra NES Extension"),
      stmt("allow", "write", group("contributors"), "Contra NES Extension"),
      // Neither of these applies: a different space, and a group this account
      // is not in.
      stmt("allow", "read", group("everyone"), "Elections"),
      stmt("allow", "read", group("outsiders"), "Contra NES Extension")
    ],
    docPath: DOC,
    action: "doc:read"
  });

  check("only the statements that apply are considered", answer.considered.length, 3);
  check("...and each is rendered as one line somebody can read",
    answer.considered.map(renderStatement),
    [
      "allow manage group:everyone on <root>",
      "deny read group:everyone on Contra NES Extension",
      "allow write group:contributors on Contra NES Extension"
    ]);
  check("a rendering says when a statement runs out",
    renderStatement(stmt("allow", "read", PUBLIC, "Elections", { until: "2027-03-01T00:00:00.000Z" })),
    "allow read public on Elections until 2027-03-01");
  check("...and names the reserved space rather than an empty string",
    renderStatement(stmt("allow", "read", group("everyone"), "")),
    "allow read group:everyone on <ungrouped>");
}

console.log("=== one word for what somebody may do here ===");
{
  const levelFor = (who, statements, docPath = DOC, groups = ["everyone"]) =>
    effectiveLevel({ user: who, groups, statements, docPath });

  check("nothing, where nothing grants anything", levelFor(editor, []), "none");
  check("read, where the statement says read", levelFor(editor, [stmt("allow", "read", group("everyone"))]), "read");
  check("write, where it says write", levelFor(editor, [stmt("allow", "write", group("everyone"))]), "write");
  check("manage, where it says manage", levelFor(editor, [EVERYONE_AT_ROOT]), "manage");
  check("...and the role is still the ceiling: a viewer reads",
    levelFor(viewer, [EVERYONE_AT_ROOT]), "read");
  check("a deny at write leaves read as the answer",
    levelFor(editor, [EVERYONE_AT_ROOT, stmt("deny", "write", group("everyone"), "Contra NES Extension")]),
    "read");
  check("the public has a level too, where it is given one",
    effectiveLevel({ user: null, groups: [], statements: [stmt("allow", "read", PUBLIC, "Elections")], docPath: "Elections/a.md" }),
    "read");
}

console.log("=== the store: rows in, statements out ===");

const where = fs.mkdtempSync(path.join(os.tmpdir(), "azadocs-access-"));
const library = path.join(where, "docs");
fs.mkdirSync(library, { recursive: true });
for (const dir of ["Contra NES Extension", "Elections", ".hidden"]) {
  fs.mkdirSync(path.join(library, dir), { recursive: true });
}
fs.writeFileSync(path.join(library, "loose.md"), "# Loose\n");

const metadata = db.open(path.join(where, "data"));
const store = new AccessStore({ db: metadata, markdownDir: library });

{
  const made = store.ensureBaseline({ actor: "aza" });

  check("the migration makes a space for each top-level directory",
    store.listSpaces().map((one) => one.dir_name).sort(),
    ["", "Contra NES Extension", "Elections"]);
  check("...and says which it added", made.spacesAdded.sort(), ["", "Contra NES Extension", "Elections"]);
  check("...naming a space after its directory, and the reserved one Ungrouped",
    store.listSpaces().map((one) => one.name).sort(),
    ["Contra NES Extension", "Elections", "Ungrouped"]);
  check("...skipping a dotted directory, which no document path starts with",
    store.spaceByDir(".hidden"), null);
  check("...and letting links out of a new space until told otherwise",
    store.spaceByDir("Elections").public_links_allowed, 1);

  check("the everyone group exists", Boolean(store.groupByName("everyone")), true);
  check("...and one statement sits at the root",
    store.statements().map(renderStatement),
    ["allow manage group:everyone on <root>"]);
  check("...recorded against whoever ran it",
    /** @type {any} */ (metadata.prepare("SELECT granted_by FROM grants").get()).granted_by, "aza");

  // Running it again is the case that matters: a migration is run on every
  // boot, and a second run that writes a second statement is a migration that
  // doubles the policy every restart.
  const again = store.ensureBaseline({ actor: "aza" });
  check("running it again adds no space", again.spacesAdded, []);
  check("...and no second statement", store.statements().length, 1);
  check("...nor a second group", store.listGroups().length, 1);
}

console.log("=== and the library behaves exactly as it did before it ===");
{
  // The whole point of that one statement. An account with no row in
  // group_members is still in `everyone`, because that group is a fact about
  // the account table rather than a list.
  check("an editor can read, write and manage a share link anywhere",
    ["doc:read", "doc:write", "share:manage"]
      .map((action) => store.decide(editor, DOC, action).allowed),
    [true, true, true]);
  check("...a viewer can read and no more",
    ["doc:read", "doc:write"].map((action) => store.decide(viewer, DOC, action).allowed),
    [true, false]);
  check("...an admin can erase", store.decide(admin, DOC, "doc:erase").allowed, true);
  check("...a document in no directory is reachable too",
    store.decide(editor, "loose.md", "doc:read").allowed, true);
  check("...and a stranger still is not",
    store.decide(null, DOC, "doc:read").allowed, false);

  check("every space is visible", store.visibleSpaces(editor).size, 3);
  check("...and none of them to a stranger", store.visibleSpaces(null).size, 0);

  const readable = store.allowFilter(editor);
  check("a filter answers for a list", [readable(DOC), readable("Elections/a.md")], [true, true]);
}

console.log("=== writing a statement, and what it changes ===");
{
  const written = store.write({
    effect: "deny",
    subject: { kind: "group", id: store.groupByName("everyone").id },
    spaceDir: "Contra NES Extension",
    level: "read",
    actor: "aza"
  });
  check("a statement can be written", written.ok, true);

  check("a space closed to everyone closes for an editor",
    store.decide(editor, DOC, "doc:read").allowed, false);
  // The group is stored by id and decided by name, so this is also the check
  // that the two agree — and that a reason is something a person can read.
  check("...with the reason naming the statement in words",
    store.decide(editor, DOC, "doc:read").reason,
    "denied by: deny read group:everyone on Contra NES Extension");
  check("...and leaves the other space open",
    store.decide(editor, "Elections/a.md", "doc:read").allowed, true);
  check("...and the closed space stops being visible",
    store.visibleSpaces(editor).has(store.spaceByDir("Contra NES Extension").id), false);
  check("...while an admin is refused by it as well",
    store.decide(admin, DOC, "doc:read").allowed, false);

  check("a statement for a directory no space owns is refused",
    store.write({ effect: "allow", subject: { kind: "public" }, spaceDir: "Nowhere", level: "read" }),
    { ok: false, error: 'No space owns the directory "Nowhere".' });

  check("the same statement written twice is one statement",
    (() => {
      const before = store.statements().length;
      store.write({
        effect: "deny",
        subject: { kind: "group", id: store.groupByName("everyone").id },
        spaceDir: "Contra NES Extension",
        level: "read"
      });
      return store.statements().length - before;
    })(),
    0);

  check("...and removing it opens the space again",
    (() => {
      const row = /** @type {any} */ (metadata.prepare("SELECT id FROM grants WHERE effect = 'deny'").get());
      const gone = store.remove(row.id);
      return [gone, store.decide(editor, DOC, "doc:read").allowed];
    })(),
    [true, true]);
  check("removing one that is not there says so", store.remove("stmt_nope"), false);
}

console.log("=== the principal with no account, written to the database ===");
{
  // In the decision table this is a literal; here it is a row, which is the
  // only way to find out that a statement with no subject id survives the
  // round trip.
  const published = store.write({
    effect: "allow",
    subject: { kind: "public" },
    spaceDir: "Elections",
    level: "read",
    actor: "aza"
  });

  check("a space can be published to the world", published.ok, true);
  check("...and a stranger may read what is in it",
    store.decide(null, "Elections/a.md", "doc:read").allowed, true);
  check("...which is what the statement says, in words",
    store.decide(null, "Elections/a.md", "doc:read").reason,
    "allowed by: allow read public on Elections");
  check("...and no more than read it",
    store.decide(null, "Elections/a.md", "doc:write").allowed, false);
  check("...and nothing in the space next door",
    store.decide(null, DOC, "doc:read").allowed, false);

  // The one row that is AWS's block-public-access: written at the root, with
  // no space at all, which is the other branch of a scoped write.
  const blocked = store.write({
    effect: "deny",
    subject: { kind: "public" },
    level: "read",
    actor: "aza"
  });
  check("one statement at the root blocks every public link", blocked.ok, true);
  check("...and the published space goes with it",
    store.decide(null, "Elections/a.md", "doc:read").allowed, false);
  check("...while the accounts are untouched",
    store.decide(editor, "Elections/a.md", "doc:read").allowed, true);

  check("the block can be lifted again",
    [store.remove(blocked.id), store.decide(null, "Elections/a.md", "doc:read").allowed],
    [true, true]);

  // A statement that runs out, through the store rather than as a literal.
  const temporary = store.write({
    effect: "deny",
    subject: { kind: "public" },
    spaceDir: "Elections",
    prefix: "a.md",
    level: "read",
    expires: "2020-01-01T00:00:00.000Z",
    actor: "aza"
  });
  check("a statement written with an expiry in the past does not apply",
    [temporary.ok, store.decide(null, "Elections/a.md", "doc:read").allowed],
    [true, true]);
  check("...and the same statement dated ahead does",
    (() => {
      store.remove(temporary.id);
      store.write({
        effect: "deny",
        subject: { kind: "public" },
        spaceDir: "Elections",
        prefix: "a.md",
        level: "read",
        expires: "2999-01-01T00:00:00.000Z"
      });
      return store.decide(null, "Elections/a.md", "doc:read").allowed;
    })(),
    false);
  check("...and only over the document it names",
    store.decide(null, "Elections/b.md", "doc:read").allowed, true);

  check("the store answers with one word for a level, as the panel will show it",
    [store.effectiveLevel(editor, DOC), store.effectiveLevel(viewer, DOC),
      store.effectiveLevel(null, "Elections/b.md"), store.effectiveLevel(null, DOC)],
    ["manage", "read", "read", "none"]);

  metadata.prepare("DELETE FROM grants WHERE subject_kind = 'public'").run();
  store.forget();
}

console.log("=== groups, and the membership that is not stored ===");
{
  const contributors = store.insertGroup("contributors");
  check("a group can be made", Boolean(contributors.id), true);
  check("...and an account put in it",
    (() => {
      metadata.prepare(`INSERT INTO users (id, username, password_hash, role, created_at)
                        VALUES ('u_edit', 'edit', 'x', 'editor', '2026-01-01')`).run();
      store.addMember(contributors.id, "u_edit");
      return store.groupsOf("u_edit").sort();
    })(),
    ["contributors", "everyone"]);
  check("...twice, without a second row", (() => {
    store.addMember(contributors.id, "u_edit");
    return store.groupsOf("u_edit").length;
  })(), 2);
  check("an account in nothing is still in everyone", store.groupsOf("u_nobody"), ["everyone"]);
  check("...and everyone is not listed twice when it is a real membership", (() => {
    const everyone = store.groupByName("everyone");
    store.addMember(everyone.id, "u_edit");
    return store.groupsOf("u_edit").filter((one) => one === "everyone").length;
  })(), 1);
}

console.log("=== the cache, which must never answer with a permission that is gone ===");
{
  const first = store.statements();
  check("the same rows are handed back without a second read",
    store.statements() === first, true);

  store.write({
    effect: "deny",
    subject: { kind: "group", id: store.groupByName("everyone").id },
    spaceDir: "Elections",
    level: "read"
  });
  check("...until something is written, and then they are not",
    store.statements() === first, false);
  check("...and the new statement is in them",
    store.decide(editor, "Elections/a.md", "doc:read").allowed, false);

  /* Another process writing is the case the version counter is for: a cache
   * keyed only on this store's own writes would answer from memory for ever
   * while the other connection had already taken the permission away.
   */
  const second = db.open(path.join(where, "data"));
  second.prepare("DELETE FROM grants WHERE effect = 'deny'").run();
  check("a statement another connection removed is noticed",
    store.decide(editor, "Elections/a.md", "doc:read").allowed, true);
  second.close();
}

console.log("=== a library directory that is not there yet ===");
{
  const bare = new AccessStore({
    db: db.open(path.join(where, "empty")),
    markdownDir: path.join(where, "no-such-library")
  });
  const made = bare.ensureBaseline({});

  check("the migration still runs", made.spacesAdded, [""]);
  check("...leaving the reserved space and the root statement",
    [bare.listSpaces().length, bare.statements().length], [1, 1]);
  check("...and an unowned actor recorded as nobody in particular",
    /** @type {any} */ (bare.db.prepare("SELECT granted_by FROM grants").get()).granted_by, null);
}

metadata.close();
fs.rmSync(where, { recursive: true, force: true });

process.exit(finish());
