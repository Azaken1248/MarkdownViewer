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

console.log("=== the reserved space is a space, and not the library ===");
{
  /* The space whose directory name is the empty string holds the documents
   * that are in no directory at all. `null` — both scope columns unset — is
   * the root, which is about the whole library. They are two different
   * scopes and the empty string is not a missing value, which is the one
   * thing the comparison has to get right: it was reducing `""` to `null`
   * on one side of itself only.
   *
   * What that cost, in both directions. A statement on the reserved space
   * read as a statement on the root, so `deny read on Ungrouped` closed
   * every document in the library; and a statement naming one loose document
   * matched nothing at all, so a deny on it quietly stopped denying.
   */
  const asked = (statements, docPath) => decide({
    user: editor,
    groups: ["everyone"],
    statements: [EVERYONE_AT_ROOT, ...statements],
    docPath,
    action: "doc:read"
  });

  const ungrouped = stmt("deny", "read", group("everyone"), "");
  check("a space closed to everyone closes the documents in it",
    asked([ungrouped], LOOSE).allowed, false);
  check("...and nothing else, the reserved space being a space like any other",
    [asked([ungrouped], DOC).allowed, asked([ungrouped], "Elections/a.md").allowed],
    [true, true]);

  const oneDocument = stmt("deny", "read", group("everyone"), "", { prefix: LOOSE });
  check("a statement naming one loose document applies to it",
    asked([oneDocument], LOOSE).allowed, false);
  check("...and to nothing beside it",
    asked([oneDocument], "other.md").allowed, true);
  check("...which is what it says it did",
    asked([oneDocument], LOOSE).reason,
    "denied by: deny read group:everyone on <ungrouped>/notes.md");

  check("the root is still the whole library, and is not the reserved space",
    [asked([stmt("deny", "read", group("everyone"))], LOOSE).allowed,
      asked([stmt("deny", "read", group("everyone"))], DOC).allowed],
    [false, false]);
}

console.log("=== a path this will not decide about ===");
{
  /* `..` is not a name. `Public/../Secret/notes.md` names a document in
   * Secret and would be attributed to the space called Public, which is a
   * deny on Secret walked around. Nothing routes such a path here —
   * lib/docs/paths.js refuses it long before — and this layer declines it
   * anyway, because a boundary that is only correct while its callers are
   * correct is one bug away from not being one.
   */
  const asked = (docPath) => decide({
    user: editor,
    groups: ["everyone"],
    statements: [EVERYONE_AT_ROOT, stmt("deny", "read", group("everyone"), "Secret")],
    docPath,
    action: "doc:read"
  });

  check("a document in a space closed to everyone is refused",
    asked("Secret/notes.md").allowed, false);
  check("...and the same document reached through its neighbour is refused too",
    [asked("Public/../Secret/notes.md").allowed, asked("Public/../Secret/notes.md").reason],
    [false, "the path is not one this can decide about: Public/../Secret/notes.md"]);
  check("...however many steps it takes",
    asked("a/b/../../Secret/notes.md").allowed, false);
  check("a single dot is refused as well, being equally not a name",
    asked("./Public/a.md").allowed, false);
  check("...and nothing is read before the refusal",
    asked("Public/../Secret/notes.md").considered, []);
  check("no path at all is not a path it will decide about either",
    decide({ user: editor, groups: ["everyone"], statements: [EVERYONE_AT_ROOT],
      docPath: null, action: "doc:read" }).allowed,
    true);
  check("a name that merely starts with dots is a name",
    [access.unreducible("..hidden/a.md"), access.unreducible("Public/...rc")], [false, false]);
  check("...and is decided normally",
    asked("..hidden/a.md").allowed, true);
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

console.log("=== every change to the policy is written down ===");
{
  /* A change to who may read what is a security event. A policy that changes
   * without a trace is the one kind of change an incident review cannot
   * reconstruct — so each of these writes one line, in the same words the
   * statements list shows.
   *
   * Decisions are deliberately not logged: a line per permission check is a
   * line per request, which is a log nobody reads and a disk nobody expected
   * to fill. `explain` is how a single decision is accounted for.
   */
  const lines = [];
  const watched = new AccessStore({
    db: db.open(path.join(where, "audited")),
    markdownDir: library,
    audit: (event, fields) => lines.push({ event, ...fields })
  });

  watched.ensureBaseline({ actor: "aza" });
  check("the migration says it ran, and how much it made",
    lines.filter((one) => one.event === "access.baseline"),
    [{ event: "access.baseline", spaces: 3, actor: "aza" }]);
  check("...and names each space it created",
    lines.filter((one) => one.event === "access.space.created").map((one) => one.space).sort(),
    ["<ungrouped>", "Contra NES Extension", "Elections"]);
  check("...and the group it had to have",
    lines.filter((one) => one.event === "access.group.created").map((one) => one.group),
    ["everyone"]);
  check("...and the statement it wrote, in words",
    lines.filter((one) => one.event === "access.statement.written").map((one) => one.statement),
    ["allow manage group:everyone on <root>"]);

  lines.length = 0;
  const written = watched.write({
    effect: "deny",
    subject: { kind: "group", id: watched.groupByName("everyone").id },
    spaceDir: "Elections",
    level: "read",
    actor: "aza"
  });

  check("closing a space is one line that reads as the policy",
    lines.map((one) => [one.event, one.statement, one.actor]),
    [["access.statement.written", "deny read group:everyone on Elections", "aza"]]);

  lines.length = 0;
  watched.remove(written.id);
  check("...and opening it again says what was taken away",
    lines.map((one) => [one.event, one.statement]),
    [["access.statement.removed", "deny read group:everyone on Elections"]]);

  lines.length = 0;
  const temp = watched.insertGroup("temps");
  watched.deleteGroup(temp.id);
  check("a group coming and going is two lines",
    lines.map((one) => [one.event, one.group]),
    [["access.group.created", "temps"], ["access.group.deleted", "temps"]]);

  lines.length = 0;
  check("a statement written for a group that does not exist says so in the log",
    (() => {
      watched.write({ effect: "allow", subject: { kind: "group", id: "grp_vanished" }, level: "read" });
      return lines.map((one) => one.statement);
    })(),
    ["allow read group:grp_vanished on <root>"]);

  lines.length = 0;
  check("a statement that was not there is not a change",
    [watched.remove("stmt_nope"), lines], [false, []]);
  check("...nor is a group that was not there",
    [watched.deleteGroup("grp_nope"), lines], [false, []]);

  lines.length = 0;
  check("asking a question is not a change, however many times it is asked",
    (() => {
      watched.decide(editor, DOC, "doc:read");
      watched.effectiveLevel(editor, DOC);
      watched.visibleSpaces(editor);
      return lines;
    })(),
    []);

  check("a store made without an audit hook does not fall over",
    (() => {
      const quiet = new AccessStore({
        db: db.open(path.join(where, "quiet")),
        markdownDir: library
      });
      quiet.ensureBaseline({});
      return quiet.statements().length;
    })(),
    1);
}

console.log("=== a space you can read part of is a space you can see ===");
{
  /* The tree's half of the rule: an ancestor of something readable has to be
   * listed, or the readable thing cannot be reached. A space granted at one
   * folder and nowhere wider was invisible, which made the one document
   * somebody could read unreachable.
   */
  const everyone = store.groupByName("everyone");
  const partly = new AccessStore({
    db: db.open(path.join(where, "partly")),
    markdownDir: library
  });
  partly.ensureBaseline({});
  // Nothing at the root, so the only statements are the ones written here.
  partly.db.prepare("DELETE FROM grants").run();
  partly.forget();

  const theirEveryone = partly.groupByName("everyone");
  partly.write({
    effect: "allow",
    subject: { kind: "group", id: theirEveryone.id },
    spaceDir: "Contra NES Extension",
    prefix: "06-release",
    level: "read"
  });

  check("the document inside that folder can be read",
    partly.decide(editor, "Contra NES Extension/06-release/notes.md", "doc:read").allowed, true);
  check("...and nothing else in the space can",
    partly.decide(editor, DOC, "doc:read").allowed, false);
  check("...and the space is listed, or that document is unreachable",
    partly.visibleSpaces(editor).has(partly.spaceByDir("Contra NES Extension").id), true);
  check("...while a space with nothing readable in it is not listed",
    partly.visibleSpaces(editor).has(partly.spaceByDir("Elections").id), false);

  check("a space closed by a deny is not listed, whatever is allowed beneath it",
    (() => {
      partly.write({
        effect: "deny",
        subject: { kind: "group", id: theirEveryone.id },
        spaceDir: "Contra NES Extension",
        level: "read"
      });
      return partly.visibleSpaces(editor).has(partly.spaceByDir("Contra NES Extension").id);
    })(),
    false);

  check("a document named .probe is a document, not a question about a space",
    (() => {
      partly.db.prepare("DELETE FROM grants").run();
      partly.forget();
      partly.write({
        effect: "allow",
        subject: { kind: "group", id: theirEveryone.id },
        spaceDir: "Elections",
        prefix: ".probe",
        level: "read"
      });
      return [
        partly.decide(editor, "Elections/.probe", "doc:read").allowed,
        partly.visibleSpaces(editor).has(partly.spaceByDir("Elections").id)
      ];
    })(),
    [true, true]);

  check("every space is still visible under the statement the migration writes",
    (() => {
      void everyone;
      return store.visibleSpaces(editor).size;
    })(),
    3);
}

console.log("=== a statement cannot outlive what it names ===");
{
  /* A foreign key would have done this, if subject_id could have one — it
   * holds a user id, a group id or nothing, and a column that means three
   * things cannot reference one table. So the cascade is a trigger in the
   * schema, rather than a method somebody has to remember.
   *
   * What it prevents: an unresolvable statement applies to nobody, so an
   * allow silently stops allowing and a deny silently stops denying. Measured
   * before the trigger existed, deleting the everyone group left two
   * statements in place and took the whole library's policy with it.
   */
  const locked = store.insertGroup("locked-out");
  metadata.prepare(`INSERT OR IGNORE INTO users (id, username, password_hash, role, created_at)
                    VALUES ('u_other', 'other', 'x', 'editor', '2026-01-01')`).run();

  store.write({
    effect: "deny",
    subject: { kind: "group", id: locked.id },
    spaceDir: "Elections",
    level: "read"
  });
  store.write({
    effect: "allow",
    subject: { kind: "user", id: "u_other" },
    spaceDir: "Elections",
    level: "write"
  });

  const before = store.statements().length;
  check("(a statement for a group and one for an account)", before >= 3, true);

  check("deleting the group takes its statement with it",
    [store.deleteGroup(locked.id), store.statements().length],
    [true, before - 1]);
  check("...and deleting the account takes its statement too",
    (() => {
      metadata.prepare("DELETE FROM users WHERE id = 'u_other'").run();
      store.forget();
      return store.statements().length;
    })(),
    before - 2);
  check("deleting a group that is not there changes nothing",
    [store.deleteGroup("grp_nope"), store.statements().length], [false, before - 2]);

  check("nothing is left naming something that is gone", store.unresolved(), []);

  /* And if one ever does appear — a hand-edited database, or a restore from a
   * backup made before the triggers existed — it is visible rather than
   * quietly inert.
   */
  check("a statement that names nothing is reported rather than ignored",
    (() => {
      metadata.prepare(`INSERT INTO grants
        (id, effect, subject_kind, subject_id, space_id, path_prefix, level, granted_at)
        VALUES ('stmt_orphan', 'deny', 'group', 'grp_vanished', NULL, NULL, 'read', '2026-01-01')`).run();
      store.forget();
      return [store.unresolved().length, store.unresolved()[0].id];
    })(),
    [1, "stmt_orphan"]);
  check("...and applies to nobody while it is there, which is why it is reported",
    store.decide(editor, DOC, "doc:read").allowed, true);
  check("...and the same for one that names an account rather than a group",
    (() => {
      metadata.prepare(`INSERT INTO grants
        (id, effect, subject_kind, subject_id, space_id, path_prefix, level, granted_at)
        VALUES ('stmt_orphan_user', 'allow', 'user', NULL, NULL, NULL, 'read', '2026-01-01')`).run();
      store.forget();
      return store.unresolved().map((one) => one.id).sort();
    })(),
    ["stmt_orphan", "stmt_orphan_user"]);

  metadata.prepare("DELETE FROM grants WHERE id = 'stmt_orphan_user'").run();

  metadata.prepare("DELETE FROM grants WHERE id = 'stmt_orphan'").run();
  store.forget();
}

console.log("=== the policy follows the directories ===");
{
  /* A space owns one top-level directory and a statement is scoped by a path
   * inside one, so a folder created, renamed, moved or deleted changes the
   * policy's own vocabulary. A statement left behind stops applying silently:
   * an allow that quietly stops allowing, a deny that quietly stops denying.
   */
  const moved = new AccessStore({
    db: db.open(path.join(where, "moved")),
    markdownDir: library
  });
  moved.ensureBaseline({ actor: "aza" });
  const theirEveryone = moved.groupByName("everyone");
  const asGroup = { kind: "group", id: theirEveryone.id };

  const scopes = () => moved.statements()
    .filter((one) => one.space !== null)
    .map((one) => (one.prefix ? `${one.space}/${one.prefix}` : one.space))
    .sort();

  check("directories that arrived from outside the app are picked up",
    moved.reconcileSpaces(["Agendas", "Agendas", "Papers", ""], { actor: "aza" }).sort(),
    ["Agendas", "Papers"]);
  check("...and asking again adds nothing",
    moved.reconcileSpaces(["Agendas", "Papers"]), []);
  check("...and a statement can be written about one straight away",
    moved.write({
      effect: "deny",
      subject: { kind: "group", id: theirEveryone.id },
      spaceDir: "Agendas",
      level: "read"
    }).ok,
    true);
  check("...which refuses the documents in it",
    moved.decide(editor, "Agendas/june.md", "doc:read").allowed, false);

  (() => {
    for (const row of moved.statements().filter((one) => one.space === "Agendas")) {
      moved.remove(row.id);
    }
  })();

  check("a new top-level directory gets a space",
    Boolean(moved.ensureSpaceForDir("Minutes", { actor: "aza" })), true);
  check("...and is then the space it already has",
    moved.ensureSpaceForDir("Minutes"), null);
  check("a folder inside a space is a path, not a space",
    [moved.ensureSpaceForDir("Elections/2026"), moved.spaceByDir("Elections/2026")],
    [null, null]);
  check("...and nothing at all is not a space either",
    moved.ensureSpaceForDir(""), null);

  moved.write({ effect: "deny", subject: asGroup, spaceDir: "Elections", level: "read" });
  moved.write({ effect: "deny", subject: asGroup, spaceDir: "Elections", prefix: "2026/notes.md", level: "read" });
  check("(two statements about that space)", scopes(), ["Elections", "Elections/2026/notes.md"]);

  check("renaming the space renames one row and leaves the statements alone",
    moved.followFolderMove("Elections", "Ballots", { actor: "aza" }),
    { renamedSpace: true, rewritten: 0 });
  check("...and they are about the new name now",
    scopes(), ["Ballots", "Ballots/2026/notes.md"]);
  check("...so the document under it is still refused",
    moved.decide(editor, "Ballots/2026/notes.md", "doc:read").allowed, false);
  check("...and nothing is refused under the name it used to have",
    moved.decide(editor, "Elections/2026/notes.md", "doc:read").allowed, true);

  check("renaming a folder inside a space rewrites the statements under it",
    moved.followFolderMove("Ballots/2026", "Ballots/2027"),
    { renamedSpace: false, rewritten: 1 });
  check("...to the same place under the new name",
    scopes(), ["Ballots", "Ballots/2027/notes.md"]);

  /* A space moved inside another space. Its statements become prefixes in
   * that one, and the row goes last — the foreign key would otherwise have
   * taken the statements with it.
   */
  check("a space moved into another space keeps its statements",
    moved.followFolderMove("Ballots", "Minutes/Ballots"),
    { renamedSpace: false, rewritten: 2 });
  check("...as prefixes in the space it moved into",
    scopes(), ["Minutes/Ballots", "Minutes/Ballots/2027/notes.md"]);
  check("...and the space it was stops being one",
    moved.spaceByDir("Ballots"), null);
  check("...while the documents under it are still refused",
    moved.decide(editor, "Minutes/Ballots/2027/notes.md", "doc:read").allowed, false);

  check("a folder promoted to the top level becomes a space",
    moved.followFolderMove("Minutes/Ballots", "Ballots"),
    { renamedSpace: false, rewritten: 2 });
  check("...with its statements in it",
    scopes(), ["Ballots", "Ballots/2027/notes.md"]);
  check("...and a row of its own",
    Boolean(moved.spaceByDir("Ballots")), true);

  check("a move to nowhere in particular changes nothing",
    [moved.followFolderMove("Ballots", "Ballots"), moved.followFolderMove("", "x"),
      moved.followFolderMove("Ballots", "")],
    [{ renamedSpace: false, rewritten: 0 }, { renamedSpace: false, rewritten: 0 },
      { renamedSpace: false, rewritten: 0 }]);

  /* And a directory that has gone. Its statements go with it, because the
   * paths they are about do not exist any more — the documents that were in
   * it were moved to the top level by the route that deleted the folder, and
   * the reserved space is what covers them there.
   */
  check("deleting a space takes its statements with it",
    [moved.forgetSpace("Ballots"), scopes()], [true, []]);
  check("...and the root statement is untouched, being about the library",
    moved.statements().map(renderStatement), ["allow manage group:everyone on <root>"]);
  check("a space that is not there cannot be forgotten",
    moved.forgetSpace("Nowhere"), false);
  check("...and neither can a folder inside one",
    moved.forgetSpace("Minutes/Ballots"), false);

  /* A destination whose space does not have a row yet.
   *
   * It has to be made, not worked around. Placing the statement in the
   * reserved space instead would leave it resolving to nothing — a deny that
   * had quietly stopped denying, which is the one outcome here worth
   * preventing.
   */
  check("a destination with no space of its own gets one, and keeps the statement",
    (() => {
      moved.write({ effect: "deny", subject: asGroup, spaceDir: "Minutes", level: "read" });
      const before = scopes();
      const result = moved.followFolderMove("Minutes", "Unregistered/Minutes");
      return [before, result.rewritten, scopes(), Boolean(moved.spaceByDir("Unregistered"))];
    })(),
    [["Minutes"], 1, ["Unregistered/Minutes"], true]);
  check("...and the document under it is refused, which is the whole point",
    moved.decide(editor, "Unregistered/Minutes/a.md", "doc:read").allowed, false);

  // The two ways a scope cannot be placed: nothing to place, and a database
  // with no reserved space in it at all — a library that never had the
  // migration run.
  check("a path nothing owns is placed in the space that holds loose documents",
    (() => {
      const placed = moved.placeScope("loose-note.md");
      return [Boolean(placed), placed.prefix, placed.spaceId === moved.spaceByDir("").id];
    })(),
    [true, "loose-note.md", true]);
  check("nothing is not a space to forget either",
    [moved.forgetSpace(""), moved.forgetSpace(null)], [false, false]);
  check("nothing is not a scope",
    [moved.placeScope(""), moved.placeScope("/"), moved.placeScope(null)],
    [null, null, null]);
  check("a path that nothing can own is not placed anywhere",
    new AccessStore({ db: db.open(path.join(where, "bare-scope")), markdownDir: library })
      .placeScope("notes.md"),
    null);
}

console.log("=== a statement that is true of the request rather than of the library ===");
{
  /* PUBLIC_READS is the operator saying the whole library is readable without
   * an account, which is exactly `allow read to public at the root`. The guard
   * hands it to the decision for that request rather than writing it down,
   * because it is not the owner's policy — it goes away when the variable
   * does — and it is said as a statement so the one algorithm still explains
   * the answer.
   */
  const { PUBLIC_READS_STATEMENT } = require("../lib/guards.js");
  const asIfPublicReads = { extra: [PUBLIC_READS_STATEMENT] };

  check("a request with no account is refused without it",
    store.decide(null, DOC, "doc:read").allowed, false);
  check("...and allowed with it",
    store.decide(null, DOC, "doc:read", asIfPublicReads).allowed, true);
  check("...which says where the answer came from",
    store.decide(null, DOC, "doc:read", asIfPublicReads).reason,
    "allowed by: allow read public on <root>");
  check("...and still does not let it write",
    store.decide(null, DOC, "doc:write", asIfPublicReads).allowed, false);

  check("a space closed to the public stays closed, variable or no variable",
    (() => {
      const shut = store.write({
        effect: "deny",
        subject: { kind: "public" },
        spaceDir: "Elections",
        level: "read"
      });
      const answer = store.decide(null, "Elections/a.md", "doc:read", asIfPublicReads);
      store.remove(shut.id);
      return [answer.allowed, answer.reason];
    })(),
    [false, "denied by: deny read public on Elections"]);

  check("...and an account is unaffected by it either way",
    [store.decide(editor, DOC, "doc:read").allowed,
      store.decide(editor, DOC, "doc:read", asIfPublicReads).allowed],
    [true, true]);
  check("a filter takes it too, so a listing agrees with a guard",
    store.allowFilter(null, "doc:read", asIfPublicReads)(DOC), true);
}

console.log("=== a share link is a statement, not an authority ===");
{
  /* Possession of the token used to *be* the permission. Here the row reads
   * as one statement at that one document's scope and `decide()` answers,
   * which is what makes `deny read public` at the root AWS's "block public
   * access": one row that kills every public link in the library, existing
   * ones included.
   *
   * Started from the migration's own state, because what every check below
   * is about is a link working or not working on its own terms rather than
   * on whatever the sections above left behind.
   */
  store.db.prepare("DELETE FROM grants").run();
  store.ensureBaseline({ actor: "aza" });

  const { shareStatement, audiencePrincipal } = access;
  const link = (file, audience = "public") => ({ file, audience });
  const everyoneId = () => store.groupByName("everyone").id;

  // The fields a statement is read by, so the check reads as the statement.
  const asFields = (one) =>
    [one.space, one.prefix, one.effect, one.level, one.subject.kind];

  check("a link reads as one statement, at the document and not at the space",
    asFields(shareStatement(link(DOC))),
    ["Contra NES Extension", "decisions/ADR-004.md", "allow", "read", "public"]);
  check("...and a document in no directory is in the reserved space, not at the root",
    asFields(shareStatement(link(LOOSE))).slice(0, 2),
    ["", "notes.md"]);
  check("a row naming no document is no statement, the alternative being a whole space",
    [shareStatement(link("")), shareStatement(link("/")), shareStatement(link(null))],
    [null, null, null]);

  check("a stranger holding the link reads that document",
    store.decideShare(link(DOC)).allowed, true);
  check("...and the answer says the link is what allowed it",
    store.decideShare(link(DOC)).reason,
    "allowed by: allow read public on Contra NES Extension/decisions/ADR-004.md");
  check("...while the document beside it stays shut",
    store.decide(null, "Contra NES Extension/decisions/ADR-005.md", "doc:read",
      { extra: [shareStatement(link(DOC))] }).allowed,
    false);
  check("...and the link does not hand over anything but reading",
    store.decide(null, DOC, "doc:write", { extra: [shareStatement(link(DOC))] }).allowed,
    false);
  check("a link to a loose document works too, which is what the reserved space is for",
    store.decideShare(link(LOOSE)).allowed, true);

  const blocked = store.write({ effect: "deny", subject: { kind: "public" }, level: "read" });
  check("one deny at the root closes every public link at once",
    [store.decideShare(link(DOC)).allowed, store.decideShare(link(LOOSE)).allowed],
    [false, false]);
  check("...saying which statement refused",
    store.decideShare(link(DOC)).reason, "denied by: deny read public on <root>");
  check("...and an account is unaffected by it, the deny naming the public principal",
    store.decide(editor, DOC, "doc:read").allowed, true);
  store.remove(blocked.id);
  check("...and lifting it brings every link back, none having been touched",
    store.decideShare(link(DOC)).allowed, true);

  const oneSpace = store.write({
    effect: "deny", subject: { kind: "public" },
    spaceDir: "Contra NES Extension", level: "read"
  });
  check("a space closed to the public closes the links into it",
    [store.decideShare(link(DOC)).allowed, store.decideShare(link(LOOSE)).allowed],
    [false, true]);
  store.remove(oneSpace.id);

  /* The space-level switch, which is not a statement in the table but is
   * answered as one: the operator saying links out of here may not be
   * published to the world at all. Said that way so the one algorithm
   * explains it, and so that it beats an `allow read public` on the space —
   * a block an allow could outvote would not be a block.
   */
  const published = store.write({
    effect: "allow", subject: { kind: "public" },
    spaceDir: "Elections", level: "read"
  });
  check("a space can be published without any link being made",
    store.decideShare(link("Elections/a.md")).allowed, true);

  store.db.prepare("UPDATE spaces SET public_links_allowed = 0 WHERE dir_name = ?")
    .run("Elections");
  store.forget();
  check("...until the space says public links are not allowed",
    store.decideShare(link("Elections/a.md")).allowed, false);
  check("...which beats the allow, rather than tying with it",
    store.decideShare(link("Elections/a.md")).reason,
    "denied by: deny read public on Elections");
  check("...and leaves the account that may read it alone",
    store.decide(editor, "Elections/a.md", "doc:read").allowed, true);
  check("...and every other space alone",
    store.decideShare(link(DOC)).allowed, true);
  check("a path no space owns has no switch to read, rather than throwing",
    store.publicLinkBlock("Nowhere At All/a.md"), []);

  store.db.prepare("UPDATE spaces SET public_links_allowed = 1 WHERE dir_name = ?")
    .run("Elections");
  store.forget();
  check("...and switching it back on restores the links",
    store.decideShare(link("Elections/a.md")).allowed, true);
  store.remove(published.id);

  check("which space a path belongs to is the rows' answer, not the path's shape",
    [store.spaceOfPath(DOC).dir_name, store.spaceOfPath(LOOSE).dir_name,
      store.spaceOfPath("Nowhere At All/a.md")],
    ["Contra NES Extension", "", null]);
  check("...and no path at all is the reserved space, rather than a throw",
    [store.spaceOfPath(null).dir_name, store.spaceOfPath("").dir_name], ["", ""]);

  /* A link for people rather than for the world. Nothing is injected for
   * this kind: a group link publishes nothing, it only says who may use it,
   * so the account's own access is what decides — which is what stops a link
   * being a way into a space somebody was shut out of.
   */
  const minutes = store.insertGroup("minutes");
  check("a link for a group is refused for a request with no account",
    store.decideShare(link(DOC, "group:everyone")).allowed, false);
  check("...saying what it wanted",
    store.decideShare(link(DOC, "group:everyone")).reason,
    "the link is for group:everyone, which needs an account");
  check("...and for an account that is not in the group",
    [store.decideShare(link(DOC, "group:minutes"), editor).allowed,
      store.decideShare(link(DOC, "group:minutes"), editor).reason],
    [false, "the account is not in group:minutes"]);
  check("an account in the group reads it",
    [store.decideShare(link(DOC, "group:everyone"), editor).allowed,
      store.decideShare(link(DOC, "group:contributors"), editor).allowed],
    [true, true]);

  const shut = store.write({
    effect: "deny", subject: { kind: "group", id: everyoneId() },
    spaceDir: "Contra NES Extension", level: "read"
  });
  check("...and the link is no way around a space they were shut out of",
    store.decideShare(link(DOC, "group:everyone"), editor).allowed, false);
  check("...while the public link to the same document is a different question",
    store.decideShare(link(DOC)).allowed, true);
  store.remove(shut.id);

  /* A group that is deleted takes its statements with it, by the trigger in
   * lib/db.js, and its members with it, by the foreign key. A link naming it
   * is then a link for nobody — which is the direction it has to fail in.
   */
  store.deleteGroup(minutes.id);
  store.deleteGroup(store.groupByName("contributors").id);
  check("a link for a group that no longer exists works for nobody",
    store.decideShare(link(DOC, "group:contributors"), editor).allowed, false);

  /* An audience nothing understands is a link that does not work, never a
   * link to the world: the one direction a parsing mistake must not take is
   * towards publishing.
   */
  check("an audience this cannot read is refused rather than read as public",
    ["everyone", "group:", "", "Public", "user:u_edit", null]
      .map((audience) => store.decideShare(link(DOC, audience)).allowed),
    [false, false, false, false, false, false]);
  check("...and says so rather than naming a statement",
    store.decideShare(link(DOC, "everyone")).reason,
    "the link names no audience this can decide about");
  check("a group link naming no document is refused, rather than asking about nowhere",
    store.decideShare(link("", "group:everyone"), editor).allowed, false);
  check("a row with no document is refused too",
    [store.decideShare(link("")).allowed, store.decideShare(link("/")).allowed,
      store.decideShare(null).allowed],
    [false, false, false]);
  check("...and says which of the two it was",
    [store.decideShare(link("")).reason, store.decideShare(link("/")).reason],
    ["the link names no document", "the link names no document"]);

  check("the principals an audience can name, and the ones it cannot",
    ["public", "group:everyone", "group:x", "", "group:", "nonsense"]
      .map((audience) => JSON.stringify(audiencePrincipal(audience))),
    ['{"kind":"public"}', '{"kind":"group","id":"everyone"}', '{"kind":"group","id":"x"}',
      "null", "null", "null"]);
  check("an audience a link may be given is public, or a group that exists",
    ["public", "group:everyone", "group:nobodies", "nonsense"]
      .map((audience) => store.audienceExists(audience)),
    [true, true, false, false]);

  check("PUBLIC_READS does not change what a link does",
    store.decideShare(link(DOC),
      null, { extra: [require("../lib/guards.js").PUBLIC_READS_STATEMENT] }).allowed,
    true);

  store.db.prepare("DELETE FROM grants").run();
  store.ensureBaseline({ actor: "aza" });
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
