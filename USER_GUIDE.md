# Clipboard History user guide

Clipboard History supports **Ubuntu 24.04 / GNOME Shell 46**, with Wayland as the target desktop. Live cross-app clipboard and visual acceptance testing is still pending; automated checks are not a desktop-tested release claim.

## Installation and updates

Run commands from the repository root. Ubuntu's GNOME desktop normally provides the runtime libraries; build tooling is listed in [CONTRIBUTING.md](CONTRIBUTING.md#requirements).

```bash
bash scripts/install.sh
```

The installer runs the build/checks and installs user-session files. It does not enable the extension, change shortcuts, or modify clipboard contents.

If an installation already exists, the script shows its location and refuses to overwrite it. Review the existing installation before deliberately replacing it:

```bash
bash scripts/install.sh --replace
```

On **Wayland**, save work and log out/in so GNOME discovers the extension. Logging out closes applications. Do not use Alt+F2 `r`: Wayland cannot restart GNOME Shell that way.

```bash
gnome-extensions enable clipboard-history@local
gnome-extensions prefs clipboard-history@local
```

Enablement runs code inside GNOME Shell and loads the extension in future user logins. Disabling stops capture; closing only the picker does not. No system service or privileged input helper is installed.

## Using the picker

1. Copy text or a PNG/screenshot in another application.
2. Click the panel clipboard icon or press **Super+Shift+V**, the default shortcut.
3. Search or select an entry. Successful selection restores it to the system clipboard and closes the picker.
4. Paste using the destination app's command: normally **Ctrl+V**, or **Ctrl+Shift+V** in terminals.

There is **no automatic paste, key injection, execution, or appended Enter**.

| Control | Action |
| --- | --- |
| Up / Down | Change the selected search result. |
| Enter | Restore the selected result. |
| Escape | Close the picker. |
| Ctrl+F | Focus search. |
| Tab | Reach row actions and footer controls. |
| Pin / unpin | Protect an entry from automatic eviction, or remove that protection. |
| Delete | Remove only that history entry. |
| Clear all history… | Confirm removal of every entry, including pins. |
| Pause / Resume | Stop or restart capture; paused copies are not imported later. |
| Settings | Open preferences for capture, capacity, shortcut, and persistence. |

The first search result is selected. Exact duplicates move to the newest position while preserving their pin state. Plain-text contents are restored unchanged, including whitespace and Unicode; previews are bounded and literal.

**Deleting history does not clear the current system clipboard.** A previously copied or restored item can still paste after its history row is deleted, clear-all runs, or the extension is disabled. Clear the system clipboard separately if needed.

## Optional Windows-style Super+V

GNOME commonly assigns **Super+V** and **Super+M** to notifications. Check your actual settings before changing anything:

```bash
gsettings get org.gnome.shell.keybindings toggle-message-tray
```

1. Record the existing notification bindings.
2. Explicitly remove only the notification **Super+V** binding, preserving **Super+M** and any custom bindings, through GNOME's keyboard configuration or a reviewed `gsettings set` command.
3. In Clipboard History preferences, set the picker shortcut to `<Super>v` and Apply.

Shortcut preferences use GTK notation; the default is `<Super><Shift>v`. The app does not change GNOME's notification shortcut for you. If bindings conflict, use the panel icon and choose another shortcut. Uninstalling does not undo notification settings you changed yourself.

## Supported content and limits

- Supported: exact plain text and validated PNG. PNG is preferred when offered.
- Unsupported: arbitrary file copy/cut semantics, rich text/HTML formatting, JPEG-only offers, automatic paste, cloud sync, and non-GNOME desktops.
- Mouse-highlight/PRIMARY and drag-and-drop selections are not recorded. File-manager `text/uri-list` offers are skipped rather than imported as files.
- Extremely rapid temporary offers can be superseded before their data is read; this is not a lossless clipboard recorder.

| Limit | Value |
| --- | --- |
| History count | 50 by default; configurable from 5 to 200. |
| Plain text | 128 KiB of UTF-8 bytes per item. |
| PNG encoded size | 2 MiB per item. |
| Total retained payload | 16 MiB. |
| PNG dimensions | At most 4096 on either axis and 4,194,304 pixels. |
| Thumbnail | At most 160 × 96. |
| Clipboard transfer | Size-bounded, with a 2.5-second deadline. |
| Saved snapshot | Bounded 32 MiB reads/writes. |

Total process memory also includes text/base64 encoding, native objects, thumbnails, and transient decoder buffers; the payload cap is not a total process-memory limit.

When limits require eviction, the oldest unpinned entries are removed. **Pins are never silently evicted.** Unpin/delete to make room when pins prevent admission. Capacity reductions that cannot fit current pins are rejected. Pins do not protect against explicit delete/clear-all or make memory-only history durable.

## Privacy, storage, and retention

History may contain **passwords, tokens, and personal data**. Do not intentionally record secrets. Two known KDE password-manager MIME hints are skipped when advertised, but **there is no universal password detection**: a missing hint is not evidence that content is safe.

### Default: session-only

History stays in memory by default. Capture and the picker are unavailable while locked. GNOME normally disables user-session extensions on lock, so session-only history and pins can be discarded. Logout also ends memory-only history.

The existing clipboard is not imported on startup or unlock. Copies made while paused or locked are not retrospectively recorded.

### Optional saved history

Enable **Remember history between sessions** in preferences to save text, PNGs, and pins locally. Storage is **unencrypted**, even though the directory uses permissions `0700` and the file `0600`.

Location, outside the repository:

```text
${XDG_DATA_HOME:-~/.local/share}/clipboard-history/history.json
```

- Saved unpinned entries older than seven days are skipped at startup; pins are retained subject to supported limits.
- Saved history can reload after unlock. During loading, pinning waits briefly; saved pins take priority over new unpinned captures. If a lower configured count cannot fit saved pins, the effective count is raised to preserve them.
- Saves are asynchronous, atomic, and debounced by 250 ms. Ordinary disable queues a final loaded-history snapshot; abrupt logout/crash can still lose unfinished writes. Save/delete ordering is preserved across disable/re-enable.
- Turning persistence off in preferences requests saved-file deletion even while the extension is disabled. Startup with persistence off retries cleanup of any remaining file. Failures are shown in the picker/preferences.
- Corrupt or unreadable saved history produces a generic error and a cleanup request rather than a sensitive debug backup. Symlink storage locations are refused for reads/writes.

Deletion is **not forensic secure erasure**. It does not remove content from backups or the system clipboard. Never attach the saved-history file to a bug report.

## Disable, uninstall, and recovery

```bash
gnome-extensions disable clipboard-history@local
bash scripts/uninstall.sh                  # Keeps saved history and GSettings
bash scripts/uninstall.sh --purge-history  # Also removes the app-managed history file
```

The purge option does not securely erase data or remove backups. GSettings preferences and any notification-shortcut changes are retained.

For an extension error, disable it first. If the panel is unusable, use a terminal or a separate login to run the disable command.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| Extension not found after installation | Log out/in on Wayland; run `gnome-extensions info clipboard-history@local`. |
| Schema error | Rebuild and deliberately reinstall the packaged archive; it includes compiled schemas. |
| No capture | Check enablement, Pause, lock state, supported content/size, and GNOME 46 compatibility. `wl-paste --watch` or xdotool is not a substitute for this integration on GNOME Wayland. |
| Shortcut does not open the picker | Use the panel icon and check for conflicting bindings. |
| History fills up | Unpin/delete an entry; pins can prevent admitting new items. |
| An old clip still pastes after deletion | Expected: history deletion and current-clipboard deletion are separate. |
| Saved-history error | Turn persistence off to request cleanup, or deliberately use the uninstall purge option. Never share the history file. |

Report bugs with the app version, GNOME version, Wayland/X11 session type, non-sensitive reproduction steps, expected/actual behavior, and a sanitized error excerpt. Include theme/display scaling for visual problems.

Shell errors can be inspected with `journalctl --user -b -o cat`. Review output before sharing: other software's logs may contain private information. Never include clipboard history, secrets, or unsanitized logs.

See [README.md](README.md) for quick setup, [CONTRIBUTING.md](CONTRIBUTING.md) for verification, and [CHANGELOG.md](CHANGELOG.md) for version history.
