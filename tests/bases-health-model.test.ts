import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildForgeHealthIndex,
  buildForgeHealthRows,
  groupForgeHealthRows,
} from "../src/bases/health-model.js";
import type {
  DashboardIssue,
  LintScanResult,
  ShapeLintResult,
} from "../src/dashboard/types.js";

const lintGeneratedAt = "2026-08-12T18:00:00.000Z";
const shapeGeneratedAt = "2026-08-12T19:00:00.000Z";

function issue(file_path: string, severity: DashboardIssue["severity"], message: string): DashboardIssue {
  return {
    file_path,
    issue_type: "test",
    severity,
    message,
    source_command: "test",
  };
}

function lintResult(overrides: Partial<LintScanResult> = {}): LintScanResult {
  return {
    schema_version: 3,
    source_command: "run-vault-lint",
    generated_at: lintGeneratedAt,
    duration_ms: 5,
    files_scanned: 5,
    scanned_file_paths: ["Notes/Error.md", "Notes/Review.md", "Notes/Clean.md", "Notes/Shape.md", "Notes/Shape Error.md"],
    issues: [
      issue("Notes/Error.md", "critical", "Missing required field"),
      issue("Notes/Error.md", "warning", "Unknown tag"),
    ],
    review_items: [
      issue("Notes/Review.md", "info", "Review cycle elapsed"),
      issue("Notes/Review.md", "info", "Inbox retention elapsed"),
    ],
    errors: 1,
    warnings: 1,
    infos: 0,
    ...overrides,
  };
}

function shapeResult(overrides: Partial<ShapeLintResult> = {}): ShapeLintResult {
  return {
    schema_version: 3,
    source_command: "run-shape-lint",
    generated_at: shapeGeneratedAt,
    duration_ms: 4,
    files_scanned: 2,
    scanned_file_paths: ["Notes/Shape.md", "Notes/Shape Error.md"],
    issues: [
      issue("Notes/Shape.md", "warning", "Heading order drift"),
      issue("Notes/Shape Error.md", "critical", "Missing required heading"),
    ],
    summary: {
      files_scanned: 2,
      issue_count: 2,
      missing_heading_count: 1,
      heading_order_issue_count: 1,
      extra_heading_count: 0,
      empty_section_count: 0,
    },
    errors: 1,
    warnings: 1,
    infos: 0,
    ...overrides,
  };
}

describe("Forge Bases health model", () => {
  it("indexes cached lint, Shape, review, clean, and scan timestamps by normalized path", () => {
    const index = buildForgeHealthIndex({ lint: lintResult(), shapeLint: shapeResult() });

    assert.deepEqual(index.get("Notes/Error.md"), {
      file_path: "Notes/Error.md",
      overall_status: "errors",
      lint_error_count: 1,
      lint_warning_count: 1,
      shape_issue_count: 0,
      review_reason: "",
      last_scan_time: lintGeneratedAt,
    });
    assert.equal(index.get("Notes/Review.md")?.overall_status, "needs_review");
    assert.equal(index.get("Notes/Review.md")?.review_reason, "Review cycle elapsed (+1 more)");
    assert.equal(index.get("Notes/Clean.md")?.overall_status, "clean");
    assert.equal(index.get("Notes/Shape.md")?.overall_status, "warnings");
    assert.equal(index.get("Notes/Shape.md")?.last_scan_time, shapeGeneratedAt);
    assert.equal(index.get("Notes/Shape Error.md")?.overall_status, "errors");
  });

  it("matches only Base entries and distinguishes clean from unscanned", () => {
    const index = buildForgeHealthIndex({ lint: lintResult(), shapeLint: shapeResult() });
    const rows = buildForgeHealthRows([
      { path: "Notes/Error.md", name: "Error" },
      { path: "Notes/Clean.md", name: "Clean" },
      { path: "Notes/Never Scanned.md", name: "Never scanned" },
    ], index, { includeCleanNotes: true, includeNotScannedNotes: true });

    assert.deepEqual(rows.map((row) => [row.file_name, row.overall_status]), [
      ["Error", "errors"],
      ["Clean", "clean"],
      ["Never scanned", "not_scanned"],
    ]);
    assert.equal(rows.some((row) => row.file_path === "Notes/Review.md"), false);
  });

  it("applies view filters and stable health group order", () => {
    const index = buildForgeHealthIndex({ lint: lintResult(), shapeLint: shapeResult() });
    const entries = [
      { path: "Notes/Clean.md" },
      { path: "Notes/Review.md" },
      { path: "Notes/Shape.md" },
      { path: "Notes/Error.md" },
      { path: "Notes/Never.md" },
    ];
    const rows = buildForgeHealthRows(entries, index, {
      minimumSeverity: "needs_review",
      includeCleanNotes: false,
      includeNotScannedNotes: false,
    });

    assert.deepEqual(rows.map((row) => row.overall_status), ["needs_review", "warnings", "errors"]);
    assert.deepEqual(groupForgeHealthRows(rows).map((group) => group.status), ["errors", "warnings", "needs_review"]);
  });

  it("treats entries absent from older caches as unscanned", () => {
    const legacyLint = lintResult({ scanned_file_paths: undefined });
    const index = buildForgeHealthIndex({ lint: legacyLint });
    const rows = buildForgeHealthRows([{ path: "Notes/Clean.md" }], index);

    assert.equal(rows[0]?.overall_status, "not_scanned");
  });
});
