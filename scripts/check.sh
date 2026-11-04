#!/usr/bin/env bash
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

while IFS= read -r -d '' source; do
    node --check "$source"
done < <(find extension tests -name '*.js' -print0)

node --input-type=module <<'JS'
import fs from 'node:fs';
import assert from 'node:assert/strict';
const project = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const extension = JSON.parse(fs.readFileSync('extension/metadata.json', 'utf8'));
assert.match(project.version, /^\d+\.\d+\.\d+$/);
assert.equal(extension['version-name'], project.version);
assert.equal(extension.uuid, 'clipboard-history@local');
assert.deepEqual(extension['shell-version'], ['46']);
assert.ok(Number.isInteger(extension.version) && extension.version > 0);
for (const path of ['extension/extension.js', 'extension/prefs.js', 'extension/stylesheet.css'])
    assert.ok(fs.existsSync(path), `Missing ${path}`);
for (const name of fs.readdirSync('extension/lib')) {
    const source = fs.readFileSync(`extension/lib/${name}`, 'utf8');
    assert.ok(!source.includes('node:') && !source.includes('Buffer.'), `Node-only runtime code: ${name}`);
}
console.log(`Metadata/runtime checks passed (${project.version}, GNOME 46).`);
JS

glib-compile-schemas --strict --dry-run extension/schemas
while IFS= read -r -d '' script; do bash -n "$script"; done < <(find scripts -name '*.sh' -print0)
npm test
bash scripts/test-gjs.sh
printf '\nSource, metadata, schema, shell syntax, model, and native smoke checks passed.\n'
printf 'These checks do not prove live GNOME clipboard/UI behavior.\n'
