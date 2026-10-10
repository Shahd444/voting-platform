import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { api, onAdminSessionExpired } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('protected admin requests notify session expiry without treating other errors as logout', async () => {
  const originalFetch = globalThis.fetch;
  let notifications = 0;
  const unsubscribe = onAdminSessionExpired(() => { notifications += 1; });
  try {
    for (const [path, method, status, code, expected] of [
      ['/api/admin/categories', 'POST', 401, 'unauthorized', 1],
      ['/api/admin/stats', 'GET', 401, 'unauthorized', 2],
      ['/api/admin/users/2', 'DELETE', 401, 'unauthorized', 3],
      ['/api/admin/password', 'POST', 401, 'bad_credentials', 3],
      ['/api/admin/login/mfa', 'POST', 401, 'bad_code', 3],
      ['/api/admin/login/mfa', 'POST', 401, 'mfa_expired', 3],
      ['/api/admin/categories', 'POST', 403, 'forbidden', 3],
      ['/api/public/state', 'GET', 401, 'unauthorized', 3],
    ]) {
      globalThis.fetch = async () => new Response(JSON.stringify({ error: code, message: code }), {
        status, headers: { 'content-type': 'application/json' },
      });
      await assert.rejects(api(path, { method }), (error) => error.status === status && error.code === code);
      assert.equal(notifications, expected, `${method} ${path}: ${code}`);
    }
    unsubscribe();
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { 'content-type': 'application/json' },
    });
    await assert.rejects(api('/api/admin/me'));
    assert.equal(notifications, 3, 'unmounted admin listeners are removed');
  } finally {
    unsubscribe();
    globalThis.fetch = originalFetch;
  }
});
