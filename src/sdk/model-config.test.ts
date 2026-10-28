import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getModelConfig, resetModelConfigCache } from './model-config'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('getModelConfig', () => {
  beforeEach(() => {
    resetModelConfigCache()
    vi.stubEnv('NODE_ENV', 'production')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('uses the remote list when valid and caches it', async () => {
    const f = vi.fn(async () => json({ groq: ['a/b'], nim: ['c/d', 'e/f'] }))
    const cfg = await getModelConfig(f as unknown as typeof fetch)
    expect(cfg).toEqual({ groq: ['a/b'], nim: ['c/d', 'e/f'] })
    await getModelConfig(f as unknown as typeof fetch)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('falls back to the bundled copy when the remote is down or invalid', async () => {
    const down = vi.fn(async () => json({}, 500))
    const bad = vi.fn(async () => json({ groq: [], nim: [] }))
    for (const f of [down, bad]) {
      resetModelConfigCache()
      const cfg = await getModelConfig(f as unknown as typeof fetch)
      expect(cfg.groq.length).toBeGreaterThan(0)
      expect(cfg.nim.length).toBeGreaterThan(0)
    }
  })

  it('puts the GROQ_MODEL env override first', async () => {
    vi.stubEnv('GROQ_MODEL', 'x/override')
    const f = vi.fn(async () => json({ groq: ['a/b'], nim: ['c/d'] }))
    const cfg = await getModelConfig(f as unknown as typeof fetch)
    expect(cfg.groq).toEqual(['x/override', 'a/b'])
  })
})
