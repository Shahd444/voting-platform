# MC2026 Digital Voting System — Technical write-up

*42 Amman Hackathon · Challenge: Digital Voting System for MC2026 Community Awards*

## 1. What we built

A working, deployable voting system for the Maker Collective 2026 community awards:

- **Visitor voting page** (`/`) — opened from a QR code; name + mobile number; SMS one-time code; one vote in each of the 3 award categories; bilingual English/Arabic; built for phones on busy venue Wi-Fi.
- **Live results dashboard** (`/display`) — TV/projector layout, updates in real time over Server-Sent Events, protected by a rotatable display key, shows a "Scan to vote" QR, switches to "Final results" with winners when voting closes.
- **Admin console** (`/admin`) — add/edit/remove exhibitors with photos and category assignments, manage categories, open/close voting (plus optional schedule), configure on-site rules (IP ranges + geofence), live stats, export results (CSV/JSON), reset, visitor list + outreach export, admin accounts with two-factor authentication, audit log.

Requirement coverage: all of F1–F14 — see the traceability table in the README.

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| API | **NestJS 11** (TypeScript, Express adapter) + TypeORM 0.3 | Modules, DI, guards, DTO validation, built-in SSE, Jest/Supertest |
| Database | PostgreSQL 16 | Constraints guarantee one-vote-per-category under concurrency; JSONB settings |
| Cache / fan-out | Redis 7 (optional) | Pub/sub across replicas, shared rate limits; system works without it |
| Live updates | Server-Sent Events (+ polling fallback) | One-way, proxy-friendly, auto-reconnect |
| Front-end | **React 19** + Vite 6 + TypeScript + React Router 7 | One SPA, three lazy-loaded interfaces; visitor phones never download admin code |
| Deployment | One Docker image (NestJS serving the React build); Compose: nginx + N replicas + Postgres + Redis | Runs on a local server or any cloud VM; no special hardware |

## 3. Architecture

```
Phones / TVs / Admin ──HTTPS──► nginx (TLS, LB, gzip, SSE-aware)
                                   │
                    ┌──────────────┼──────────────┐
                 App #1         App #2   …     App #N     (stateless, identical)
                    └──────┬───────┴───────┬──────┘
                     PostgreSQL         Redis            SMS gateway
                  (source of truth)  (pub/sub, limits)   (OTP delivery)
```

NestJS app servers keep no state: sessions are signed cookies, OTPs and settings are in PostgreSQL, live-update events travel through Redis. Any replica can serve any request, so we scale by adding replicas and survive a replica crashing. Full diagrams: `ARCHITECTURE.md`, `ERD.md`, `DFD.md`.

## 4. Access control & anti-fraud

**On-site only (F11).** Two signals, combined by a mode the team picks on the day:
1. **Venue IP range** — the server checks the client's IP (correctly extracted behind the proxy) against CIDR ranges configured in the admin console. Strong and invisible to visitors on the venue Wi-Fi.
2. **Geofence** — visitors on mobile data are asked to share their location; it must be inside a configurable radius of the venue with acceptable GPS accuracy.

Recommended mode is *Wi-Fi OR location*; the team can tighten to *Wi-Fi only* or *Wi-Fi AND location*. The check runs when the OTP is requested **and again on every vote**. Per-IP limits recognise the venue's shared NAT address, so 1,000 phones behind one IP are not throttled.

**Identity & duplicates (F6, F12).** Each phone number must be verified by a 6-digit SMS code (5-min expiry, single use, 5 attempts, stored only as an HMAC). Numbers are normalised (`079…`, `+96279…`, `00962…`, Arabic digits → one identity). The database enforces `UNIQUE(phone)` and `UNIQUE(visitor, category)`: a tested race of 8 simultaneous submissions produces exactly one vote. Duplicate category votes return 409 already_voted; the client restores the saved session.

**Abuse limits.** Per phone: 30 s resend cooldown, 5 codes/hour. Per IP: separate budgets for venue and non-venue addresses. Jordan mobile-number validation reduces SMS-pumping risk.

**Voting window (F10).** Manual open/close + optional automatic schedule, enforced server-side.

**Admin security.** scrypt-hashed passwords, account lockout, **TOTP two-factor**, admin vs read-only viewer roles, password change revokes all sessions, every sensitive action in an audit log. CSRF protection (SameSite=Strict + custom header), strict CSP, validated image uploads.

**Privacy (F14).** Names and phone numbers are encrypted with AES-256-GCM before storage; lookups use an HMAC. Admin screens show masked numbers; full numbers only in an audited, admin-only export. Visitors opt in to outreach explicitly; an "opted-in only" export exists for that purpose. Details: `SECURITY.md`.

## 5. Deployment requirements

- Any Linux host or cloud with Docker (or Node.js 20+ and PostgreSQL 14+). Redis optional.
- 2 vCPU / 4 GB RAM is ample for the event; a domain + TLS certificate (browsers require HTTPS for geolocation).
- An SMS provider account (Twilio, or any local gateway via the generic HTTP adapter).
- One command: `docker compose up -d --build`. Step-by-step guide, venue network setup and event-day runbook: `DEPLOYMENT.md`.

## 6. Scaling to 1,000+ users — plan and evidence

**Load test** (`scripts/loadtest.js`, results in `loadtest-results.json`): 2 NestJS replicas + PostgreSQL + Redis **and** the load generator all on one 2-vCPU container.

| Scenario | Result |
|---|---|
| 1,000 phones open the page at the same instant | 1,000/1,000 OK in **0.87 s** (p95 766 ms) |
| 1,000 complete visitor journeys (OTP request → verify → 3 votes = 5,000 requests), 250 at a time | **1,000/1,000 completed, 0 errors, 7.55 s**, ~663 req/s, ~398 votes/s; p95 vote latency 523 ms |
| Correctness | DB recorded exactly 3,000 new votes = 3,000 successful responses |
| Live fan-out | SSE screens connected to **both** replicas all showed the exact final total |
| Redis stopped mid-test | 50/50 visitors still completed; Redis auto-reconnected when restarted |

The real event — about 1,000 visitors spread across a day — is a tiny fraction of this. Why it scales:

1. **Stateless replicas** behind a load balancer — add capacity with `--scale app=N`.
2. **Database does the hard part cheaply** — one indexed `INSERT … ON CONFLICT` per vote; tallies are a single grouped query served by an index, memoised per replica (750 ms) and pushed at most twice a second regardless of vote rate.
3. **Read traffic is cacheable** — the ballot is cached in Redis for 10 s; photos are immutable and cached by nginx/CDN.
4. **No single point of failure that pauses voting** — Redis is optional; app replicas are interchangeable; the remaining stateful component (PostgreSQL) runs as managed HA with automatic failover in production (RDS Multi-AZ / Azure Flexible HA / Cloud SQL HA).
5. **Network-drop tolerant clients** — automatic retries with backoff, idempotent votes, offline banner, SSE auto-reconnect with polling fallback.

Path beyond 10× load: PgBouncer for connection pooling, a read replica for the dashboard query, object storage + CDN for images.

## 7. What's left for the remaining ~10 %

- Connect CPF's chosen SMS gateway and test real delivery in Jordan.
- Final category names and exhibitor data from the Makerspace team (all editable in the admin console).
- TLS certificate and production secrets; a full rehearsal on the venue network; branding assets from the official guidelines.
- Security review / penetration test and data-retention policy sign-off (out of hackathon scope per §6).
