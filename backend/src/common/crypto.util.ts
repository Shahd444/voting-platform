import * as crypto from 'crypto';
import { promisify } from 'util';
import { config } from '../config/config';

const scrypt = promisify(crypto.scrypt) as (pw: crypto.BinaryLike, salt: crypto.BinaryLike, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;

/** AES-256-GCM field encryption for PII (name, phone). */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', config.keys.data, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}

export function decrypt(blob: string): string {
  const [v, iv, tag, ct] = String(blob).split(':');
  if (v !== 'v1') throw new Error('unknown ciphertext version');
  const d = crypto.createDecipheriv('aes-256-gcm', config.keys.data, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}

/** Keyed hash used as the lookup / uniqueness key for phone numbers. */
export const phoneHash = (e164: string) => crypto.createHmac('sha256', config.keys.phoneHmac).update(e164).digest('hex');

export const otpHash = (challengeId: string, code: string) =>
  crypto.createHmac('sha256', config.keys.otpHmac).update(`${challengeId}:${code}`).digest('hex');

export function randomDigits(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += crypto.randomInt(0, 10);
  return s;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const N = 16384, r = 8, p = 1;
  const key = await scrypt(password, salt, 64, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [alg, N, r, p, salt, key] = stored.split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(key, 'base64');
    const got = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
    return crypto.timingSafeEqual(expected, got);
  } catch {
    return false;
  }
}

export function safeEqual(a: string, b: string): boolean {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}
