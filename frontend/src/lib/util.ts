import { useEffect } from 'react';
import type { GeoPoint } from './types';

export const initials = (name: string) =>
  String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

const CAT_COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)'];
export const catColor = (index: number) => CAT_COLORS[((index % CAT_COLORS.length) + CAT_COLORS.length) % CAT_COLORS.length];

/** CSS custom property helper for the `style` prop. */
export const accent = (index: number) => ({ '--accent': catColor(index) }) as React.CSSProperties;

export function getLocation(timeout = 12000): Promise<GeoPoint> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('unsupported'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout, maximumAge: 60000 },
    );
  });
}

/** Each page owns the <body> class its (scoped) stylesheet targets. */
export function useBodyClass(cls: string) {
  useEffect(() => {
    document.body.classList.add(cls);
    return () => document.body.classList.remove(cls);
  }, [cls]);
}

export const fmtTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const toLocalInput = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

/** sessionStorage / localStorage that never throws (private mode, blocked storage). */
export const safeStore = {
  get<T>(k: string, local = false): T | null {
    try { const v = (local ? localStorage : sessionStorage).getItem(`mc:${k}`); return v ? JSON.parse(v) : null; } catch { return null; }
  },
  set(k: string, v: unknown, local = false) {
    try { (local ? localStorage : sessionStorage).setItem(`mc:${k}`, JSON.stringify(v)); } catch { /* ignore */ }
  },
  del(k: string) { try { sessionStorage.removeItem(`mc:${k}`); } catch { /* ignore */ } },
};
