import { Injectable } from '@nestjs/common';
import { GeoPoint, geoAllowed, ipAllowed, normalizeIp } from '../common/geo.util';
import { AllSettings } from '../settings/settings.types';

export interface AccessVerdict {
  allowed: boolean;
  mode: string;
  ip: string;
  ipOk: boolean;
  geoOk: boolean;
  geoReason: string | null;
  distance?: number;
  needsLocation: boolean;
}

/**
 * On-site access control (F11). Two independent signals:
 *  - IP range: request comes from the venue Wi-Fi's public/NAT range
 *    (server-observed, hard to spoof — the strongest signal)
 *  - Geofence: browser Geolocation inside the venue radius (covers mobile
 *    data users; client-reported, so always combined with OTP + limits)
 * The admin picks how to combine them.
 */
@Injectable()
export class AccessService {
  evaluate(settings: AllSettings, ip: string | undefined, location: GeoPoint | null): AccessVerdict {
    const { mode, allowed_cidrs, geofence } = settings.access;
    const ipOk = ipAllowed(ip, allowed_cidrs);
    const geo = location ? geoAllowed(location, geofence) : { ok: false, reason: 'no_location', distance: undefined };

    let allowed: boolean;

    switch (mode) {
      case 'off':
        allowed = true;
        break;
    
      case 'ip':
        allowed = ipOk;
        break;
    
      case 'geo':
        allowed = geo.ok;
        break;
      case 'ip_or_geo':
        allowed = ipOk || geo.ok;
        break;
      case 'ip_and_geo':
        allowed = ipOk && geo.ok;
        break;
      default:
        allowed = false;
        break;
    }
    const needsLocation = !location && (mode === 'geo' || mode === 'ip_and_geo' || (mode === 'ip_or_geo' && !ipOk));
    return { allowed, mode, ip: normalizeIp(ip), ipOk, geoOk: geo.ok, geoReason: geo.reason || null, distance: geo.distance, needsLocation };
  }
}
