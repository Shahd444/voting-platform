import { Body, Controller, Get, Header, HttpCode, Post, Req, Res, Sse, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { IsString, MaxLength } from 'class-validator';
import { concatMap, Observable } from 'rxjs';
import { safeEqual } from '../common/crypto.util';
import { AppError } from '../common/http-error';
import { requestOrigin } from '../common/request-origin';
import { ClientIp } from '../auth/decorators';
import { AdminGuard, DisplayOrAdminGuard } from '../auth/guards';
import { SessionService } from '../auth/session.service';
import { AuditService } from '../core/audit.service';
import { RateLimitService } from '../core/rate-limit.service';
import { VoteQrService } from '../core/vote-qr.service';
import { ResultsService } from '../results/results.service';
import { SettingsService } from '../settings/settings.service';

class DisplayAuthDto { @IsString() @MaxLength(200) key: string }

/** Live results dashboard (F7/F8) — protected by a rotatable display key. */
@Controller('api/display')
export class DisplayController {
  constructor(
    private readonly settings: SettingsService,
    private readonly sessions: SessionService,
    private readonly results: ResultsService,
    private readonly audit: AuditService,
    private readonly limits: RateLimitService,
    private readonly displayGuard: DisplayOrAdminGuard,
    private readonly voteQr: VoteQrService,
  ) {}

  /** Exchange the key (from the admin's link) for a 24-hour cookie bound to that key. */
  @Post('auth')
  @HttpCode(200)
  async auth(@ClientIp() ip: string, @Body() b: DisplayAuthDto, @Res({ passthrough: true }) res: Response) {
    await this.limits.check('display-auth', ip, 20, 300);
    const s = await this.settings.getAll(true);
    if (!s.display.key || !safeEqual(String(b.key || ''), s.display.key)) {
      await this.audit.record('display', 'display_auth_failed', {}, ip);
      throw new AppError(401, 'bad_key', 'Invalid display key.');
    }
    this.sessions.set(res, 'mc_d', { typ: 'display', kv: SessionService.displayKeyVersion(s.display.key) }, '24h');
    return { ok: true };
  }

  /**
   * A signed-in admin opening the screen directly gets the same 24-hour display cookie the key link gives,
   * so the screen keeps running after the admin signs out.
   */
  @Post('pair')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  async pair(@Res({ passthrough: true }) res: Response) {
    const s = await this.settings.getAll(true);
    if (!s.display.key) return { ok: false };
    this.sessions.set(res, 'mc_d', { typ: 'display', kv: SessionService.displayKeyVersion(s.display.key) }, '24h');
    return { ok: true };
  }

  /** Server-Sent Events stream (primary live channel). */
  @Sse('stream')
  @UseGuards(DisplayOrAdminGuard)
  @Header('X-Accel-Buffering', 'no')
  stream(@Req() req: Request): Observable<MessageEvent> {
    // Revalidate each update and heartbeat, including streams connected before rotation.
    return this.results.stream().pipe(concatMap(async (event) => {
      await this.displayGuard.authorize(req);
      return event;
    })) as unknown as Observable<MessageEvent>;
  }

  /** Polling fallback for networks/proxies that break SSE. */
  @Get('results')
  @UseGuards(DisplayOrAdminGuard)
  @Header('Cache-Control', 'no-store')
  snapshot() { return this.results.snapshot(); }

  /**
   * Rotating venue QR for the results screen. Only an unlocked screen or a signed-in admin
   * gets it, so a valid code can't be fetched from outside the venue.
   */
  @Get('qr')
  @UseGuards(DisplayOrAdminGuard)
  @Header('Cache-Control', 'no-store')
  async qr(@Req() req: Request) { return this.voteQr.entryQr(await this.settings.publicBase(requestOrigin(req)), 360); }
}
