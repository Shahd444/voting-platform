'use strict';
/**
 * Simulates real visitors going through the full flow over HTTP:
 *   request OTP -> verify OTP -> cast one vote per category.
 * Requires the server to run with OTP_DEV_ECHO=true (non-production) so the
 * code is returned in the response, and voting to be open.
 *
 *   node scripts/simulate.js [visitors=50] [concurrency=10] [baseUrl=http://localhost:3000] [delayMs=0]
 *
 * Each simulated visitor uses its own X-Forwarded-For address inside 10.0.0.0/8
 * (honoured only when the request comes through a trusted proxy hop, e.g. loopback).
 */
const N = Number(process.argv[2] || 50);
const CONC = Number(process.argv[3] || 10);
const BASE = process.argv[4] || 'http://localhost:3000';
const DELAY = Number(process.argv[5] || 0);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lat = [];

async function call(path, { method = 'GET', body, cookie, ip } = {}) {
  const t0 = performance.now();
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json', 'x-requested-with': 'mc2026',
      ...(cookie ? { cookie } : {}), ...(ip ? { 'x-forwarded-for': ip } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  lat.push(performance.now() - t0);
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

// Popularity weights so the leaderboard looks like a real event
function pick(list) {
  const w = list.map((_, i) => 1 / (i + 1.3));
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < list.length; i++) { r -= w[i]; if (r <= 0) return list[i]; }
  return list[0];
}

async function visitor(i, ballot) {
  const ip = `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;
  const phone = `079${String(1000000 + ((Date.now() / 1000 | 0) % 1000) * 1000 + i).slice(-7)}`;
  const o = await call('/api/public/otp/request', { method: 'POST', ip, body: { name: `Sim Visitor ${i}`, phone, consent: i % 3 === 0 } });
  if (!o.res.ok) throw new Error(`otp ${o.res.status} ${o.data.error}`);
  if (!o.data.devCode) throw new Error('server is not running with OTP_DEV_ECHO=true');
  const v = await call('/api/public/otp/verify', { method: 'POST', ip, body: { challengeId: o.data.challengeId, code: o.data.devCode } });
  if (!v.res.ok) throw new Error(`verify ${v.res.status}`);
  const cookie = v.res.headers.get('set-cookie').split(';')[0];
  for (const c of ballot.categories) {
    const options = ballot.exhibitors.filter((e) => e.category_ids.includes(c.id));
    const r = await call('/api/public/votes', { method: 'POST', ip, cookie, body: { categoryId: c.id, exhibitorId: pick(options).id } });
    if (r.res.status !== 201) throw new Error(`vote ${r.res.status} ${r.data.error}`);
    if (DELAY) await sleep(DELAY);
  }
}

(async () => {
  const { data: ballot } = await call('/api/public/state');
  if (!ballot.voting.open) { console.error('Voting is closed — open it from the admin console first.'); process.exit(1); }
  // Shuffle-ish exhibitor order per category so different makers lead
  ballot.exhibitors.sort(() => Math.random() - 0.5);
  let next = 0, ok = 0, fail = 0;
  const errors = {};
  const t0 = Date.now();
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (next < N) {
      const i = next++;
      try { await visitor(i + Math.floor(Math.random() * 1e5), ballot); ok++; }
      catch (e) { fail++; errors[e.message] = (errors[e.message] || 0) + 1; }
    }
  }));
  const secs = (Date.now() - t0) / 1000;
  lat.sort((a, b) => a - b);
  const p = (q) => lat[Math.min(lat.length - 1, Math.floor(q * lat.length))].toFixed(1);
  console.log(JSON.stringify({
    visitors: N, concurrency: CONC, completed: ok, failed: fail, seconds: secs,
    requests: lat.length, req_per_sec: +(lat.length / secs).toFixed(1),
    latency_ms: { p50: p(0.5), p95: p(0.95), p99: p(0.99), max: lat[lat.length - 1].toFixed(1) },
    errors,
  }, null, 2));
})();
