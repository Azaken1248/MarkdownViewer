// Part of the visual suite. See visual.test.js, which loads the modules.
//
// Maths, through the two places it can be damaged.
//
// Inline `$...$` used to be left in the line for KaTeX to find after markdown
// had already run over it, which meant markdown applied its own escaping to
// TeX first. Two things came of that, and this file is here so neither comes
// back:
//
//   Rendering. `\\` is an escaped backslash in markdown and becomes one, and
//   `\{` becomes a bare brace — so `$\left\{ ... \\ ... \right\}$` reached
//   KaTeX as `\left{ ... \ ...` and rendered as an error. In the Linear
//   Algebra notes this file was written against, three formulas failed that
//   way and 952 did not, which is what made it hard to notice.
//
//   Editing, which was worse. The serializer escapes a backslash in a text
//   node, so a paragraph holding `$\alpha$` came back from an in-place edit as
//   `$\\alpha$` — and again on the next edit. Saving a document twice doubled
//   every backslash in it.
//
// Both are the same fix: maths is lifted out before markdown sees it and put
// back afterwards, so it is never prose. These check that it is lifted, that
// what is lifted is exactly what was written, and that things which merely
// look like maths are left alone.

module.exports = ({ check, VE, MdText, JSDOM }) => {
  // A document to build blocks in. The suite runs in this process's global
  // scope rather than a window, so it makes its own where it needs one.
  const { window } = new JSDOM("");
  const { document } = window;


  // The document as markdown, through the pass that protects maths, into a
  // block, and back out as markdown. What goes in must come out.
  function roundTripsThroughEditor(source) {
    const host = document.createElement("div");
    const paragraph = document.createElement("p");
    // marked passes inline HTML through untouched, so the marker survives it.
    paragraph.innerHTML = MdText.normalizeMarkdownMath(source);
    host.appendChild(paragraph);
    return VE.serializeEditedBlock(host).trim();
  }

  console.log("=== maths is taken out before markdown can read it ===");

  const lifted = MdText.normalizeMarkdownMath("A vector $\\alpha$ here.");
  check("an inline formula becomes a marker", /class="math-inline"/.test(lifted), true);
  check("...carrying the TeX where nothing can alter it",
    /data-math-tex="[A-Za-z0-9+/=]+"/.test(lifted), true);
  check("...and showing its source, for the editor to render without KaTeX",
    lifted.includes("$\\alpha$"), true);
  check("the prose around it is untouched",
    lifted.startsWith("A vector ") && lifted.endsWith(" here."), true);

  console.log("=== what markdown used to eat ===");

  for (const [what, source] of [
    ["a brace delimiter", "$\\left\\{ x \\right\\}$"],
    ["a matrix row separator", "$\\begin{bmatrix} 0 & 0 \\\\ y & 0 \\end{bmatrix}$"],
    ["both at once, which is the formula that failed",
      "Set $W = \\left\\{ \\begin{bmatrix} 0 & 0 \\\\ y & 0 \\end{bmatrix} : y \\in \\mathbb{R} \\right\\}$."],
    ["a norm", "$\\|v\\|$"],
    ["a blackboard letter", "$\\mathbb{R}^n$"],
    ["a subscript and a superscript", "$a_1 + a_2 = x^2$"],
    ["two formulas in one line", "Both $\\alpha$ and $\\beta$ hold."]
  ]) {
    check(`${what} survives the round trip`, roundTripsThroughEditor(source), source);
  }

  /* The failure this replaces compounded, which is why it is checked twice
   * over rather than once: the serializer escaped what it was given, so the
   * second edit escaped the first edit's escaping.
   */
  const once = roundTripsThroughEditor("$\\alpha$");
  const twice = roundTripsThroughEditor(once);
  check("editing the same paragraph twice does not double anything",
    [once, twice], ["$\\alpha$", "$\\alpha$"]);

  console.log("=== and what only looks like maths is left alone ===");

  for (const [what, source] of [
    ["a price and another price", "Cost is $5 and $10 today."],
    ["a dollar in a code span", "Code `$x$` stays code."],
    ["an escaped dollar", "Escaped \\$12 is money."],
    ["a lone dollar", "It cost $ and nothing more."],
    ["an opener with a space after it", "$ not maths $"]
  ]) {
    check(`${what} is not lifted`, MdText.normalizeMarkdownMath(source), source);
  }

  // A fence is code all the way down, including anything in it shaped like a
  // formula.
  const fenced = MdText.normalizeMarkdownMath("```\n$\\alpha$\n```");
  check("a fenced block is left entirely alone", fenced.includes("math-inline"), false);

  console.log("=== display maths still works the way it did ===");

  const display = MdText.normalizeMarkdownMath("$$\nx = 1\n$$");
  check("a $$ block is still its own marker", /class="math-block"/.test(display), true);
  check("...and is not also treated as inline", display.includes("math-inline"), false);
};
