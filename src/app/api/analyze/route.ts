import { NextResponse } from 'next/server'
import { generateManagers, runManager, synthesizeResults } from '@/lib/analyzer'
import type { ManagerReaction, HiringManagerProfile } from '@/lib/analyzer'

export const maxDuration = 120

// Concurrency pool: run managers in chunks to respect Groq TPM limits
async function runConcurrent(
  managers: HiringManagerProfile[],
  cv: string,
  jobDescription: string,
  chunkSize = 3,
  delayMs = 2000
): Promise<PromiseSettledResult<ManagerReaction>[]> {
  const results: PromiseSettledResult<ManagerReaction>[] = []
  for (let i = 0; i < managers.length; i += chunkSize) {
    const chunk = managers.slice(i, i + chunkSize)
    const chunkResults = await Promise.allSettled(
      chunk.map((m, j) => runManager(m, i + j, cv, jobDescription))
    )
    results.push(...chunkResults)
    if (i + chunkSize < managers.length) {
      await new Promise(r => setTimeout(r, delayMs))
    }
  }
  return results
}

export async function POST(request: Request) {
  const body = await request.json() as { cv: string; jobDescription: string; n?: number }
  const { cv, jobDescription } = body

  if (!cv?.trim() || !jobDescription?.trim()) {
    return NextResponse.json({ error: 'cv and jobDescription are required' }, { status: 400 })
  }

  const n = Math.min(Math.max(body.n ?? 5, 3), 7)
  const start = Date.now()

  try {
    const managers = await generateManagers(n, jobDescription.slice(0, 500))

    const settled = await runConcurrent(managers, cv, jobDescription)

    const reactions = settled.map((r, i) =>
      r.status === 'fulfilled' ? r.value : {
        index: i, profile: managers[i], wouldAdvance: false,
        reaction: '', concerns: [], positives: [],
        tokens: 0, durationMs: 0,
        error: (r as PromiseRejectedResult).reason?.message ?? 'unknown error',
      }
    )

    const successful = reactions.filter(r => !r.error && r.reaction)
    const failRate = (reactions.length - successful.length) / reactions.length
    const warning = failRate > 0.4
      ? `High demand — ${reactions.length - successful.length} of ${reactions.length} managers timed out. Results may be partial. Try again in 30s.`
      : undefined

    const result = await synthesizeResults(cv, jobDescription, successful)
    const totalTokens = reactions.reduce((s, r) => s + r.tokens, 0)

    return NextResponse.json({ result, reactions, totalTokens, durationMs: Date.now() - start, warning })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
