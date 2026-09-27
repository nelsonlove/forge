import { App, TAbstractFile, TFile, TFolder, parseYaml } from "obsidian";
import {
  buildShapeHeadingCacheFromTemplates,
  collectShapeTemplatesFromDocuments,
  lintShapeHeadingsForDocument,
  type ParsedHeading,
} from "../shapes/lint";
import { shapeHeadingsForClassNote } from "../shapes/derive";
import { getFileclassIndex, isFileclassAvailable } from "../fileclass/adapter";
import { createForgeDocument } from "../vault/document";
import { getVaultPaths } from "../vault/paths";
import type { ForgeSettings } from "../config/settings";
import type { ForgeDocument, LintResult } from "../linting/model";

export {
  buildTemplateTree,
  extractHeadings,
  flattenTemplateTree,
} from "../shapes/lint";
export type {
  ParsedHeading,
  TemplateNode,
} from "../shapes/lint";

/**
 * The shape of every class the Fileclass index knows, read from the class notes.
 *
 * A class's own `## Shape` fence wins where it declares one; otherwise the shape is
 * derived from its `## Template` fence. A class declaring neither contributes nothing
 * and is simply not linted — honest, but silent, which is why the count belongs in a
 * lint run's digest rather than in a finding.
 *
 * Returns null, rather than an empty map, when Fileclass is absent or has not loaded.
 * The two are different answers: null means "this source cannot be read here", and the
 * caller falls back to the templates folder so a vault without the plugin keeps working
 * exactly as before. An empty map would mean "Fileclass answered, and no class carries
 * a block", which would silently switch linting off.
 */
async function buildShapeHeadingCacheFromFileclass(
  app: App
): Promise<Map<string, ParsedHeading[]> | null> {
  if (!isFileclassAvailable(app)) return null;
  const index = getFileclassIndex(app);
  if (!index) return null;

  const cache = new Map<string, ParsedHeading[]>();

  for (const className of index.fileClassNames ?? []) {
    const key = className.trim().toLowerCase();
    if (!key) continue;

    const file = index.getFileClassFile?.(className);
    if (!file) continue;

    let raw: string;
    try {
      raw = await app.vault.cachedRead(file);
    } catch {
      continue; // an unreadable class note is not a shape, and not a finding either
    }

    const headings = shapeHeadingsForClassNote(raw);
    if (headings.length === 0) continue;
    cache.set(key, headings);
  }

  return cache;
}

export async function buildShapeHeadingCache(
  app: App,
  settings: ForgeSettings
): Promise<Map<string, ParsedHeading[]>> {
  // The class notes are the source only when asked for. Off — the default — this reads
  // the generated templates folder exactly as it always has, so the fork's behaviour is
  // unchanged for anyone who has not opted in. This gate stands alone deliberately: it
  // is not tied to `refinementSourceFileclass`, which a vault adopting this source turns
  // OFF once nothing generates template files any more.
  if (settings.shapeSourceFileclass) {
    const fromClassNotes = await buildShapeHeadingCacheFromFileclass(app);
    if (fromClassNotes) return fromClassNotes;
  }

  const templatesFolder = getVaultPaths(settings).templates;
  const templateFiles: TFile[] = [];

  const walk = (node: TAbstractFile) => {
    if (node instanceof TFile && node.extension.toLowerCase() === "md") {
      templateFiles.push(node);
    } else if (node instanceof TFolder) {
      node.children.forEach(walk);
    }
  };

  const abstractFolder = app.vault.getAbstractFileByPath(templatesFolder);
  if (!(abstractFolder instanceof TFolder)) return new Map<string, ParsedHeading[]>();
  abstractFolder.children.forEach(walk);

  const templateDocuments: ForgeDocument[] = [];
  for (const file of templateFiles) {
    const content = await app.vault.read(file);
    templateDocuments.push(createForgeDocument({
      path: file.path,
      content,
      parseYaml,
      stat: {
        ctime: file.stat.ctime,
        mtime: file.stat.mtime,
      },
    }));
  }

  return buildShapeHeadingCacheFromTemplates(
    collectShapeTemplatesFromDocuments(
      templateDocuments,
      templatesFolder,
      settings.shapeTypeTargetField
    )
  );
}

export async function lintShapeHeadings(
  _app: App,
  file: TFile,
  content: string,
  settings: ForgeSettings,
  headingCache: Map<string, ParsedHeading[]>
): Promise<LintResult[]> {
  const document = createForgeDocument({
    path: file.path,
    content,
    parseYaml,
    stat: {
      ctime: file.stat.ctime,
      mtime: file.stat.mtime,
    },
  });

  return lintShapeHeadingsForDocument(document, settings, headingCache);
}
