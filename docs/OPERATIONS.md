# Operation and recovery

## Local HTTPS demo (console OTP)

Run `node scripts/start-lan.mjs` (or `make`). Keep it running. Public HTTPS is **8443**, HTTP redirects on **8080**, and Docker nginx binds only to **127.0.0.1:3000**. Trust the generated certificate on presentation phones as described in [LAN setup](LAN_EVENT_SETUP.md). Use the printed LAN address, never localhost, on phones.

Leave `PUBLIC_URL` and the saved admin public address empty for request-origin QR links, including port 8443. A fixed override must be the reachable HTTPS address. Rebuild/restart after environment changes.

Current demo: `NODE_ENV=development`, `SMS_PROVIDER=console`, `OTP_DEV_ECHO=true`, `COOKIE_SECURE=true`. Console codes still expire and have attempt/resend limits. Console delivery is intentional while no SMS provider is assigned.

Run `node scripts/check-config.mjs demo` to validate the local environment without printing secrets. `node scripts/check-config.mjs event` deliberately reports unmet event requirements while console delivery is in use; it does not change configuration.

Before a real event: set confirmed dates and venue IP/GPS settings in admin; verify on-site acceptance and off-site rejection on physical phones. Disable OTP echo and use production mode when a delivery provider is assigned. Console OTP is a supervised demo, not unattended phone delivery. Do not silently enable access bypass. Event readiness requires these external venue/provider decisions.

## Verification

`node scripts/verify-stack.mjs` checks both running replicas and the shared Redis limiter using a unique, short-lived test key. It checks live-update subscriptions without inserting votes or modifying event settings. Historical load tests are evidence for their recorded revision, not certification of the current deployment. Run load tests only against an isolated database.

## Backups and recovery

```sh
node scripts/db-recovery.mjs backup
node scripts/db-recovery.mjs verify backups/<printed-file>.dump
```

Backups use a consistent PostgreSQL snapshot and include schema, encrypted visitor data, votes, images and settings. Verification checks SHA-256 and restores to a temporary database, then drops that temporary database; it never overwrites the live database. Keep backups private, copy them to encrypted storage on another machine, and retain the matching `APP_SECRET` separately in a password manager: losing it prevents decrypting names/phones and authenticating existing sessions. Local ignored backups alone do not survive host loss.

Schedule the backup command daily with Windows Task Scheduler (working directory: repository), and before event changes. Keep at least seven daily copies off-host; verify a copy after transfer and before the event. Frequency determines possible data loss; daily copies can lose a day's votes. PostgreSQL WAL archiving/PITR on managed storage is the production improvement.

After failure: provision PostgreSQL 16, restore the selected archive with `pg_restore --exit-on-error --no-owner --no-privileges` into a **new empty database**, configure its credentials and the original APP_SECRET, start the app, verify health/admin totals and access settings, then direct traffic to it. Keep the failed database and archive for investigation; never restore over the only surviving copy. Record the last backup time and communicate any vote-loss window.

## Deployment plan beyond one computer

Two app containers tolerate an app-process failure; they do not tolerate this host or PostgreSQL failing. Deploy app replicas on two hosts behind a health-checking HTTPS load balancer; use managed PostgreSQL with automatic failover, private networking, encrypted backups and point-in-time recovery. Configure the same APP_SECRET and external DATABASE_URL on every replica, and shared Redis for limits/live updates. Redis failure retains database voting correctness but limits become per-replica and live updates rely on polling. Test database failover and an off-host restore before claiming high availability. These resources are not available in the current single-host setup.

## Verification recorded October 8, 2026

HTTPS `/admin` returned 200; `/readyz` reported database and Redis up. Both replicas passed shared-limiter and actual cross-container bus delivery checks. A current backup restored into an isolated temporary database with 11 tables. With one app container stopped, six consecutive HTTPS admin requests returned 200 (first approximately 2.2 seconds; subsequent approximately 0.24 seconds); the container was restarted. This checks the current local deployment, not phone certificate trust, venue enforcement or a new 1,000-visitor load run.
