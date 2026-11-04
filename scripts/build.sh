#!/usr/bin/env bash
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
bash scripts/check.sh
version="$(node -p 'JSON.parse(require("fs").readFileSync("package.json", "utf8")).version')"
mkdir -p dist
stage="$(mktemp -d "$root/dist/build.XXXXXX")"
trap 'rm -rf -- "$stage"' EXIT
mkdir -p "$stage/package/lib" "$stage/package/schemas"
for file in extension.js prefs.js metadata.json stylesheet.css; do
    cp -- "extension/$file" "$stage/package/$file"
done
for file in history.js controller.js clipboard.js picker.js storage.js; do
    cp -- "extension/lib/$file" "$stage/package/lib/$file"
done
cp -- extension/schemas/*.gschema.xml "$stage/package/schemas/"
glib-compile-schemas --strict "$stage/package/schemas"
(cd "$stage/package" && zip -q -r "$stage/clipboard.zip" .)
archive="$root/dist/clipboard-history-$version.shell-extension.zip"
mv -- "$stage/clipboard.zip" "$archive"
unzip -t "$archive"
printf '\nBuilt: %s\nNo installation, enablement, or desktop settings changes were performed.\n' "$archive"
