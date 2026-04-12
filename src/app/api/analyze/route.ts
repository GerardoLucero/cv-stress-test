import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { generateManagers, runManager, synthesizeResults } from '@/lib/analyzer'

export const maxDuration = 120

export async function POST(request: Request) {
  const body = await request.json() as { cv: string; jobDescription: string; n?: number }
  const { cv, jobDescription } = body

  if (!cv?.trim() || !jobDescription?.trim()) {
    return NextResponse.json({ error: 'cv and jobDescription are required' }, { status: 400 })
  }

  const n = Math.min(Math.max(body.n ?? 10, 3), 20)
  const id = `analysis-${Date.now()}`
  const start = Date.now()

  // Extract role from job description (first line or first sentence)
  const role = jobDescription.split('\n')[0].slice(0, 100)

  await prisma.analysis.create({
    data: { id, cv, jobDescription, role, n, status: 'running' },
  })

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

    await prisma.reaction.createMany({
      data: reactions.map(r => ({
        analysisId: id, index: r.index,
        profile: JSON.stringify(r.profile),
        wouldAdvance: r.wouldAdvance,
        reaction: r.reaction,
        concerns: JSON.stringify(r.concerns),
        positives: JSON.stringify(r.positives),
        tokens: r.tokens, durationMs: r.durationMs,
        error: r.error ?? '',
      })),
    })

    await prisma.analysis.update({
      where: { id },
      data: { status: 'done', advanceRate: result.advanceRate, result: JSON.stringify(result), totalTokens, durationMs: Date.now() - start },
    })

    return NextResponse.json({ id, result, totalTokens, durationMs: Date.now() - start })
  } catch (err) {
    await prisma.analysis.update({ where: { id }, data: { status: 'error' } })
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')

  if (id) {
    const analysis = await prisma.analysis.findUnique({
      where: { id },
      include: { reactions: { orderBy: { index: 'asc' } } },
    })
    if (!analysis) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json(analysis)
  }

  const recent = await prisma.analysis.findMany({
    orderBy: { createdAt: 'desc' }, take: 10,
    select: { id: true, role: true, n: true, advanceRate: true, status: true, createdAt: true },
  })
  return NextResponse.json(recent)
}
