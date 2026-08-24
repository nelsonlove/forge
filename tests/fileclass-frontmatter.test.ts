import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fieldRulesFromSchemaFields,
  lintFileclassFrontmatter,
  type FileclassClassRules,
} from "../src/fileclass/frontmatter.js";
import { createForgeSettings } from "../src/config/settings.js";
import { runLintForDocuments, type ForgeDocument } from "../src/linting/model.js";
import type { VaultSchema } from "../src/schemas/schema.js";

describe("fieldRulesFromSchemaFields", () => {
  it("reads the required flag in both spellings and only from object options", () => {
    const rules = fieldRulesFromSchemaFields([
      { name: "uid", id: "a", type: "Input", options: { required: true }, path: "" },
      { name: "name", id: "b", type: "Input", options: { required: "true" }, path: "" },
      { name: "note", id: "c", type: "Input", options: {}, path: "" },
      { name: "tags", id: "d", type: "Multi", options: ["x"], path: "" },
    ]);

    assert.deepEqual(
      rules.filter((rule) => rule.required).map((rule) => rule.name),
      ["uid", "name"]
    );
  });

  it("skips nested fields and entries without a usable name", () => {
    const rules = fieldRulesFromSchemaFields([
      { name: "child", id: "a", type: "Input", options: { required: true }, path: "parent1" },
      { name: "", id: "b", type: "Input", options: { required: true }, path: "" },
      { name: "ok", id: "c", type: "Input", options: { required: true }, path: "" },
      null,
      "not an object",
    ]);

    assert.deepEqual(rules.map((rule) => rule.name), ["ok"]);
  });

  it("collects allowed values from a structured valuesList", () => {
    const rules = fieldRulesFromSchemaFields([
      {
        name: "status",
        id: "a",
        type: "Select",
        options: { sourceType: "ValuesList", valuesList: { "1": "open", "2": "done" } },
        path: "",
      },
    ]);

    assert.deepEqual(rules[0]?.allowedValues, ["open", "done"]);
  });

  it("collects allowed values from a bare array and a legacy numeric-key map", () => {
    const rules = fieldRulesFromSchemaFields([
      { name: "mood", id: "a", type: "Cycle", options: ["🟢", "🟡"], path: "" },
      { name: "size", id: "b", type: "Select", options: { "1": "S", "2": "M" }, path: "" },
    ]);

    assert.deepEqual(rules.find((rule) => rule.name === "mood")?.allowedValues, ["🟢", "🟡"]);
    assert.deepEqual(rules.find((rule) => rule.name === "size")?.allowedValues, ["S", "M"]);
  });

  it("does not read non-numeric option keys as legacy values", () => {
    // `options: { required: true }` on a Select is a constraint, not a vocabulary.
    const rules = fieldRulesFromSchemaFields([
      { name: "status", id: "a", type: "Select", options: { required: true }, path: "" },
    ]);

    assert.equal(rules[0]?.required, true);
    assert.equal(rules[0]?.allowedValues, undefined);
  });

  it("skips vocabularies sourced from notes or bases, empty lists, and non-list types", () => {
    const rules = fieldRulesFromSchemaFields([
      {
        name: "topic",
        id: "a",
        type: "Select",
        options: { sourceType: "ValuesListNotePath", valuesListNotePath: "Topics.md", required: true },
        path: "",
      },
      { name: "empty", id: "b", type: "Select", options: { sourceType: "ValuesList", valuesList: {} }, path: "" },
      { name: "free", id: "c", type: "Input", options: { "1": "looks like a value" }, path: "" },
    ]);

    assert.deepEqual(rules.map((rule) => rule.name), ["topic"]);
    assert.equal(rules[0]?.allowedValues, undefined);
    assert.equal(rules[0]?.required, true);
  });

  it("drops rules that check nothing", () => {
    const rules = fieldRulesFromSchemaFields([
      { name: "note", id: "a", type: "Input", options: {}, path: "" },
    ]);

    assert.deepEqual(rules, []);
  });
});

describe("lintFileclassFrontmatter", () => {
  const taskRules: FileclassClassRules = {
    className: "Task",
    fields: [
      { name: "status", required: true, allowedValues: ["open", "done"] },
      { name: "priority", required: false, allowedValues: ["low", "high"] },
    ],
  };

  it("flags a missing and an empty required field", () => {
    for (const frontmatter of [{}, { status: "" }, { status: [] }, { status: null }]) {
      const findings = lintFileclassFrontmatter(frontmatter as Record<string, unknown>, [taskRules]);
      assert.equal(findings.length, 1);
      assert.equal(findings[0]?.rule, "fileclass_required");
      assert.equal(findings[0]?.field, "status");
      assert.match(findings[0]?.message ?? "", /Task/);
    }
  });

  it("accepts a present required field with an allowed value", () => {
    assert.deepEqual(lintFileclassFrontmatter({ status: "open" }, [taskRules]), []);
  });

  it("flags a scalar value outside the vocabulary", () => {
    const findings = lintFileclassFrontmatter({ status: "openish" }, [taskRules]);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.rule, "fileclass_enum");
    assert.match(findings[0]?.message ?? "", /'openish'/);
    assert.match(findings[0]?.message ?? "", /open, done/);
  });

  it("flags only the bad items of a list value, in one finding", () => {
    const findings = lintFileclassFrontmatter(
      { status: "open", priority: ["low", "urgent", "wat"] },
      [taskRules]
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.rule, "fileclass_enum");
    assert.equal(findings[0]?.field, "priority");
    assert.match(findings[0]?.message ?? "", /'urgent', 'wat'/);
  });

  it("does not enum-check an absent optional field or non-scalar items", () => {
    assert.deepEqual(lintFileclassFrontmatter({ status: "open", priority: [{ nested: true }] }, [taskRules]), []);
  });

  it("emits one finding per field when several classes agree", () => {
    const other: FileclassClassRules = {
      className: "Global",
      fields: [{ name: "status", required: true }],
    };
    const findings = lintFileclassFrontmatter({}, [taskRules, other]);
    assert.equal(findings.length, 1);
    assert.match(findings[0]?.message ?? "", /Task/);
  });
});

describe("runLintForDocuments with fileclass rules", () => {
  const schema: VaultSchema = {
    version: "1.0",
    frontmatter: { required: [], optional: [] },
    inline: { allowed: [] },
    ontology: { relationships: {} },
    tag_rules: {
      require_namespace: false,
      unknown_tags: "off",
      severity: "warning",
      allowed_namespaces: [],
      forbidden_namespaces: [],
    },
    exempt_paths: ["ZArchive"],
  };

  const document = (path: string, frontmatter: Record<string, unknown>): ForgeDocument => ({
    path,
    basename: path.split("/").pop() ?? path,
    extension: "md",
    content: `---\nplaceholder: 1\n---\n`,
    frontmatter,
    hasFrontmatter: true,
  });

  const rules = {
    "Notes/A.md": [{
      className: "Task",
      fields: [{ name: "status", required: true, allowedValues: ["open", "done"] }],
    }],
    "ZArchive/B.md": [{
      className: "Task",
      fields: [{ name: "status", required: true }],
    }],
  };

  it("emits fileclass findings inside the normal run and honours exemptions", () => {
    const result = runLintForDocuments({
      documents: [
        document("Notes/A.md", { status: "nope" }),
        document("ZArchive/B.md", {}),
      ],
      schema,
      settings: createForgeSettings({ lintExcludeInboxFolder: false }),
      validShapes: [],
      fileclassRules: rules,
    });

    assert.deepEqual(
      result.results.map((finding) => [finding.file, finding.rule]),
      [["Notes/A.md", "fileclass_enum"]]
    );
    assert.equal(result.errors.length, 1);
  });

  it("is inert when no rules are passed", () => {
    const result = runLintForDocuments({
      documents: [document("Notes/A.md", {})],
      schema,
      settings: createForgeSettings({ lintExcludeInboxFolder: false }),
      validShapes: [],
    });

    assert.deepEqual(result.results, []);
  });
});
