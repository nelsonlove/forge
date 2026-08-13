import type {
  DashboardIssue,
  LintScanResult,
  ShapeLintResult,
} from "../dashboard/types.js";
import { normalisePath } from "../vault/paths.js";

export type ForgeHealthStatus = "errors" | "warnings" | "needs_review" | "clean" | "not_scanned";
export type ForgeHealthMinimumSeverity = "all" | "needs_review" | "warning" | "error";

export interface ForgeHealthIndexEntry {
  file_path: string;
  overall_status: ForgeHealthStatus;
  lint_error_count: number;
  lint_warning_count: number;
  shape_issue_count: number;
  review_reason: string;
  last_scan_time: string | null;
}

export interface ForgeHealthBaseEntry {
  path: string;
  name?: string;
}

export interface ForgeHealthRow extends ForgeHealthIndexEntry {
  file_name: string;
}

export interface ForgeHealthRowOptions {
  minimumSeverity?: ForgeHealthMinimumSeverity;
  includeCleanNotes?: boolean;
  includeNotScannedNotes?: boolean;
}

export interface ForgeHealthGroup {
  status: ForgeHealthStatus;
  rows: ForgeHealthRow[];
}

interface MutableHealthEntry extends ForgeHealthIndexEntry {
  reviewReasons: string[];
  hasNonCriticalIssue: boolean;
  hasCriticalShapeIssue: boolean;
}

export const FORGE_HEALTH_STATUS_ORDER: readonly ForgeHealthStatus[] = [
  "errors",
  "warnings",
  "needs_review",
  "clean",
  "not_scanned",
];

export function buildForgeHealthIndex(input: {
  lint?: LintScanResult | null;
  shapeLint?: ShapeLintResult | null;
}): Map<string, ForgeHealthIndexEntry> {
  const mutable = new Map<string, MutableHealthEntry>();

  addScannedPaths(mutable, input.lint?.scanned_file_paths ?? [], input.lint?.generated_at ?? null);
  addScannedPaths(mutable, input.shapeLint?.scanned_file_paths ?? [], input.shapeLint?.generated_at ?? null);
  addIssues(mutable, input.lint?.issues ?? [], input.lint?.generated_at ?? null, "lint");
  addReviews(mutable, input.lint?.review_items ?? [], input.lint?.generated_at ?? null);
  addIssues(mutable, input.shapeLint?.issues ?? [], input.shapeLint?.generated_at ?? null, "shape");

  return new Map([...mutable.entries()].map(([path, entry]) => {
    const review_reason = formatReviewReasons(entry.reviewReasons);
    const overall_status = entry.lint_error_count > 0 || entry.hasCriticalShapeIssue
      ? "errors"
      : entry.lint_warning_count > 0 || entry.shape_issue_count > 0 || entry.hasNonCriticalIssue
        ? "warnings"
        : review_reason
          ? "needs_review"
          : "clean";

    return [path, {
      file_path: entry.file_path,
      overall_status,
      lint_error_count: entry.lint_error_count,
      lint_warning_count: entry.lint_warning_count,
      shape_issue_count: entry.shape_issue_count,
      review_reason,
      last_scan_time: entry.last_scan_time,
    }];
  }));
}

export function buildForgeHealthRows(
  baseEntries: readonly ForgeHealthBaseEntry[],
  index: ReadonlyMap<string, ForgeHealthIndexEntry>,
  options: ForgeHealthRowOptions = {}
): ForgeHealthRow[] {
  const minimumSeverity = options.minimumSeverity ?? "all";
  const includeCleanNotes = options.includeCleanNotes ?? false;
  const includeNotScannedNotes = options.includeNotScannedNotes ?? true;

  return baseEntries
    .map((entry): ForgeHealthRow => {
      const path = normalisePath(entry.path);
      const health = index.get(path) ?? notScannedEntry(path);
      return {
        ...health,
        file_name: entry.name?.trim() || basename(path),
      };
    })
    .filter((row) => shouldIncludeRow(row, {
      minimumSeverity,
      includeCleanNotes,
      includeNotScannedNotes,
    }));
}

export function groupForgeHealthRows(rows: readonly ForgeHealthRow[]): ForgeHealthGroup[] {
  const groups = new Map<ForgeHealthStatus, ForgeHealthRow[]>();
  for (const row of rows) {
    const group = groups.get(row.overall_status) ?? [];
    group.push(row);
    groups.set(row.overall_status, group);
  }

  return FORGE_HEALTH_STATUS_ORDER
    .map((status) => ({ status, rows: groups.get(status) ?? [] }))
    .filter((group) => group.rows.length > 0);
}

export function forgeHealthStatusLabel(status: ForgeHealthStatus): string {
  switch (status) {
    case "errors": return "Errors";
    case "warnings": return "Warnings";
    case "needs_review": return "Needs review";
    case "clean": return "Clean";
    case "not_scanned": return "Not scanned";
  }
}

function addScannedPaths(
  index: Map<string, MutableHealthEntry>,
  paths: readonly string[],
  generatedAt: string | null
): void {
  for (const rawPath of paths) {
    const path = normalisePath(rawPath);
    if (!path) continue;
    const entry = getOrCreate(index, path);
    entry.last_scan_time = newestTimestamp(entry.last_scan_time, generatedAt);
  }
}

function addIssues(
  index: Map<string, MutableHealthEntry>,
  issues: readonly DashboardIssue[],
  generatedAt: string | null,
  source: "lint" | "shape"
): void {
  for (const issue of issues) {
    const path = normalisePath(issue.file_path);
    if (!path) continue;
    const entry = getOrCreate(index, path);
    entry.last_scan_time = newestTimestamp(entry.last_scan_time, generatedAt);
    if (source === "shape") {
      entry.shape_issue_count += 1;
      if (issue.severity === "critical") entry.hasCriticalShapeIssue = true;
      else entry.hasNonCriticalIssue = true;
    } else if (issue.severity === "critical") {
      entry.lint_error_count += 1;
    } else if (issue.severity === "warning") {
      entry.lint_warning_count += 1;
      entry.hasNonCriticalIssue = true;
    } else {
      entry.hasNonCriticalIssue = true;
    }
  }
}

function addReviews(
  index: Map<string, MutableHealthEntry>,
  reviews: readonly DashboardIssue[],
  generatedAt: string | null
): void {
  for (const review of reviews) {
    const path = normalisePath(review.file_path);
    if (!path) continue;
    const entry = getOrCreate(index, path);
    entry.reviewReasons.push(review.message);
    entry.last_scan_time = newestTimestamp(entry.last_scan_time, generatedAt);
  }
}

function getOrCreate(index: Map<string, MutableHealthEntry>, path: string): MutableHealthEntry {
  const existing = index.get(path);
  if (existing) return existing;
  const created: MutableHealthEntry = {
    file_path: path,
    overall_status: "clean",
    lint_error_count: 0,
    lint_warning_count: 0,
    shape_issue_count: 0,
    review_reason: "",
    last_scan_time: null,
    reviewReasons: [],
    hasNonCriticalIssue: false,
    hasCriticalShapeIssue: false,
  };
  index.set(path, created);
  return created;
}

function formatReviewReasons(reasons: readonly string[]): string {
  const unique = [...new Set(reasons.map((reason) => reason.trim()).filter(Boolean))];
  if (unique.length <= 1) return unique[0] ?? "";
  return `${unique[0]} (+${unique.length - 1} more)`;
}

function newestTimestamp(current: string | null, candidate: string | null): string | null {
  if (!candidate) return current;
  if (!current) return candidate;
  const currentTime = Date.parse(current);
  const candidateTime = Date.parse(candidate);
  if (!Number.isFinite(currentTime) || !Number.isFinite(candidateTime)) {
    return candidate > current ? candidate : current;
  }
  return candidateTime > currentTime ? candidate : current;
}

function shouldIncludeRow(
  row: ForgeHealthRow,
  options: Required<ForgeHealthRowOptions>
): boolean {
  if (row.overall_status === "clean") return options.includeCleanNotes;
  if (row.overall_status === "not_scanned") return options.includeNotScannedNotes;
  if (row.overall_status === "errors") return true;
  if (row.overall_status === "warnings") return options.minimumSeverity !== "error";
  return options.minimumSeverity === "all" || options.minimumSeverity === "needs_review";
}

function notScannedEntry(path: string): ForgeHealthIndexEntry {
  return {
    file_path: path,
    overall_status: "not_scanned",
    lint_error_count: 0,
    lint_warning_count: 0,
    shape_issue_count: 0,
    review_reason: "",
    last_scan_time: null,
  };
}

function basename(path: string): string {
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.md$/i, "");
}
