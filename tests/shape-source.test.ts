import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractShapeBlock } from "../src/fileclass/shape-source.js";

describe("class-note shape block extraction", () => {
  it("reads the fence under ## Shape, verbatim", () => {
    const body = [
      "# Task", "", "Prose about the class.", "",
      "## Shape", "", "```md", "# {{TITLE}}", "## Purpose", "### Detail", "```", "",
      "## History", "more prose",
    ].join("\n");
    assert.equal(extractShapeBlock(body), "# {{TITLE}}\n## Purpose\n### Detail");
  });

  it("returns null when there is no Shape section", () => {
    assert.equal(extractShapeBlock("# Task\n\n```md\n# Not a shape\n```\n"), null);
  });

  it("returns null when the Shape section has no fence", () => {
    assert.equal(extractShapeBlock("## Shape\n\nJust prose.\n\n## Next\n"), null);
  });

  it("stops at the next H2 — a fence after the section is not the shape", () => {
    const body = "## Shape\n\ntext only\n\n## Examples\n\n```md\n# Example\n```\n";
    assert.equal(extractShapeBlock(body), null);
  });

  it("ignores fences before the Shape section", () => {
    const body = "```md\n# Decoy\n```\n\n## Shape\n\n```md\n# Real\n```\n";
    assert.equal(extractShapeBlock(body), "# Real");
  });

  it("matches the heading case-insensitively but exactly", () => {
    assert.equal(extractShapeBlock("## shape\n```md\n# X\n```"), "# X");
    assert.equal(extractShapeBlock("## Shapes\n```md\n# X\n```"), null);
  });

  it("accepts tilde fences and any info string", () => {
    assert.equal(extractShapeBlock("## Shape\n~~~markdown\n# X\n~~~"), "# X");
  });

  it("does not let an inner shorter fence close the block", () => {
    const body = "## Shape\n````md\n# X\n```\n## inner\n```\n````\n";
    assert.equal(extractShapeBlock(body), "# X\n```\n## inner\n```");
  });

  it("reads an unclosed fence to the end rather than swallowing beyond the note", () => {
    assert.equal(extractShapeBlock("## Shape\n```md\n# X\n## Y"), "# X\n## Y");
  });

  it("returns null for an empty fence", () => {
    assert.equal(extractShapeBlock("## Shape\n```md\n```\n"), null);
  });
});
