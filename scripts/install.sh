#!/usr/bin/env bash
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
replace=false
if [[ "${1:-}" == '--replace' ]]; then replace=true; shift; fi
if (($#)); then printf 'Usage: bash scripts/install.sh [--replace]\n' >&2; exit 2; fi
uuid='clipboard-history@local'
target="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$uuid"
if [[ -e "$target" ]]; then
    printf 'Existing extension at %s\n' "$target"
    ls -ld -- "$target"
    if [[ "$replace" != true ]]; then
        printf 'Not overwriting. Review the installation, then use --replace if intended.\n' >&2
        exit 1
    fi
fi
bash "$root/scripts/build.sh"
version="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version' "$root/package.json")"
archive="$root/dist/clipboard-history-$version.shell-extension.zip"
if [[ "$replace" == true ]]; then
    gnome-extensions install --force "$archive"
else
    gnome-extensions install "$archive"
fi
printf '\nInstalled files only. This script did not enable the extension or change shortcuts.\n'
printf 'On Wayland, log out and back in so GNOME discovers it, then run:\n'
printf '  gnome-extensions enable %s\n' "$uuid"
printf '  gnome-extensions prefs %s\n' "$uuid"
printf 'Logging out closes your applications; save work first.\n'
