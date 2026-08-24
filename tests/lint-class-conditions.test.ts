import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SETTINGS } from "../src/config/settings.js";
import { runLintForDocuments, type ForgeDocument } from "../src/linting/model.js";
import type { VaultSchema } from "../src/schemas/schema.js";

function schemaWithClassConditions(): VaultSchema {
  return {
    version: "1.0.0",
    frontmatter: {
      required: [],
      optional: [
        {
          name: "status",
          type: "string",
          severity: "warning",
          lint_rules: [
            { rule: "required_when", field: "fileClass", equals: ["Task"] },
          ],
        },
        {
          name: "omnifocusUrl",
          type: "string",
          severity: "warning",
          lint_rules: [
            { rule: "forbidden_when", field: "fileClass", equals: ["Reference"] },
          ],
        },
      ],
    },
    inline: { allowed: [] },
    ontology: { relationships: {} },
    tag_rules: {
      require_namespace: false,
      unknown_tags: "off",
      severity: "warning",
      allowed_namespaces: [],
      forbidden_namespaces: [],
    },
    exempt_paths: [],
  };
}

function documentWithFrontmatter(path: string, frontmatter: Record<string, unknown>): ForgeDocument {
  return {
    path,
    basename: path.replace(/^.*\//, "").replace(/\.md$/, ""),
    extension: "md",
    content: "---\nplaceholder: true\n---\n",
    hasFrontmatter: true,
    frontmatter,
    stat: { mtime: 0 },
  };
}

function rulesFor(result: { results: { rule: string }[] }): string[] {
  return result.results.map((item) => item.rule);
}

describe("class-conditioned lint rules", () => {
  it("matches required_when against every entry of a multi-class fileClass list", () => {
    const result = runLintForDocuments({
      schema: schemaWithClassConditions(),
      settings: DEFAULT_SETTINGS,
      documents: [
        documentWithFrontmatter("Notes/Multi.md", { fileClass: ["Area", "Task"] }),
      ],
    });

    assert.deepEqual(rulesFor(result), ["required_when"]);
  });

  it("still matches required_when for a scalar fileClass value", () => {
    const result = runLintForDocuments({
      schema: schemaWithClassConditions(),
      settings: DEFAULT_SETTINGS,
      documents: [
        documentWithFrontmatter("Notes/Scalar.md", { fileClass: "Task" }),
      ],
    });

    assert.deepEqual(rulesFor(result), ["required_when"]);
  });

  it("does not fire required_when when the conditioned field is present", () => {
    const result = runLintForDocuments({
      schema: schemaWithClassConditions(),
      settings: DEFAULT_SETTINGS,
      documents: [
        documentWithFrontmatter("Notes/Satisfied.md", { fileClass: ["Task"], status: "open" }),
      ],
    });

    assert.deepEqual(rulesFor(result), []);
  });

  it("resolves classes from classesByPath when the note has no fileClass key", () => {
    const result = runLintForDocuments({
      schema: schemaWithClassConditions(),
      settings: DEFAULT_SETTINGS,
      documents: [
        documentWithFrontmatter("Notes/TagBound.md", { tags: ["note/task"] }),
      ],
      classesByPath: new Map([["Notes/TagBound.md", ["Task"]]]),
    });

    assert.deepEqual(rulesFor(result), ["required_when"]);
  });

  it("prefers resolved classes over the raw fileClass key, case-insensitively", () => {
    const result = runLintForDocuments({
      schema: schemaWithClassConditions(),
      settings: DEFAULT_SETTINGS,
      documents: [
        documentWithFrontmatter("Notes/Dead.md", { fileClass: "Task" }),
      ],
      classesByPath: new Map([["Notes/Dead.md", ["reference"]]]),
    });

    assert.deepEqual(rulesFor(result), []);
  });

  it("fires forbidden_when from resolved classes", () => {
    const result = runLintForDocuments({
      schema: schemaWithClassConditions(),
      settings: DEFAULT_SETTINGS,
      documents: [
        documentWithFrontmatter("Notes/Ref.md", { omnifocusUrl: "omnifocus://task/1" }),
      ],
      classesByPath: new Map([["Notes/Ref.md", ["Reference"]]]),
    });

    assert.deepEqual(rulesFor(result), ["forbidden_when"]);
  });

  it("leaves notes without classes or a fileClass key untouched", () => {
    const result = runLintForDocuments({
      schema: schemaWithClassConditions(),
      settings: DEFAULT_SETTINGS,
      documents: [
        documentWithFrontmatter("Notes/Plain.md", { title: "plain" }),
      ],
      classesByPath: new Map([["Notes/Plain.md", []]]),
    });

    assert.deepEqual(rulesFor(result), []);
  });
});
