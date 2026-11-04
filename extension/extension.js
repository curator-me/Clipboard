import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {History} from './lib/history.js';
import {CaptureController} from './lib/controller.js';
import {ClipboardProvider} from './lib/clipboard.js';
import {Picker} from './lib/picker.js';
import {LocalStorage} from './lib/storage.js';

export default class ClipboardHistoryExtension extends Extension {
    enable() {
        this._enabled = true;
        this._status = '';
        this._saveTimer = 0;
        this._loadGeneration = (this._loadGeneration ?? 0) + 1;
        this._hydrated = false;
        this._deletedDuringLoad = [];
        this._saveBlocked = false;
        this._settingsSignals = [];
        try {
            this._settings = this.getSettings();
            this._history = new History({maxEntries: this._settings.get_int('max-entries')});
            const settings = this._settings;
            const storage = new LocalStorage(() => {
                if (this._enabled && this._storage === storage)
                    this._setStatus('Saved history could not be written or deleted. An old file may remain.');
            }, () => settings.get_boolean('remember-history'));
            this._storage = storage;
            this._provider = new ClipboardProvider(offer => {
                if (!this._enabled) return;
                this._controller?.setLocked(Main.sessionMode.isLocked || Main.sessionMode.isGreeter);
                this._controller?.observe(offer);
            });
            this._controller = new CaptureController({history: this._history, provider: this._provider,
                changed: () => this._changed(), status: message => this._setStatus(message)});
            this._controller.setPaused(!this._settings.get_boolean('capture-enabled'));
            this._controller.setLocked(Main.sessionMode.isLocked || Main.sessionMode.isGreeter);
            this._picker = new Picker({
                search: query => this._history.search(query), count: () => this._history.size,
                status: () => this._saveBlocked ? 'Saved pins exceed available space. Saved history will not be overwritten; clear history to reset.' : this._status,
                isPaused: () => !this._settings.get_boolean('capture-enabled'),
                isPersistent: () => this._settings.get_boolean('remember-history'),
                thumbnail: item => this._provider.thumbnail(item),
                restore: id => {
                    this._controller.setLocked(Main.sessionMode.isLocked || Main.sessionMode.isGreeter);
                    return this._controller.restore(id);
                },
                pin: id => {
                    if (!this._hydrated) { this._setStatus('Saved history is loading. Please try pinning again in a moment.'); return; }
                    this._history.togglePin(id); this._changed();
                },
                remove: id => {
                    const item = this._history.get(id);
                    if (item && !this._hydrated) this._deletedDuringLoad.push({kind: item.kind, data: item.data});
                    this._history.remove(id); this._changed();
                },
                clear: () => {
                    ++this._loadGeneration;
                    this._hydrated = true;
                    this._saveBlocked = false;
                    this._deletedDuringLoad = [];
                    this._cancelSave();
                    this._controller.clear();
                    if (this._settings.get_boolean('remember-history')) this._storage.purge();
                },
                pause: () => this._settings.set_boolean('capture-enabled', !this._settings.get_boolean('capture-enabled')),
                preferences: () => this.openPreferences(),
            });
            Main.panel.addToStatusArea(this.uuid, this._picker);
            this._registerShortcut();
            for (const key of ['capture-enabled', 'max-entries', 'remember-history', 'clipboard-history-toggle']) {
                this._settingsSignals.push(this._settings.connect(`changed::${key}`, () => this._settingChanged(key)));
            }
            this._sessionSignal = Main.sessionMode.connect('updated', () => {
                const locked = Main.sessionMode.isLocked || Main.sessionMode.isGreeter;
                this._controller.setLocked(locked);
                if (locked) this._picker.close();
            });
            this._loadSavedHistory();
        } catch (error) {
            this.disable();
            // Never log clipboard payloads or stringify platform errors.
            throw new Error('Clipboard History could not initialize. Check GNOME 46 compatibility and schemas.');
        }
    }

    _registerShortcut() {
        if (this._bindingRegistered) Main.wm.removeKeybinding('clipboard-history-toggle');
        this._bindingRegistered = false;
        try {
            const action = Main.wm.addKeybinding('clipboard-history-toggle', this._settings, Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL, () => {
                    if (this._enabled && !Main.sessionMode.isLocked && !Main.sessionMode.isGreeter) this._picker.toggle();
                });
            this._bindingRegistered = true;
            if (action === Meta.KeyBindingAction.NONE) this._setStatus('Shortcut unavailable. Use the panel icon or choose another shortcut.');
        } catch {
            this._setStatus('Shortcut unavailable. Use the panel icon or choose another shortcut.');
        }
    }

    _settingChanged(key) {
        if (!this._enabled) return;
        if (key === 'capture-enabled') this._controller.setPaused(!this._settings.get_boolean(key));
        if (key === 'clipboard-history-toggle') this._registerShortcut();
        if (key === 'max-entries') {
            if (!this._history.setMaxEntries(this._settings.get_int(key))) {
                this._settings.set_int(key, this._history.maxEntries);
                this._setStatus('Unpin items before lowering the history capacity.');
            }
            this._changed();
        }
        if (key === 'remember-history') {
            ++this._loadGeneration;
            this._cancelSave();
            if (this._settings.get_boolean(key)) {
                // Enabling stores current history, not a stale old disk snapshot.
                this._hydrated = true; this._storage.save(this._history.snapshot());
            } else {
                this._hydrated = true; this._storage.purge();
            }
        }
        this._picker.refresh();
    }

    async _loadSavedHistory() {
        if (!this._settings.get_boolean('remember-history')) {
            this._hydrated = true;
            this._storage.purge(); // Also handles opt-out while the extension was disabled.
            return;
        }
        const generation = ++this._loadGeneration;
        try {
            await this._storage.queue.settled;
            if (!this._enabled || generation !== this._loadGeneration) return;
            const snapshot = await this._storage.load();
            if (!this._enabled || generation !== this._loadGeneration) return;
            if (snapshot) {
                const result = this._history.merge(snapshot, this._deletedDuringLoad);
                this._deletedDuringLoad = [];
                this._saveBlocked = Boolean(result.pinsSkipped);
                if (this._history.maxEntries !== this._settings.get_int('max-entries'))
                    this._settings.set_int('max-entries', this._history.maxEntries);
                // Persisted image headers alone aren't a decoder validation.
                for (const item of this._history.items) {
                    if (item.kind === 'image' && !this._provider.thumbnail(item)) {
                        this._history.remove(item.id); result.skipped++;
                    }
                }
                if (result.skipped) this._setStatus('Some saved clips were expired, invalid, or beyond history limits.');
            }
        } catch {
            if (this._enabled && generation === this._loadGeneration) {
                this._setStatus('Saved history was invalid or unreadable. It was not loaded.');
                this._storage.purge();
            }
        }
        if (this._enabled && generation === this._loadGeneration) {
            this._hydrated = true; this._changed();
        }
    }

    _setStatus(message) { this._status = message; this._picker?.refresh(); }
    _changed() {
        if (!this._enabled) return;
        this._provider.prune(this._history.items);
        this._picker?.refresh();
        this._cancelSave();
        if (this._hydrated && !this._saveBlocked && this._settings.get_boolean('remember-history')) {
            this._saveTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
                this._saveTimer = 0;
                if (this._enabled && this._settings.get_boolean('remember-history')) this._storage.save(this._history.snapshot());
                return GLib.SOURCE_REMOVE;
            });
        }
    }
    _cancelSave() {
        if (this._saveTimer) GLib.source_remove(this._saveTimer);
        this._saveTimer = 0;
    }

    disable() {
        this._enabled = false; ++this._loadGeneration;
        // Queue a final hydrated snapshot before clearing memory, never await in Shell.
        if (this._hydrated && !this._saveBlocked && this._settings?.get_boolean('remember-history'))
            this._storage?.save(this._history.snapshot());
        this._cancelSave();
        this._controller?.dispose();
        if (this._sessionSignal) Main.sessionMode.disconnect(this._sessionSignal);
        this._sessionSignal = 0;
        for (const signal of this._settingsSignals ?? []) this._settings?.disconnect(signal);
        this._settingsSignals = [];
        if (this._bindingRegistered) Main.wm.removeKeybinding('clipboard-history-toggle');
        this._bindingRegistered = false;
        this._provider?.dispose(); this._picker?.destroy(); this._history?.clear();
        this._controller = null; this._provider = null; this._picker = null;
        this._history = null; this._settings = null; this._storage = null;
    }
}
