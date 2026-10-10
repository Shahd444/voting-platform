import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { isISO8601 } from 'class-validator';
import { buildBlockList, validGeofence } from '../common/geo.util';
import { AppError } from '../common/http-error';
import { AuditService } from '../core/audit.service';
import { SettingsService } from '../settings/settings.service';
import { AllSettings } from '../settings/settings.types';
import { VoteQrService } from '../core/vote-qr.service';
import { AccessSettingsDto, DisplaySettingsDto, EventSettingsDto, VotingSettingsDto } from './admin.dto';

/** Voting window (F10), on-site rules (F11), event details and display key. */
@Injectable()
export class EventService {
  constructor(private readonly settings: SettingsService, private readonly audit: AuditService, private readonly voteQr: VoteQrService) {}

  async get(ip: string, reportedNetworks: string[] = []) {
    const s = await this.settings.getAll(true);
    const { invalid } = buildBlockList(reportedNetworks);
    return {
      settings: s,
      voting: this.settings.votingState(s),
      clientIp: ip,
      clientNetworks: reportedNetworks.filter((network) => !invalid.includes(network)),
    };
  }

  async updateEvent(actor: string, ip: string, b: EventSettingsDto) {
    const patch: Partial<AllSettings['event']> = {
      name: String(b.name || '').trim().slice(0, 80) || 'MC2026 Community Awards',
      tagline: String(b.tagline || '').trim(),
      venue: String(b.venue || '').trim(),
    };
    if (b.public_url !== undefined) patch.public_url = EventService.publicUrl(b.public_url);
    return this.save(actor, ip, 'event', patch);
  }

  /** "192.168.1.20:3000" or "http://192.168.1.20:3000/x" → "http://192.168.1.20:3000"; empty clears the setting. */
  static publicUrl(raw: string): string {
    const text = String(raw || '').trim();
    if (!text) return '';
    let url: URL;
    try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`); } catch { url = null as unknown as URL; }
    if (!url || !['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
      throw new AppError(400, 'bad_url', 'Enter the address visitors open, for example http://192.168.1.20:3000');
    }
    return `${url.protocol}//${url.host}`;
  }

  async updateVoting(actor: string, ip: string, b: VotingSettingsDto) {
    const iso = (v?: string | null) => {
      if (v === null) return null;
      if (typeof v !== 'string' || !isISO8601(v, { strict: true, strictSeparator: true }) ||
          !/T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v)) {
        throw new AppError(400, 'bad_date', 'Schedule dates must be valid ISO timestamps with a timezone offset.');
      }
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) throw new AppError(400, 'bad_date', 'Invalid date.');
      return d.toISOString();
    };
    const patch: Partial<AllSettings['voting']> = {};
    if (b.open !== undefined) patch.open = !!b.open;
    if (b.opens_at !== undefined) patch.opens_at = iso(b.opens_at);
    if (b.closes_at !== undefined) patch.closes_at = iso(b.closes_at);
    if (b.ended_at !== undefined) patch.ended_at = iso(b.ended_at);
    if (patch.open !== true) return this.save(actor, ip, 'voting', patch);
    // Reopening and hiding the announcement either commit together or both roll back.
    const display = { show_winners: false };
    const saved = await this.settings.updateMany({ voting: patch, display }, async manager => {
      await this.audit.record(actor, 'settings_updated', { key: 'voting', patch }, ip, manager);
      await this.audit.record(actor, 'settings_updated', { key: 'display', patch: display }, ip, manager);
    });
    return { ok: true, value: saved.voting };
  }

  async updateAccess(actor: string, ip: string, b: AccessSettingsDto) {
    const patch: Partial<AllSettings['access']> = {};
    if (b.mode) patch.mode = b.mode;
    if (b.allowed_cidrs) {
      const list = b.allowed_cidrs.map((x) => String(x).trim()).filter(Boolean);
      const { invalid } = buildBlockList(list);
      if (invalid.length) throw new AppError(400, 'bad_cidr', `Invalid IP range(s): ${invalid.join(', ')}`);
      patch.allowed_cidrs = list;
    }
    if (b.geofence) {
      const g = { lat: b.geofence.lat, lng: b.geofence.lng, radius_m: b.geofence.radius_m,
        max_accuracy_m: b.geofence.max_accuracy_m === undefined ? 500 : b.geofence.max_accuracy_m };
      if (!validGeofence(g)) {
        throw new AppError(400, 'bad_geofence', 'Check the geofence latitude, longitude, radius (10–50,000 m) and nonnegative accuracy limit.');
      }
      patch.geofence = g;
    }
    return this.save(actor, ip, 'access', patch);
  }

  async updateDisplay(actor: string, ip: string, b: DisplaySettingsDto) {
    const patch: Partial<AllSettings['display']> = {};
    if (b.show_counts !== undefined) patch.show_counts = !!b.show_counts;
    if (b.show_winners !== undefined) patch.show_winners = !!b.show_winners;
    return this.save(actor, ip, 'display', patch);
  }

  async rotateDisplayKey(actor: string, ip: string) {
    await this.settings.update('display', { key: crypto.randomBytes(18).toString('base64url') },
      manager => this.audit.record(actor, 'display_key_rotated', {}, ip, manager));
    return { ok: true };
  }

  async links(isAdmin: boolean, requestOrigin?: string) {
    const s = await this.settings.getAll(true);
    const base = await this.settings.publicBase(requestOrigin);
    const qr = await this.voteQr.entryQr(base);
    return {
      voteUrl: `${base}/`,
      displayUrl: isAdmin ? `${base}/display?key=${encodeURIComponent(s.display.key || '')}` : null,
      voteQr: qr.qr,
      voteQrRefreshAt: qr.refreshAt,
      voteQrRefreshIn: qr.refreshIn,
    };
  }

  private async save<K extends keyof AllSettings>(actor: string, ip: string, key: K, patch: Partial<AllSettings[K]>) {
    const value = await this.settings.update(key, patch,
      manager => this.audit.record(actor, 'settings_updated', { key, patch }, ip, manager));
    return { ok: true, value };
  }
}
