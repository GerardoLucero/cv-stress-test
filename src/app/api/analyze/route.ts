import { after } from 'next/server'
import { notifyUse } from '@/lib/notify'
import { z } from 'zod'
import { LIMITS } from '@/sdk/limits'
import { clientIp, rateLimit } from '@/sdk/rate-limit'
import { generateManagers, runManager, synthesizeResults, validateAndExtract } from '@/lib/analyzer'
import type { ManagerReaction } from '@/lib/analyzer'

export const maxDuration = 120

// Each run is 1 + 1 + N + 1 model calls, so it is capped harder than the interview routes.
const RUNS_PER_WINDOW = 6
const WINDOW_MS = 30 * 60 * 1000

const BodySchema = z.object({
  cv: z.string().trim().min(1, 'cv and jobDescription are required'),
  jobDescription: z.string().trim().min(1, 'cv and jobDescription are required'),
  n: z.number().int().optional(),
})

const json = (body: object, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

// ─── Staggered parallel evaluation ───────────────────────────────────────────
// Managers start 600ms apart to stay within Groq 12K TPM free tier.
// Still streams results progressively as each manager completes.

async function runStaggered(
  managers: Parameters<typeof runManager>[0][],
  cv: string,
  jd: string,
  onProgress: (reaction: ManagerReaction, done: number, total: number) => void
): Promise<ManagerReaction[]> {
  const reactions: ManagerReaction[] = []
  let done = 0

  await Promise.allSettled(
    managers.map((m, i) =>
      new Promise<void>(resolve => setTimeout(resolve, i * 600))
        .then(() => runManager(m, i, cv, jd))
        .then(reaction => {
          reactions.push(reaction)
          done++
          onProgress(reaction, done, managers.length)
        })
    )
  )

  return reactions
}

export async function POST(request: Request) {
  const rl = rateLimit(`analyze:${clientIp(request)}`, RUNS_PER_WINDOW, WINDOW_MS)
  if (!rl.ok) {
    return json({ error: 'Demasiadas solicitudes. Intenta de nuevo más tarde.' }, 429, { 'Retry-After': String(rl.retryAfterSec) })
  }

  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > LIMITS.maxBodyBytes) return json({ error: 'La solicitud es demasiado grande.' }, 413)

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return json({ error: 'El cuerpo debe ser JSON válido.' }, 400)
  }
  const parsedBody = BodySchema.safeParse(raw)
  if (!parsedBody.success) return json({ error: parsedBody.error.issues[0]?.message ?? 'Solicitud inválida.' }, 400)
  const { cv, jobDescription } = parsedBody.data

  if (cv.length > LIMITS.cv || jobDescription.length > LIMITS.jobDescription) {
    return json({ error: `El CV admite hasta ${LIMITS.cv} caracteres y la vacante hasta ${LIMITS.jobDescription}.` }, 413)
  }

  const n = Math.min(Math.max(parsedBody.data.n ?? 5, 3), 7)
  after(() => notifyUse('stress-test', request.headers, `${n} reclutadores`))
  const start = Date.now()
  const encoder = new TextEncoder()
  let controllerClosed = false

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: object) => {
        if (controllerClosed) return
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }
      const close = () => {
        if (!controllerClosed) { controllerClosed = true; controller.close() }
      }

      try {
        // ── Agent decision: validate inputs before spending tokens ────────────
        const validation = await validateAndExtract(cv, jobDescription)
        if (!validation.isValid) {
          emit({ type: 'error', error: validation.reason ?? 'Please provide a real CV and job description.' })
          return close()
        }

        // ── Generate personas using role detected by the agent ────────────────
        const managers = await generateManagers(n, validation.role || jobDescription.slice(0, 300))

        // ── Staggered evaluation — emits SSE progress as each manager finishes ─
        const reactions = await runStaggered(managers, cv, jobDescription,
          (reaction, done, total) => emit({ type: 'progress', done, total, manager: reaction })
        )

        // ── Synthesize ───────────────────────────────────────────────────────
        const successful = reactions.filter(r => !r.error && r.reaction)
        const failRate = reactions.length > 0
          ? (reactions.length - successful.length) / reactions.length : 0
        if (successful.length === 0) {
          emit({ type: 'error', error: 'El servicio de IA no está disponible en este momento. Intenta de nuevo en unos minutos.' })
          return close()
        }

        const result = await synthesizeResults(cv, jobDescription, successful)
        const failedCount = reactions.length - successful.length
        const warning = result.degraded
          ? 'No se pudo generar la síntesis completa; solo se muestran las reacciones y la tasa de avance.'
          : failRate > 0.4
            ? `${failedCount}/${reactions.length} reclutadores no respondieron; el resultado puede ser menos representativo.`
            : undefined
        const totalTokens = reactions.reduce((s, r) => s + (r?.tokens ?? 0), 0) + (result.synthesisTokens ?? 0)

        emit({ type: 'complete', result, reactions, totalTokens, durationMs: Date.now() - start, warning })
        close()
      } catch (err) {
        console.error('[analyze] error', { error: err instanceof Error ? err.message.slice(0, 200) : 'unknown', n, durationMs: Date.now() - start })
        emit({ type: 'error', error: 'No se pudo completar el análisis. Intenta de nuevo.' })
        close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
