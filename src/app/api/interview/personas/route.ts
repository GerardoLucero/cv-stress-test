import { NextRequest, NextResponse } from 'next/server'
import { generatePersonas, personasBodySchema } from '@/sdk'
import { failure, guard } from '../_guard'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const checked = await guard(req, 'interview-personas', { max: 10, windowMs: 60 * 60 * 1000 }, personasBodySchema)
  if ('response' in checked) return checked.response
  const { cv, jobDescription } = checked.data

  try {
    const personas = await generatePersonas({ cv, jobDescription }, 3)
    return NextResponse.json({ personas })
  } catch (error) {
    return failure('interview/personas', error, 'No se pudieron generar entrevistadores. Usa uno de los predefinidos.')
  }
}
