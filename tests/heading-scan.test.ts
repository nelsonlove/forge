import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scanHeadings, scanHeadingsInContent } from "../src/shapes/headings.js";

const texts = (content: string) => scanHeadingsInContent(content).map((h) => h.text);

describe("heading scanning", () => {
  it("still finds ordinary headings", () => {
    assert.deepEqual(texts("# Title\n\n## Overview\n\ntext\n\n### Detail\n"), [
      "Title",
      "Overview",
      "Detail",
    ]);
  });

  it("ignores a heading-shaped line inside a fenced code block", () => {
    // The real-world case: a shell comment. Measured on one vault, 59 notes hit this.
    const content = "# Title\n\n```bash\n# rebuild the index\n```\n\n## Real\n";
    assert.deepEqual(texts(content), ["Title", "Real"]);
  });

  it("ignores headings in a tilde fence", () => {
    assert.deepEqual(texts("# Title\n\n~~~\n## Not a heading\n~~~\n"), ["Title"]);
  });

  it("treats a shorter fence inside a longer one as content", () => {
    // How a markdown example shows fenced code without ending its own block. The inner
    // ``` must not close the outer ````, or everything after it leaks back in.
    const content = ["# Title", "", "````md", "```", "# inner", "```", "````", "", "## Real"].join("\n");
    assert.deepEqual(texts(content), ["Title", "Real"]);
  });

  it("does not let a fence with an info string close a block", () => {
    // Only a bare run closes; ```md opens, so a second ```md is still content.
    const content = ["# Title", "", "```", "# hidden", "```js", "# also hidden", "```", "", "## Real"].join("\n");
    assert.deepEqual(texts(content), ["Title", "Real"]);
  });

  it("ignores headings inside a %% comment block", () => {
    const content = "# Title\n\n%%\n## Commented out\n%%\n\n## Real\n";
    assert.deepEqual(texts(content), ["Title", "Real"]);
  });

  it("keeps scanning after a balanced inline %% comment", () => {
    // A complete comment on one line must not open a block and swallow the rest.
    const content = "# Title\n\n%% an aside %%\n\n## Real\n";
    assert.deepEqual(texts(content), ["Title", "Real"]);
  });

  it("skips frontmatter and reports absolute line numbers", () => {
    const content = "---\ntype: shape\n---\n\n# Title\n";
    const found = scanHeadingsInContent(content);
    assert.equal(found.length, 1);
    assert.equal(found[0].text, "Title");
    assert.equal(found[0].lineIndex, 4);
  });

  it("treats an unterminated frontmatter opener as body", () => {
    // Dropping the whole file would silently remove every heading in it.
    assert.deepEqual(texts("---\nstill going\n\n# Title\n"), ["Title"]);
  });

  it("reports line numbers relative to the lines it was given", () => {
    assert.deepEqual(scanHeadings(["intro", "# Title"]), [
      { level: 1, text: "Title", lineIndex: 1 },
    ]);
  });

  it("records level and trims heading text", () => {
    assert.deepEqual(scanHeadings(["###   Spaced   "]), [
      { level: 3, text: "Spaced", lineIndex: 0 },
    ]);
  });
});
