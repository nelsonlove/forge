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
    for (const className of classNamesForFile(app, file)) {
      const rules = await rulesForClass(className);
      if (rules) classRules.push(rules);
    }
    if (classRules.length > 0) map[file.path] = classRules;
  }
  return map;
}

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
const YAML_FENCE = /```yaml frontmatter\r?\n[\s\S]*?```/g;
const COMMENTS = /%%[\s\S]*?%%/g;
const HEADING_LINE = /^#{1,6} /;

/** A class definition's body: everything that is neither schema, defaults nor comment. */
function classBody(raw: string): string {
  return raw.replace(FRONTMATTER, "").replace(YAML_FENCE, "").replace(COMMENTS, "").trim();
}

/**
 * The structure a class expects, composed down its inheritance chain.
 *
 * Parent first, child last, and a heading a child declares replaces the parent's — the
 * same rule the class file uses everywhere else, so what is checked here is what a new
 * note of that class would have been created with.
 */
export async function composedClassBody(app: App, className: string): Promise<string> {
  const index = getFileclassIndex(app);
  if (!index?.getFileClassFile) return "";

  // getAncestors returns nearest parent first; the chain is applied root-down.
  const ancestors = (index.getAncestors?.(className) ?? []).slice().reverse();
  const chain = [...ancestors, className];

  const bodies: string[] = [];
  for (const name of chain) {
    const file = index.getFileClassFile(name);
    if (!file) continue;
    try {
      const body = classBody(await app.vault.cachedRead(file));
      if (body) bodies.push(body);
    } catch {
      // A class whose file cannot be read contributes nothing rather than failing
      // the whole run — the remaining chain is still worth checking.
    }
  }

  const merged: string[] = [];
  const claimed = new Set<string>();
  // A note has one title, so a child that states its own H1 replaces the parent's
  // even when the wording differs — `# [{name}]({url})` overriding `# {title}` is an
  // override, not a second title. Deeper headings still match on their text.
  let titleClaimed = false;
  for (const body of bodies.slice().reverse()) {
    const lines = body.split(/\r?\n/);
    const own = new Set(lines.filter((line) => HEADING_LINE.test(line)).map((line) => line.trim()));
    const ownTitle = lines.some((line) => /^# /.test(line));
    const kept: string[] = [];
    let skipping = false;
    for (const line of lines) {
      if (HEADING_LINE.test(line)) {
        skipping = /^# /.test(line) ? titleClaimed : claimed.has(line.trim());
      }
      if (!skipping) kept.push(line);
    }
    for (const heading of own) claimed.add(heading);
    if (ownTitle) titleClaimed = true;
    const text = kept.join("\n").trim();
    if (text) merged.unshift(text);
  }

  return merged.join("\n\n");
}

/** Every class that declares structure, shaped like a shape template. */
export async function buildClassTemplates(
  app: App
): Promise<{ shape: string; path: string; content: string }[]> {
  const index = getFileclassIndex(app);
  if (!index?.fileClassNames) return [];

  const out: { shape: string; path: string; content: string }[] = [];
  for (const name of index.fileClassNames) {
    const content = await composedClassBody(app, name);
    if (!content || !HEADING_LINE.test(content) && !/\n#{1,6} /.test(content)) continue;
    out.push({
      shape: name.trim().toLowerCase(),
      path: index.getFileClassFile?.(name)?.path ?? name,
      content,
    });
  }
  return out;
}
