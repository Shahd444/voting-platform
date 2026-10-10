import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter } from 'events';
import Redis from 'ioredis';
import { config } from '../config/config';

export type BusEvent = 'vote' | 'results-changed' | 'settings';

/**
 * Redis is an accelerator, not a dependency:
 *  - pub/sub fans live-vote events out to every replica's SSE clients
 *  - shared counters back the rate limiters; short-lived caches
 * If Redis is missing or down, everything falls back to in-process
 * equivalents and voting never pauses.
 */
@Injectable()
export class BusService implements OnModuleDestroy {
  private readonly log = new Logger('Bus');
  private readonly local = new EventEmitter();
  private pub: Redis | null = null;
  private sub: Redis | null = null;
  private healthy = false;
  private readonly mem = new Map<string, { count: number; reset: number }>();
  private readonly sweeper: NodeJS.Timeout;

  constructor() {
    this.local.setMaxListeners(0);
    if (config.redisUrl) {
      const opts = { maxRetriesPerRequest: 1, enableOfflineQueue: false, retryStrategy: (n: number) => Math.min(n * 200, 3000) };
      this.pub = new Redis(config.redisUrl, opts);
      this.sub = new Redis(config.redisUrl, opts);
      this.pub.on('ready', () => { this.healthy = true; this.log.log('redis ready'); });
      this.pub.on('error', (e) => { if (this.healthy) this.log.warn(`redis error: ${e.message}`); this.healthy = false; });
      this.pub.on('end', () => { this.healthy = false; });
      this.sub.on('error', () => undefined);
      this.sub.on('ready', () => this.sub!.subscribe('mc2026:events').catch(() => undefined));
      this.sub.on('message', (_ch, msg) => {
        try { const { type, payload } = JSON.parse(msg); this.local.emit(type, payload); } catch { /* ignore */ }
      });
    }
    this.sweeper = setInterval(() => {
      const now = Date.now();
      for (const [k, v] of this.mem) if (v.reset < now) this.mem.delete(k);
    }, 60_000);
    this.sweeper.unref();
  }

  get enabled() { return !!this.pub; }
  get isHealthy() { return this.healthy; }
  status() { return this.enabled ? (this.healthy ? 'up' : 'down') : 'not configured'; }

  async publish(type: BusEvent, payload: unknown = {}) {
    if (this.pub && this.healthy) {
      try { await this.pub.publish('mc2026:events', JSON.stringify({ type, payload })); return; }
      catch (e) { this.log.warn(`publish failed, using local bus: ${(e as Error).message}`); }
    }
    this.local.emit(type, payload);
  }

  on(type: BusEvent, fn: (payload: any) => void) {
    this.local.on(type, fn);
    return () => this.local.off(type, fn);
  }

  /** Fixed-window counter. */
  async hit(key: string, limit: number, windowSec: number) {
    const k = `mc2026:rl:${key}`;
    if (this.pub && this.healthy) {
      try {
        const res = await this.pub.multi().incr(k).expire(k, windowSec, 'NX').ttl(k).exec();
        const count = Number(res![0][1]);
        const ttl = Number(res![2][1]);
        return { allowed: count <= limit, count, retryAfter: ttl > 0 ? ttl : windowSec };
      } catch { /* fall back to memory */ }
    }
    const now = Date.now();
    let e = this.mem.get(k);
    if (!e || e.reset < now) { e = { count: 0, reset: now + windowSec * 1000 }; this.mem.set(k, e); }
    e.count += 1;
    return { allowed: e.count <= limit, count: e.count, retryAfter: Math.ceil((e.reset - now) / 1000) };
  }

  async cacheGet<T>(key: string): Promise<T | null> {
    if (!(this.pub && this.healthy)) return null;
    try { const v = await this.pub.get(`mc2026:c:${key}`); return v ? JSON.parse(v) : null; } catch { return null; }
  }

  async cacheSet(key: string, val: unknown, ttlSec: number) {
    if (!(this.pub && this.healthy)) return;
    try { await this.pub.set(`mc2026:c:${key}`, JSON.stringify(val), 'EX', ttlSec); } catch { /* ignore */ }
  }

  async cacheDel(key: string) {
    if (!(this.pub && this.healthy)) return;
    try { await this.pub.del(`mc2026:c:${key}`); } catch { /* ignore */ }
  }

  async onModuleDestroy() {
    clearInterval(this.sweeper);
    await Promise.all([this.pub?.quit().catch(() => undefined), this.sub?.quit().catch(() => undefined)]);
  }
}
