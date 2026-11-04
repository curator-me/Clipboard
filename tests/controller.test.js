import test from 'node:test';
import assert from 'node:assert/strict';
import {History} from '../extension/lib/history.js';
import {CaptureController, StorageQueue} from '../extension/lib/controller.js';

function fixture() {
    const requests = []; const publications = []; const statuses = [];
    const provider = {
        cancel() {},
        read(current) { return new Promise((resolve, reject) => requests.push({resolve, reject, current})); },
        publish(item) { publications.push(item); },
    };
    const history = new History(); let changes = 0;
    const controller = new CaptureController({history, provider, changed: () => changes++, status: s => statuses.push(s)});
    return {controller, history, provider, requests, publications, statuses, changes: () => changes};
}

test('superseded owner completions cannot reorder or resurrect history', async () => {
    const f = fixture(); const a = f.controller.observe(); const b = f.controller.observe();
    f.requests[1].resolve({kind: 'text', data: 'new'}); await b;
    f.requests[0].resolve({kind: 'text', data: 'old'}); await a;
    assert.deepEqual(f.history.items.map(i => i.data), ['new']); assert.equal(f.changes(), 1);
});

test('pause, lock and disable invalidate in-flight captures with no catch-up', async () => {
    for (const action of ['setPaused', 'setLocked', 'dispose']) {
        const f = fixture(); const pending = f.controller.observe();
        f.controller[action](true); f.requests[0].resolve({kind: 'text', data: 'secret'}); await pending;
        assert.equal(f.history.size, 0);
        if (action !== 'dispose') {
            f.controller[action](false); assert.equal(f.requests.length, 1);
        }
    }
});

test('self-owned and sensitive offers are never read', async () => {
    const f = fixture(); await f.controller.observe({own: true}); await f.controller.observe({sensitive: true});
    assert.equal(f.requests.length, 0); assert.equal(f.history.size, 0);
});

test('restoration is explicit and possible while paused, not locked', async () => {
    const f = fixture(); const item = f.history.addText('value').item;
    const pending = f.controller.observe(); f.controller.setPaused(true);
    assert.equal(f.controller.restore(item.id), true); assert.equal(f.publications[0].data, 'value');
    f.requests[0].resolve({kind: 'text', data: 'stale'}); await pending;
    assert.equal(f.history.size, 1); f.controller.setLocked(true);
    assert.equal(f.controller.restore(item.id), false); assert.equal(f.publications.length, 1);
});

test('clear invalidates pending reads and stale errors do not affect status', async () => {
    const f = fixture(); f.history.addText('old'); const pending = f.controller.observe();
    f.controller.clear(); f.requests[0].reject(new Error('SECRET PAYLOAD')); await pending;
    assert.equal(f.history.size, 0); assert.deepEqual(f.statuses, []);
});

test('read/publication failures give generic errors without clipboard content', async () => {
    const f = fixture(); const pending = f.controller.observe();
    f.requests[0].reject(new Error('SECRET')); await pending;
    assert.deepEqual(f.statuses, ['Could not read this clipboard item.']);
    const item = f.history.addText('SECRET').item; f.provider.publish = () => { throw new Error('SECRET'); };
    assert.equal(f.controller.restore(item.id), false);
    assert.ok(f.statuses.every(s => !s.includes('SECRET')));
});

test('purge waits for an in-flight write and obsolete queued writes cannot recreate history', async () => {
    const calls = []; let finish;
    const queue = new StorageQueue({
        write(data) { calls.push(`write:${data}`); return new Promise(resolve => { finish = resolve; }); },
        async remove() { calls.push('purge'); },
    });
    const first = queue.save('old'); await Promise.resolve();
    queue.save('obsolete'); const purge = queue.purge(); finish(); await first; await purge;
    assert.deepEqual(calls, ['write:old', 'purge']);
});

test('new history may persist after a purge barrier and backend errors are generic', async () => {
    const calls = []; const errors = [];
    const queue = new StorageQueue({
        async write(data) { calls.push(`write:${data}`); if (data === 'fail') throw new Error('SECRET'); },
        async remove() { calls.push('purge'); },
    }, () => errors.push('Storage failed'));
    queue.save('obsolete'); queue.purge(); await queue.save('new');
    assert.deepEqual(calls, ['purge', 'write:new']);
    await queue.save('fail'); assert.deepEqual(errors, ['Storage failed']);
});
