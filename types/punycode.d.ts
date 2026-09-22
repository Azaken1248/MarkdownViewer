// @types/node's punycode.d.ts says `import punycode = require("punycode")`, and
// with allowJs on that resolves to node_modules/punycode/punycode.js — an old
// library the checker then reads and finds fault with, none of which is ours
// (nothing here uses punycode; it is a transitive dependency of jsdom). The
// `paths` entry in jsconfig.json points that one name here instead, where
// there is nothing to check.
export {};
