import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { decrypt } from '../common/crypto.util';
import { AppError } from '../common/http-error';
import { AuditService } from '../core/audit.service';
import { BusService } from '../redis/bus.service';
import { ResultsService } from '../results/results.service';

const csvCell = (v: unknown) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formula injection
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows: unknown[][]) => '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
export const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

/** Results, exports (F13), reset, visitor data (F14), monitoring. */
@Injectable()
export class ReportsService {
  constructor(private readonly ds: DataSource, private readonly results: ResultsService, private readonly audit: AuditService, private readonly bus: BusService) {}

  async resultsCsv(actor: string, ip: string) {
    const snap = await this.results.snapshot(true);
    const rows: unknown[][] = [['category', 'rank', 'exhibitor', 'project', 'booth', 'votes', 'share_pct']];
    for (const c of snap.categories) {
      for (const s of c.standings) {
        rows.push([c.name, s.rank, s.name, s.project, s.booth, s.votes, c.total ? ((100 * s.votes) / c.total).toFixed(1) : '0.0']);
      }
    }
    await this.audit.record(actor, 'results_exported', { format: 'csv' }, ip);
    return toCsv(rows);
  }

  async reset(actor: string, ip: string, purgeVisitors: boolean) {
    const deleted = await this.ds.transaction('REPEATABLE READ', async (manager) => {
      // Excludes vote writes until snapshot, deletion and audit have committed together.
      await manager.query('LOCK TABLE votes IN SHARE ROW EXCLUSIVE MODE');
      // Close voting atomically with deletion; failures restore both settings and votes.
      await manager.query(`UPDATE settings SET value = value || '{"open":false}'::jsonb,
        updated_at = now() WHERE key = 'voting'`);
      // No votes left, so nothing to announce on the results screen.
      await manager.query(`UPDATE settings SET value = value || '{"show_winners":false}'::jsonb,
        updated_at = now() WHERE key = 'display'`);
      const before = await this.results.snapshotForReset(manager);
      const res = await manager.query('DELETE FROM votes');
      const count = Array.isArray(res) ? res[1] : 0;
      // Unlike ordinary best-effort audit logging, failure here must roll back the reset.
      await manager.query('INSERT INTO audit_log(actor, action, detail, ip) VALUES ($1,$2,$3,$4)',
        [actor, 'results_reset', { deleted_votes: count, snapshot: before }, ip]);
      if (purgeVisitors) {
        await manager.query('DELETE FROM visitors');
        await manager.query('INSERT INTO audit_log(actor, action, detail, ip) VALUES ($1,$2,$3,$4)',
          [actor, 'visitors_purged', {}, ip]);
      }
      return count;
    });
    await this.bus.publish('settings', { key: 'voting' });
    await this.bus.publish('results-changed', {});
    return { ok: true, deleted, votingClosed: true };
  }

  /** Clear ballots and immediately reopen a fresh voting round, keeping registrations. */
  async restart(actor: string, ip: string, confirm: string) {
    if (confirm !== 'RESET') throw new AppError(400, 'confirm_required', 'Type RESET to confirm.');
    const deleted = await this.ds.transaction('REPEATABLE READ', async manager => {
      await manager.query('LOCK TABLE votes IN SHARE ROW EXCLUSIVE MODE');
      const before = await this.results.snapshotForReset(manager);
      await manager.query(`UPDATE settings SET value = value || '{"open":true,"ended_at":null,"opens_at":null,"closes_at":null}'::jsonb,
        updated_at = now() WHERE key = 'voting'`);
      await manager.query(`UPDATE settings SET value = value || '{"show_winners":false}'::jsonb,
        updated_at = now() WHERE key = 'display'`);
      const res = await manager.query('DELETE FROM votes');
      const count = Array.isArray(res) ? res[1] : 0;
      await manager.query('INSERT INTO audit_log(actor, action, detail, ip) VALUES ($1,$2,$3,$4)',
        [actor, 'results_restarted', { deleted_votes: count, snapshot: before }, ip]);
      return count;
    });
    await this.bus.publish('settings', { key: 'voting' });
    await this.bus.publish('settings', { key: 'display' });
    await this.bus.publish('results-changed', {});
    return { ok: true, deleted, votingOpen: true };
  }

  async visitors(limitRaw?: string | number, offsetRaw?: string | number) {
    const integer = (raw: string | number | undefined, fallback: number, minimum: number) => {
      if (raw === undefined) return fallback;
      if ((typeof raw !== 'string' && typeof raw !== 'number') ||
          (typeof raw === 'string' && !/^\d+$/.test(raw)) || !Number.isSafeInteger(Number(raw)) || Number(raw) < minimum) {
        throw new AppError(400, 'bad_pagination', 'Pagination must use a positive integer limit and a nonnegative integer offset.');
      }
      return Number(raw);
    };
    const limit = Math.min(integer(limitRaw, 50, 1), 200);
    const offset = integer(offsetRaw, 0, 0);
    // The count and page share a snapshot; empty pages still retain the true total.
    const { rows, total } = await this.ds.transaction('REPEATABLE READ', async manager => {
      const [{ total }] = await manager.query('SELECT COUNT(*)::int AS total FROM visitors WHERE verified_at IS NOT NULL');
      const rows = await manager.query(`
      SELECT v.id, v.name_enc, v.phone_last4, v.verified_at, v.consent_outreach,
             COUNT(vt.id)::int AS votes
        FROM visitors v LEFT JOIN votes vt ON vt.visitor_id = v.id
       WHERE v.verified_at IS NOT NULL
       GROUP BY v.id ORDER BY v.created_at DESC, v.id DESC LIMIT $1 OFFSET $2`, [limit, offset]);
      return { rows, total };
    });
    return {
      total,
      visitors: rows.map((v: any) => ({
        id: v.id, name: decrypt(v.name_enc), phone: `•••• ${v.phone_last4}`,
        verified_at: v.verified_at, consent_outreach: v.consent_outreach, votes: v.votes,
      })),
    };
  }

  async visitorsCsv(actor: string, ip: string, onlyConsented: boolean) {
    const rows = await this.ds.query(`
      SELECT v.name_enc, v.phone_enc, v.verified_at, v.consent_outreach
        FROM visitors v
       WHERE v.verified_at IS NOT NULL ${onlyConsented ? 'AND v.consent_outreach' : ''}
       ORDER BY v.verified_at`);
    const out: unknown[][] = [['name', 'phone', 'verified_at', 'consent_outreach']];
    // phone exported as E.164 digits (no "+") so spreadsheets keep it intact
    for (const r of rows) out.push([decrypt(r.name_enc), decrypt(r.phone_enc), new Date(r.verified_at).toISOString(), r.consent_outreach]);
    await this.audit.record(actor, 'visitors_exported', { count: rows.length, onlyConsented }, ip);
    return toCsv(out);
  }

  async stats() {
    const rows = await this.ds.query(`
      SELECT (SELECT COUNT(*) FROM visitors WHERE verified_at IS NOT NULL)::int AS verified_visitors,
             (SELECT COUNT(*) FROM votes)::int AS votes,
             (SELECT COUNT(*) FROM votes WHERE created_at > now() - interval '5 minutes')::int AS votes_last_5m,
             (SELECT COUNT(*) FROM otp_challenges WHERE created_at > now() - interval '1 hour')::int AS otps_last_hour,
             (SELECT COUNT(*) FROM exhibitors WHERE is_active)::int AS exhibitors,
             (SELECT COUNT(*) FROM audit_log WHERE action = 'off_site_blocked')::int AS off_site_blocked`);
    return { ...rows[0], redis: this.bus.status(), live_screens_this_node: this.results.clientCount };
  }

  async auditLog() {
    const entries = await this.ds.query(`SELECT id, actor, action, detail - 'snapshot' AS detail, host(ip) AS ip, created_at FROM audit_log ORDER BY id DESC LIMIT 100`);
    return { entries };
  }
}
