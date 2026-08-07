// Test runner. Each suite is a standalone script that prints its own checks and
// exits non-zero on failure, so any one of them can be run directly:
//
//   node test/theme.test.js
//
// This runs them all and reports which failed.

const path = require("path");
const { spawnSync } = require("child_process");

const SUITES = [
  ["layout", "layout.test.js", "Shell geometry, scroll ownership and the z-index scale"],
  ["mobile", "mobile.test.js", "Drawer behaviour, touch targets and the dark palette"],
  ["theme", "theme.test.js", "Light/dark tokens, contrast, target size and the print sheet"],
  ["diagrams", "diagrams.test.js", "Mermaid sizing and the per-theme diagram palettes"],
  ["dom", "dom.test.js", "The real app in jsdom against a real server"]
];

const only = process.argv[2];
const selected = only ? SUITES.filter(([name]) => name === only) : SUITES;

if (selected.length === 0) {
  console.error(`Unknown suite "${only}". Available: ${SUITES.map(([n]) => n).join(", ")}`);
  process.exit(1);
}

const failed = [];
const started = Date.now();

for (const [name, file, description] of selected) {
  console.log(`\n${"=".repeat(72)}`);
  console.log(`${name}  —  ${description}`);
  console.log("=".repeat(72));

  const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
    stdio: "inherit",
    // The DOM suite spawns a server; give it room on a cold CI runner.
    timeout: 120000
  });

  if (result.status !== 0) {
    failed.push(name);
  }
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\n${"=".repeat(72)}`);

if (failed.length === 0) {
  console.log(`All ${selected.length} suite(s) passed in ${seconds}s.`);
  process.exit(0);
}

console.log(`${failed.length} of ${selected.length} suite(s) FAILED in ${seconds}s: ${failed.join(", ")}`);
process.exit(1);
