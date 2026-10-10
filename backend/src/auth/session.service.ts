import { Injectable } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { createHash } from 'crypto';
import { config } from '../config/config';

/**
 * Stateless sessions: signed JWTs in HttpOnly, SameSite=Strict cookies.
 * Any replica can validate any request — no sticky sessions, no session store.
 *
 *  mc_v  visitor          — issued after SMS OTP verification (12 h)
 *  mc_ap admin pre-MFA    — password OK, waiting for TOTP (5 min)
 *  mc_a  admin            — fully authenticated (8 h)
 *  mc_d  display          — TV dashboard, obtained with the display key (24 h)
 */
export type TokenType = 'visitor' | 'admin' | 'admin_pending' | 'display' | 'vote_entry';
export interface TokenPayload { sub?: string | number; typ: TokenType; role?: string; tv?: string; kv?: string; ip?: string }

const TTL_MS: Record<string, number> = { '5m': 300e3, '10m': 600e3, '8h': 8 * 3600e3, '12h': 12 * 3600e3, '24h': 24 * 3600e3 };

@Injectable()
export class SessionService {
  private readonly base: CookieOptions = { httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, path: '/' };

  sign(payload: TokenPayload, ttl: string) {
    return jwt.sign(payload, config.keys.jwt, { expiresIn: ttl as jwt.SignOptions['expiresIn'], issuer: 'mc2026', algorithm: 'HS256' });
  }

  verify(token: string): TokenPayload | null {
    try { return jwt.verify(token, config.keys.jwt, { issuer: 'mc2026', algorithms: ['HS256'] }) as TokenPayload; } catch { return null; }
  }

  set(res: Response, name: string, payload: TokenPayload, ttl: string) {
    res.cookie(name, this.sign(payload, ttl), { ...this.base, maxAge: TTL_MS[ttl] });
  }

  clear(res: Response, name: string) { res.clearCookie(name, this.base); }

  read(req: Request, name: string, typ: TokenType): TokenPayload | null {
    const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const candidates = [bearer, req.cookies?.[name]].filter(Boolean) as string[];
    for (const t of candidates) {
      const p = this.verify(t);
      if (p && p.typ === typ) return p;
    }
    return null;
  }

  /** Token version: last chars of the password hash — a password change revokes all sessions. */
  static tokenVersion(passwordHash: string) { return passwordHash.slice(-8); }

  static displayKeyVersion(key: string) { return createHash('sha256').update(key).digest('hex'); }
}
