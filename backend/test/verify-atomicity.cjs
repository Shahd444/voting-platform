const assert = require('node:assert/strict');
const { DataSource } = require('typeorm');
module.exports = async (app, request) => {
  const { SettingsService } = require('./dist/settings/settings.service');
  const { CatalogService } = require('./dist/admin/catalog.service');
  const { AdminAuthService } = require('./dist/admin/admin-auth.service');
  const { VisitorService } = require('./dist/visitor/visitor.service');
  const { SmsService } = require('./dist/sms/sms.service');
  const { BusService } = require('./dist/redis/bus.service');
  const { hashPassword } = require('./dist/common/crypto.util');
  const { currentTotp } = require('./dist/common/totp.util');
  const ds = app.get(DataSource), settings = app.get(SettingsService), catalog = app.get(CatalogService);
  const actor = { id: (await ds.query("SELECT id FROM admins WHERE username='schedule-check'"))[0].id, username: 'schedule-check', role: 'admin', totp_enabled: false };
  const before = (await settings.getAll(true)).event;
  const category = (await catalog.createCategory('test', '127.0.0.1', { name: 'Atomic category' })).category;
  await ds.query(`CREATE FUNCTION fail_atomic_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action IN ('settings_updated','category_deleted','exhibitor_created','password_changed','user_created','mfa_enabled')
      THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END; $$;
    CREATE TRIGGER fail_atomic_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_atomic_audit()`);
  const auth = app.get(AdminAuthService);
  let setup;
  try {
    assert.equal((await request('settings/event', 'PUT', { name: 'Should roll back' })).response.status, 500);
    assert.deepEqual((await settings.getAll(true)).event, before);
    await assert.rejects(() => catalog.deleteCategory('test', '127.0.0.1', category.id, true));
    assert.equal((await ds.query('SELECT id FROM categories WHERE id=$1', [category.id])).length, 1);
    const imageCount = (await ds.query('SELECT count(*)::int AS n FROM images'))[0].n;
    await assert.rejects(() => catalog.createExhibitor('test', '127.0.0.1', {
      name: 'Rollback maker', description: 'Test', category_ids: [category.id],
    }, { mimetype: 'image/jpeg', size: 3, buffer: Buffer.from([255,216,255]) }));
    assert.equal((await ds.query('SELECT count(*)::int AS n FROM images'))[0].n, imageCount);
    assert.equal((await ds.query("SELECT id FROM exhibitors WHERE name='Rollback maker'")).length, 0);
    const passwordHash = (await ds.query('SELECT password_hash FROM admins WHERE id=$1', [actor.id]))[0].password_hash;
    assert.equal((await request('password', 'POST', { current: 'Schedule-test-123!', next: 'Changed-test-123!' })).response.status, 500);
    assert.equal((await ds.query('SELECT password_hash FROM admins WHERE id=$1', [actor.id]))[0].password_hash, passwordHash);
    await assert.rejects(() => auth.createUser('127.0.0.1', actor, 'rollback-user', 'Rollback-test-123!'));
    assert.equal((await ds.query("SELECT id FROM admins WHERE username='rollback-user'")).length, 0);
    const setups = await Promise.all([auth.mfaSetup(actor), auth.mfaSetup(actor)]);
    assert.equal(setups[0].secret, setups[1].secret); setup = setups[0];
    await assert.rejects(() => auth.mfaEnable('127.0.0.1', actor, currentTotp(setup.secret)));
    assert.equal((await ds.query('SELECT totp_enabled FROM admins WHERE id=$1', [actor.id]))[0].totp_enabled, false);
  } finally { await ds.query('DROP TRIGGER fail_atomic_audit ON audit_log; DROP FUNCTION fail_atomic_audit()'); }
  // Concurrent patches must merge without losing unrelated fields.
  await settings.update('display', { key: 'old-key', show_counts: true });
  await Promise.all([settings.update('display', { key: 'new-key' }), settings.update('display', { show_counts: false })]);
  assert.deepEqual((await settings.getAll(true)).display, { key: 'new-key', show_counts: false });
  await settings.update('voting', { open: true, opens_at: '2026-10-20T07:00:00Z', closes_at: '2026-10-20T09:00:00Z' });
  const updates = await Promise.allSettled([
    settings.update('voting', { opens_at: '2026-10-20T08:00:00Z' }),
    settings.update('voting', { closes_at: '2026-10-20T07:30:00Z' }),
  ]);
  assert.equal(updates.filter(r => r.status === 'rejected').length, 1);
  const voting = (await settings.getAll(true)).voting;
  assert.ok(Date.parse(voting.opens_at) < Date.parse(voting.closes_at));
  // Password failure counts cannot lose increments when requests arrive together.
  await ds.query('INSERT INTO admins(username,password_hash) VALUES ($1,$2)', ['parallel-login', await hashPassword('Correct-test-123!')]);
  const response = { cookie() {}, clearCookie() {} };
  const logins = await Promise.allSettled(Array.from({ length: 5 }, () => auth.login(response, '127.0.0.1', 'parallel-login', 'wrong')));
  assert.equal(logins.filter(r => r.status === 'rejected').length, 5);
  const account = (await ds.query("SELECT failed_logins, locked_until FROM admins WHERE username='parallel-login'"))[0];
  assert.equal(account.failed_logins, 5); assert.ok(account.locked_until > new Date());
  await assert.rejects(() => auth.login(response, '127.0.0.1', 'parallel-login', 'Correct-test-123!'), e => e.getResponse().error === 'locked');
  // A failed resend preserves the previous usable code; a failed first request creates no registration.
  await settings.update('voting', { open: true, opens_at: null, closes_at: null });
  await settings.update('access', { mode: 'off' });
  const visitor = app.get(VisitorService), sms = app.get(SmsService), bus = app.get(BusService);
  const originalHit = bus.hit, originalSend = sms.sendOtp;
  bus.hit = async () => ({ allowed: true, count: 1, retryAfter: 0 });
  try {
    const first = await visitor.requestOtp('127.0.0.1', { name: 'Atomic OTP', phone: '0790001234' });
    sms.sendOtp = async () => { throw new Error('test gateway failure'); };
    await assert.rejects(() => visitor.requestOtp('127.0.0.1', { name: 'Atomic OTP', phone: '0790001234' }));
    assert.equal((await ds.query('SELECT consumed_at FROM otp_challenges WHERE id=$1', [first.challengeId]))[0].consumed_at, null);
    const count = (await ds.query('SELECT count(*)::int AS n FROM visitors'))[0].n;
    await assert.rejects(() => visitor.requestOtp('127.0.0.1', { name: 'Atomic OTP', phone: '0790001235' }));
    assert.equal((await ds.query('SELECT count(*)::int AS n FROM visitors'))[0].n, count);
    assert.ok(await visitor.verifyOtp(first.challengeId, first.devCode));
  } finally { bus.hit = originalHit; sms.sendOtp = originalSend; }
  console.log('PASS: settings/catalog/security rollback, concurrent patches, login counters, stable MFA setup and failed OTP delivery rollback');
};
