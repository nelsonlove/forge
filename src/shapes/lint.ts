import type { ForgeSettings } from "../config/settings.js";
import { buildShapeLintExemptList, isExempt, localTimestamp, normalisePath } from "../vault/paths.js";
import type { ForgeDocument, ForgeRange, LintResult, LintRunEnvelope, LintSeverity } from "../linting/model.js";
import { scanHeadings, scanHeadingsInContent } from "./headings.js";
import {
  hasHeadingPlaceholder,
  headingTextMatches,
  shapeNameFromPath,
  templateFileToShapeName,
} from "./identity.js";

export { templateFileToShapeName } from "./identity.js";

export interface ParsedHeading {
  level: number;
  text: string;
  lineIndex: number;
}

export interface TemplateNode {
  text: string;
  level: number;
  children: TemplateNode[];
}

export interface ForgeShapeTemplate {
  shape: string;
  path?: string;
  content?: string;
  headings?: ParsedHeading[];
}

export interface RunShapeLintForDocumentsInput {
  documents: ForgeDocument[];
  templates: ForgeShapeTemplate[];
  settings: ForgeSettings;
  exemptPaths?: string[];
  schemaVersion?: string;
  vaultPath?: string;
  timestamp?: string;
}

export interface ShapeLintRunResult {
  envelope: LintRunEnvelope;
  scannedFiles?: string[];
  results: LintResult[];
  errors: LintResult[];
  warnings: LintResult[];
  infos: LintResult[];
}

export function runShapeLintForDocuments(input: RunShapeLintForDocumentsInput): ShapeLintRunResult {
  const { documents, settings } = input;
  const exemptPaths = buildShapeLintExemptList(settings, input.exemptPaths ?? []);
  const candidateDocuments = uniqueMarkdownDocuments(documents).filter(
    (document) => !isExempt(document.path, exemptPaths)
  );
  const headingCache = buildShapeHeadingCacheFromTemplates(input.templates);
  const results: LintResult[] = [];

  if (settings.shapeLintEnabled && headingCache.size > 0) {
    for (const document of candidateDocuments) {
      results.push(...lintShapeHeadingsForDocument(document, settings, headingCache));
    }
  }

  return {
    envelope: {
      vault_path: input.vaultPath ?? "",
      timestamp: input.timestamp ?? localTimestamp(),
      schema_version: input.schemaVersion ?? "",
      notes_scanned: candidateDocuments.length,
    },
    scannedFiles: candidateDocuments.map((document) => document.path),
    results,
    errors: results.filter((result) => result.severity === "error"),
    warnings: results.filter((result) => result.severity === "warning"),
    infos: results.filter((result) => result.severity === "info"),
  };
}

export function buildShapeHeadingCacheFromTemplates(
  templates: ForgeShapeTemplate[]
): Map<string, ParsedHeading[]> {
  const cache = new Map<string, ParsedHeading[]>();

  for (const template of templates) {
    const shape = template.shape.trim().toLowerCase();
    if (!shape) continue;

    const headings = template.headings ?? extractHeadings(template.content ?? "");
    if (headings.length === 0) continue;

    cache.set(shape, headings);
  }

  return cache;
}

export function collectShapeTemplatesFromDocuments(
  documents: ForgeDocument[],
  templatesFolder: string,
  shapeTypeTargetField = "type"
): ForgeShapeTemplate[] {
  const normalizedFolder = normalisePath(templatesFolder).replace(/\/+$/, "");
  if (!normalizedFolder) return [];

  const folderPrefix = `${normalizedFolder}/`;
  const lowerFolderPrefix = folderPrefix.toLowerCase();

  return documents
    .filter((document) => {
      const path = normalisePath(document.path);
      return document.extension.toLowerCase() === "md" &&
        path.toLowerCase().startsWith(lowerFolderPrefix) &&
        document.basename.toLowerCase().startsWith("template, ");
    })
    .map((document) => {
      const configuredShape = document.frontmatter[shapeTypeTargetField];
      return {
        shape: typeof configuredShape === "string" && configuredShape.trim()
          ? configuredShape.trim()
          : templateFileToShapeName(document.basename),
        path: document.path,
        content: document.content,
      };
    });
}

export function collectShapeNamesFromDocuments(
  documents: ForgeDocument[],
  shapesFolder: string,
  includeSubfolders = true
): string[] {
  const normalizedFolder = normalisePath(shapesFolder).replace(/\/+$/, "");
  if (!normalizedFolder) return [];

  const folderPrefix = `${normalizedFolder}/`;
  const lowerFolderPrefix = folderPrefix.toLowerCase();
  const seen = new Set<string>();
  const shapes: string[] = [];

  for (const document of documents) {
    const path = normalisePath(document.path);
    if (
      document.extension.toLowerCase() !== "md" ||
      !path.toLowerCase().startsWith(lowerFolderPrefix)
    ) continue;

    const shape = shapeNameFromPath(path, normalizedFolder);
    if (!shape || (!includeSubfolders && shape.includes("/"))) continue;
    const key = shape.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    shapes.push(shape);
  }

  return shapes;
}

/**
 * The shape names a note claims, from the configured type field.
 *
 * The field is normally one string, but it may legitimately hold a list: a note can be
 * of more than one kind, and metadata plugins write the key that way. Forge's own enum
 * check already accepts both shapes, so reading only strings here made the two halves
 * of the same plugin disagree about what the field means — and a list-valued note was
 * skipped in silence, which reads exactly like a note that passed.
 *
 * Non-string entries are dropped rather than coerced: `String(value)` on a nested map
 * yields "[object Object]", which would then miss every shape and look like clean data.
 */
export function shapeNamesFromField(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [value];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    // The heading cache is keyed lower-case, so `Task` and `task` are one shape. Without
    // this, a list repeating an entry lints it twice and reports byte-identical findings.
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(trimmed);
  }
  return names;
}

export function lintShapeHeadingsForDocument(
  document: ForgeDocument,
  settings: ForgeSettings,
  headingCache: Map<string, ParsedHeading[]>
): LintResult[] {
  const results: LintResult[] = [];
  const strict = settings.lintStrictMode;
  const flagExtraHeadings = settings.shapeLintStrictMode;
  const allowEmptySections = settings.shapeLintAllowEmptySections;

  if (!document.hasFrontmatter) return results;

  const shapeNames = shapeNamesFromField(document.frontmatter[settings.shapeTypeTargetField]);
  if (shapeNames.length === 0) return results;

  if (settings.shapeLintScope === "folder") {
    const folders = settings.shapeLintFolders ?? [];
    if (folders.length > 0) {
      const prefixes = folders.map((folder) => folder.toLowerCase().replace(/\/?$/, "/"));
      if (!prefixes.some((prefix) => document.path.toLowerCase().startsWith(prefix))) return results;
    }
  }

  const lines = document.content.split("\n");
  const { bodyLines, bodyStartLineIndex } = splitFrontmatter(lines);
  const documentRange = rangeForLine(lines, 0);

  // Built once, not per shape. Each lintLevel call creates its own local consumed-set
  // and never mutates a DocSection, so sharing the tree across shapes is safe — the
  // per-shape isolation comes from that local set, not from rebuilding the tree.
  const { roots: docRoots } = buildDocSectionTree(bodyLines, bodyStartLineIndex);

  // Union of what every claimed shape matched, so extras can be judged once. Judging
  // them per shape would call each shape's headings extra from the others' point of
  // view, and report a fully conformant note as entirely wrong.
  const consumedAll = new Set<DocSection>();
  const linted: string[] = [];

  for (const typeValue of shapeNames) {
    const templateHeadings = headingCache.get(typeValue.toLowerCase());
    if (!templateHeadings || templateHeadings.length === 0) continue;
    linted.push(typeValue);

    lintLevel(
      buildTemplateTree(templateHeadings),
      docRoots,
      document.path,
      typeValue,
      strict,
      flagExtraHeadings,
      allowEmptySections,
      results,
      null,
      documentRange,
      consumedAll
    );
  }

  if (flagExtraHeadings && linted.length > 0) {
    // Keep the single-shape wording byte-identical to what it has always been.
    const shapeLabel = linted.length === 1
      ? `shape '${linted[0]}' template`
      : `the templates of shapes ${linted.map((n) => `'${n}'`).join(", ")}`;
    reportExtras(docRoots, consumedAll, document.path, shapeLabel, strict, results, null);
  }

  return results;
}

export function buildTemplateTree(headings: ParsedHeading[]): TemplateNode[] {
  const roots: TemplateNode[] = [];
  const stack: TemplateNode[] = [];

  for (const heading of headings) {
    const node: TemplateNode = { text: heading.text, level: heading.level, children: [] };

    while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }

    stack.push(node);
  }

  return roots;
}

export function flattenTemplateTree(nodes: TemplateNode[]): TemplateNode[] {
  const result: TemplateNode[] = [];
  const visit = (node: TemplateNode) => {
    result.push(node);
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return result;
}

export function extractHeadings(content: string): ParsedHeading[] {
  return scanHeadingsInContent(content);
}

interface DocSection {
  headingText: string;
  headingLevel: number;
  range: ForgeRange;
  contentLines: string[];
  children: DocSection[];
}

function lintLevel(
  templateNodes: TemplateNode[],
  docSections: DocSection[],
  filePath: string,
  typeValue: string,
  strict: boolean,
  flagExtraHeadings: boolean,
  allowEmptySections: boolean,
  results: LintResult[],
  parentText: string | null,
  fallbackRange: ForgeRange,
  /**
   * Sections this pass matched, accumulated across every shape a note claims.
   *
   * Extras cannot be judged one shape at a time: a heading required by shape B is
   * unmatched from shape A's point of view, so a note that satisfies BOTH would be told
   * every heading is extra. The caller collects consumption here and runs one extras
   * pass over what no shape claimed.
   */
  consumedOut: Set<DocSection>
): void {
  const consumed = new Set<DocSection>();
  const matchedSections = new Map<TemplateNode, DocSection>();

  for (const templateNode of templateNodes) {
    const match = docSections.find(
      (section) =>
        !consumed.has(section) &&
        headingTextMatches(templateNode.text, section.headingText) &&
        section.headingLevel === templateNode.level &&
        !isReservedForFixedSibling(templateNode, templateNodes, section)
    );

    if (!match) {
      const prefix = "#".repeat(templateNode.level);
      const ctx = parentText ? ` under '${parentText}'` : "";
      results.push(newResult(
        filePath,
        strict ? "error" : "warning",
        "shape_heading_missing",
        `Missing heading: '${prefix} ${templateNode.text}'${ctx} (required by shape '${typeValue}')`,
        fallbackRange
      ));
    } else {
      consumed.add(match);
      consumedOut.add(match);
      matchedSections.set(templateNode, match);

      if (!allowEmptySections && !sectionHasMeaningfulContent(match)) {
        results.push(newResult(
          filePath,
          strict ? "warning" : "info",
          "shape_section_empty",
          `Section '${match.headingText}' is empty (required by shape '${typeValue}')`,
          match.range
        ));
      }

      lintLevel(
        templateNode.children,
        match.children,
        filePath,
        typeValue,
        strict,
        flagExtraHeadings,
        allowEmptySections,
        results,
        templateNode.text,
        match.range,
        consumedOut
      );
    }
  }

  const docOrder = docSections
    .filter((section) => consumed.has(section))
    .map((section) => [...matchedSections.entries()]
      .find(([, matchedSection]) => matchedSection === section)?.[0].text.toLowerCase() ?? "");

  const expectedOrder = templateNodes
    .map((templateNode) => templateNode.text.toLowerCase())
    .filter((text) => docOrder.includes(text));

  if (!arraysEqualOrder(docOrder, expectedOrder) && expectedOrder.length > 1) {
    const ctx = parentText ? ` within '${parentText}'` : "";
    const orderRange = docSections.find((section) => consumed.has(section))?.range ?? fallbackRange;
    results.push(newResult(
      filePath,
      strict ? "error" : "warning",
      "shape_heading_order",
      `Headings out of order${ctx} for shape '${typeValue}'. ` +
      `Expected: ${expectedOrder.map((text) => `'${text}'`).join(" → ")}`,
      orderRange
    ));
  }

}

function isReservedForFixedSibling(
  templateNode: TemplateNode,
  siblings: TemplateNode[],
  section: DocSection
): boolean {
  if (!hasHeadingPlaceholder(templateNode.text)) return false;

  return siblings.some((sibling) =>
    sibling !== templateNode &&
    !hasHeadingPlaceholder(sibling.text) &&
    sibling.level === section.headingLevel &&
    headingTextMatches(sibling.text, section.headingText)
  );
}

function buildDocSectionTree(bodyLines: string[], bodyStartLineIndex: number): { roots: DocSection[] } {
  const headings = extractHeadingsFromLines(bodyLines);
  const flatSections: DocSection[] = [];

  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index];
    const nextHeading = headings[index + 1];
    const contentEnd = nextHeading ? nextHeading.lineIndex : bodyLines.length;
    const contentLines = bodyLines.slice(heading.lineIndex + 1, contentEnd);

    flatSections.push({
      headingText: heading.text,
      headingLevel: heading.level,
      range: rangeForLine(bodyLines, heading.lineIndex, bodyStartLineIndex),
      contentLines,
      children: [],
    });
  }

  const roots: DocSection[] = [];
  const stack: DocSection[] = [];

  for (const section of flatSections) {
    while (stack.length > 0 && stack[stack.length - 1].headingLevel >= section.headingLevel) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(section);
    } else {
      stack[stack.length - 1].children.push(section);
    }
    stack.push(section);
  }

  return { roots };
}

function extractHeadingsFromLines(lines: string[]): ParsedHeading[] {
  return scanHeadings(lines);
}

function splitFrontmatter(lines: string[]): {
  frontmatterLines: string[];
  bodyLines: string[];
  bodyStartLineIndex: number;
} {
  if (lines[0]?.trim() !== "---") return { frontmatterLines: [], bodyLines: lines, bodyStartLineIndex: 0 };
  let closingIndex = -1;
  for (let index = 1; index < lines.length; index++) {
    if (lines[index].trim() === "---") {
      closingIndex = index;
      break;
    }
  }
  if (closingIndex === -1) return { frontmatterLines: [], bodyLines: lines, bodyStartLineIndex: 0 };
  return {
    frontmatterLines: lines.slice(0, closingIndex + 1),
    bodyLines: lines.slice(closingIndex + 1),
    bodyStartLineIndex: closingIndex + 1,
  };
}

function rangeForLine(lines: string[], lineIndex: number, lineOffset = 0): ForgeRange {
  const boundedLine = Math.max(0, Math.min(lineIndex, Math.max(0, lines.length - 1)));
  const absoluteLine = lineOffset + boundedLine;
  return {
    start: { line: absoluteLine, character: 0 },
    end: { line: absoluteLine, character: Math.max(1, lines[boundedLine]?.length ?? 1) },
  };
}

function sectionHasMeaningfulContent(section: DocSection): boolean {
  if (section.contentLines.join("\n").trim().length > 0) return true;
  return section.children.some(sectionHasMeaningfulContent);
}

function uniqueMarkdownDocuments(documents: ForgeDocument[]): ForgeDocument[] {
  const seen = new Set<string>();
  const unique: ForgeDocument[] = [];

  for (const document of documents) {
    if (document.extension.toLowerCase() !== "md" || seen.has(document.path)) continue;
    seen.add(document.path);
    unique.push(document);
  }

  return unique;
}

function arraysEqualOrder(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function newResult(
  file: string,
  severity: LintSeverity,
  rule: string,
  message: string,
  range?: ForgeRange
): LintResult {
  return range
    ? { file, severity, rule, message, range }
    : { file, severity, rule, message };
}

/**
 * Headings no claimed shape accounts for.
 *
 * Run once, after every shape has been matched, over the union of what they consumed.
 * A section a shape matched is not extra; its children are still checked, because a
 * matched parent can hold unexpected subsections. An unmatched section is extra, and
 * everything beneath it is extra too.
 */
function reportExtras(
  docSections: DocSection[],
  consumedAll: Set<DocSection>,
  filePath: string,
  shapeLabel: string,
  strict: boolean,
  results: LintResult[],
  parentText: string | null
): void {
  for (const section of docSections) {
    if (consumedAll.has(section)) {
      reportExtras(section.children, consumedAll, filePath, shapeLabel, strict, results, section.headingText);
      continue;
    }
    const severity: LintSeverity = section.headingLevel === 1
      ? strict ? "error" : "warning"
      : strict ? "warning" : "info";
    const ctx = parentText ? ` under '${parentText}'` : "";
    results.push(newResult(
      filePath,
      severity,
      "shape_heading_extra",
      `Extra heading: '${section.headingText}'${ctx} (not in ${shapeLabel})`,
      section.range
    ));
    // Everything under an unaccounted heading is unaccounted too.
    reportExtras(section.children, new Set(), filePath, shapeLabel, strict, results, section.headingText);
  }
}
