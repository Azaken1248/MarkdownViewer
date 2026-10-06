/* Getting a real browser, and getting signed in to it.
 *
 * Two suites drive the app in Chromium rather than jsdom, and the awkward part
 * is the same for both: a browser may not be installed, and the seeded admin
 * must change its password before it may do anything. Both were written once in
 * browser.test.js and both are needed again by accessibility.test.js, so they
 * live here instead of being copied.
 *
 * The sign-in is split in two on purpose. The forced password change happens
 * once per server, and every sign-in after it is the ordinary one — a suite
 * that guessed which password was current would be guessing about state another
 * check had already changed.
 */

const { SEED_USERNAME, SEED_PASSWORD, TEST_PASSWORD } = require("./server.js");

/* A headless Chromium, or a reason there is not one.
 *
 * Returns `{ browser }` or `{ reason }`. A browser is a 266MB install and only
 * these suites need one, so a machine that has not downloaded it should hear
 * why and pass rather than go red: the step that installs it lives in the
 * workflow, where its absence is visible.
 */
async function launchBrowser() {
  let chromium = null;
  try {
    ({ chromium } = require("playwright-core"));
  } catch {
    return { reason: "playwright-core is not installed" };
  }

  try {
    return { browser: await chromium.launch({ headless: true }) };
  } catch (error) {
    return { reason: `no browser to drive (${String(error.message).split("\n")[0]})` };
  }
}

// What to print under that reason, since it is the same answer either way.
const INSTALL_HINT = "npx playwright install chromium --only-shell";

/* Through the form, the way a person does, including the change it demands.
 *
 * Once per server. Afterwards the password is TEST_PASSWORD and signIn() is
 * what every other page wants.
 */
async function theFirstSignIn(browser, server) {
  const page = await browser.newPage();

  await page.goto(`${server.origin}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#loginUsername", { timeout: 20000 });
  await page.fill("#loginUsername", SEED_USERNAME);
  await page.fill("#loginPassword", SEED_PASSWORD);
  await page.click("#loginSubmitBtn");

  await page.waitForSelector("#currentPassword", { timeout: 20000 });
  await page.fill("#currentPassword", SEED_PASSWORD);
  await page.fill("#newPassword", TEST_PASSWORD);
  await page.fill("#confirmPassword", TEST_PASSWORD);
  await page.click("#passwordSubmitBtn");
  await waitForTheLibrary(page);
  await page.close();
}

async function signIn(page, origin) {
  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#loginUsername", { timeout: 20000 });
  await page.fill("#loginUsername", SEED_USERNAME);
  await page.fill("#loginPassword", TEST_PASSWORD);
  await page.click("#loginSubmitBtn");
  await waitForTheLibrary(page);
}

// Signed in and the tree filled, rather than merely signed in: an empty tree
// is what a refused password looks like from the outside.
function waitForTheLibrary(page) {
  return page.waitForFunction(
    () => document.querySelectorAll("#docList .tree-row-folder, #docList .tree-row-doc").length > 1,
    null,
    { timeout: 25000 }
  );
}

module.exports = {
  launchBrowser, INSTALL_HINT, theFirstSignIn, signIn, waitForTheLibrary
};
