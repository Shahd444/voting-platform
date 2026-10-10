/**
 * End-to-end API tests: the real Nest app against a real PostgreSQL database.
 *   TEST_DATABASE_URL=postgres://mc:mc@localhost:5432/mc2026nest_test npm test
 * Redis is deliberately disabled here, which also proves the in-memory fallbacks.
 */
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import { get as httpGet } from 'http';
import type { AddressInfo } from 'net';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp, prepareDatabase } from '../src/bootstrap';
import { decrypt, hashPassword } from '../src/common/crypto.util';
import { currentTotp } from '../src/common/totp.util';
import { SettingsService } from '../src/settings/settings.service';
import { SessionService } from '../src/auth/session.service';
import { SmsService } from '../src/sms/sms.service';
import { config } from '../src/config/config';

let app: NestExpressApplication;
let ds: DataSource;
let settings: SettingsService;
let catA: number, catB: number, exA: number, exB: number, exC: number;

let ipSeq = 1;
const freshIp = () => `10.9.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}`;
let phoneSeq = 1000;
const freshPhone = () => `079${String(1000000 + phoneSeq++).slice(-7)}`;

interface Opts { body?: unknown; cookie?: string; ip?: string; csrf?: boolean }
async function call(method: 'get' | 'post' | 'put' | 'delete', url: string, { body, cookie, ip = '10.0.0.1', csrf = true }: Opts = {}) {
  let r = request(app.getHttpServer())[method](url).set('x-forwarded-for', ip);
  if (csrf) r = r.set('x-requested-with', 'mc2026');
  if (cookie) r = r.set('cookie', cookie);
  const res = body !== undefined ? await r.send(body as object) : await r;
  const cookies = ((res.headers['set-cookie'] as unknown as string[]) || []).map((c) => c.split(';')[0]).join('; ');
  return { status: res.status, data: res.body, text: res.text, cookies, headers: res.headers };
}
const get = (u: string, o?: Opts) => call('get', u, o);
const post = (u: string, body: unknown, o: Opts = {}) => call('post', u, { ...o, body });
const put = (u: string, body: unknown, o: Opts = {}) => call('put', u, { ...o, body });

async function verifiedVisitor(ip = freshIp()) {
  const o = await post('/api/public/otp/request', { name: 'Test Visitor', phone: freshPhone() }, { ip });
  expect(o.status).toBe(200);
  const v = await post('/api/public/otp/verify', { challengeId: o.data.challengeId, code: o.data.devCode }, { ip });
  expect(v.status).toBe(200);
  return { cookie: v.cookies, ip };
}

async function adminCookie(): Promise<string> {
  const ip = freshIp();
  const r = await post('/api/admin/login', { username: 'root', password: 'root-password-123' }, { ip });
  if (r.data.mfaRequired) {
    const a = (await ds.query('SELECT totp_secret_enc FROM admins WHERE username = $1', ['root']))[0];
    const m = await post('/api/admin/login/mfa', { code: currentTotp(decrypt(a.totp_secret_enc)) }, { cookie: r.cookies, ip });
    return m.cookies;
  }
  expect(r.status).toBe(200);
  return r.cookies;
}

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configureApp(app, true); // tests inject client IPs via X-Forwarded-For
  ds = app.get(DataSource);
  await ds.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await prepareDatabase(app);
  await app.init();
  settings = app.get(SettingsService);

  await settings.update('voting', { open: true });
  await settings.update('access', { mode: 'ip', allowed_cidrs: ['10.0.0.0/8', '127.0.0.1/32', '::1/128'] });
  await ds.query('INSERT INTO admins (username, password_hash) VALUES ($1, $2)', ['root', await hashPassword('root-password-123')]);
  const cats = await ds.query(`INSERT INTO categories (slug, name, sort_order) VALUES ('a','Cat A',1),('b','Cat B',2) RETURNING id`);
  [catA, catB] = cats.map((r: { id: number }) => r.id);
  const ex = await ds.query(`INSERT INTO exhibitors (name, project) VALUES ('Maker 1','P1'),('Maker 2','P2'),('Maker 3','P3') RETURNING id`);
  [exA, exB, exC] = ex.map((r: { id: number }) => r.id);
  await ds.query('INSERT INTO exhibitor_categories VALUES ($1,$4),($2,$4),($2,$5),($3,$5)', [exA, exB, exC, catA, catB]);
});

afterAll(async () => { await app.close(); });

describe('atomic reopening and visitor pagination', () => {
  it.each(['display', 'audit'])('rolls back reopening when the %s write fails', async failure => {
    const cookie = await adminCookie();
    const previous = await settings.getAll(true);
    try {
      await settings.updateMany({ voting: { open: false, opens_at: null, closes_at: null }, display: { show_winners: true } });
      const before = await settings.getAll(true);
      const [{ count }] = await ds.query('SELECT COUNT(*)::int AS count FROM audit_log');
      if (failure === 'display') {
        await ds.query(`CREATE FUNCTION fail_reopen() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN IF NEW.key = 'display' THEN RAISE EXCEPTION 'Injected display failure'; END IF; RETURN NEW; END; $$`);
        await ds.query('CREATE TRIGGER fail_reopen BEFORE UPDATE ON settings FOR EACH ROW EXECUTE FUNCTION fail_reopen()');
      } else {
        await ds.query(`CREATE FUNCTION fail_reopen() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN IF NEW.action = 'settings_updated' AND NEW.detail->>'key' = 'display'
          THEN RAISE EXCEPTION 'Injected display audit failure'; END IF; RETURN NEW; END; $$`);
        await ds.query('CREATE TRIGGER fail_reopen BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_reopen()');
      }
      expect((await put('/api/admin/settings/voting', { open: true }, { cookie })).status).toBe(500);
      const after = await settings.getAll(true);
      expect(after.voting).toEqual(before.voting);
      expect(after.display).toEqual(before.display);
      expect((await ds.query('SELECT COUNT(*)::int AS count FROM audit_log'))[0].count).toBe(count);
    } finally {
      await ds.query('DROP TRIGGER IF EXISTS fail_reopen ON settings');
      await ds.query('DROP TRIGGER IF EXISTS fail_reopen ON audit_log');
      await ds.query('DROP FUNCTION IF EXISTS fail_reopen()');
      await settings.updateMany({ voting: previous.voting, display: previous.display });
    }
  });

  it('commits reopening, hiding winners and both audit entries together', async () => {
    const cookie = await adminCookie();
    const previous = await settings.getAll(true);
    try {
      await settings.updateMany({ voting: { open: false, opens_at: null, closes_at: null }, display: { show_winners: true } });
      const [{ id }] = await ds.query('SELECT COALESCE(MAX(id), 0) AS id FROM audit_log');
      expect((await put('/api/admin/settings/voting', { open: true }, { cookie })).status).toBe(200);
      const saved = await settings.getAll(true);
      expect(saved.voting.open).toBe(true);
      expect(saved.display.show_winners).toBe(false);
      const audit = await ds.query("SELECT detail->>'key' AS key FROM audit_log WHERE id > $1 AND action = 'settings_updated' ORDER BY id", [id]);
      expect(audit.map((row: any) => row.key)).toEqual(['voting', 'display']);
    } finally { await settings.updateMany({ voting: previous.voting, display: previous.display }); }
  });

  it('validates pagination and retains the total beyond the last page', async () => {
    const cookie = await adminCookie();
    await verifiedVisitor();
    for (const query of ['limit=-1', 'limit=0', 'limit=1.5', 'limit=Infinity', 'limit=no', 'limit=',
      'offset=-1', 'offset=1.5', 'offset=Infinity', 'offset=no', 'offset=', 'offset=9007199254740992', 'limit=1&limit=2']) {
      const response = await get(`/api/admin/visitors?${query}`, { cookie });
      expect(response.status).toBe(400);
      expect(response.data.error).toBe('bad_pagination');
    }
    const [{ total }] = await ds.query('SELECT COUNT(*)::int AS total FROM visitors WHERE verified_at IS NOT NULL');
    expect(total).toBeGreaterThan(0);
    const empty = await get(`/api/admin/visitors?limit=50&offset=${total + 100}`, { cookie });
    expect(empty.status).toBe(200);
    expect(empty.data).toEqual({ total, visitors: [] });
    const defaults = await get('/api/admin/visitors', { cookie });
    expect(defaults.status).toBe(200);
    expect(defaults.data.total).toBe(total);
    expect(defaults.data.visitors.length).toBeLessThanOrEqual(50);
    expect((await get('/api/admin/visitors?limit=999&offset=0', { cookie })).status).toBe(200);
  });
});

describe('OTP lifecycle', () => {
  const pause = () => new Promise((resolve) => setTimeout(resolve, 1100));

  it('delivers the generated code and only authenticates after verification', async () => {
    const sms = jest.spyOn(app.get(SmsService), 'sendOtp'); // call through to console delivery
    try {
      const phone = freshPhone(), ip = freshIp();
      const sent = await post('/api/public/otp/request', { name: 'Delivery Test', phone }, { ip });
      expect(sent.status).toBe(200);
      expect(sms).toHaveBeenCalledWith(`962${phone.slice(1)}`, sent.data.devCode);
      expect(sent.cookies).not.toContain('mc_v=');
      const row = (await ds.query('SELECT c.code_hash, v.verified_at FROM otp_challenges c JOIN visitors v ON v.id = c.visitor_id WHERE c.id = $1', [sent.data.challengeId]))[0];
      expect(row.code_hash).not.toBe(sent.data.devCode);
      expect(row.verified_at).toBeNull();
      const verified = await post('/api/public/otp/verify', { challengeId: sent.data.challengeId, code: sent.data.devCode }, { ip });
      expect(verified.status).toBe(200);
      expect(verified.cookies).toContain('mc_v=');
      expect((await ds.query('SELECT consumed_at FROM otp_challenges WHERE id = $1', [sent.data.challengeId]))[0].consumed_at).not.toBeNull();
    } finally { sms.mockRestore(); }
  });

  it('rejects an expired code without issuing a session', async () => {
    const ip = freshIp();
    const sent = await post('/api/public/otp/request', { name: 'Expiry Test', phone: freshPhone() }, { ip });
    // Advance this isolated challenge past its expiry instead of waiting five minutes.
    await ds.query("UPDATE otp_challenges SET expires_at = now() - interval '1 second' WHERE id = $1", [sent.data.challengeId]);
    const result = await post('/api/public/otp/verify', { challengeId: sent.data.challengeId, code: sent.data.devCode }, { ip });
    expect(result.status).toBe(400);
    expect(result.data.error).toBe('otp_expired');
    expect(result.cookies).not.toContain('mc_v=');
  });

  it('counts a wrong code but permits the correct code before the attempt limit', async () => {
    const ip = freshIp();
    const sent = await post('/api/public/otp/request', { name: 'Wrong Test', phone: freshPhone() }, { ip });
    const wrong = sent.data.devCode === '000000' ? '111111' : '000000';
    const rejected = await post('/api/public/otp/verify', { challengeId: sent.data.challengeId, code: wrong }, { ip });
    expect(rejected.data.error).toBe('otp_wrong');
    expect((await ds.query('SELECT attempts FROM otp_challenges WHERE id = $1', [sent.data.challengeId]))[0].attempts).toBe(1);
    expect((await post('/api/public/otp/verify', { challengeId: sent.data.challengeId, code: sent.data.devCode }, { ip })).status).toBe(200);
  });

  it('enforces resend cooldown, replaces the old challenge and preserves one phone identity', async () => {
    const phone = freshPhone(), ip = freshIp();
    const first = await post('/api/public/otp/request', { name: 'Resend First', phone }, { ip });
    const blocked = await post('/api/public/otp/request', { name: 'Resend Second', phone }, { ip });
    expect(blocked.status).toBe(429);
    expect(blocked.data.error).toBe('otp_cooldown');
    await pause();
    const second = await post('/api/public/otp/request', { name: 'Resend Second', phone: `+962${phone.slice(1)}` }, { ip });
    expect(second.status).toBe(200);
    expect(second.data.challengeId).not.toBe(first.data.challengeId);
    expect((await post('/api/public/otp/verify', { challengeId: first.data.challengeId, code: first.data.devCode }, { ip })).data.error).toBe('otp_invalid');
    expect((await post('/api/public/otp/verify', { challengeId: second.data.challengeId, code: second.data.devCode }, { ip })).status).toBe(200);
    const rows = await ds.query('SELECT visitor_id FROM otp_challenges WHERE id = $1 OR id = $2', [first.data.challengeId, second.data.challengeId]);
    expect(new Set(rows.map((r: { visitor_id: string }) => r.visitor_id)).size).toBe(1);
  });

  it('enforces the hourly send cap without creating another challenge', async () => {
    const phone = freshPhone(), ip = freshIp();
    let lastId: string;
    for (let i = 0; i < config.otp.maxPerPhonePerHour; i++) {
      if (i) await pause();
      const sent = await post('/api/public/otp/request', { name: 'Send Budget', phone }, { ip });
      expect(sent.status).toBe(200);
      lastId = sent.data.challengeId;
    }
    await pause();
    const blocked = await post('/api/public/otp/request', { name: 'Send Budget', phone }, { ip });
    expect(blocked.status).toBe(429);
    expect(blocked.data.error).toBe('rate_limited');
    const row = (await ds.query('SELECT COUNT(*)::int AS n FROM otp_challenges WHERE visitor_id = (SELECT visitor_id FROM otp_challenges WHERE id = $1)', [lastId!]))[0];
    expect(row.n).toBe(config.otp.maxPerPhonePerHour);
  });

  it('allows only one concurrent verification of the same code', async () => {
    const ip = freshIp();
    const sent = await post('/api/public/otp/request', { name: 'Concurrent OTP', phone: freshPhone() }, { ip });
    const body = { challengeId: sent.data.challengeId, code: sent.data.devCode };
    const results = await Promise.all([post('/api/public/otp/verify', body, { ip }), post('/api/public/otp/verify', body, { ip })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(results.find((r) => r.status === 400)!.data.error).toBe('otp_invalid');
  });

  it('reports delivery failure and permits a later successful resend', async () => {
    const sms = jest.spyOn(app.get(SmsService), 'sendOtp').mockRejectedValueOnce(new Error('Test gateway unavailable'));
    try {
      const phone = freshPhone(), ip = freshIp();
      const failed = await post('/api/public/otp/request', { name: 'Gateway Test', phone }, { ip });
      expect(failed.status).toBe(502);
      expect(failed.data.error).toBe('sms_failed');
      expect(failed.data.devCode).toBeUndefined();
      expect(failed.cookies).not.toContain('mc_v=');
      await pause();
      const sent = await post('/api/public/otp/request', { name: 'Gateway Test', phone }, { ip });
      expect(sent.status).toBe(200);
      expect((await post('/api/public/otp/verify', { challengeId: sent.data.challengeId, code: sent.data.devCode }, { ip })).status).toBe(200);
    } finally { sms.mockRestore(); }
  });
});

describe('authentication and authorization matrix', () => {
  const adminOnly: { method: 'get' | 'post' | 'put' | 'delete'; path: string; body?: unknown }[] = [
    { method: 'post', path: '/api/admin/exhibitors', body: { name: 'Forbidden Maker' } },
    { method: 'put', path: '/api/admin/exhibitors/1', body: { name: 'Forbidden Edit' } },
    { method: 'delete', path: '/api/admin/exhibitors/1' },
    { method: 'post', path: '/api/admin/categories', body: { name: 'Forbidden Category' } },
    { method: 'put', path: '/api/admin/categories/1', body: { name: 'Forbidden Edit' } },
    { method: 'delete', path: '/api/admin/categories/1' },
    { method: 'put', path: '/api/admin/settings/event', body: { name: 'Forbidden Event' } },
    { method: 'put', path: '/api/admin/settings/voting', body: { open: false } },
    { method: 'put', path: '/api/admin/settings/access', body: { mode: 'off' } },
    { method: 'put', path: '/api/admin/settings/display', body: { show_counts: false } },
    { method: 'post', path: '/api/admin/results/reset', body: { confirm: 'RESET', purgeVisitors: true } },
    { method: 'post', path: '/api/admin/display/rotate', body: {} },
    { method: 'get', path: '/api/admin/visitors' },
    { method: 'get', path: '/api/admin/export/visitors.csv' },
    { method: 'get', path: '/api/admin/users' },
    { method: 'post', path: '/api/admin/users', body: { username: 'forbidden', password: 'password-123', role: 'admin' } },
    { method: 'delete', path: '/api/admin/users/1' },
    { method: 'get', path: '/api/admin/audit' },
  ];

  it('denies every privileged operation to anonymous, visitor, viewer and display sessions', async () => {
    const admin = await adminCookie();
    const visitor = await verifiedVisitor();
    expect((await post('/api/admin/users', { username: 'permission-viewer', password: 'permission-password-123', role: 'viewer' }, { cookie: admin })).status).toBe(201);
    const viewer = await post('/api/admin/login', { username: 'permission-viewer', password: 'permission-password-123' }, { ip: freshIp() });
    expect(viewer.status).toBe(200);
    const display = await post('/api/display/auth', { key: (await settings.getAll(true)).display.key }, { ip: freshIp() });
    expect(display.status).toBe(200);
    const before = await ds.query('SELECT (SELECT count(*)::int FROM votes) AS votes,(SELECT count(*)::int FROM exhibitors) AS exhibitors,(SELECT count(*)::int FROM categories) AS categories');
    for (const actor of [
      { label: 'anonymous', cookie: undefined, status: 401 },
      { label: 'visitor', cookie: visitor.cookie, status: 401 },
      { label: 'display', cookie: display.cookies, status: 401 },
      { label: 'viewer', cookie: viewer.cookies, status: 403 },
    ]) {
      for (const route of adminOnly) {
        const result = await call(route.method, route.path, { cookie: actor.cookie, body: route.body });
        expect({ actor: actor.label, route: route.path, status: result.status }).toEqual({ actor: actor.label, route: route.path, status: actor.status });
      }
    }
    expect(await ds.query('SELECT (SELECT count(*)::int FROM votes) AS votes,(SELECT count(*)::int FROM exhibitors) AS exhibitors,(SELECT count(*)::int FROM categories) AS categories')).toEqual(before);
    for (const path of ['/api/admin/categories', '/api/admin/exhibitors', '/api/admin/results', '/api/admin/settings', '/api/admin/stats', '/api/admin/export/results.csv', '/api/admin/export/results.json']) {
      expect((await get(path, { cookie: viewer.cookies })).status).toBe(200);
      expect((await get(path, { cookie: display.cookies })).status).toBe(401);
    }
    expect((await get('/api/public/state', { cookie: visitor.cookie })).status).toBe(200);
    expect((await get('/api/display/results', { cookie: visitor.cookie })).status).toBe(401);
    expect((await get('/api/display/results', { cookie: display.cookies })).status).toBe(200);
    expect((await get('/api/display/results', { cookie: viewer.cookies })).status).toBe(200);
    expect((await get('/api/display/results', { cookie: admin })).status).toBe(200);
    for (const cookie of [display.cookies, viewer.cookies, admin]) {
      expect((await post('/api/public/votes', { categoryId: catA, exhibitorId: exA }, { cookie })).status).toBe(401);
    }
  });

  it('rejects tampered, expired and wrong-type tokens', async () => {
    const sessions = app.get(SessionService);
    const admin = await adminCookie();
    const token = admin.split('mc_a=')[1].split(';')[0];
    const parts = token.split('.');
    parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
    expect((await get('/api/admin/me', { cookie: `mc_a=${parts.join('.')}` })).status).toBe(401);
    const expired = sessions.sign({ typ: 'admin', sub: 1 }, '0s');
    expect((await get('/api/admin/me', { cookie: `mc_a=${expired}` })).status).toBe(401);
    const visitor = await verifiedVisitor();
    expect((await get('/api/admin/me', { cookie: visitor.cookie.replace('mc_v=', 'mc_a=') })).status).toBe(401);
    expect((await post('/api/public/votes', { categoryId: catA, exhibitorId: exA }, { cookie: admin.replace('mc_a=', 'mc_v=') })).status).toBe(401);
  });

  it('revokes old admin sessions on password change and enforces database roles', async () => {
    const admin = await adminCookie();
    const created = await post('/api/admin/users', { username: 'permission-admin', password: 'original-password-123', role: 'admin' }, { cookie: admin });
    expect(created.status).toBe(201);
    const login = await post('/api/admin/login', { username: 'permission-admin', password: 'original-password-123' }, { ip: freshIp() });
    expect(login.status).toBe(200);
    const changed = await post('/api/admin/password', { current: 'original-password-123', next: 'replacement-password-123' }, { cookie: login.cookies });
    expect(changed.status).toBe(200);
    expect((await get('/api/admin/me', { cookie: login.cookies })).status).toBe(401);
    expect((await get('/api/admin/me', { cookie: changed.cookies })).status).toBe(200);
    await ds.query("UPDATE admins SET role='viewer' WHERE id=$1", [created.data.id]);
    expect((await put('/api/admin/settings/voting', { open: false }, { cookie: changed.cookies })).status).toBe(403);
    expect((await call('delete', `/api/admin/users/${created.data.id}`, { cookie: admin })).status).toBe(200);
    expect((await get('/api/admin/me', { cookie: changed.cookies })).status).toBe(401);
  });
});

describe('database-driven event configuration', () => {
  it('persists access rules through admin and preserves them when defaults run again', async () => {
    const before = (await settings.getAll(true)).access;
    const cookie = await adminCookie();
    const access = { mode: 'ip_and_geo', allowed_cidrs: ['203.0.113.0/24'],
      geofence: { lat: 31.95, lng: 35.91, radius_m: 250, max_accuracy_m: 50 } };
    try {
      expect((await put('/api/admin/settings/access', access, { cookie })).status).toBe(200);
      const stored = (await ds.query("SELECT value FROM settings WHERE key = 'access'"))[0].value;
      expect(stored).toEqual(access);
      await settings.ensureDefaults();
      expect((await settings.getAll(true)).access).toEqual(access);
      const loc = { lat: 31.95, lng: 35.91, accuracy: 20 };
      expect((await post('/api/public/access-check', { location: loc }, { ip: '203.0.113.5' })).data.allowed).toBe(true);
      expect((await post('/api/public/access-check', { location: loc }, { ip: '198.51.100.5' })).data.allowed).toBe(false);
      const missing = await post('/api/public/access-check', {}, { ip: '203.0.113.5' });
      expect(missing.data).toMatchObject({ allowed: false, needsLocation: true });
      expect((await post('/api/public/access-check', { location: { ...loc, accuracy: 51 } }, { ip: '203.0.113.5' })).data.allowed).toBe(false);
      expect((await post('/api/public/access-check', { location: { ...loc, accuracy: -1 } }, { ip: '203.0.113.5' })).status).toBe(400);
    } finally { await settings.update('access', before); }
  });

  it('persists the voting schedule and uses it for public state and OTP access', async () => {
    const before = (await settings.getAll(true)).voting;
    const cookie = await adminCookie();
    const future = { open: true, opens_at: new Date(Date.now() + 3600000).toISOString(),
      closes_at: new Date(Date.now() + 7200000).toISOString() };
    try {
      expect((await put('/api/admin/settings/voting', future, { cookie })).status).toBe(200);
      expect((await ds.query("SELECT value FROM settings WHERE key = 'voting'"))[0].value).toEqual(future);
      expect((await get('/api/public/state')).data.voting).toMatchObject({ open: false, reason: 'not_started' });
      const blocked = await post('/api/public/otp/request', { name: 'Scheduled Visitor', phone: freshPhone() });
      expect(blocked.status).toBe(403);
      expect(blocked.data.error).toBe('voting_closed');
      await settings.update('voting', { opens_at: new Date(Date.now() - 7200000).toISOString(),
        closes_at: new Date(Date.now() - 3600000).toISOString() });
      expect((await get('/api/public/state')).data.voting).toMatchObject({ open: false, reason: 'ended' });
    } finally { await settings.update('voting', before); }
  });

  it('reads category and exhibitor content from database records', async () => {
    const category = (await ds.query('SELECT name FROM categories WHERE id = $1', [catA]))[0];
    const exhibitor = (await ds.query('SELECT description FROM exhibitors WHERE id = $1', [exA]))[0];
    try {
      await ds.query('UPDATE categories SET name = $1 WHERE id = $2', ['Configured Award', catA]);
      await ds.query('UPDATE exhibitors SET description = $1 WHERE id = $2', ['Configured project description', exA]);
      const state = (await get('/api/public/state')).data;
      expect(state.categories.find((c: any) => c.id === catA).name).toBe('Configured Award');
      expect(state.exhibitors.find((e: any) => e.id === exA).description).toBe('Configured project description');
    } finally {
      await ds.query('UPDATE categories SET name = $1 WHERE id = $2', [category.name, catA]);
      await ds.query('UPDATE exhibitors SET description = $1 WHERE id = $2', [exhibitor.description, exA]);
    }
  });
});

describe('visitor flow', () => {
  it('public state lists categories and exhibitors', async () => {
    const r = await get('/api/public/state');
    expect(r.status).toBe(200);
    expect(r.data.categories).toHaveLength(2);
    expect(r.data.exhibitors).toHaveLength(3);
    expect(r.data.voting.open).toBe(true);
    expect(r.data.session).toBeNull();
  });

  it('rejects state-changing requests without the CSRF header', async () => {
    const r = await post('/api/public/otp/request', { name: 'x', phone: '0791111111' }, { csrf: false });
    expect(r.status).toBe(403);
  });

  it('cannot vote without OTP verification', async () => {
    expect((await post('/api/public/votes', { categoryId: catA, exhibitorId: exA })).status).toBe(401);
  });

  it('validates name, phone and body shape', async () => {
    expect((await post('/api/public/otp/request', { name: 'Ok Name', phone: '12' }, { ip: freshIp() })).status).toBe(400);
    expect((await post('/api/public/otp/request', { name: 'x', phone: '0791234567' }, { ip: freshIp() })).status).toBe(400);
    expect((await post('/api/public/otp/verify', { challengeId: 'not-a-uuid', code: '1' })).status).toBe(400);
  });

  it('locks an OTP challenge after 5 wrong attempts', async () => {
    const ip = freshIp();
    const o = await post('/api/public/otp/request', { name: 'Locky', phone: freshPhone() }, { ip });
    const wrong = o.data.devCode === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect((await post('/api/public/otp/verify', { challengeId: o.data.challengeId, code: wrong }, { ip })).status).toBe(400);
    const r = await post('/api/public/otp/verify', { challengeId: o.data.challengeId, code: o.data.devCode }, { ip });
    expect(r.data.error).toBe('otp_locked');
  });

  it('an OTP can only be used once', async () => {
    const ip = freshIp();
    const o = await post('/api/public/otp/request', { name: 'Once', phone: freshPhone() }, { ip });
    const body = { challengeId: o.data.challengeId, code: o.data.devCode };
    expect((await post('/api/public/otp/verify', body, { ip })).status).toBe(200);
    expect((await post('/api/public/otp/verify', body, { ip })).status).toBe(400);
  });

  it('one vote per category; same and different picks are rejected on retry', async () => {
    const v = await verifiedVisitor();
    expect((await post('/api/public/votes', { categoryId: catA, exhibitorId: exA }, v)).status).toBe(201);
    const retry = await post('/api/public/votes', { categoryId: catA, exhibitorId: exA }, v);
    expect(retry.status).toBe(409);
    expect(retry.data.error).toBe('already_voted');
    expect((await post('/api/public/votes', { categoryId: catA, exhibitorId: exB }, v)).status).toBe(409);
    const r4 = await post('/api/public/votes', { categoryId: catB, exhibitorId: exC }, v);
    expect(r4.status).toBe(201);
    expect(Object.keys(r4.data.session.votes).map(Number).sort()).toEqual([catA, catB].sort());
  });

  it('concurrent double-submits still produce exactly one vote (DB constraint)', async () => {
    const v = await verifiedVisitor();
    const attempts = await Promise.all([exB, exC, exB, exC, exB, exC, exB, exC].map((ex) => post('/api/public/votes', { categoryId: catB, exhibitorId: ex }, v)));
    expect(attempts.filter((r) => r.status === 201)).toHaveLength(1);
    expect(attempts.filter((r) => r.status === 409 && r.data.error === 'already_voted')).toHaveLength(7);
    const n = (await ds.query('SELECT COUNT(*)::int AS n FROM votes WHERE category_id = $1 AND ip = $2', [catB, v.ip]))[0].n;
    expect(n).toBe(1);
  });

  it('the same phone re-verifying keeps its existing votes (no second ballot)', async () => {
    const phone = freshPhone();
    const ip = freshIp();
    const login = async () => {
      const o = await post('/api/public/otp/request', { name: 'Repeat', phone }, { ip });
      return (await post('/api/public/otp/verify', { challengeId: o.data.challengeId, code: o.data.devCode }, { ip })).cookies;
    };
    const c1 = await login();
    expect((await post('/api/public/votes', { categoryId: catA, exhibitorId: exA }, { ip, cookie: c1 })).status).toBe(201);
    await new Promise((r) => setTimeout(r, 1100)); // resend cooldown
    const c2 = await login();
    expect((await post('/api/public/votes', { categoryId: catA, exhibitorId: exB }, { ip, cookie: c2 })).status).toBe(409);
  });

  it('many phones behind the venue NAT IP are not throttled by the per-IP limit', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 30; i++) statuses.push((await post('/api/public/otp/request', { name: `Crowd ${i}`, phone: freshPhone() }, { ip: '10.77.77.77' })).status);
    expect([...new Set(statuses)]).toEqual([200]);
  });

  it('exhibitor must belong to the category', async () => {
    const v = await verifiedVisitor();
    expect((await post('/api/public/votes', { categoryId: catA, exhibitorId: exC }, v)).status).toBe(400);
  });

  it('requires the visitor to still be verified in the database before voting', async () => {
    const v = await verifiedVisitor();
    await ds.query('UPDATE visitors SET verified_at = NULL WHERE created_ip = $1', [v.ip]);
    const r = await post('/api/public/votes', { categoryId: catA, exhibitorId: exA }, v);
    expect(r.status).toBe(401);
    expect(r.data.error).toBe('not_verified');
  });
});

describe('three-category voting correctness', () => {
  it('stores exactly one choice per category and independently permits another visitor', async () => {
    const categories = await ds.query("INSERT INTO categories (slug, name) VALUES ('step8-1','Step 8 One'),('step8-2','Step 8 Two'),('step8-3','Step 8 Three') RETURNING id");
    const ids = categories.map((r: { id: number }) => r.id);
    const makers = await ds.query("INSERT INTO exhibitors (name, project) VALUES ('Step 8 Maker A','A'),('Step 8 Maker B','B') RETURNING id");
    const [a, b] = makers.map((r: { id: number }) => r.id);
    try {
      for (const id of ids) await ds.query('INSERT INTO exhibitor_categories VALUES ($1,$3),($2,$3)', [a, b, id]);
      const visitor = await verifiedVisitor();
      for (const [i, id] of ids.entries()) {
        expect((await post('/api/public/votes', { categoryId: id, exhibitorId: i === 1 ? b : a }, visitor)).status).toBe(201);
        for (const exhibitorId of [a, b]) {
          const repeat = await post('/api/public/votes', { categoryId: id, exhibitorId }, visitor);
          expect(repeat.status).toBe(409);
          expect(repeat.data.error).toBe('already_voted');
        }
      }
      const rows = await ds.query('SELECT visitor_id, category_id, exhibitor_id FROM votes WHERE ip = $1 ORDER BY category_id', [visitor.ip]);
      expect(rows.map((r: { category_id: number }) => r.category_id)).toEqual(ids);
      expect(rows.map((r: { exhibitor_id: number }) => r.exhibitor_id)).toEqual([a, b, a]);
      // The PostgreSQL constraint also rejects duplicates inserted outside the API.
      await expect(ds.query('INSERT INTO votes (visitor_id, category_id, exhibitor_id) VALUES ($1,$2,$3)', [rows[0].visitor_id, ids[0], b])).rejects.toMatchObject({ code: '23505' });
      const other = await verifiedVisitor(visitor.ip); // same venue IP, separate verified phone
      for (const id of ids) expect((await post('/api/public/votes', { categoryId: id, exhibitorId: b }, other)).status).toBe(201);
      const count = (await ds.query('SELECT COUNT(*)::int AS n FROM votes WHERE category_id = ANY($1::int[])', [ids]))[0].n;
      expect(count).toBe(6);
    } finally {
      await ds.query('DELETE FROM votes WHERE category_id = ANY($1::int[])', [ids]);
      await ds.query('DELETE FROM exhibitors WHERE id = ANY($1::int[])', [[a, b]]);
      await ds.query('DELETE FROM categories WHERE id = ANY($1::int[])', [ids]);
    }
  });

  it('rejects inactive or nonexistent choices without storing votes', async () => {
    const category = (await ds.query("INSERT INTO categories (slug, name, is_active) VALUES ('step8-inactive','Inactive',false) RETURNING id"))[0].id;
    const exhibitor = (await ds.query("INSERT INTO exhibitors (name, project, is_active) VALUES ('Step 8 Hidden','Hidden',false) RETURNING id"))[0].id;
    try {
      await ds.query('INSERT INTO exhibitor_categories VALUES ($1,$3),($2,$4)', [exhibitor, exA, catA, category]);
      const visitor = await verifiedVisitor();
      for (const choice of [{ categoryId: category, exhibitorId: exA }, { categoryId: catA, exhibitorId: exhibitor }, { categoryId: 2147483647, exhibitorId: exA }, { categoryId: catA, exhibitorId: 2147483647 }]) {
        const rejected = await post('/api/public/votes', choice, visitor);
        expect(rejected.status).toBe(400);
        expect(rejected.data.error).toBe('bad_vote');
      }
      expect((await ds.query('SELECT COUNT(*)::int AS n FROM votes WHERE ip = $1', [visitor.ip]))[0].n).toBe(0);
    } finally {
      await ds.query('DELETE FROM exhibitors WHERE id = $1', [exhibitor]);
      await ds.query('DELETE FROM categories WHERE id = $1', [category]);
    }
  });
});

describe('network response loss and voting retries', () => {
  it('keeps the committed vote when the response is lost and rejects every retry', async () => {
    const visitor = await verifiedVisitor();
    const body = { categoryId: catA, exhibitorId: exA };
    const server = app.getHttpServer();
    let responseDropped = false;
    const dropResponse = (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'POST' || req.url !== '/api/public/votes' || req.headers['x-forwarded-for'] !== visitor.ip) return;
      // Nest reaches response.end only after castVote has committed its transaction.
      // Destroy the socket before sending any response bytes to the client.
      jest.spyOn(res, 'end').mockImplementation(() => {
        responseDropped = true;
        res.destroy();
        return res;
      });
    };
    server.prependListener('request', dropResponse);
    try {
      await expect(post('/api/public/votes', body, visitor)).rejects.toThrow();
    } finally {
      server.removeListener('request', dropResponse);
    }
    expect(responseDropped).toBe(true);
    const saved = await ds.query('SELECT id, visitor_id, category_id, exhibitor_id, created_at FROM votes WHERE ip = $1 AND category_id = $2', [visitor.ip, catA]);
    expect(saved).toHaveLength(1);
    expect(saved[0].exhibitor_id).toBe(exA);

    const retry = await post('/api/public/votes', body, visitor);
    expect(retry.status).toBe(409);
    expect(retry.data.error).toBe('already_voted');
    const retries = await Promise.all([exA, exB, exA, exB].map((exhibitorId) => post('/api/public/votes', { categoryId: catA, exhibitorId }, visitor)));
    for (const result of retries) {
      expect(result.status).toBe(409);
      expect(result.data.error).toBe('already_voted');
    }
    const after = await ds.query('SELECT id, visitor_id, category_id, exhibitor_id, created_at FROM votes WHERE visitor_id = $1 AND category_id = $2', [saved[0].visitor_id, catA]);
    expect(after).toEqual(saved); // Original row and timestamp are unchanged.

    for (const endpoint of ['/api/public/me', '/api/public/state']) {
      const restored = await get(endpoint, visitor);
      expect(restored.status).toBe(200);
      expect(restored.data.session.votes[catA].exhibitor_id).toBe(exA);
    }
    expect((await post('/api/public/votes', { categoryId: catB, exhibitorId: exC }, visitor)).status).toBe(201);
  });
});

describe('on-site access & voting window', () => {
  it('rejects off-site requests and admits mobile-data users inside the geofence', async () => {
    const off = await post('/api/public/otp/request', { name: 'Remote', phone: freshPhone() }, { ip: '8.8.8.8' });
    expect(off.status).toBe(403);
    expect(off.data.error).toBe('not_on_site');

    await settings.update('access', { mode: 'ip_or_geo', geofence: { lat: 31.95, lng: 35.91, radius_m: 300, max_accuracy_m: 500 } });
    const noLoc = await post('/api/public/otp/request', { name: 'Mobile', phone: freshPhone() }, { ip: '8.8.4.4' });
    expect(noLoc.status).toBe(403);
    expect(noLoc.data.access.needsLocation).toBe(true);
    const withLoc = await post('/api/public/otp/request', { name: 'Mobile', phone: freshPhone(), location: { lat: 31.9501, lng: 35.9101, accuracy: 30 } }, { ip: '8.8.4.4' });
    expect(withLoc.status).toBe(200);
    const far = await post('/api/public/otp/request', { name: 'Far', phone: freshPhone(), location: { lat: 31.5, lng: 35.5, accuracy: 30 } }, { ip: '8.8.4.5' });
    expect(far.status).toBe(403);
    await settings.update('access', { mode: 'ip' });
  });

  it.each([
    ['manually closed', false, null, null, 'closed'],
    ['manually open', true, null, null, null],
    ['before scheduled start', true, 3600000, 7200000, 'not_started'],
    ['during scheduled event', true, -3600000, 3600000, null],
    ['after scheduled end', true, -7200000, -3600000, 'ended'],
    ['manual close overrides an active schedule', false, -3600000, 3600000, 'closed'],
  ] as const)('enforces %s on direct vote requests', async (_, open, startOffset, endOffset, reason) => {
    const visitor = await verifiedVisitor(); // Already authenticated before the window changes.
    const previous = (await settings.getAll(true)).voting;
    const admin = await adminCookie();
    const now = Date.now();
    const window = { open, opens_at: startOffset === null ? null : new Date(now + startOffset).toISOString(),
      closes_at: endOffset === null ? null : new Date(now + endOffset).toISOString() };
    try {
      expect((await put('/api/admin/settings/voting', window, { cookie: admin })).status).toBe(200);
      expect((await ds.query("SELECT value FROM settings WHERE key = 'voting'"))[0].value).toEqual(window);
      const result = await post('/api/public/votes', { categoryId: catA, exhibitorId: exA }, visitor);
      expect(result.status).toBe(reason ? 403 : 201);
      if (reason) {
        expect(result.data.error).toBe('voting_closed');
        expect(result.data.voting.reason).toBe(reason);
      }
      const count = (await ds.query('SELECT COUNT(*)::int AS n FROM votes WHERE ip = $1', [visitor.ip]))[0].n;
      expect(count).toBe(reason ? 0 : 1);
      const state = await get('/api/public/state', visitor);
      expect(state.data.voting.open).toBe(!reason);
      if (reason) expect(state.data.voting.reason).toBe(reason);
    } finally { await settings.update('voting', previous); }
  });

  it('applies admin close and reopen immediately to an existing visitor session', async () => {
    const visitor = await verifiedVisitor();
    const previous = (await settings.getAll(true)).voting;
    const admin = await adminCookie();
    try {
      expect((await put('/api/admin/settings/voting', { open: false }, { cookie: admin })).status).toBe(200);
      expect((await post('/api/public/votes', { categoryId: catA, exhibitorId: exA }, visitor)).status).toBe(403);
      expect((await put('/api/admin/settings/voting', { open: true }, { cookie: admin })).status).toBe(200);
      expect((await post('/api/public/votes', { categoryId: catA, exhibitorId: exA }, visitor)).status).toBe(201);
      expect((await put('/api/admin/settings/voting', { open: false }, { cookie: admin })).status).toBe(200);
      expect((await post('/api/public/votes', { categoryId: catB, exhibitorId: exC }, visitor)).status).toBe(403);
      expect((await ds.query('SELECT COUNT(*)::int AS n FROM votes WHERE ip = $1', [visitor.ip]))[0].n).toBe(1);
    } finally { await settings.update('voting', previous); }
  });
});

describe('live results dashboard', () => {
  it('increments database, polling and live SSE counts and revokes connected screens on rotation', async () => {
    const admin = await adminCookie();
    const visitor = await verifiedVisitor();
    const oldKey = (await settings.getAll(true)).display.key!;
    const display = await post('/api/display/auth', { key: oldKey }, { ip: freshIp() });
    expect(display.status).toBe(200);
    const before = await get('/api/display/results', { cookie: display.cookies });
    const countA = (snapshot: any) => snapshot.categories.find((c: any) => c.id === catA).standings.find((s: any) => s.id === exA).votes;
    const baseline = countA(before.data);
    const server = app.getHttpServer();
    if (!server.listening) await app.listen(0, '127.0.0.1');
    const address = server.address() as AddressInfo;
    const snapshots: any[] = [];
    let response: IncomingMessage | undefined;
    let ended = false;
    let received = '';
    const waitFor = async (predicate: () => boolean) => {
      const deadline = Date.now() + 5000;
      while (!predicate() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
      expect(predicate()).toBe(true);
    };
    const stream = httpGet(`http://127.0.0.1:${address.port}/api/display/stream`, { headers: { cookie: display.cookies } }, (res) => {
      response = res;
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        received += chunk.replace(/\r\n/g, '\n');
        let end: number;
        while ((end = received.indexOf('\n\n')) >= 0) {
          const frame = received.slice(0, end);
          received = received.slice(end + 2);
          if (frame.includes('event: results')) {
            const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
            snapshots.push(JSON.parse(data));
          }
        }
      });
      res.on('end', () => { ended = true; });
      res.on('error', () => { ended = true; });
    });
    stream.on('error', () => { ended = true; });
    try {
      await waitFor(() => snapshots.length > 0);
      expect(response!.statusCode).toBe(200);
      expect(response!.headers['content-type']).toContain('text/event-stream');
      expect(countA(snapshots[0])).toBe(baseline);
      expect((await post('/api/public/votes', { categoryId: catA, exhibitorId: exA }, visitor)).status).toBe(201);
      await waitFor(() => snapshots.some((snapshot) => countA(snapshot) === baseline + 1));
      const updated = await get('/api/display/results', { cookie: display.cookies });
      expect(countA(updated.data)).toBe(baseline + 1);
      const db = (await ds.query('SELECT COUNT(*)::int AS n FROM votes WHERE category_id = $1 AND exhibitor_id = $2', [catA, exA]))[0].n;
      expect(db).toBe(baseline + 1);
      expect((await post('/api/public/votes', { categoryId: catA, exhibitorId: exA }, visitor)).status).toBe(409);
      expect(countA((await get('/api/admin/results', { cookie: admin })).data)).toBe(baseline + 1);

      // Even a replacement sharing the former six-character prefix must revoke access.
      await settings.update('display', { key: oldKey.slice(0, 6) + 'different-key-suffix' });
      await waitFor(() => ended);
      for (const endpoint of ['/api/display/results', '/api/display/stream', '/api/display/qr']) {
        expect((await get(endpoint, { cookie: display.cookies })).status).toBe(401);
        expect((await get(endpoint, visitor)).status).toBe(401);
        expect((await get(endpoint)).status).toBe(401);
      }
      expect((await post('/api/display/auth', { key: oldKey }, { ip: freshIp() })).status).toBe(401);
      expect((await post('/api/admin/display/rotate', {}, { cookie: admin })).status).toBe(200);
      const freshKey = (await settings.getAll(true)).display.key!;
      expect(freshKey).not.toBe(oldKey);
      const fresh = await post('/api/display/auth', { key: freshKey }, { ip: freshIp() });
      expect(fresh.status).toBe(200);
      expect((await get('/api/display/results', { cookie: fresh.cookies })).status).toBe(200);
      expect((await get('/api/display/qr', { cookie: fresh.cookies })).status).toBe(200);
      expect((await get('/api/display/results', { cookie: admin })).status).toBe(200);
      expect((await post('/api/admin/results/reset', { confirm: 'RESET' }, { cookie: fresh.cookies })).status).toBe(401);
    } finally { stream.destroy(); response?.destroy(); }
  });

  it('requires the display key or an admin session; rotating the key revokes screens', async () => {
    expect((await get('/api/display/results')).status).toBe(401);
    expect((await post('/api/display/auth', { key: 'nope' })).status).toBe(401);
    const s = await settings.getAll(true);
    const a = await post('/api/display/auth', { key: s.display.key });
    expect(a.status).toBe(200);
    const r = await get('/api/display/results', { cookie: a.cookies });
    expect(r.status).toBe(200);
    expect(r.data.categories[0].standings.length).toBeGreaterThan(0);
    await post('/api/admin/display/rotate', {}, { cookie: await adminCookie() });
    expect((await get('/api/display/results', { cookie: a.cookies })).status).toBe(401);
  });
});

describe('admin', () => {
  it('admin endpoints require authentication; visitors cannot reach them', async () => {
    expect((await get('/api/admin/results')).status).toBe(401);
    const v = await verifiedVisitor();
    expect((await get('/api/admin/visitors', { cookie: v.cookie })).status).toBe(401);
    expect((await post('/api/admin/login', { username: 'root', password: 'wrong-password' })).status).toBe(401);
  });

  it('viewer role is read-only', async () => {
    const cookie = await adminCookie();
    expect((await post('/api/admin/users', { username: 'staff', password: 'staff-password-1', role: 'viewer' }, { cookie })).status).toBe(201);
    const v = (await post('/api/admin/login', { username: 'staff', password: 'staff-password-1' })).cookies;
    expect((await get('/api/admin/results', { cookie: v })).status).toBe(200);
    expect((await put('/api/admin/settings/voting', { open: false }, { cookie: v })).status).toBe(403);
    expect((await get('/api/admin/visitors', { cookie: v })).status).toBe(403);
  });

  it('manages categories and exhibitors (with photo upload) and tallies follow', async () => {
    const cookie = await adminCookie();
    const c = await post('/api/admin/categories', { name: 'Cat C', description: 'third' }, { cookie });
    expect(c.status).toBe(201);
    const renamed = await put(`/api/admin/categories/${c.data.category.id}`, { name: 'Updated Cat C', description: 'third' }, { cookie });
    expect(renamed.status).toBe(200);
    expect(renamed.data.category.name).toBe('Updated Cat C');
    const img = fs.readFileSync(path.join(__dirname, '..', 'seed', 'images', 'ex01.jpg'));
    const up = await request(app.getHttpServer()).post('/api/admin/exhibitors').set('x-requested-with', 'mc2026').set('cookie', cookie)
      .field('name', 'New Maker').field('project', 'Robot').field('description', 'A sample robot project.').field('category_ids', JSON.stringify([c.data.category.id]))
      .attach('photo', img, { filename: 'p.jpg', contentType: 'image/jpeg' });
    expect(up.status).toBe(201);
    const imgId = up.body.exhibitor.image_id;
    const served = await request(app.getHttpServer()).get(`/img/${imgId}`);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/jpeg');
    const fake = await request(app.getHttpServer()).post('/api/admin/exhibitors').set('x-requested-with', 'mc2026').set('cookie', cookie)
      .field('name', 'Bad').attach('photo', Buffer.from('<svg>evil</svg>'), { filename: 'x.jpg', contentType: 'image/jpeg' });
    expect(fake.status).toBe(400);
    expect((await call('delete', `/api/admin/categories/${c.data.category.id}`, { cookie })).status).toBe(409);
    expect((await call('delete', `/api/admin/exhibitors/${up.body.exhibitor.id}`, { cookie })).status).toBe(200);
    expect((await call('delete', `/api/admin/categories/${c.data.category.id}`, { cookie })).status).toBe(200);
    const results = await get('/api/admin/results', { cookie });
    const a = results.data.categories.find((x: { id: number }) => x.id === catA);
    expect(a.total).toBe(a.standings.reduce((s: number, x: { votes: number }) => s + x.votes, 0));
  });

  it('rejects incomplete active exhibitors and invalid category assignments without partial writes', async () => {
    const cookie = await adminCookie();
    const img = fs.readFileSync(path.join(__dirname, '..', 'seed', 'images', 'ex01.jpg'));
    const before = (await ds.query('SELECT COUNT(*)::int AS n FROM exhibitors'))[0].n;
    const imagesBefore = (await ds.query('SELECT COUNT(*)::int AS n FROM images'))[0].n;
    for (const ids of [[999999], [catA, 999999], [], ['garbage'], [null], [0], [-1], [1.5]]) {
      const r = await request(app.getHttpServer()).post('/api/admin/exhibitors')
        .set('x-requested-with', 'mc2026').set('cookie', cookie)
        .field('name', 'Invalid Assignment').field('description', 'A sample project.')
        .field('category_ids', JSON.stringify(ids)).attach('photo', img, { filename: 'p.jpg', contentType: 'image/jpeg' });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('bad_categories');
    }
    const noPhoto = await request(app.getHttpServer()).post('/api/admin/exhibitors')
      .set('x-requested-with', 'mc2026').set('cookie', cookie).field('name', 'No Photo')
      .field('description', 'A sample project.').field('category_ids', JSON.stringify([catA]));
    expect(noPhoto.status).toBe(400);
    expect(noPhoto.body.error).toBe('photo_required');
    const noDescription = await request(app.getHttpServer()).post('/api/admin/exhibitors')
      .set('x-requested-with', 'mc2026').set('cookie', cookie).field('name', 'No Description')
      .field('category_ids', JSON.stringify([catA])).attach('photo', img, { filename: 'p.jpg', contentType: 'image/jpeg' });
    expect(noDescription.status).toBe(400);
    expect(noDescription.body.error).toBe('bad_description');
    expect((await ds.query('SELECT COUNT(*)::int AS n FROM exhibitors'))[0].n).toBe(before);
    expect((await ds.query('SELECT COUNT(*)::int AS n FROM images'))[0].n).toBe(imagesBefore);
  });

  it('supports multiple categories, preserves existing photos, and rolls back invalid edits', async () => {
    const cookie = await adminCookie();
    const img = fs.readFileSync(path.join(__dirname, '..', 'seed', 'images', 'ex01.jpg'));
    const up = await request(app.getHttpServer()).post('/api/admin/exhibitors')
      .set('x-requested-with', 'mc2026').set('cookie', cookie).field('name', 'Complete Maker')
      .field('description', 'Complete project description.').field('category_ids', JSON.stringify([catA, catB, catA]))
      .attach('photo', img, { filename: 'p.jpg', contentType: 'image/jpeg' });
    expect(up.status).toBe(201);
    const id = up.body.exhibitor.id;
    const imageId = up.body.exhibitor.image_id;
    const edit = (ids: number[], remove = false) => request(app.getHttpServer()).put(`/api/admin/exhibitors/${id}`)
      .set('x-requested-with', 'mc2026').set('cookie', cookie).field('name', 'Edited Maker')
      .field('description', 'Updated description.').field('category_ids', JSON.stringify(ids))
      .field('remove_photo', String(remove));
    const updated = await edit([catA, catB]);
    expect({ status: updated.status, body: updated.body }).toMatchObject({ status: 200 });
    expect((await edit([catA, 999999])).status).toBe(400);
    expect((await edit([catA], true)).status).toBe(400);
    const saved = (await ds.query('SELECT name,image_id FROM exhibitors WHERE id=$1', [id]))[0];
    expect(saved).toEqual({ name: 'Edited Maker', image_id: imageId });
    expect((await ds.query('SELECT category_id FROM exhibitor_categories WHERE exhibitor_id=$1 ORDER BY category_id', [id])).map((r: any) => r.category_id)).toEqual([catA, catB]);
    expect((await call('delete', `/api/admin/exhibitors/${id}`, { cookie })).status).toBe(200);
    expect((await edit([catA])).status).toBe(404);
  });

  it('a category with votes cannot be deleted without force', async () => {
    expect((await call('delete', `/api/admin/categories/${catA}`, { cookie: await adminCookie() })).status).toBe(409);
  });

  it('exports results and visitors as CSV (decrypted, formula-safe)', async () => {
    const cookie = await adminCookie();
    const r = await get('/api/admin/export/results.csv', { cookie });
    expect(r.status).toBe(200);
    expect(r.text).toMatch(/category,rank,exhibitor/);
    expect((await get('/api/admin/export/visitors.csv', { cookie })).text).toMatch(/Test Visitor,9627/);
  });

  it('stores phone numbers encrypted at rest', async () => {
    const rows = await ds.query('SELECT phone_enc FROM visitors LIMIT 5');
    for (const r of rows) {
      expect(r.phone_enc.startsWith('v1:')).toBe(true);
      expect(/\d{9}/.test(r.phone_enc)).toBe(false);
    }
  });

  it('MFA: enrol, then login requires the TOTP code', async () => {
    const cookie = await adminCookie();
    const s = await post('/api/admin/mfa/setup', {}, { cookie });
    expect(s.status).toBe(200);
    const wrong = currentTotp(s.data.secret) === '000000' ? '111111' : '000000';
    expect((await post('/api/admin/mfa/enable', { code: wrong }, { cookie })).status).toBe(400);
    expect((await post('/api/admin/mfa/enable', { code: currentTotp(s.data.secret) }, { cookie })).status).toBe(200);
    const step1 = await post('/api/admin/login', { username: 'root', password: 'root-password-123' });
    expect(step1.data.mfaRequired).toBe(true);
    expect((await get('/api/admin/me', { cookie: step1.cookies })).status).toBe(401); // pending cookie is not a session
    const step2 = await post('/api/admin/login/mfa', { code: currentTotp(s.data.secret) }, { cookie: step1.cookies });
    expect(step2.status).toBe(200);
    expect((await get('/api/admin/me', { cookie: step2.cookies })).status).toBe(200);
  });

  it('reset deletes votes and keeps a snapshot in the audit log', async () => {
    const cookie = await adminCookie();
    const previous = (await settings.getAll(true)).voting;
    try {
    expect((await post('/api/admin/results/reset', { confirm: 'nope' }, { cookie })).status).toBe(400);
    const r = await post('/api/admin/results/reset', { confirm: 'RESET' }, { cookie });
    expect(r.status).toBe(200);
    expect(r.data.deleted).toBeGreaterThan(0);
    const audit = await ds.query(`SELECT detail FROM audit_log WHERE action = 'results_reset' ORDER BY id DESC LIMIT 1`);
    expect(audit[0].detail.snapshot.categories.length).toBeGreaterThanOrEqual(2);
    expect((await ds.query('SELECT COUNT(*)::int AS n FROM votes'))[0].n).toBe(0);
    expect((await settings.getAll(true)).voting.open).toBe(false);
    } finally { await settings.update('voting', previous); }
  });
});

describe('visitor privacy and export minimization', () => {
  it('encrypts identities, isolates visitor sessions and separates results from outreach data', async () => {
    const admin = await adminCookie();
    const people: { name: string; phone: string; ip: string; cookie: string; id: string; consent: boolean }[] = [];
    try {
      for (const consent of [true, false]) {
        const name = consent ? 'Privacy Consenting Marker' : 'Privacy Nonconsenting Marker';
        const phone = freshPhone(), ip = freshIp();
        const sent = await post('/api/public/otp/request', { name, phone, consent }, { ip });
        expect(sent.status).toBe(200);
        expect(sent.data.phone).not.toContain(phone);
        expect(sent.data.phone).not.toContain(`962${phone.slice(1)}`);
        const verified = await post('/api/public/otp/verify', { challengeId: sent.data.challengeId, code: sent.data.devCode }, { ip });
        expect(verified.status).toBe(200);
        const row = (await ds.query('SELECT id, name_enc, phone_enc, phone_hash FROM visitors WHERE created_ip = $1', [ip]))[0];
        people.push({ name, phone, ip, cookie: verified.cookies, id: row.id, consent });
        expect(row.name_enc.startsWith('v1:')).toBe(true);
        expect(row.phone_enc.startsWith('v1:')).toBe(true);
        expect(row.name_enc).not.toContain(name);
        expect(row.phone_enc).not.toContain(phone);
        expect(row.phone_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(decrypt(row.name_enc)).toBe(name);
        expect(decrypt(row.phone_enc)).toBe(`962${phone.slice(1)}`);
        const payload = app.get(SessionService).verify(verified.cookies.split('mc_v=')[1].split(';')[0]);
        expect(payload).toMatchObject({ typ: 'visitor', sub: row.id });
        expect(JSON.stringify(payload)).not.toContain(name);
        expect(JSON.stringify(payload)).not.toContain(phone);
        expect((await post('/api/public/votes', { categoryId: catA, exhibitorId: exA }, { ip, cookie: verified.cookies })).status).toBe(201);
      }
      const anonymous = await get('/api/public/state');
      expect(anonymous.data.session).toBeNull();
      const own = await get(`/api/public/me?visitorId=${people[0].id}`, { cookie: people[1].cookie });
      expect(own.data.session.name).toBe(people[1].name);
      expect(JSON.stringify(own.data)).not.toContain(people[0].name);
      expect(JSON.stringify(own.data)).not.toContain(people[1].phone);

      const privateList = await get('/api/admin/visitors', { cookie: admin });
      expect(privateList.status).toBe(200);
      expect(privateList.headers['cache-control']).toBe('no-store');
      for (const person of people) {
        const record = privateList.data.visitors.find((v: { id: string }) => v.id === person.id);
        expect(record.name).toBe(person.name);
        expect(record.phone).toContain(person.phone.slice(-4));
        expect(record.phone).not.toContain(person.phone);
        expect(Object.keys(record).sort()).toEqual(['id', 'name', 'phone', 'verified_at', 'consent_outreach', 'votes'].sort());
      }
      const outreach = await get('/api/admin/export/visitors.csv', { cookie: admin });
      expect(outreach.status).toBe(200);
      expect(outreach.headers['cache-control']).toBe('no-store');
      expect(outreach.text.replace(/^\uFEFF/, '').split('\r\n')[0]).toBe('name,phone,verified_at,consent_outreach');
      for (const person of people) {
        expect(outreach.text).toContain(`${person.name},962${person.phone.slice(1)},`);
        expect(outreach.text).not.toContain(person.id);
      }
      const consented = await get('/api/admin/export/visitors.csv?consented=true', { cookie: admin });
      expect(consented.text).toContain(people[0].name);
      expect(consented.text).not.toContain(people[1].name);

      const display = await post('/api/display/auth', { key: (await settings.getAll(true)).display.key }, { ip: freshIp() });
      for (const endpoint of ['/api/admin/results', '/api/admin/export/results.csv', '/api/admin/export/results.json', '/api/admin/audit', '/api/display/results']) {
        const result = await get(endpoint, { cookie: endpoint.startsWith('/api/display') ? display.cookies : admin });
        expect(result.status).toBe(200);
        for (const person of people) {
          expect(result.text).not.toContain(person.name);
          expect(result.text).not.toContain(person.phone);
          expect(result.text).not.toContain(`962${person.phone.slice(1)}`);
          expect(result.text).not.toContain(person.id);
        }
        for (const field of ['name_enc', 'phone_enc', 'phone_hash', 'payload_enc', 'visitor_id']) expect(result.text).not.toContain(field);
      }
      const viewer = await post('/api/admin/login', { username: 'permission-viewer', password: 'permission-password-123' }, { ip: freshIp() });
      expect(viewer.status).toBe(200);
      for (const actor of [{ cookie: undefined, status: 401 }, { cookie: people[0].cookie, status: 401 }, { cookie: display.cookies, status: 401 }, { cookie: viewer.cookies, status: 403 }]) {
        for (const endpoint of ['/api/admin/visitors', '/api/admin/export/visitors.csv', '/api/admin/export/visitors.csv?consented=true']) {
          const result = await get(endpoint, { cookie: actor.cookie });
          expect(result.status).toBe(actor.status);
          expect(result.text).not.toContain(people[0].name);
          expect(result.text).not.toContain(people[0].phone);
        }
      }
    } finally {
      for (const person of people) await ds.query('DELETE FROM visitors WHERE id = $1', [person.id]);
    }
  });

  it('omits the development OTP echo when demo echo is disabled', async () => {
    const previous = config.otp.devEcho;
    try {
      config.otp.devEcho = false;
      const sent = await post('/api/public/otp/request', { name: 'No Echo Visitor', phone: freshPhone() }, { ip: freshIp() });
      expect(sent.status).toBe(200);
      expect(sent.data.devCode).toBeUndefined();
      expect(Object.keys(sent.data).sort()).toEqual(['challengeId', 'phone', 'expiresIn', 'resendIn'].sort());
    } finally { config.otp.devEcho = previous; }
  });
});

describe('admin consistency fixes', () => {
  it('rejects conflicting category updates without altering the original row', async () => {
    const cookie = await adminCookie();
    const one = await post('/api/admin/categories', { name: 'Conflict One', slug: 'conflict-one' }, { cookie });
    const two = await post('/api/admin/categories', { name: 'Conflict Two', slug: 'conflict-two' }, { cookie });
    const id = two.data.category.id;
    try {
      const conflict = await put(`/api/admin/categories/${id}`, { name: 'Changed', slug: 'conflict-one' }, { cookie });
      expect(conflict.status).toBe(409);
      expect(conflict.data.error).toBe('exists');
      expect((await ds.query('SELECT name, slug FROM categories WHERE id = $1', [id]))[0]).toEqual({ name: 'Conflict Two', slug: 'conflict-two' });
      expect((await put(`/api/admin/categories/${id}`, { name: 'Changed', slug: 'conflict-two' }, { cookie })).status).toBe(200);
    } finally { await ds.query('DELETE FROM categories WHERE id = ANY($1::int[])', [[one.data.category.id, id]]); }
  });

  it('validates merged schedule ordering and requires explicit timezone offsets', async () => {
    const cookie = await adminCookie();
    const previous = (await settings.getAll(true)).voting;
    const valid = { open: true, opens_at: '2026-10-20T09:00:00.000Z', closes_at: '2026-10-20T12:00:00.000Z' };
    try {
      expect((await put('/api/admin/settings/voting', valid, { cookie })).status).toBe(200);
      for (const patch of [
        { closes_at: valid.opens_at }, { closes_at: '2026-10-20T08:00:00Z' },
        { opens_at: valid.closes_at }, { opens_at: '2026-10-20T13:00:00Z' },
        { opens_at: '2026-10-21T09:00:00Z', closes_at: '2026-10-20T12:00:00Z' },
      ]) {
        const rejected = await put('/api/admin/settings/voting', patch, { cookie });
        expect(rejected.status).toBe(400);
        expect(rejected.data.error).toBe('bad_voting_window');
        expect((await settings.getAll(true)).voting).toEqual(valid);
      }
      expect((await put('/api/admin/settings/voting', { opens_at: 'invalid-date' }, { cookie })).data.error).toBe('bad_date');
      expect((await put('/api/admin/settings/voting', { closes_at: null }, { cookie })).status).toBe(200);
      expect((await put('/api/admin/settings/voting', { opens_at: '2026-10-20T09:00' }, { cookie })).data.error).toBe('bad_date');
      expect((await put('/api/admin/settings/voting', { opens_at: null }, { cookie })).status).toBe(200);
    } finally { await settings.update('voting', previous); }
  });

  it.each(['results_reset', 'visitors_purged'])('rolls back vote deletion and visitor purge when %s audit insertion fails', async (action) => {
    const cookie = await adminCookie(), visitor = await verifiedVisitor();
    expect((await post('/api/public/votes', { categoryId: catA, exhibitorId: exA }, visitor)).status).toBe(201);
    const before = await ds.query('SELECT id FROM votes ORDER BY id');
    const visitorsBefore = (await ds.query('SELECT COUNT(*)::int AS n FROM visitors'))[0].n;
    await ds.query(`CREATE FUNCTION fail_reset_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action = '${action}' THEN RAISE EXCEPTION 'Injected reset audit failure'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER fail_reset_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_reset_audit()`);
    try {
      expect((await post('/api/admin/results/reset', { confirm: 'RESET', purgeVisitors: true }, { cookie })).status).toBe(500);
      expect(await ds.query('SELECT id FROM votes ORDER BY id')).toEqual(before);
      expect((await ds.query('SELECT COUNT(*)::int AS n FROM visitors'))[0].n).toBe(visitorsBefore);
    } finally {
      await ds.query('DROP TRIGGER fail_reset_audit ON audit_log; DROP FUNCTION fail_reset_audit()');
      await ds.query('DELETE FROM votes WHERE ip = $1', [visitor.ip]);
    }
  });

  it('serializes a reset and a queued vote, preserving the exact deleted snapshot', async () => {
    const cookie = await adminCookie(), visitor = await verifiedVisitor();
    const previous = (await settings.getAll(true)).voting;
    expect((await post('/api/public/votes', { categoryId: catA, exhibitorId: exA }, visitor)).status).toBe(201);
    const blocker = ds.createQueryRunner();
    await blocker.connect();
    await blocker.startTransaction();
    await blocker.query('LOCK TABLE votes IN ROW EXCLUSIVE MODE');
    let reset: ReturnType<typeof post> | undefined;
    let vote: ReturnType<typeof post> | undefined;
    try {
      reset = post('/api/admin/results/reset', { confirm: 'RESET' }, { cookie });
      const deadline = Date.now() + 5000;
      let waiting = false;
      while (!waiting && Date.now() < deadline) {
        waiting = (await ds.query("SELECT 1 FROM pg_locks WHERE relation = 'votes'::regclass AND mode = 'ShareRowExclusiveLock' AND NOT granted")).length > 0;
        if (!waiting) await new Promise((r) => setTimeout(r, 20));
      }
      expect(waiting).toBe(true);
      vote = post('/api/public/votes', { categoryId: catB, exhibitorId: exC }, visitor);
      await blocker.commitTransaction();
      expect((await reset).status).toBe(200);
      expect((await vote).status).toBe(403);
      const audit = (await ds.query("SELECT detail FROM audit_log WHERE action = 'results_reset' ORDER BY id DESC LIMIT 1"))[0].detail;
      expect(audit.deleted_votes).toBe(1);
      expect(audit.snapshot.totals.votes).toBe(1);
      expect((await ds.query('SELECT category_id FROM votes WHERE ip = $1', [visitor.ip])).map((r: { category_id: number }) => r.category_id)).toEqual([]);
    } finally {
      if (blocker.isTransactionActive) await blocker.rollbackTransaction();
      await blocker.release();
      await Promise.allSettled([reset, vote].filter(Boolean));
      await ds.query('DELETE FROM votes WHERE ip = $1', [visitor.ip]);
      await settings.update('voting', previous);
    }
  });
});

describe('exhibitor identity per category', () => {
  it('rejects duplicate creates and edits, permits other categories, and protects concurrent creates', async () => {
    const cookie = await adminCookie();
    const image = fs.readFileSync(path.join(__dirname, '..', 'seed', 'images', 'ex01.jpg'));
    const createdIds: number[] = [];
    const submit = (ids: number[], name = 'Unique Demo Team', project = 'Unique Demo Project', id?: number) => {
      const req = request(app.getHttpServer())[id ? 'put' : 'post'](id ? `/api/admin/exhibitors/${id}` : '/api/admin/exhibitors')
        .set('cookie', cookie).set('x-requested-with', 'mc2026').field('name', name).field('project', project)
        .field('description', 'Duplicate-category verification.').field('category_ids', JSON.stringify(ids));
      return id ? req : req.attach('photo', image, { filename: 'test.jpg', contentType: 'image/jpeg' });
    };
    try {
      const first = await submit([catA, catA]);
      expect(first.status).toBe(201);
      createdIds.push(first.body.exhibitor.id);
      const before = (await ds.query('SELECT COUNT(*)::int AS n FROM images'))[0].n;
      for (const ids of [[catA], [catA, catB]]) {
        const duplicate = await submit(ids, '  UNIQUE  DEMO TEAM ', 'unique demo  project');
        expect(duplicate.status).toBe(409);
        expect(duplicate.body.error).toBe('duplicate_category_assignment');
      }
      expect((await ds.query('SELECT COUNT(*)::int AS n FROM images'))[0].n).toBe(before);
      const otherCategory = await submit([catB]);
      expect(otherCategory.status).toBe(201);
      createdIds.push(otherCategory.body.exhibitor.id);
      const conflict = await submit([catA, catB], 'Unique Demo Team', 'Unique Demo Project', createdIds[1]);
      expect(conflict.status).toBe(409);
      expect(conflict.body.error).toBe('duplicate_category_assignment');
      expect((await ds.query('SELECT category_id FROM exhibitor_categories WHERE exhibitor_id = $1', [createdIds[1]]))[0].category_id).toBe(catB);
      const differentProject = await submit([catA, catB], 'Unique Demo Team', 'Another Project');
      expect(differentProject.status).toBe(201);
      createdIds.push(differentProject.body.exhibitor.id);
      const renamed = await submit([catA, catB], 'Unique Demo Team', 'Unique Demo Project', createdIds[2]);
      expect(renamed.status).toBe(409);
      expect((await ds.query('SELECT project FROM exhibitors WHERE id = $1', [createdIds[2]]))[0].project).toBe('Another Project');
      // A rename and reassignment must validate the final state, not the old categories.
      expect((await submit([catB], 'Moved Demo Team', 'Moved Project', createdIds[0])).status).toBe(200);
      expect((await submit([catA, catB], 'Moved Demo Team', 'Moved Project', createdIds[0])).status).toBe(200);
      const concurrent = await Promise.all([submit([catA], 'Concurrent Duplicate Team'), submit([catA], 'Concurrent Duplicate Team')]);
      for (const r of concurrent) if (r.status === 201) createdIds.push(r.body.exhibitor.id);
      expect(concurrent.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(concurrent.find((r) => r.status === 409)!.body.error).toBe('duplicate_category_assignment');
      const direct = (await ds.query("INSERT INTO exhibitors (name, project) VALUES ('Moved Demo Team','Moved Project') RETURNING id"))[0].id;
      createdIds.push(direct);
      await expect(ds.query('INSERT INTO exhibitor_categories (exhibitor_id, category_id) VALUES ($1,$2)', [direct, catA])).rejects.toMatchObject({ code: '23505', constraint: 'unique_exhibitor_identity_per_category' });
    } finally {
      await ds.query('DELETE FROM exhibitors WHERE id = ANY($1::int[])', [createdIds]);
    }
  });
});

describe('complete admin event workflow', () => {
  it('manages the catalog, runs voting, exports and resets results, then cleans up', async () => {
    const cookie = await adminCookie();
    const previous = (await settings.getAll(true)).voting;
    const categoryIds: number[] = [];
    let exhibitorId: number | undefined;
    const image = fs.readFileSync(path.join(__dirname, '..', 'seed', 'images', 'ex01.jpg'));
    const form = (method: 'post' | 'put', ids: number[], name: string) => {
      const url = method === 'post' ? '/api/admin/exhibitors' : `/api/admin/exhibitors/${exhibitorId}`;
      const req = request(app.getHttpServer())[method](url).set('cookie', cookie).set('x-requested-with', 'mc2026')
        .field('name', name).field('project', 'Workflow Project').field('description', 'Admin workflow demonstration.')
        .field('category_ids', JSON.stringify(ids));
      return method === 'post' ? req.attach('photo', image, { filename: 'workflow.jpg', contentType: 'image/jpeg' }) : req;
    };
    try {
      expect((await put('/api/admin/settings/voting', { open: false, opens_at: null, closes_at: null }, { cookie })).status).toBe(200);
      expect((await post('/api/admin/categories', { name: '' }, { cookie })).status).toBe(400);
      for (let i = 1; i <= 3; i++) {
        const made = await post('/api/admin/categories', { name: `Workflow Category ${i}`, slug: `workflow-${i}` }, { cookie });
        expect(made.status).toBe(201);
        categoryIds.push(made.data.category.id);
      }
      expect((await post('/api/admin/categories', { name: 'Duplicate', slug: 'workflow-1' }, { cookie })).status).toBe(409);
      const updatedCategory = await put(`/api/admin/categories/${categoryIds[0]}`, { name: 'Workflow Innovation', slug: 'workflow-1' }, { cookie });
      expect(updatedCategory.status).toBe(200);
      expect(updatedCategory.data.category.name).toBe('Workflow Innovation');
      expect((await get('/api/admin/categories', { cookie })).data.categories.filter((c: { id: number }) => categoryIds.includes(c.id))).toHaveLength(3);

      const created = await form('post', [categoryIds[0]], 'Workflow Maker');
      expect(created.status).toBe(201);
      exhibitorId = created.body.exhibitor.id;
      expect((await form('put', [categoryIds[0], 2147483647], 'Invalid Workflow Edit')).status).toBe(400);
      const edited = await form('put', categoryIds, 'Workflow Maker Updated');
      expect(edited.status).toBe(200);
      const listed = (await get('/api/admin/exhibitors', { cookie })).data.exhibitors.find((e: { id: number }) => e.id === exhibitorId);
      expect(listed.name).toBe('Workflow Maker Updated');
      expect([...listed.category_ids].sort((a: number, b: number) => a - b)).toEqual(categoryIds);
      expect(listed.image_id).toBe(created.body.exhibitor.image_id);
      expect((await get(listed.image)).status).toBe(200);

      expect((await put('/api/admin/settings/voting', { open: true }, { cookie })).status).toBe(200);
      const visitor = await verifiedVisitor();
      const ballot = await get('/api/public/state', visitor);
      expect(ballot.data.exhibitors.find((e: { id: number }) => e.id === exhibitorId).category_ids).toEqual(categoryIds);
      for (const categoryId of categoryIds) expect((await post('/api/public/votes', { categoryId, exhibitorId }, visitor)).status).toBe(201);
      expect((await call('delete', `/api/admin/exhibitors/${exhibitorId}`, { cookie })).status).toBe(409);
      expect((await call('delete', `/api/admin/categories/${categoryIds[0]}`, { cookie })).status).toBe(409);

      const results = await get('/api/admin/results', { cookie });
      expect(results.status).toBe(200);
      for (const categoryId of categoryIds) {
        const category = results.data.categories.find((c: { id: number }) => c.id === categoryId);
        expect(category.total).toBe(1);
        expect(category.standings).toContainEqual(expect.objectContaining({ id: exhibitorId, votes: 1, rank: 1 }));
      }
      const json = await get('/api/admin/export/results.json', { cookie });
      expect(json.status).toBe(200);
      expect(json.data.categories).toEqual(results.data.categories);
      const csv = await get('/api/admin/export/results.csv', { cookie });
      expect(csv.status).toBe(200);
      expect(csv.text).toContain('Workflow Innovation,1,Workflow Maker Updated,Workflow Project,,1,100.0');
      expect(csv.text.split('\r\n').filter((line) => line.includes('Workflow Maker Updated'))).toHaveLength(3);

      expect((await put('/api/admin/settings/voting', { open: false }, { cookie })).status).toBe(200);
      expect((await get('/api/admin/settings', { cookie })).data.voting.open).toBe(false);
      expect((await post('/api/public/votes', { categoryId: categoryIds[0], exhibitorId }, visitor)).status).toBe(403);
      const visitorsBefore = (await ds.query('SELECT COUNT(*)::int AS n FROM visitors'))[0].n;
      expect((await post('/api/admin/results/reset', { confirm: 'wrong' }, { cookie })).status).toBe(400);
      expect((await get('/api/admin/results', { cookie })).data.totals.votes).toBe(3);
      const reset = await post('/api/admin/results/reset', { confirm: 'RESET', purgeVisitors: false }, { cookie });
      expect(reset.status).toBe(200);
      expect(reset.data.deleted).toBe(3);
      expect((await get('/api/admin/results', { cookie })).data.totals.votes).toBe(0);
      expect((await get('/api/public/me', visitor)).data.session.votes).toEqual({});
      expect((await ds.query('SELECT COUNT(*)::int AS n FROM visitors'))[0].n).toBe(visitorsBefore);
      const snapshot = (await ds.query("SELECT detail FROM audit_log WHERE action = 'results_reset' ORDER BY id DESC LIMIT 1"))[0].detail;
      expect(snapshot.snapshot.totals.votes).toBe(3);

      expect((await call('delete', `/api/admin/exhibitors/${exhibitorId}`, { cookie })).status).toBe(200);
      expect((await get('/api/admin/exhibitors', { cookie })).data.exhibitors.some((e: { id: number }) => e.id === exhibitorId)).toBe(false);
      for (const id of categoryIds) expect((await call('delete', `/api/admin/categories/${id}`, { cookie })).status).toBe(200);
      const audit = await get('/api/admin/audit', { cookie });
      expect(audit.status).toBe(200);
      for (const action of ['category_created', 'category_updated', 'exhibitor_created', 'exhibitor_updated', 'settings_updated', 'results_exported', 'results_reset', 'exhibitor_deleted', 'category_deleted']) {
        expect(audit.data.entries.some((e: { action: string }) => e.action === action)).toBe(true);
      }
    } finally {
      // Cleanup only this test's temporary rows in the disposable test database.
      await ds.query('DELETE FROM votes WHERE category_id = ANY($1::int[])', [categoryIds]);
      if (exhibitorId) await ds.query('DELETE FROM exhibitors WHERE id = $1', [exhibitorId]);
      await ds.query('DELETE FROM categories WHERE id = ANY($1::int[])', [categoryIds]);
      await settings.update('voting', previous);
    }
  });
});
