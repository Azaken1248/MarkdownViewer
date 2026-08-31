#!/usr/bin/env node
/* The icon sprite, built here and committed rather than fetched.
 *
 * A diagram is drawn by this app itself, into an SVG it builds as a string, so
 * an icon has to be markup it already has — not a font, which cannot be
 * exported, and not a request, which cannot be made offline or from a file
 * opened over anything but this server.
 *
 * Lucide ships one SVG per icon on a 24x24 grid, all of them stroked rather
 * than filled, which is why they can be drawn in the diagram's own colours by
 * inheriting currentColor. What is kept here is the inside of each of those
 * files and nothing else: no width, no height, no viewBox, no stroke — those
 * belong to the box the icon is drawn in, and repeating them 180 times would be
 * 180 copies of a decision made once in the drawing.
 *
 * Which icons: the list below, and it is a list rather than "all of them" on
 * purpose. Lucide has two thousand; committing them would be half a megabyte
 * on a page that draws diagrams, for a set nobody browses. Chunking and
 * lazily loading the whole library is a later problem, and this file is where
 * it will be solved when it is.
 *
 *   node tools/make-icon-sprite.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FROM = path.join(ROOT, "node_modules", "lucide-static", "icons");
const TO = path.join(ROOT, "public", "js", "diagram-icons.js");

/* Grouped the way somebody looking for one would think of it, and the groups
 * are kept: the picker shows them in this order, so "the storage ones" are
 * together rather than scattered through an alphabet.
 */
const GROUPS = [
  ["Machines", `database server server-cog hard-drive cpu memory-stick microchip container
    cloud cloud-cog cloud-upload cloud-download`],
  ["Networks", `network router wifi globe globe-lock link-2 share-2 rss satellite-dish
    antenna radio-tower`],
  ["Files", `folder folder-open file file-text file-code file-json file-lock files archive
    box boxes package`],
  ["People and keys", `user users user-check user-cog shield shield-check shield-alert lock
    lock-keyhole key key-round fingerprint`],
  ["Messages", `mail mail-open send inbox message-square message-circle bell bell-ring
    megaphone phone`],
  ["Time", `calendar clock timer hourglass history refresh-cw repeat rotate-cw play pause
    square circle`],
  ["Code", `git-branch git-commit-horizontal git-merge git-pull-request terminal code
    code-xml braces binary bug`],
  ["Tools", `settings sliders-horizontal wrench hammer cog puzzle plug plug-zap zap power
    battery`],
  ["Lists", `search filter list list-checks table columns-3 rows-3 layout-grid
    layout-dashboard kanban`],
  ["Measures", `chart-line chart-bar chart-pie activity trending-up gauge target crosshair`],
  ["Answers", `check check-check x circle-check circle-x circle-alert triangle-alert info
    circle-help`],
  ["Ways through", `arrow-right arrow-left arrow-up arrow-down arrow-right-left workflow
    split merge waypoints`],
  ["Things", `smartphone laptop monitor tablet printer camera image video music headphones`],
  ["Places", `map-pin map navigation compass flag home building factory store truck`],
  ["Money", `credit-card wallet dollar-sign shopping-cart receipt scale`],
  ["Thinking", `brain bot sparkles wand-sparkles flask-conical microscope atom`],
  ["Doing", `eye eye-off download upload trash-2 pencil copy scissors clipboard bookmark
    star heart`],
  ["Weather", `sun moon cloud-rain wind droplet flame leaf tree-pine mountain`]
];

// The inside of the file, with the comment and the wrapper taken off. Whitespace
// between elements is collapsed: it is markup, and a newline in it is a byte.
function insideOf(name) {
  const file = path.join(FROM, `${name}.svg`);
  const svg = fs.readFileSync(file, "utf8");
  const opened = svg.indexOf(">", svg.indexOf("<svg"));
  const closed = svg.lastIndexOf("</svg>");

  if (opened < 0 || closed < 0) {
    throw new Error(`${name}.svg is not a shape this can read`);
  }

  return svg.slice(opened + 1, closed).replace(/\s+/g, " ").trim();
}

function build() {
  if (!fs.existsSync(FROM)) {
    throw new Error("lucide-static is not installed. `npm install` first.");
  }

  const icons = {};
  const groups = [];

  for (const [title, listed] of GROUPS) {
    const names = listed.split(/\s+/).filter(Boolean);

    for (const name of names) {
      // Loudly, rather than a gap in the picker nobody notices for a month:
      // Lucide renames icons between versions, and a name that has moved is a
      // name this has to be told about.
      if (!fs.existsSync(path.join(FROM, `${name}.svg`))) {
        throw new Error(`lucide has no icon called "${name}" any more`);
      }

      icons[name] = insideOf(name);
    }

    groups.push([title, names]);
  }

  const version = JSON.parse(fs.readFileSync(
    path.join(ROOT, "node_modules", "lucide-static", "package.json"), "utf8")).version;

  const lines = [
    "/* The icons a diagram can wear. Built, not written.",
    " *",
    ` * Lucide ${version}, ISC licensed, cut down to the set below by`,
    " * tools/make-icon-sprite.js. Run that to change it; changing this by hand is",
    " * changing something the next build will take back.",
    " *",
    " * Each is the inside of Lucide's own 24x24 file: no size, no viewBox, no",
    " * stroke. Those belong to the box the icon is drawn in.",
    " */",
    "(function (global) {",
    '  "use strict";',
    "",
    `  const VERSION = ${JSON.stringify(version)};`,
    "",
    "  const ICONS = {",
    ...Object.entries(icons).map(([name, body]) =>
      `    ${JSON.stringify(name)}: ${JSON.stringify(body)},`),
    "  };",
    "",
    "  // The order the picker shows them in, so the storage ones are together",
    "  // rather than scattered through an alphabet.",
    "  const GROUPS = [",
    ...groups.map(([title, names]) =>
      `    [${JSON.stringify(title)}, ${JSON.stringify(names)}],`),
    "  ];",
    "",
    "  global.DiagramIcons = {",
    "    VERSION,",
    "    ICONS,",
    "    GROUPS,",
    "    // The markup for one, or an empty string for a name this has never",
    "    // heard of — which is what a file written by a later version says.",
    "    bodyOf: (name) => ICONS[String(name || \"\")] || \"\",",
    "    names: () => Object.keys(ICONS)",
    "  };",
    "})(typeof window === \"undefined\" ? globalThis : window);",
    ""
  ];

  fs.writeFileSync(TO, lines.join("\n"));
  return { count: Object.keys(icons).length, version };
}

const built = build();
console.log(`Wrote ${path.relative(ROOT, TO)}: ${built.count} icons from lucide ${built.version}.`);
