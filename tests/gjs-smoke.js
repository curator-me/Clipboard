// Native smoke test only. No Shell activation, GUI launch, or system clipboard use.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import Meta from 'gi://Meta';
import St from 'gi://St';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw';
import {History, encodeBase64, decodeBase64} from '../extension/lib/history.js';
import {decodePng, ClipboardProvider} from '../extension/lib/clipboard.js';
import {LocalStorage} from '../extension/lib/storage.js';

function assert(condition, message) { if (!condition) throw new Error(message); }
const directory = GLib.getenv('CLIPBOARD_TEST_DIR');
assert(directory && GLib.get_user_data_dir() === directory && directory.startsWith('/tmp/clipboard-test.'),
    'Refusing storage tests outside a dedicated temporary XDG directory');

const loop = GLib.MainLoop.new(null, false);
let failed = false;
async function run() {
    const history = new History();
    history.addText('Exact \t😀\r\n text');
    assert(history.items[0].data === 'Exact \t😀\r\n text', 'GJS text preservation');
    // Exercise adapter read against an injected in-memory offer, never Shell.
    const exact = '﻿  😀\r\n\ttext\0';
    const fake = Object.create(ClipboardProvider.prototype);
    fake._owner = {get_mimetypes: () => ['text/plain; charset="UTF-8"']};
    fake._transfer = async () => new TextEncoder().encode(exact);
    assert((await fake.read(() => true)).data === exact, 'Adapter preserves BOM, Unicode, whitespace and plain-text NUL');
    fake._owner = {get_mimetypes: () => ['UTF8_STRING']};
    assert((await fake.read(() => true)).data === exact.slice(0, -1), 'X11 terminal NUL handled');
    fake._owner = {get_mimetypes: () => ['text/plain', 'x-kde-passwordManagerHint']};
    assert(await fake.read(() => true) === null, 'Sensitive offer skipped');
    const pixbuf = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, 8, 4);
    pixbuf.fill(0x336699ff);
    const [ok, png] = pixbuf.save_to_bufferv('png', [], []);
    assert(ok, 'Create safe test PNG');
    const thumbnail = decodePng(png);
    assert(thumbnail.get_width() === 8 && thumbnail.get_height() === 4, 'Native PNG decode');
    assert(history.addImage(png).ok, 'GJS PNG history');
    assert(encodeBase64(decodeBase64(encodeBase64(png))) === encodeBase64(png), 'GJS base64 round-trip');
    let rejected = false;
    try { decodePng(png.slice(0, 33)); } catch { rejected = true; }
    assert(rejected, 'Malformed PNG rejected by native decoder');

    const source = Meta.SelectionSourceMemory.new('image/png', new GLib.Bytes(png));
    assert(source.get_mimetypes()[0] === 'image/png', 'Memory source exact MIME');
    assert(Meta.SelectionType.SELECTION_CLIPBOARD === 1, 'GNOME46 clipboard enum');
    assert(typeof St.ScrollView.prototype.set_child === 'function', 'ScrollView child API');
    assert(typeof St.ScrollView.prototype.get_vadjustment === 'function', 'ScrollView adjustment API');
    const [valid, key, modifiers] = Gtk.accelerator_parse('<Super><Shift>v');
    assert(valid && Gtk.accelerator_valid(key, modifiers), 'GTK shortcut notation');
    assert(typeof Adw.PreferencesWindow.prototype.add_toast === 'function', 'Adwaita preference API');

    const errors = [];
    const storage = new LocalStorage(() => errors.push('Storage failed'));
    assert(await storage.load() === null, 'Missing storage is empty');
    await storage.save(history.snapshot());
    assert(errors.length === 0, 'Native atomic storage write');
    const nextLifetime = new LocalStorage(() => errors.push('Storage failed'));
    assert(nextLifetime.queue === storage.queue, 'Storage ordering authority survives a new instance');
    const fileInfo = storage.file.query_info('unix::mode', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    const dirInfo = storage.directory.query_info('unix::mode', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    assert((fileInfo.get_attribute_uint32('unix::mode') & 0o777) === 0o600, 'History file private');
    assert((dirInfo.get_attribute_uint32('unix::mode') & 0o777) === 0o700, 'History directory private');
    const restored = new History(); restored.restore(await storage.load());
    assert(restored.size === 2 && restored.items[1].data === history.items[1].data, 'Native storage round-trip');
    await storage.purge(); assert(await storage.load() === null, 'Native storage purge');
    const other = storage.directory.get_child('disposable-target');
    other.replace_contents(new TextEncoder().encode('{}'), null, false, Gio.FileCreateFlags.PRIVATE, null);
    storage.file.make_symbolic_link(other.get_path(), null);
    rejected = false; try { await storage.load(); } catch { rejected = true; }
    assert(rejected, 'Symlinked history refused');
    await storage.save(history.snapshot()); assert(errors.length === 1, 'Unsafe write reports generic error');
    await storage.purge(); assert(other.query_exists(null), 'Purge removes link, not target');
    print('GJS smoke passed: model, PNG decoder, MIME source, installed APIs, private atomic storage, purge, symlink refusal.');
    print('No real clipboard capture, GUI, extension installation, or enablement was performed.');
}
run().catch(error => { failed = true; printerr(`GJS smoke failed: ${error.message}`); }).finally(() => loop.quit());
loop.run();
if (failed) imports.system.exit(1);
