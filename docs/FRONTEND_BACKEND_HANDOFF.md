# MC2026 backend API and frontend handoff

Source review: 7 October 2026. This document describes the implemented backend, not proposed endpoints. Examples are illustrative and do not configure the event. No frontend or deployment changes are included.

## 1. Integration conventions

- Use relative URLs on the same origin as the application. The backend does not configure cross-origin CORS. For a separate frontend development server, proxy `/api`, `/img`, `/healthz` and `/readyz` to the backend.
- JSON requests use `Content-Type: application/json`. Send numbers and booleans as actual JSON values, not strings. Unknown DTO fields are stripped; invalid fields return 400.
- Exhibitor writes use multipart `FormData`. Let the browser set the content type and boundary. Their form fields are strings.
- Browser authentication uses signed HttpOnly, SameSite=Strict cookies. Use `credentials: 'include'` for fetch. JavaScript cannot read the cookies. Do not put credentials, OTPs, visitor details or display keys in console logs.
- Admin login also returns a bearer token; the backend accepts `Authorization: Bearer <token>` of the appropriate token type. Cookies are the preferred browser integration. Logout clears cookies only; it does not revoke an independently retained bearer token, so discard any client token on logout.
- Typical cookie durations are visitor `mc_v` 12 hours, admin `mc_a` 8 hours, pending MFA `mc_ap` 5 minutes, display `mc_d` 24 hours. Visitor/admin TTLs are configuration driven. Password changes invalidate older admin tokens; account deletion and role changes are checked against the database.
- Dates in JSON responses are ISO timestamps. Object keys in `session.votes` are category IDs serialized as strings. Images are relative `/img/<uuid>` URLs, or null.
- Success status is 200 except POST category/exhibitor/user creation and POST votes, which return 201. Deletes return 200. Download routes return files; SSE is a stream.
- Errors normally have `{ "error": "machine_code", "message": "human-readable message", ...extra }`. Switch on `error`, not the English message. Rate-limit errors may include `retryAfter` in seconds in the JSON body; do not assume a Retry-After header.

```ts
async function api(path: string, body?: unknown, method = 'GET') {
  const res = await fetch(path, {
    method, credentials: 'include',
    ...(body === undefined ? {} : {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.message), { status: res.status, data });
  return data;
}
```

This helper is only for JSON endpoints. Handle images, downloads, FormData and EventSource separately.

## 2. Roles and screens

| Identity | Allowed capabilities | Frontend screens |
|---|---|---|
| Anonymous visitor | Read ballot/state, access check, request/verify OTP, visitor logout | QR landing, registration, OTP, access assistance |
| Verified visitor | Own session/history and voting, plus public routes | Category ballot, vote confirmation, completed-votes summary |
| Viewer account | Admin read-only catalog/settings/results/stats/links, aggregate exports, protected display; own password/MFA management | Read-only dashboard and display |
| Full admin | Viewer capabilities plus catalog/configuration writes, reset, visitor data/export, audit and team account management | Full admin dashboard |
| Display-key session | Protected display results, SSE and voting QR only | TV/live results screen |

An ordinary visitor cannot access results endpoints, admin APIs or private exports. A display cookie does not grant admin access. UI hiding is convenience; the backend enforces permissions. Viewer accounts can manage their own password/MFA but cannot manage event data or other accounts.

## 3. Visitor data models

### Public state: `GET /api/public/state`

No authentication required; `Cache-Control: no-store`. Returns everything needed for the ballot, including the current visitor session when its cookie is valid.

```ts
type AccessMode = 'off' | 'ip' | 'geo' | 'ip_or_geo' | 'ip_and_geo';
type Location = { lat: number; lng: number; accuracy?: number };
type VotingState = {
  open: boolean;
  reason?: 'closed' | 'not_started' | 'ended';
  opens_at?: string | null;
  closes_at?: string | null;
};
type VisitorSession = {
  name: string;
  phone: string; // Masked, not the full number
  votes: Record<string, { exhibitor_id: number; at: string }>;
};
type PublicState = {
  event: { name: string; tagline: string; venue: string };
  voting: VotingState;
  access: { allowed: boolean; needsLocation: boolean; mode: AccessMode };
  categories: Array<{ id: number; slug: string; name: string; description: string }>;
  exhibitors: Array<{
    id: number; name: string; project: string; description: string;
    booth: string; image: string | null; category_ids: number[];
  }>;
  session: VisitorSession | null;
};
```

Only active categories/exhibitors appear. Filter exhibitors by `category_ids.includes(category.id)`. The same exhibitor may appear in several categories. Do not assume IDs are 1, 2 and 3 or hardcode category names. MC2026 should have three active categories in configuration; the API/model supports more generally.

`state.access` evaluates IP without GPS. Thus a GPS-required mode can initially report denied even when the visitor is physically present. Submit an access check with coordinates before treating that as a final denial. Public state does not expose venue CIDRs or geofence settings.

### Access: `POST /api/public/access-check`

Body: `{ location?: { lat, lng, accuracy? } }`. Example shape: `{ "location": { "lat": 31.95, "lng": 35.91, "accuracy": 20 } }`. These are example coordinates, not the configured venue.

Returns `{ allowed, needsLocation, geoReason, mode }`. `geoReason` is null or `no_location`, `bad_location`, `bad_geofence`, `low_accuracy`, `outside_geofence`. Malformed coordinates may be rejected by DTO validation with 400 before this response.

| Mode | Required signal | Frontend behavior |
|---|---|---|
| `off` | None; demo bypass | No location needed |
| `ip` | Venue IP | Explain venue Wi-Fi when denied |
| `geo` | GPS | Acquire coordinates and submit them |
| `ip_or_geo` | Either | GPS needed if IP is not approved |
| `ip_and_geo` | Both | Approved IP never removes the GPS requirement |

`needsLocation` indicates missing location needed for evaluation, not successful access and not every reason a visitor is denied. A supplied but inaccurate/outside location normally gives `needsLocation: false`; use `geoReason` to offer a new reading.

Coordinates must be finite numbers, latitude -90..90, longitude -180..180. Optional accuracy is metres, finite and nonnegative; null is invalid for accuracy. Map browser `coords.latitude`, `coords.longitude`, `coords.accuracy` to `lat`, `lng`, `accuracy`. No location timestamp is required or used. Location freshness would require coordinated future frontend/backend work.

Backend uses Haversine distance and permits distance <= radius + min(accuracy, 100 m), provided accuracy is within the configured threshold. Missing accuracy is currently treated as zero for compatibility; send browser accuracy when available. HTTPS is needed for geolocation on normal presentation phones.

### OTP: `POST /api/public/otp/request`

Body: `{ name: string, phone: string, consent?: boolean, location?: Location }`.

- Name is trimmed/space-normalized and must be 2–80 characters (although DTO maximum is 200).
- Phone accepts supported local/international formats and Arabic digits; Jordanian mobiles are validated and normalized. Keep the phone as a string.
- `consent` is outreach opt-in, default false. Do not silently set it true. Verified opt-in is retained across later registrations.
- Voting must be open and venue access must pass. Send location when required, even if an earlier access check passed: that check does not create an access session.

Returns `{ challengeId: string, phone: string, expiresIn: number, resendIn: number, devCode?: string }`. The response phone is masked; durations are seconds. `challengeId` is a UUID. `devCode` exists only when development echo is enabled: never assume it exists or expose it in event mode.

Resend uses this same endpoint and replaces the challenge ID. Earlier unused challenges are invalidated. Start the resend countdown from `resendIn`; handle `otp_cooldown` and `rate_limited` using `retryAfter`. Sending does not authenticate the visitor.

### Verify: `POST /api/public/otp/verify`

Body: `{ challengeId: string, code: string }`. Keep code as a string to preserve leading zeros. Returns `{ ok: true, session: VisitorSession }` and sets the visitor cookie.

Expired/wrong/consumed/locked challenges return 400 with `otp_expired`, `otp_wrong`, `otp_invalid` or `otp_locked`. A valid challenge is single-use, including concurrent submissions. Re-verifying the same phone with a fresh challenge restores the same visitor's existing votes, not a new voting identity. Failed OTP guesses are counted; limits are backend configured.

**Lost verification response:** do not blindly retry a single-use code indefinitely. First fetch `/api/public/state` or `/api/public/me` to see whether the cookie/session was established. If authentication cannot be recovered, offer a fresh OTP after cooldown. A request may have committed even when the client sees a network error.

### Session: `GET /api/public/me`

Requires visitor authentication. Returns `{ session: VisitorSession }`, no-store. Missing/expired/deleted visitor returns 401 `not_verified`; a missing database visitor also clears the cookie. For anonymous bootstrapping use `/state` instead of treating `/me` 401 as an application crash.

### Vote: `POST /api/public/votes`

Requires visitor authentication. Body: `{ categoryId: number, exhibitorId: number, location?: Location }`. Returns **201** `{ ok: true, session: VisitorSession }`.

- Backend checks voting window, on-site access, verified identity, active category/exhibitor and actual category assignment.
- Exactly one vote per visitor per category is enforced in PostgreSQL. Another category is allowed. Votes cannot be changed through a visitor endpoint.
- Every repeat in a voted category returns **409 `already_voted`**, including the same exhibitor. Its error body includes `session` with the saved votes.
- On 409, restore that session and show the already-recorded selection. Do not describe it as a second successful insert. On an ambiguous network failure, fetch session/state to reconcile before retrying.
- Disable duplicate taps while a request is pending, but rely on backend/database enforcement for correctness.

### Logout: `POST /api/public/logout`

No authentication required. Returns `{ ok: true }`, clears visitor cookie. It does not delete registration or votes. Registering with the same phone later restores history.

## 4. Admin and viewer authentication

All paths below start `/api/admin`. Routes labeled **account** accept either authenticated admin or viewer. Routes labeled **admin only** require the full role.

| Method/path | Authentication | Request | Response / behavior |
|---|---|---|---|
| POST `/login` | Public | `{ username, password }` | Without MFA: `{ ok: true, accessToken, mfaSetupRecommended: true }`, sets `mc_a`. With MFA: `{ mfaRequired: true, mfaToken }`, sets pending `mc_ap`; user is not fully signed in yet. |
| POST `/login/mfa` | Pending MFA cookie/token | `{ code: string }` | `{ ok: true, accessToken }`, clears pending cookie and sets `mc_a`. |
| POST `/logout` | Public | None | `{ ok: true }`, clears admin and pending cookies. |
| GET `/me` | Account | None | `{ admin: { id, username, role: 'admin'|'viewer', totp_enabled } }`. Use this to control write UI. |
| POST `/password` | Account | `{ current, next }` | `{ ok: true, accessToken }`; next password >=10 chars, <=200 DTO limit. Other password-version sessions become invalid; current session receives replacement. |
| POST `/mfa/setup` | Account | None | `{ secret, otpauth, qr }`; show QR/manual secret for authenticator enrollment. Does not enable MFA yet. |
| POST `/mfa/enable` | Account | `{ code }` | `{ ok: true }` after verifying authenticator code. |
| POST `/mfa/disable` | Account | `{ password, code }` | `{ ok: true }` after checking both. |
| GET `/users` | Admin only | None | `{ users: [{ id, username, role, totp_enabled, last_login_at, created_at }] }`. |
| POST `/users` | Admin only | `{ username, password, role?: 'admin'|'viewer' }` | 201 `{ id }`. Default role is admin; explicitly send viewer for a read-only account. |
| DELETE `/users/:id` | Admin only | None | `{ ok: true }`; deleting your own account returns 400 `self`. |

Usernames are lowercased/trimmed; newly created usernames allow 3–32 letters/digits/dot/underscore/hyphen. New account passwords must be >=10 characters. Duplicate username returns 409 `exists`. Password login has five-failure/15-minute account lock behavior, plus request rate limits. MFA requests are separately rate limited; do not assume MFA has identical account-lock behavior.

Handle 401 `bad_credentials`, `bad_code`, `mfa_expired`; 423 `locked`; 400 `weak_password`, `bad_username`, `mfa_already_enabled`, `mfa_not_setup`, `mfa_not_enabled`. Guard failures use 401 `unauthorized` and 403 `forbidden`. After login/MFA, fetch `/me`; do not infer the role from the login success payload.

## 5. Category and exhibitor administration

All paths start `/api/admin`. GETs accept account roles; writes are admin only. Refresh catalog after writes: write responses do not always contain the enriched list fields.

### Categories

| Method/path | Request | Response |
|---|---|---|
| GET `/categories` | None | `{ categories: [...] }`, including inactive rows and `exhibitor_count` |
| POST `/categories` | Category JSON | 201 `{ category }` |
| PUT `/categories/:id` | Category JSON | 200 `{ category }` |
| DELETE `/categories/:id?force=true` | None; force optional | `{ ok: true }` |

Category rows include `id, slug, name, description, is_active` and are listed in creation order. JSON fields: required `name` (nonblank, <=80); optional `slug` <=40, `description` <=300, boolean `is_active`.

**PUT is replacement-like, not a partial PATCH:** omitted slug is generated from name; omitted description becomes empty, active becomes true. Submit the complete edited form. Slugs are normalized to lowercase ASCII/hyphen form and unique; create/update duplicates return 409 `exists`. This is slug uniqueness, not an independent strict category-name uniqueness rule.

Deletion rejects 409 `has_votes` if votes exist, or `category_in_use` if an active exhibitor would lose its only assignment. Deactivation can preserve records. `force=true` bypasses these deletion safeguards and can cascade-delete votes/assignments; require a clear destructive confirmation in UI. Backend permits dynamic category creation; event configuration should keep exactly three active MC2026 categories.

### Exhibitors

| Method/path | Request | Response |
|---|---|---|
| GET `/exhibitors` | None | `{ exhibitors: [...] }`, active and inactive, with `category_ids`, `votes`, relative `image` |
| POST `/exhibitors` | Multipart | 201 `{ exhibitor }` raw saved row |
| PUT `/exhibitors/:id?force=true` | Multipart; force optional | `{ exhibitor }` raw saved row |
| DELETE `/exhibitors/:id?force=true` | None; force optional | `{ ok: true }` |

List records include `id, name, project, description, booth, image_id, is_active, created_at, updated_at, category_ids, votes, image`. Create/update saved rows do not include enriched `category_ids`, `votes` or `image`; reload GET list or construct `/img/<image_id>` for immediate preview.

Multipart fields:

| Field | Format and rules |
|---|---|
| `name` | Required string, nonblank <=100; maker/team name |
| `project` | Optional string <=120 |
| `description` | String <=400; required nonblank for active exhibitors |
| `booth` | Optional string <=20 |
| `is_active` | String `'false'` for inactive; all other/omitted values activate |
| `category_ids` | String containing JSON array, e.g. `'[1,2]'`; comma-separated IDs also supported. Positive int32 IDs must exist; repeated IDs are deduplicated. |
| `photo` | File field, JPEG/PNG/WebP, maximum 3 MiB; MIME and initial magic bytes checked |
| `remove_photo` | String `'true'` to remove existing photo on update; a newly uploaded photo takes precedence |

Active exhibitors require description, at least one category and a photo. Inactive drafts may omit them. Updating without a new file retains the existing photo unless explicitly removed. Removing the photo while remaining active fails `photo_required`.

PUT requires the complete form: omitted fields reset to defaults; omitted category IDs become an empty list. Preserve the categories/description/active flag from the edit form. The assignment validator checks category existence, not that each selected category is active; show active/inactive labels and explain that inactive categories are absent from the public ballot.

```ts
const form = new FormData();
form.set('name', values.name);
form.set('project', values.project);
form.set('description', values.description);
form.set('booth', values.booth);
form.set('is_active', String(values.is_active));
form.set('category_ids', JSON.stringify(values.category_ids));
if (photo) form.set('photo', photo);
const res = await fetch(`/api/admin/exhibitors/${id}`, {
  method: 'PUT', credentials: 'include', body: form,
});
```

**Assignment duplicate rule:** normalized maker/team name + project cannot overlap the same category across records. Case and repeated whitespace are ignored. Same project across several categories is allowed; different projects by the same team are allowed. Prefer editing one exhibitor to assign multiple categories. Conflict is 409 `duplicate_category_assignment`, enforced by database triggers/unique constraint including concurrent edits/creates. Repeated IDs within one form are simply deduplicated.

Removing a voted assignment or deleting a voted exhibitor normally returns 409 `has_votes`. Explicit `force=true` can discard affected votes, but cannot override duplicate assignment constraints. Other errors: `bad_name`, `bad_description`, `bad_categories`, `bad_image`, `photo_required`, `not_found`, 413 `file_too_large`.

## 6. Database-driven event settings

GET `/api/admin/settings` accepts admin/viewer and returns `{ settings, voting, clientIp }`. `voting` is the effective window state, while `settings.voting` is saved configuration. `clientIp` is backend-observed IP, useful for venue setup.

```ts
type Settings = {
  event: { name: string; tagline: string; venue: string };
  voting: { open: boolean; opens_at: string | null; closes_at: string | null };
  access: {
    mode: AccessMode; allowed_cidrs: string[];
    geofence: {
      lat: number | null; lng: number | null;
      radius_m: number | null; max_accuracy_m: number | null;
    };
  };
  display: { key: string | null; show_counts: boolean };
};
```

**Current behavior caveat:** `/settings` returns the display key to authenticated viewers as well as admins. `/links` hides `displayUrl` for viewers, but this is not a secrecy guarantee for the key. Treat all settings payloads as sensitive and do not claim viewers cannot obtain the key. Public visitors cannot read this route.

All settings PUTs require admin and return `{ ok: true, value: <saved section> }`.

| Method/path | Body / behavior |
|---|---|
| PUT `/api/admin/settings/event` | `{ name, tagline?, venue? }`; max lengths 80/120/120. Omitted tagline/venue become empty; blank name uses backend fallback. |
| PUT `/api/admin/settings/voting` | Partial `{ open?: boolean, opens_at?: string|null, closes_at?: string|null }`. Omitted fields retained. null/empty timestamp clears it. Invalid date -> `bad_date`; end <= start -> `bad_voting_window`. |
| PUT `/api/admin/settings/access` | Partial `{ mode?, allowed_cidrs?: string[], geofence?: { lat, lng, radius_m, max_accuracy_m? } }`. Omitted sections retained; empty CIDR array clears ranges. Geofence is a complete replacement when supplied. |
| PUT `/api/admin/settings/display` | `{ show_counts?: boolean }`; omitted value retained. |
| POST `/api/admin/display/rotate` | No body; `{ ok: true }`. Replaces display key; fetch links/settings afterward. Old display sessions and existing streams become invalid on authorization recheck. |
| GET `/api/admin/links` | Account read: `{ voteUrl, displayUrl, voteQr }`; displayUrl is null for viewers. QR is PNG data URL; URLs depend on configured PUBLIC_URL. |

### Scheduling contract for frontend

`open: false` is the master close switch. `open: true` allows voting only within any saved start/end boundaries. Start is inclusive, end exclusive. A future start returns effective `not_started`; an elapsed end returns `ended`. Manual `open: true` does not remove old schedule boundaries: clear them explicitly with null when appropriate.

Submit ISO timestamps containing `Z` or an explicit UTC offset. Display/collect the intended event time in **Asia/Amman**, converting correctly to an instant before submission. Do not send bare `datetime-local` strings: backend currently accepts them for compatibility and interprets them according to server timezone. Ordering validation is implemented; strict timezone-bearing input enforcement is not. No separate scheduled-job endpoint is needed: backend evaluates the window on requests.

### Access settings contract for frontend

- Unknown geofence fields can be null in GET responses. Render null as an empty input, never the literal `'null'`, zero, or invented coordinates.
- Do not submit an incomplete geofence when saving IP-only or demo bypass settings. Omit `geofence` until all required values are provided.
- Latitude -90..90; longitude -180..180; radius 10..50,000 metres; optional accuracy threshold >=0. Omitted max accuracy on a supplied geofence defaults to 500. **Zero is valid**: use `??`, not `||`, for input defaults.
- CIDRs support IPv4/IPv6 networks and individual addresses. Invalid entries yield 400 `bad_cidr`; invalid geofence yields `bad_geofence` or DTO `bad_request`.
- Selecting a GPS mode without valid geofence settings can be saved but access fails closed. Validate completeness in the admin UI.
- There is no dedicated route to reset individual geofence fields to null. Do not invent a clear-geofence payload.

## 7. Results, reporting and private data

### Shared results snapshot

`GET /api/admin/results`, JSON export and display results use this shape:

```ts
type ResultsSnapshot = {
  event: { name: string; tagline: string };
  voting: VotingState;
  show_counts: boolean;
  generated_at: string;
  totals: { votes: number; voters: number };
  categories: Array<{
    id: number; slug: string; name: string; description: string; total: number;
    standings: Array<{
      id: number; name: string; project: string; booth: string;
      image: string | null; votes: number; rank: number;
    }>;
  }>;
};
```

Counts come from database votes, not client optimistic totals. Categories/exhibitors in standings are active. Overall totals count all stored votes/distinct voters and can differ from visible category totals if records are deactivated. `totals.voters` means visitors with at least one vote, not all verified registrations.

Ties use competition ranks `1,1,3`. Display shared places honestly; there is no implemented tie-breaker or automatic single-winner selection. `show_counts` is a presentation flag: numeric counts remain in API responses, including totals. It is not a security restriction.

| Method/path | Role | Response / behavior |
|---|---|---|
| GET `/api/admin/results` | Account | ResultsSnapshot |
| GET `/api/admin/export/results.csv` | Account | Attachment CSV: `category,rank,exhibitor,project,booth,votes,share_pct`; no private visitor identity |
| GET `/api/admin/export/results.json` | Account | Attachment JSON ResultsSnapshot |
| POST `/api/admin/results/reset` | Admin only | `{ confirm: 'RESET', purgeVisitors?: boolean }` -> `{ ok: true, deleted: number }` |
| GET `/api/admin/visitors?limit=50&offset=0` | Admin only | `{ total, visitors: [{ id, name, phone, verified_at, consent_outreach, votes }] }`; phone masked; no-store |
| GET `/api/admin/export/visitors.csv?consented=true` | Admin only | Sensitive attachment CSV: `name,phone,verified_at,consent_outreach`; full decrypted phone as international digits without plus, no individual votes; no-store |
| GET `/api/admin/stats` | Account | `{ verified_visitors, votes, votes_last_5m, otps_last_hour, exhibitors, redis, live_screens_this_node }` |
| GET `/api/admin/audit` | Admin only | `{ entries: [{ id, actor, action, detail, ip, created_at }] }`, latest 100; reset snapshot omitted; no-store |

Visitor pagination defaults to 50, maximum 200; use nonnegative integer offsets and positive limits. `total` currently becomes zero when the requested page is empty even if earlier pages exist; retain prior pagination knowledge or return to the previous page rather than assuming all visitors were deleted. Stats Redis values are `up`, `down`, `not configured`; live-screen count is **this replica only**. No pagination/filter API exists for audit.

Reset snapshots counts, deletes votes and writes audit in one transaction with locking. Without purge, verified visitors remain and can vote again. With purge, registrations/OTP relationships are deleted and old visitor cookies no longer identify a database visitor. Reset does **not** automatically close voting. For presentation cleanup, close voting first, confirm explicitly, reset, refresh state/results, then reopen intentionally. A confirmation other than exact `RESET` returns 400 `confirm_required`.

CSV downloads use UTF-8 BOM, CRLF and formula-injection escaping. Use a download link or fetch Blob with credentials; do not parse CSV as JSON. Treat private visitor export separately from aggregate results. Outreach export should offer the consented filter explicitly. Name/phone are encrypted at rest; frontend must still avoid logging/caching or exposing them to unauthorized users.

## 8. Protected live display

| Method/path | Authentication | Request/response |
|---|---|---|
| POST `/api/display/auth` | Public key exchange | `{ key: string }` -> `{ ok: true }`, sets `mc_d`; wrong key ->401 `bad_key` |
| GET `/api/display/results` | Display cookie or admin/viewer account | ResultsSnapshot; no-store; polling fallback |
| GET `/api/display/stream` | Display cookie or admin/viewer account | SSE initial snapshot, live results, keep-alive |
| GET `/api/display/qr` | Display cookie or admin/viewer account | `{ url, qr }`, voting URL and PNG data URL |

Exchange the key from the admin-created display link, then remove it from browser URL/history. Do not append it to every results request. There is no display logout API. Rotating the key revokes display cookies tied to the old key; admin/viewer authentication independently remains valid.

```ts
const stream = new EventSource('/api/display/stream', { withCredentials: true });
stream.addEventListener('results', (event) => {
  const snapshot = JSON.parse((event as MessageEvent).data) as ResultsSnapshot;
  renderResults(snapshot);
});
stream.addEventListener('ping', () => { /* keep-alive; no JSON parse */ });
// Close with stream.close() when leaving the screen.
```

Listen to the named `results` event, not only `onmessage`. `ping` has empty data every 20 seconds. Server advertises 3-second retry, coalesces updates around 400 ms, and sends safety snapshots every 10 seconds while screens are connected. Updates are eventual rather than an instantaneous guaranteed push per vote.

On repeated SSE failure, use credentialed GET polling (e.g. every five seconds). EventSource does not provide a convenient HTTP status to the handler: poll once to distinguish network failure from 401 `display_key_required`. For 401 stop reconnect/poll loops, clear protected data and show authentication-required UI. Reauthenticate with a new key after rotation. Backend rechecks stream authorization on updates/heartbeats, so old streams are revoked too.

## 9. Images and operational endpoints

| Method/path | Authentication | Response |
|---|---|---|
| GET `/img/:id` | Public | Stored image bytes with original MIME, immutable one-year cache and ETag; invalid/missing UUID image ->404 |
| GET `/healthz` | Public | `{ ok: true }`; process liveness only |
| GET `/readyz` | Public | 200 `{ ok: true, db: 'up', redis: 'up'|'down'|'off' }`; DB failure ->503 `{ ok: false, db: 'down' }` |

Use `/img` URLs returned by API, not filesystem photo paths. A new upload gets a new image ID. Redis is optional for readiness; `readyz` success alone does not prove complete redundancy or cross-replica behavior.

## 10. Error and retry UX checklist

| Status / code | Required frontend action |
|---|---|
| 400 `bad_request`, `bad_json` | Correct payload/field validation; show safe message |
| 400 `bad_name`, `bad_phone`, `bad_description`, `bad_categories`, `bad_image`, `photo_required` | Field-specific feedback; preserve entered form |
| 400 `bad_date`, `bad_voting_window`, `bad_cidr`, `bad_geofence` | Correct admin configuration; do not silently substitute defaults |
| 400 `bad_vote` | Refresh ballot; selected assignment may be invalid/inactive |
| 400 OTP errors | Wrong: allow retry while attempts remain; expired/invalid/locked: new challenge after cooldown |
| 401 `not_verified` | Restore registration/OTP screen; check state after ambiguous verification failure |
| 401 admin/display errors | Route to appropriate authentication screen; stop protected live loops |
| 403 `voting_closed` | Use supplied `voting` state to explain closed/not-started/ended |
| 403 `not_on_site` | Use supplied `access` (`needsLocation`, `geoReason`, `mode`); Wi-Fi/location retry assistance |
| 403 `forbidden` | Read-only role; do not repeatedly retry a write |
| 409 `already_voted` | Restore error body's session and show recorded vote |
| 409 `exists`, `duplicate_category_assignment` | Explain conflict and let admin edit the existing record |
| 409 `has_votes`, `category_in_use` | Offer safe hide/reassign/reset workflow; destructive force only after explicit confirmation |
| 413 `file_too_large` | Ask for photo <=3 MiB |
| 423 `locked` | Explain temporary admin lock |
| 429 `otp_cooldown`, `rate_limited` | Countdown from body retryAfter when supplied; disable immediate retry |
| 502 `sms_failed` | Explain send failure and offer controlled resend |
| 500 `server_error`, network drop | Preserve UI state; reconcile committed mutations before retry; do not expose raw internals |

Known request budgets: access check 60/minute per ordinary IP (6000 venue); OTP request 20/10 minutes (5000 venue), verification 60/10 minutes (10000 venue); vote 30/minute per visitor; admin login/MFA 10/5 minutes per IP; display auth 20/5 minutes per IP. Per-phone cooldown/hour cap and OTP attempts/expiry are configuration driven. Venue budgets depend on configured CIDRs, even in bypass mode. Redis enables shared limits; fallback is per process. Build UI from response durations, not hardcoded limits.

## 11. What the frontend team still needs to finish/verify

1. Run/build the frontend and test against the actual backend; existing dashboards should be integrated and verified rather than rebuilt automatically.
2. Fix nullable geofence forms, omit incomplete GPS settings, preserve zero accuracy threshold and support all access modes.
3. Implement explicit Asia/Amman schedule-to-ISO conversion and test on a server/browser with different timezone settings.
4. Make GPS permission denial, low accuracy, off-site location and new readings recoverable; include current coordinates on OTP request and vote when needed.
5. Reconcile lost OTP verification responses through state/me; use returned challenge IDs and resend/expiry timings correctly.
6. Preserve already-voted reconciliation, vote confirmation, progress and saved history per category, including one exhibitor in several categories.
7. Remove visitor/GPS/debug logging. Avoid unnecessary persistent storage of name/phone. Offer outreach consent only as explicit opt-in if that feature is exposed.
8. Hide admin-only actions from viewers; enforce navigation for visitor, viewer, admin and display identities separately.
9. Submit complete category/exhibitor edit forms, display meaningful backend conflicts and confirm force/delete/reset actions clearly.
10. Verify named SSE events, polling fallback, display key rotation, unauthorized screens and TV readability; show ties accurately.
11. Verify CSV/JSON/QR downloads, mobile photo layout, accessibility and a non-technical visitor's end-to-end flow without instructions.
12. Coordinate reachable HTTPS/PUBLIC_URL with deployment owner and real SMS/venue details with backend/event owner. Do not invent venue settings or claim console OTP proves phone delivery.

## 12. Demo versus event configuration

Previously prepared demo data has three active sample categories, 22 exhibitors, approved `off` access bypass and open voting with unset schedule. This is configuration, not a permanent API promise; fetch current state/settings. Fresh backend defaults instead close voting, use `ip_and_geo`, leave venue fields null/CIDRs empty and generate a display key.

Real SMS receipt remains unverified until a gateway is configured. Category names and venue/window values await organizer confirmation. Mock exhibitor data is permitted. Do not enable real access enforcement with invented venue data. Clear rehearsal votes before judging through the authorized reset workflow.

## 13. Source of truth

Route declarations: `backend/src/visitor/visitor.controller.ts`, `backend/src/admin/admin.controller.ts`, `backend/src/display/display.controller.ts`, `backend/src/health/health.controller.ts`.

Payload validation: `backend/src/visitor/visitor.dto.ts`, `backend/src/admin/admin.dto.ts`. Behavior/response models: their services plus `backend/src/results/results.service.ts`, `backend/src/settings/settings.service.ts`, `backend/src/settings/settings.types.ts`, `backend/src/core/access.service.ts`, `backend/src/common/geo.util.ts`.

Authentication/errors: `backend/src/auth/guards.ts`, `backend/src/auth/session.service.ts`, `backend/src/common/all-exceptions.filter.ts`, `backend/src/bootstrap.ts`. Duplicate assignment database enforcement: `backend/src/database/migrations/1791370000000-ExhibitorCategoryIdentity.ts`.

This is a source-derived handoff, not a newly executed deployment/browser certification. The last complete backend suite previously passed 225 tests; the later error-name change was checked with build and the focused assignment test. Frontend integration and real SMS testing remain separate verification work.
