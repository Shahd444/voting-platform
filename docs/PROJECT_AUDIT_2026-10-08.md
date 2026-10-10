# Project integration audit — 8 October 2026

## Follow-up fixes — 8 October 2026

Findings **A4, A5 and A6 have been implemented** after this audit:

- Reopening voting and hiding winners now share a transaction with both audit entries and a consistent settings lock order.
- Dashboard winner state follows fresh server settings every five seconds and on tab visibility; pending older settings reads cannot overwrite completed local actions. This also applies to multiple tabs belonging to the same admin.
- Pagination rejects invalid/non-integer values with HTTP 400, caps the page size at 200, uses deterministic ordering and preserves the total on empty pages using one database snapshot. The frontend returns to a valid page after the total shrinks.

The original findings below document the audited behavior before these fixes. Other findings remain open.

Validation after these changes: both builds passed, all **263 backend tests** passed in an isolated database (including display-write and audit-write rollback failures), and all **8 frontend tests** passed. No migration or event-data reset was needed.

Subsequent fixes resolve **A1 and A2**: registration/OTP now respect the server's QR-required/allowed flags, expired-grant rejections return to scan instructions, and automatic/manual GPS share a backend access-check path. Approved GPS is rechecked during state refresh; coordinates alone no longer unlock registration. Existing verified sessions retain the backend's QR exemption. Build and **11 frontend tests** passed, including QR gating, access rejection and access-check failures. Physical phone/venue verification remains outstanding.

## Verdict and scope

The frontend, backend and PostgreSQL schema implement the main challenge features and their routes are connected. The project is **not yet fully verified for event use**: there are voter-flow integration defects, a cross-settings atomicity gap, and deployment prerequisites. Passing tests alone does not certify every browser journey.

Reviewed against the supplied Maker Collective 2026 / 42 Amman challenge statement, current source, migrations, API contracts, Docker configuration, selected non-secret runtime settings and database configuration. This audit covers admin, visitor and TV display. Existing uncommitted changes were preserved; no application logic or event records were changed for this audit.

### Executed verification

- Backend build: passed.
- Frontend TypeScript/Vite build: passed.
- Complete backend Jest suite: **259 tests passed across 6 suites**. Run against a newly created temporary PostgreSQL database, with `TZ=UTC`; the runner dropped that database afterward. Existing event data was not reset.
- Frontend Node tests: **8 passed**, covering schedule conversion, admin session handling and live results.
- Inspected current running Docker services, public state response and non-sensitive database settings.
- Checked frontend calls against backend controllers and inspected schema constraints and transaction boundaries.

Not performed: a complete interactive browser walkthrough, real SMS delivery, real mobile GPS/QR scans, production TLS testing, new destructive load tests, or host/database failover drills. Source findings below should not be mistaken for visual/browser certification. The backend's UTC test run and frontend conversion tests support timezone correctness; a full deployment/browser test under multiple timezone configurations remains useful.

## Challenge feature coverage

| Requirement | Frontend → backend → database | Assessment |
|---|---|---|
| F1: photo, name, description, category | Visitor ballot reads public catalog; admin exhibitor forms use catalog/image APIs; exhibitor/category/image relationships persist | Implemented. Active-exhibitor validation exists. Actual final content/photos still need organizer review. |
| F2: one vote in each of three categories | Ballot submits category/exhibitor IDs; backend validates assignment and verified visitor; DB enforces unique visitor/category votes | Implemented for current three active categories. Admin can configure more than three; see A7. |
| F3: confirmation and progress | Ballot confirmation and saved-vote progress use returned visitor session | Implemented. `409 already_voted` restores the server session correctly. |
| F4: mobile/QR access | Responsive visitor page, QR-entry exchange, admin/public links, TV rotating QR | Implemented with entry-screen and mobile deployment gaps: A1, D2. Visual/mobile verification remains outstanding. |
| F5: name + phone, no password | RegisterScreen → OTP request → encrypted visitor record | Implemented. No visitor password requirement. |
| F6: real SMS OTP | OTP request/verify/resend UI and provider integration; hashed, expiring challenges | Code implemented; current console/echo mode does not prove real SMS delivery. Recovery gap A3. |
| F7: live category results, protected display | Admin/display streams plus snapshots; display key/account authorization | Implemented. Current TV QR consumes the rotating-token endpoint. |
| F8: readable TV standings | Dedicated display layout, category results and winner presentation | Implemented in source; distance/contrast/readability require visual venue testing. |
| F9: catalog administration | Category/exhibitor CRUD, slug, photos, assignment and confirmed force-delete flows | Connected. Backend validation and conflict handling exist. |
| F10: open/close voting | Dashboard settings API, Amman schedule conversion, strict offset-bearing timestamps, backend window evaluation | Implemented; schedule order validated. A4 affects reopening and winner-display consistency. Confirmed event dates still needed. |
| F11: on-site access | Admin IP/GPS settings; backend access checks on protected visitor actions; blocked-attempt audit/statistics | Implemented enforcement. Automatic GPS UI is inconsistent (A2), and current deployment rules require verification (D2–D3). |
| F12: verified phone and duplicate prevention | Verified visitor cookie; phone HMAC uniqueness; PostgreSQL unique visitor/category constraint | Implemented and covered by backend tests. Concurrent writes are protected at the database level. |
| F13: export results | Admin results CSV/JSON → report endpoints → category rankings/counts | Implemented. Private visitor export is separately restricted. |
| F14: private identity linked to votes | AES-256-GCM name/phone storage, HMAC phone lookup, restricted admin endpoints; vote foreign keys | Implemented backend protections. Browser form retention and optional outreach UI gap: A8. |
| 1,000 users / scaling | Two application replicas, shared DB/Redis, historical load-test artifact | Partial verification. Historical test completed 1,000 visitors at flow concurrency 250, plus 1,000 simultaneous page requests; not a fresh 1,000-concurrent full-flow test. |
| HA / no single point of failure | Multiple application replicas behind nginx | Partial: nginx, PostgreSQL, Redis and host remain shared failure points in the supplied compose deployment. |
| Network resilience | Offline banner, snapshot fallback, idempotent vote reconciliation | Substantial implementation; OTP response-loss recovery still incomplete (A3). |
| Documentation / deployment artifacts | Architecture/database/deployment and frontend handoff documents exist | Some handoff contracts are outdated (A9); deployment and failover must be exercised in the target environment. |

## Route and API coverage

| Surface | Routes / calls reviewed | Result |
|---|---|---|
| Visitor `/` | Public state, QR entry, access check, OTP request/verify, votes and returned session | Calls match backend routes. A1–A3 are state/flow defects rather than missing endpoints. |
| TV `/display` | Display authorization, snapshot/stream, rotating QR | Connected. QR refresh scheduling uses the backend `refreshIn` value. |
| Admin sign-in | Login, MFA challenge, session lookup, logout | Connected; centralized expiry handling, password visibility and rate-limit button state exist. |
| Dashboard | Settings, statistics, results stream/snapshot, manual voting, schedules, winner display | Connected; A4–A5 remain. Active exhibitor and blocked-attempt statistics are implemented. |
| Categories / exhibitors | Lists, CRUD, custom slug, image upload/delete, assignments, force deletion | Connected. Destructive confirmation and pending/error handling exist. |
| Results | Snapshot, CSV/JSON exports, confirmed reset | Connected. Reset transaction closes voting and clears results consistently; saved visitor state refresh/retry paths exist. |
| Visitors | List/pagination and restricted export | Connected, but pagination contract has edge cases (A6). |
| Settings: access / event | Independent access-mode/CIDR/geofence changes; event details/public address/display settings | Connected. Nullable coordinates and zero accuracy are preserved; IP/off modes do not require geofence fields. |
| Account / team | Password change, MFA setup/enable/disable, team list/create/remove | Connected, with pending/error handling and code-validation forms. |
| Activity | Audit list, refresh and expanded details | Connected. |
| Unknown paths | Main exact admin route whitelist and fallback NotFound | Unknown paths such as `/adminff` render NotFound instead of the voter page. An HTTP 200 from SPA hosting alone is not evidence of incorrect client routing. |

Viewer accounts reuse the admin shell with restricted views/actions; backend authorization remains authoritative. No missing main frontend-to-controller route was found in the inspected calls.

## Findings, ordered for fixing

### A1 — High: QR-required state is not used to gate registration

`PublicState` exposes `qrEntryRequired` and `qrEntryAllowed`, but VotePage does not use those flags when choosing the registration/OTP screens. Opening the plain voting URL without a grant shows the form; the visitor learns they must scan the venue QR only after submitting to a rejecting endpoint. Grant expiry has similar behavior.

Evidence: `frontend/src/vote/VotePage.tsx:154`, `frontend/src/lib/types.ts:12`, `frontend/src/vote/Signup.tsx:61`; backend contract in `backend/src/visitor/visitor.controller.ts`.

Fix: explicitly render a venue-scan instruction screen when a new registration requires a grant, reconcile state after exchange/expiry, and distinguish QR rejection from a temporary network failure. Keep existing verified-session behavior consistent with backend policy.

### A2 — High: automatic GPS acquisition is treated as sufficient access

The automatic geolocation callback stores coordinates without asking the backend whether they are inside the geofence. Rendering checks `!onSite && !location`, so any coordinates can advance an unverified visitor to registration even when outside. Existing sessions are rendered before the access branch. Backend OTP/vote checks still reject invalid access; this is a misleading UI flow, not evidence that voting enforcement is bypassed.

Evidence: `frontend/src/vote/VotePage.tsx:102`, `frontend/src/vote/VotePage.tsx:116`, `frontend/src/vote/VotePage.tsx:160`. The explicit location button in Screens already performs a backend access check.

Fix: use the same access-check path for automatic and manual GPS, separate “coordinates obtained” from “access accepted,” and show clear off-site guidance. Preserve backend checks on every protected action.

### A3 — High: interrupted successful OTP verification may strand the visitor

If verification succeeds and the browser receives the session cookie but loses the response body, the catch handler does not reload session state. Normal polling and tab-visible refresh are suspended while an OTP challenge exists. Retrying a consumed challenge can return `otp_invalid`, leaving the UI on the OTP screen until a manual reload/resend. An actual browser/network reproduction is still needed; the recovery path is absent in source.

Evidence: `frontend/src/vote/Signup.tsx:137`, `frontend/src/vote/Signup.tsx:146`, `frontend/src/vote/VotePage.tsx:54`, `frontend/src/vote/VotePage.tsx:138`.

Fix: reconcile `/api/public/state` or the current visitor session after an ambiguous verification failure, clearing the challenge when the server reports a verified session. Consider backend idempotency if the response/cookie is completely lost. Keep the already implemented vote-409 recovery.

### A4 — Medium: reopening voting and hiding winners are two commits

`updateVoting` saves/audits voting first, then separately updates `display.show_winners`. If the second update fails, voting is already changed but the request fails; winner display can remain enabled. The first save does not make both changes atomic, and the automatic display change is outside the same audit transaction.

Evidence: `backend/src/admin/event.service.ts:59`–the save followed by the separate display update; transactional settings implementation in `backend/src/settings/settings.service.ts:59`.

Fix: update voting and the associated display flag, with audit, in one database transaction using consistent row-lock ordering. Add a failure-injection test for rollback and concurrent display/voting updates.

### A5 — Medium: winner controls can become stale across admin sessions

Dashboard polling updates voting state but not the displayed `show_winners` setting. After a local toggle, local `winners` overrides the loaded value indefinitely. Another admin changing that setting can leave this screen showing the wrong state; the next click may reapply the existing server state rather than toggling it.

Evidence: `frontend/src/admin/views/Dashboard.tsx:43`, `frontend/src/admin/views/Dashboard.tsx:213`.

Fix: reconcile winner-display state from authoritative settings/live snapshots, and avoid an indefinite optimistic override. Also avoid basing “open now” schedule clearing on an older initial settings object after another admin edits the schedule.

### A6 — Medium: visitor pagination accepts invalid numbers and loses totals on empty pages

The backend converts query values directly to SQL LIMIT/OFFSET without requiring finite nonnegative integers. Negative/fractional limits or non-finite values can produce query failures. Its window-count total becomes zero when the requested page has no rows, even if visitors exist on earlier pages.

Evidence: `backend/src/admin/reports.service.ts:63`–73.

Fix: validate/clamp integer pagination values; compute the total independently or otherwise preserve it for empty pages. Reconcile an out-of-range frontend offset after deletion/reset.

### A7 — Low / configuration guard: exactly three categories is not a global invariant

The live DB has exactly three active categories, so the current configuration satisfies the challenge. The generic catalog permits adding more active categories, and ballot progress follows all returned categories; it does not impose a global three-category cap.

Fix: make the event's required category count explicit and validate/alert on publication or voting opening. Do not arbitrarily rename categories until organizers confirm them.

### A8 — Low: optional outreach and browser-data cleanup are incomplete

Registration keeps `consent: false`, but the current form has no outreach opt-in field. The backend and consent-filtered visitor export support it, so new users cannot elect to opt in through this UI. This is an optional integration gap, not a missing mandatory challenge feature.

Name/phone form values are saved in sessionStorage and not cleared after successful registration/completion. Backend encryption does not remove these browser copies. Also, OTP input strips non-ASCII digits before calling its normalization handler, preventing the advertised Arabic-Indic conversion; the new registration heading is hardcoded English despite the language toggle.

Evidence: `frontend/src/vote/VotePage.tsx:29`–36; `frontend/src/vote/Signup.tsx:6`, `:99`, `:159`, `:187`.

Fix: expose voluntary consent only if organizers want it, clear unnecessary form/challenge data after success, normalize digits before filtering, and translate the heading.

### A9 — Medium: frontend handoff documentation describes obsolete contracts

The handoff still says bare schedule timestamps are accepted, reset does not close voting, and display QR returns `{ url, qr }`. Current code enforces offset-bearing schedule timestamps, closes voting during reset and returns rotating QR timing metadata. Its verification counts and remaining-work list also predate current fixes.

Evidence: `docs/FRONTEND_BACKEND_HANDOFF.md:255`, `:265`, `:316`, `:327`, `:384`, `:409`.

Fix: synchronize the document with current controllers/services and this audit before another integration pass.

## Live configuration and deployment prerequisites

### D1 — Real SMS is not configured/verified

Selected local flags are development mode, console SMS provider, OTP echo enabled and insecure cookies. These support development; they do not fulfill real SMS delivery verification. Configure the approved provider, disable echo, use production settings/HTTPS, and test delivery, expiry, resend and provider outages with real phones. Do not claim provider delivery from mocked backend tests.

### D2 — Public address is LAN HTTP; mobile GPS needs a secure context

The database public-address override is `http://192.168.1.179:3000`. QR links use this override rather than the localhost environment fallback. Actual phone reachability was not verified. On ordinary remote HTTP origins, browsers restrict geolocation; localhost's special treatment does not extend to a phone opening a LAN IP.

Provide a reachable HTTPS address with a certificate trusted by phones. The repository includes a LAN gateway workflow, but its existence does not prove the current deployment uses it.

### D3 — Proxy/IP rules require a venue test

Current access mode is `ip_or_geo`, with allowed ranges `192.168.1.0/24` and `172.19.0.1/32`. The latter is a Docker bridge address. The local public state currently reports access allowed without GPS. This does not establish how real external/venue clients appear through Windows/Docker/nginx; if unrelated callers collapse to an allowed bridge address, IP enforcement could be broader than intended.

The compose application setting trusts one proxy hop; nginx's default real-IP profile does not independently prove original phone IP preservation. Verify actual backend-observed IPs from on-site and off-site devices before accepting this rule. Never trust arbitrary client-supplied forwarded headers.

The geofence is latitude 31.95317, longitude 35.965875, radius 150 m, maximum accuracy 500 m. Organizer confirmation and physical boundary tests remain necessary. No location timestamp is required by the subject; deferred freshness enforcement is not classified as a missing requirement.

### D4 — Event content/window await confirmation

Current active category names:

1. Most Innovative Project
2. Best Community Impact
3. Best Craft & Design

Current DB has 21 active exhibitors and 1 vote. Voting is enabled, with no start timestamp and an end timestamp of `2026-10-09T10:52:00.000Z` (**9 October, 13:52 Amman**). These are observed configuration values, not confirmation of final event content or dates. Preserve rehearsal data until an authorized reset is appropriate.

### D5 — HA and load evidence have limits

Two app replicas improve application availability, but the current compose topology still has one nginx service, PostgreSQL instance, Redis instance and host. Meeting the full “no single point of failure” objective requires an appropriate database/proxy/host failover design and tested recovery.

`docs/loadtest-results.json` records 1,000 successful simultaneous page requests and 1,000 completed visitor flows at concurrency 250, with 3,000 votes. This is historical evidence, not a fresh test of the current dirty working tree or real SMS. A realistic isolated load test should include the current QR/access configuration, provider constraints and failover; it must not pollute the live event database.

## Recommended order

1. Fix QR/GPS screen gating and OTP recovery (A1–A3).
2. Make reopening/winner updates atomic and reconcile admin state (A4–A5).
3. Harden pagination, enforce the event category configuration and finish small privacy/language improvements (A6–A8).
4. Update integration documentation (A9).
5. Confirm real SMS, reachable HTTPS, actual proxy/IP behavior, venue coordinates and final event schedule/content (D1–D4).
6. Run phone/browser journeys, isolated realistic load tests and deployment recovery checks (D5).

The rotating TV QR, blocked-attempt statistics, vote-409 session restoration, strict schedule timestamps, reset transaction, category slug/forced deletion, nullable access settings, zero accuracy handling and unknown-route fallback are already present. They should be verified in the final end-to-end run rather than rebuilt.
