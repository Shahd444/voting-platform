import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { AppError } from './http-error';
import { AuditService } from '../core/audit.service';

const CODES: Record<number, string> = {
  400: 'bad_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found',
  409: 'conflict', 413: 'file_too_large', 429: 'rate_limited',
};

/** Normalises every error to { error, message } and never leaks stack traces. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('Errors');
  constructor(private readonly audit?: AuditService) {}

  async catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    if (res.headersSent) return;

    if (exception instanceof AppError) {
      const body = exception.getResponse() as { error?: string; access?: { mode?: string; geoReason?: string | null } };
      if (body.error === 'not_on_site') {
        await this.audit?.record('visitor', 'off_site_blocked', {
          route: req.path, mode: body.access?.mode, reason: body.access?.geoReason,
        }, req.ip || null);
      }
      return res.status(exception.getStatus()).json(exception.getResponse());
    }
    if (exception instanceof HttpException) {
      // ValidationPipe, multer and other built-in exceptions
      const status = exception.getStatus();
      const body = exception.getResponse() as any;
      let message = Array.isArray(body?.message) ? body.message[0] : body?.message || exception.message;
      if (status === 413) message = 'Image must be under 3 MB.';
      return res.status(status).json({ error: CODES[status] || 'error', message });
    }
    const err = exception as any;
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json', message: 'Invalid JSON' });
    this.log.error(`${req.method} ${req.url}: ${err?.stack || err}`);
    res.status(500).json({ error: 'server_error', message: 'Something went wrong. Please try again.' });
  }
}
