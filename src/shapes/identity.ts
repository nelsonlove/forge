import { normalisePath } from "../vault/paths.js";

const TEMPLATE_PREFIX = /^Template,\s*/i;
const NAMESPACE_ESCAPE = /%2f/i;
const HEADING_PLACEHOLDER_SOURCE = "\\{\\{[^{}\\r\\n]+\\}\\}";

export function shapeNameFromPath(filePath: string, shapesFolder: string): string | null {
  const folder = normalisePath(shapesFolder).replace(/\/+$/, "");
  const path = normalisePath(filePath);
  if (!folder || !path.toLowerCase().startsWith(`${folder.toLowerCase()}/`)) return null;

  const relativePath = path.slice(folder.length + 1);
  if (!relativePath.toLowerCase().endsWith(".md")) return null;

  const shapeName = relativePath.slice(0, -3).trim();
  return shapeName || null;
}

export function shapeNameToTemplateFileName(shapeName: string): string {
  const trimmed = shapeName.trim();
  const stem = trimmed.includes("/")
    ? encodeURIComponent(trimmed)
    : titleCaseShapeName(trimmed);
  return `Template, ${stem}.md`;
}

export function templateFileToShapeName(basename: string): string {
  const stem = basename.replace(TEMPLATE_PREFIX, "").trim();
  if (!NAMESPACE_ESCAPE.test(stem)) return stem.toLowerCase();

  try {
    return decodeURIComponent(stem).trim().toLowerCase();
  } catch {
    return stem.toLowerCase();
  }
}

export function headingTextMatches(templateText: string, candidateText: string): boolean {
  if (templateText.localeCompare(candidateText, undefined, { sensitivity: "accent" }) === 0) {
    return true;
  }

  const matches = [...templateText.matchAll(new RegExp(HEADING_PLACEHOLDER_SOURCE, "g"))];
  if (matches.length === 0) return false;

  let pattern = "^";
  let cursor = 0;
  for (const match of matches) {
    const index = match.index ?? cursor;
    pattern += escapeRegex(templateText.slice(cursor, index));
    pattern += ".+?";
    cursor = index + match[0].length;
  }
  pattern += `${escapeRegex(templateText.slice(cursor))}$`;

  return new RegExp(pattern, "i").test(candidateText);
}

export function hasHeadingPlaceholder(text: string): boolean {
  return new RegExp(HEADING_PLACEHOLDER_SOURCE).test(text);
}

function titleCaseShapeName(shapeName: string): string {
  return shapeName
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
