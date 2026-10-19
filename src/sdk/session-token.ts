/**
 * Stateless sessions. The server keeps nothing: the whole session travels to the
 * client as an AES-256-GCM sealed token and comes back on every turn. The client
 * cannot read or alter it, nothing is stored, and there is no id to enumerate.
 * Server-only (node:crypto).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { InterviewSession } from './types'

const TTL_MS = 2 * 60 * 60 * 1000
const VERSION = 'v1'

// Dev only. Next compiles each route into its own bundle, so a random per-process
// secret would differ between /init and /answer. Production refuses to start without SESSION_SECRET.
const DEV_SECRET = 'dev-only-secret-never-used-in-production-0123456789'

function key(): Buffer {
  let secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SESSION_SECRET (min 32 chars) is required in production.')
    }
    secret = DEV_SECRET
  }
  return createHash('sha256').update(secret).digest()
}

export function sealSession(session: InterviewSession): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const payload = JSON.stringify({ exp: Date.now() + TTL_MS, session })
  const body = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()])
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.')
}

/** Returns the session, or null when the token is malformed, tampered with or expired. */
export function openSession(token: string): InterviewSession | null {
  try {
    const [version, iv, tag, body] = token.split('.')
    if (version !== VERSION || !iv || !tag || !body) return null
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    const plain = Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8')
    const { exp, session } = JSON.parse(plain) as { exp: number; session: InterviewSession }
    return Date.now() > exp ? null : session
  } catch {
    return null
  }
}
