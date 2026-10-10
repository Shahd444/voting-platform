import { Injectable } from '@nestjs/common';
import { ipAllowed } from '../common/geo.util';
import { AppError } from '../common/http-error';
import { BusService } from '../redis/bus.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class RateLimitService {
  constructor(private readonly bus: BusService, private readonly settings: SettingsService) {}

  /** Throws 429 when the fixed-window budget is exhausted. */
  async check(name: string, key: string, limit: number, windowSec: number, message?: string) {
    const r = await this.bus.hit(`${name}:${key}`, limit, windowSec);
    if (!r.allowed) {
      throw new AppError(429, 'rate_limited', message || 'Too many attempts. Please wait a moment and try again.', { retryAfter: r.retryAfter });
    }
    return r;
  }

  /**
   * Per-IP limit that understands the venue: every phone on the event Wi-Fi
   * shares the venue's public IP (NAT), so requests from the allowed venue
   * ranges get a much larger budget. Per-phone limits still apply to everyone.
   */
  async checkIp(name: string, ip: string, limit: number, venueLimit: number, windowSec: number) {
    const s = await this.settings.getAll();
    const venue = ipAllowed(ip, s.access.allowed_cidrs);
    return this.check(venue ? `${name}-venue` : name, ip, venue ? venueLimit : limit, windowSec);
  }
}
