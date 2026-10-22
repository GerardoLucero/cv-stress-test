import { NextRequest, NextResponse } from 'next/server'
import { AIInterviewer, initBodySchema, sealSession } from '@/sdk'
import { failure, guard } from '../_guard'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const checked = await guard(req, 'interview-init', { max: 5, windowMs: 60 * 60 * 1000 }, initBodySchema)
  if ('response' in checked) return checked.response
  const { cv, jobDescription, targetRole, personaId, persona, totalQuestions } = checked.data

  try {
    const session = await new AIInterviewer().startSession(
      { cv, jobDescription, targetRole },
      persona ?? personaId,
      totalQuestions
    )
    return NextResponse.json({ session, token: sealSession(session) })
  } catch (error) {
    return failure('interview/init', error, 'No se pudo iniciar la entrevista. Intenta de nuevo.')
  }
}
