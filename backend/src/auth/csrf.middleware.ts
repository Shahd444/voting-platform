import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * CSRF defence-in-depth on top of SameSite=Strict cookies: every state-changing
 * API call must carry a custom header, which cross-site forms cannot set.
 */
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('x-requested-with') !== 'mc2026') {
      res.status(403).json({ error: 'csrf', message: 'Missing CSRF header.' });
      return;
    }
    next();
  }
}
