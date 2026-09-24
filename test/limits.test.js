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

/* The budget: none of them.
 *
 * The rules went in as warnings with seventy-four of them outstanding, and
 * then the seventy-four were dealt with — mostly by taking a function apart,
 * and four times by saying in the file why a module is written as a closure.
 * Zero is the number that keeps it that way: a function that grows past a
 * limit now shows up here rather than in a list nobody reads.
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

/* The four places that answer the rules rather than satisfy them.
 *
 * Each is a module written as a closure — the diagram editor, the guards, the
 * document store, the search index — where what the rule can see is a long
 * function and what is actually there is a module. They say so on the line
 * above the disable, and this is the list, so a fifth one is a change to this
 * file rather than a quiet addition.
 */
const CLOSED_OVER = [
  "lib/docs/search.js",
  "lib/docs/store.js",
  "lib/guards.js",
  "public/js/diagram-editor.js"
];

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

  console.log("=== and the few that answer them say why ===");
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

  check("the modules written as closures are the ones on the list",
    [...new Set(found)].sort(), CLOSED_OVER);
  check("...and each says why on the line above", unexplained, []);

  process.exit(finish());
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
