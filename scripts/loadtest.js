'use strict';
/**
 * Load test for the "1,000 concurrent users" requirement.
 *
 *   node scripts/loadtest.js [visitors=1000] [concurrency=250] [bases=http://localhost:3000]
 *
 * `bases` may be a comma-separated list of app replicas (e.g. two Node
 * processes) to prove horizontal scaling: visitors are spread round-robin,
 * while live-results SSE listeners on EVERY replica must receive the updates
 * (proves Redis pub/sub fan-out across nodes).
 *
 * Phases
 *  1. Page-open storm: 1,000 simultaneous GET /api/public/state (QR scan rush)
 *  2. Full voting flow: N visitors × (OTP request → OTP verify → 3 votes), C at a time
 *  3. Correctness: DB counts == successful votes; every SSE screen saw the final total
 *
 * Requires: voting open, OTP_DEV_ECHO=true (non-production), TRUST_PROXY allowing
 * X-Forwarded-For from the load generator (default "loopback").
 */
const http = require('http');
const N = Number(process.argv[2] || 1000);
const CONC = Number(process.argv[3] || 250);
const BASES = (process.argv[4] || 'http://localhost:3000').split(',');

const agent = new http.Agent({ keepAlive: true, maxSockets: CONC * 2 });
const pct = (arr, q) => { const s = [...arr].sort((a, b) => a - b); return +(s[Math.min(s.length - 1, Math.floor(q * s.length))] || 0).toFixed(1); };

function request(base, path, { method = 'GET', body, cookie, ip } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, base);
    const payload = body ? JSON.stringify(body) : null;
    const t0 = performance.now();
    const r = http.request(u, {
      method, agent,
      headers: {
        'x-requested-with': 'mc2026', ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
        ...(cookie ? { cookie } : {}), ...(ip ? { 'x-forwarded-for': ip } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null; try { json = JSON.parse(data); } catch { /* ignore */ }
        resolve({ status: res.statusCode, data: json, headers: res.headers, ms: performance.now() - t0 });
      });
    });
    r.on('error', reject);
    r.setTimeout(30000, () => r.destroy(new Error('timeout')));
    if (payload) r.write(payload);
    r.end();
  });
}

function sseListener(base, cookie) {
  const state = { events: 0, lastVotes: 0, connected: false };
  const u = new URL('/api/display/stream', base);
  const req = http.get(u, { headers: { cookie, accept: 'text/event-stream' } }, (res) => {
    state.connected = res.statusCode === 200;
    let buf = '';
    res.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = block.split('\n').find((l) => l.startsWith('data: '));
        if (line) { state.events++; try { state.lastVotes = JSON.parse(line.slice(6)).totals.votes; } catch { /* ignore */ } }
      }
    });
  });
  state.close = () => req.destroy();
  return state;
}

(async () => {
  const report = { visitors: N, concurrency: CONC, replicas: BASES.length };
  const first = await request(BASES[0], '/api/public/state');
  if (!first.data || !first.data.voting.open) { console.error('Voting must be open.'); process.exit(1); }
  const ballot = first.data;

  // Admin cookie -> display access for SSE listeners on each replica
  const login = await request(BASES[0], '/api/admin/login', { method: 'POST', body: { username: process.env.LT_ADMIN || 'admin', password: process.env.LT_PASSWORD || 'admin12345' } });
  const adminCookie = (login.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  const startVotes = (await request(BASES[0], '/api/admin/results', { cookie: adminCookie })).data.totals.votes;
  const screens = BASES.flatMap((b) => [sseListener(b, adminCookie), sseListener(b, adminCookie)]);

  // ---- Phase 1: page-open storm
  {
    const t0 = performance.now();
    const res = await Promise.all(Array.from({ length: N }, (_, i) => request(BASES[i % BASES.length], '/api/public/state', { ip: `10.200.${(i >> 8) & 255}.${i & 255}` }).catch((e) => ({ status: 0, ms: 0, e }))));
    const secs = (performance.now() - t0) / 1000;
    report.phase1_page_open_storm = {
      simultaneous_requests: N, ok: res.filter((r) => r.status === 200).length, seconds: +secs.toFixed(2),
      latency_ms: { p50: pct(res.map((r) => r.ms), 0.5), p95: pct(res.map((r) => r.ms), 0.95), p99: pct(res.map((r) => r.ms), 0.99) },
    };
  }

  // ---- Phase 2: full flow
  const lat = { otp_request: [], otp_verify: [], vote: [] };
  let ok = 0, fail = 0, votesOk = 0;
  const errors = {};
  const seed = Date.now() % 100000;
  {
    let next = 0;
    const t0 = performance.now();
    await Promise.all(Array.from({ length: CONC }, async () => {
      while (next < N) {
        const i = next++;
        const base = BASES[i % BASES.length];
        const n = seed * 10 + i;
        const ip = `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
        const phone = `0797${String(n).padStart(6, '0').slice(-6)}`;
        try {
          const o = await request(base, '/api/public/otp/request', { method: 'POST', ip, body: { name: `Load ${i}`, phone } });
          lat.otp_request.push(o.ms);
          if (o.status !== 200) throw new Error(`otp_request ${o.status} ${o.data && o.data.error}`);
          const v = await request(base, '/api/public/otp/verify', { method: 'POST', ip, body: { challengeId: o.data.challengeId, code: o.data.devCode } });
          lat.otp_verify.push(v.ms);
          if (v.status !== 200) throw new Error(`otp_verify ${v.status}`);
          const cookie = v.headers['set-cookie'][0].split(';')[0];
          for (const c of ballot.categories) {
            const opts = ballot.exhibitors.filter((e) => e.category_ids.includes(c.id));
            const ex = opts[Math.floor(Math.random() * opts.length)];
            const r = await request(base, '/api/public/votes', { method: 'POST', ip, cookie, body: { categoryId: c.id, exhibitorId: ex.id } });
            lat.vote.push(r.ms);
            if (r.status !== 201) throw new Error(`vote ${r.status} ${r.data && r.data.error}`);
            votesOk++;
          }
          ok++;
        } catch (e) { fail++; errors[e.message] = (errors[e.message] || 0) + 1; }
      }
    }));
    const secs = (performance.now() - t0) / 1000;
    const total = lat.otp_request.length + lat.otp_verify.length + lat.vote.length;
    report.phase2_full_voting_flow = {
      completed_visitors: ok, failed_visitors: fail, votes_cast: votesOk, seconds: +secs.toFixed(2),
      requests: total, throughput_req_per_sec: +(total / secs).toFixed(0), votes_per_sec: +(votesOk / secs).toFixed(0),
      latency_ms: Object.fromEntries(Object.entries(lat).map(([k, a]) => [k, { p50: pct(a, 0.5), p95: pct(a, 0.95), p99: pct(a, 0.99) }])),
      errors,
    };
  }

  // ---- Phase 3: correctness + live fan-out
  await new Promise((r) => setTimeout(r, 2500));
  const endVotes = (await request(BASES[0], '/api/admin/results', { cookie: adminCookie })).data.totals.votes;
  report.phase3_correctness = {
    db_new_votes: endVotes - startVotes,
    successful_vote_responses: votesOk,
    match: endVotes - startVotes === votesOk,
    live_screens: screens.map((s, i) => ({ replica: BASES[Math.floor(i / 2)], connected: s.connected, events_received: s.events, final_total_seen: s.lastVotes, up_to_date: s.lastVotes === endVotes })),
  };
  screens.forEach((s) => s.close());
  console.log(JSON.stringify(report, null, 2));
  agent.destroy();
})().catch((e) => { console.error(e); process.exit(1); });
