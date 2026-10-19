import { NextRequest, NextResponse } from 'next/server'
import { AIInterviewer, finalizeBodySchema, openSession, sealSession } from '@/sdk'
import { failure, guard } from '../_guard'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const checked = await guard(req, 'interview-finalize', { max: 10, windowMs: 60 * 60 * 1000 }, finalizeBodySchema)
  if ('response' in checked) return checked.response

  const session = openSession(checked.data.token)
  if (!session) {
    return NextResponse.json({ error: 'La sesión expiró o no es válida. Inicia una nueva.' }, { status: 401 })
  }

  try {
    const result = await new AIInterviewer().finalizeSession(session)
    return NextResponse.json({ scorecard: result.scorecard, session: result.session, token: sealSession(result.session) })
  } catch (error) {
    return failure('interview/finalize', error, 'No se pudo generar el scorecard. Intenta de nuevo.')
  }
}
