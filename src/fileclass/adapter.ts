// src/fileclass/adapter.ts
// First-class support for the Fileclass plugin.
//
// Forge's own shape machinery asks a note for one string in one frontmatter field.
// Fileclass answers a richer question — a note may be bound to several classes, by a
// frontmatter field, a tag, a path, a bookmark group or a base view, and a class
// inherits from a parent. A vault that uses Fileclass therefore already states its
// structure, and restating it as shape notes means keeping two copies in step.
//
// This adapter reads the classes directly, so no shape notes and no generated
// templates are involved: a class definition's own body is the expected structure.

import type { App, TFile } from "obsidian";
import {
  fieldRulesFromSchemaFields,
  type FileclassClassRules,
  type FileclassRulesByPath,
} from "./frontmatter.js";

/** The slice of the Fileclass index this adapter needs. */
interface FileclassIndex {
  getFileClasses(file: TFile): string[];
  getAncestors?(className: string): string[];
  getFileClassFile?(className: string): TFile | null | undefined;
  fileClassNames?: string[];
}

/** The slice of the Fileclass public API this adapter needs (API 1.x). */
interface FileclassApi {
  getSchema(className: string): Promise<{ fields?: unknown } | null> | { fields?: unknown } | null;
}

interface FileclassPlugin {
  index?: FileclassIndex;
  api?: FileclassApi;
}

function getFileclassPlugin(app: App): FileclassPlugin | undefined {
  const plugins = (app as unknown as {
    plugins?: { plugins?: Record<string, FileclassPlugin | undefined> };
  }).plugins?.plugins;
  return plugins?.["fileclass"];
}

/** The Fileclass index, or null when the plugin is absent or not yet loaded. */
export function getFileclassIndex(app: App): FileclassIndex | null {
  const index = getFileclassPlugin(app)?.index;
  return typeof index?.getFileClasses === "function" ? index : null;
}

/** The Fileclass public API, or null when the plugin or its API is absent. */
export function getFileclassApi(app: App): FileclassApi | null {
  const api = getFileclassPlugin(app)?.api;
  return typeof api?.getSchema === "function" ? api : null;
}

export function isFileclassAvailable(app: App): boolean {
  return getFileclassIndex(app) !== null;
}

/**
 * Every class a note is bound to, lower-cased for matching.
 *
 * Binding route does not matter — this is whatever Fileclass itself resolved, so a
 * note bound only by a tag counts exactly as much as one naming its class outright.
 */
export function classesForFile(app: App, file: TFile): string[] {
  const index = getFileclassIndex(app);
  if (!index) return [];
  try {
    return index.getFileClasses(file)
      .filter((name): name is string => typeof name === "string" && name.length > 0)
      .map((name) => name.trim().toLowerCase());
  } catch {
    return [];
  }
}

/** A note's classes with their original casing, for API lookups. */
function classNamesForFile(app: App, file: TFile): string[] {
  const index = getFileclassIndex(app);
  if (!index) return [];
  try {
    return index.getFileClasses(file)
      .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
      .map((name) => name.trim());
  } catch {
    return [];
  }
}

/**
 * Frontmatter rules for every given file, resolved live from the Fileclass API.
 * Each class is fetched once per call; a class whose schema cannot be read
 * contributes nothing rather than failing the run. Files with no checkable
 * rules get no entry, so the lint core sees the smallest possible map.
 */
export async function buildFileclassRuleMap(app: App, files: TFile[]): Promise<FileclassRulesByPath> {
  const api = getFileclassApi(app);
  const map: FileclassRulesByPath = {};
  if (!api) return map;

  const byClass = new Map<string, FileclassClassRules | null>();
  const rulesForClass = async (className: string): Promise<FileclassClassRules | null> => {
    if (byClass.has(className)) return byClass.get(className) ?? null;
    let rules: FileclassClassRules | null = null;
    try {
      const schema = await Promise.resolve(api.getSchema(className));
      const fields = fieldRulesFromSchemaFields(schema?.fields);
      if (fields.length > 0) rules = { className, fields };
    } catch {
      rules = null;
    }
    byClass.set(className, rules);
    return rules;
  };

  for (const file of files) {
    const classRules: FileclassClassRules[] = [];
    // A note can reach the same class by several binding routes; it still gets
    // the class's rules once.
    for (const className of new Set(classNamesForFile(app, file))) {
      const rules = await rulesForClass(className);
      if (rules) classRules.push(rules);
    }
    if (classRules.length > 0) map[file.path] = classRules;
  }
  return map;
}
