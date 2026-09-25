/* How complicated this code is allowed to get.
 *
 * ESLint warns about a function that is too long, too branchy, too deeply
 * nested or takes too many arguments (see eslint.config.js). Warnings do not
 * fail a build, which is the right severity for advice — a long function is
 * sometimes exactly right, and an error there is a rule to be argued with
 * rather than a thing to be read.
 *
 * What makes the advice count is this: the number of them is written down. A
 * function that gets branchier shows up as a budget somebody has to raise on
 * purpose, and lowering these numbers after a tidy-up is the way the ratchet
 * turns. So the list of complicated functions stays a decision rather than a
 * number that drifted.
 *
 * When this fails, run `npx eslint .` and look at what is new. Either it is
 * worth it — raise the number here, in a commit that says why — or it is the
 * warning doing its job.
 */

const path = require("path");
const { ESLint } = require("eslint");
const { createChecker } = require("./helpers/check.js");

const { check, finish } = createChecker("LIMITS");

const RULES = ["complexity", "max-lines-per-function", "max-depth", "max-params"];

/* And which regexes the security plugin calls unsafe.
 *
 * This one is a list rather than a count, because the answer is per regex and
 * the answer is what matters. safe-regex counts nested quantifiers; it does
 * not ask whether the two levels can match the same character, which is what
 * decides between linear and exponential. It was right once — decodeDataUri
 * in lib/link-preview.js, where a data: URI's parameters could each contain
 * the separator, so `data:x;a;a;a…` with no comma had exponentially many
 * readings and forty of them would have held the event loop for hours. That
 * is fixed, and still reported, because the repeat is unambiguous now rather
 * than gone.
 *
 * The rest were each handed sixty thousand characters down the path that has
 * to fail. The worst took two milliseconds. A new one on this list has not
 * been looked at, which is the whole point of the list.
 */
const UNSAFE_REGEX_RULE = "security/detect-unsafe-regex";

const PROBED_REGEXES = [
  "lib/http/asset-versions.js:44",
  "lib/link-preview.js:672",
  "public/js/dd/paint.js:23",
  "public/js/dm/cells.js:216",
  "public/js/dm/grammar.js:12",
  "public/js/dm/grammar.js:13",
  "public/js/dm/grammar.js:89",
  "public/js/dm/grammar.js:141",
  "public/js/md/lazy.js:28",
  "public/js/md/mermaid.js:28",
  "public/js/visual-editor.js:40",
  "public/js/visual-editor.js:749",
  "test/visual/model.js:346"
];

/* The budget: none of them.
 *
 * The rules went in as warnings with seventy-four of them outstanding, and
 * then the seventy-four were dealt with by taking the functions apart. Four
 * of them were answered for a while by saying in the file why a module was
 * written as one long closure, which was true and still left four functions
 * nobody could read; those four were taken apart too, so the number below is
 * the whole story rather than the part that was easy.
 *
 * Zero is what keeps it that way: a function that grows past a limit shows up
 * here rather than in a list nobody reads.
 *
 * Raising one of these is a decision, not a mistake. Make it in a commit that
 * says why.
 */
const BUDGET = {
  complexity: 0,
  "max-lines-per-function": 0,
  "max-depth": 0,
  "max-params": 0
};

/* The places that answer the rules rather than satisfy them: none.
 *
 * There were four — the diagram editor, the guards, the document store, the
 * search index — each a module written as one long closure, where what the
 * rule could see was a huge function and what was actually there was a module.
 * Saying so above a disable was honest and did not help anybody read them, so
 * each is now what it claimed to be: a state object with a name and functions
 * that take it.
 *
 * An empty list is the point. Adding to it is allowed, and it is a change to
 * this file and a reason written above the disable rather than a quiet one.
 */
const CLOSED_OVER = [];

(async () => {
  const root = path.join(__dirname, "..");
  const eslint = new ESLint({ cwd: root });
  const results = await eslint.lintFiles(["."]);

  const counts = Object.fromEntries(RULES.map((rule) => [rule, 0]));
  for (const result of results) {
    for (const message of result.messages) {
      if (RULES.includes(message.ruleId)) {
        counts[message.ruleId] += 1;
      }
    }
  }

  console.log("=== nothing is over the limits ===");
  for (const rule of RULES) {
    check(`${rule}: ${counts[rule]} of at most ${BUDGET[rule]}`,
      counts[rule] <= BUDGET[rule], true);
  }

  console.log("=== and nothing answers them instead of satisfying them ===");
  const fs = require("fs");
  const found = [];
  const unexplained = [];

  for (const result of results) {
    const relative = path.relative(root, result.filePath);
    // This file is skipped because it contains the pattern it looks for.
    if (relative.startsWith("node_modules") || relative === path.relative(root, __filename)) {
      continue;
    }

    const lines = fs.readFileSync(result.filePath, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (!/eslint-disable-next-line[^\n]*(max-lines-per-function|complexity)/.test(line)) {
        return;
      }

      found.push(relative);

      // The reason goes above it, in the comment that says what the shape is.
      const before = (lines[index - 1] || "").trim();
      if (!before.startsWith("*/") && !before.startsWith("//") && !before.startsWith("*")) {
        unexplained.push(`${relative}:${index + 1}`);
      }
    });
  }

  check("the functions that switch a limit off are the ones on the list",
    [...new Set(found)].sort(), CLOSED_OVER);
  check("...and each says why on the line above", unexplained, []);

  console.log("=== and the regexes called unsafe are the ones that were probed ===");
  const flagged = [];
  for (const result of results) {
    const relative = path.relative(root, result.filePath);
    for (const message of result.messages) {
      if (message.ruleId === UNSAFE_REGEX_RULE) {
        flagged.push(`${relative}:${message.line}`);
      }
    }
  }

  check("every regex the plugin calls unsafe has been looked at",
    flagged.sort(), [...PROBED_REGEXES].sort());

  process.exit(finish());
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
