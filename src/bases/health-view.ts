import {
  BasesView,
  Keymap,
  Notice,
  setIcon,
  type BasesAllOptions,
  type HoverParent,
  type HoverPopover,
  type QueryController,
} from "obsidian";
import type { DashboardSnapshot } from "../dashboard/types";
import {
  buildForgeHealthIndex,
  buildForgeHealthRows,
  forgeHealthStatusLabel,
  groupForgeHealthRows,
  type ForgeHealthMinimumSeverity,
  type ForgeHealthRow,
  type ForgeHealthStatus,
} from "./health-model";

export const FORGE_HEALTH_BASES_VIEW = "forge-health";
export const FORGE_HEALTH_BASES_HOVER_SOURCE = "forge-health-bases";

export interface ForgeHealthBasesHost {
  cachePath: string;
  loadSnapshot: () => Promise<DashboardSnapshot | null>;
  refreshHealth: () => Promise<DashboardSnapshot>;
  openDashboard: () => Promise<void>;
}

export function forgeHealthBasesOptions(): BasesAllOptions[] {
  return [
    {
      type: "dropdown",
      key: "minimum_severity",
      displayName: "Minimum severity",
      default: "all",
      options: {
        all: "All findings",
        needs_review: "Needs review and higher",
        warning: "Warnings and errors",
        error: "Errors only",
      },
    },
    {
      type: "toggle",
      key: "include_clean_notes",
      displayName: "Include clean notes",
      default: false,
    },
    {
      type: "toggle",
      key: "include_not_scanned_notes",
      displayName: "Include not-scanned notes",
      default: true,
    },
    {
      type: "toggle",
      key: "group_by_health_status",
      displayName: "Group by health status",
      default: true,
    },
  ];
}

export class ForgeHealthBasesView extends BasesView implements HoverParent {
  readonly type = FORGE_HEALTH_BASES_VIEW;
  hoverPopover: HoverPopover | null = null;

  private readonly rootEl: HTMLElement;
  private snapshot: DashboardSnapshot | null = null;
  private healthIndex = buildForgeHealthIndex({});
  private cacheLoaded = false;
  private cacheError: string | null = null;
  private cacheLoad: Promise<void> | null = null;
  private cacheReloadTimer: number | null = null;
  private refreshInProgress = false;

  constructor(
    controller: QueryController,
    parentEl: HTMLElement,
    private host: ForgeHealthBasesHost
  ) {
    super(controller);
    this.rootEl = parentEl.createDiv({ cls: "forge-bases-health-view" });
  }

  onload(): void {
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (file.path === this.host.cachePath) this.queueCacheReload();
    }));
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (this.app.workspace.layoutReady && file.path === this.host.cachePath) {
        this.queueCacheReload();
      }
    }));
    void this.ensureCacheLoaded();
  }

  onDataUpdated(): void {
    void this.ensureCacheLoaded();
    this.render();
  }

  onunload(): void {
    if (this.cacheReloadTimer !== null) window.clearTimeout(this.cacheReloadTimer);
    this.rootEl.empty();
  }

  private queueCacheReload(): void {
    if (this.refreshInProgress) return;
    if (this.cacheReloadTimer !== null) window.clearTimeout(this.cacheReloadTimer);
    this.cacheReloadTimer = window.setTimeout(() => {
      this.cacheReloadTimer = null;
      void this.reloadCachedHealth();
    }, 100);
  }

  private ensureCacheLoaded(): Promise<void> {
    if (this.cacheLoaded) return Promise.resolve();
    if (!this.cacheLoad) {
      this.cacheLoad = this.reloadCachedHealth().finally(() => {
        this.cacheLoad = null;
      });
    }
    return this.cacheLoad;
  }

  private async reloadCachedHealth(): Promise<void> {
    try {
      this.snapshot = await this.host.loadSnapshot();
      this.healthIndex = buildForgeHealthIndex({
        lint: this.snapshot?.lint,
        shapeLint: this.snapshot?.shape_lint,
      });
      this.cacheError = null;
      this.cacheLoaded = true;
      this.render();
    } catch (error) {
      this.snapshot = null;
      this.healthIndex = buildForgeHealthIndex({});
      this.cacheError = error instanceof Error ? error.message : "Unexpected error";
      this.cacheLoaded = true;
      this.render();
    }
  }

  private render(): void {
    this.rootEl.empty();
    this.renderHeader();

    if (!this.cacheLoaded) {
      this.rootEl.createDiv({ cls: "forge-bases-health-empty", text: "Loading cached Forge health…" });
      return;
    }

    const rows = buildForgeHealthRows(
      (this.data?.data ?? []).map((entry) => ({ path: entry.file.path, name: entry.file.basename })),
      this.healthIndex,
      {
        minimumSeverity: this.minimumSeverity(),
        includeCleanNotes: this.booleanOption("include_clean_notes", false),
        includeNotScannedNotes: this.booleanOption("include_not_scanned_notes", true),
      }
    );

    if (rows.length === 0) {
      this.rootEl.createDiv({
        cls: "forge-bases-health-empty",
        text: "No Base entries match the current Forge health filters.",
      });
      return;
    }

    const fragment = createFragment();
    if (this.booleanOption("group_by_health_status", true)) {
      for (const group of groupForgeHealthRows(rows)) {
        const groupEl = fragment.createDiv({ cls: "forge-bases-health-group" });
        const heading = groupEl.createDiv({ cls: "forge-bases-health-group-heading" });
        heading.createSpan({ text: forgeHealthStatusLabel(group.status) });
        heading.createSpan({ cls: "forge-bases-health-count", text: String(group.rows.length) });
        this.renderTable(groupEl, group.rows);
      }
    } else {
      this.renderTable(fragment, rows);
    }
    this.rootEl.appendChild(fragment);
  }

  private renderHeader(): void {
    const header = this.rootEl.createDiv({ cls: "forge-bases-health-header" });
    const titleWrap = header.createDiv({ cls: "forge-bases-health-title" });
    titleWrap.createEl("h3", { text: "Forge health" });
    titleWrap.createDiv({
      cls: "forge-bases-health-cache-state",
      text: this.cacheStateText(),
    });

    const actions = header.createDiv({ cls: "forge-bases-health-actions" });
    const dashboardButton = actions.createEl("button", { text: "Open Vault Health" });
    dashboardButton.onClickEvent(() => {
      void this.host.openDashboard();
    });

    const refreshButton = actions.createEl("button", {
      text: this.refreshInProgress ? "Refreshing…" : "Refresh Forge health",
      cls: "mod-cta",
    });
    refreshButton.disabled = this.refreshInProgress;
    refreshButton.onClickEvent(() => {
      void this.refreshHealth();
    });
  }

  private renderTable(parent: Node, rows: readonly ForgeHealthRow[]): void {
    const table = parent.createDiv({ cls: "forge-bases-health-table" });
    const header = table.createDiv({ cls: "forge-bases-health-row forge-bases-health-row-header" });
    for (const label of ["Status", "File", "Lint errors", "Lint warnings", "Shape issues", "Review", "Last scan"]) {
      header.createSpan({ text: label });
    }

    for (const row of rows) {
      const rowEl = table.createDiv({ cls: "forge-bases-health-row" });

      const statusClasses = [
        "forge-bases-health-status",
        `forge-bases-health-status-${row.overall_status}`,
      ];
      if (row.overall_status === "not_scanned") statusClasses.push("forge-bases-health-muted");
      const status = rowEl.createDiv({
        cls: statusClasses,
      });
      const icon = status.createSpan({ cls: "forge-bases-health-status-icon" });
      setIcon(icon, statusIcon(row.overall_status));
      status.createSpan({ text: forgeHealthStatusLabel(row.overall_status) });

      const link = rowEl.createEl("a", {
        cls: "forge-bases-health-file",
        text: row.file_name,
        href: row.file_path,
      });
      link.setAttr("data-path", row.file_path);
      link.onClickEvent((event) => {
        if (event.button !== 0 && event.button !== 1) return;
        event.preventDefault();
        void this.app.workspace.openLinkText(row.file_path, "", Keymap.isModEvent(event));
      });
      link.addEventListener("mouseover", (event) => {
        this.app.workspace.trigger("hover-link", {
          event,
          source: FORGE_HEALTH_BASES_HOVER_SOURCE,
          hoverParent: this,
          targetEl: link,
          linktext: row.file_path,
        });
      });

      for (const [label, value] of [
        ["Lint errors", row.lint_error_count],
        ["Lint warnings", row.lint_warning_count],
        ["Shape issues", row.shape_issue_count],
      ] as const) {
        rowEl.createSpan({
          cls: "forge-bases-health-number",
          text: String(value),
          attr: { "data-label": label },
        });
      }
      rowEl.createSpan({
        cls: "forge-bases-health-review forge-bases-health-detail forge-bases-health-muted",
        text: row.review_reason || "—",
        title: row.review_reason || undefined,
        attr: { "data-label": "Review" },
      });
      rowEl.createSpan({
        cls: "forge-bases-health-scan forge-bases-health-detail forge-bases-health-muted",
        text: formatScanTime(row.last_scan_time),
        attr: { "data-label": "Last scan" },
      });
    }
  }

  private async refreshHealth(): Promise<void> {
    if (this.refreshInProgress) return;
    this.refreshInProgress = true;
    this.render();
    try {
      await this.host.refreshHealth();
      await this.reloadCachedHealth();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      new Notice(`Forge: ${message}`, 6000);
    } finally {
      this.refreshInProgress = false;
      this.render();
    }
  }

  private minimumSeverity(): ForgeHealthMinimumSeverity {
    const value = this.config.get("minimum_severity");
    return value === "error" || value === "warning" || value === "needs_review" ? value : "all";
  }

  private booleanOption(key: string, fallback: boolean): boolean {
    const value = this.config.get(key);
    return typeof value === "boolean" ? value : fallback;
  }

  private cacheStateText(): string {
    if (!this.cacheLoaded) return "Loading cached results";
    if (this.cacheError) return `Could not load cached results · ${this.cacheError}`;
    if (!this.snapshot) return "Never scanned — refresh Forge health to create results";
    const generatedAt = newestSnapshotTimestamp(this.snapshot);
    if (!generatedAt) return "Cached results available";
    const generatedTime = Date.parse(generatedAt);
    if (!Number.isFinite(generatedTime)) return `Cached health · ${generatedAt}`;
    const ageHours = Math.max(0, (Date.now() - generatedTime) / 3_600_000);
    const age = ageHours >= 48
      ? `${Math.floor(ageHours / 24)} days old`
      : ageHours >= 2
        ? `${Math.floor(ageHours)} hours old`
        : "recent";
    return `Cached health · ${age} · ${formatScanTime(generatedAt)}`;
  }
}

function statusIcon(status: ForgeHealthStatus): "circle-x" | "triangle-alert" | "clock-3" | "circle-check" | "circle-help" {
  switch (status) {
    case "errors": return "circle-x";
    case "warnings": return "triangle-alert";
    case "needs_review": return "clock-3";
    case "clean": return "circle-check";
    case "not_scanned": return "circle-help";
  }
}

function formatScanTime(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function newestSnapshotTimestamp(snapshot: DashboardSnapshot): string | null {
  const timestamps = [snapshot.lint?.generated_at, snapshot.shape_lint?.generated_at]
    .filter((value): value is string => Boolean(value));
  return timestamps.reduce<string | null>((newest, timestamp) => {
    if (!newest) return timestamp;
    const newestTime = Date.parse(newest);
    const timestampTime = Date.parse(timestamp);
    if (!Number.isFinite(newestTime)) return timestamp;
    if (!Number.isFinite(timestampTime)) return newest;
    return timestampTime > newestTime ? timestamp : newest;
  }, null);
}
