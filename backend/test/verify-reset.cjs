// Invoked by verify-scheduling.cjs with VERIFY_RESET=true in its isolated database.
const assert = require('node:assert/strict');
const { DataSource } = require('typeorm');
module.exports = async (app, request) => {
  const { encrypt } = require('./dist/common/crypto.util');
  const { VisitorService } = require('./dist/visitor/visitor.service');
  const { SettingsService } = require('./dist/settings/settings.service');
  const { SessionService } = require('./dist/auth/session.service');
  const { ResultsService } = require('./dist/results/results.service');
  const ds = app.get(DataSource), visitors = app.get(VisitorService), settings = app.get(SettingsService);
  const category = (await ds.query("INSERT INTO categories(slug,name) VALUES ('reset-test','Reset test') RETURNING id"))[0].id;
  const exhibitor = (await ds.query("INSERT INTO exhibitors(name) VALUES ('Reset exhibitor') RETURNING id"))[0].id;
  await ds.query('INSERT INTO exhibitor_categories VALUES ($1,$2)', [exhibitor, category]);
  const visitor = (await ds.query(`INSERT INTO visitors(name_enc,phone_enc,phone_hash,phone_last4,verified_at)
    VALUES ($1,$2,'reset-test','1234',now()) RETURNING id`, [encrypt('Reset visitor'), encrypt('962790001234')]))[0].id;
  await settings.update('access', { mode: 'off' });
  const open = async () => settings.update('voting', { open: true, opens_at: null, closes_at: null });
  const vote = () => visitors.castVote(visitor, '127.0.0.1', category, exhibitor, null);
  const stored = async () => (await ds.query("SELECT value FROM settings WHERE key = 'voting'"))[0].value;
  await open(); await vote();
  assert.equal((await request('results/reset', 'POST', { confirm: 'wrong' })).response.status, 400);
  // Audit failure must restore voting, votes and registrations together.
  await ds.query(`CREATE FUNCTION fail_reset() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action = 'visitors_purged' THEN RAISE EXCEPTION 'test rollback'; END IF; RETURN NEW; END; $$;
    CREATE TRIGGER fail_reset BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_reset()`);
  try {
    assert.equal((await request('results/reset', 'POST', { confirm: 'RESET', purgeVisitors: true })).response.status, 500);
    assert.equal((await stored()).open, true);
    assert.equal((await visitors.session(visitor)).votes[category].exhibitor_id, exhibitor);
  } finally { await ds.query('DROP TRIGGER fail_reset ON audit_log; DROP FUNCTION fail_reset()'); }
  // Block reset, queue a vote behind it, then release both in deterministic lock order.
  const blocker = ds.createQueryRunner(); await blocker.connect(); await blocker.startTransaction();
  await blocker.query('LOCK TABLE votes IN ROW EXCLUSIVE MODE');
  let resetting, queued;
  try {
    resetting = request('results/reset', 'POST', { confirm: 'RESET' });
    let waiting = false;
    for (let i = 0; i < 100 && !waiting; i++) {
      waiting = (await ds.query(`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE relation = 'votes'::regclass
        AND mode = 'ShareRowExclusiveLock' AND NOT granted) AS waiting`))[0].waiting;
      if (!waiting) await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(waiting, 'Reset must be queued before the vote');
    queued = vote().then(() => null, error => error);
    await blocker.commitTransaction();
    const reset = await resetting;
    assert.equal(reset.response.status, 200); assert.equal(reset.data.deleted, 1);
    assert.equal((await queued).getResponse().error, 'voting_closed');
  } finally {
    if (blocker.isTransactionActive) await blocker.rollbackTransaction();
    await blocker.release(); await Promise.allSettled([resetting, queued].filter(Boolean));
  }
  assert.equal((await stored()).open, false);
  assert.deepEqual((await visitors.session(visitor)).votes, {});
  assert.equal((await request('results')).data.totals.votes, 0);
  assert.equal((await app.get(ResultsService).snapshot(true)).totals.votes, 0);
  const audit = (await ds.query("SELECT detail FROM audit_log WHERE action='results_reset' ORDER BY id DESC LIMIT 1"))[0].detail;
  assert.equal(audit.deleted_votes, 1); assert.equal(audit.snapshot.totals.votes, 1);
  // Preserved registrations can vote again only after an explicit reopen.
  await open(); await vote();
  assert.equal((await request('results/reset', 'POST', { confirm: 'RESET', purgeVisitors: true })).response.status, 200);
  assert.equal(await visitors.session(visitor), null);
  const token = app.get(SessionService).sign({ typ: 'visitor', sub: visitor }, '12h');
  const response = await fetch(`${await app.getUrl()}/api/public/state`, { headers: { Authorization: `Bearer ${token}` } });
  const state = await response.json();
  assert.equal(state.session, null); assert.equal(state.voting.open, false);
  console.log('PASS: atomic close/reset, rollback, queued-vote rejection, empty results, preserved sessions and purged-session refresh');
};
