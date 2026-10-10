import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema. Integrity rules live in the database so they hold under
 * concurrency and across replicas (see docs/ERD.md).
 */
export class Init1759600000000 implements MigrationInterface {
  name = 'Init1759600000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
-- MC2026 Voting System — initial schema
-- All business data, categories and event settings live in the database (spec §6).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Award categories (exactly 3 for MC2026, but the model allows any number)
CREATE TABLE IF NOT EXISTS categories (
  id           SERIAL PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  sort_order   INT  NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Exhibitor photos are stored in the DB so app servers stay stateless
-- (swap for S3/object storage in production — see docs/DESIGN_DECISIONS.md).
CREATE TABLE IF NOT EXISTS images (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mime_type    TEXT NOT NULL,
  bytes        BYTEA NOT NULL,
  sha256       TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exhibitors (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  project      TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  booth        TEXT NOT NULL DEFAULT '',
  image_id     UUID REFERENCES images(id) ON DELETE SET NULL,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Many-to-many: an exhibitor can compete in one or more categories (spec §3.4)
CREATE TABLE IF NOT EXISTS exhibitor_categories (
  exhibitor_id INT NOT NULL REFERENCES exhibitors(id) ON DELETE CASCADE,
  category_id  INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (exhibitor_id, category_id)
);

-- Visitors. Phone numbers are encrypted at rest (AES-256-GCM) and looked up by
-- a keyed HMAC so the plaintext number never appears in an index.
CREATE TABLE IF NOT EXISTS visitors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_enc        TEXT NOT NULL,
  phone_enc       TEXT NOT NULL,
  phone_hash      TEXT NOT NULL UNIQUE,
  phone_last4     TEXT NOT NULL,
  verified_at     TIMESTAMPTZ,
  consent_outreach BOOLEAN NOT NULL DEFAULT FALSE,
  created_ip      INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One-time passwords. Only a hash of the code is stored.
CREATE TABLE IF NOT EXISTS otp_challenges (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id    UUID NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
  code_hash     TEXT NOT NULL,
  payload_enc   TEXT NOT NULL,           -- encrypted {name, consent}; applied to the visitor only once verified
  ip            INET,
  attempts      INT  NOT NULL DEFAULT 0,
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS otp_visitor_idx ON otp_challenges (visitor_id, created_at DESC);

-- The core anti-duplicate rule (F12) is enforced by the database itself:
-- one verified visitor can cast exactly one vote per category.
CREATE TABLE IF NOT EXISTS votes (
  id            BIGSERIAL PRIMARY KEY,
  visitor_id    UUID NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
  category_id   INT  NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  exhibitor_id  INT  NOT NULL REFERENCES exhibitors(id) ON DELETE CASCADE,
  ip            INET,
  geo_lat       DOUBLE PRECISION,
  geo_lng       DOUBLE PRECISION,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT one_vote_per_category UNIQUE (visitor_id, category_id),
  CONSTRAINT exhibitor_in_category FOREIGN KEY (exhibitor_id, category_id)
    REFERENCES exhibitor_categories (exhibitor_id, category_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS votes_tally_idx ON votes (category_id, exhibitor_id);

-- Admin users (username + scrypt password + optional TOTP MFA)
CREATE TABLE IF NOT EXISTS admins (
  id             SERIAL PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  totp_secret_enc TEXT,
  totp_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  role           TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','viewer')),
  failed_logins  INT NOT NULL DEFAULT 0,
  locked_until   TIMESTAMPTZ,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Event settings: voting window, IP ranges, geofence, display key, etc.
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only audit trail of admin actions and security-relevant events
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip          INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS audit_log, settings, admins, votes, otp_challenges, visitors, exhibitor_categories, exhibitors, images, categories CASCADE`);
  }
}
