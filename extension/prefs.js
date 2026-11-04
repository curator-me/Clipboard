import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {LocalStorage} from './lib/storage.js';

export default class ClipboardPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(620, 620);
        const page = new Adw.PreferencesPage({title: 'Clipboard', icon_name: 'edit-paste-symbolic'});
        window.add(page);

        const capture = new Adw.PreferencesGroup({title: 'History', description: 'Only normal clipboard copies are captured. Mouse-highlight selections are ignored.'});
        page.add(capture);
        const enabled = new Adw.ActionRow({title: 'Capture clipboard changes', subtitle: 'Pause at any time from the panel picker.'});
        const enabledSwitch = new Gtk.Switch({valign: Gtk.Align.CENTER});
        enabled.add_suffix(enabledSwitch); enabled.activatable_widget = enabledSwitch;
        settings.bind('capture-enabled', enabledSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        capture.add(enabled);

        const limit = new Adw.ActionRow({title: 'History capacity', subtitle: 'Oldest unpinned entries are removed first. Pins still count toward the limit.'});
        const spin = Gtk.SpinButton.new_with_range(5, 200, 5);
        spin.set_valign(Gtk.Align.CENTER); spin.set_value(settings.get_int('max-entries'));
        spin.connect('value-changed', () => settings.set_int('max-entries', spin.get_value_as_int()));
        limit.add_suffix(spin); capture.add(limit);

        const shortcuts = new Adw.PreferencesGroup({title: 'Keyboard shortcut', description: 'GNOME already uses Super+V for notifications. The safe default is Super+Shift+V.'});
        page.add(shortcuts);
        const shortcut = new Adw.ActionRow({title: 'Open the picker', subtitle: 'Enter GTK notation, for example <Super><Shift>v. Empty disables the shortcut.'});
        const input = new Gtk.Entry({text: settings.get_strv('clipboard-history-toggle')[0] ?? '', width_chars: 20, valign: Gtk.Align.CENTER});
        const apply = new Gtk.Button({label: 'Apply', valign: Gtk.Align.CENTER});
        shortcut.add_suffix(input); shortcut.add_suffix(apply); shortcuts.add(shortcut);
        apply.connect('clicked', () => {
            const value = input.get_text().trim();
            if (!value) {
                settings.set_strv('clipboard-history-toggle', []); input.remove_css_class('error'); return;
            }
            const [valid, key, modifiers] = Gtk.accelerator_parse(value);
            if (!valid || !Gtk.accelerator_valid(key, modifiers) || !modifiers) {
                input.add_css_class('error');
                shortcut.set_subtitle('Invalid shortcut. Include a modifier such as Super, Ctrl, or Alt.');
                return;
            }
            settings.set_strv('clipboard-history-toggle', [Gtk.accelerator_name(key, modifiers)]);
            input.remove_css_class('error');
            shortcut.set_subtitle('Saved. Conflicting shortcuts may remain unavailable; the panel icon always works.');
        });

        const privacy = new Adw.PreferencesGroup({title: 'Privacy', description: 'Clipboard history may contain passwords and tokens. Everything stays on this device; there is no telemetry or cloud sync.'});
        page.add(privacy);
        const persistence = new Adw.ActionRow({title: 'Remember history between sessions', subtitle: 'Off by default. Saves an UNENCRYPTED private local file, including pins and PNGs. Turning this off deletes the saved file.'});
        const rememberSwitch = new Gtk.Switch({valign: Gtk.Align.CENTER});
        persistence.add_suffix(rememberSwitch); persistence.activatable_widget = rememberSwitch;
        settings.bind('remember-history', rememberSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        let closed = false;
        const storage = new LocalStorage(() => {
            if (!closed) window.add_toast(new Adw.Toast({title: 'Saved history could not be deleted. Use the explicit purge command.'}));
        }, () => settings.get_boolean('remember-history'));
        const persistenceSignal = settings.connect('changed::remember-history', () => {
            // Preferences run even when the Shell extension is disabled.
            if (!settings.get_boolean('remember-history')) storage.purge();
        });
        window.connect('close-request', () => {
            closed = true; settings.disconnect(persistenceSignal); return false;
        });
        privacy.add(persistence);
        privacy.add(new Adw.ActionRow({title: 'Session-only by default', subtitle: 'Without saved history, disabling the extension or logging out discards clips and pins. Locking may suspend the extension and discard session history.'}));
        privacy.add(new Adw.ActionRow({title: 'Limits and supported content', subtitle: '50 entries by default; 128 KiB text, 2 MiB PNG, 16 MiB retained payloads. PNG dimensions and decoded pixels are limited. Files and rich text are not supported.'}));
        privacy.add(new Adw.ActionRow({title: 'Deletion is not secure erasure', subtitle: 'Clear-all includes pins but does not clear the current system clipboard. Unpinned saved entries older than 7 days are skipped at startup. No universal password detection is possible.'}));
        window.add_toast(new Adw.Toast({title: `Clipboard History ${this.metadata['version-name']}`}));
    }
}
