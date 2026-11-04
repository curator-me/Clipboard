import test from 'node:test';
import assert from 'node:assert/strict';
import {History, LIMITS, encodeBase64, decodeBase64, decodeTextBytes, pngDimensions} from '../extension/lib/history.js';

const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64'));
const clock = () => 1_800_000_000_000;

test('UTF-8 decoding preserves repeated BOMs, Unicode, whitespace and NUL', () => {
    for (const text of ['﻿abc', '﻿﻿  😀\r\n\0', 'abc', ''])
        assert.equal(decodeTextBytes(new TextEncoder().encode(text)), text);
    assert.throws(() => decodeTextBytes(Uint8Array.from([0xff, 0xfe])));
});

test('preserves text exactly and keeps newest first', () => {
    const h = new History();
    h.addText('alpha'); h.addText(' beta\r\n\t😀漢字 ');
    assert.deepEqual(h.items.map(i => i.data), [' beta\r\n\t😀漢字 ', 'alpha']);
    assert.equal(h.addText('').reason, 'empty');
    assert.equal(h.addText('   ').ok, true);
});

test('exact duplicates move to front and retain identity and pin', () => {
    const h = new History();
    const a = h.addText('alpha').item;
    h.togglePin(a.id); h.addText('beta');
    const repeat = h.addText('alpha');
    assert.equal(h.size, 2); assert.equal(repeat.duplicate, true);
    assert.equal(h.items[0].id, a.id); assert.equal(h.items[0].pinned, true);
    h.addText('Alpha'); assert.equal(h.size, 3);
});

test('oldest unpinned entries are evicted and all-pinned rejection is atomic', () => {
    const h = new History({maxEntries: 2});
    const a = h.addText('a').item; h.togglePin(a.id);
    h.addText('b'); const c = h.addText('c').item;
    assert.deepEqual(h.items.map(i => i.data), ['c', 'a']);
    h.togglePin(c.id); const before = h.snapshot();
    assert.equal(h.addText('d').reason, 'full');
    assert.deepEqual(h.snapshot(), before);
});

test('payload budget and UTF-8 text limit are enforced without data loss', () => {
    const h = new History({totalBytes: 6});
    const a = h.addText('abc').item; h.togglePin(a.id);
    h.addText('xy'); const before = h.snapshot();
    assert.equal(h.addText('abcd').reason, 'full');
    assert.deepEqual(h.snapshot(), before);
    assert.equal(new History().addText('😀'.repeat(LIMITS.textBytes / 3)).reason, 'oversized');
});

test('delete and clear remove pins too and getters cannot mutate store', () => {
    const h = new History(); const a = h.addText('a').item;
    h.togglePin(a.id); h.items[0].data = 'mutated';
    assert.equal(h.get(a.id).data, 'a');
    assert.equal(h.remove('unknown'), false); assert.equal(h.remove(a.id), true);
    const b = h.addText('b').item; h.togglePin(b.id); h.clear();
    assert.equal(h.size, 0); assert.equal(h.bytes, 0);
});

test('case-insensitive search never changes original payload', () => {
    const h = new History(); h.addText('Hello 漢字'); h.addText('other'); h.addImage(png);
    assert.equal(h.search(' HELLO ')[0].data, 'Hello 漢字');
    assert.equal(h.search('漢字').length, 1); assert.equal(h.search('PNG')[0].kind, 'image');
    assert.equal(h.search('missing').length, 0);
});

test('lowering capacity refuses impossible pinned limits without mutation', () => {
    const h = new History({maxEntries: 3});
    for (const text of ['a', 'b']) h.togglePin(h.addText(text).item.id);
    h.addText('c'); const before = h.snapshot();
    assert.equal(h.setMaxEntries(1), false);
    assert.equal(h.maxEntries, 3); assert.deepEqual(h.snapshot(), before);
    assert.equal(h.setMaxEntries(2), true); assert.equal(h.size, 2);
    assert.ok(h.items.every(i => i.pinned));
});

test('PNG/base64 round trips exactly and rejects excessive dimensions', () => {
    assert.deepEqual(decodeBase64(encodeBase64(png)), png);
    assert.deepEqual(pngDimensions(png), {width: 1, height: 1});
    const h = new History(); assert.equal(h.addImage(png).ok, true);
    assert.equal(h.addImage(png).duplicate, true); assert.equal(h.size, 1);
    const huge = new Uint8Array(png); new DataView(huge.buffer).setUint32(16, 99999);
    assert.equal(h.addImage(huge).reason, 'unsupported-image');
    for (const bad of ['a', '!!!!', 'ab==', 'a===']) assert.throws(() => decodeBase64(bad));
    for (let length = 0; length < 40; length++) {
        const bytes = Uint8Array.from({length}, (_, i) => (i * 37) % 256);
        assert.deepEqual(decodeBase64(encodeBase64(bytes)), bytes);
    }
});

test('snapshots restore exact data, recency, images and pins without clipboard effects', () => {
    const h = new History({now: clock}); h.addText('old'); h.addImage(png);
    h.togglePin(h.items[1].id); h.addText('new');
    const restored = new History({now: clock});
    assert.deepEqual(restored.restore(JSON.parse(JSON.stringify(h.snapshot()))), {loaded: 3, skipped: 0});
    assert.deepEqual(restored.snapshot(), h.snapshot());
    assert.equal(restored.addText('next').ok, true);
    assert.equal(new Set(restored.items.map(i => i.id)).size, 4);
});

test('late snapshot merge preserves live clips and IDs, and never exceeds capacity', () => {
    const saved = new History({now: clock}); saved.addText('saved');
    const duplicate = saved.addText('live').item; saved.togglePin(duplicate.id);
    const live = new History({maxEntries: 2, now: clock}); const id = live.addText('live').item.id;
    assert.deepEqual(live.merge(saved.snapshot()), {loaded: 1, skipped: 0});
    assert.deepEqual(live.items.map(i => i.data), ['live', 'saved']);
    assert.equal(live.items[0].id, id); assert.equal(live.items[0].pinned, true);
    saved.addText('too many'); live.merge(saved.snapshot()); assert.equal(live.size, 2);
});

test('snapshot validation skips expired/malformed entries and rejects bad envelopes atomically', () => {
    const h = new History({now: clock}); h.addText('existing');
    assert.throws(() => h.restore({version: 99, items: []})); assert.equal(h.size, 1);
    const old = clock() - LIMITS.retentionMs - 1;
    const snapshot = {version: 1, items: [
        {kind: 'text', data: 'expired', pinned: false, timestamp: old},
        {kind: 'text', data: 'pin', pinned: true, timestamp: old},
        {kind: 'image', data: 'bad', pinned: false, timestamp: clock()},
        {kind: 'text', data: 'future', pinned: false, timestamp: clock() + 120000},
        {kind: 'text', data: 'bad pin', pinned: 'yes', timestamp: clock()},
    ]};
    assert.deepEqual(h.restore(snapshot), {loaded: 1, skipped: 4});
    assert.equal(h.items[0].data, 'pin');
    assert.throws(() => h.restore({version: 1, items: Array(201).fill(null)}));
});
