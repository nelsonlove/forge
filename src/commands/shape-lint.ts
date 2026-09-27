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
 * **Never returns an empty map.** Null and empty are different answers, and only one of
 * them is safe: null means "this source has nothing to say here", and the caller falls
 * back to the templates folder, so nothing is ever linted against less than before. An
 * empty map would mean "lint against nothing", which is indistinguishable from a healthy
 * run and is exactly the failure this whole change exists to end. There are more ways to
 * reach it than there look to be — Fileclass absent, the plugin loaded but its index not
 * yet scanned, an installed build with no `getFileClassFile`, or simply no class note
 * carrying either fence — so the rule is applied once, at the end, rather than guessed at
 * per cause.
 *
 * The index is third-party, so every call into it is defended: a throw here would abort
 * the whole lint run and shape repair with it, and `fileClassNames` is not guaranteed to
 * be an array. That matches how `classesForFile` and `fieldOrderForFile` treat it.
 *
 * Note that the index holds an entry for every markdown file in the class-files folder,
 * whether or not it is really a class definition. Such an entry carries no fence, so it
 * yields no shape and costs one read.
 */
async function buildShapeHeadingCacheFromFileclass(
  app: App
): Promise<Map<string, ParsedHeading[]> | null> {
  if (!isFileclassAvailable(app)) return null;
  const index = getFileclassIndex(app);
  if (!index) return null;

  let classNames: unknown[];
  try {
    classNames = [...(index.fileClassNames ?? [])];
  } catch {
    return null; // not iterable — this index cannot answer the question
  }

  const cache = new Map<string, ParsedHeading[]>();

  for (const className of classNames) {
    if (typeof className !== "string") continue;
    const key = className.trim().toLowerCase();
    if (!key) continue;

    let file: TFile | null | undefined;
    try {
      file = index.getFileClassFile?.(className);
    } catch {
      continue;
    }
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

  if (cache.size === 0) {
    console.warn(
      "[Forge] Shape source is set to Fileclass class notes, but no class note yielded a "
      + "shape. Falling back to the templates folder so shape lint is not silently disabled."
    );
    return null;
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
  //
  // The class notes REPLACE the templates folder rather than joining it, which is what
  // the setting is for: one source, so the two cannot drift. The cost is that a vault
  // running both shape notes and Fileclass loses any shape that only a shape note
  // defines. That is the right trade where the class notes are the whole truth, and the
  // wrong one where they are half of it — which is why this is a setting and not a
  // rewrite.
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
