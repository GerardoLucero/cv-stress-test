import { NextRequest, NextResponse } from 'next/server'
import { AIInterviewer, answerBodySchema, openSession, sealSession } from '@/sdk'
import { failure, guard } from '../_guard'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const checked = await guard(req, 'interview-answer', { max: 40, windowMs: 60 * 60 * 1000 }, answerBodySchema)
  if ('response' in checked) return checked.response

  const session = openSession(checked.data.token)
  if (!session) {
    return NextResponse.json({ error: 'La sesión expiró o no es válida. Inicia una nueva.' }, { status: 401 })
  }

  try {
    const result = await new AIInterviewer().submitAnswer(session, checked.data.answer)
    return NextResponse.json({ ...result, token: sealSession(result.session) })
  } catch (error) {
    return failure('interview/answer', error, 'No se pudo procesar la respuesta. Intenta de nuevo.')
  }
}
