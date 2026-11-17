#!/usr/bin/env bash
# Back up opt-in config for pi, Zed and Herdr into this dotfiles repo.
#
#   ./backup.sh                 # back up everything
#   ./backup.sh pi zed          # back up only some targets (pi | zed | herdr)
#   ./backup.sh --dry-run       # list what would be written, change nothing
#
# Only allow-listed files are copied (see backup_pi / backup_zed / backup_herdr).
# Everything is staged in a temp dir, sanitized, and scanned for leaks before
# it replaces ./pi, ./zed or ./herdr-app. If the scan finds anything, nothing
# in the repo is touched.
#
# Never backed up (secrets, PII, work info, or regenerable state):
#   pi:    auth.json, mcp.json (tokens), mcp-auth.json, trust.json (project
#          paths), models.json + README.md (work AI-gateway setup),
#          models-store.json, sessions/, npm/, git/, bin/, install/, pi-acp/
#   zed:   *_backup.json, conversations/, embeddings/, prompts/ (dbs), .tmp*
#   herdr: shipped mods/layouts/themes, shared.json, view.json, data/,
#          telemetry/, window.json, icons/, frame/, *.d.ts, socket
#
# Extra leak terms (work org names, coworker handles, ...) go one per line in
# .backup-denylist next to this script. That file is gitignored on purpose.

set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
PI_SRC="${PI_HOME:-$HOME/.pi}"
ZED_SRC="$HOME/.config/zed"
HERDR_SRC="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"

# Themes that ship with Herdr (not tracked in installed.json, so listed here).
HERDR_SHIPPED_THEMES="atom-one-dark win98"

DRY_RUN=0
TARGETS=()
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY_RUN=1 ;;
    pi|zed|herdr) TARGETS+=("$arg") ;;
    *) echo "usage: $0 [--dry-run] [pi] [zed] [herdr]" >&2; exit 1 ;;
  esac
done
[[ ${#TARGETS[@]} -eq 0 ]] && TARGETS=(pi zed herdr)

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# ─── helpers ────────────────────────────────────────────────────────────────
cp_file() { # cp_file <src> <dest>
  if [[ -f "$1" ]]; then mkdir -p "$(dirname "$2")"; cp "$1" "$2"
  else echo "  skip (missing): $1"; fi
}

cp_dir() { # cp_dir <src-dir> <dest-dir> [rsync exclude args...]
  local src="$1" dest="$2"; shift 2
  if [[ -d "$src" ]]; then mkdir -p "$dest"; rsync -a "$@" "$src/" "$dest/"
  else echo "  skip (missing): $src"; fi
}

contains() { # contains <word> <space-separated list>
  case " $2 " in *" $1 "*) return 0 ;; *) return 1 ;; esac
}

# ─── targets ────────────────────────────────────────────────────────────────
backup_pi() {
  local src="$PI_SRC/agent" dest="$STAGE/pi/agent"
  cp_file "$src/settings.json" "$dest/settings.json"
  cp_dir "$src/themes" "$dest/themes" --exclude=node_modules
  cp_dir "$src/skills" "$dest/skills" --exclude=node_modules
  cp_dir "$src/extensions" "$dest/extensions" \
    --exclude=node_modules --exclude=package-lock.json
}

backup_zed() {
  local src="$ZED_SRC" dest="$STAGE/zed" f
  for f in settings.json keymap.json tasks.json; do
    cp_file "$src/$f" "$dest/$f"
  done
  cp_dir "$src/snippets" "$dest/snippets"
  cp_dir "$src/themes" "$dest/themes"
}

backup_herdr() {
  local src="$HERDR_SRC" dest="$STAGE/herdr-app" shipped f name
  cp_file "$src/settings.json" "$dest/settings.json"
  cp_file "$src/keys.json" "$dest/keys.json"
  [[ -f "$src/programs.json" ]] && cp_file "$src/programs.json" "$dest/programs.json"

  # installed.json lists the mods and layouts Herdr ships; keep only the rest.
  shipped="$(jq -r 'keys[]' "$src/installed.json" 2>/dev/null | tr '\n' ' ')"

  for f in "$src"/themes/*.json; do
    [[ -e "$f" ]] || continue
    name="$(basename "$f" .json)"
    contains "$name" "$HERDR_SHIPPED_THEMES" || cp_file "$f" "$dest/themes/$name.json"
  done

  for f in "$src"/layouts/*.json; do
    [[ -e "$f" ]] || continue
    name="$(basename "$f" .json)"
    contains "layout:$name" "$shipped" || cp_file "$f" "$dest/layouts/$name.json"
  done

  for f in "$src"/mods/*/; do
    [[ -d "$f" ]] || continue
    name="$(basename "$f")"
    contains "$name" "$shipped" && continue
    # gpui-kit.d.ts / jsconfig.json are generated editor support files.
    cp_dir "${f%/}" "$dest/mods/$name" \
      --exclude=gpui-kit.d.ts --exclude=jsconfig.json --exclude='*.error'
  done

  # The PRs mod hardcodes GitHub handles and work repos: blank them out.
  for f in "$dest"/mods/*/main.js; do
    [[ -f "$f" ]] || continue
    sed -i '' -E \
      -e 's|^const AUTHORS = .*|const AUTHORS = []; // GitHub usernames (redacted in backup)|' \
      -e 's|^const REPOS = .*|const REPOS = []; // "owner/repo" entries (redacted in backup)|' \
      -e 's|\.replace\(/\^[A-Za-z0-9_-]+-/, ""\)|.replace(/^repo-prefix-/, "")|' \
      "$f"
  done
}

for t in "${TARGETS[@]}"; do
  echo ":: $t"
  "backup_$t"
done

# ─── leak scan ──────────────────────────────────────────────────────────────
find "$STAGE" -name .DS_Store -delete

PATTERNS=(
  "$HOME/"                                   # absolute home paths
  'ghp_[A-Za-z0-9]{20,}' 'gho_[A-Za-z0-9]{20,}' 'github_pat_[A-Za-z0-9_]{20,}'
  'sk-[A-Za-z0-9_-]{20,}' 'xox[abps]-[A-Za-z0-9-]{10,}'
  'Bearer [A-Za-z0-9._-]{16,}' 'AKIA[0-9A-Z]{16}'
  '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]*[a-z]{2,}'   # email addresses
)
if [[ -f "$REPO/.backup-denylist" ]]; then
  while IFS= read -r line; do
    [[ -z "$line" || "$line" == \#* ]] || PATTERNS+=("$line")
  done < "$REPO/.backup-denylist"
fi

LEAKS=""
for p in "${PATTERNS[@]}"; do
  hits="$(grep -rIilE -- "$p" "$STAGE" 2>/dev/null || true)"
  [[ -n "$hits" ]] && LEAKS+="$hits"$'\n'
done
LEAKS+="$(find "$STAGE" \( -name auth.json -o -name 'mcp*.json' -o -name trust.json \
  -o -name models.json -o -path '*/sessions/*' -o -path '*/node_modules/*' \) -print)"
LEAKS="$(printf '%s' "$LEAKS" | sed '/^$/d' | sort -u)"

if [[ -n "$LEAKS" ]]; then
  echo "error: possible secrets/PII in these files; nothing was written:" >&2
  echo "${LEAKS//$STAGE\//  }" >&2
  exit 1
fi

# ─── write ──────────────────────────────────────────────────────────────────
for t in "${TARGETS[@]}"; do
  case "$t" in pi) d=pi ;; zed) d=zed ;; herdr) d=herdr-app ;; esac
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "-- would write $d/:"
    (cd "$STAGE" && find "$d" \( -type f -o -type l \) | sort | sed 's/^/  /')
  else
    rm -rf "${REPO:?}/$d"
    mv "$STAGE/$d" "$REPO/$d"
  fi
done

echo "done."
[[ $DRY_RUN -eq 1 ]] || echo "Review with: git -C \"$REPO\" status"
