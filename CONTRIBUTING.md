# Contributing to Clipboard History

Use this guide to build, verify, and develop the GNOME Shell extension. For installation and operation, see the [user guide](USER_GUIDE.md).

## Requirements

The only declared runtime target is **Ubuntu 24.04 / GNOME Shell 46**, with Wayland as the target desktop. Runtime libraries are GNOME Shell/GJS, St/Meta/Clutter, Gio/GLib, GdkPixbuf, GTK4, and libadwaita, normally provided by Ubuntu's GNOME desktop.

Development/package tooling: **Node.js 20+**, Bash, zip/unzip, and glib-compile-schemas. There are no npm runtime dependencies; Node is not used inside the extension.

## Build and automated checks

Run from the repository root:

```bash
npm test                 # Portable models and composition-root regression tests
bash scripts/test-gjs.sh # Native APIs/PNG/private storage in a temporary XDG directory
npm run check            # Syntax, metadata, schemas, Node tests, and native smoke
npm run build            # Runs checks and creates the extension archive
```

Current archive: `dist/clipboard-history-0.1.2.shell-extension.zip`. Packaging uses an explicit runtime allowlist and includes compiled schemas; tests, documentation, and local data are not bundled.

Build/check scripts **do not install, enable, restart the desktop, change shortcuts, or use the real clipboard**. Native smoke uses temporary test data and does not launch a UI. Installation and enablement are separate, deliberate operations.

Automated tests cover history/limits/pins, text preservation, validated snapshots, cancellation, and save/purge ordering. Composition-root tests inject desktop/storage fakes. GJS smoke checks installed APIs, PNG decoding, and private storage. Passing these tests **does not verify live global capture, image paste, focus behavior, or rendered UI**.

## Live desktop acceptance

Live clipboard and visual acceptance remain pending. Before claiming a desktop-tested release, record the app/GNOME versions, session type, theme/scaling, and pass/fail results using disposable text and harmless images.

Check the following in an explicitly enabled user session:

- Copy from multiple native Wayland and XWayland apps with the picker closed; verify background capture and newest-first ordering.
- Restore text/PNG and paste into destination apps; verify exact text, valid images, focus return, and continued paste after the source UI closes. Selection must not inject paste or Enter.
- Exercise duplicates, search, Up/Down/Enter/Escape, Ctrl+F, Tab traversal, multiline/literal previews, and pin/delete actions.
- Confirm cancelling clear-all changes nothing; confirming removes pins too, without clearing the current clipboard.
- Pause/copy/resume and lock/unlock: no catch-up capture, no locked picker, and documented session-history behavior.
- Reach count/byte limits with harmless data; verify bounded behavior and no silent pin eviction.
- Exercise optional persistence, disable/re-enable, and logout/login, including saved deletion/pin behavior, opt-out cleanup, and no duplicate signals/shortcuts.
- Check small displays, light/dark/high-contrast themes, increased text/display scaling, and reachable controls.
- Check sensitive MIME suppression only with harmless test data. Never advertise it as reliable secret detection.

Use the [user guide](USER_GUIDE.md) as the behavior contract. Do not treat a branch name or a passing build as desktop verification.

## Branch workflow

- `dev`: ongoing development and testing.
- `main`: reviewed, publishable changes.
- Keep source, tests, scripts, package metadata, public guides, README, and changelog available on both branches after promotion.

```bash
git switch dev
# Make changes and run checks; commit intentionally.
npm run check
npm run build
# Complete the applicable live desktop checks before promotion.
git switch main
git merge --ff-only dev
```

Review the diff before promotion. If branches diverge, review and reconcile their history rather than forcing it. Commit and push are deliberate steps, never performed by build/install scripts. Push only named branches when publication is intended; avoid `git push --mirror`, which can expose private/local refs.

## Repository content policy

Public documentation belongs in tracked files such as README.md, USER_GUIDE.md, CONTRIBUTING.md, and CHANGELOG.md.

`docs/` contains local-only planning, design, research, and work-log notes and is ignored on both branches. Do not force-add those notes or link public guides to them. Generated `dist/`, dependencies, runtime/clipboard data, secrets, and local editor/agent settings also stay out of Git.

**A development branch is not a privacy boundary.** Pushing a branch publishes its tracked content and ancestors, even if a later commit deleted a private file. Ignored notes are not backed up by ordinary source commits; keep independent local backups.

## Changes and bug reports

- Reproduce with non-sensitive fixtures; add a failing regression test when practical before fixing the smallest responsible layer.
- Rerun automated/native checks and build. For Shell-only bugs, also record a manual reproducer and GNOME/session version.
- Record release-visible changes in [CHANGELOG.md](CHANGELOG.md). Follow SemVer, synchronizing `package.json` and `extension/metadata.json`'s `version-name`; GNOME's positive integer extension revision is separate and must be updated for a new version.
- Never log clipboard payloads, commit history data, or claim live behavior from model tests.

Bug reports should include app/GNOME versions, session type, installation source, non-sensitive steps, expected/actual results, last known working version, and a sanitized error excerpt. Include theme/scaling for visual issues. Never attach clipboard history or secrets; review all logs before sharing.
