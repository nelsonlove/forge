import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fieldRulesFromSchemaFields,
  lintFileclassFrontmatter,
  type FileclassClassRules,
} from "../src/fileclass/frontmatter.js";
import { buildFileclassRuleMap } from "../src/fileclass/adapter.js";
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

describe("buildFileclassRuleMap", () => {
  type FakeApp = Parameters<typeof buildFileclassRuleMap>[0];
  type FakeFile = Parameters<typeof buildFileclassRuleMap>[1][number];

  const file = { path: "Notes/A.md" } as FakeFile;
  const fields = [{ name: "status", id: "a", type: "Select", options: { required: true }, path: "" }];

  const appWith = (plugin: Record<string, unknown>): FakeApp =>
    ({ plugins: { plugins: { fileclass: plugin } } } as unknown as FakeApp);

  it("builds a per-path map through the API, fetching each class once", async () => {
    let calls = 0;
    const app = appWith({
      index: { getFileClasses: () => ["Task", "Task"] },
      api: { getSchema: async () => { calls += 1; return { fields }; } },
    });

    const map = await buildFileclassRuleMap(app, [file]);
    assert.deepEqual(map["Notes/A.md"], [{ className: "Task", fields: [{ name: "status", required: true }] }]);
    assert.equal(calls, 1);
  });

  it("is inert without the API — an index alone is not availability", async () => {
    const app = appWith({ index: { getFileClasses: () => ["Task"] } });
    assert.deepEqual(await buildFileclassRuleMap(app, [file]), {});
  });

  it("lets an unreadable class contribute nothing instead of failing the run", async () => {
    const app = appWith({
      index: { getFileClasses: () => ["Broken", "Task"] },
      api: {
        getSchema: async (name: string) => {
          if (name === "Broken") throw new Error("boom");
          return { fields };
        },
      },
    });

    const map = await buildFileclassRuleMap(app, [file]);
    assert.deepEqual(map["Notes/A.md"]?.map((cls) => cls.className), ["Task"]);
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

describe("fileclass pattern rule", () => {
  const withPattern = (pattern: unknown, extra: Record<string, unknown> = {}) =>
    fieldRulesFromSchemaFields([
      { name: "period", type: "Input", path: "", options: { pattern, ...extra } },
    ]);
  const ISO = "^\\d{4}(-(0[1-9]|1[0-2])|-W(0[1-9]|[1-4]\\d|5[0-3])|-Q[1-4])?$";
  const rules = (pattern: string): FileclassClassRules[] =>
    [{ className: "Collection/Period", fields: [{ name: "period", required: false, pattern }] }];

  it("reads options.pattern into a rule", () => {
    assert.deepEqual(withPattern(ISO), [{ name: "period", required: false, pattern: ISO }]);
  });

  it("keeps a field that has ONLY a pattern — no required, no vocabulary", () => {
    // Without this the field would be dropped as "checks nothing".
    assert.equal(withPattern("^x$").length, 1);
  });

  it("drops an unparseable pattern rather than reporting every note", () => {
    // Skip-rather-than-guess: a broken declaration must not fail the whole class.
    assert.deepEqual(withPattern("^[unclosed"), []);
  });

  it("ignores a non-string or blank pattern, and a bare values-list options array", () => {
    assert.deepEqual(withPattern(42), []);
    assert.deepEqual(withPattern("   "), []);
    assert.deepEqual(fieldRulesFromSchemaFields([
      { name: "period", type: "Input", path: "", options: ["a", "b"] },
    ]), []);
  });

  it("carries a pattern alongside required and a vocabulary", () => {
    const r = fieldRulesFromSchemaFields([
      { name: "provider", type: "Select", path: "",
        options: { required: true, pattern: "^c", sourceType: "ValuesList", valuesList: { "1": "claude" } } },
    ]);
    assert.deepEqual(r, [{ name: "provider", required: true, allowedValues: ["claude"], pattern: "^c" }]);
  });

  it("passes a matching value and flags a mismatching one", () => {
    assert.deepEqual(lintFileclassFrontmatter({ period: "2026-07" }, rules(ISO)), []);
    const bad = lintFileclassFrontmatter({ period: "07-2026" }, rules(ISO));
    assert.equal(bad.length, 1);
    assert.equal(bad[0].rule, "fileclass_pattern");
    assert.match(bad[0].message, /07-2026/);
  });

  it("accepts every ISO grain the vault uses", () => {
    for (const v of ["2026", "2026-07", "2026-W26", "2026-Q3"]) {
      assert.deepEqual(lintFileclassFrontmatter({ period: v }, rules(ISO)), [], `expected ${v} to pass`);
    }
  });

  it("says nothing when the field is absent — that is what required is for", () => {
    assert.deepEqual(lintFileclassFrontmatter({}, rules(ISO)), []);
  });

  it("checks each entry of a list value", () => {
    const bad = lintFileclassFrontmatter({ period: ["2026", "nope"] }, rules(ISO));
    assert.equal(bad.length, 1);
    assert.match(bad[0].message, /'nope'/);
    assert.doesNotMatch(bad[0].message, /'2026'/);
  });

  it("coerces a number but ignores a non-scalar", () => {
    assert.deepEqual(lintFileclassFrontmatter({ period: 2026 }, rules(ISO)), []);
    assert.deepEqual(lintFileclassFrontmatter({ period: { a: 1 } }, rules(ISO)), []);
  });

  it("reports a field once even when several classes declare the same pattern", () => {
    const two = [...rules(ISO), ...rules(ISO)];
    assert.equal(lintFileclassFrontmatter({ period: "bad" }, two).length, 1);
  });
});
