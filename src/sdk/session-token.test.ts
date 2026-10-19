import { afterEach, describe, expect, it, vi } from 'vitest'
import { openSession, sealSession } from './session-token'
import { InterviewSession } from './types'
import { getPersona } from './personas'

const session: InterviewSession = {
  id: 'abc',
  createdAt: '2026-10-19T00:00:00.000Z',
  updatedAt: '2026-10-19T00:00:00.000Z',
  status: 'in_progress',
  candidate: { cv: 'cv', jobDescription: 'jd' },
  persona: getPersona('staff-architect'),
  totalQuestions: 2,
  turns: [{ turnNumber: 1, question: '¿Por qué?' }],
  currentQuestion: '¿Por qué?',
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('session token', () => {
  it('round-trips a session', () => {
    expect(openSession(sealSession(session))).toEqual(session)
  })

  it('does not expose the CV in clear text', () => {
    const token = sealSession({ ...session, candidate: { cv: 'MI-CV-SECRETO-123', jobDescription: 'jd' } })
    expect(token).not.toContain('MI-CV-SECRETO-123')
    expect(Buffer.from(token.split('.')[3], 'base64url').toString()).not.toContain('MI-CV-SECRETO-123')
  })

  it('rejects a tampered token', () => {
    const token = sealSession(session)
    const [v, iv, tag, body] = token.split('.')
    const flipped = Buffer.from(body, 'base64url')
    flipped[0] ^= 1
    expect(openSession([v, iv, tag, flipped.toString('base64url')].join('.'))).toBeNull()
  })

  it('rejects garbage and wrong versions', () => {
    expect(openSession('')).toBeNull()
    expect(openSession('v1.a.b.c')).toBeNull()
    expect(openSession('v9.a.b.c')).toBeNull()
  })

  it('expires after two hours', () => {
    vi.useFakeTimers()
    const token = sealSession(session)
    vi.advanceTimersByTime(2 * 60 * 60 * 1000 + 1)
    expect(openSession(token)).toBeNull()
  })

  it('rejects a token sealed with a different secret', () => {
    vi.stubEnv('SESSION_SECRET', 'a'.repeat(40))
    const token = sealSession(session)
    vi.stubEnv('SESSION_SECRET', 'b'.repeat(40))
    expect(openSession(token)).toBeNull()
  })

  it('refuses to run in production without SESSION_SECRET', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('SESSION_SECRET', '')
    expect(() => sealSession(session)).toThrow(/SESSION_SECRET/)
  })
})
