// Portable model: no GNOME imports, disk access, network, or payload logging.
export const LIMITS = Object.freeze({
    defaultEntries: 50,
    maxEntries: 200,
    textBytes: 128 * 1024,
    imageBytes: 2 * 1024 * 1024,
    totalBytes: 16 * 1024 * 1024,
    imageDimension: 4096,
    imagePixels: 4 * 1024 * 1024,
    retentionMs: 7 * 24 * 60 * 60 * 1000,
});

export function decodeTextBytes(bytes) {
    // GJS 1.80 and Node differ in ignoreBOM behavior. Preserve every leading
    // U+FEFF explicitly instead of relying on that runtime-specific option.
    let offset = 0;
    while (bytes[offset] === 0xef && bytes[offset + 1] === 0xbb && bytes[offset + 2] === 0xbf) offset += 3;
    return '﻿'.repeat(offset / 3) + new TextDecoder('utf-8', {fatal: true}).decode(bytes.subarray(offset));
}

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function encodeBase64(bytes) {
    let result = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
        result += alphabet[(n >>> 18) & 63] + alphabet[(n >>> 12) & 63] +
            (i + 1 < bytes.length ? alphabet[(n >>> 6) & 63] : '=') +
            (i + 2 < bytes.length ? alphabet[n & 63] : '=');
    }
    return result;
}

export function decodeBase64(value) {
    if (typeof value !== 'string' || value.length > Math.ceil(LIMITS.imageBytes / 3) * 4 ||
        value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
        throw new Error('Invalid image encoding');
    const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
    const out = new Uint8Array(value.length / 4 * 3 - padding);
    let position = 0;
    for (let i = 0; i < value.length; i += 4) {
        const n = (alphabet.indexOf(value[i]) << 18) | (alphabet.indexOf(value[i + 1]) << 12) |
            (Math.max(0, alphabet.indexOf(value[i + 2])) << 6) | Math.max(0, alphabet.indexOf(value[i + 3]));
        for (const shift of [16, 8, 0]) {
            if (position < out.length)
                out[position++] = (n >>> shift) & 255;
        }
    }
    if (encodeBase64(out) !== value)
        throw new Error('Non-canonical image encoding');
    return out;
}

// Header limits are checked before the GNOME adapter attempts image decoding.
// This is not a full PNG decoder; the adapter must also validate with GdkPixbuf.
export function pngDimensions(bytes) {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (!(bytes instanceof Uint8Array) || bytes.length < 33 || bytes.length > LIMITS.imageBytes ||
        !signature.every((v, i) => bytes[i] === v) ||
        bytes[8] !== 0 || bytes[9] !== 0 || bytes[10] !== 0 || bytes[11] !== 13 ||
        String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR')
        throw new Error('Unsupported PNG');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    if (!width || !height || width > LIMITS.imageDimension || height > LIMITS.imageDimension ||
        width * height > LIMITS.imagePixels)
        throw new Error('Image dimensions exceed limits');
    return {width, height};
}

export class History {
    constructor({maxEntries = LIMITS.defaultEntries, totalBytes = LIMITS.totalBytes, now = Date.now} = {}) {
        this.maxEntries = Math.min(LIMITS.maxEntries, Math.max(1, Math.trunc(maxEntries) || LIMITS.defaultEntries));
        this.totalBytes = Math.min(LIMITS.totalBytes, Math.max(1, Math.trunc(totalBytes) || LIMITS.totalBytes));
        this._now = now;
        this._items = [];
        this._sequence = 0;
    }

    get items() { return this._items.map(item => ({...item})); }
    get size() { return this._items.length; }
    get bytes() { return this._items.reduce((sum, item) => sum + item.bytes, 0); }

    addText(text, options = {}) {
        if (typeof text !== 'string' || !text.length)
            return {ok: false, reason: 'empty'};
        if (text.length > LIMITS.textBytes)
            return {ok: false, reason: 'oversized'};
        const bytes = new TextEncoder().encode(text).length;
        if (bytes > LIMITS.textBytes)
            return {ok: false, reason: 'oversized'};
        return this._add({kind: 'text', data: text, bytes}, options);
    }

    addImage(bytes, options = {}) {
        let dimensions;
        try { dimensions = pngDimensions(bytes); } catch { return {ok: false, reason: 'unsupported-image'}; }
        return this._add({kind: 'image', data: encodeBase64(bytes), bytes: bytes.length, ...dimensions}, options);
    }

    _add(payload, {pinned = false, timestamp = this._now()} = {}) {
        const duplicate = this._items.find(item => item.kind === payload.kind && item.data === payload.data);
        const item = {...payload, id: duplicate?.id ?? `clip-${++this._sequence}`,
            pinned: duplicate?.pinned ?? Boolean(pinned), timestamp};
        const candidates = [item, ...this._items.filter(existing => existing.id !== item.id)];
        let bytes = candidates.reduce((sum, entry) => sum + entry.bytes, 0);
        while (candidates.length > this.maxEntries || bytes > this.totalBytes) {
            // A rejected addition must not remove existing clips, including pins.
            let index = -1;
            for (let i = candidates.length - 1; i > 0; i--) {
                if (!candidates[i].pinned) { index = i; break; }
            }
            if (index < 0)
                return {ok: false, reason: 'full'};
            bytes -= candidates[index].bytes;
            candidates.splice(index, 1);
        }
        this._items = candidates;
        return {ok: true, item: {...item}, duplicate: Boolean(duplicate)};
    }

    get(id) { const item = this._items.find(entry => entry.id === id); return item ? {...item} : null; }
    remove(id) {
        const before = this.size;
        this._items = this._items.filter(item => item.id !== id);
        return this.size !== before;
    }
    togglePin(id) {
        const item = this._items.find(entry => entry.id === id);
        if (!item) return false;
        item.pinned = !item.pinned;
        return true;
    }
    clear() { this._items = []; }
    search(query = '') {
        const needle = String(query).toLocaleLowerCase().trim();
        return this.items.filter(item => !needle || (item.kind === 'text' ? item.data : 'image png')
            .toLocaleLowerCase().includes(needle));
    }
    setMaxEntries(value) {
        const requested = Math.min(LIMITS.maxEntries, Math.max(1, Math.trunc(value) || LIMITS.defaultEntries));
        // Lowering the limit must not silently remove pinned entries.
        if (this._items.filter(item => item.pinned).length > requested)
            return false;
        this.maxEntries = requested;
        for (let i = this._items.length - 1; this.size > this.maxEntries && i >= 0; i--) {
            if (!this._items[i].pinned) this._items.splice(i, 1);
        }
        return this.maxEntries === requested;
    }
    snapshot() {
        return {version: 1, items: this.items.map(({kind, data, pinned, timestamp}) => ({kind, data, pinned, timestamp}))};
    }
    merge(snapshot, excluded = []) {
        const incoming = new History({maxEntries: LIMITS.maxEntries, totalBytes: this.totalBytes, now: this._now});
        const result = incoming.restore(snapshot);
        const records = incoming._items.filter(item => !excluded.some(deleted => deleted.kind === item.kind && deleted.data === item.data));
        const currentRank = new Map(this._items.map((item, index) => [item.id, index]));
        const incomingRank = new Map(records.map((item, index) => [item.id, currentRank.size + index]));
        const uniquePins = records.filter(item => item.pinned &&
            !this._items.some(existing => existing.kind === item.kind && existing.data === item.data && existing.pinned)).length;
        this.maxEntries = Math.min(LIMITS.maxEntries, Math.max(this.maxEntries,
            this._items.filter(item => item.pinned).length + uniquePins));
        let loaded = 0;
        let pinsSkipped = 0;
        // Reconcile saved pins first, evicting live unpinned captures if necessary.
        // Restore display recency after admission; retain IDs of live entries.
        for (const item of [...records.filter(entry => entry.pinned), ...records.filter(entry => !entry.pinned)]) {
            const duplicate = this._items.find(existing => existing.kind === item.kind && existing.data === item.data);
            if (duplicate) { duplicate.pinned ||= item.pinned; continue; }
            const added = {...item, id: `clip-${++this._sequence}`};
            const candidates = [...this._items, added];
            const overLimit = () => candidates.length > this.maxEntries ||
                candidates.reduce((sum, entry) => sum + entry.bytes, 0) > this.totalBytes;
            if (item.pinned) {
                while (overLimit()) {
                    let index = -1;
                    for (let i = candidates.length - 1; i >= 0; i--) {
                        if (!candidates[i].pinned) { index = i; break; }
                    }
                    if (index < 0) break;
                    candidates.splice(index, 1);
                }
            }
            if (overLimit()) { result.skipped++; if (item.pinned) pinsSkipped++; continue; }
            this._items = candidates;
            currentRank.set(added.id, incomingRank.get(item.id));
            loaded++;
        }
        this._items.sort((a, b) => currentRank.get(a.id) - currentRank.get(b.id));
        return {loaded, skipped: result.skipped, ...(pinsSkipped ? {pinsSkipped} : {})};
    }
    restore(snapshot) {
        if (snapshot?.version !== 1 || !Array.isArray(snapshot.items) || snapshot.items.length > LIMITS.maxEntries)
            throw new Error('Unsupported history file');
        const replacement = new History({maxEntries: this.maxEntries, totalBytes: this.totalBytes, now: this._now});
        let skipped = 0;
        for (const record of [...snapshot.items].reverse()) {
            if (!record || typeof record.pinned !== 'boolean' || !Number.isFinite(record.timestamp) ||
                record.timestamp < 0 || record.timestamp > this._now() + 60_000 ||
                (!record.pinned && this._now() - record.timestamp > LIMITS.retentionMs)) {
                skipped++; continue;
            }
            const options = {pinned: record.pinned, timestamp: record.timestamp};
            let result;
            if (record.kind === 'text') result = replacement.addText(record.data, options);
            else if (record.kind === 'image') {
                try { result = replacement.addImage(decodeBase64(record.data), options); }
                catch { result = {ok: false}; }
            } else result = {ok: false};
            if (!result.ok) skipped++;
        }
        this._items = replacement._items;
        this._sequence = replacement._sequence;
        return {loaded: this.size, skipped};
    }
}
