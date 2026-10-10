# Design decisions

Short ADR-style records of the choices that shape the system.

### D1 — NestJS (TypeScript) API + React (Vite) front-end
**Context:** a student team must deliver a ~90 % production-ready prototype and hand it over to the Makerspace for real use.
**Decision:** NestJS 11 with TypeORM on PostgreSQL for the API; React 19 + Vite + TypeScript for the three interfaces in one SPA.
**Why:** TypeScript end-to-end; NestJS gives an opinionated, testable structure (modules, dependency injection, guards for authorization, DTOs + class-validator for input validation, first-class SSE and Jest/Supertest testing) that a future team can navigate; React is the most widely known UI library. Routes are lazy-loaded, so a visitor's phone never downloads admin code (visitor page ≈ 95 kB gzipped including React).
**Trade-off:** more dependencies and a build step than plain HTML/JS — acceptable for maintainability. The built React app is served by NestJS itself, so there is still just **one deployable image**.

### D1b — TypeORM entities, SQL-first migration and hot-path queries
**Decision:** entities document the model and back simple CRUD; the schema is created by a migration written in SQL, and the hot paths (vote insert with `ON CONFLICT`, tallies) are hand-written parameterised SQL.
**Why:** the anti-fraud guarantees rely on PostgreSQL features (composite FKs, named unique constraints, `ON CONFLICT ON CONSTRAINT`, `FOR UPDATE`) that are clearer and safer in SQL than through ORM abstractions. `synchronize` is off; migrations run under an advisory lock so replicas can boot simultaneously.

### D2 — PostgreSQL as the single source of truth, constraints over code
**Decision:** all data *and all settings* in PostgreSQL; anti-duplicate rules are database constraints (`UNIQUE(visitor_id, category_id)`, composite FK to `exhibitor_categories`).
**Why:** correctness under concurrency and across replicas comes for free and is provable; spec §6 requires database-driven settings.
**Trade-off:** PostgreSQL is the one stateful component → run it as managed HA in production.

### D3 — Stateless app servers with JWT cookies
**Decision:** sessions are signed JWTs in HttpOnly cookies; OTP state is in the DB; no sticky sessions.
**Why:** any replica can serve any request; scale by adding replicas; restarts lose nothing.
**Trade-off:** individual JWTs can't be revoked server-side; mitigated by short lifetimes, token version for admins (password change revokes all sessions), key-bound display cookies.

### D4 — Redis is optional, never required for voting
**Decision:** Redis only accelerates (pub/sub fan-out, shared rate limits, caches). Every use has an in-process fallback.
**Why:** spec asks for "no single point of failure that pauses voting". Tested by stopping Redis mid-event: voting continued.

### D5 — Server-Sent Events for the live dashboard
**Decision:** SSE with a polling fallback, rather than WebSockets.
**Why:** traffic is one-way (server → screen); SSE runs over plain HTTP through nginx/CDNs, auto-reconnects natively, needs no extra library. Bursts are coalesced to ≤ 2 updates/s and every push is a full snapshot, so a missed message self-heals.

### D6 — Two on-site signals, admin-selectable combination
**Decision:** IP range and browser geofence, combined via `ip_or_geo` / `ip` / `geo` / `ip_and_geo` / `off`.
**Why:** IP alone excludes visitors on mobile data; geofence alone is spoofable. Letting the team pick on the day (e.g. tighten to `ip` if Wi-Fi is solid) matches the real venue rather than an assumption. Checked at OTP request and at each vote.

### D7 — Phone as identity, encrypted at rest with HMAC lookup
**Decision:** normalise to E.164, store AES-256-GCM ciphertext + HMAC lookup key + last 4 digits.
**Why:** enables the uniqueness rule and future outreach (F14) without a plaintext, searchable phone column. Arabic-Indic digit support avoids accidental duplicate identities.

### D8 — Pluggable SMS provider
**Decision:** `console` / `twilio` / generic `http` webhook, chosen by env var.
**Why:** CPF selects the provider later (spec §6). A local Jordanian aggregator can be connected through the generic webhook with a ~20-line adapter. Demo mode echoes the code on screen in non-production only.

### D9 — Votes are final; retries are idempotent
**Decision:** a visitor cannot change a vote; duplicate category votes return 409 already_voted; the client restores the saved session.
**Why:** finality is simple to explain and to audit; idempotency makes the client's automatic retries on flaky Wi-Fi safe.

### D10 — Images in PostgreSQL for the prototype
**Decision:** exhibitor photos stored as `bytea`, served with immutable caching (new upload = new UUID).
**Why:** keeps app servers stateless with zero extra infrastructure; ~50 exhibitors × <3 MB is trivial. nginx/CDN caches them after the first request.
**Production path:** swap to S3-compatible object storage + CDN if the exhibitor count grows large.

### D11 — Bilingual visitor page (English / Arabic, RTL)
**Why:** MC2026 is in Amman; "usable by a non-technical visitor with zero instructions" means their language. Language follows the phone's setting and can be toggled.

### D12 — Live screen protected by a rotatable display key
**Decision:** spec requires a protected results page that still runs unattended on a TV. Admin copies a link containing a random key; the TV exchanges it for a cookie and removes it from the URL bar. Rotating the key instantly revokes every screen.
