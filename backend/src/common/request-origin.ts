import type { Request } from 'express';

/** Build the browser-facing origin from the request host, honoring trusted proxy protocol headers. */
export function requestOrigin(req: Request): string | undefined {
  const host = req.get('host');
  if (!host || /[\\/@\s]/.test(host)) return undefined;
  try {
    const url = new URL(`${req.protocol}://${host}`);
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : undefined;
  } catch {
    return undefined;
  }
}
