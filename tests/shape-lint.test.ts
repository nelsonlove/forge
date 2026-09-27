import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  collectShapeNamesFromDocuments,
  collectShapeTemplatesFromDocuments,
  extractHeadings,
  runShapeLintForDocuments,
  templateFileToShapeName,
} from "../src/shapes/lint.js";
import {
  deriveShapeHeadings,
  deriveShapeHeadingText,
  shapeHeadingsForClassNote,
} from "../src/shapes/derive.js";
import { shapeNameToTemplateFileName } from "../src/shapes/identity.js";
import { DEFAULT_SETTINGS } from "../src/config/settings.js";
import type { ForgeDocument } from "../src/linting/model.js";

/** The repository root, from the compiled test's location under `.tmp-test/tests/`. */
const repoRoot = path.resolve(__dirname, "..", "..");

const baseDocument: ForgeDocument = {
  path: "Projects/Example.md",
  basename: "Example",
  extension: "md",
  content: "",
  frontmatter: { type: "project" },
  hasFrontmatter: true,
};

describe("shape heading lint", () => {
  it("extracts headings while skipping frontmatter", () => {
    const headings = extractHeadings([
      "---",
      "title: Example",
      "---",
      "# Overview",
      "## Details",
    ].join("\n"));

    assert.deepEqual(headings.map((heading) => heading.text), ["Overview", "Details"]);
    assert.equal(templateFileToShapeName("Template, Project"), "project");
    assert.equal(
      templateFileToShapeName("Template, Task%2FProject"),
      "task/project"
    );
    assert.equal(
      shapeNameToTemplateFileName("Task/Project"),
      "Template, Task%2FProject.md"
    );
  });

  it("collects shape templates from plain documents", () => {
    const documents: ForgeDocument[] = [
      {
        path: "System/Templates/Template, Project.md",
        basename: "Template, Project",
        extension: "md",
        content: "# Overview\n",
        frontmatter: {},
        hasFrontmatter: false,
      },
      {
        path: "System/Templates/Other.md",
        basename: "Other",
        extension: "md",
        content: "# Ignored\n",
        frontmatter: {},
        hasFrontmatter: false,
      },
      {
        path: "Elsewhere/Template, Area.md",
        basename: "Template, Area",
        extension: "md",
        content: "# Ignored\n",
        frontmatter: {},
        hasFrontmatter: false,
      },
      {
        path: "System/Templateship/Template, Wrong.md",
        basename: "Template, Wrong",
        extension: "md",
        content: "# Ignored\n",
        frontmatter: {},
        hasFrontmatter: false,
      },
      {
        path: "\\System\\Templates\\Template, Area.MD",
        basename: "Template, Area",
        extension: "MD",
        content: "# Area\n",
        frontmatter: {},
        hasFrontmatter: false,
      },
      {
        path: "System/Templates/Template, Task%2FProject.md",
        basename: "Template, Task%2FProject",
        extension: "md",
        content: "# {{TITLE}}\n",
        frontmatter: { type: "Task/Project" },
        hasFrontmatter: true,
      },
    ];

    assert.deepEqual(collectShapeTemplatesFromDocuments(documents, "/System/Templates/"), [
      {
        shape: "project",
        path: "System/Templates/Template, Project.md",
        content: "# Overview\n",
      },
      {
        shape: "area",
        path: "\\System\\Templates\\Template, Area.MD",
        content: "# Area\n",
      },
      {
        shape: "Task/Project",
        path: "System/Templates/Template, Task%2FProject.md",
        content: "# {{TITLE}}\n",
      },
    ]);
    assert.deepEqual(collectShapeTemplatesFromDocuments(documents, ""), []);
  });

  it("collects valid shape names from plain documents", () => {
    const documents: ForgeDocument[] = [
      {
        path: "Forge/Shapes/project.md",
        basename: "project",
        extension: "md",
        content: "",
        frontmatter: {},
        hasFrontmatter: false,
      },
      {
        path: "\\Forge\\Shapes\\Capability.MD",
        basename: "Capability",
        extension: "MD",
        content: "",
        frontmatter: {},
        hasFrontmatter: false,
      },
      {
        path: "Forge/Shapes/project.md",
        basename: "project",
        extension: "md",
        content: "",
        frontmatter: {},
        hasFrontmatter: false,
      },
      {
        path: "Forge/Shapeshift/not-a-shape.md",
        basename: "not-a-shape",
        extension: "md",
        content: "",
        frontmatter: {},
        hasFrontmatter: false,
      },
      {
        path: "Forge/Shapes/Collection/Log.md",
        basename: "Log",
        extension: "md",
        content: "",
        frontmatter: {},
        hasFrontmatter: false,
      },
      {
        path: "Forge/Shapes/Agent/Log.md",
        basename: "Log",
        extension: "md",
        content: "",
        frontmatter: {},
        hasFrontmatter: false,
      },
    ];

    assert.deepEqual(collectShapeNamesFromDocuments(documents, "/Forge/Shapes/"), [
      "project",
      "Capability",
      "Collection/Log",
      "Agent/Log",
    ]);
    assert.deepEqual(
      collectShapeNamesFromDocuments(documents, "/Forge/Shapes/", false),
      ["project", "Capability"]
    );
  });

  it("matches namespaced shapes and non-empty dynamic heading placeholders", () => {
    const result = runShapeLintForDocuments({
      settings: {
        ...DEFAULT_SETTINGS,
        shapeLintEnabled: true,
        shapeLintStrictMode: true,
      },
      templates: [
        {
          shape: "Task/Project",
          content: "# {{TITLE}}\n## Log for {{DATE}}\n",
        },
      ],
      documents: [
        {
          ...baseDocument,
          frontmatter: { type: "Task/Project" },
          content: "---\ntype: Task/Project\n---\n# Apollo Migration\nBody\n## Log for 2026-08-24\nEntry\n",
        },
      ],
    });

    assert.deepEqual(result.results, []);
  });

  it("requires wildcard headings to contain concrete text", () => {
    const result = runShapeLintForDocuments({
      settings: {
        ...DEFAULT_SETTINGS,
        shapeLintEnabled: true,
      },
      templates: [{ shape: "project", content: "# Log for {{DATE}}\n" }],
      documents: [
        {
          ...baseDocument,
          content: "---\ntype: project\n---\n# Log for \n",
        },
      ],
    });

    assert.deepEqual(result.results.map((issue) => issue.rule), ["shape_heading_missing"]);
  });

  it("does not let a wildcard consume a fixed sibling heading", () => {
    const result = runShapeLintForDocuments({
      settings: {
        ...DEFAULT_SETTINGS,
        shapeLintEnabled: true,
      },
      templates: [{ shape: "project", content: "# {{TITLE}}\n# Summary\n" }],
      documents: [
        {
          ...baseDocument,
          content: "---\ntype: project\n---\n# Summary\nDone\n",
        },
      ],
    });

    assert.deepEqual(result.results.map((issue) => issue.rule), ["shape_heading_missing"]);
    assert.match(result.results[0]?.message ?? "", /\{\{TITLE\}\}/);
  });

  it("reports missing required template headings over plain documents", () => {
    const result = runShapeLintForDocuments({
      settings: {
        ...DEFAULT_SETTINGS,
        shapeLintEnabled: true,
        shapeTypeTargetField: "type",
      },
      templates: [
        {
          shape: "project",
          content: "# Overview\n## Details\n",
        },
      ],
      documents: [
        {
          ...baseDocument,
          content: "---\ntype: project\n---\n# Overview\nBody\n",
        },
      ],
      schemaVersion: "1.0.0",
    });

    assert.equal(result.envelope.notes_scanned, 1);
    assert.deepEqual(result.results.map((issue) => issue.rule), ["shape_heading_missing"]);
    assert.equal(result.results[0]?.severity, "warning");
    assert.deepEqual(result.results[0]?.range, {
      start: { line: 3, character: 0 },
      end: { line: 3, character: 10 },
    });
  });

  it("ignores non-markdown documents during shape lint scans", () => {
    const result = runShapeLintForDocuments({
      settings: {
        ...DEFAULT_SETTINGS,
        shapeLintEnabled: true,
        shapeTypeTargetField: "type",
      },
      templates: [
        {
          shape: "project",
          content: "# Overview\n## Details\n",
        },
      ],
      documents: [
        {
          ...baseDocument,
          path: "Projects/Example.pdf",
          basename: "Example",
          extension: "pdf",
          content: "---\ntype: project\n---\n# Overview\nBody\n",
        },
        {
          ...baseDocument,
          path: "Projects/Example.json",
          basename: "Example",
          extension: "json",
          content: "---\ntype: project\n---\n# Overview\nBody\n",
        },
      ],
      schemaVersion: "1.0.0",
    });

    assert.equal(result.envelope.notes_scanned, 0);
    assert.deepEqual(result.results, []);
  });

  it("reports extra headings when strict shape linting is enabled", () => {
    const result = runShapeLintForDocuments({
      settings: {
        ...DEFAULT_SETTINGS,
        shapeLintEnabled: true,
        shapeLintStrictMode: true,
      },
      templates: [
        {
          shape: "project",
          content: "# Overview\n",
        },
      ],
      documents: [
        {
          ...baseDocument,
          content: "---\ntype: project\n---\n# Overview\nBody\n## Extra\n",
        },
      ],
    });

    assert.equal(result.results.some((issue) => issue.rule === "shape_heading_extra"), true);
    assert.deepEqual(result.results.find((issue) => issue.rule === "shape_heading_extra")?.range, {
      start: { line: 5, character: 0 },
      end: { line: 5, character: 8 },
    });
  });

  it("keeps Obsidian baseline wording for heading order issues", () => {
    const result = runShapeLintForDocuments({
      settings: {
        ...DEFAULT_SETTINGS,
        shapeLintEnabled: true,
      },
      templates: [
        {
          shape: "project",
          content: "# Alpha\n# Beta\n",
        },
      ],
      documents: [
        {
          ...baseDocument,
          content: "---\ntype: project\n---\n# Beta\nBody\n# Alpha\nBody\n",
        },
      ],
    });

    assert.equal(
      result.results.find((issue) => issue.rule === "shape_heading_order")?.message,
      "Headings out of order for shape 'project'. Expected: 'alpha' → 'beta'"
    );
  });

  it("reports empty sections at the matching heading range", () => {
    const result = runShapeLintForDocuments({
      settings: {
        ...DEFAULT_SETTINGS,
        shapeLintEnabled: true,
      },
      templates: [
        {
          shape: "project",
          content: "# Overview\n",
        },
      ],
      documents: [
        {
          ...baseDocument,
          content: "---\ntype: project\n---\n# Overview\n",
        },
      ],
    });

    assert.equal(result.results.some((issue) => issue.rule === "shape_section_empty"), true);
    assert.deepEqual(result.results.find((issue) => issue.rule === "shape_section_empty")?.range, {
      start: { line: 3, character: 0 },
      end: { line: 3, character: 10 },
    });
  });

  it("allows empty sections when configured", () => {
    const result = runShapeLintForDocuments({
      settings: {
        ...DEFAULT_SETTINGS,
        shapeLintEnabled: true,
        shapeLintAllowEmptySections: true,
      },
      templates: [
        {
          shape: "project",
          content: "# Overview\n## Details\n",
        },
      ],
      documents: [
        {
          ...baseDocument,
          content: "---\ntype: project\n---\n# Overview\n## Details\n",
        },
      ],
    });

    assert.equal(result.results.some((issue) => issue.rule === "shape_section_empty"), false);
  });

  it("exempts generated shape repair run notes from shape lint", () => {
    const result = runShapeLintForDocuments({
      settings: {
        ...DEFAULT_SETTINGS,
        forgeFolder: "Forge",
        exportsFolder: "Forge/Exports",
        shapeRepairRunsFolder: "System/Exports/ShapeRepairRuns",
        shapeLintEnabled: true,
        shapeTypeTargetField: "type",
      },
      templates: [
        {
          shape: "reference",
          content: "# Overview\n",
        },
      ],
      documents: [
        {
          ...baseDocument,
          path: "System/Exports/ShapeRepairRuns/shape-repair-2026-07-13_19-34-07.md",
          basename: "shape-repair-2026-07-13_19-34-07",
          frontmatter: { type: "reference" },
          content: "---\ntype: reference\n---\n# Shape Repair Run\n",
        },
        {
          ...baseDocument,
          path: "Work/Reference Missing Overview.md",
          basename: "Reference Missing Overview",
          frontmatter: { type: "reference" },
          content: "---\ntype: reference\n---\n# Shape Repair Run\n",
        },
      ],
    });

    assert.equal(result.envelope.notes_scanned, 1);
    assert.deepEqual(result.results.map((issue) => issue.file), ["Work/Reference Missing Overview.md"]);
  });
});

describe("shape lint with a list-valued type field", () => {
  const settings = { ...DEFAULT_SETTINGS, shapeLintEnabled: true, shapeTypeTargetField: "type" };
  const templates = [
    { shape: "Note", content: "## Purpose\n" },
    { shape: "Task", content: "## Steps\n" },
  ];
  const doc = (type: unknown, content: string) => ({
    ...baseDocument,
    content,
    frontmatter: { type },
    hasFrontmatter: true,
  });
  const missing = (r: { results: { rule: string; message: string }[] }) =>
    r.results.filter((x) => x.rule === "shape_heading_missing").map((x) => x.message);

  it("checks every shape in the list, not just the first", () => {
    // Body satisfies Note but not Task; the Task heading must still be reported.
    const result = runShapeLintForDocuments({
      settings,
      templates,
      documents: [doc(["Note", "Task"], "---\ntype:\n  - Note\n  - Task\n---\n\n## Purpose\n\ntext\n")],
    });
    const m = missing(result);
    assert.equal(m.length, 1);
    assert.match(m[0], /Steps/);
  });

  it("lets one heading satisfy two shapes that both require it", () => {
    const result = runShapeLintForDocuments({
      settings,
      templates: [
        { shape: "Note", content: "## Purpose\n" },
        { shape: "Task", content: "## Purpose\n" },
      ],
      documents: [doc(["Note", "Task"], "---\ntype:\n  - Note\n  - Task\n---\n\n## Purpose\n\ntext\n")],
    });
    assert.deepEqual(missing(result), []);
  });

  it("still handles a plain string exactly as before", () => {
    const result = runShapeLintForDocuments({
      settings,
      templates,
      documents: [doc("Task", "---\ntype: Task\n---\n\nno headings\n")],
    });
    assert.equal(missing(result).length, 1);
  });

  it("ignores unknown shapes in the list without dropping the known ones", () => {
    const result = runShapeLintForDocuments({
      settings,
      templates,
      documents: [doc(["Nonexistent", "Task"], "---\ntype:\n  - Nonexistent\n  - Task\n---\n\nno headings\n")],
    });
    const m = missing(result);
    assert.equal(m.length, 1);
    assert.match(m[0], /Steps/);
  });

  it("drops non-string entries rather than coercing them", () => {
    // String({}) is "[object Object]" — coercing would match nothing and read as clean.
    const result = runShapeLintForDocuments({
      settings,
      templates,
      documents: [doc([{ nested: true }, 7, null], "---\ntype: []\n---\n\nno headings\n")],
    });
    assert.deepEqual(result.results, []);
  });

  it("skips an empty list", () => {
    const result = runShapeLintForDocuments({
      settings,
      templates,
      documents: [doc([], "---\ntype: []\n---\n\nno headings\n")],
    });
    assert.deepEqual(result.results, []);
  });

  // ── regressions found in review ────────────────────────────────────────────

  const strictSettings = {
    ...DEFAULT_SETTINGS,
    shapeLintEnabled: true,
    shapeTypeTargetField: "type",
    shapeLintStrictMode: true,
    lintStrictMode: true,
  };

  it("does not call one shape's headings extra from another shape's view", () => {
    // The note satisfies BOTH shapes completely. Judging extras per shape reported
    // every heading as extra — N x (N-1) errors on a fully conformant note.
    const result = runShapeLintForDocuments({
      settings: strictSettings,
      templates: [
        { shape: "Note", content: "# Purpose\n" },
        { shape: "Task", content: "# Steps\n" },
      ],
      documents: [doc(["Note", "Task"], "---\ntype:\n  - Note\n  - Task\n---\n\n# Purpose\n\na\n\n# Steps\n\nb\n")],
    });
    assert.deepEqual(result.results.filter((r) => r.rule === "shape_heading_extra"), []);
  });

  it("still reports a heading no claimed shape accounts for", () => {
    const result = runShapeLintForDocuments({
      settings: strictSettings,
      templates: [
        { shape: "Note", content: "# Purpose\n" },
        { shape: "Task", content: "# Steps\n" },
      ],
      documents: [doc(["Note", "Task"], "---\ntype:\n  - Note\n  - Task\n---\n\n# Purpose\n\na\n\n# Steps\n\nb\n\n# Surprise\n\nc\n")],
    });
    const extra = result.results.filter((r) => r.rule === "shape_heading_extra");
    assert.equal(extra.length, 1);
    assert.match(extra[0].message, /Surprise/);
  });

  it("keeps the single-shape extra-heading wording unchanged", () => {
    const result = runShapeLintForDocuments({
      settings: strictSettings,
      templates: [{ shape: "Note", content: "# Purpose\n" }],
      documents: [doc("Note", "---\ntype: Note\n---\n\n# Purpose\n\na\n\n# Surprise\n\nb\n")],
    });
    const extra = result.results.filter((r) => r.rule === "shape_heading_extra");
    assert.equal(extra.length, 1);
    assert.match(extra[0].message, /not in shape 'Note' template/);
  });

  it("lints a repeated or case-variant entry only once", () => {
    // The heading cache is keyed lower-case, so these are one shape, not three.
    const result = runShapeLintForDocuments({
      settings,
      templates: [{ shape: "Task", content: "## Steps\n" }],
      documents: [doc(["Task", "task", "Task"], "---\ntype:\n  - Task\n  - task\n  - Task\n---\n\nno headings\n")],
    });
    assert.equal(result.results.filter((r) => r.rule === "shape_heading_missing").length, 1);
  });

  it("reports a shared missing heading once per shape that requires it", () => {
    // Pinning the policy rather than leaving it accidental: each contract reports its
    // own unmet requirement, so the message names which shape is unsatisfied.
    const result = runShapeLintForDocuments({
      settings,
      templates: [
        { shape: "Note", content: "## Purpose\n" },
        { shape: "Task", content: "## Purpose\n" },
      ],
      documents: [doc(["Note", "Task"], "---\ntype:\n  - Note\n  - Task\n---\n\nno headings\n")],
    });
    const missing = result.results.filter((r) => r.rule === "shape_heading_missing");
    assert.equal(missing.length, 2);
    assert.deepEqual(missing.map((m) => /shape '([^']+)'/.exec(m.message)?.[1]).sort(), ["Note", "Task"]);
  });

  it("ignores a non-string scalar exactly as before", () => {
    for (const t of [2026, true, { a: 1 }, "   "]) {
      const result = runShapeLintForDocuments({
        settings,
        templates: [{ shape: "Task", content: "## Steps\n" }],
        documents: [doc(t, "---\ntype: x\n---\n\nno headings\n")],
      });
      assert.deepEqual(result.results, [], `expected no findings for ${JSON.stringify(t)}`);
    }
  });

  it("trims a padded shape name in the finding message", () => {
    const result = runShapeLintForDocuments({
      settings,
      templates: [{ shape: "Task", content: "## Steps\n" }],
      documents: [doc("  Task  ", "---\ntype: Task\n---\n\nno headings\n")],
    });
    const missing = result.results.filter((r) => r.rule === "shape_heading_missing");
    assert.equal(missing.length, 1);
    assert.match(missing[0].message, /required by shape 'Task'/);
  });
});

describe("the generator-to-wildcard pass", () => {
  it("keeps a heading that is nothing but literal words", () => {
    assert.equal(deriveShapeHeadingText("Why it matters"), "Why it matters");
  });

  it("keeps a {{TITLE}}, {{VALUE:…}} or {{date:…}} token exactly as written", () => {
    assert.equal(deriveShapeHeadingText("Status of {{VALUE:url}}"), "Status of {{VALUE:url}}");
    assert.equal(deriveShapeHeadingText("Log for {{date:YYYY-MM-DD}}"), "Log for {{date:YYYY-MM-DD}}");
  });

  it("turns an inline-code render into a placeholder and keeps the words around it", () => {
    assert.equal(deriveShapeHeadingText("Status `INPUT[status]`"), "Status {{INPUT}}");
    assert.equal(deriveShapeHeadingText("`BUTTON[archive]` now"), "{{BUTTON}} now");
  });

  it("collapses a heading that reduces to nothing but a placeholder", () => {
    assert.equal(deriveShapeHeadingText("`VIEW[{title}][text]`"), "{{TITLE}}");
    assert.equal(deriveShapeHeadingText("[{{TITLE}}]({{VALUE:url}})"), "{{TITLE}}");
    assert.equal(deriveShapeHeadingText("{{date:YYYY-MM-DD}}"), "{{TITLE}}");
  });

  it("never collapses a heading that carries no placeholder at all", () => {
    // Punctuation is not a word, but a literal heading is still literal.
    assert.equal(deriveShapeHeadingText("---"), "---");
    assert.equal(deriveShapeHeadingText("`someCall()`"), "`someCall()`");
  });

  it("leaves an inline-code span that is not a render alone", () => {
    assert.equal(deriveShapeHeadingText("Use `npm test` first"), "Use `npm test` first");
  });

  it("treats an unclosed backtick run as literal text", () => {
    assert.equal(deriveShapeHeadingText("Status `INPUT[x"), "Status `INPUT[x");
  });

  it("derives a fence into headings at the levels written, ignoring everything else", () => {
    const fence = [
      "---", "status: draft", "---",
      "# `VIEW[{title}][text]`",
      "",
      "Some prose that is not a heading.",
      "",
      "| a | b |", "| - | - |",
      "",
      "```js-engine", "// # Not a heading", "```",
      "",
      "## Why it matters",
      "### Detail for {{VALUE:url}}",
    ].join("\n");

    assert.deepEqual(
      deriveShapeHeadings(fence).map((h) => ({ level: h.level, text: h.text })),
      [
        { level: 1, text: "{{TITLE}}" },
        { level: 2, text: "Why it matters" },
        { level: 3, text: "Detail for {{VALUE:url}}" },
      ]
    );
  });

  it("derives nothing from a fence with no headings", () => {
    assert.deepEqual(deriveShapeHeadings("Just prose.\n\n| a |\n| - |\n"), []);
  });
});

describe("a class note's shape, and which fence it comes from", () => {
  const settings = { ...DEFAULT_SETTINGS, shapeLintEnabled: true, shapeTypeTargetField: "type" };
  const doc = (type: unknown, content: string): ForgeDocument => ({
    ...baseDocument,
    content,
    frontmatter: { type },
    hasFrontmatter: true,
  });

  const templateFence = [
    "## Template", "", "```md",
    "# [{{TITLE}}]({{VALUE:url}})",
    "## Why it matters",
    "## Status",
    "```",
  ].join("\n");

  const shapeFence = [
    "## Shape", "", "```md",
    "# {{TITLE}}",
    "## Why it matters",
    "### Status key",
    "```",
  ].join("\n");

  const texts = (note: string) =>
    shapeHeadingsForClassNote(note).map((h) => `${"#".repeat(h.level)} ${h.text}`);

  it("derives from ## Template when the class declares no ## Shape", () => {
    const note = `---\ntitle: Link\n---\n\n# Link\n\nProse.\n\n${templateFence}\n`;
    assert.deepEqual(texts(note), ["# {{TITLE}}", "## Why it matters", "## Status"]);
  });

  it("takes an explicit ## Shape verbatim, and never derives it", () => {
    const note = `---\ntitle: Link\n---\n\n# Link\n\n${shapeFence}\n`;
    assert.deepEqual(texts(note), ["# {{TITLE}}", "## Why it matters", "### Status key"]);
  });

  it("lets an explicit ## Shape win over a ## Template, whichever comes first", () => {
    const shapeFirst = `# Link\n\n${shapeFence}\n\n${templateFence}\n`;
    const templateFirst = `# Link\n\n${templateFence}\n\n${shapeFence}\n`;
    const expected = ["# {{TITLE}}", "## Why it matters", "### Status key"];

    assert.deepEqual(texts(shapeFirst), expected);
    assert.deepEqual(texts(templateFirst), expected);
  });

  it("gives a class with neither fence no shape at all", () => {
    assert.deepEqual(shapeHeadingsForClassNote("---\ntitle: Bare\n---\n\n# Bare\n\nProse only.\n"), []);
  });

  it("gives a class with an empty ## Template fence no shape, rather than an empty one", () => {
    assert.deepEqual(shapeHeadingsForClassNote("# Bare\n\n## Template\n\n```md\n```\n"), []);
  });

  /**
   * "An explicit Shape wins" has to mean "wins when it yields a block", not "wins when
   * the heading is there" — otherwise a class whose `## Shape` section is unusable gets
   * no shape at all, when it plainly should fall through to its Template. So the
   * precedence is keyed on what the extractor returns, never on a heading test. All
   * three shapes of unusable section below are real classes in the live vault:
   * `Meta/Artifact` (empty fence), `Meta/Artifact/Report` (bare heading) and `Task/Spec`
   * (prose instead of a fence).
   */
  it("falls through to the Template when a ## Shape section yields no block", () => {
    const derived = ["# {{TITLE}}", "## Why it matters", "## Status"];

    const emptyFence = `# C\n\n## Shape\n\n\`\`\`md\n\`\`\`\n\n${templateFence}\n`;
    assert.deepEqual(texts(emptyFence), derived);

    const bareHeading = `# C\n\n## Shape\n\n${templateFence}\n`;
    assert.deepEqual(texts(bareHeading), derived);

    const proseOnly = `# C\n\n## Shape\n\nThe shape is the writing contract's.\n\n${templateFence}\n`;
    assert.deepEqual(texts(proseOnly), derived);
  });

  it("loses the headings after a nested fence of the same length, and does not invent them", () => {
    // CommonMark: a bare ``` closes a ``` fence. So a template that nests at the same
    // length truncates, and the derived shape names fewer headings than it should —
    // which reports nothing rather than reporting wrongly. A class note that nests must
    // open the outer fence longer.
    const nested = [
      "## Template", "", "```md",
      "# {{TITLE}}", "",
      "```js-engine", "// a view", "```", "",
      "## Why it matters", "## Status",
      "```",
    ].join("\n");
    assert.deepEqual(texts(`# C\n\n${nested}\n`), ["# {{TITLE}}"]);

    const longer = nested.replace("```md", "````md").replace(/```$/, "````");
    assert.deepEqual(
      texts(`# C\n\n${longer}\n`),
      ["# {{TITLE}}", "## Why it matters", "## Status"]
    );
  });

  it("gives a class-files entry that is not really a class no shape at all", () => {
    // The Fileclass index holds an entry for every markdown file in the class-files
    // folder, so a task note filed there is walked like a class. It carries no fence.
    const taskNote = [
      "---", "title: Four parked classes still bind folders by path", "type: Task", "---", "",
      "# Four parked classes still bind folders by path", "",
      "## Context", "Prose.", "",
      "## Handoff", "Prose.",
    ].join("\n");
    assert.deepEqual(shapeHeadingsForClassNote(taskNote), []);
  });

  it("does not read a fence out of the class note's own frontmatter", () => {
    const note = "---\nnote: |\n  ## Shape\n  ```md\n  # Wrong\n  ```\n---\n\n# Real\n\n" + templateFence + "\n";
    assert.deepEqual(texts(note), ["# {{TITLE}}", "## Why it matters", "## Status"]);
  });

  it("derives a shape the matcher can actually match against a real note", () => {
    const derived = shapeHeadingsForClassNote(`# Link\n\n${templateFence}\n`);
    const clean = runShapeLintForDocuments({
      settings,
      templates: [{ shape: "Link", headings: derived }],
      documents: [doc("Link", [
        "---", "type: Link", "---", "",
        "# [Some page](https://example.com)",
        "## Why it matters", "text",
        "## Status", "text",
      ].join("\n"))],
    });
    assert.deepEqual(clean.results, []);

    const broken = runShapeLintForDocuments({
      settings,
      templates: [{ shape: "Link", headings: derived }],
      documents: [doc("Link", [
        "---", "type: Link", "---", "",
        "# [Some page](https://example.com)",
        "## Why it matters", "text",
      ].join("\n"))],
    });
    const missing = broken.results.filter((r) => r.rule === "shape_heading_missing");
    assert.equal(missing.length, 1);
    assert.match(missing[0].message, /Status/);
  });
});

describe("where the shape source comes from", () => {
  it("reads the templates folder unless asked otherwise", () => {
    assert.equal(DEFAULT_SETTINGS.shapeSourceFileclass, false);
  });

  /**
   * `buildShapeHeadingCache` needs a live Obsidian `App`, so its gate cannot be called
   * from here. What it must never become, though, is reachable only while
   * `refinementSourceFileclass` is on: step 3 of the vault's adoption sets that to
   * false, and shape lint would then go silent for every class with nothing reporting
   * it. That is a one-line mistake, so it is pinned on the source rather than left to
   * a reviewer's eye.
   */
  it("gates the class-note source on shapeSourceFileclass alone", () => {
    const text = readFileSync(path.join(repoRoot, "src/commands/shape-lint.ts"), "utf8");
    assert.match(text, /if \(settings\.shapeSourceFileclass\)/);

    // Prose may name the other setting — explaining why the two are apart is the point.
    // Code may not.
    const code = text.split("\n").filter((line) => {
      const trimmed = line.trim();
      return trimmed !== "" && !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
    });
    assert.deepEqual(
      code.filter((line) => line.includes("refinementSourceFileclass")),
      [],
      "the class-note lint source must not depend on the refinement setting"
    );
  });

  /**
   * The class-note pass needs a live Obsidian `App` too, so this is the same kind of
   * pin as the gate above. It guards the one outcome the whole change exists to
   * prevent: an empty heading cache means lint checks nothing and reports a clean run,
   * which is indistinguishable from a healthy vault. Falling back is always safe;
   * returning an empty map never is.
   */
  it("never lets the class-note pass hand back an empty cache", () => {
    const text = readFileSync(path.join(repoRoot, "src/commands/shape-lint.ts"), "utf8");
    assert.match(text, /if \(cache\.size === 0\) \{[\s\S]*?return null;/);
  });

  it("has no caller in src for the headless entry points", () => {
    const sources = [
      "src/shapes/lint.ts", "src/shapes/repair.ts", "src/shapes/lint-service.ts",
      "src/commands/shape-lint.ts", "src/commands/shape-repair.ts", "src/commands/run-shape-lint.ts",
      "src/linting/engine.ts", "src/main.ts",
    ];

    for (const name of sources) {
      const text = readFileSync(path.join(repoRoot, name), "utf8");
      // The definition line in lint.ts / repair.ts is the only permitted occurrence.
      const calls = text.split("\n").filter((line) =>
        /\b(runShapeLintForDocuments|planShapeRepairForDocuments)\s*\(/.test(line) &&
        !line.trim().startsWith("export function")
      );
      assert.deepEqual(calls, [], `${name} must not call the headless entry points`);
    }
  });
});
