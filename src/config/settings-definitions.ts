import type {
  SettingControl,
  SettingDefinition,
  SettingDefinitionItem,
  SettingDefinitionPage,
  SettingGroupItem,
} from "obsidian";
import type { ForgeSettings } from "./settings";

export type ForgeDeclarativeControlKey = keyof ForgeSettings
  | "activeFileLintEnabled"
  | "activeFileLintIdleDelaySeconds"
  | "dataviewExpansionAutoUpdateDelaySeconds"
  | "shapeRelationshipHeadingLevelChoice";

export type ForgeCustomSettingsSection =
  | "install-docs"
  | "frontmatter-field-order"
  | "schema-configuration"
  | "fileclass-frontmatter-source"
  | "stale-review-fields"
  | "export-actions"
  | "export-schema-fields"
  | "export-filter"
  | "export-exclude-folders"
  | "shape-field-configuration"
  | "shape-refinement-action"
  | "shape-lint-folders"
  | "shape-repair-folders"
  | "shape-repair-actions";

type Visibility = boolean | (() => boolean);

export interface ForgeCustomDefinitionOptions {
  id: ForgeCustomSettingsSection;
  name: string;
  desc: string;
  aliases?: string[];
  visible?: Visibility;
}

export interface ForgeSettingsDefinitionContext {
  settings: ForgeSettings;
  dataviewAvailable: boolean;
  custom: (options: ForgeCustomDefinitionOptions) => SettingDefinition<ForgeDeclarativeControlKey>;
  pageDescription: (page: ForgeSettingsPageId) => string;
  pageDisplayValue: (page: ForgeSettingsPageId) => string;
  pageStatus: (page: ForgeSettingsPageId) => "warning" | null;
}

export type ForgeSettingsPageId = "general" | "lint" | "patch" | "maintenance" | "export" | "shapes";

const PAGE_LABELS: Record<ForgeSettingsPageId, string> = {
  general: "General",
  lint: "Lint",
  patch: "Patch",
  maintenance: "Maintenance",
  export: "Export",
  shapes: "Shapes",
};

function nativeControl(
  name: string,
  desc: string,
  control: SettingControl<ForgeDeclarativeControlKey>,
  options: { aliases?: string[]; visible?: Visibility } = {}
): SettingDefinition<ForgeDeclarativeControlKey> {
  return { name, desc, control, ...options };
}

function group(
  heading: string,
  items: SettingGroupItem<ForgeDeclarativeControlKey>[]
): SettingDefinitionItem<ForgeDeclarativeControlKey> {
  return { type: "group", heading, items };
}

function folderControl(
  key: ForgeDeclarativeControlKey,
  name: string,
  desc: string,
  fallback: string,
  visible?: Visibility
): SettingDefinition<ForgeDeclarativeControlKey> {
  return nativeControl(name, desc, {
    type: "folder",
    key,
    defaultValue: fallback,
    placeholder: fallback,
    includeRoot: true,
    validate: (value) => value.trim() ? undefined : "Choose a folder.",
  }, { visible });
}

function toggleControl(
  key: ForgeDeclarativeControlKey,
  name: string,
  desc: string,
  visible?: Visibility,
  disabled?: boolean | (() => boolean)
): SettingDefinition<ForgeDeclarativeControlKey> {
  return nativeControl(name, desc, { type: "toggle", key, disabled }, { visible });
}

function sliderControl(
  key: ForgeDeclarativeControlKey,
  name: string,
  desc: string,
  min: number,
  max: number,
  step: number,
  visible?: Visibility
): SettingDefinition<ForgeDeclarativeControlKey> {
  return nativeControl(name, desc, {
    type: "slider",
    key,
    min,
    max,
    step,
  }, { visible });
}

function buildGeneral(context: ForgeSettingsDefinitionContext): SettingDefinitionItem<ForgeDeclarativeControlKey>[] {
  const { settings: s, dataviewAvailable, custom } = context;
  const dataviewVisible = () => s.dataviewExpansionEnabled && dataviewAvailable;

  return [
    custom({
      id: "install-docs",
      name: "Install documentation",
      desc: "Writes vault-native docs into your Forge folder without replacing existing notes.",
      aliases: ["install docs"],
    }),
    group("System paths", [
      folderControl("systemFolder", "System folder", "Root folder for all vault system files.", "System"),
      folderControl("forgeFolder", "Forge folder", "Folder for Forge configuration and patch archives.", "System/Forge"),
    ]),
    group("Dashboard", [
      toggleControl("dashboardFileInventoryEnabled", "File inventory", "Counts non-note assets by file type during dashboard refresh."),
      toggleControl("dashboardRefreshExportsEnabled", "Refresh exports with dashboard", "Runs export overview and ontology index during dashboard refresh."),
    ]),
    group("Dataview expansion", [
      toggleControl(
        "dataviewExpansionEnabled",
        "Enable dataview expansion",
        "Turn on bottom-of-note Dataview compatibility blocks.",
        undefined,
        () => !dataviewAvailable
      ),
      nativeControl("Auto-update mode", "Current session only. Edit idle refreshes after typing stops and when leaving the note.", {
        type: "dropdown",
        key: "dataviewExpansionAutoUpdateMode",
        options: { off: "Off", edit_idle: "Edit idle" },
        defaultValue: "edit_idle",
      }, { visible: dataviewVisible }),
      nativeControl("Auto-update delay (seconds)", "How long Forge waits after typing stops before refreshing the current note.", {
        type: "number",
        key: "dataviewExpansionAutoUpdateDelaySeconds",
        min: 0,
        max: 60,
        step: 1,
        defaultValue: 5,
        validate: (value) => Number.isInteger(value) && value >= 0 && value <= 60
          ? undefined
          : "Enter a whole number from 0 to 60.",
      }, { visible: () => dataviewVisible() && s.dataviewExpansionAutoUpdateMode !== "off" }),
      nativeControl("Block title", "Title shown in the collapsed block appended to the note.", {
        type: "text",
        key: "dataviewExpansionTitle",
        placeholder: "Dataview Expansion",
        defaultValue: "Dataview Expansion",
        validate: (value) => value.trim() ? undefined : "Enter a block title.",
      }, { visible: dataviewVisible }),
      nativeControl("Max links", "Maximum links written to the block. Use 0 for no limit.", {
        type: "number",
        key: "dataviewExpansionMaxLinks",
        min: 0,
        step: 1,
        defaultValue: 250,
        validate: (value) => Number.isInteger(value) && value >= 0
          ? undefined
          : "Enter a whole number of 0 or greater.",
      }, { visible: dataviewVisible }),
    ]),
    custom({
      id: "frontmatter-field-order",
      name: "Frontmatter field order",
      desc: "Add, remove, and reorder the fields Forge writes first.",
      aliases: ["configured fields", "prefill from schema"],
    }),
  ];
}

function buildLint(context: ForgeSettingsDefinitionContext): SettingDefinitionItem<ForgeDeclarativeControlKey>[] {
  const { settings: s, custom } = context;
  const activeLintVisible = () => s.activeFileLintAutoMode !== "off";
  const staleReviewVisible = () => s.staleReviewEnabled;

  return [
    group("Schema", [
      custom({
        id: "schema-configuration",
        name: "Schema configuration",
        desc: "Choose the schema note and schema-backed version field, or reload the current schema.",
        aliases: ["schema note", "version field", "reload schema"],
      }),
      nativeControl("Version field location", "Where the schema version is stored.", {
        type: "dropdown",
        key: "schemaVersionLocation",
        options: { inline: "Inline (key:: Value)", frontmatter: "Frontmatter" },
        defaultValue: "inline",
      }),
      custom({
        id: "fileclass-frontmatter-source",
        name: "Use Fileclass for frontmatter",
        desc: "Validate frontmatter against the Fileclass plugin's class definitions during lint.",
        aliases: ["fileclass", "frontmatter source", "required fields", "vocabulary"],
      }),
    ]),
    folderControl("lintRunsFolder", "Lint reports folder", "Folder where lint run reports are written.", "System/Exports/LintReports"),
    group("Vault lint", [
      toggleControl("lintStrictMode", "Strict mode", "Treat warnings as errors."),
      sliderControl("lintRunRetentionCount", "Lint run retention", "Number of lint run notes to keep.", 5, 50, 5),
      toggleControl("lintFileLinks", "Lint file links", "Wrap file paths in wikilinks in lint run notes."),
      toggleControl("lintInlineMetadata", "Lint inline metadata", "Check inline metadata against the schema."),
      toggleControl("lintExcludeInboxFolder", "Exclude inbox folder", "Skip inbox notes during vault lint."),
      nativeControl("Repair prompt threshold", "When to show the open vault repair button after lint.", {
        type: "dropdown",
        key: "lintRepairThreshold",
        options: { errors_only: "Errors only", errors_and_warnings: "Errors and warnings" },
        defaultValue: "errors_only",
      }),
    ]),
    group("Active file lint", [
      toggleControl("activeFileLintEnabled", "Enable auto-lint", "Lint the active note after editing becomes idle and when leaving it."),
      nativeControl("Idle delay (seconds)", "How long Forge waits after typing stops before linting the active note.", {
        type: "number",
        key: "activeFileLintIdleDelaySeconds",
        min: 0,
        max: 300,
        step: 0.5,
        defaultValue: 10,
        validate: (value) => Number.isFinite(value) && value >= 0 && value <= 300
          ? undefined
          : "Enter a number from 0 to 300.",
      }, { visible: activeLintVisible }),
    ]),
    group("Stale note review", [
      toggleControl("staleReviewEnabled", "Enable stale note review", "List notes whose review cycle has elapsed in Needs Review."),
      custom({
        id: "stale-review-fields",
        name: "Stale review fields",
        desc: "Choose review, updated, scope fields, and in-scope values from the schema.",
        aliases: ["review cycle field", "last updated field", "in-scope field", "in-scope values"],
        visible: staleReviewVisible,
      }),
    ]),
  ];
}

function buildPatch(context: ForgeSettingsDefinitionContext): SettingDefinitionItem<ForgeDeclarativeControlKey>[] {
  const s = context.settings;
  const backupsVisible = () => s.patchBackupEnabled;
  return [
    group("Paths", [
      folderControl("patchesFolder", "Patches folder", "Folder where applied patch files are archived.", "System/Forge/Patches"),
      folderControl("inboxFolder", "Inbox folder", "Folder for draft notes awaiting processing.", "System/Inbox"),
      nativeControl("Default patch file", "Default patch note opened by Forge patch commands.", {
        type: "file",
        key: "patchDefaultFile",
        placeholder: "System/Forge/Patches/vault-patch.md",
        defaultValue: "System/Forge/Patches/vault-patch.md",
        filter: (file) => ["md", "yaml", "yml"].includes(file.extension.toLowerCase()),
        validate: (value) => /\.(md|ya?ml)$/i.test(value.trim())
          ? undefined
          : "Choose a Markdown or YAML file.",
      }),
    ]),
    group("Apply safety", [
      toggleControl("patchBackupEnabled", "Backup before patch", "Create a backup of each modified file before applying a patch."),
      folderControl("patchBackupFolder", "Backup folder", "Folder where patch backups are stored.", "System/Forge/Patches/Backups", backupsVisible),
      toggleControl("patchGenerateManifest", "Generate restore manifest", "Write a restore manifest alongside each patch run.", backupsVisible),
      toggleControl("patchAutoLintAfterApply", "Run lint after patch", "Automatically run vault lint after applying a patch."),
      toggleControl("patchAutoMaintenanceAfterApply", "Run maintenance after patch", "Automatically run vault maintenance after applying a patch."),
    ]),
  ];
}

function buildMaintenance(context: ForgeSettingsDefinitionContext): SettingDefinitionItem<ForgeDeclarativeControlKey>[] {
  return [group("Retention", [
    sliderControl("backupRetentionDays", "Backup retention (days)", "Delete patch backups older than this many days.", 1, 60, 1),
    sliderControl("inboxRetentionDays", "Inbox retention (days)", "Age threshold used for stale inbox handling.", 1, 60, 1),
    nativeControl("Inbox retention action", "Delete stale inbox notes or list them in Needs Review.", {
      type: "dropdown",
      key: "inboxRetentionAction",
      options: { delete: "Delete in maintenance", review: "List under Needs Review" },
      defaultValue: "delete",
    }),
    sliderControl("lintHistoryRetentionDays", "Lint history retention (days)", "Trim lint history entries older than this many days.", 1, 90, 1),
    sliderControl("lintHistoryMaxEntries", "Lint history max entries", "Maximum lint history entries to retain.", 10, 100, 10),
    toggleControl("maintenanceAutoRunOnDashboardRefresh", "Auto-run on dashboard refresh", "Run maintenance whenever the dashboard refreshes."),
    sliderControl("patchReportRetentionCount", "Patch report retention", "Number of patch report notes to keep.", 5, 50, 5),
    sliderControl("shapeLintRunRetentionCount", "Shape lint run retention", "Number of shape lint run notes to keep.", 5, 50, 5),
  ])];
}

function buildExport(context: ForgeSettingsDefinitionContext): SettingDefinitionItem<ForgeDeclarativeControlKey>[] {
  const { settings: s, custom } = context;
  const exportVisible = () => s.exportEnabled;
  return [
    toggleControl("exportEnabled", "Enable export", "Enable vault inventory, metadata, and ontology export commands."),
    folderControl("exportsFolder", "Exports folder", "Folder where inventory and index files are written.", "System/Exports", exportVisible),
    custom({
      id: "export-actions",
      name: "Run exports",
      desc: "Run the vault overview or ontology index export.",
      aliases: ["export vault overview", "export ontology index"],
      visible: exportVisible,
    }),
    custom({
      id: "export-schema-fields",
      name: "Overview fields",
      desc: "Choose schema fields used for domain, type, status, and private-note detection.",
      aliases: ["domain field", "type field", "status field", "private note field"],
      visible: exportVisible,
    }),
    nativeControl("Dashboard note name", "Filename for the Dataview dashboard note. Leave blank for vault-dashboard.", {
      type: "text", key: "exportDashboardName", placeholder: "Vault-dashboard",
    }, { visible: exportVisible }),
    toggleControl("exportPrivateEnabled", "Private notes", "Count private notes separately and exclude them from vault metadata.", exportVisible),
    custom({
      id: "export-filter",
      name: "Ontology filter",
      desc: "Choose the schema field and values included in ontology export.",
      aliases: ["reload from schema", "filter field", "filter values"],
      visible: exportVisible,
    }),
    nativeControl("Relationship heading", "Top-level heading under which relationship links are organized.", {
      type: "text",
      key: "exportRelationshipHeading",
      placeholder: "Related",
      defaultValue: "Related",
      validate: (value) => value.trim() ? undefined : "Enter a heading.",
    }, { visible: exportVisible }),
    custom({
      id: "export-exclude-folders",
      name: "Excluded folders",
      desc: "Choose folders skipped during ontology export.",
      aliases: ["exclude folders"],
      visible: exportVisible,
    }),
  ];
}

function buildShapes(context: ForgeSettingsDefinitionContext): SettingDefinitionItem<ForgeDeclarativeControlKey>[] {
  const { settings: s, custom } = context;
  const shapesVisible = () => s.shapesEnabled;
  const refinementVisible = () => s.shapesEnabled && s.shapeRefinementEnabled;
  const relationshipsVisible = () => refinementVisible() && s.shapeInjectRelationships;
  const shapeLintVisible = () => s.shapesEnabled && s.shapeLintEnabled;
  const lintFoldersVisible = () => shapeLintVisible() && s.shapeLintScope === "folder";
  const repairVisible = () => s.shapesEnabled && s.shapeRepairEnabled;
  const repairFoldersVisible = () => repairVisible() && s.shapeRepairScope === "folder";

  return [
    toggleControl("shapesEnabled", "Enable vault shape engine", "Enable shape processing and template refinement."),
    group("Folders", [
      folderControl("shapesFolder", "Shapes folder", "Folder containing shape notes.", "System/Shapes", shapesVisible),
      toggleControl("shapeIncludeSubfolders", "Include subfolders", "Include shape notes in subfolders.", shapesVisible),
    ]),
    custom({
      id: "shape-field-configuration",
      name: "Template field configuration",
      desc: "Choose type/date fields and configure fields written to generated templates.",
      aliases: ["type target field", "created field", "updated field", "configured fields"],
      visible: shapesVisible,
    }),
    group("Template refinement", [
      toggleControl("shapeRefinementEnabled", "Enable template refinement", "Allow shape commands to create and update template notes.", shapesVisible),
      folderControl("shapeTemplatesFolder", "Templates folder", "Folder where template notes are written.", "System/Templates", refinementVisible),
      toggleControl("shapeInjectRelationships", "Inject relationship headings from schema", "Inject relationship headings for participating shape types.", refinementVisible),
      nativeControl("Relationship parent heading", "Heading under which relationship subheadings are grouped.", {
        type: "text",
        key: "shapeRelationshipHeading",
        placeholder: "Related",
        defaultValue: "Related",
        validate: (value) => value.trim() ? undefined : "Enter a heading.",
      }, { visible: relationshipsVisible }),
      nativeControl("Relationship heading level", "Heading level for the parent relationship heading.", {
        type: "dropdown",
        key: "shapeRelationshipHeadingLevelChoice",
        options: { "1": "H1", "2": "H2", "3": "H3" },
        defaultValue: "1",
      }, { visible: relationshipsVisible }),
      nativeControl("Relationship injection position", "Inject into an existing heading or append at the end.", {
        type: "dropdown",
        key: "shapeRelationshipPosition",
        options: { append: "Append at end", inject: "Inject into existing heading" },
        defaultValue: "append",
      }, { visible: relationshipsVisible }),
      custom({
        id: "shape-refinement-action",
        name: "Run refinement",
        desc: "Process all shape notes and write or update template notes now.",
        aliases: ["refine shape templates"],
        visible: refinementVisible,
      }),
    ]),
    group("Shape lint", [
      toggleControl("shapeLintEnabled", "Enable shape heading validation", "Validate note heading structure against shape templates.", shapesVisible),
      toggleControl("shapeLintStrictMode", "Strict template matching", "Flag headings not defined in the matching shape template.", shapeLintVisible),
      toggleControl("shapeLintAllowEmptySections", "Allow empty headings", "Allow required headings that are present but empty.", shapeLintVisible),
      toggleControl("shapeLintExcludeInboxFolder", "Exclude inbox folder", "Skip inbox notes during shape lint.", shapeLintVisible),
      nativeControl("Lint scope", "Validate all notes or only selected folders.", {
        type: "dropdown",
        key: "shapeLintScope",
        options: { all: "All vault notes", folder: "Selected folders only" },
        defaultValue: "all",
      }, { visible: shapeLintVisible }),
      custom({
        id: "shape-lint-folders",
        name: "Lint folders",
        desc: "Choose folders evaluated for shape heading validation.",
        visible: lintFoldersVisible,
      }),
    ]),
    group("Shape repair", [
      toggleControl("shapeRepairEnabled", "Enable shape repair", "Allow shape repair commands to modify notes.", shapesVisible),
      nativeControl("Repair scope", "Repair all notes or only selected folders.", {
        type: "dropdown",
        key: "shapeRepairScope",
        options: { all: "All vault notes", folder: "Selected folders only" },
        defaultValue: "all",
      }, { visible: repairVisible }),
      custom({
        id: "shape-repair-folders",
        name: "Repair folders",
        desc: "Choose folders evaluated for shape repair.",
        visible: repairFoldersVisible,
      }),
      folderControl("shapeRepairRunsFolder", "Repair runs folder", "Folder where shape repair run notes are written.", "System/Exports/ShapeRepairRuns", repairVisible),
      toggleControl("shapeRepairFileLinks", "Repair file links", "Wrap file paths in wikilinks in repair run notes.", repairVisible),
      sliderControl("shapeRepairHistoryRetentionCount", "Repair history retention", "Maximum repair history entries to keep.", 5, 50, 5, repairVisible),
      custom({
        id: "shape-repair-actions",
        name: "Run shape repair",
        desc: "Dry-run or apply shape heading repairs now.",
        aliases: ["dry run"],
        visible: repairVisible,
      }),
    ]),
  ];
}

export function buildForgeSettingDefinitions(
  context: ForgeSettingsDefinitionContext
): SettingDefinitionPage<ForgeDeclarativeControlKey>[] {
  const builders: Record<ForgeSettingsPageId, () => SettingDefinitionItem<ForgeDeclarativeControlKey>[]> = {
    general: () => buildGeneral(context),
    lint: () => buildLint(context),
    patch: () => buildPatch(context),
    maintenance: () => buildMaintenance(context),
    export: () => buildExport(context),
    shapes: () => buildShapes(context),
  };

  return (Object.keys(PAGE_LABELS) as ForgeSettingsPageId[]).map((id) => ({
    type: "page",
    name: PAGE_LABELS[id],
    desc: context.pageDescription(id),
    displayValue: () => context.pageDisplayValue(id),
    status: () => context.pageStatus(id),
    items: builders[id](),
  }));
}

export function collectDeclarativeControlKeys(
  definitions: SettingDefinitionItem<ForgeDeclarativeControlKey>[]
): ForgeDeclarativeControlKey[] {
  const keys: ForgeDeclarativeControlKey[] = [];
  const visit = (items: SettingDefinitionItem<ForgeDeclarativeControlKey>[]) => {
    for (const item of items) {
      if ("control" in item && item.control) keys.push(item.control.key);
      if ("items" in item && item.items) visit(item.items);
    }
  };
  visit(definitions);
  return keys;
}

export function getForgeDeclarativeControlValue(
  settings: ForgeSettings,
  key: string
): unknown {
  switch (key) {
    case "activeFileLintEnabled":
      return settings.activeFileLintAutoMode !== "off";
    case "activeFileLintIdleDelaySeconds":
      return settings.activeFileLintIdleDelayMs / 1000;
    case "dataviewExpansionAutoUpdateDelaySeconds":
      return settings.dataviewExpansionAutoUpdateDelayMs / 1000;
    case "shapeRelationshipHeadingLevelChoice":
      return String(settings.shapeRelationshipHeadingLevel);
    default:
      return (settings as unknown as Record<string, unknown>)[key];
  }
}

export function applyForgeDeclarativeControlValue(
  settings: ForgeSettings,
  key: string,
  value: unknown
): void {
  switch (key) {
    case "activeFileLintEnabled":
      settings.activeFileLintAutoMode = value ? "edit_idle" : "off";
      return;
    case "activeFileLintIdleDelaySeconds":
      settings.activeFileLintIdleDelayMs = Math.round(Number(value) * 1000);
      return;
    case "dataviewExpansionAutoUpdateDelaySeconds":
      settings.dataviewExpansionAutoUpdateDelayMs = Math.round(Number(value) * 1000);
      return;
    case "shapeRelationshipHeadingLevelChoice":
      settings.shapeRelationshipHeadingLevel = Number(value);
      return;
    case "dataviewExpansionTitle":
      settings.dataviewExpansionTitle = String(value).trim() || "Dataview Expansion";
      return;
    case "exportDashboardName":
      settings.exportDashboardName = String(value).trim();
      return;
    case "exportRelationshipHeading":
      settings.exportRelationshipHeading = String(value).trim();
      return;
    case "shapeRelationshipHeading":
      settings.shapeRelationshipHeading = String(value).trim() || "Related";
      return;
    default:
      (settings as unknown as Record<string, unknown>)[key] = value;
  }
}
