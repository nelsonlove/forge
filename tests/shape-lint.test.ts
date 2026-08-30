import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectShapeNamesFromDocuments,
  collectShapeTemplatesFromDocuments,
  extractHeadings,
  runShapeLintForDocuments,
  templateFileToShapeName,
} from "../src/shapes/lint.js";
import { shapeNameToTemplateFileName } from "../src/shapes/identity.js";
import { DEFAULT_SETTINGS } from "../src/config/settings.js";
import type { ForgeDocument } from "../src/linting/model.js";

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
});
