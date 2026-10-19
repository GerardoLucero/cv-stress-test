import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { InterviewStateError, LIMITS, clientIp, rateLimit } from '@/sdk'

/** Every interview call can burn model tokens, so each route is capped per IP. */
export async function guard<S extends z.ZodTypeAny>(
  req: NextRequest,
  route: string,
  limit: { max: number; windowMs: number },
  schema: S
): Promise<{ data: z.infer<S> } | { response: NextResponse }> {
  const length = Number(req.headers.get('content-length') ?? 0)
  if (length > LIMITS.maxBodyBytes + LIMITS.maxTokenChars) {
    return { response: NextResponse.json({ error: 'La solicitud es demasiado grande.' }, { status: 413 }) }
  }

  const rl = rateLimit(`${route}:${clientIp(req)}`, limit.max, limit.windowMs)
  if (!rl.ok) {
    return {
      response: NextResponse.json(
        { error: 'Demasiadas solicitudes. Intenta de nuevo más tarde.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
      ),
    }
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return { response: NextResponse.json({ error: 'El cuerpo debe ser JSON válido.' }, { status: 400 }) }
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Solicitud inválida.'
    return { response: NextResponse.json({ error: message }, { status: 400 }) }
  }
  return { data: parsed.data }
}

/** Never leak provider or internal error text to the client; it can quote the CV. */
export function failure(route: string, error: unknown, fallback: string): NextResponse {
  if (error instanceof InterviewStateError) {
    return NextResponse.json({ error: error.message }, { status: 409 })
  }
  console.error(`[${route}]`, error instanceof Error ? error.message.slice(0, 200) : 'unknown error')
  return NextResponse.json({ error: fallback }, { status: 500 })
}
