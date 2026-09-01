import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyShapeRepair,
  buildShapeRepairHistoryContent,
  buildShapeRepairRunNoteArtifact,
  planShapeRepairForDocuments,
  repairShapeDocument,
} from "../src/shapes/repair.js";
import {
  buildShapeHeadingCacheFromTemplates,
} from "../src/shapes/lint.js";
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

describe("shape repair", () => {
  it("inserts missing headings while preserving frontmatter and note content", () => {
    const result = applyShapeRepair(
      "---\ntype: project\n---\nIntro\n# Overview\nBody",
      [
        { level: 1, text: "Overview", lineIndex: 0 },
        { level: 2, text: "Details", lineIndex: 1 },
        { level: 1, text: "Next", lineIndex: 2 },
      ]
    );

    assert.deepEqual(result.descriptions, [
      "Insert missing heading: '## Details' (under 'Overview')",
      "Insert missing heading: '# Next'",
    ]);
    assert.equal(
      result.repairedContent,
      "---\ntype: project\n---\nIntro\n# Overview\nBody\n## Details\n\n# Next\n"
    );
  });

  it("reorders known headings and preserves unknown user headings", () => {
    const result = applyShapeRepair(
      "# Beta\nBeta body\n# Custom\nCustom body\n# Alpha\nAlpha body",
      [
        { level: 1, text: "Alpha", lineIndex: 0 },
        { level: 1, text: "Beta", lineIndex: 1 },
      ]
    );

    assert.deepEqual(result.descriptions, [
      "Reorder headings: 'alpha' → 'beta'",
    ]);
    assert.equal(
      result.repairedContent,
      "# Alpha\nAlpha body\n# Beta\nBeta body\n# Custom\nCustom body"
    );
  });

  it("preserves concrete dynamic headings and never inserts placeholder text", () => {
    const matching = applyShapeRepair(
      "# Apollo Migration\nBody\n# Summary\nDone",
      [
        { level: 1, text: "{{TITLE}}", lineIndex: 0 },
        { level: 1, text: "Summary", lineIndex: 1 },
      ]
    );
    assert.deepEqual(matching.descriptions, []);
    assert.equal(matching.repairedContent, "# Apollo Migration\nBody\n# Summary\nDone");

    const missing = applyShapeRepair(
      "# Summary\nDone",
      [
        { level: 1, text: "{{TITLE}}", lineIndex: 0 },
        { level: 1, text: "Summary", lineIndex: 1 },
      ]
    );
    assert.deepEqual(missing.descriptions, []);
    assert.equal(missing.repairedContent, "# Summary\nDone");
    assert.doesNotMatch(missing.repairedContent, /\{\{TITLE\}\}/);
  });

  it("returns existing Obsidian skip reasons for per-document repair", () => {
    const settings = { ...DEFAULT_SETTINGS, shapeTypeTargetField: "type" };
    const headingCache = buildShapeHeadingCacheFromTemplates([
      { shape: "project", content: "# Overview\n" },
    ]);

    assert.equal(
      repairShapeDocument({
        activeDocument: { ...baseDocument, hasFrontmatter: false, frontmatter: {}, content: "# Overview\n" },
        settings,
        headingCache,
      }).file.detail,
      "No frontmatter"
    );
    assert.equal(
      repairShapeDocument({
        activeDocument: { ...baseDocument, frontmatter: {}, content: "---\n---\n# Overview\n" },
        settings,
        headingCache,
      }).file.detail,
      "No type target field"
    );
    assert.equal(
      repairShapeDocument({
        activeDocument: { ...baseDocument, frontmatter: { type: "area" }, content: "---\ntype: area\n---\n# Overview\n" },
        settings,
        headingCache,
      }).file.detail,
      "No matching template"
    );
    assert.equal(
      repairShapeDocument({
        activeDocument: { ...baseDocument, content: "---\ntype: project\n---\n# Overview\n" },
        settings,
        headingCache,
      }).file.detail,
      "Already conforms"
    );
  });

  it("plans vault-scope updates from plain documents and templates", () => {
    const plan = planShapeRepairForDocuments({
      settings: {
        ...DEFAULT_SETTINGS,
        shapeRepairScope: "folder",
        shapeRepairFolders: ["Projects"],
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
          path: "Projects/Example.md",
          content: "---\ntype: project\n---\n# Overview\n",
        },
        {
          ...baseDocument,
          path: "Archive/Example.md",
          content: "---\ntype: project\n---\n# Overview\n",
        },
      ],
      timestamp: "2026-07-13T12:00:00",
    });

    assert.equal(plan.run.ranAt, "2026-07-13T12:00:00");
    assert.equal(plan.run.repaired, 1);
    assert.equal(plan.updates.length, 1);
    assert.equal(plan.updates[0]?.path, "Projects/Example.md");
  });

  it("builds repair history and run-note artifacts", () => {
    const plan = planShapeRepairForDocuments({
      settings: DEFAULT_SETTINGS,
      templates: [{ shape: "project", content: "# Overview\n## Details\n" }],
      documents: [
        {
          ...baseDocument,
          content: "---\ntype: project\n---\n# Overview\n",
        },
      ],
      timestamp: "2026-07-13T12:00:00",
    });
    const history = buildShapeRepairHistoryContent("[]", plan.run, 20);
    const artifact = buildShapeRepairRunNoteArtifact(DEFAULT_SETTINGS, plan.run, "2026-07-13");

    assert.match(history, /Projects\/Example\.md/);
    assert.equal(artifact.path, "System/Exports/ShapeRepairRuns/shape-repair-2026-07-13_12-00-00.md");
    assert.match(artifact.content, /# Shape Repair Run/);
    assert.match(artifact.content, /Insert missing heading: '## Details'/);
  });
});

describe("shape repair and a list-valued type field", () => {
  const settings = { ...DEFAULT_SETTINGS, shapeTypeTargetField: "type" };
  const templates = [{ shape: "Task", content: "# Steps\n" }];
  const docFor = (type: unknown): ForgeDocument => ({
    ...baseDocument,
    path: "Notes/Thing.md",
    basename: "Thing",
    content: "---\ntype: x\n---\n\nbody\n",
    frontmatter: { type },
    hasFrontmatter: true,
  });
  const plan = (type: unknown) =>
    planShapeRepairForDocuments({ settings, templates, documents: [docFor(type)], dryRun: true });

  it("repairs a single-entry list, which it used to refuse outright", () => {
    // Lint reports these notes; repair must not silently decline to fix them.
    const r = plan(["Task"]);
    assert.equal(r.run.skipped, 0);
    assert.equal(r.run.repaired, 1);
    assert.deepEqual(r.run.files[0].operations, ["Insert missing heading: '# Steps'"]);
  });

  it("declines a multi-shape note with an accurate reason", () => {
    // Repair WRITES, and merging two templates has no defined heading order — so it
    // says so, rather than reporting the misleading "No type target field".
    const r = plan(["Task", "Note"]);
    assert.equal(r.run.skipped, 1);
    assert.equal(r.run.repaired, 0);
    assert.match(JSON.stringify(r.run), /repair handles one/);
  });

  it("still declines a non-string type field", () => {
    const r = plan(2026);
    assert.equal(r.run.skipped, 1);
    assert.match(JSON.stringify(r.run), /No type target field/);
  });
});
