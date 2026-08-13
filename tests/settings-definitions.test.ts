import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SettingDefinition, SettingDefinitionItem } from "obsidian";
import {
  applyForgeDeclarativeControlValue,
  buildForgeSettingDefinitions,
  collectDeclarativeControlKeys,
  getForgeDeclarativeControlValue,
  type ForgeDeclarativeControlKey,
} from "../src/config/settings-definitions.js";
import { createForgeSettings } from "../src/config/settings.js";

function definitions() {
  const settings = createForgeSettings();
  const custom = (options: { name: string; desc: string; aliases?: string[]; visible?: boolean | (() => boolean) }): SettingDefinition<ForgeDeclarativeControlKey> => ({
    name: options.name,
    desc: options.desc,
    aliases: options.aliases,
    visible: options.visible,
    render: () => undefined,
  });
  return {
    settings,
    pages: buildForgeSettingDefinitions({
      settings,
      dataviewAvailable: true,
      custom,
      pageDescription: (page) => `${page} settings`,
      pageDisplayValue: () => "Ready",
      pageStatus: () => null,
    }),
  };
}

function findByName(
  items: SettingDefinitionItem<ForgeDeclarativeControlKey>[],
  name: string
): SettingDefinition<ForgeDeclarativeControlKey> | undefined {
  for (const item of items) {
    if ("name" in item && item.name === name) return item as SettingDefinition<ForgeDeclarativeControlKey>;
    if ("items" in item && item.items) {
      const match = findByName(item.items, name);
      if (match) return match;
    }
  }
  return undefined;
}

describe("declarative settings definitions", () => {
  it("exposes six searchable pages and an individual native control for every simple setting", () => {
    const { pages } = definitions();
    assert.deepEqual(pages.map((page) => page.name), ["General", "Lint", "Patch", "Maintenance", "Export", "Shapes"]);

    const keys = collectDeclarativeControlKeys(pages);
    const expected: ForgeDeclarativeControlKey[] = [
      "systemFolder", "forgeFolder", "dashboardFileInventoryEnabled", "dashboardRefreshExportsEnabled",
      "dataviewExpansionEnabled", "dataviewExpansionAutoUpdateMode", "dataviewExpansionAutoUpdateDelaySeconds",
      "dataviewExpansionTitle", "dataviewExpansionMaxLinks",
      "schemaVersionLocation", "lintRunsFolder", "lintStrictMode", "lintRunRetentionCount", "lintFileLinks",
      "lintInlineMetadata", "lintExcludeInboxFolder", "lintRepairThreshold", "activeFileLintEnabled",
      "activeFileLintIdleDelaySeconds", "staleReviewEnabled",
      "patchesFolder", "inboxFolder", "patchDefaultFile", "patchBackupEnabled", "patchBackupFolder",
      "patchGenerateManifest", "patchAutoLintAfterApply", "patchAutoMaintenanceAfterApply",
      "backupRetentionDays", "inboxRetentionDays", "inboxRetentionAction", "lintHistoryRetentionDays",
      "lintHistoryMaxEntries", "maintenanceAutoRunOnDashboardRefresh", "patchReportRetentionCount",
      "shapeLintRunRetentionCount",
      "exportEnabled", "exportsFolder", "exportDashboardName", "exportPrivateEnabled", "exportRelationshipHeading",
      "shapesEnabled", "shapesFolder", "shapeIncludeSubfolders", "shapeRefinementEnabled", "shapeTemplatesFolder",
      "shapeInjectRelationships", "shapeRelationshipHeading", "shapeRelationshipHeadingLevelChoice",
      "shapeRelationshipPosition", "shapeLintEnabled", "shapeLintStrictMode", "shapeLintAllowEmptySections",
      "shapeLintExcludeInboxFolder", "shapeLintScope", "shapeRepairEnabled", "shapeRepairScope",
      "shapeRepairRunsFolder", "shapeRepairFileLinks", "shapeRepairHistoryRetentionCount",
    ];

    assert.deepEqual(new Set(keys), new Set(expected));
    assert.equal(keys.length, expected.length, "native control keys must not be duplicated");
  });

  it("provides inline validation and re-evaluated conditional visibility", () => {
    const { settings, pages } = definitions();
    const maxLinks = findByName(pages, "Max links");
    assert.ok(maxLinks && "control" in maxLinks);
    const maxLinksControl = (maxLinks as unknown as { control: { type: string; validate?: (value: number) => string | undefined } }).control;
    assert.equal(maxLinksControl.type, "number");
    const validateMaxLinks = maxLinksControl.validate;
    assert.equal(validateMaxLinks?.(-1), "Enter a whole number of 0 or greater.");
    assert.equal(validateMaxLinks?.(0), undefined);

    const backupFolder = findByName(pages, "Backup folder");
    assert.ok(backupFolder && typeof backupFolder.visible === "function");
    settings.patchBackupEnabled = false;
    assert.equal(backupFolder.visible(), false);
    settings.patchBackupEnabled = true;
    assert.equal(backupFolder.visible(), true);
  });

  it("adapts synthetic native controls without changing persisted setting keys", () => {
    const settings = createForgeSettings({
      activeFileLintAutoMode: "off",
      activeFileLintIdleDelayMs: 10_000,
      dataviewExpansionAutoUpdateDelayMs: 5_000,
      shapeRelationshipHeadingLevel: 2,
    });

    assert.equal(getForgeDeclarativeControlValue(settings, "activeFileLintEnabled"), false);
    assert.equal(getForgeDeclarativeControlValue(settings, "activeFileLintIdleDelaySeconds"), 10);
    assert.equal(getForgeDeclarativeControlValue(settings, "dataviewExpansionAutoUpdateDelaySeconds"), 5);
    assert.equal(getForgeDeclarativeControlValue(settings, "shapeRelationshipHeadingLevelChoice"), "2");

    applyForgeDeclarativeControlValue(settings, "activeFileLintEnabled", true);
    applyForgeDeclarativeControlValue(settings, "activeFileLintIdleDelaySeconds", 2.5);
    applyForgeDeclarativeControlValue(settings, "dataviewExpansionAutoUpdateDelaySeconds", 7);
    applyForgeDeclarativeControlValue(settings, "shapeRelationshipHeadingLevelChoice", "3");

    assert.equal(settings.activeFileLintAutoMode, "edit_idle");
    assert.equal(settings.activeFileLintIdleDelayMs, 2_500);
    assert.equal(settings.dataviewExpansionAutoUpdateDelayMs, 7_000);
    assert.equal(settings.shapeRelationshipHeadingLevel, 3);
  });
});
