import { afterEach, describe, expect, it, vi } from 'vitest'
import { notifyUse } from './notify'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const headers = new Headers({ 'x-vercel-ip-city': 'Guadalajara', 'x-vercel-ip-country': 'MX', 'x-forwarded-for': '203.0.113.9' })

describe('notifyUse', () => {
  it('does nothing without a topic', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('NTFY_TOPIC', '')
    await notifyUse('interview', headers)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends the kind and the place, and never the IP', async () => {
    const fetchMock = vi.fn(async () => new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('NTFY_TOPIC', 'secret-topic')
    vi.stubEnv('NTFY_EMAIL', 'me@example.com')

    await notifyUse('interview', headers, '4 preguntas')

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://ntfy.sh/secret-topic')
    expect((init.headers as Record<string, string>).Email).toBe('me@example.com')
    expect(init.body).toBe('Guadalajara, MX | 4 preguntas')
    expect(String(init.body)).not.toContain('203.0.113.9')
  })

  it('swallows network failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    vi.stubEnv('NTFY_TOPIC', 'secret-topic')
    await expect(notifyUse('stress-test', headers)).resolves.toBeUndefined()
  })
})
