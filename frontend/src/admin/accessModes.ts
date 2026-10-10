import type { Settings } from '../lib/types';
import type { useLang } from './i18n';

type T = ReturnType<typeof useLang>['t'];

/** On-site access modes (F11), in display order; labels live in the language file. */
export const ACCESS_MODES = ['ip_or_geo', 'ip_and_geo', 'geo', 'off'];

export const modeLabel = (t: T, mode: string) => t.modes[mode]?.[0] ?? mode;
export const usesIp = (mode: string) => ['ip', 'ip_or_geo', 'ip_and_geo'].includes(mode);
export const usesGeo = (mode: string) => ['geo', 'ip_or_geo', 'ip_and_geo'].includes(mode);

/** One-line description of the active rule, e.g. "1 network · 150 m radius". */
export function accessSummary(t: T, access: Settings['access']) {
  const parts: string[] = [];
  if (usesIp(access.mode)) {
    const n = access.allowed_cidrs.length;
    parts.push(n ? t.summary.networks(n) : t.summary.noNetwork);
  }
  if (usesGeo(access.mode)) {
    const g = access.geofence;
    parts.push(g.lat != null && g.lng != null && g.radius_m ? t.summary.radius(g.radius_m) : t.summary.noLocation);
  }
  return parts.join(' · ');
}
