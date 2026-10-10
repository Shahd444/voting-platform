import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/live-results.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { connectResults } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const flush = () => new Promise(resolve => setImmediate(resolve));
const snapshot = n => ({ generated_at: new Date(n).toISOString(), value: n });

function harness(t, load) {
  let clock = 100000, stream, interval;
  const statuses = [], snapshots = [];
  let unauthorized = 0, closed = false, cleared = false;
  const previous = globalThis.EventSource;
  globalThis.EventSource = class {
    constructor() { stream = this; }
    addEventListener(_, listener) { this.listener = listener; }
    close() { closed = true; }
  };
  t.after(() => { if (previous === undefined) delete globalThis.EventSource; else globalThis.EventSource = previous; });
  t.mock.method(Date, 'now', () => clock);
  t.mock.method(globalThis, 'setInterval', fn => { interval = fn; return 1; });
  t.mock.method(globalThis, 'clearInterval', () => { cleared = true; });
  const stop = connectResults({ url: '/stream', load,
    onSnapshot: s => snapshots.push(s.value), onStatus: s => statuses.push(s), onUnauthorized: () => unauthorized++,
  });
  t.after(stop);
  return { statuses, snapshots, stop,
    emit: s => stream.listener({ data: JSON.stringify(s) }), fail: () => stream.onerror(),
    advance: async ms => { clock += ms; interval(); await flush(); },
    get unauthorized() { return unauthorized; }, get closed() { return closed; }, get cleared() { return cleared; },
  };
}

test('stream errors immediately fetch a fallback and reconnect to live updates', async t => {
  let count = 0;
  const h = harness(t, async () => snapshot(++count));
  await flush();
  h.emit(snapshot(10));
  assert.equal(h.statuses.at(-1), 'live');
  h.fail(); await flush();
  assert.equal(count, 2);
  assert.equal(h.statuses.at(-1), 'polling');
  assert.deepEqual(h.snapshots, [1, 10]); // Older poll must not replace streamed results.
  h.emit(snapshot(20)); assert.equal(h.statuses.at(-1), 'live');
});

test('silent stream stalls activate polling after 30 seconds', async t => {
  let count = 0;
  const h = harness(t, async () => snapshot(++count));
  await flush(); h.emit(snapshot(10));
  await h.advance(29000); assert.equal(count, 1);
  await h.advance(1000); assert.equal(count, 2);
  assert.equal(h.statuses.at(-1), 'polling');
});

test('failed polling reports offline and expired display access is surfaced', async t => {
  let status = 0;
  const h = harness(t, async () => { throw { status }; });
  await flush(); assert.equal(h.statuses.at(-1), 'offline');
  status = 401; await h.advance(5000);
  assert.equal(h.unauthorized, 1);
});

test('cleanup closes the stream and discards pending responses', async t => {
  let resolve;
  const h = harness(t, () => new Promise(r => { resolve = r; }));
  h.stop(); resolve(snapshot(1)); await flush();
  assert.deepEqual(h.snapshots, []);
  assert.equal(h.closed, true); assert.equal(h.cleared, true);
});
