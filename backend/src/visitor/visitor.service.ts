import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { DataSource } from 'typeorm';
import { config } from '../config/config';
import { decrypt, encrypt, otpHash, phoneHash, randomDigits, safeEqual } from '../common/crypto.util';
import { GeoPoint } from '../common/geo.util';
import { AppError } from '../common/http-error';
import { maskPhone, normalizePhone } from '../common/phone.util';
import { AccessService } from '../core/access.service';
import { RateLimitService } from '../core/rate-limit.service';
import { BusService } from '../redis/bus.service';
import { SettingsService } from '../settings/settings.service';
import { AllSettings } from '../settings/settings.types';
import { SmsService } from '../sms/sms.service';
import { LocationDto } from './visitor.dto';

export interface VisitorSession {
  name: string;
  phone: string;
  votes: Record<number, { exhibitor_id: number; at: string }>;
}

@Injectable()
export class VisitorService {
  private readonly log = new Logger('Visitor');

  constructor(
    private readonly ds: DataSource,
    private readonly settings: SettingsService,
    private readonly access: AccessService,
    private readonly limits: RateLimitService,
    private readonly sms: SmsService,
    private readonly bus: BusService,
  ) {}

  static loc(l?: LocationDto | null): GeoPoint | null {
    if (!l || !Number.isFinite(l.lat) || !Number.isFinite(l.lng)) return null;
    return { lat: l.lat, lng: l.lng, accuracy: l.accuracy };
  }

  /** Voting open + visitor on site, or throw a friendly error the UI understands. */
  async assertCanVote(ip: string, location: GeoPoint | null, state?: AllSettings) {
    const s = state || await this.settings.getAll();
    const vs = this.settings.votingState(s);
    if (!vs.open) {
      throw new AppError(403, 'voting_closed', vs.reason === 'not_started' ? 'Voting has not opened yet.' : 'Voting is closed right now.', { voting: vs });
    }
    const a = this.access.evaluate(s, ip, location);
    if (!a.allowed) {
      throw new AppError(403, 'not_on_site', 'Voting is only available to visitors at the venue. Connect to the event Wi-Fi or allow location access.',
        { access: { needsLocation: a.needsLocation, geoReason: a.geoReason, mode: a.mode } });
    }
  }

  async ballot() {
    const cached = await this.bus.cacheGet<any>('ballot');
    if (cached) return cached;
    const [categories, ex] = await Promise.all([
      this.ds.query('SELECT id, slug, name, description FROM categories WHERE is_active ORDER BY id'),
      this.ds.query(`SELECT e.id, e.name, e.project, e.description, e.booth, e.image_id,
                            COALESCE(array_agg(ec.category_id ORDER BY ec.category_id) FILTER (WHERE ec.category_id IS NOT NULL), '{}') AS category_ids
                       FROM exhibitors e LEFT JOIN exhibitor_categories ec ON ec.exhibitor_id = e.id
                      WHERE e.is_active GROUP BY e.id ORDER BY e.name`),
    ]);
    const out = {
      categories,
      exhibitors: ex.map((e: any) => ({
        id: e.id, name: e.name, project: e.project, description: e.description, booth: e.booth,
        image: e.image_id ? `/img/${e.image_id}` : null, category_ids: e.category_ids,
      })),
    };
    await this.bus.cacheSet('ballot', out, 10);
    return out;
  }

  async session(visitorId: string): Promise<VisitorSession | null> {
    return this.ds.transaction('REPEATABLE READ', async manager => {
      const v = await manager.query('SELECT name_enc, phone_last4 FROM visitors WHERE id = $1', [visitorId]);
      const votes = await manager.query('SELECT category_id, exhibitor_id, created_at FROM votes WHERE visitor_id = $1', [visitorId]);
      if (!v[0]) return null;
      return {
        name: decrypt(v[0].name_enc),
        phone: `•••• ${v[0].phone_last4}`,
        votes: Object.fromEntries(votes.map((r: any) => [r.category_id, { exhibitor_id: r.exhibitor_id, at: r.created_at }])),
      };
    });
  }

  async state(ip: string, visitorId: string | null) {
    const s = await this.settings.getAll();
    const a = this.access.evaluate(s, ip, null);
    return {
      event: s.event,
      voting: this.settings.votingState(s),
      access: { allowed: a.allowed, needsLocation: a.needsLocation, mode: a.mode },
      ...(await this.ballot()),
      session: visitorId ? await this.session(visitorId) : null,
    };
  }

  async accessCheck(ip: string, location: GeoPoint | null) {
    const a = this.access.evaluate(await this.settings.getAll(), ip, location);
    return { allowed: a.allowed, needsLocation: a.needsLocation, geoReason: a.geoReason, mode: a.mode };
  }

  // ------------------------------------------------------------------ OTP
  async requestOtp(ip: string, body: { name: string; phone: string; consent?: boolean; location?: LocationDto }) {
    const name = String(body.name || '').normalize('NFC').trim().replace(/\s+/g, ' ');
    const nameParts = name.split(' ').filter(Boolean);
    const phone = normalizePhone(String(body.phone || ''));
    const consent = body.consent === true;
    if (name.length > 80 || nameParts.length < 2) throw new AppError(400, 'bad_name', 'Enter your first and last name.');
    if (!phone) throw new AppError(400, 'bad_phone', 'Please enter a valid mobile number, e.g. 07X XXX XXXX.');

    await this.assertCanVote(ip, VisitorService.loc(body.location));

    // Per-phone limits: cooldown between sends and an hourly cap (SMS cost + abuse)
    const hash = phoneHash(phone);
    const cool = await this.bus.hit(`otp-cool:${hash}`, 1, config.otp.resendCooldownSeconds);
    if (!cool.allowed) throw new AppError(429, 'otp_cooldown', `Please wait ${cool.retryAfter}s before requesting another code.`, { retryAfter: cool.retryAfter });
    await this.limits.check('otp-hour', hash, config.otp.maxPerPhonePerHour, 3600, 'Too many codes requested for this number. Try again later.');

    const code = randomDigits(config.otp.length);
    const challengeId = crypto.randomUUID();
    await this.ds.transaction(async m => {
      await m.query('LOCK TABLE votes IN ROW EXCLUSIVE MODE');
      const current = await m.query('SELECT key, value FROM settings');
      await this.assertCanVote(ip, VisitorService.loc(body.location), Object.fromEntries(current.map((row: any) => [row.key, row.value])) as AllSettings);
      const nameKey = name.toLocaleLowerCase('en-US');
      // Serialize requests for the same normalized name so two simultaneous signups
      // cannot both pass the duplicate-name check.
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`visitor-name:${nameKey}`]);
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`otp:${hash}`]);
      const existingPhone = await m.query('SELECT id, name_enc FROM visitors WHERE phone_hash = $1 FOR UPDATE', [hash]);
      if (existingPhone.length && decrypt(existingPhone[0].name_enc).normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US') !== nameKey) {
        throw new AppError(409, 'phone_attached', 'This number is already attached to another user.');
      }
      const existingVisitors = await m.query('SELECT id, phone_hash, name_enc FROM visitors');
      const duplicateName = existingVisitors.some((visitor: any) =>
        visitor.phone_hash !== hash &&
        decrypt(visitor.name_enc).normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US') === nameKey,
      );
      if (duplicateName) throw new AppError(409, 'duplicate_name', 'This name is already registered. Please use your own full name.');
      const rows = await m.query(
        `INSERT INTO visitors (name_enc, phone_enc, phone_hash, phone_last4, consent_outreach, created_ip)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (phone_hash) DO UPDATE SET phone_hash = EXCLUDED.phone_hash
       RETURNING id`,
        [encrypt(name), encrypt(phone), hash, phone.slice(-4), consent, ip],
      );
      const visitorId = rows[0].id;
      // Invalidate earlier unused codes for this visitor
      await m.query('UPDATE otp_challenges SET consumed_at = now() WHERE visitor_id = $1 AND consumed_at IS NULL', [visitorId]);
      // The name only replaces the stored name after verification (nobody can rename someone else's record)
      await m.query(
        `INSERT INTO otp_challenges (id, visitor_id, code_hash, payload_enc, ip, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))`,
        [challengeId, visitorId, otpHash(challengeId, code), encrypt(JSON.stringify({ name, consent })), ip, config.otp.ttlSeconds],
      );

      try {
        await this.sms.sendOtp(phone, code);
      } catch (e) {
        this.log.error(`sms send failed: ${(e as Error).message}`);
        throw new AppError(502, 'sms_failed', 'We could not send the SMS right now. Please try again in a moment.');
      }
    });
    return {
      challengeId,
      phone: maskPhone(phone),
      expiresIn: config.otp.ttlSeconds,
      resendIn: config.otp.resendCooldownSeconds,
      ...(config.otp.devEcho ? { devCode: code } : {}),
    };
  }

  async verifyOtp(challengeId: string, rawCode: string): Promise<string> {
    const code = String(rawCode || '').replace(/\D/g, '');
    const result = await this.ds.transaction(async (m) => {
      await m.query('LOCK TABLE votes IN ROW EXCLUSIVE MODE');
      const identities = await m.query('SELECT visitor_id FROM otp_challenges WHERE id = $1', [challengeId]);
      if (!identities.length) return { err: ['otp_invalid', 'This code is no longer valid. Please request a new one.'] };
      // Match requestOtp's visitor-before-challenge order to avoid resend/verify deadlocks.
      await m.query('SELECT id FROM visitors WHERE id = $1 FOR UPDATE', [identities[0].visitor_id]);
      const rows = await m.query(
        `SELECT id, visitor_id, code_hash, payload_enc, attempts, expires_at < now() AS expired, consumed_at
           FROM otp_challenges WHERE id = $1 FOR UPDATE`, [challengeId]);
      const ch = rows[0];
      if (!ch || ch.consumed_at) return { err: ['otp_invalid', 'This code is no longer valid. Please request a new one.'] };
      if (ch.expired) return { err: ['otp_expired', 'This code has expired. Please request a new one.'] };
      if (ch.attempts >= config.otp.maxAttempts) return { err: ['otp_locked', 'Too many wrong attempts. Please request a new code.'] };
      if (!safeEqual(otpHash(ch.id, code), ch.code_hash)) {
        await m.query('UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1', [ch.id]);
        const left = config.otp.maxAttempts - ch.attempts - 1;
        return { err: ['otp_wrong', left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Incorrect code. Please request a new one.'] };
      }
      await m.query('UPDATE otp_challenges SET consumed_at = now() WHERE id = $1', [ch.id]);
      const { name, consent } = JSON.parse(decrypt(ch.payload_enc));
      await m.query(
        `UPDATE visitors SET verified_at = COALESCE(verified_at, now()), name_enc = $2, consent_outreach = consent_outreach OR $3 WHERE id = $1`,
        [ch.visitor_id, encrypt(name), !!consent]);
      return { visitorId: ch.visitor_id as string };
    });
    if ('err' in result) throw new AppError(400, result.err![0], result.err![1]);
    return result.visitorId;
  }

  // ------------------------------------------------------------------ voting
  async castVote(visitorId: string, ip: string, categoryId: number, exhibitorId: number, location: GeoPoint | null) {
    await this.assertCanVote(ip, location);
    const result = await this.ds.transaction(async (m) => {
      // Wait for any reset before checking the visitor (a reset may purge registrations).
      await m.query('LOCK TABLE votes IN ROW EXCLUSIVE MODE');
      // Recheck after waiting for reset, using committed DB settings rather than cached state.
      // Keep the row shared-locked until this vote commits, so closing cannot race insertion.
      const [row] = await m.query("SELECT value FROM settings WHERE key = 'voting' FOR SHARE");
      const settingsRows = await m.query('SELECT key, value FROM settings');
      const fresh = { ...Object.fromEntries(settingsRows.map((setting: any) => [setting.key, setting.value])), voting: row.value } as AllSettings;
      await this.assertCanVote(ip, location, fresh);
      const visitor = await m.query('SELECT 1 FROM visitors WHERE id = $1 AND verified_at IS NOT NULL', [visitorId]);
      if (!visitor.length) throw new AppError(401, 'not_verified', 'Please verify your phone number first.');

      const valid = await m.query(
        `SELECT 1 FROM exhibitor_categories ec
           JOIN exhibitors e ON e.id = ec.exhibitor_id AND e.is_active
           JOIN categories c ON c.id = ec.category_id AND c.is_active
          WHERE ec.category_id = $1 AND ec.exhibitor_id = $2`,
        [categoryId, exhibitorId],
      );
      if (!valid.length) throw new AppError(400, 'bad_vote', 'That exhibitor is not in this category.');

      // UNIQUE(visitor_id, category_id) is the real guarantee: concurrent
      // double taps, refreshes and network retries cannot create two votes.
      const rows = await m.query(
        `INSERT INTO votes (visitor_id, category_id, exhibitor_id, ip, geo_lat, geo_lng)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT ON CONSTRAINT one_vote_per_category DO NOTHING RETURNING id`,
        [visitorId, categoryId, exhibitorId, ip, location?.lat ?? null, location?.lng ?? null],
      );

      if (rows.length) return { created: true };

      return { created: false };
    });
    if (!result.created) throw new AppError(409, 'already_voted', 'You have already voted in this category.', { session: await this.session(visitorId) });
    await this.bus.publish('vote', { categoryId });
    return { ...result, session: await this.session(visitorId) };
  }
}
