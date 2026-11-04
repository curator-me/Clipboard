// Executes the actual composition root against injected desktop/storage fakes.
// No GNOME process, clipboard, GUI, user settings, or disk history is touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {History} from '../extension/lib/history.js';
import {CaptureController, StorageRegistry} from '../extension/lib/controller.js';

const source = fs.readFileSync(new URL('../extension/extension.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '')
    .replace('export default class ClipboardHistoryExtension', 'globalThis.ExtensionUnderTest = class ClipboardHistoryExtension');
const clone = value => value === null ? null : JSON.parse(JSON.stringify(value));
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

function world() {
    let disk = null; let writeGate = null; let loadGate = null;
    const registry = new StorageRegistry(); const timers = new Map(); let serial = 0;
    const settings = {
        values: {'remember-history': true, 'capture-enabled': true, 'max-entries': 5}, signals: new Map(),
        get_boolean(key) { return this.values[key]; }, get_int(key) { return this.values[key]; },
        set_int(key, value) { this.set(key, value); }, set_boolean(key, value) { this.set(key, value); },
        set(key, value) {
            if (this.values[key] === value) return;
            this.values[key] = value;
            for (const {signal, callback} of [...this.signals.values()]) if (signal === `changed::${key}`) callback();
        },
        connect(signal, callback) { const id = ++serial; this.signals.set(id, {signal, callback}); return id; },
        disconnect(id) { this.signals.delete(id); },
    };
    class FakeStorage {
        constructor(error, canWrite) {
            this.queue = registry.acquire('same-history-file', {
                async write(snapshot) {
                    if (!canWrite()) return;
                    if (writeGate) await writeGate;
                    disk = canWrite() ? clone(snapshot) : null;
                }, async remove() { disk = null; },
            }, error);
        }
        async load() { if (loadGate) await loadGate; return clone(disk); }
        save(snapshot) { return this.queue.save(snapshot); }
        purge() { return this.queue.purge(); }
    }
    class FakeExtension { constructor() { this.uuid = 'test'; } getSettings() { return settings; } openPreferences() {} }
    class FakeProvider { constructor(observe) { this.observe = observe; } cancel() {} prune() {} dispose() {} publish() {} thumbnail() { return null; } }
    class FakePicker { constructor(actions) { this.actions = actions; } refresh() {} close() {} toggle() {} destroy() {} }
    const session = {isLocked: false, isGreeter: false, connect() { return ++serial; }, disconnect() {}};
    const context = vm.createContext({
        Extension: FakeExtension, History, CaptureController, ClipboardProvider: FakeProvider, Picker: FakePicker,
        LocalStorage: FakeStorage, Meta: {KeyBindingFlags: {NONE: 0}, KeyBindingAction: {NONE: 0}}, Shell: {ActionMode: {NORMAL: 1}},
        Main: {sessionMode: session, panel: {addToStatusArea() {}}, wm: {addKeybinding() { return 1; }, removeKeybinding() {}}},
        GLib: {PRIORITY_DEFAULT: 0, SOURCE_REMOVE: false, timeout_add(_priority, _delay, callback) {
            const id = ++serial; timers.set(id, callback); return id;
        }, source_remove(id) { timers.delete(id); }},
    });
    vm.runInContext(source, context);
    return {
        extension: () => new context.ExtensionUnderTest(), settings,
        get disk() { return disk; }, set disk(value) { disk = clone(value); },
        set writeGate(value) { writeGate = value; }, set loadGate(value) { loadGate = value; },
        fireTimers() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback()); },
    };
}

test('pending deletion is flushed before disable and does not resurrect on enable', async () => {
    const w = world(); const e = w.extension(); e.enable(); await tick();
    const id = e._history.addText('saved').item.id; e._changed(); w.fireTimers(); await tick();
    assert.equal(w.disk.items.length, 1);
    e._picker.actions.remove(id); e.disable(); await tick();
    assert.equal(w.disk.items.length, 0);
    e.enable(); await tick(); assert.equal(e._history.size, 0); e.disable();
});

test('cross-lifetime purge waits for old in-flight writes', async () => {
    const w = world(); const e = w.extension(); e.enable(); await tick();
    let finish; w.writeGate = new Promise(resolve => { finish = resolve; });
    e._history.addText('private old clip'); e._changed(); w.fireTimers(); await tick();
    e.disable(); e.enable(); w.settings.set_boolean('remember-history', false);
    finish(); await tick(); assert.equal(w.disk, null); e.disable();
});

test('off-setting made while disabled purges the saved file on startup', async () => {
    const w = world(); const h = new History(); h.addText('saved'); w.disk = h.snapshot();
    w.settings.set_boolean('remember-history', false);
    const e = w.extension(); e.enable(); await tick();
    assert.equal(w.disk, null); assert.equal(e._history.size, 0); e.disable();
});

test('late startup load respects individually deleted clips', async () => {
    const w = world(); const h = new History(); h.addText('A'); w.disk = h.snapshot();
    let finish; w.loadGate = new Promise(resolve => { finish = resolve; });
    const e = w.extension(); e.enable(); await tick();
    const id = e._history.addText('A').item.id; e._changed(); e._picker.actions.remove(id);
    finish(); await tick(); assert.equal(e._history.size, 0);
    w.fireTimers(); await tick(); assert.equal(w.disk.items.length, 0); e.disable();
});

test('saved pins take capacity over live unpinned captures and pinning waits for hydration', async () => {
    const w = world(); const h = new History({maxEntries: 5});
    for (let i = 0; i < 5; i++) h.togglePin(h.addText(`pin-${i}`).item.id);
    w.disk = h.snapshot(); let finish; w.loadGate = new Promise(resolve => { finish = resolve; });
    const e = w.extension(); e.enable(); await tick();
    const live = e._history.addText('live').item; e._changed(); e._picker.actions.pin(live.id);
    assert.equal(e._history.get(live.id).pinned, false);
    finish(); await tick(); assert.equal(e._history.size, 5); assert.ok(e._history.items.every(item => item.pinned));
    w.fireTimers(); await tick(); assert.equal(w.disk.items.filter(item => item.pinned).length, 5); e.disable();
});
