// Run in the app container with compiled dist mounted; uses and removes its own database.
const assert = require('node:assert/strict');
const { DataSource } = require('typeorm');

async function main() {
  const originalUrl = process.env.DATABASE_URL;
  const database = `schedule_verify_${Date.now()}`;
  const control = await new DataSource({ type: 'postgres', url: originalUrl }).initialize();
  let app;
  try {
    await control.query(`CREATE DATABASE "${database}"`);
    const url = new URL(originalUrl); url.pathname = `/${database}`;
    process.env.DATABASE_URL = url.toString();
    process.env.NODE_ENV = 'test'; process.env.REDIS_URL = '';
    process.env.ADMIN_USERNAME = 'schedule-check'; process.env.ADMIN_PASSWORD = 'Schedule-test-123!';
    process.env.COOKIE_SECURE = 'false';
    require('reflect-metadata');
    const { NestFactory } = require('@nestjs/core');
    const { AppModule } = require('./dist/app.module');
    const { configureApp, prepareDatabase } = require('./dist/bootstrap');
    const { SettingsService } = require('./dist/settings/settings.service');
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app); await prepareDatabase(app); await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    let cookie = '';
    const request = async (path, method = 'GET', body) => {
      const response = await fetch(`${base}/api/admin/${path}`, {
        method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'mc2026', Cookie: cookie },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { response, data: await response.json() };
    };
    const login = await request('login', 'POST', { username: 'schedule-check', password: 'Schedule-test-123!' });
    assert.equal(login.response.status, 200);
    cookie = login.response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    const expected = { open: true, opens_at: '2026-10-20T07:00:00.000Z', closes_at: '2026-10-20T09:00:00.000Z' };
    assert.equal((await request('settings/voting', 'PUT', {
      open: true, opens_at: '2026-10-20T10:00:00+03:00', closes_at: '2026-10-20T12:00:00+03:00',
    })).response.status, 200);
    const ds = app.get(DataSource);
    const stored = async () => (await ds.query("SELECT value FROM settings WHERE key = 'voting'"))[0].value;
    assert.deepEqual(await stored(), expected);
    assert.deepEqual((await request('settings')).data.settings.voting, expected);
    for (const patch of [
      { opens_at: '2026-10-20T10:00' }, { opens_at: '2026-02-30T10:00:00Z' },
      { opens_at: '' }, { opens_at: 'invalid' },
      { closes_at: expected.opens_at }, { closes_at: '2026-10-20T06:00:00Z' },
      { opens_at: '2026-10-20T10:00:00Z' },
    ]) {
      assert.equal((await request('settings/voting', 'PUT', patch)).response.status, 400);
      assert.deepEqual(await stored(), expected, 'Rejected saves must leave DB unchanged');
    }
    assert.equal((await request('settings/voting', 'PUT', expected)).response.status, 200);
    const settings = app.get(SettingsService);
    const originalNow = Date.now;
    try {
      const s = await settings.getAll(true);
      for (const [instant, open, reason] of [
        ['2026-10-20T06:59:59Z', false, 'not_started'],
        ['2026-10-20T07:00:00Z', true, undefined],
        ['2026-10-20T09:00:00Z', false, 'ended'],
      ]) {
        Date.now = () => Date.parse(instant);
        assert.equal(settings.votingState(s).open, open);
        assert.equal(settings.votingState(s).reason, reason);
      }
      assert.equal(settings.votingState({ ...s, voting: { ...s.voting, open: false } }).open, false);
    } finally { Date.now = originalNow; }
    assert.equal((await request('settings/voting', 'PUT', { opens_at: null, closes_at: null })).response.status, 200);
    assert.deepEqual(await stored(), { open: true, opens_at: null, closes_at: null });
    if (process.env.VERIFY_RESET === 'true') await require('./verify-reset.cjs')(app, request);
    if (process.env.VERIFY_ATOMICITY === 'true') await require('./verify-atomicity.cjs')(app, request);
    console.log(`PASS: HTTP save/read, PostgreSQL persistence, validation, clearing and voting boundaries; server TZ=${process.env.TZ}`);
  } finally {
    if (app) await app.close();
    await control.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await control.destroy();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
