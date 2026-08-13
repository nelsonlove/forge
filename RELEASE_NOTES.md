# Forge 3.0.0

Forge 3 brings cached vault health into Obsidian Bases and adopts Obsidian 1.10.0 as its new minimum version.

## Added

- Added a read-only **Forge health** Bases layout for the current Base result set.
- Added health groups for errors, warnings, notes needing review, clean notes, and notes not included in the latest scan.
- Added view controls for minimum severity, clean and unscanned visibility, and grouping.
- Added normal file opening, modifier-click, hover preview, Vault Health access, and explicit health refresh actions.
- Added an installed workflow guide for configuring and using the view.

## Changed

- Forge Health uses cached lint, Shape lint, and review results. Base updates never trigger a vault scan or write health fields into notes.
- Cached lint and Shape results now record scanned file paths so Forge can distinguish clean notes from unscanned notes.
- Settings changed outside Obsidian are detected through Obsidian's native callback instead of file polling.
- Obsidian 1.13+ receives native declarative settings controls and search; Obsidian 1.10–1.12 retains Forge's existing settings renderer.

## Compatibility

- Forge 3 requires Obsidian `1.10.0` or newer.
- Enable the Bases core plugin to use the Forge health layout.
- No note or settings migration is required.
- Refresh Forge health once after upgrading to populate clean-versus-unscanned cache data.
