# Forge 3.0.2

Forge 3.0.2 is a source-compatibility patch for dynamic Shape heading matching.

## Fixed

- Replaced `String.matchAll()` with an ES2018-compatible, fully typed regular-expression loop.
- Removed unsafe TypeScript source-review warnings from dynamic heading placeholder matching.

## Compatibility

- Forge requires Obsidian `1.10.0` or newer.
- Dynamic heading matching behavior is unchanged from Forge 3.0.1.
- No note or settings migration is required.

## After updating

1. Run **Reload plugins** from the command palette.
