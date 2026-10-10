import { Injectable, MessageEvent, OnModuleDestroy } from '@nestjs/common';
import { Observable, Subject, defer, from, interval, map, merge, finalize } from 'rxjs';
import { DataSource, EntityManager } from 'typeorm';
import { BusService } from '../redis/bus.service';
import { SettingsService } from '../settings/settings.service';
import { AllSettings, VotingState } from '../settings/settings.types';

export interface Standing { id: number; name: string; project: string; booth: string; image: string | null; votes: number; rank: number }
export interface CategoryResult { id: number; slug: string; name: string; description: string; total: number; standings: Standing[] }
export interface ResultsSnapshot {
  event: { name: string; tagline: string; venue: string };
  voting: VotingState;
  show_counts: boolean;
  show_winners: boolean;
  generated_at: string;
  totals: { votes: number; voters: number };
  categories: CategoryResult[];
}

/**
 * Live tallies + Server-Sent Events hub.
 * The DB is the single source of truth (COUNT over votes, served by an index).
 * Each replica memoises the snapshot briefly so 1,000 phones + TVs never turn
 * into 1,000 queries, and bursts of votes are coalesced into ≤2 pushes/second.
 */
@Injectable()
export class ResultsService implements OnModuleDestroy {
  private memo: ResultsSnapshot | null = null;
  private memoAt = 0;
  private inflight: Promise<ResultsSnapshot> | null = null;
  private generation = 0;
  private static readonly MEMO_MS = 750;

  private readonly updates = new Subject<ResultsSnapshot>();
  private clients = 0;
  private pending: NodeJS.Timeout | null = null;
  private readonly safetyNet: NodeJS.Timeout;

  constructor(private readonly ds: DataSource, private readonly bus: BusService, private readonly settings: SettingsService) {
    this.bus.on('vote', () => { this.invalidate(); this.schedulePush(); });
    this.bus.on('results-changed', () => { this.invalidate(); this.schedulePush(); });
    this.bus.on('settings', () => { this.invalidate(); setTimeout(() => this.schedulePush(), 50); });
    // Periodic full snapshot so screens converge even if a pub/sub message was lost
    this.safetyNet = setInterval(() => { if (this.clients) this.snapshot().then((s) => this.updates.next(s)).catch(() => undefined); }, 10_000);
    this.safetyNet.unref();
  }

  get clientCount() { return this.clients; }

  invalidate() { this.memoAt = 0; this.generation++; }

  async snapshot(force = false): Promise<ResultsSnapshot> {
    if (!force && this.memo && Date.now() - this.memoAt < ResultsService.MEMO_MS) return this.memo;
    if (this.inflight) return this.inflight;
    this.inflight = this.computeCurrent()
      .then((s) => { this.memo = s; this.memoAt = Date.now(); return s; })
      .finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async computeCurrent(): Promise<ResultsSnapshot> {
    for (;;) {
      const generation = this.generation;
      const snapshot = await this.compute();
      // A reset or vote committed while queries were running: discard the old snapshot.
      if (generation === this.generation) return snapshot;
    }
  }

  /** Uncached snapshot on the reset transaction's connection and isolation snapshot. */
  snapshotForReset(manager: EntityManager): Promise<ResultsSnapshot> { return this.compute(manager); }

  private async compute(db: DataSource | EntityManager = this.ds): Promise<ResultsSnapshot> {
    if (db instanceof DataSource) return db.transaction('REPEATABLE READ', manager => this.compute(manager));
    const queries = [
      () => db.query('SELECT id, slug, name, description FROM categories WHERE is_active ORDER BY id'),
      () => db.query(`
        SELECT ec.category_id, e.id, e.name, e.project, e.booth, e.image_id, COALESCE(v.cnt, 0)::int AS votes
          FROM exhibitor_categories ec
          JOIN exhibitors e ON e.id = ec.exhibitor_id AND e.is_active
          LEFT JOIN (SELECT category_id, exhibitor_id, COUNT(*) AS cnt FROM votes GROUP BY category_id, exhibitor_id) v
                 ON v.category_id = ec.category_id AND v.exhibitor_id = ec.exhibitor_id
         ORDER BY ec.category_id, votes DESC, e.name`),
      () => db.query(`SELECT (SELECT COUNT(*) FROM votes)::int AS votes, (SELECT COUNT(DISTINCT visitor_id) FROM votes)::int AS voters`),
    ];
    const data = [];
    if (db instanceof DataSource) data.push(...await Promise.all(queries.map((query) => query())));
    else for (const query of queries) data.push(await query()); // One transaction connection: no parallel queries.
    const [cats, rows, totals] = data;
    const byCat = new Map<number, CategoryResult>(cats.map((c: any) => [c.id, { ...c, total: 0, standings: [] }]));
    for (const r of rows) {
      const c = byCat.get(r.category_id);
      if (!c) continue;
      c.total += r.votes;
      c.standings.push({ id: r.id, name: r.name, project: r.project, booth: r.booth, image: r.image_id ? `/img/${r.image_id}` : null, votes: r.votes, rank: 0 });
    }
    // Competition ranking ("1, 1, 3") so ties are shown honestly
    for (const c of byCat.values()) {
      let rank = 0; let prev: number | null = null;
      c.standings.forEach((s, i) => { if (s.votes !== prev) { rank = i + 1; prev = s.votes; } s.rank = rank; });
    }
    const settingsRows = await db.query('SELECT key, value FROM settings');
    const st = Object.fromEntries(settingsRows.map((row: any) => [row.key, row.value])) as AllSettings;
    return {
      event: { name: st.event.name, tagline: st.event.tagline, venue: st.event.venue },
      voting: this.settings.votingState(st),
      show_counts: st.display.show_counts !== false,
      show_winners: st.display.show_winners === true,
      generated_at: new Date().toISOString(),
      totals: totals[0],
      categories: [...byCat.values()],
    };
  }

  private schedulePush() {
    if (this.pending) return;
    this.pending = setTimeout(async () => {
      this.pending = null;
      if (!this.clients) return;
      try { this.updates.next(await this.snapshot(true)); } catch { /* next tick will retry */ }
    }, 400);
  }

  /** One SSE stream per screen: initial snapshot, live updates, keep-alive pings. */
  stream(): Observable<MessageEvent> {
    return defer(() => {
      this.clients += 1;
      const initial = from(this.snapshot());
      return merge(
        merge(initial, this.updates).pipe(map((data) => ({ type: 'results', data, retry: 3000 }) as MessageEvent)),
        interval(20_000).pipe(map(() => ({ type: 'ping', data: '' }) as MessageEvent)),
      ).pipe(finalize(() => { this.clients -= 1; }));
    });
  }

  onModuleDestroy() {
    clearInterval(this.safetyNet);
    if (this.pending) clearTimeout(this.pending);
    this.updates.complete();
  }
}
