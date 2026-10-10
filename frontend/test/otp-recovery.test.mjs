import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const moduleUrl = source => {
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
};
const apiUrl = moduleUrl(readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8'));
const source = readFileSync(new URL('../src/vote/otp.ts', import.meta.url), 'utf8').replace("'../lib/api'", JSON.stringify(apiUrl));
const { verifyOtp, recoverOtpSession } = await import(moduleUrl(source));
const session = { name: 'Test Visitor', phone: '•••• 1234', votes: {} };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('OTP response-loss recovery never resubmits verification', async t => {
  const originalFetch = globalThis.fetch;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  try {
    for (const failure of ['body_lost', 'connection_lost', 'server_error', 'consumed_code']) {
      await t.test(failure, async () => {
        const calls = [];
        globalThis.fetch = async (url, options) => {
          calls.push([url, options.method]);
          if (url === '/api/public/me') return json({ session });
          if (failure === 'connection_lost') throw new TypeError('Connection lost');
          if (failure === 'server_error') return json({ error: 'internal' }, 500);
          if (failure === 'consumed_code') return json({ error: 'otp_invalid' }, 400);
          return { ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => { throw new TypeError('Response interrupted'); } };
        };
        assert.deepEqual(await verifyOtp('challenge', '123456'), { status: 'verified', session });
        assert.deepEqual(calls, [['/api/public/otp/verify', 'POST'], ['/api/public/me', 'GET']]);
      });
    }
    await t.test('lost cookie offers a new code after confirming there is no session', async () => {
      globalThis.fetch = async url => url === '/api/public/me'
        ? json({ error: 'not_verified' }, 401) : json({ error: 'internal' }, 500);
      assert.deepEqual(await verifyOtp('challenge', '123456'), { status: 'new_code' });
    });
    await t.test('failed session lookup remains uncertain and allows a read-only retry', async () => {
      let posts = 0;
      globalThis.fetch = async (url, options) => {
        if (options.method === 'POST') posts++;
        return json({ error: 'internal' }, 500);
      };
      assert.deepEqual(await verifyOtp('challenge', '123456'), { status: 'unconfirmed' });
      globalThis.fetch = async (url, options) => {
        assert.equal(options.method, 'GET');
        return json({ session });
      };
      assert.deepEqual(await recoverOtpSession(), { status: 'verified', session });
      assert.equal(posts, 1);
    });
    await t.test('a wrong code keeps normal validation and does not query the session', async () => {
      let calls = 0;
      globalThis.fetch = async url => {
        calls++;
        assert.equal(url, '/api/public/otp/verify');
        return json({ error: 'otp_wrong', message: 'Incorrect code' }, 400);
      };
      await assert.rejects(verifyOtp('challenge', '000000'), error => error.code === 'otp_wrong');
      assert.equal(calls, 1);
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});
