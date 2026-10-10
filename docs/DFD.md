# Data Flow Diagrams

## Level 0 — Context

```mermaid
flowchart LR
  V([Visitor]) -- name, phone, OTP code, location*, votes --> SYS[[MC2026 Voting System]]
  SYS -- ballot, confirmations --> V
  SYS -- OTP SMS request --> GW([SMS gateway])
  GW -- SMS with code --> V
  ADM([Makerspace admin]) -- exhibitors, categories, photos, settings, open/close --> SYS
  SYS -- results, exports, visitor list, audit log --> ADM
  SYS -- live standings --> TV([Public display])
```
\* Location is required according to the configured access mode; `ip_and_geo` requires GPS even on the venue network.

## Level 1 — Processes and data stores

```mermaid
flowchart TB
  V([Visitor])
  ADM([Admin])
  TV([Public display])
  GW([SMS gateway])

  P1[1.0 Validate rotating QR entry<br/>and on-site access: IP / geofence]
  P2[2.0 Register & send OTP]
  P3[3.0 Verify OTP & issue session]
  P4[4.0 Cast vote]
  P5[5.0 Tally & broadcast]
  P6[6.0 Manage event<br/>exhibitors, categories, settings]
  P7[7.0 Export & audit]
  P8[8.0 Admin authentication<br/>password + TOTP]

  D1[(D1 settings)]
  D2[(D2 visitors)]
  D3[(D3 otp_challenges)]
  D4[(D4 votes)]
  D5[(D5 exhibitors / categories / images)]
  D6[(D6 admins)]
  D7[(D7 audit_log)]
  BUS{{Redis pub/sub}}

  V -- QR token, IP, location --> P1
  P1 -- short-lived QR grant --> V
  D1 -- access rules --> P1
  P1 -- allowed? --> P2
  V -- name, phone --> P2
  P2 -- encrypted name/phone, HMAC --> D2
  P2 -- code hash, expiry --> D3
  P2 -- phone, code --> GW
  V -- code --> P3
  D3 -- challenge --> P3
  P3 -- verified_at --> D2
  P3 -- session cookie --> V
  V -- category, exhibitor --> P4
  P1 -. re-check .-> P4
  D5 -- valid pairs --> P4
  P4 -- vote row --> D4
  P4 -- vote event --> BUS
  BUS --> P5
  D4 -- counts --> P5
  D5 -- names, photos --> P5
  P5 -- SSE or polling snapshot and rotating QR --> TV
  P5 -- SSE or polling snapshot --> ADM
  ADM -- credentials, TOTP --> P8
  D6 --> P8
  P8 -- admin session --> ADM
  ADM -- changes --> P6
  P6 --> D1 & D5
  P6 -- change event --> BUS
  P6 -- action --> D7
  ADM -- export / reset --> P7
  D4 & D2 --> P7
  P7 -- CSV/JSON --> ADM
  P7 -- action + snapshot --> D7
```

## Personal-data flow (privacy view)

| Data | Collected at | Stored as | Who can read it | Leaves the system via |
|---|---|---|---|---|
| Name | 2.0 | AES-256-GCM ciphertext (`visitors.name_enc`) | Admins (decrypted in admin API only) | Visitors CSV export (audited) |
| Phone | 2.0 | AES-256-GCM ciphertext + HMAC lookup key + last 4 digits | Admins: masked in UI, full in export (audited) | SMS gateway (to send the OTP); visitors CSV |
| OTP code | 2.0 | HMAC only, never plaintext; 5-min TTL | Nobody | SMS to the visitor |
| Location | 1.0 / 4.0 | lat/lng on the vote row (fraud review) | Admins via DB | — |
| IP address | every request | on visitor + vote rows, audit log | Admins via DB | — |
| Outreach consent | 2.0 | boolean | Admins | "Export (opted-in only)" |
