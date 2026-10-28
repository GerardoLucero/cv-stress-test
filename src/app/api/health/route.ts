import { NextResponse } from 'next/server'
import { getModelConfig } from '@/sdk/model-config'

export const dynamic = 'force-dynamic'

/** Cheap liveness check for uptime monitors: no model call, no secrets in the reply. */
export async function GET() {
  const providers = {
    groq: Boolean(process.env.GROQ_API_KEY),
    nim: Boolean(process.env.NVIDIA_NIM_API_KEY || process.env.NVIDIA_API_KEY),
  }
  const ok = (providers.groq || providers.nim) && Boolean(process.env.SESSION_SECRET)
  const models = await getModelConfig()
  return NextResponse.json({ status: ok ? 'ok' : 'degraded', providers, models }, { status: ok ? 200 : 503 })
}
