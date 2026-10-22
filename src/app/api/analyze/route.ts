import { createGroq } from '@ai-sdk/groq'
import { generateText } from 'ai'
import { z } from 'zod'
import { GROQ_MODEL as MODEL, GROQ_PROVIDER_OPTIONS } from '@/lib/groq-model'
import { generateManagers, runManager, synthesizeResults } from '@/lib/analyzer'
import type { ManagerReaction } from '@/lib/analyzer'

export const maxDuration = 120

// Groq free tier — no credit card required. Get key at console.groq.com
const groq = createGroq({ apiKey: process.env.GROQ_API_KEY })

// ─── Pre-flight agent decision ────────────────────────────────────────────────
// One lightweight LLM call validates inputs AND extracts role/industry.
// This IS the "agent decides" step — if invalid, we skip all N manager calls.
// Costs ~300 tokens. Prevents wasting the full budget on garbage inputs.

const ValidationSchema = z.object({
  isValid: z.boolean(),
  role: z.string().describe('Job role detected from the JD'),
  industry: z.string().describe('Industry detected from the JD'),
  reason: z.string().optional().describe('If invalid, why'),
})

async function validateAndExtract(cv: string, jd: string): Promise<{
  isValid: boolean; role: string; industry: string; reason?: string
}> {
  try {
    const { text } = await generateText({
      model: groq(MODEL),
      system: 'You are a pre-flight validator. Return only valid JSON, no markdown.',
      prompt: `Validate these inputs and extract role/industry.

CV (first 400 chars): ${cv.slice(0, 400)}
JD (first 200 chars): ${jd.slice(0, 200)}

isValid: false ONLY if CV is empty/lorem ipsum OR JD is not a job description.
Real CVs with any work experience → isValid: true.

Return JSON only: {"isValid":true,"role":"Detected role","industry":"Detected industry","reason":"If invalid, why"}`,
      maxOutputTokens: 1000,
      providerOptions: GROQ_PROVIDER_OPTIONS,
    })
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    return ValidationSchema.parse(JSON.parse(clean))
  } catch {
    return { isValid: true, role: 'Professional', industry: 'General' }
  }
}

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
  const body = await request.json() as { cv: string; jobDescription: string; n?: number }
  const { cv, jobDescription } = body

  if (!cv?.trim() || !jobDescription?.trim()) {
    return new Response(
      JSON.stringify({ error: 'cv and jobDescription are required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const n = Math.min(Math.max(body.n ?? 5, 3), 7)
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
        const firstError = reactions.find(r => r.error)?.error ?? ''
        const warning = failRate > 0.4
          ? `${reactions.length - successful.length}/${reactions.length} managers failed. Error: ${firstError.slice(0, 200)}`
          : undefined

        const result = await synthesizeResults(cv, jobDescription, successful)
        const totalTokens = reactions.reduce((s, r) => s + (r?.tokens ?? 0), 0)

        emit({ type: 'complete', result, reactions, totalTokens, durationMs: Date.now() - start, warning })
        close()
      } catch (err) {
        console.error('[analyze] error', { error: String(err), n, durationMs: Date.now() - start })
        emit({ type: 'error', error: String(err) })
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
