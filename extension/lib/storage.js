import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {StorageRegistry} from './controller.js';

const queues = new StorageRegistry();

const MAX_FILE_BYTES = 32 * 1024 * 1024;
const INFO = 'standard::type,standard::is-symlink,standard::size';

function inspect(file) {
    return new Promise((resolve, reject) => file.query_info_async(INFO, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
        GLib.PRIORITY_DEFAULT, null, (source, result) => {
            try { resolve(source.query_info_finish(result)); } catch (error) { reject(error); }
        }));
}
function missing(error) { return error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND); }

export class LocalStorage {
    constructor(error, canWrite = () => true) {
        this.canWrite = canWrite;
        this.directory = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_data_dir(), 'clipboard-history']));
        this.file = this.directory.get_child('history.json');
        this.queue = queues.acquire(this.file.get_path(), {write: snapshot => this._write(snapshot), remove: () => this._remove()}, error);
    }

    async _privateDirectory(create) {
        let info;
        try { info = await inspect(this.directory); }
        catch (error) {
            if (!missing(error) || !create) throw error;
            // Directory creation is tiny metadata I/O, never clipboard payload I/O.
            this.directory.make_directory_with_parents(null);
            info = await inspect(this.directory);
        }
        if (info.get_is_symlink() || info.get_file_type() !== Gio.FileType.DIRECTORY)
            throw new Error('Unsafe history directory');
        this.directory.set_attribute_uint32('unix::mode', 0o700, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    }

    async load() {
        try {
            await this._privateDirectory(false);
            const info = await inspect(this.file);
            if (info.get_is_symlink() || info.get_file_type() !== Gio.FileType.REGULAR || info.get_size() > MAX_FILE_BYTES)
                throw new Error('Unsafe or oversized history file');
            this.file.set_attribute_uint32('unix::mode', 0o600, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
            const stream = await new Promise((resolve, reject) => this.file.read_async(GLib.PRIORITY_DEFAULT, null, (source, result) => {
                try { resolve(source.read_finish(result)); } catch (error) { reject(error); }
            }));
            const chunks = [];
            let length = 0;
            try {
                while (true) {
                    const chunk = await new Promise((resolve, reject) => stream.read_bytes_async(
                        Math.min(64 * 1024, MAX_FILE_BYTES - length + 1), GLib.PRIORITY_DEFAULT, null, (source, result) => {
                            try { resolve(source.read_bytes_finish(result).get_data()); } catch (error) { reject(error); }
                        }));
                    if (!chunk.length) break;
                    length += chunk.length;
                    if (length > MAX_FILE_BYTES) throw new Error('History file exceeds limit');
                    chunks.push(chunk);
                }
            } finally {
                await new Promise((resolve, reject) => stream.close_async(GLib.PRIORITY_DEFAULT, null, (source, result) => {
                    try { source.close_finish(result); resolve(); } catch (error) { reject(error); }
                }));
            }
            const contents = new Uint8Array(length);
            let offset = 0;
            for (const chunk of chunks) { contents.set(chunk, offset); offset += chunk.length; }
            return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(contents));
        } catch (error) {
            if (missing(error)) return null;
            throw error;
        }
    }

    save(snapshot) { return this.queue.save(snapshot); }
    purge() { return this.queue.purge(); }

    async _write(snapshot) {
        if (!this.canWrite()) return;
        const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
        if (bytes.length > MAX_FILE_BYTES) throw new Error('Saved history exceeds limit');
        await this._privateDirectory(true);
        try {
            const info = await inspect(this.file);
            if (info.get_is_symlink() || info.get_file_type() !== Gio.FileType.REGULAR)
                throw new Error('Unsafe history file');
        } catch (error) { if (!missing(error)) throw error; }
        if (!this.canWrite()) return;
        await new Promise((resolve, reject) => this.file.replace_contents_async(bytes, null, false,
            Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null, (source, result) => {
                try { source.replace_contents_finish(result); resolve(); } catch (error) { reject(error); }
            }));
        // Covers an opt-out from the separate preferences process while stopped.
        if (!this.canWrite()) await this._remove();
    }

    async _remove() {
        try { await this._privateDirectory(false); }
        catch (error) { if (missing(error)) return; throw error; }
        // Delete only our file. No backups/debug copies, no directory traversal.
        try {
            const info = await inspect(this.file);
            if (!info.get_is_symlink() && info.get_file_type() !== Gio.FileType.REGULAR)
                throw new Error('Unsafe history file');
            await new Promise((resolve, reject) => this.file.delete_async(GLib.PRIORITY_DEFAULT, null, (source, result) => {
                try { source.delete_finish(result); resolve(); } catch (error) { reject(error); }
            }));
        } catch (error) { if (!missing(error)) throw error; }
    }
}
