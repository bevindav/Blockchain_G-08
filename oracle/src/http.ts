import type { Request, Response, NextFunction } from 'express';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Rate limiter sederhana per IP (in-memory) untuk endpoint publik. */
export function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) hits.set(key, { n: 1, reset: now + windowMs });
    else if (++h.n > max) return res.status(429).json({ error: 'Terlalu banyak permintaan, coba lagi sebentar' });
    next();
  };
}

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  const status = err instanceof HttpError ? err.status : err?.type === 'entity.too.large' ? 413 : err?.code === 'LIMIT_FILE_SIZE' ? 413 : 500;
  if (status === 500) console.error('[api]', err);
  res.status(status).json({ error: status === 500 ? `Kesalahan server: ${err?.shortMessage || err?.message || err}` : err.message });
}
