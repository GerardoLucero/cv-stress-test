import { generateText, tool, stepCountIs } from 'ai'
import { z } from 'zod'
import { generateManagers, runManager, synthesizeResults } from '@/lib/analyzer'
import type { ManagerReaction, HiringManagerProfile } from '@/lib/analyzer'

export const maxDuration = 120

// AI Gateway model — routes automatically in production via VERCEL_OIDC_TOKEN (no rotation needed).
// Local dev: run `vercel env pull` once. Fallback: set AI_GATEWAY_API_KEY (requires manual rotation).
const MODEL = 'meta/llama-3.3-70b'

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

  // Shared state — tools mutate this as the agent progresses
  const state = {
    managers: [] as HiringManagerProfile[],
    reactions: [] as ManagerReaction[],
    progressDone: 0,
  }

  let controllerClosed = false

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: object) => {
        if (controllerClosed) return
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }
      const close = () => {
        if (!controllerClosed) {
          controllerClosed = true
          controller.close()
        }
      }

      try {
        // Agent orchestrator — decides validate → generate → evaluate → synthesize
        await generateText({
          model: MODEL,
          stopWhen: stepCountIs(8),
          system: `You are a CV evaluation orchestrator. Follow this exact sequence using the tools:
1. validate_inputs — always call this first to check if inputs are real content
2. If valid: call generate_managers to create evaluator personas
3. Call run_evaluations to evaluate the CV in parallel
4. Call synthesize to generate the final report
Do not skip steps. Call each tool exactly once.`,
          prompt: `N managers requested: ${n}
JD preview: ${jobDescription.slice(0, 300)}
CV preview: ${cv.slice(0, 300)}`,
          tools: {
            validate_inputs: tool({
              description: 'Validate that the CV and JD contain real content worth evaluating. Call this first.',
              inputSchema: z.object({
                is_valid: z.boolean().describe('True if CV has real work experience and JD describes a real role'),
                reason: z.string().optional().describe('If invalid, explain why (empty, lorem ipsum, not a real CV/JD)'),
              }),
              execute: async ({ is_valid, reason }) => {
                if (!is_valid) {
                  emit({ type: 'error', error: reason ?? 'CV or job description does not contain valid content' })
                  close()
                  return { ok: false }
                }
                return { ok: true }
              },
            }),

            generate_managers: tool({
              description: 'Generate N hiring manager personas matched to the role and industry.',
              inputSchema: z.object({
                n: z.number().describe('Number of managers to generate'),
                role: z.string().describe('Job role detected from the JD'),
              }),
              execute: async ({ n: managerN, role }) => {
                state.managers = await generateManagers(managerN, role)
                return { count: state.managers.length }
              },
            }),

            run_evaluations: tool({
              description: 'Run CV evaluations in parallel across all managers. Emits SSE progress events as each manager completes.',
              inputSchema: z.object({}),
              execute: async () => {
                const total = state.managers.length
                await Promise.allSettled(
                  state.managers.map((m, i) =>
                    runManager(m, i, cv, jobDescription).then(reaction => {
                      state.reactions.push(reaction)
                      state.progressDone++
                      emit({ type: 'progress', done: state.progressDone, total, manager: reaction })
                    })
                  )
                )
                const successful = state.reactions.filter(r => !r.error && r.reaction).length
                return { total, successful }
              },
            }),

            synthesize: tool({
              description: 'Synthesize all reactions into final analysis and emit the complete event.',
              inputSchema: z.object({}),
              execute: async () => {
                const successful = state.reactions.filter(r => !r.error && r.reaction)
                const failRate = state.reactions.length > 0
                  ? (state.reactions.length - successful.length) / state.reactions.length
                  : 0
                const warning = failRate > 0.4
                  ? `High demand — ${state.reactions.length - successful.length} of ${state.reactions.length} managers timed out. Try again in 30s.`
                  : undefined

                const result = await synthesizeResults(cv, jobDescription, successful)
                const totalTokens = state.reactions.reduce((s, r) => s + (r?.tokens ?? 0), 0)

                emit({ type: 'complete', result, reactions: state.reactions, totalTokens, durationMs: Date.now() - start, warning })
                close()
                return { done: true }
              },
            }),
          },
        })

        close()
      } catch (err) {
        console.error('[analyze] agent error', { error: String(err), n, durationMs: Date.now() - start })
        try {
          emit({ type: 'error', error: String(err) })
        } finally {
          close()
        }
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
