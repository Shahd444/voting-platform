import { config } from '../config/config';

/**
 * Normalise user-typed numbers to E.164 digits (no '+').
 * Accepts Jordanian local forms (07XXXXXXXX, 7XXXXXXXX), international forms
 * (+9627…, 009627…) and Arabic-Indic digits.
 */
export function normalizePhone(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let s = input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  s = s.trim().replace(/[\s\-().]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  else if (s.startsWith('00')) s = s.slice(2);
  else if (s.startsWith('0')) s = config.phone.defaultCountryCode + s.slice(1);
  else if (s.length <= 9) s = config.phone.defaultCountryCode + s;
  if (!/^\d{8,15}$/.test(s)) return null;
  if (!new RegExp(config.phone.allowPattern).test(s)) return null;
  if (s.startsWith('962') && !/^9627[789]\d{7}$/.test(s)) return null; // JO mobiles only
  return s;
}

export const maskPhone = (e164: string) => `+${e164.slice(0, 3)} •••• ${e164.slice(-4)}`;
