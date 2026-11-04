// GNOME-free asynchronous capture policy. Provider owns actual cancellation/I/O.
export class CaptureController {
    constructor({history, provider, changed = () => {}, status = () => {}}) {
        this.history = history;
        this.provider = provider;
        this.changed = changed;
        this.status = status;
        this.active = true;
        this.paused = false;
        this.locked = false;
        this._generation = 0;
    }

    invalidate() {
        this._generation++;
        this.provider.cancel();
    }
    setPaused(paused) { this.paused = paused; this.invalidate(); }
    setLocked(locked) { this.locked = locked; this.invalidate(); }
    get allowed() { return this.active && !this.paused && !this.locked; }

    async observe({own = false, sensitive = false} = {}) {
        this.invalidate();
        if (!this.allowed || own || sensitive) return;
        const generation = this._generation;
        const current = () => this.allowed && generation === this._generation;
        try {
            const payload = await this.provider.read(current);
            if (!current() || !payload) return;
            const result = payload.kind === 'image' ? this.history.addImage(payload.data) : this.history.addText(payload.data);
            if (result.ok) {
                this.status(''); this.changed();
            } else {
                this.status(result.reason === 'full' ? 'History is full. Unpin or delete an item.' :
                    'Skipped an oversized or unsupported clipboard item.');
            }
        } catch {
            if (current()) this.status('Could not read this clipboard item.');
        }
    }

    restore(id) {
        if (!this.active || this.locked) return false;
        const item = this.history.get(id);
        if (!item) return false;
        this.invalidate();
        try {
            this.provider.publish(item);
            this.status('');
            return true;
        } catch {
            this.status('Could not restore the clipboard item.');
            return false;
        }
    }
    clear() { this.invalidate(); this.history.clear(); this.changed(); }
    dispose() { this.active = false; this.invalidate(); }
}

// A purge is an ordering barrier: older in-flight writes finish before deletion.
// Newer saves can follow the purge; coalesced obsolete snapshots never write.
export class StorageQueue {
    constructor(backend, error = () => {}) {
        this.backend = backend;
        this.error = error;
        this._tail = Promise.resolve();
        this._revision = 0;
    }
    save(snapshot) {
        const revision = ++this._revision;
        return this._enqueue(async () => {
            if (revision === this._revision) await this.backend.write(snapshot);
        });
    }
    purge() {
        ++this._revision;
        return this._enqueue(() => this.backend.remove());
    }
    _enqueue(operation) {
        this._tail = this._tail.then(operation).catch(() => this.error());
        return this._tail;
    }
    get settled() { return this._tail; }
}

// One ordering authority per destination, including across UI lifetimes.
export class StorageRegistry {
    constructor() { this._queues = new Map(); }
    acquire(key, backend, error = () => {}) {
        let queue = this._queues.get(key);
        if (!queue) {
            queue = new StorageQueue(backend, error);
            this._queues.set(key, queue);
        }
        queue.backend = backend;
        queue.error = error;
        return queue;
    }
}
