#!/usr/bin/env node
/* `npm audit`, for the libraries npm cannot see.
 *
 * Seven of the eight third-party libraries this app runs in the browser arrive
 * as <script> tags or lazily fetched URLs, so they are not in package.json and
 * `npm audit` has never looked at one of them. They are all npm packages, and
 * every one is pinned to an exact version — so the versions are collected out
 * of the source (tools/cdn-pins.js), written into a manifest nobody installs,
 * and handed to the same advisory database the real audit uses.
 *
 * This found that the pinned DOMPurify — the sanitizer every rendered document
 * goes through — was twenty XSS advisories behind, which is the whole argument
 * for running it.
 *
 *   node tools/audit-cdn.js               report, and fail on high or critical
 *   node tools/audit-cdn.js --level=low   fail on anything at all
 *
 * It needs the network, because that is where the advisories are. A run that
 * cannot reach the registry says so and exits 0: this is a thing to be told
 * about, not a reason a build cannot ship.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { cdnPins, cdnAssets } = require("./cdn-pins.js");

const ORDER = ["info", "low", "moderate", "high", "critical"];

function manifestFor(pins) {
  const dependencies = {};
  for (const pin of pins) {
    // One version per package, and a package pinned twice differently is
    // reported below rather than silently resolved here.
    dependencies[pin.name] = pin.versions[0];
  }

  return JSON.stringify({
    name: "cdn-pins", version: "0.0.0", private: true, dependencies
  }, null, 2);
}

/* A lockfile without a download.
 *
 * `--package-lock-only` resolves the tree from the registry's metadata and
 * writes the lockfile; nothing is fetched and no install script runs, which is
 * what makes this safe to run in CI against packages this repo does not
 * otherwise trust to execute.
 */
function auditIn(dir) {
  const run = (args) => execFileSync("npm", args, {
    cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
  });

  run(["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"]);

  try {
    return JSON.parse(run(["audit", "--json"]));
  } catch (error) {
    // npm audit exits non-zero when it finds something, and the report is on
    // stdout either way.
    if (error.stdout) {
      return JSON.parse(error.stdout);
    }

    throw error;
  }
}

function report(audit, threshold) {
  const advisories = Object.values(audit.vulnerabilities || {})
    .filter((one) => one.via.some((via) => typeof via === "object"));

  if (advisories.length === 0) {
    console.log("  nothing outstanding");
    return 0;
  }

  let failing = 0;
  for (const one of advisories.sort((a, b) => ORDER.indexOf(b.severity) - ORDER.indexOf(a.severity))) {
    const named = one.via.filter((via) => typeof via === "object");
    const over = ORDER.indexOf(one.severity) >= ORDER.indexOf(threshold);
    failing += over ? 1 : 0;

    console.log(`\n  ${over ? "FAIL" : "note"}  ${one.name} ${one.range} — `
      + `${one.severity}, ${named.length} advisor${named.length === 1 ? "y" : "ies"}`);
    for (const via of named.slice(0, 6)) {
      console.log(`          ${via.title}`);
      console.log(`          ${via.url}`);
    }
    if (named.length > 6) {
      console.log(`          ...and ${named.length - 6} more`);
    }
    if (one.fixAvailable && one.fixAvailable.version) {
      console.log(`          fixed in ${one.name}@${one.fixAvailable.version}`);
    }
  }

  return failing;
}

/* ...and that each hash is still the hash of what is at that URL.
 *
 * Two reasons, and only one of them is the exciting one. The dull one is that
 * a version bump means editing a URL and an opaque string beside it, and
 * getting the second wrong is a script the browser silently refuses to run.
 * The other is that this is what SRI is for: if a pinned file's bytes have
 * changed, the pin is the only thing that would have said so.
 */
async function checkHashes(assets) {
  const seen = new Map();
  let wrong = 0;

  for (const asset of assets) {
    if (seen.has(asset.url)) {
      if (seen.get(asset.url) !== asset.integrity) {
        console.log(`\n  FAIL  ${asset.url}`);
        console.log("          is pinned to two different hashes in different files");
        wrong += 1;
      }
      continue;
    }

    seen.set(asset.url, asset.integrity);

    const [algorithm] = asset.integrity.split("-");
    const response = await fetch(asset.url);
    if (!response.ok) {
      console.log(`\n  note  ${asset.url}`);
      console.log(`          could not be fetched (${response.status})`);
      continue;
    }

    const body = Buffer.from(await response.arrayBuffer());
    const actual = `${algorithm}-${crypto.createHash(algorithm).update(body).digest("base64")}`;
    if (actual !== asset.integrity) {
      console.log(`\n  FAIL  ${asset.url}`);
      console.log(`          pinned  ${asset.integrity}`);
      console.log(`          actual  ${actual}`);
      wrong += 1;
    }
  }

  console.log(`  ${seen.size} assets checked, ${wrong === 0 ? "every hash matches" : `${wrong} wrong`}`);
  return wrong;
}

async function main() {
  const asked = process.argv.find((one) => one.startsWith("--level="));
  const threshold = asked ? asked.slice("--level=".length) : "high";
  if (!ORDER.includes(threshold)) {
    console.error(`--level must be one of ${ORDER.join(", ")}`);
    return 2;
  }

  const pins = cdnPins();
  console.log(`=== ${pins.length} libraries the browser loads, which npm audit cannot see ===\n`);
  for (const pin of pins) {
    console.log(`  ${pin.name.padEnd(22)} ${pin.versions.join(", ").padEnd(10)} ${pin.files.join(", ")}`);
  }

  const disagreeing = pins.filter((pin) => pin.versions.length > 1);
  for (const pin of disagreeing) {
    console.log(`\n  FAIL  ${pin.name} is pinned to ${pin.versions.join(" and ")} in different files`);
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cdn-audit-"));
  try {
    fs.writeFileSync(path.join(dir, "package.json"), manifestFor(pins));
    console.log(`\n=== the bytes at those addresses are the bytes we pinned ===`);
    const wrong = await checkHashes(cdnAssets());

    console.log(`\n=== what the advisory database says about those versions ===`);
    const failing = report(auditIn(dir), threshold) + disagreeing.length + wrong;

    console.log(failing === 0
      ? `\nNothing at ${threshold} or above.`
      : `\n${failing} at ${threshold} or above.`);
    return failing === 0 ? 0 : 1;
  } catch (error) {
    // No registry, no answer — and no opinion either. A build that cannot
    // reach the network has a different problem than this one.
    console.log(`\n  (could not reach the registry: ${error.message.split("\n")[0]})`);
    return 0;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().then((code) => process.exit(code));
