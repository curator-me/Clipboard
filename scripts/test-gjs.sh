#!/usr/bin/env bash
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if ! command -v gjs >/dev/null; then printf 'GJS is required for native smoke tests.\n' >&2; exit 1; fi
scratch="$(mktemp -d /tmp/clipboard-test.XXXXXX)"
trap 'rm -rf -- "$scratch"' EXIT
export XDG_DATA_HOME="$scratch"
export CLIPBOARD_TEST_DIR="$scratch"
export GI_TYPELIB_PATH="/usr/lib/gnome-shell:/usr/lib/x86_64-linux-gnu/mutter-14${GI_TYPELIB_PATH:+:$GI_TYPELIB_PATH}"
export LD_LIBRARY_PATH="/usr/lib/gnome-shell:/usr/lib/x86_64-linux-gnu/mutter-14${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
gjs -m "$root/tests/gjs-smoke.js"
