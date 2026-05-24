import { NextResponse } from 'next/server'
import { generateManagers, runManager, synthesizeResults } from '@/lib/analyzer'

export const maxDuration = 120

export async function POST(request: Request) {
  const body = await request.json() as { cv: string; jobDescription: string; n?: number }
  const { cv, jobDescription } = body

  if (!cv?.trim() || !jobDescription?.trim()) {
    return NextResponse.json({ error: 'cv and jobDescription are required' }, { status: 400 })
  }

  const n = Math.min(Math.max(body.n ?? 10, 3), 20)
  const start = Date.now()

  try {
    const managers = await generateManagers(n, jobDescription.slice(0, 500))

    const settled = await Promise.allSettled(
      managers.map((m, i) => runManager(m, i, cv, jobDescription))
    )

    const reactions = settled.map((r, i) =>
      r.status === 'fulfilled' ? r.value : {
        index: i, profile: managers[i], wouldAdvance: false,
        reaction: '', concerns: [], positives: [],
        tokens: 0, durationMs: 0,
        error: (r as PromiseRejectedResult).reason?.message ?? 'unknown error',
      }
    )

    const successful = reactions.filter(r => !r.error && r.reaction)
    const result = await synthesizeResults(cv, jobDescription, successful)
    const totalTokens = reactions.reduce((s, r) => s + r.tokens, 0)

    return NextResponse.json({ result, reactions, totalTokens, durationMs: Date.now() - start })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
