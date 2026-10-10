import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const moduleUrl = source => {
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
};
const apiUrl = moduleUrl(readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8'));
const accessSource = readFileSync(new URL('../src/vote/access.ts', import.meta.url), 'utf8').replace("'../lib/api'", JSON.stringify(apiUrl));
const { registrationGate, checkLocation } = await import(moduleUrl(accessSource));

test('registration requires the QR grant even when IP or GPS access is allowed', () => {
  assert.equal(registrationGate({ qrEntryRequired: true, qrEntryAllowed: false }, true, null), 'qr');
  assert.equal(registrationGate({ qrEntryRequired: true, qrEntryAllowed: false }, false, null), 'qr');
  assert.equal(registrationGate({ qrEntryRequired: true, qrEntryAllowed: true }, true, null), null);
  assert.equal(registrationGate({ qrEntryRequired: false, qrEntryAllowed: false }, true, null), null);
});

test('a valid QR does not bypass rejected or unconfirmed venue access', () => {
  const state = { qrEntryRequired: true, qrEntryAllowed: true };
  assert.equal(registrationGate(state, false, null), 'offsite');
  assert.equal(registrationGate(state, true, null), null);
  // Existing verified sessions follow backend policy and do not need a replacement QR grant.
  assert.equal(registrationGate({ qrEntryRequired: true, qrEntryAllowed: false }, true, { votes: {} }), null);
});

test('location checks use backend decisions rather than the presence of coordinates', async () => {
  const originalFetch = globalThis.fetch;
  const location = { lat: 31.95, lng: 35.96, accuracy: 10 };
  try {
    for (const allowed of [false, true]) {
      globalThis.fetch = async (url, options) => {
        assert.equal(url, '/api/public/access-check');
        assert.equal(options.method, 'POST');
        assert.deepEqual(JSON.parse(options.body), { location });
        return new Response(JSON.stringify({ allowed, needsLocation: false, mode: 'geo' }), { status: 200, headers: { 'content-type': 'application/json' } });
      };
      assert.equal((await checkLocation(location)).allowed, allowed);
    }
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'unavailable', message: 'Try again' }), { status: 503, headers: { 'content-type': 'application/json' } });
    await assert.rejects(checkLocation(location));
  } finally { globalThis.fetch = originalFetch; }
});
