# Deployment guide

The system runs anywhere that has Docker, or Node.js 20+ with PostgreSQL 14+ (Redis optional). No special hardware.

## Option A — Docker Compose (recommended, local server or any cloud VM)

```bash
git clone <repo> mc2026-voting && cd mc2026-voting
cp .env.example .env
# edit .env: APP_SECRET, POSTGRES_PASSWORD, ADMIN_PASSWORD, SMS_*
docker compose up -d --build                 # nginx + 2 app replicas + Postgres + Redis
docker compose exec app node dist/cli/seed.js # optional: mock exhibitors for rehearsal
```
Open `http://<server>/admin`, sign in, then **Security → Set up two-factor**.

Scale the stateless tier at any time:
```bash
docker compose up -d --scale app=4
```

**Sizing for MC2026 (≈1,000 visitors):** 2 vCPU / 4 GB RAM VM is ample for everything on one host. Our load test pushed 1,000 full voting journeys through in about 7.5 seconds on a similar box.

### TLS
Put a certificate on nginx (uncomment the `listen 443` lines in `deploy/nginx.conf`, mount `/etc/nginx/certs`) or terminate TLS at your cloud load balancer. Geolocation **requires HTTPS** in browsers, so TLS is mandatory for the geofence to work on phones.

## Option B — Without Docker

```bash
# front-end
cd frontend && npm ci && npm run build && cd ..
# API (serves frontend/dist automatically)
cd backend && npm ci && npm run build
export DATABASE_URL=postgres://mc:secret@db-host:5432/mc2026
export REDIS_URL=redis://redis-host:6379      # optional
export APP_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
export ADMIN_PASSWORD='a-long-password'  NODE_ENV=production  TRUST_PROXY=1  PUBLIC_URL=https://vote.example.org
npm start            # migrations run automatically on boot (advisory-locked, safe with many replicas)
```
Run 2+ processes (systemd / PM2) behind nginx using `deploy/nginx.conf`.

## Development

```bash
cd backend && npm install && cp ../.env.example .env   # set DATABASE_URL, APP_SECRET, OTP_DEV_ECHO=true
npm run build && npm run seed && npm start              # API on :3000
cd ../frontend && npm install && npm run dev            # React on :5173, proxies /api and /img to :3000
```

## Option C — Managed cloud (production-grade HA)

| Tier | AWS example | Azure example | GCP example |
|---|---|---|---|
| App (container, ≥2 instances, 2 AZs) | ECS Fargate / App Runner | Container Apps | Cloud Run (min instances 2) |
| PostgreSQL with automatic failover | RDS Multi-AZ | Flexible Server (zone-redundant HA) | Cloud SQL HA |
| Redis | ElastiCache | Azure Cache for Redis | Memorystore |
| TLS + LB | ALB | Front Door / App Gateway | HTTPS LB |

Set `TRUST_PROXY` to the number of proxy hops (usually `1`), and make sure the LB passes the real client IP in `X-Forwarded-For` — the on-site IP check depends on it. For SSE, set the LB idle timeout ≥ 60 s (the server sends a keep-alive every 20 s).

## Configuration reference

All event-level settings (categories, exhibitors, voting window, IP ranges, geofence, display key) are in the database and edited from **/admin**. Environment variables only cover infrastructure — see `.env.example` for the full list. Key ones:

| Variable | Purpose |
|---|---|
| `APP_SECRET` | Master secret (≥32 chars) — derives JWT, encryption and HMAC keys. **Back it up**: losing it makes stored names/phones unreadable. |
| `DATABASE_URL`, `REDIS_URL` | Datastores (Redis optional) |
| `TRUST_PROXY` | Proxy hops in front of the app — critical for the IP check |
| `PUBLIC_URL` | Optional fixed base URL; otherwise links use the admin's current origin |
| `SMS_PROVIDER` + credentials | `console`, `twilio`, or `http` webhook |
| `OTP_DEV_ECHO` | Demo only — shows the code on screen; ignored in production |

## Venue access setup

1. On a local Docker event server, use the LAN gateway configuration below so the server receives real device IPs and can discover the Wi-Fi subnet. No IP values are entered by hand.
2. Open **Admin › Settings › On-site access** while connected to venue Wi-Fi. Click **Use this network** and **Use my location**, then save. The default **Wi-Fi and location** rule checks both signals; a 150–300 m radius suits most venues.
3. Test from a phone inside the venue (should pass) and from a phone off-site (should be refused).

### Local event server (phones on the same Wi-Fi)

For the complete steps, including why HTTPS and Node.js are required, see [LAN event setup](LAN_EVENT_SETUP.md). Run `make`; it builds and starts Docker with LAN-safe settings, then starts the host gateway on port 8443. The gateway discovers the host network and forwards each device's real IP and subnet. No event IP needs to be copied into `.env` or typed into admin settings.

Keep the gateway terminal open during the event. Open the admin page through the HTTPS address it prints, accept the local certificate warning, and leave **Voting page address** empty so links follow that same origin. In **Settings → On-site access**, click **Use this network** and **Use my location** to configure the default combined check.

## Event-day runbook

| When | Action |
|---|---|
| Day before | Rehearse with seeded data → **Results → Reset** (tick "delete visitors") → set the detected venue network and location in **Settings › On-site access** |
| Doors open | Open the results-screen link from the **Dashboard** on the TVs; **Dashboard → Open voting** |
| During | Watch the Dashboard (votes, votes in the last 5 min, on-site protection status). `/readyz` for health. |
| Close | **Close voting** → TV switches to "Final results" with winners highlighted → **Export CSV/JSON** |
| After | Export opted-in visitors for outreach; purge visitor data per retention policy |

## Monitoring

- `GET /healthz` — liveness (process up)
- `GET /readyz` — readiness (DB reachable; reports Redis state)
- Structured JSON logs on stdout (ship to CloudWatch / Loki / Azure Monitor)
- `audit_log` table for security review

## Backups

Daily `pg_dump` (or managed PITR). The `APP_SECRET` must be backed up separately — encrypted PII is unrecoverable without it.

## Testing

```bash
createdb mc2026_test
cd backend && TEST_DATABASE_URL=postgres://mc:mc@localhost:5432/mc2026_test npm test   # current Jest unit + e2e suite; use an isolated test database
OTP_DEV_ECHO=true npm start &   # then, with voting open, from the repo root:
node scripts/loadtest.js 1000 250 http://localhost:3000            # 1,000-visitor load test
node scripts/simulate.js 60 10                                      # realistic demo traffic
```
