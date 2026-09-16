// A child of test/db.test.js. Given a data directory and a tag, it opens the
// same database every other child is opening and writes a hundred rows into
// each store, so the parent can check that nothing any of them wrote was lost.
const path = require("path");
const db = require("../../lib/db");
const { ShareStore } = require("../../lib/shares");
const { LinkStore } = require("../../lib/links");
const { AuthStore } = require("../../lib/auth");
const { createOrganizerFile } = require("../../lib/docs/organizer");

const [dataDir, tag, count] = process.argv.slice(2);
const n = Number(count);

(async () => {
  const handle = db.open(dataDir);
  const shares = new ShareStore({ dataDir, db: handle });
  const links = new LinkStore({ dataDir, db: handle });
  const auth = new AuthStore({ dataDir, db: handle });
  const organizer = createOrganizerFile({ filePath: path.join(dataDir, "document-organizer.json"), db: handle });
  await shares.load();
  await links.load();
  await auth.load();

  for (let i = 0; i < n; i += 1) {
    await shares.create(`${tag}/doc-${i}.md`, { createdBy: tag });
    await links.create({ url: `https://${tag}.example/${i}`, title: `${tag} ${i}`, fetched: true }, { createdBy: tag });
    // The organizer is the read-modify-write case: every process reads the
    // whole state, adds one folder, and writes the whole state back. Under a
    // whole-file store this is exactly the shape that lost work.
    await organizer.mutateOrganizerState((state) => {
      state.folders.push({ id: `folder_${tag}_${i}`, name: `${tag} ${i}`, parentId: null, order: i });
    });
  }

  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
