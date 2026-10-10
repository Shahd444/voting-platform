import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DataSource } from 'typeorm';
import { BusService } from '../redis/bus.service';

@Controller()
export class HealthController {
  constructor(private readonly ds: DataSource, private readonly bus: BusService) {}

  /** Liveness probe. */
  @Get('healthz')
  live() { return { ok: true }; }

  /** Readiness probe: DB reachable (Redis reported but optional). */
  @Get('readyz')
  async ready(@Res() res: Response) {
    try {
      await this.ds.query('SELECT 1');
      res.json({ ok: true, db: 'up', redis: this.bus.enabled ? (this.bus.isHealthy ? 'up' : 'down') : 'off' });
    } catch {
      res.status(503).json({ ok: false, db: 'down' });
    }
  }

  /** Exhibitor images — immutable (a new upload gets a new id), so cache forever. */
  @Get('img/:id')
  async image(@Param('id') id: string, @Res() res: Response) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException();
    const rows = await this.ds.query('SELECT mime_type, bytes, sha256 FROM images WHERE id = $1', [id]);
    if (!rows[0]) throw new NotFoundException();
    res.set({
      'Content-Type': rows[0].mime_type,
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: `"${rows[0].sha256.slice(0, 16)}"`,
      'X-Content-Type-Options': 'nosniff',
    }).send(rows[0].bytes);
  }
}
