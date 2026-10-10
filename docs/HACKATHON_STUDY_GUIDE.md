# MC2026 — Hackathon Technical Study Guide

Source checked: 8 October 2026. This guide explains the checked implementation; it does not certify the running demo. No application code or event records were changed.

## Study order for your remaining time

1. Spend 5 minutes on the pitch and facts below.
2. Spend 10 minutes on the vote journey and database.
3. Spend 15 minutes on authentication, GPS/IP and live results.
4. Spend 10 minutes rehearsing the questions and limitations at the end.

## Your 45-second technical pitch

> Our project is an event voting platform. Visitors verify their phone with a one-time code and can vote once in each award category. The frontend is React with TypeScript; the backend is NestJS on Node.js using Express. PostgreSQL stores the votes and enforces duplicate prevention with a unique constraint, even when requests reach different servers. We protect personal data with encryption, use signed cookie sessions, support authenticator MFA for admins, and check venue access through IP ranges and browser location. Authorized screens receive live results through Server-Sent Events, with polling as a fallback. Docker Compose runs multiple app replicas behind nginx, while Redis shares rate limits and distributes update notifications.

### Memorize these facts

| Topic | Actual implementation |
|---|---|
| Backend | NestJS, TypeScript, Express, Node.js |
| Database | PostgreSQL 16, accessed through TypeORM and parameterized SQL |
| Redis | Shared rate counters, pub/sub notifications, short-lived caches |
| Duplicate votes | PostgreSQL `UNIQUE(visitor_id, category_id)` |
| Admin passwords | Salted **scrypt**, using built-in Node crypto |
| Personal fields | **AES-256-GCM** encryption |
| Sessions | **HS256-signed JWTs**, primarily in HttpOnly cookies |
| Admin MFA | Optional six-digit **TOTP** authenticator codes |
| Live results | **SSE / EventSource**, not WebSockets |
| Presence | Server-observed IP plus browser-reported geolocation |

## 1. Architecture and backend vocabulary

```text
Phone / admin browser / TV
             |
     HTTPS terminator
 (Node LAN gateway locally)
             |
           nginx
        /         \
 NestJS app 1   NestJS app 2
        \         /
    PostgreSQL + Redis
```

The backend serves the built React frontend from the same origin as `/api`. nginx forwards traffic and distributes requests across replicas. A replica is another copy of the backend. PostgreSQL is the source of truth; Redis accelerates coordination. Uploaded images are also in PostgreSQL, so requests do not depend on one server's upload folder.

**Controller:** maps routes to functions. **Service:** implements business logic. **Module:** groups related features. **Guard:** checks authentication/authorization. **Middleware:** runs around requests. **DTO:** describes and validates input. **Dependency injection:** supplies services to other classes.

Request flow: proxy → HTTP setup and CSRF middleware → guards and validation → controller → service → database → response. Nest ValidationPipe transforms inputs and strips undeclared fields. Helmet adds security headers; JSON bodies are limited to 50 KB. A global exception filter formats errors and audits relevant blocked attempts.

Main modules: `visitor` handles OTP/voting; `admin` handles staff authentication, catalog, settings and reports; `auth` handles sessions/guards/CSRF; `core` handles access, limits, audit and QR; `results` handles tallies/SSE; `redis` handles coordination; `database` contains entities/migrations.

## 2. One visitor's complete journey

### Load and access-check

`GET /api/public/state` returns event details, voting status, access status, active categories/exhibitors, QR-entry flags and any existing visitor session. The ballot can be cached in Redis for ten seconds. The browser can send coordinates to `POST /api/public/access-check`.

### Request an OTP

`POST /api/public/otp/request` receives full name, phone, consent and optional coordinates.

1. Normalize name/phone, validate them, and check voting is open and venue access passes.
2. Apply IP limits, phone resend cooldown and hourly phone cap.
3. Compute a phone HMAC for stable lookup.
4. In a transaction, advisory locks serialize conflicting identity requests. Reject a phone attached to another name or a duplicate normalized name attached to another phone.
5. Insert/reuse the visitor with encrypted name/phone; invalidate older unused codes.
6. Generate six random digits with Node crypto. Store an HMAC of challenge ID plus code, expiry and encrypted pending name/consent.
7. Send through the configured SMS provider. A send error rolls back the transaction.

Defaults: six digits, five-minute expiry, five verification attempts, 30-second resend cooldown, five sends per phone per hour. Some values are configurable. The duplicate-name check scans/decrypts existing names, which is a future scaling concern; phone uniqueness is a database constraint.

### Verify the OTP

`POST /api/public/otp/verify` locks the visitor and challenge rows. It checks expiry, whether consumed, and attempt count, then compares the code HMAC using a timing-safe comparison. Wrong attempts persist. Success consumes the code, marks the visitor verified and applies pending name/consent. The response sets the 12-hour visitor cookie `mc_v`.

Visitors have **no password**. SMS OTP is their passwordless phone-verification flow.

### Submit a vote

`POST /api/public/votes` receives category/exhibitor IDs and optional coordinates. Identity comes from the signed visitor session, not an arbitrary visitor ID in the body.

1. VisitorGuard validates the JWT; a per-visitor submission limit applies.
2. Check voting state and venue access.
3. Begin a transaction and coordinate with resets using a votes-table lock.
4. Recheck fresh database settings after waiting. A shared lock on voting settings prevents closing from racing insertion.
5. Confirm the visitor exists and is verified. Confirm exhibitor/category are active and assigned together.
6. Insert with `ON CONFLICT ON CONSTRAINT one_vote_per_category DO NOTHING`.
7. Commit, publish a vote notification, and return saved progress. A duplicate returns HTTP 409 and current progress.

**Say:** “The UI prevents accidental repeats, but PostgreSQL is the real guarantee. Two concurrent requests on different replicas cannot create two votes for the same visitor/category.”

A visitor can vote once **per category**, not once overall. The current event has three categories, but the schema supports more.

## 3. Database and data relations

A **primary key** identifies a row; a **foreign key** links rows; a **unique constraint** rejects duplicates. A **transaction** commits operations together or rolls them back together.

| Table | Important fields and purpose |
|---|---|
| `visitors` | UUID; encrypted name/phone; unique phone HMAC; last four digits; verification/consent; creation IP |
| `otp_challenges` | UUID; visitor FK; code HMAC; encrypted payload; attempts; expiry/consumption timestamps |
| `categories` | Integer ID; unique slug; name/description; active flag |
| `exhibitors` | Integer ID; maker/team, project, description, booth, image FK, active flag |
| `exhibitor_categories` | Composite primary key `(exhibitor_id, category_id)`; normalized identity fields |
| `images` | UUID; MIME type; binary `BYTEA`; SHA-256 digest |
| `votes` | Big integer ID; visitor/category/exhibitor FKs; IP; optional latitude/longitude; timestamp |
| `admins` | Username; scrypt hash; encrypted TOTP secret; role; failure/lock/login fields |
| `settings` | Text key; JSONB configuration; update timestamp |
| `audit_log` | Actor, action, JSONB detail, IP and timestamp |

```text
visitor 1 ─── many OTP challenges
visitor 1 ─── many votes
category 1 ── many votes
exhibitor 1 ─ many votes
exhibitors many ── exhibitor_categories ── many categories
image 1 ───── many exhibitors (sharing is permitted by schema)
```

The join table allows one exhibitor to compete in multiple categories and each category to contain multiple exhibitors. Each vote links a visitor to an exhibitor in a category.

### Important database rules

- Unique `phone_hash`: one stored identity per normalized phone.
- Unique `(visitor_id, category_id)`: one vote per category per visitor.
- Composite vote FK `(exhibitor_id, category_id)` references the assignment table: an exhibitor must belong to that category.
- Assignment identity uniqueness prevents the same normalized maker/team + project appearing twice in one category. Triggers maintain identity keys after edits.
- `votes_tally_idx(category_id, exhibitor_id)` supports aggregation. OTP challenges have a visitor/time index.
- IP uses PostgreSQL `INET`; settings/audit detail use `JSONB`; timestamps use `TIMESTAMPTZ`.

Several relationships cascade on deletion, including visitor → challenges/votes and assignment → votes. Catalog operations check for votes and require a force decision for destructive edits/deletions. Do not claim exhibitor deletion always preserves votes.

**Why PostgreSQL?** Strong constraints, transactions, relational queries and concurrency control fit voting integrity. TypeORM supplies Nest integration, repositories and migrations; critical paths also use parameterized SQL (`$1`, `$2`) to keep values separate from SQL syntax.

Schema auto-sync is disabled. Versioned migrations are tracked in `schema_migrations`. A PostgreSQL advisory lock prevents simultaneous replica migrations. Default pool size is 20 connections per replica, configurable; scaling app replicas also increases DB connections.

Result/session reads use `REPEATABLE READ` when multiple queries need a consistent snapshot. Reset locks out vote writes, captures prior results, clears votes, closes voting and records the reset transactionally. Audit failure there rolls back the reset.

## 4. Password hashing, encryption and application secrets

**Hashing is one-way; encryption is reversible with a key.**

Admin passwords use Node `crypto.scrypt`: random 16-byte salt, 64-byte derived hash, N=16384, r=8, p=1. The stored value includes algorithm, parameters, salt and hash. Verification recomputes and uses `timingSafeEqual`. We do not use bcrypt and cannot decrypt passwords.

Names, phones and TOTP secrets use AES-256-GCM, with a random 12-byte IV and authentication tag. The stored string contains version, IV, tag and ciphertext. Encryption permits authorized retrieval while protecting those fields in a database dump without the key.

Phone HMAC-SHA256 supplies stable lookup/uniqueness while the phone itself stays encrypted. A keyed HMAC is harder to enumerate without its key than a plain hash of phone numbers. OTP HMAC binds the code to a challenge ID; plaintext OTP is not stored in its database row.

`APP_SECRET` is the master secret. HKDF-SHA256 derives separate 32-byte keys for JWT, data encryption, phone HMAC, OTP HMAC and QR signatures. Every replica needs the same secret. Changing it invalidates tokens and can make existing encrypted data unreadable. Database recovery requires preserving the original secret securely too.

This is selected-field encryption, not encryption of every column. IPs and coordinates are stored directly. Authorized exports decrypt phones. Votes link to visitors: this is **not anonymous voting or an end-to-end verifiable election protocol**.

## 5. Sessions, cookies and “session key”

Sessions are JWTs signed with `jsonwebtoken`, HS256 and issuer `mc2026`. They carry expiry, subject `sub`, token type `typ` and sometimes role/version. JWTs are **signed, not encrypted**: the signature prevents unnoticed changes; it does not hide payloads.

| Cookie | Meaning | Lifetime |
|---|---|---|
| `mc_v` | Verified visitor | 12 hours |
| `mc_ap` | Password passed, MFA pending | 5 minutes |
| `mc_a` | Authenticated admin | 8 hours |
| `mc_d` | Authorized display | 24 hours |
| `mc_q` | IP-bound rotating-QR entry grant | 10 minutes |

Cookies use HttpOnly, SameSite=Strict and path `/`. Secure is configurable through `COOKIE_SECURE`, defaulting on in production. HttpOnly prevents ordinary JavaScript reading the cookie; SameSite limits cross-site cookie sending; Secure restricts transport to HTTPS.

Any replica can validate a session with the shared signing key. No sticky sessions or Redis session store is needed. Admin guards still load the database account to check current permissions and token version. A password change changes the version derived from the password hash and invalidates older admin sessions; deleting an admin removes access.

The service also accepts Bearer tokens, and admin login returns tokens. Logout clears cookies; it does not blacklist every copied visitor JWT.

If asked about “session key,” distinguish **JWT signing key** (validates tokens), **display key** (pairs TVs), **TOTP secret** (generates codes) and **visitor UUID** (identifies a database row).

## 6. MFA implementation

Admin MFA is optional **password + authenticator TOTP**. Visitor SMS OTP is a different flow.

Setup generates 20 random bytes, Base32-encodes the secret, builds an `otpauth://` URL and renders it using `qrcode`. The secret is encrypted in PostgreSQL. A valid authenticator code is required to enable it.

TOTP is implemented with Node crypto: HMAC-SHA1, six digits, 30-second steps, accepting current step ±1 for clock drift. There is no `speakeasy` or `otplib` dependency.

Correct password creates only a five-minute pending token when MFA is enabled. Correct TOTP completes login. Disabling MFA requires password plus code. Password login locks the account after five failures for five minutes; login and MFA endpoints each have an IP limit of 10 attempts per five minutes.

Be precise: the MFA handler increments failures but does not enforce the same account-lock check as password login. No checked backup-code or consumed-TOTP tracking mechanism exists. Do not claim mandatory MFA, recovery codes or replay-proof codes.

## 7. IP, GPS and HTTPS

### IP

Express resolves `req.ip` using configured proxy trust. The app normalizes IPv4-mapped IPv6 and checks configured IPv4/IPv6 CIDRs with Node `net.BlockList`. A CIDR such as `192.168.1.0/24` represents a subnet.

Cloud deployments may see the venue's public NAT IP; a local gateway can see phones' private LAN addresses. IP is a network signal, not a unique person/device.

Docker Desktop may hide original phone IPs. `lan-gateway.mjs` reads the real socket address and overwrites incoming forwarding headers. LAN nginx trusts those headers from configured gateway ranges and forwards the resolved IP to the backend. `start-lan.mjs` binds nginx to localhost so phones cannot bypass the gateway. Correct proxy trust matters: blindly trusting forwarded headers permits spoofing.

### Browser geolocation

The frontend calls `navigator.geolocation.getCurrentPosition` with high accuracy, 12-second timeout and up to 60 seconds of cached location. It sends latitude, longitude and accuracy. Browser geolocation can use GPS/Wi-Fi/other signals; our app does not directly operate GPS hardware.

The server validates coordinates and uses the **Haversine formula** to calculate distance to the venue center. It checks configured maximum accuracy and allows venue radius plus up to 100 m of reported accuracy tolerance. Radius 100 m + accuracy 20 m permits distance up to 120 m.

| Mode | Rule |
|---|---|
| `off` | No venue restriction |
| `ip` | IP passes |
| `geo` | Geofence passes |
| `ip_or_geo` | Either passes |
| `ip_and_geo` | Both pass |

OTP requests and vote submissions enforce venue checks. Defaults contain unknown venue coordinates until configured. Location is client-reported and spoofable; no server-enforced location freshness timestamp exists.

### HTTPS

HTTPS protects traffic and is needed for secure browser features such as geolocation. LAN gateway uses built-in Node HTTPS and OpenSSL-generated self-signed certificates. Default ports: HTTPS 8443 and HTTP redirect 8080; gateway forwards to local HTTP nginx on 3000.

The checked nginx configuration listens on HTTP 80; TLS directives are commented out. **Say:** “Local TLS terminates at the gateway. Production needs TLS configured at nginx or an upstream load balancer.” Self-signed certificates and location permissions need actual phone testing; bypassing a warning does not universally guarantee geolocation works.

## 8. QR code generator and limits

`qrcode` renders both authenticator enrollment URLs and venue voting URLs as PNG data URLs. It generates the image; our crypto code supplies signed entry tokens.

Venue token format: `v1.bucket.signature`. A dedicated HMAC-SHA256 signs a 20-second time bucket. Current and previous buckets are valid, giving roughly 20–40 seconds depending on scan timing. The voting URL carries the token in `#entry=...`.

`POST /api/public/qr-entry` exchanges a valid code for `mc_q`, a ten-minute JWT containing an HMAC of the client IP. Public state reports whether the grant matches. Authorized display/admin endpoints generate the rotating QR.

**Important source limitation:** `hasEntry` is used for public state/UI gating. The checked OTP request/verify and vote handlers do not enforce it themselves. Do not call QR entry a complete server-side barrier against custom API clients. It is not a one-use token, and shared NAT means IP binding is not unique device binding.

## 9. Live stream: SSE, Redis and polling

> “We use Server-Sent Events because results primarily travel server to screen. Votes use normal HTTP POSTs. The browser receives snapshots with EventSource and polls if streaming fails.”

SSE is one long-lived HTTP response. WebSockets are bidirectional; the project does not use them.

After a committed vote, Redis pub/sub on `mc2026:events` notifies every replica. Each invalidates its local result cache and pushes to its own screens. The notification is a recomputation trigger, not the authoritative count.

PostgreSQL aggregates votes by category/exhibitor and counts distinct voters. ResultsService has a 750 ms local cache, shared in-flight computation and 400 ms burst-coalescing timer. Ties use ranks 1, 1, 3. Settings and reset events also invalidate results.

`/api/display/stream` supplies SSE; `/api/display/results` supplies snapshots. An admin session or display cookie matching the current display key is required. Stream events/heartbeats recheck authorization, allowing key rotation to affect existing streams. nginx disables buffering and allows a long timeout.

There is an initial snapshot, 20-second heartbeat and ten-second server safety refresh. The frontend falls back to five-second polling on errors or 30 seconds without result events. EventSource can reconnect; the shared client helper rejects older timestamped snapshots.

Redis failure makes immediate notifications local to each replica. Periodic DB snapshots/polling still let screens converge. This is near-real-time, not an instantaneous or durable event-stream guarantee.

## 10. Shared rate limiting

The limiter is custom, using **ioredis**, not express-rate-limit/Nest throttler. Redis keys start `mc2026:rl:`. A MULTI/EXEC transaction performs INCR, EXPIRE with NX, and TTL. This is a fixed window beginning on first hit. Every healthy replica consults the same counter.

Limits cover IP attempts, phone resend/hourly budgets and visitor vote requests. HTTP 429 includes retry information. Venue IPs receive larger budgets because NAT can place many legitimate phones behind one IP. Example: OTP requests allow 20 per ten minutes for a regular IP versus 5,000 for a recognized venue IP; phone limits remain. nginx adds coarse 300 requests/second IP protection with a burst allowance.

When Redis fails, the service uses an in-memory counter **per replica**. Voting continues, but limits are no longer globally shared. Redis has no persistence in Compose and uses eviction, so counters are temporary abuse protection. PostgreSQL duplicate-vote prevention remains intact.

## 11. CSRF and roles

CSRF means another site tries to make a browser perform actions using its authenticated cookies.

Every non-GET/HEAD/OPTIONS API request requires `x-requested-with: mc2026`; the frontend API wrapper sets it. Cross-site forms cannot set that custom header, and cross-origin JavaScript requires permitted CORS behavior. SameSite=Strict adds protection; the inspected same-origin setup does not enable permissive CORS.

This is a fixed marker, **not a random secret CSRF token**. It does not authenticate users or solve XSS. Guards enforce identity/permissions; Helmet CSP and normal React escaping help with browser injection exposure.

Roles are `admin` and `viewer`. AdminGuard loads current database permissions; role decorators restrict full-admin writes/private exports. Display authorization uses a separate rotatable key, so a TV does not need unrestricted admin credentials.

## 12. Audit log

`audit_log` stores actor, action, structured detail, IP and timestamp. Events include logins/failures, MFA/password/account changes, catalog/settings changes, exports, resets and off-site blocks. The UI retrieves the newest 100 entries, excluding large saved snapshots from normal listings.

AuditService can participate in the business transaction when passed its manager. Outside a transaction, logging failures are caught and warned about. Reset/restart explicitly require transactional logs: failure rolls back the operation.

Say “an append-style application audit trail,” not “tamper-proof.” No inspected database immutability or cryptographic chain enforces that claim. Individual votes are durable vote rows with their own metadata; audit logging is separate.

## 13. Libraries: uploads, exports and everything requested

| Capability | Library / implementation |
|---|---|
| Upload | Nest FileInterceptor + **multer** memory storage, multipart `photo` |
| Image limits | One file, 3 MiB; nginx request cap 4 MiB |
| Image validation | MIME allowlist and leading bytes for JPEG/PNG/WebP; no image-processing SDK. WebP check only verifies RIFF prefix, not full decoding. |
| Image storage/serving | PostgreSQL BYTEA; UUID/MIME/SHA-256; `/img/:id` with ETag/cache headers |
| CSV export | Custom `toCsv`, quoting/escaping, UTF-8 BOM and formula-like-cell prefixing; no export library |
| JSON export | Normal JSON response |
| QR rendering | **qrcode** |
| Limits / cross-node events | **ioredis** + custom services |
| JWT / cookies | **jsonwebtoken**, **cookie-parser** |
| Password/encryption/TOTP | Built-in Node **crypto** |
| SMS | Built-in fetch → Twilio REST or generic HTTP gateway; console demo adapter |
| Validation | **class-validator**, **class-transformer** |
| HTTP headers | **helmet** |
| SSE | Nest `@Sse`, **rxjs**, browser EventSource |
| Database | **typeorm**, **pg** |
| Frontend | React, React DOM, React Router; TypeScript/Vite |
| Tests | Jest, ts-jest, Nest testing utilities, Supertest and verification scripts |

Results exports are CSV/JSON; visitor exports are CSV, optionally consent-filtered. Normal visitor views mask phone numbers; authorized audited exports can include full decrypted phones. PostgreSQL image storage simplifies replicas but increases DB/backup size; object storage is a future option.

## 14. Docker Compose and operational scripts

The multi-stage Dockerfile builds React and Nest separately, then packages production dependencies and static frontend in Node 22 Alpine. Runtime uses non-root `node` and `tini`. Compose has PostgreSQL 16, Redis 7, one-shot seed service, two app replicas by default and nginx. PostgreSQL persists in `pgdata`. nginx discovers replicas through Docker DNS.

Deployment example: `docker compose up -d --build`. Scale example: `docker compose up -d --scale app=4`. These commands were not run to prepare this guide.

| Script | Purpose |
|---|---|
| `scripts/start-lan.mjs` | Checks Compose; builds/starts stack; binds nginx localhost:3000 with LAN IP config; starts gateway |
| `scripts/lan-gateway.mjs` | Discovers LAN interfaces; generates/reuses certs; HTTPS proxy; HTTP redirect; preserves phone IP |
| `scripts/check-config.mjs demo` / `event` | Checks cookies, secret length, DB password, public URL and SMS/demo requirements |
| `scripts/verify-stack.mjs` | Checks two replicas, shared counters, subscriptions, cross-replica events, local fallback and health |
| `scripts/db-recovery.mjs backup` | PostgreSQL custom-format pg_dump plus SHA-256 manifest |
| `scripts/db-recovery.mjs verify <dump>` | Verifies checksum, restores into temporary DB, checks schema/readability, drops temporary DB; does not overwrite live DB |
| `scripts/loadtest.js` | Page storm, full OTP/voting flows with configurable concurrency, count checks and SSE convergence |
| `scripts/simulate.js` | Generates visitor journeys and demo vote records |

Load/simulation scripts require supervised demo settings including OTP echo; they write data. Config checks cannot prove real SMS or physical venue behavior.

`/healthz` is liveness. `/readyz` checks PostgreSQL, reports optional Redis, and returns 503 when DB is down. Docker app healthcheck uses liveness, not complete dependency readiness.

Multiple replicas improve the app tier. The supplied stack still has one nginx, one DB, one Redis and one host: it is **not complete high availability**. PostgreSQL outage prevents voting. Backups/restore verification are recovery tools, not automatic failover.

## 15. Likely technical questions: rehearse these answers

**Why not keep totals only in Redis?** PostgreSQL vote rows are authoritative. Redis can restart or lose notifications; we recompute counts from durable constrained rows.

**What if someone clears cookies?** They must verify a phone again. The same normalized phone maps to the same visitor, whose existing category votes remain. Another phone is another identity; we do not prove one physical human.

**What if requests reach different servers?** They share PostgreSQL constraints and healthy Redis counters. Shared signing keys let either server validate JWTs.

**What if a vote commits but the response is lost?** Retrying cannot create a second category vote. Duplicate responses/current-session reads reconcile the UI. OTP response-loss recovery is separate and has known limitations.

**Can a visitor change a vote?** The normal path inserts once per category; it does not update an existing vote. Admin reset/restart can clear a round.

**How is SQL injection handled?** Validation plus parameterized SQL/ORM access keeps values separate from SQL syntax. Authorization and DB constraints provide additional, different protections.

**Are passwords encrypted?** Passwords use salted scrypt hashes. Personal fields that need authorized retrieval use AES-256-GCM.

**Why encrypted phone plus phone HMAC?** Encryption permits retrieval; HMAC supports stable indexed lookup/uniqueness without indexing plaintext.

**Does HTTPS prove location is real?** No. It protects transport and enables secure browser APIs. Location remains client-reported.

**Does Redis failure create duplicate votes?** No. PostgreSQL enforces uniqueness; globally shared limits and immediate notifications degrade.

**Is real SMS working?** Provider adapters exist, but delivery depends on assigned credentials/configuration and an end-to-end test. Console/echo mode proves a supervised demo, not real delivery.

**Can you support 1,000 users?** Architecture and scripts target that load. The existing audit describes a historical run of 1,000 visitors at full-flow concurrency 250, plus a separate 1,000-request page storm. Distinguish that from 1,000 simultaneous complete flows; do not invent a new benchmark.

**How do you recover the database?** Custom-format backups with checksums are restored/tested in a temporary database. Actual incident restoration/failover needs an operational procedure; preserve encryption secrets as well as data.

**What would you improve?** Server enforcement of required QR grants; actual phone/TLS/SMS venue testing; MFA replay/recovery hardening; database/proxy failover if required; object storage and more scalable identity checking as data grows.

## 16. Do not overclaim

| Avoid | Accurate wording |
|---|---|
| WebSockets | SSE with polling fallback |
| Mandatory MFA for everyone | Optional admin TOTP; visitor SMS OTP |
| Unspoofable GPS | Client-reported coordinates checked against geofence |
| QR blocks every API client | Signed rotating QR/UI gate; server action enforcement gap |
| Shared limits during Redis outage | Local per-replica fallback |
| Tamper-proof audit | Append-style application history |
| Compose provides production TLS | Gateway supplies LAN TLS; production TLS needs configuration |
| No single point of failure | App replicas; shared infrastructure failure points remain |
| Anonymous votes | Protected identity data linked relationally to votes |

## 17. Source map for technical follow-ups

All paths are relative to repository root.

| Topic | Source |
|---|---|
| OTP/vote transactions | `backend/src/visitor/visitor.service.ts` |
| Public routes/QR flags | `backend/src/visitor/visitor.controller.ts` |
| Tables/constraints | `backend/src/database/migrations/1759600000000-Init.ts` |
| Identity triggers | `backend/src/database/migrations/1791370000000-ExhibitorCategoryIdentity.ts` |
| DB configuration/migrations | `backend/src/database/data-source.ts`, `migrate.ts` |
| Hashing/encryption | `backend/src/common/crypto.util.ts` |
| Secret derivation | `backend/src/config/config.ts` |
| Sessions/guards/CSRF | `backend/src/auth/session.service.ts`, `guards.ts`, `csrf.middleware.ts` |
| MFA | `backend/src/admin/admin-auth.service.ts`, `backend/src/common/totp.util.ts` |
| IP/geofence | `backend/src/core/access.service.ts`, `backend/src/common/geo.util.ts` |
| Browser location | `frontend/src/lib/util.ts` |
| QR | `backend/src/core/vote-qr.service.ts` |
| SSE/results | `backend/src/results/results.service.ts`, `backend/src/display/display.controller.ts` |
| Browser fallback | `frontend/src/lib/live-results.ts`, `frontend/src/admin/views/Dashboard.tsx` |
| Redis/rate limits | `backend/src/redis/bus.service.ts`, `backend/src/core/rate-limit.service.ts` |
| Audit/exports/reset | `backend/src/core/audit.service.ts`, `backend/src/admin/reports.service.ts` |
| Upload | `backend/src/admin/admin.controller.ts`, `catalog.service.ts` |
| SMS | `backend/src/sms/sms.service.ts` |
| Deployment | `Dockerfile`, `docker-compose.yml`, `deploy/nginx.conf`, `deploy/real-ip.lan.conf` |
| Existing evidence | `docs/PROJECT_AUDIT_2026-10-08.md`, `docs/loadtest-results.json`, `backend/test/` |

Existing audit/test numbers are historical evidence. Preparing this guide did not rerun tests, load generation, real SMS or phone venue checks.
