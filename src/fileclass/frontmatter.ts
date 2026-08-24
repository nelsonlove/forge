// src/fileclass/frontmatter.ts
// Fileclass as a live frontmatter source — the pure half.
//
// The Fileclass plugin already states, per class, which fields a note must carry
// and which values a Select/Cycle/Multi field may hold. Restating that in the
// schema note means keeping two copies in step, so with the frontmatter source
// enabled the lint run reads the classes instead: the Obsidian adapter resolves
// each note's classes and their field definitions, converts them to the plain
// rules below, and the lint engine checks them beside the contract rules.
//
// Deliberately narrow in this first cut:
//   - root-level fields only (`path: ""`) — nested Object fields are not checked
//   - vocabularies only from an inline values list — a vocabulary sourced from a
//     note or a Base is skipped rather than guessed, so it can never flag falsely
//   - severity is "error" for both rules, matching what `fileclass validate` emits

import { isFieldPresent } from "../vault/frontmatter.js";

/** One checkable fact about one field, as one class states it. */
export interface FileclassFieldRule {
  name: string;
  required: boolean;
  allowedValues?: string[];
}

/** Everything one class asserts about a note's frontmatter. */
export interface FileclassClassRules {
  className: string;
  fields: FileclassFieldRule[];
}

/** Per-document class rules, keyed by vault path. */
export type FileclassRulesByPath = Record<string, FileclassClassRules[]>;

export interface FileclassFinding {
  rule: "fileclass_required" | "fileclass_enum";
  severity: "error";
  field: string;
  message: string;
}

const LIST_TYPES = new Set(["Select", "Cycle", "Multi"]);

/**
 * Convert the raw field definitions of one class (the `fields` array of the
 * Fileclass API's `getSchema` result, inheritance already resolved) into rules.
 * Fields that check nothing — not required, no usable vocabulary — are dropped.
 */
export function fieldRulesFromSchemaFields(fields: unknown): FileclassFieldRule[] {
  if (!Array.isArray(fields)) return [];

  const rules: FileclassFieldRule[] = [];
  for (const entry of fields) {
    if (typeof entry !== "object" || entry === null) continue;
    const field = entry as Record<string, unknown>;

    const name = typeof field.name === "string" ? field.name.trim() : "";
    if (!name) continue;
    if (typeof field.path === "string" && field.path !== "") continue;

    const options = field.options;
    const required = isRequiredOption(options);
    const allowedValues =
      typeof field.type === "string" && LIST_TYPES.has(field.type)
        ? allowedValuesFromOptions(options)
        : undefined;

    if (!required && !allowedValues) continue;
    rules.push({ name, required, ...(allowedValues ? { allowedValues } : {}) });
  }
  return rules;
}

// Fileclass's own `isRequired`: `required` lives inside `options`, as true or "true",
// and a bare-array options value (an inline values list) cannot carry it.
function isRequiredOption(options: unknown): boolean {
  if (typeof options !== "object" || options === null || Array.isArray(options)) return false;
  const required = (options as Record<string, unknown>).required;
  return required === true || required === "true";
}

// Mirrors Fileclass's `listOptionsFromOptions`, minus the sources a linter cannot
// resolve from plain data: a note-path or Base source yields no vocabulary here.
// The legacy no-wrapper shape (the options object IS the values map) is narrowed
// to numeric keys, so constraint keys like `required` never read as values.
function allowedValuesFromOptions(options: unknown): string[] | undefined {
  if (Array.isArray(options)) {
    const values = options.map((value) => String(value).trim()).filter((value) => value.length > 0);
    return values.length > 0 ? values : undefined;
  }
  if (typeof options !== "object" || options === null) return undefined;
  const o = options as Record<string, unknown>;

  let list: Record<string, unknown>;
  if ("sourceType" in o || "valuesList" in o) {
    if (typeof o.sourceType === "string" && o.sourceType !== "ValuesList") return undefined;
    list = typeof o.valuesList === "object" && o.valuesList !== null
      ? (o.valuesList as Record<string, unknown>)
      : {};
  } else {
    list = {};
    for (const [key, value] of Object.entries(o)) {
      if (/^\d+$/.test(key)) list[key] = value;
    }
  }

  const values = Object.values(list).map((value) => String(value).trim()).filter((value) => value.length > 0);
  return values.length > 0 ? values : undefined;
}

/**
 * Check one note's frontmatter against every class it is bound to.
 * When several classes state the same rule for the same field, the first class
 * speaks for all of them — one finding per field per rule.
 */
export function lintFileclassFrontmatter(
  frontmatter: Record<string, unknown>,
  classRules: FileclassClassRules[]
): FileclassFinding[] {
  const findings: FileclassFinding[] = [];
  const seen = new Set<string>();

  for (const cls of classRules) {
    for (const field of cls.fields) {
      if (field.required && !isFieldPresent(frontmatter, field.name)) {
        pushOnce(findings, seen, {
          rule: "fileclass_required",
          severity: "error",
          field: field.name,
          message: `Missing required field '${field.name}' (fileclass '${cls.className}')`,
        });
      }

      if (!field.allowedValues || !isFieldPresent(frontmatter, field.name)) continue;
      const value = frontmatter[field.name];
      const items = Array.isArray(value) ? value : [value];
      const bad = items
        .filter((item): item is string | number | boolean =>
          typeof item === "string" || typeof item === "number" || typeof item === "boolean")
        .map((item) => String(item).trim())
        .filter((item) => item.length > 0 && !field.allowedValues!.includes(item));
      if (bad.length === 0) continue;

      pushOnce(findings, seen, {
        rule: "fileclass_enum",
        severity: "error",
        field: field.name,
        message: `Field '${field.name}' value${bad.length > 1 ? "s" : ""} ${bad.map((item) => `'${item}'`).join(", ")} `
          + `not allowed by fileclass '${cls.className}' (allowed: ${field.allowedValues.join(", ")})`,
      });
    }
  }

  return findings;
}

function pushOnce(findings: FileclassFinding[], seen: Set<string>, finding: FileclassFinding): void {
  const key = `${finding.rule}:${finding.field}`;
  if (seen.has(key)) return;
  seen.add(key);
  findings.push(finding);
}
