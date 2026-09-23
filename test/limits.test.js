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

/* The budget, as of the last time somebody looked.
 *
 * `worstComplexity` is the branchiest single function in the tree. The five
 * worst were taken apart when these limits went in — a keyboard dispatcher, a
 * pointer handler, the parser and the writer of the diagram format, and the
 * markdown block splitter — and this is where the next one would show up.
 */
const BUDGET = {
  complexity: 54,
  "max-lines-per-function": 15,
  "max-depth": 0,
  "max-params": 5,
  worstComplexity: 37
};

(async () => {
  const eslint = new ESLint({ cwd: path.join(__dirname, "..") });
  const results = await eslint.lintFiles(["."]);

  const counts = Object.fromEntries(RULES.map((rule) => [rule, 0]));
  const complexities = [];

  for (const result of results) {
    for (const message of result.messages) {
      if (!RULES.includes(message.ruleId)) {
        continue;
      }

      counts[message.ruleId] += 1;

      if (message.ruleId === "complexity") {
        const found = message.message.match(/complexity of (\d+)/);
        complexities.push({
          value: Number(found[1]),
          where: `${path.relative(path.join(__dirname, ".."), result.filePath)}:${message.line}`
        });
      }
    }
  }

  console.log("=== the limits are advice, and the advice is counted ===");
  check("the rules are on, as warnings rather than as errors",
    results.every((result) => result.messages
      .filter((message) => RULES.includes(message.ruleId))
      .every((message) => message.severity === 1)), true);

  for (const rule of RULES) {
    check(`${rule}: ${counts[rule]} of at most ${BUDGET[rule]}`,
      counts[rule] <= BUDGET[rule], true);
  }

  complexities.sort((one, two) => two.value - one.value);
  const worst = complexities[0] || { value: 0, where: "nothing" };
  check(`the branchiest function is ${worst.value} (at most ${BUDGET.worstComplexity})`,
    worst.value <= BUDGET.worstComplexity, true);
  console.log(`  (it is ${worst.where})`);

  // A budget nobody spends is a budget that should be smaller. This says so
  // rather than quietly leaving room for the next long function.
  const slack = Object.entries(counts)
    .filter(([rule, count]) => count < BUDGET[rule])
    .map(([rule, count]) => `${rule} ${count} of ${BUDGET[rule]}`);

  if (slack.length > 0) {
    console.log(`  (room to lower: ${slack.join(", ")})`);
  }

  console.log("=== and the five that were taken apart stay apart ===");
  // Named rather than counted: these are the ones the review pointed at, and
  // a change that put any of them back together would pass the budget above
  // by making something else shorter.
  const byName = new Map(complexities.map((one) => [one.where.split(":")[0], one.value]));
  for (const file of ["public/js/dm/parse.js", "public/js/dm/serialize.js",
    "public/js/visual-editor.js", "public/js/app/tree.js"]) {
    check(`${file} has nothing over 30 in it`, (byName.get(file) || 0) <= 30, true);
  }

  process.exit(finish());
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
