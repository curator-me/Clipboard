# Clipboard History

A native clipboard history picker for **Ubuntu 24.04 / GNOME Shell 46**, designed for Wayland.
Copy several items, choose an older one, then paste it into your destination app.

**Version 0.1.2** — initial implementation; live clipboard and visual acceptance testing is still pending.

## Features

- Plain-text and PNG history with readable previews and image thumbnails.
- Search, keyboard navigation, pin/unpin, individual deletion, and confirmed clear-all.
- Native panel popup; **Super+Shift+V** opens it by default.
- Pause/resume capture and configurable history size (50 entries by default).
- Local, session-only storage by default; no cloud service, telemetry, or network access.

## Install

Run from the repository root on Ubuntu's GNOME desktop. Building requires **Node.js 20+**, zip/unzip, and glib-compile-schemas; Node is not a runtime dependency.

```bash
bash scripts/install.sh
```

The script builds/checks and installs files, but does not enable the extension or change shortcuts. It refuses to replace an existing installation; see the [user guide](USER_GUIDE.md#installation-and-updates) for updates.

On **Wayland**, save your work and **log out/in** so GNOME discovers the extension. Then:

```bash
gnome-extensions enable clipboard-history@local
gnome-extensions prefs clipboard-history@local
```

Enablement runs the extension inside GNOME Shell. See [CONTRIBUTING.md](CONTRIBUTING.md) to build/test without installing.

## Use

1. Copy text or a PNG/screenshot in another app.
2. Click the clipboard panel icon or press **Super+Shift+V**.
3. Search or use Up/Down, then click an entry or press Enter to restore it.
4. Paste in the destination app with **Ctrl+V** (usually **Ctrl+Shift+V** in terminals).

**Selection restores the clipboard; it does not automatically paste.** Row controls pin/delete entries; clear-all asks for confirmation and includes pins. Escape closes the picker.

Prefer Windows-style **Super+V**? Follow the [shortcut guide](USER_GUIDE.md#optional-windows-style-superv) to resolve GNOME's notification binding first.

## Privacy and limitations

- Clipboard history can contain secrets; **there is no universal password detection**.
- History is memory-only by default and can be lost on lock/logout. Optional saved history is **unencrypted**.
- Deleting history does **not** clear the current system clipboard or securely erase backups.

Only plain text and PNG are supported. No arbitrary file copies, rich text/HTML, JPEG-only offers, automatic paste, or non-GNOME support. See the [user guide](USER_GUIDE.md#supported-content-and-limits) for limits and retention behavior.

## More information

- [User guide](USER_GUIDE.md) — shortcuts, privacy, storage, troubleshooting, and uninstall.
- [Contributing](CONTRIBUTING.md) — build/tests, desktop acceptance, and branch workflow.
- [Changelog](CHANGELOG.md) — version history.
