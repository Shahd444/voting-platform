import { HttpException } from '@nestjs/common';

/**
 * Domain error with a stable machine-readable code. Every API error has the
 * shape { error, message, ...extra } so the front-end can react to `error`.
 */
export class AppError extends HttpException {
  constructor(status: number, code: string, message?: string, extra?: Record<string, unknown>) {
    super({ error: code, message: message || code, ...(extra || {}) }, status);
  }
}
