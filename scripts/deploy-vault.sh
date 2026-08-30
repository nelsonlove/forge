#!/bin/bash
# Deploy the built plugin into an Obsidian vault — with the clobber guard.
#
# The fork deploys by copying main.js next to a manifest, which means two builds
# carrying the same version string overwrite each other silently. That burned
# 3.1.0-nl.3: two sessions minted one version, and the loser vanished without a trace.
# A version stamp is a claim; this script is what checks it.
#
# Refuses to overwrite an installed build whose manifest version equals ours but whose
# main.js bytes differ — that is two different builds claiming one identity, and the
# fix is minting a new -nl.N, never redefining an existing one. Same version + same
# bytes is an idempotent redeploy and fine. Different version deploys normally.
#
# Usage: scripts/deploy-vault.sh [vault-path]   (default: ~/obsidian)
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
VAULT="${1:-$HOME/obsidian}"
DEST="$VAULT/.obsidian/plugins/forge"

for f in main.js manifest.json; do
  [[ -f "$REPO/$f" ]] || { echo "error: $REPO/$f missing — build first (npm run build)" >&2; exit 1; }
done

ver() { python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['version'])" "$1"; }
NEW_VER="$(ver "$REPO/manifest.json")"

if [[ -f "$DEST/manifest.json" && -f "$DEST/main.js" ]]; then
  OLD_VER="$(ver "$DEST/manifest.json")"
  if [[ "$OLD_VER" == "$NEW_VER" ]] && ! cmp -s "$REPO/main.js" "$DEST/main.js"; then
    echo "REFUSED: installed build already claims $OLD_VER with different bytes." >&2
    echo "Two builds may not share one version. Bump to a new -nl.N and redeploy." >&2
    exit 1
  fi
  echo "installed: $OLD_VER -> deploying: $NEW_VER"
else
  echo "no existing install — deploying $NEW_VER fresh"
fi

mkdir -p "$DEST"
cp "$REPO/main.js" "$REPO/manifest.json" "$DEST/"
[[ -f "$REPO/styles.css" ]] && cp "$REPO/styles.css" "$DEST/"
echo "deployed $NEW_VER to $DEST"
echo "reload the plugin in Obsidian (or via governor obsidian_plugin_reload) to load it"
