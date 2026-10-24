import { getModelConfig } from '@/sdk/model-config'

// gpt-oss reasons before answering, so keep the effort low and the token budgets
// generous: reasoning tokens count against the output limit. The model name comes
// from models.json (see sdk/model-config.ts), so swapping it needs no deploy.
export async function getGroqModel(): Promise<string> {
  return (await getModelConfig()).groq[0]
}
export const GROQ_PROVIDER_OPTIONS = { groq: { reasoningEffort: 'low' as const } }
