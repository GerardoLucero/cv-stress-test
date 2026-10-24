import { afterEach, describe, expect, it, vi } from 'vitest'
import { clientIp, rateLimit } from './rate-limit'

afterEach(() => vi.useRealTimers())

describe('rateLimit', () => {
  it('blocks after max and reports retry-after', () => {
    expect(rateLimit('k1', 2, 1000).ok).toBe(true)
    expect(rateLimit('k1', 2, 1000).ok).toBe(true)
    const third = rateLimit('k1', 2, 1000)
    expect(third.ok).toBe(false)
    expect(third.retryAfterSec).toBeGreaterThan(0)
  })

  it('keeps keys independent and resets after the window', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    rateLimit('a', 1, 1000)
    expect(rateLimit('a', 1, 1000).ok).toBe(false)
    expect(rateLimit('b', 1, 1000).ok).toBe(true)
    vi.advanceTimersByTime(1001)
    expect(rateLimit('a', 1, 1000).ok).toBe(true)
  })

  it('reads the first forwarded IP', () => {
    const req = new Request('http://x', { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } })
    expect(clientIp(req)).toBe('1.2.3.4')
  })
})
