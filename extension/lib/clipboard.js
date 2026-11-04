import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';
import {LIMITS, decodeBase64, decodeTextBytes, pngDimensions} from './history.js';

const TYPE = Meta.SelectionType.SELECTION_CLIPBOARD;
const TEXT_MIMES = ['text/plain;charset=utf-8', 'UTF8_STRING', 'text/plain'];
const SECRET_MIMES = new Set(['x-kde-passwordmanagerhint', 'application/x-kde-passwordmanagerhint']);

export function decodePng(bytes) {
    const {width, height} = pngDimensions(bytes);
    const ratio = Math.min(1, 160 / width, 96 / height);
    const loader = GdkPixbuf.PixbufLoader.new_with_type('png');
    try {
        loader.set_size(Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio)));
        loader.write(bytes);
        loader.close();
        const pixbuf = loader.get_pixbuf();
        if (!pixbuf) throw new Error('Invalid PNG');
        return pixbuf;
    } catch (error) {
        try { loader.close(); } catch { /* Failed decoder has no usable image. */ }
        throw error;
    }
}

function imageContent(bytes) {
    const pixbuf = decodePng(bytes);
    const image = new Clutter.Image();
    image.set_data(pixbuf.get_pixels(), pixbuf.get_has_alpha() ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGB_888,
        pixbuf.get_width(), pixbuf.get_height(), pixbuf.get_rowstride());
    return {content: image, width: pixbuf.get_width(), height: pixbuf.get_height()};
}

export class ClipboardProvider {
    constructor(observe) {
        this.selection = global.display.get_selection();
        this._owner = null;
        this._source = null;
        this._operation = null;
        this._thumbnails = new Map();
        this._signal = this.selection.connect('owner-changed', (_selection, type, owner) => {
            if (type !== TYPE) return;
            this._owner = owner;
            const mimes = owner?.get_mimetypes() ?? [];
            const sensitive = mimes.some(mime => SECRET_MIMES.has(mime.toLowerCase()));
            observe({own: owner !== null && owner === this._source, sensitive});
            if (owner !== this._source) this._source = null;
        });
        // Deliberately do not import the clipboard that existed at startup.
    }

    cancel() { this._operation?.cancellable.cancel(); }

    async read(current) {
        const owner = this._owner;
        if (!owner || !current()) return null;
        const mimes = owner.get_mimetypes();
        const normalize = mime => mime.toLowerCase().replace(/[\s"]/g, '');
        if (mimes.some(mime => SECRET_MIMES.has(normalize(mime))) || mimes.some(mime => normalize(mime) === 'text/uri-list')) return null;
        const mime = mimes.find(candidate => normalize(candidate) === 'image/png') ??
            TEXT_MIMES.map(candidate => mimes.find(offered => normalize(offered) === normalize(candidate))).find(Boolean);
        if (!mime) return null;
        const image = normalize(mime) === 'image/png';
        const limit = image ? LIMITS.imageBytes : LIMITS.textBytes;
        const bytes = await this._transfer(mime, limit + 1);
        if (!current() || owner !== this._owner) return null;
        if (bytes.length > limit) throw new Error('Clipboard transfer exceeds limit');
        if (image) {
            // Validate decode after header/resource checks, before adding history.
            imageContent(bytes);
            return {kind: 'image', data: bytes};
        }
        const text = decodeTextBytes(bytes);
        // X11 UTF8_STRING can include a terminal NUL; it is not text content.
        return {kind: 'text', data: mime === 'UTF8_STRING' && text.endsWith('\0') ? text.slice(0, -1) : text};
    }

    _transfer(mime, limit) {
        const stream = Gio.MemoryOutputStream.new_resizable();
        const cancellable = new Gio.Cancellable();
        const operation = {cancellable, timeout: 0};
        this._operation = operation;
        operation.timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2500, () => {
            operation.timeout = 0; cancellable.cancel(); return GLib.SOURCE_REMOVE;
        });
        return new Promise((resolve, reject) => {
            const finish = (error, bytes) => {
                if (operation.timeout) GLib.source_remove(operation.timeout);
                operation.timeout = 0;
                if (this._operation === operation) this._operation = null;
                try { stream.close(null); } catch { /* Already closed or cancelled. */ }
                if (error) reject(error); else resolve(bytes);
            };
            try {
                this.selection.transfer_async(TYPE, mime, limit, stream, cancellable, (source, result) => {
                    try {
                        source.transfer_finish(result);
                        stream.close(null);
                        finish(null, stream.steal_as_bytes().get_data());
                    } catch (error) { finish(error); }
                });
            } catch (error) { finish(error); }
        });
    }

    publish(item) {
        const bytes = item.kind === 'image' ? decodeBase64(item.data) : new TextEncoder().encode(item.data);
        if (item.kind === 'image') imageContent(bytes);
        const mime = item.kind === 'image' ? 'image/png' : 'text/plain;charset=utf-8';
        const source = Meta.SelectionSourceMemory.new(mime, new GLib.Bytes(bytes));
        // set_owner emits synchronously: identity MUST be installed first.
        this._source = source;
        this.selection.set_owner(TYPE, source);
    }

    thumbnail(item) {
        try {
            if (!this._thumbnails.has(item.id)) this._thumbnails.set(item.id, imageContent(decodeBase64(item.data)));
            const thumbnail = this._thumbnails.get(item.id);
            return new St.Widget({content: thumbnail.content, width: thumbnail.width, height: thumbnail.height,
                style_class: 'clip-thumbnail', x_align: Clutter.ActorAlign.START});
        } catch { return null; }
    }
    prune(items) {
        const keep = new Set(items.map(item => item.id));
        for (const id of this._thumbnails.keys()) if (!keep.has(id)) this._thumbnails.delete(id);
    }
    dispose() {
        this.cancel();
        if (this._operation?.timeout) {
            GLib.source_remove(this._operation.timeout); this._operation.timeout = 0;
        }
        this.selection.disconnect(this._signal);
        this._thumbnails.clear();
        // Mutter owns a strong reference. Do not clear the user's clipboard on disable.
        this._source = null; this._owner = null;
    }
}
