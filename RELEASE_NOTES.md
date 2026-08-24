# Forge 3.0.1

Forge 3.0.1 fixes namespaced Shape handling and adds dynamic heading placeholders for structures derived from external schemas or note templates.

## Added

- Added namespaced shape identities derived from paths beneath the configured Shapes folder. For example, `Shapes/Task/Project.md` maps to `Task/Project`.
- Added non-empty dynamic heading placeholders such as `# {{TITLE}}` and `## Log for {{DATE}}`.

## Fixed

- Fixed same-named shapes in different subfolders silently collapsing into one identity.
- Fixed template refinement overwriting one generated template when namespaced shapes shared a basename.
- Fixed template lookup so generated frontmatter preserves the readable namespaced identity, with reversible `%2F` filename encoding as a compatibility fallback.
- Prevented dynamic placeholders from consuming headings reserved for fixed sibling entries.
- Prevented Shape Repair from inserting literal placeholder text when the missing dynamic value cannot be inferred safely.

## Compatibility

- Forge requires Obsidian `1.10.0` or newer.
- Existing flat shape names and template filenames continue to work unchanged.
- No note or settings migration is required.
- Shape Repair leaves missing dynamic headings unresolved for manual review because it cannot infer their concrete text.

## After updating

1. Run **Reload plugins** from the command palette.
2. Enable **Include subfolders** when using namespaced shapes.
3. Run **Refine Shape Templates** to generate collision-free namespaced templates.
4. Run **Shape Lint** to validate the derived structures.
