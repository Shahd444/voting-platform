# Technical Reliability Report

## 1. Current System Summary

The voting system is a React frontend served by a NestJS backend, with PostgreSQL as the source of truth and optional Redis for cross-instance pub/sub, shared rate limits and short-lived caches. The same backend image can serve the visitor voting page, admin console, public display and API.

Important state is already stored outside the application process:

- Visitors, OTP challenges, votes, exhibitors, categories, event settings, admin accounts and audit logs live in PostgreSQL.
- Visitor, admin and display sessions are signed JWT cookies, so any backend instance can validate them without sticky sessions.
- Live results are computed from PostgreSQL. Redis improves fan-out between replicas, but the display periodically refreshes from the database so it can recover if a message is missed.
- Exhibitor images are stored in PostgreSQL for the prototype, keeping backend replicas stateless. A production deployment can move these to object storage/CDN without changing the voting rules.

The repository also includes Docker support, an nginx reverse-proxy/load-balancer config, database migrations, health checks, and backend tests that cover the main voting and admin flows.

## 2. What Was Missing Or Weak

Most reliability requirements were already present in the project. The audit found two areas worth tightening:

- The vote endpoint relied on the visitor JWT having been issued after OTP verification. That is normal, but production logic is stronger when it also checks the database record before inserting a vote.
- SMS provider selection existed, but provider-specific code lived directly inside `SmsService.send`. A clearer `sendOtp(phone, code)` abstraction makes the later CPF provider decision easier to plug in.

No major infrastructure rewrite was needed.

## 3. What Was Implemented

The backend vote path now checks that the visitor still exists and has `verified_at IS NOT NULL` inside the vote transaction before inserting a vote. If not, the API returns `401 not_verified` instead of relying on a database foreign-key failure or an old cookie.

The vote insertion remains database-enforced and idempotent:

- First successful vote returns `201`.
- Retrying the exact same vote returns `200` with `duplicate: true`.
- Trying a different exhibitor in the same category returns `409 already_voted`.

The SMS layer was refactored into a small provider abstraction:

- `SmsService.sendOtp(phone, code)` builds the OTP message.
- Provider adapters handle `console`, `twilio`, and generic `http`.
- Provider selection remains environment-based with `SMS_PROVIDER`.

A focused e2e test was added to prove that a visitor whose database verification is removed cannot vote with an old visitor cookie.

## 4. Safe Voting And Duplicate Prevention

Duplicate vote prevention is enforced by PostgreSQL, not by frontend state:

- `visitors.phone_hash` is unique, so the same normalized phone number maps to one visitor identity.
- `votes` has `CONSTRAINT one_vote_per_category UNIQUE (visitor_id, category_id)`.
- The vote insert uses `ON CONFLICT ON CONSTRAINT one_vote_per_category DO NOTHING`.

This means double-clicks, page refreshes, browser retries, two tabs, or two backend instances racing the same request cannot create two votes for one verified visitor in one category.

The backend also validates that the exhibitor belongs to the selected active category before accepting the vote. The database includes a composite foreign key from `(exhibitor_id, category_id)` to `exhibitor_categories`, so the integrity rule is protected at the storage layer as well.

## 5. Network Drops During Voting

The frontend disables the confirm button while a vote is being submitted and uses the shared API wrapper with retry/backoff for safe vote submissions.

If the network drops after the server records the vote but before the browser receives the response, the next identical submission is safe. The database conflict is detected and the backend returns the current session with `duplicate: true`, allowing the frontend to show the already-recorded vote instead of creating another one.

If the user tries to submit a different exhibitor after one has already been recorded for that category, the backend returns `409 already_voted` with the latest session state.

## 6. Stateless Backend

The backend is logically stateless for voting and authentication:

- OTP challenges are stored in PostgreSQL.
- Visitor sessions are signed JWT cookies.
- Admin sessions are signed JWT cookies with token-version revocation on password change.
- Display sessions are signed JWT cookies bound to the current display key.
- Votes, settings, images, categories and exhibitors are stored in PostgreSQL.

Redis is optional and improves shared rate limits, short caches and live-results pub/sub. If Redis is unavailable, voting still works because the critical state is in PostgreSQL. The tradeoff is that rate limits become per-instance and live screens may rely on periodic database refreshes until Redis returns.

## 7. SMS Provider Abstraction

SMS sending now goes through `SmsService.sendOtp(phone, code)`. The concrete provider is selected by environment:

- `SMS_PROVIDER=console` logs messages for local development and demos.
- `SMS_PROVIDER=twilio` uses Twilio credentials from environment variables.
- `SMS_PROVIDER=http` sends a JSON payload to a generic HTTP gateway.

To plug in CPF's final provider, add a new provider adapter in `backend/src/sms/sms.service.ts`, add its configuration to `backend/src/config/config.ts` if needed, and set `SMS_PROVIDER` in the deployment environment. Provider credentials must remain in environment variables or a secrets manager, never in source code.

## 8. Local And Cloud Portability

The project can run locally or in cloud without special hardware:

- Local development can use Node.js 20+, PostgreSQL and optional Redis.
- Docker Compose runs nginx, multiple backend replicas, PostgreSQL and Redis.
- The backend reads infrastructure configuration from environment variables such as `DATABASE_URL`, `REDIS_URL`, `PUBLIC_URL`, `TRUST_PROXY`, `APP_SECRET`, `ADMIN_PASSWORD` and `SMS_*`.
- The frontend uses same-origin API paths in application code. The only localhost URLs are Vite development proxy targets and local documentation examples.

For production, the logical deployment is:

- A load balancer or nginx in front of two or more backend instances.
- PostgreSQL with backups and, ideally, managed failover.
- Optional Redis for cross-replica live updates and shared rate limits.
- External SMS provider selected by environment configuration.
- Object storage/CDN for images if the catalog becomes large.

## 9. No Single Point Of Failure Thinking

The prototype still runs as a normal small app, but the architecture supports production scaling:

- Multiple backend instances can run behind nginx or a cloud load balancer.
- Backend instances do not need sticky sessions.
- Live results are calculated from PostgreSQL and can recover from dropped SSE or Redis messages.
- Database migrations run under a PostgreSQL advisory lock, so multiple replicas can boot safely.
- Docker Compose demonstrates scaled app replicas; cloud deployment can map the same design to ECS/App Runner, Azure Container Apps, Cloud Run, or similar platforms.

The main stateful dependency is PostgreSQL. Production should use automated backups, point-in-time recovery, monitored disk capacity and managed failover. `APP_SECRET` must be backed up securely because it is required to decrypt stored PII.

## 10. Recommended Later Production Improvements

- Use managed PostgreSQL with automatic failover and point-in-time recovery.
- Store `APP_SECRET`, database credentials and SMS credentials in a secrets manager.
- Use a managed Redis service if multiple app instances are deployed.
- Add centralized logging and alerts for SMS failures, database errors, high retry rates and failed health checks.
- Move exhibitor images to S3-compatible object storage plus CDN if media volume grows.
- Rehearse backup restore and display-key rotation before the live event.
- Test the final SMS provider at the venue with real phones before opening voting.
