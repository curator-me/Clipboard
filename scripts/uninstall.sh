#!/usr/bin/env bash
set -euo pipefail
purge=false
if [[ "${1:-}" == '--purge-history' ]]; then purge=true; shift; fi
if (($#)); then printf 'Usage: bash scripts/uninstall.sh [--purge-history]\n' >&2; exit 2; fi
uuid='clipboard-history@local'
target="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$uuid"
if [[ -e "$target" ]]; then
    ls -ld -- "$target"
    gnome-extensions disable "$uuid" || printf 'Extension was not enabled/discovered.\n' >&2
    gnome-extensions uninstall "$uuid"
else
    printf 'No extension directory found at %s\n' "$target"
fi
if [[ "$purge" == true ]]; then
    data="${XDG_DATA_HOME:-$HOME/.local/share}/clipboard-history"
    if [[ -L "$data" ]]; then
        printf 'Refusing to purge through a symlink: %s\n' "$data" >&2; exit 1
    fi
    if [[ -e "$data/history.json" || -L "$data/history.json" ]]; then
        ls -l -- "$data/history.json"
        rm -- "$data/history.json"
    fi
    if [[ -d "$data" ]]; then rmdir -- "$data" 2>/dev/null || true; fi
    printf 'Removed the app-managed history file (not forensic secure erasure).\n'
else
    printf 'Saved history, if any, was retained. Use --purge-history to remove it.\n'
fi
printf 'GSettings preferences are retained. No GNOME notification shortcut was changed.\n'
