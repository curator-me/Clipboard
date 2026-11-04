import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

function iconButton(iconName, label, action) {
    const button = new St.Button({style_class: 'clip-icon-button', can_focus: true,
        accessible_name: label, child: new St.Icon({icon_name: iconName, icon_size: 16})});
    button.connect('clicked', action);
    return button;
}

export const Picker = GObject.registerClass(class Picker extends PanelMenu.Button {
    _init(actions) {
        super._init(0.0, 'Clipboard History');
        this._actions = actions;
        this._selected = 0;
        this._rows = [];
        this._results = [];
        this._confirming = false;
        this.add_child(new St.Icon({icon_name: 'edit-paste-symbolic', style_class: 'system-status-icon'}));
        this.menu.actor.add_style_class_name('clip-history-menu');

        const header = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        header.add_child(new St.Label({text: 'Clipboard', style_class: 'clip-title', x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
        this._pause = new St.Button({label: 'Pause', can_focus: true, style_class: 'clip-small-button'});
        this._pause.connect('clicked', () => this._actions.pause());
        header.add_child(this._pause);
        header.add_child(iconButton('emblem-system-symbolic', 'Clipboard settings', () => {
            this.menu.close(); this._actions.preferences();
        }));
        this.menu.addMenuItem(header);

        const searchItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this._search = new St.Entry({hint_text: 'Search clipboard…', style_class: 'clip-search',
            can_focus: true, x_expand: true, accessible_name: 'Search clipboard history'});
        searchItem.add_child(this._search); this.menu.addMenuItem(searchItem);
        this._search.clutter_text.connect('text-changed', () => { this._selected = 0; this.refresh(); });
        this._search.clutter_text.connect('key-press-event', (_actor, event) => {
            const key = event.get_key_symbol();
            if (key === Clutter.KEY_Down || key === Clutter.KEY_Up) {
                if (this._results.length) {
                    this._selected = (this._selected + (key === Clutter.KEY_Down ? 1 : -1) + this._results.length) % this._results.length;
                    this._highlight();
                }
                return Clutter.EVENT_STOP;
            }
            if (key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter) {
                const item = this._results[this._selected];
                if (item && !this._confirming) this._restore(item.id);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this.menu.actor.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_f && (event.get_state() & Clutter.ModifierType.CONTROL_MASK)) {
                this._search.grab_key_focus(); return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        const content = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this._scroll = new St.ScrollView({style_class: 'clip-history-scroll', x_expand: true,
            overlay_scrollbars: true, hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC});
        this._list = new St.BoxLayout({vertical: true, style_class: 'clip-history-list', x_expand: true});
        this._scroll.set_child(this._list);
        content.add_child(this._scroll); this.menu.addMenuItem(content);

        const statusItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this._status = new St.Label({style_class: 'clip-status', x_expand: true});
        this._status.clutter_text.line_wrap = true;
        statusItem.add_child(this._status); this.menu.addMenuItem(statusItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const footer = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this._footer = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'clip-footer'});
        footer.add_child(this._footer); this.menu.addMenuItem(footer);
        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open) {
                this._confirming = false; this._selected = 0;
                this._search.set_text(''); this.refresh(); this._search.grab_key_focus();
            }
        });
    }

    toggle() { this.menu.toggle(); }
    close() { this.menu.close(); }
    _restore(id) { if (this._actions.restore(id)) this.menu.close(); }

    refresh() {
        if (!this.menu.isOpen) return;
        const monitor = Main.layoutManager.findMonitorForActor(this) ?? Main.layoutManager.primaryMonitor;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const width = Math.min(460, Math.max(240, monitor.width / scale - 40));
        this.menu.actor.set_style(`max-width: ${width + 24}px;`);
        this._scroll.set_style(`width: ${width}px; max-height: ${Math.max(100, Math.min(420, monitor.height / scale - 300))}px;`);
        this._pause.set_label(this._actions.isPaused() ? 'Resume' : 'Pause');
        this.accessible_name = this._actions.isPaused() ? 'Clipboard History, capture paused' : 'Clipboard History';
        this._list.destroy_all_children(); this._rows = [];
        this._results = this._actions.search(this._search.get_text());
        if (!this._results.length) {
            const empty = new St.BoxLayout({vertical: true, style_class: 'clip-empty', x_expand: true});
            empty.add_child(new St.Icon({icon_name: 'edit-paste-symbolic', icon_size: 36, style_class: 'clip-muted'}));
            empty.add_child(new St.Label({text: this._search.get_text() ? 'No matching clips' : 'Your clipboard history starts here', style_class: 'clip-empty-title'}));
            const help = new St.Label({text: this._search.get_text() ? 'Try another word or “PNG”.' : 'Copy some text or a PNG image in any app.', style_class: 'clip-muted'});
            help.clutter_text.line_wrap = true; empty.add_child(help); this._list.add_child(empty);
        }
        for (const item of this._results) this._addRow(item);
        this._selected = Math.min(this._selected, Math.max(0, this._results.length - 1));
        this._highlight();
        const message = this._actions.status() || (this._actions.isPaused() ? 'Capture paused. Existing clips can still be restored.' :
            this._actions.isPersistent() ? 'Saved locally, unencrypted. Clipboard history may contain secrets.' : 'Session-only • local and private • may contain secrets');
        this._status.set_text(message);
        this._renderFooter();
    }

    _addRow(item) {
        const row = new St.BoxLayout({style_class: 'clip-entry-row', x_expand: true});
        const select = new St.Button({style_class: 'clip-entry popup-menu-item', x_expand: true, can_focus: true,
            accessible_name: item.kind === 'image' ? 'Restore PNG image to clipboard' : `Restore text: ${item.data.slice(0, 80)}`});
        const body = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'clip-entry-body'});
        if (item.kind === 'image') {
            const thumbnail = this._actions.thumbnail(item);
            if (thumbnail) body.add_child(thumbnail);
            else body.add_child(new St.Icon({icon_name: 'image-x-generic-symbolic', icon_size: 36}));
        } else {
            const preview = new St.Label({text: item.data.slice(0, 360).split(/\r?\n/).slice(0, 3).join('\n'),
                style_class: 'clip-preview', x_expand: true});
            preview.clutter_text.line_wrap = true;
            preview.clutter_text.ellipsize = 3; // Pango.EllipsizeMode.END, without markup.
            body.add_child(preview);
        }
        const metadata = item.kind === 'image' ? `PNG · ${item.width} × ${item.height}` : 'Text';
        body.add_child(new St.Label({text: `${item.pinned ? 'Pinned · ' : ''}${metadata}`, style_class: 'clip-item-meta'}));
        select.set_child(body); select.connect('clicked', () => this._restore(item.id));
        row.add_child(select);
        const tools = new St.BoxLayout({style_class: 'clip-row-tools', y_align: Clutter.ActorAlign.CENTER});
        tools.add_child(iconButton(item.pinned ? 'view-pin-symbolic' : 'list-add-symbolic', item.pinned ? 'Unpin item' : 'Pin item', () => this._actions.pin(item.id)));
        tools.add_child(iconButton('edit-delete-symbolic', 'Delete history item', () => this._actions.remove(item.id)));
        row.add_child(tools); this._list.add_child(row); this._rows.push(select);
    }

    _highlight() {
        this._rows.forEach((row, i) => {
            if (i === this._selected) row.add_style_pseudo_class('selected');
            else row.remove_style_pseudo_class('selected');
        });
        const row = this._rows[this._selected];
        if (!row) return;
        const adjustment = this._scroll.vscroll.adjustment;
        const box = row.get_parent().get_allocation_box();
        if (box.y1 < adjustment.value) adjustment.value = box.y1;
        else if (box.y2 > adjustment.value + adjustment.page_size) adjustment.value = Math.max(0, box.y2 - adjustment.page_size);
    }

    _renderFooter() {
        this._footer.destroy_all_children();
        const help = new St.Label({text: this._confirming ? 'Delete all history, including pinned items?\nThe current system clipboard is not cleared.' :
            'Select a clip, then paste with Ctrl+V.\nTerminals usually use Ctrl+Shift+V.', style_class: 'clip-footer-help'});
        help.clutter_text.line_wrap = true; this._footer.add_child(help);
        const controls = new St.BoxLayout({style_class: 'clip-footer-controls'});
        if (this._confirming) {
            const cancel = new St.Button({label: 'Cancel', can_focus: true, style_class: 'clip-small-button'});
            cancel.connect('clicked', () => { this._confirming = false; this._renderFooter(); });
            const clear = new St.Button({label: 'Delete all history', can_focus: true, style_class: 'clip-small-button clip-destructive'});
            clear.connect('clicked', () => { this._confirming = false; this._actions.clear(); });
            controls.add_child(cancel); controls.add_child(clear);
        } else {
            const clear = new St.Button({label: 'Clear all history…', can_focus: true, style_class: 'clip-small-button', reactive: this._actions.count() > 0});
            clear.connect('clicked', () => { this._confirming = true; this._renderFooter(); });
            controls.add_child(clear);
        }
        this._footer.add_child(controls);
    }
});
