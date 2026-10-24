import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ModelProvider } from './model-provider'

const schema = z.object({ ok: z.boolean() })
const opts = { messages: [{ role: 'user' as const, content: 'hi' }] }
const reply = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })

afterEach(() => vi.unstubAllGlobals())

describe('ModelProvider', () => {
  it('tries the next Groq model in models.json when the first one is retired', async () => {
    vi.stubEnv('GROQ_MODEL', 'retired/model')
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      JSON.parse(String(init?.body)).model === 'retired/model' ? new Response('{}', { status: 404 }) : reply('{"ok":true}')
    )
    vi.stubGlobal('fetch', fetchMock)
    const provider = new ModelProvider({ groqApiKey: 'g', provider: 'groq' })

    const { meta } = await provider.generateJson(opts, schema)

    expect(meta.providerUsed).toBe('groq')
    expect(meta.modelUsed).toBe('openai/gpt-oss-120b')
    vi.unstubAllEnvs()
  })

  it('falls back to NVIDIA when Groq answers 404 (retired model)', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('groq.com') ? new Response('{}', { status: 404 }) : reply('{"ok":true}')
    )
    vi.stubGlobal('fetch', fetchMock)
    const provider = new ModelProvider({ groqApiKey: 'g', nvidiaApiKey: 'n' })

    const { data, meta } = await provider.generateJson(opts, schema)

    expect(data.ok).toBe(true)
    expect(meta.providerUsed).toBe('nvidia')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries on the other provider when the first reply is not valid JSON', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('groq.com') ? reply('not json') : reply('{"ok":true}')
    )
    vi.stubGlobal('fetch', fetchMock)
    const provider = new ModelProvider({ groqApiKey: 'g', nvidiaApiKey: 'n' })

    const { meta } = await provider.generateJson(opts, schema)

    expect(meta.providerUsed).toBe('nvidia')
  })

  it('retries once when every provider fails the first round', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => (++calls <= 1 ? new Response('{}', { status: 500 }) : reply('{"ok":true}'))))
    const provider = new ModelProvider({ nvidiaApiKey: 'n' })

    const { data } = await provider.generateJson(opts, schema)

    expect(data.ok).toBe(true)
    expect(calls).toBe(2)
  })

  it('gives up with an error when both rounds fail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    const provider = new ModelProvider({ nvidiaApiKey: 'n' })

    await expect(provider.generateJson(opts, schema)).rejects.toThrow()
  })

  it('requests the Groq model from GROQ_MODEL default, not the retired llama', async () => {
    const fetchMock = vi.fn(async () => reply('{"ok":true}'))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new ModelProvider({ groqApiKey: 'g' })

    await provider.generateJson(opts, schema)

    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body.model).toBe('openai/gpt-oss-120b')
    expect(body.model).not.toContain('llama-3.3')
  })
})
