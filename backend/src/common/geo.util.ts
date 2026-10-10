import * as net from 'net';

export interface GeoPoint { lat: number; lng: number; accuracy?: number }
export interface Geofence { lat: number; lng: number; radius_m: number; max_accuracy_m?: number }
export type GeofenceConfig = { [K in keyof Geofence]: Geofence[K] | null };

export function validCoordinates(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

export function validGeofence(fence: GeofenceConfig): fence is Geofence {
  return !!fence && typeof fence.lat === 'number' && typeof fence.lng === 'number' &&
    validCoordinates(fence.lat, fence.lng) && typeof fence.radius_m === 'number' &&
    Number.isFinite(fence.radius_m) && fence.radius_m >= 10 && fence.radius_m <= 50000 &&
    (fence.max_accuracy_m === undefined ||
      (typeof fence.max_accuracy_m === 'number' && Number.isFinite(fence.max_accuracy_m) && fence.max_accuracy_m >= 0));
}

/** Strip IPv4-mapped IPv6 prefix so "::ffff:10.0.0.5" matches 10.0.0.0/8. */
export function normalizeIp(ip?: string): string {
  if (!ip) return '';
  return ip.startsWith('::ffff:') && net.isIPv4(ip.slice(7)) ? ip.slice(7) : ip;
}

export function buildBlockList(cidrs: string[]) {
  const bl = new net.BlockList();
  const invalid: string[] = [];
  for (const raw of cidrs || []) {
    const c = String(raw).trim();
    if (!c) continue;
    const [addr, bitsStr] = c.split('/');
    const type = net.isIPv4(addr) ? 'ipv4' : net.isIPv6(addr) ? 'ipv6' : null;
    if (!type) { invalid.push(c); continue; }
    const max = type === 'ipv4' ? 32 : 128;
    const bits = bitsStr === undefined ? max : Number(bitsStr);
    if (!Number.isInteger(bits) || bits < 0 || bits > max) { invalid.push(c); continue; }
    bl.addSubnet(addr, bits, type);
  }
  return { bl, invalid };
}

export function ipAllowed(ip: string | undefined, cidrs: string[]): boolean {
  const addr = normalizeIp(ip);
  const type = net.isIPv4(addr) ? 'ipv4' : net.isIPv6(addr) ? 'ipv6' : null;
  if (!type) return false;
  return buildBlockList(cidrs).bl.check(addr, type);
}

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.max(0, Math.min(1, a))));
}

export function geoAllowed(loc: GeoPoint | null | undefined, fence: GeofenceConfig) {
  if (!loc || !fence) return { ok: false, reason: 'no_location' as string | null, distance: undefined as number | undefined };
  // Freshness requires coordinated frontend work later; no timestamp is required.
  const { lat, lng } = loc;
  const acc = loc.accuracy === undefined ? 0 : loc.accuracy;
  if (!validCoordinates(lat, lng) || !Number.isFinite(acc) || acc < 0)
    return { ok: false, reason: 'bad_location', distance: undefined };
  if (!validGeofence(fence)) return { ok: false, reason: 'bad_geofence', distance: undefined };
  if (fence.max_accuracy_m !== undefined && acc > fence.max_accuracy_m) return { ok: false, reason: 'low_accuracy', distance: undefined };
  const d = haversineMeters(lat, lng, fence.lat, fence.lng);
  const ok = d <= fence.radius_m + Math.min(acc, 100); // allow the accuracy circle to overlap (capped)
  return { ok, reason: ok ? null : 'outside_geofence', distance: Math.round(d) };
}
