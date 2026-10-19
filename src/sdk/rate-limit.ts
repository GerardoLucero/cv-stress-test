/**
 * Best-effort fixed-window limiter, per server instance. On serverless every
 * warm instance counts on its own, so this blunts a script hammering one
 * instance but is NOT a global quota. A shared store (Upstash) or the Vercel
 * Firewall is what enforces a real limit across instances.
 */
const windows = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(key: string, max: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now()
  if (windows.size > 5_000) {
    for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k)
  }
  const w = windows.get(key)
  if (!w || w.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true, retryAfterSec: 0 }
  }
  w.count += 1
  return { ok: w.count <= max, retryAfterSec: Math.ceil((w.resetAt - now) / 1000) }
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  return fwd?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
}
