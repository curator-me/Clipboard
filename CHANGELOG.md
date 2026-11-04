# Changelog

All notable release changes are recorded here. Versions follow Semantic Versioning.

## 0.1.2 — Unreleased

### Documentation

- Shorten the README to quick setup, core features, basic usage, and essential privacy/compatibility warnings.
- Add a public user guide for detailed shortcuts, limits, persistence, troubleshooting, and uninstall instructions.
- Add a public contributing guide for build/tests, live desktop acceptance, branch workflow, and repository content policy.
- Keep machine-specific Git backup details in ignored local notes, without public links to those notes.
- Synchronize SemVer metadata at 0.1.2 and GNOME extension revision at 3; clipboard behavior and the default shortcut are unchanged.

## 0.1.1 — Unreleased

### Repository and delivery

- Prepare a clean shared starting history for `main` and `dev`.
- Exclude private development notes, local agent/editor settings, secrets, generated packages, and runtime data from tracked source.
- Keep README, changelog, tests, and build/install scripts in both publishable branches.
- Document the development/merge workflow and content-safe bug reporting without links to local-only notes.
- Synchronize SemVer metadata at 0.1.1 and GNOME extension revision at 2; runtime behavior and safe default shortcut are unchanged.

## 0.1.0 — Initial development

### Planning and tooling

- Initial Ubuntu GNOME clipboard-history project and Git implementation branch.
- Agent-assisted feature/platform research and documented architecture alternatives.
- Native UI contract, privacy requirements, regression checklist, and milestone tracking.

### Added

- GNOME46 Wayland clipboard-owner capture and exact text/validated PNG restoration.
- Native panel picker with search, keyboard navigation, readable previews/thumbnails, pins, delete and confirmed clear-all.
- Safe Super+Shift+V shortcut and GTK4/libadwaita preferences.
- Memory-only privacy default, pause/lock guards, bounded payloads/transfers/images, and optional private atomic plaintext persistence.
- Dependency-free Node tests, isolated GJS native smoke tests, allowlisted packaging, install/uninstall and troubleshooting guides.

### Fixed during initial development

- Atomic refusal of capacity reductions that cannot fit pinned history.
- Exact leading-BOM preservation across Node/GJS decoder differences.
- Cross-lifetime save/purge ordering, startup opt-out cleanup, and final snapshots on ordinary disable.
- Startup deletion tombstones and saved-pin priority so hydration does not resurrect deleted clips or silently drop saved pins.

### Verification status

Initial verification passed 25 automated tests, native API/PNG/private-storage smoke tests, schema/source checks, and archive build. Those checks did not install or enable the extension; real desktop clipboard and visual acceptance remain pending. This is not a desktop-tested release.
