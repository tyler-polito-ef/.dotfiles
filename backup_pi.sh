#!/usr/bin/env bash
# Back up selected (opt-in) parts of ~/.pi into ./pi within this dotfiles repo.
#
# Edit the INCLUDE array below to choose what gets backed up. Each name maps to
# a handler in backup_item(). To add a new opt-in item, add a name to INCLUDE
# and a matching case branch in backup_item().
#
# Available items:
#   settings    — agent/settings.json   (provider/model/theme — NO secrets)
#   themes      — agent/themes/**        (custom theme files)
#   skills      — agent/skills/**        (SKILL.md folders, excludes node_modules)
#   extensions  — agent/extensions/**    (authored .ts + subdir extensions,
#                                         excludes node_modules / package-lock.json)
#
# Excluded everywhere (regenerable or secret):
#   auth.json, sessions/, npm/, git/, node_modules/, package-lock.json
#
# Usage:
#   ./backup_pi.sh            # back up into ./pi
#   ./backup_pi.sh --dry-run  # show what would be copied without writing

set -euo pipefail

SRC="${PI_HOME:-$HOME/.pi}"
DEST="$(cd "$(dirname "$0")" && pwd)/pi"

# ─── opt-in list: edit this to choose what gets backed up ───────────────────
INCLUDE=(
  settings
  themes
  skills
  extensions
)
# ─────────────────────────────────────────────────────────────────────────────

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

if [[ ! -d "$SRC" ]]; then
  echo "error: pi config not found at $SRC" >&2
  exit 1
fi

echo "Backing up $SRC -> $DEST"
if [[ $DRY_RUN -eq 1 ]]; then
  echo "(dry run — no files will be written)"
  run() { echo "  $*"; }
else
  run() { "$@"; }
fi

# Start clean so deleted files don't linger in the repo.
if [[ $DRY_RUN -eq 0 ]]; then
  rm -rf "$DEST"
fi
run mkdir -p "$DEST"

cp_file() {
  # cp_file <src> <dest>
  if [[ -f "$1" ]]; then
    run mkdir -p "$(dirname "$2")"
    run cp "$1" "$2"
  else
    echo "  skip (missing): $1"
  fi
}

rsync_dir() {
  # rsync_dir <src-dir/> <dest-dir/> [exclude args...]
  local src="$1" dest="$2"; shift 2
  if [[ -d "$src" ]]; then
    run mkdir -p "$dest"
    run rsync -a --delete "$@" "$src" "$dest"
  else
    echo "  skip (missing): $src"
  fi
}

# Back up a single named item. Add a branch here to support a new opt-in.
backup_item() {
  case "$1" in
    settings)
      cp_file "$SRC/agent/settings.json" "$DEST/agent/settings.json"
      ;;
    themes)
      rsync_dir "$SRC/agent/themes/" "$DEST/agent/themes/" \
        --exclude='node_modules'
      ;;
    skills)
      rsync_dir "$SRC/agent/skills/" "$DEST/agent/skills/" \
        --exclude='node_modules'
      ;;
    extensions)
      rsync_dir "$SRC/agent/extensions/" "$DEST/agent/extensions/" \
        --exclude='node_modules' --exclude='package-lock.json'
      ;;
    *)
      echo "error: unknown INCLUDE item '$1'" >&2
      echo "  valid items: settings, themes, skills, extensions" >&2
      exit 1
      ;;
  esac
}

for item in "${INCLUDE[@]}"; do
  echo ":: $item"
  backup_item "$item"
done

# Final sanity guard: never let secrets or junk slip in.
if [[ $DRY_RUN -eq 0 ]]; then
  LEAKS=$(find "$DEST" \
    \( -name auth.json -o -path '*/sessions/*' -o -path '*/npm/*' \
       -o -path '*/git/*' -o -path '*/node_modules/*' \) \
    -print 2>/dev/null || true)
  if [[ -n "$LEAKS" ]]; then
    echo "error: leaked files found in backup:" >&2
    echo "$LEAKS" >&2
    exit 1
  fi
fi

echo "done."
if [[ $DRY_RUN -eq 0 ]]; then
  echo "Review with: git -C \"$DEST/..\" status pi"
  echo "Commit with: git -C \"$DEST/..\" add pi && git -C \"$DEST/..\" commit -m \"backup pi config\""
fi
