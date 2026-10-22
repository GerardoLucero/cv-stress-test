// llama-3.3-70b-versatile and llama-3.1-8b-instant were shut down by Groq on 2026-08-16
// (HTTP 404). gpt-oss reasons before answering, so keep the effort low and the token
// budgets generous: reasoning tokens count against the output limit.
export const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b'
export const GROQ_PROVIDER_OPTIONS = { groq: { reasoningEffort: 'low' as const } }
