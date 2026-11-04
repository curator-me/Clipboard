# Clipboard History

A native clipboard history picker for **Ubuntu 24.04 / GNOME Shell 46**, designed for the Wayland desktop. Version **0.1.1** (initial implementation; live desktop acceptance is still pending).

Copy several things, open the picker, and choose an older clip. The app restores that clip to your system clipboard; **paste with Ctrl+V** in the destination app (usually **Ctrl+Shift+V** in terminals).

## Features

- Background plain-text and PNG history, newest first.
- Clean native panel popup with search, readable previews, image thumbnails, and keyboard selection.
- Pin/unpin, delete individual entries, and confirmed clear-all—including pins.
- **Super+Shift+V** opens the picker without replacing GNOME's existing Super+V notification shortcut.
- Pause/resume capture; no mouse-highlight/PRIMARY history or catch-up of paused copies.
- Local and session-only by default; optional unencrypted private local persistence.
- Bounded count, payload bytes, PNG dimensions, transfer size/time, and thumbnail size.
- No npm runtime dependencies, cloud service, telemetry, input daemon, or network access.

### What is not supported

Automatic paste/input injection, arbitrary file copies, rich-text/HTML formatting, JPEG-only offers, cloud sync, and non-GNOME desktops are not supported in 0.1.1. Selecting a clip is **clipboard restoration**, not an automatic paste. Extremely rapid temporary clipboard offers can be superseded before their data is read; this is not a lossless clipboard recorder.

## Build and checks

Runtime dependencies are GNOME Shell/GJS, St/Meta/Clutter, Gio/GLib, GdkPixbuf, GTK4, and libadwaita, normally provided by Ubuntu's GNOME desktop. Node.js 20+ is **development tooling only**; zip/unzip and glib-compile-schemas are used to package the extension.

```bash
npm test                         # Portable history/capture/storage-order tests
bash scripts/test-gjs.sh          # Native APIs/PNG/private storage, in a temporary XDG directory
npm run check                    # Syntax, metadata, schemas, Node tests, native smoke
npm run build                    # Check and create extension archive; does not install
```

Output: `dist/clipboard-history-0.1.1.shell-extension.zip`.

The native smoke test does not touch your actual clipboard, launch a UI, install, or enable the extension. Pure/source/native checks do **not** certify live background capture or UI appearance.

## Install

Installation changes user-session files. Enablement runs code inside GNOME Shell. Build/test scripts never perform either operation automatically.

```bash
bash scripts/install.sh
```

If an installation already exists, the script refuses to overwrite it. Review it, then use `bash scripts/install.sh --replace` only when replacing it is intended.

On **Wayland**, save work and log out/in so GNOME discovers the extension. Do not use Alt+F2 `r`; Wayland cannot restart Shell that way. Then:

```bash
gnome-extensions enable clipboard-history@local
gnome-extensions prefs clipboard-history@local
```

Once enabled, GNOME loads it in your user session, including future logins. Disabling the extension stops capture. Closing only the picker does not stop capture.

## Use

1. Copy some text or a PNG/screenshot in another app.
2. Click the clipboard panel icon or press **Super+Shift+V**.
3. Search if needed. The first result is selected; Up/Down changes selection, Enter restores, Escape closes, and Ctrl+F focuses search. Tab reaches row actions and footer controls.
4. Paste in your destination app using its paste command.
5. Use each row's pin/delete controls, Pause/Resume, or **Clear all history…**.

Clear-all asks for confirmation and removes pins too. Deleting history does **not** clear the current system clipboard; a previously restored item may still paste. Clear the destination/system clipboard separately if needed.

### Optional Windows-style Super+V

GNOME commonly assigns Super+V and Super+M to the notification tray. If you want Super+V for clipboard history, check your actual bindings first:

1. Record the current notification binding with `gsettings get org.gnome.shell.keybindings toggle-message-tray`.
2. Explicitly remove only its Super+V binding, preserving Super+M and any custom bindings, using GNOME's keyboard configuration or a reviewed `gsettings set` command.
3. In Clipboard History preferences, set the picker shortcut to `<Super>v` and Apply.

The app does not modify the notification shortcut for you. If a shortcut conflicts, use the panel icon and choose another shortcut.

## Privacy and limits

Clipboard history may contain **passwords, tokens, and personal data**. There is no universal password detection. Two known KDE password-manager MIME hints are skipped when advertised; absence of a hint does not imply safety. Do not record secrets intentionally.

- **Default:** memory-only, 50 entries, configurable 5–200. Pins protect eviction, not durability or explicit deletion.
- **Limits:** text 128 KiB; PNG 2 MiB; retained payload total 16 MiB; PNG at most 4096 per dimension and 4,194,304 pixels; thumbnails at most 160 × 96. Total process memory also includes string encoding, native objects, and transient decoder buffers.
- **Full/pinned:** unpin/delete an item to make room; pins are never silently evicted. Capacity reductions that cannot fit pins are rejected.
- **Lock:** picker/capture are unavailable. GNOME normally disables user-session extensions on lock; session-only history can be discarded. Opt-in saved history can be reloaded on unlock, but the current paused/locked clipboard is not imported.
- **Optional saved history:** enable “Remember history between sessions” in preferences. Includes text, PNGs, and pins; unpinned entries older than seven days are skipped at startup. Directory permissions 0700, file 0600, atomic writes, bounded 32 MiB snapshot reads. Storage is **not encrypted**.
- **Location:** `${XDG_DATA_HOME:-~/.local/share}/clipboard-history/history.json`, outside this repository.
- Saves are debounced by 250 ms. Ordinary disable queues a final hydrated snapshot before clearing memory; abrupt logout/crash can still lose uncompleted writes. Save/purge ordering survives disable/re-enable. Turning persistence off in preferences also requests deletion while the extension is disabled; startup with persistence off purges any remaining file. Errors are shown in the picker/preferences.
- During saved-history startup, pinning waits briefly for hydration. Saved pins take retention priority over new unpinned captures; if a lower configured count cannot fit saved pins, the effective count is raised to preserve them.
- Deletion is not forensic secure erasure and does not remove copies in backups or the system clipboard.

## Disable / uninstall / recovery

```bash
gnome-extensions disable clipboard-history@local
bash scripts/uninstall.sh                     # Retains any saved history and GSettings
bash scripts/uninstall.sh --purge-history     # Also removes the app-managed history file
```

For an extension error, disable it first. If the panel is unusable, run the disable command from a terminal or a separate login. No system service or privileged input helper is installed.

Common issues:

- **Not found after install:** log out/in on Wayland; check `gnome-extensions info clipboard-history@local`.
- **Schema error:** rebuild/reinstall the packaged archive; it includes compiled schemas.
- **No capture:** check enablement, Pause, lock state, supported MIME/size, and GNOME 46 compatibility. Do not substitute `wl-paste --watch` or xdotool on GNOME Wayland.
- **Old clip still pastes after deletion:** expected—history deletion and current clipboard deletion are separate.
- **Saved history error:** turn persistence off to request a purge, or use the explicit uninstall purge command. Never attach the history file to a bug report.

Report bugs with the app version, GNOME version, Wayland/X11 session type, non-sensitive reproduction steps, expected/actual behavior, and a sanitized error excerpt. Never attach clipboard history or secrets. Inspect Shell errors with `journalctl --user -b -o cat`, but review output before sharing; other software's logs may contain private information.

## Development workflow

- `main`: publishable baseline and reviewed changes.
- `dev`: ongoing development and testing, initially at the same clean commit as `main`.
- Commit normal work on `dev`. Before promoting it, run `npm run check` and `npm run build`, review the diff, and perform the applicable live desktop tests.
- Merge tested changes into `main`. Keep source, tests, build scripts, README, and [changelog](CHANGELOG.md) in both branches.
- `docs/` holds local planning, design, research, and work-log notes. It is deliberately ignored on both branches and is not included in their starting history. Generated `dist/`, dependencies, runtime data, secrets, and local editor/agent settings also stay out of Git.
- A development branch is not a privacy boundary: everything committed to a branch is uploaded when that branch is pushed, including its ancestors. Do not force-add private notes.
- The original development snapshot is preserved in the local-only ref `refs/local-backups/initial-with-development-notes`. Do not use `git push --mirror`, which can publish private backup refs.

```bash
git switch dev
# Make changes, run checks, and commit intentionally.
git switch main
git merge --ff-only dev
# Push only when publication is intended.
```

If `main` and `dev` diverge, review and reconcile them rather than forcing branch history. Branch names do not make code desktop-verified: the live clipboard/UI acceptance gate still applies.

GNOME's integer extension revision is `2`; the human SemVer is `0.1.1` in package metadata and `version-name`. Commit and push operations are never performed by the build/install scripts.
