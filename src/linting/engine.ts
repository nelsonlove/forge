// src/linting/engine.ts
// Obsidian adapter for the Forge lint engine.

import { App, TFile, parseYaml } from "obsidian";
import {
  collectShapeNamesFromDocuments,
} from "../shapes/lint";
import { buildFileclassRuleMap, getFileclassApi } from "../fileclass/adapter";
import {
  createForgeDocument,
} from "../vault/document";
import {
  runLintForDocuments as runCoreLintForDocuments,
  type ForgeDocument,
  type LintResult,
  type LintRunEnvelope,
  type LintRunResult,
  type LintSeverity,
} from "./model";
import type { ForgeSettings } from "../config/settings";
import { classesForFile, getFileclassIndex } from "../fileclass/adapter";
import { getVaultPaths } from "../vault/paths";
import { loadSchema } from "../utils/schema";
import { getMarkdownFiles, isMarkdownFile } from "../utils/files";

export type {
  LintResult,
  LintRunEnvelope,
  LintRunResult,
  LintSeverity,
};

interface VaultAdapterWithBasePath {
  basePath?: string;
}

export async function runLint(
  app: App,
  settings: ForgeSettings
): Promise<LintRunResult | null> {
  const allFiles = getMarkdownFiles(app);
  return runLintForFiles(app, settings, allFiles);
}

export async function runLintForFile(
  app: App,
  settings: ForgeSettings,
  file: TFile
): Promise<LintRunResult | null> {
  return runLintForFiles(app, settings, [file]);
}

export async function runLintForFiles(
  app: App,
  settings: ForgeSettings,
  files: TFile[]
): Promise<LintRunResult | null> {
  const schema = await loadSchema(app, settings);
  if (!schema) return null;

  const paths = getVaultPaths(settings);
  const markdownFiles = files.filter(isMarkdownFile);
  const documents = await filesToForgeDocuments(app, markdownFiles);
  const shapeDocuments = filesToForgeDocumentsFromMetadata(getMarkdownFiles(app, paths.shapes));

  // Gate on the API, not the index — this feature reads schemas through
  // api.getSchema, and an index-only Fileclass build must not read as available.
  const fileclassRules = settings.frontmatterSourceFileclass && getFileclassApi(app) !== null
    ? await buildFileclassRuleMap(app, markdownFiles)
    : undefined;

  return runCoreLintForDocuments({
    documents,
    schema,
    settings,
    validShapes: collectShapeNamesFromDocuments(shapeDocuments, paths.shapes),
    vaultPath: (app.vault.adapter as VaultAdapterWithBasePath).basePath ?? "",
    classesByPath: resolveClassesByPath(app, settings, files),
    fileclassRules,
  });
}

/**
 * Resolved classes per file for class-conditioned lint rules, or undefined
 * when the feature is off or the Fileclass plugin is absent. Every linted
 * file gets an entry — an empty one is authoritative ("this note has no
 * classes"), so a dead fileClass key does not drive conditions the index
 * itself would not.
 */
function resolveClassesByPath(
  app: App,
  settings: ForgeSettings,
  files: TFile[]
): Map<string, string[]> | undefined {
  if (!settings.conditionSourceFileclass) return undefined;
  const index = getFileclassIndex(app);
  if (!index) return undefined;
  // An index that positively knows zero classes hasn't scanned the vault yet
  // (or the vault truly has none) — conditioning on it would suppress every
  // class-keyed rule, so fall back to the raw frontmatter key for this run.
  if (index.fileClassNames !== undefined && index.fileClassNames.length === 0) return undefined;
  return new Map(files.filter(isMarkdownFile).map((file) => [file.path, classesForFile(app, file)]));
}

async function filesToForgeDocuments(app: App, files: TFile[]): Promise<ForgeDocument[]> {
  const documents: ForgeDocument[] = [];

  for (const file of files) {
    let content = "";
    try {
      content = await app.vault.read(file);
    } catch {
      content = "";
    }

    documents.push(createForgeDocument({
      path: file.path,
      content,
      parseYaml,
      stat: {
        ctime: file.stat.ctime,
        mtime: file.stat.mtime,
      },
    }));
  }

  return documents;
}

function filesToForgeDocumentsFromMetadata(files: TFile[]): ForgeDocument[] {
  return files.map((file) => createForgeDocument({
    path: file.path,
    content: "",
    parseYaml,
    stat: {
      ctime: file.stat.ctime,
      mtime: file.stat.mtime,
    },
  }));
}
