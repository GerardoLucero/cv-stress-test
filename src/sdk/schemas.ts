/**
 * Validation schemas: request bodies (what the client may send) and LLM output
 * (what the model may answer). A model reply is untrusted input, so it is parsed
 * and clamped here instead of being cast with `as T`.
 */
import { z } from 'zod'
import { PERSONA_IDS } from './personas'

import { LIMITS } from './limits'
export { LIMITS }

const score = z.coerce
  .number()
  .transform((n) => (Number.isFinite(n) ? Math.round(Math.min(100, Math.max(0, n))) : 0))

const text = (max: number) => z.string().trim().max(max)
const textList = z.array(z.string().trim().max(400)).max(10).default([])

// ─── Request bodies ───────────────────────────────────────────────────────────

// ─── Interviewer personas ─────────────────────────────────────────────────────

const PITCH = { male: 0.9, female: 1.1, neutral: 1.0 } as const
const RATE = { slow: 0.95, normal: 1.05, fast: 1.15 } as const

/** What the model writes for one interviewer. Voice numbers are derived, never trusted from the model. */
const generatedPersonaSchema = z.object({
  name: text(80).min(2),
  role: text(120).min(2),
  company: text(120).min(2),
  difficulty: z.enum(['junior', 'mid', 'senior', 'staff']).catch('senior'),
  bias: text(300).min(10),
  tone: text(300).min(5),
  focusAreas: z.array(text(60).min(2)).min(2).max(5),
  openingAngle: text(400).min(10),
  gender: z.enum(['male', 'female', 'neutral']).catch('neutral'),
  pace: z.enum(['slow', 'normal', 'fast']).catch('normal'),
})

export const generatedPersonasSchema = z.object({
  personas: z.array(generatedPersonaSchema).min(2).max(4),
})

/** Same shape the SDK uses everywhere; `id` and the voice are filled in by the server. */
export function toPersona(p: z.infer<typeof generatedPersonaSchema>, id: string) {
  return {
    id,
    name: p.name,
    role: p.role,
    company: p.company,
    difficulty: p.difficulty,
    bias: p.bias,
    tone: p.tone,
    focusAreas: p.focusAreas,
    openingAngle: p.openingAngle,
    voiceConfig: { pitch: PITCH[p.gender], rate: RATE[p.pace], lang: 'es-MX', gender: p.gender },
  }
}

/** A persona sent back by the client (it came from /personas). Re-validated: the client is not trusted. */
export const customPersonaSchema = z.object({
  id: z.string().regex(/^dyn-[a-z0-9-]{1,40}$/),
  name: text(80).min(2),
  role: text(120).min(2),
  company: text(120).min(2),
  difficulty: z.enum(['junior', 'mid', 'senior', 'staff']),
  bias: text(300).min(10),
  tone: text(300).min(5),
  focusAreas: z.array(text(60).min(2)).min(2).max(5),
  openingAngle: text(400).optional(),
  voiceConfig: z.object({
    pitch: z.number().min(0.5).max(2),
    rate: z.number().min(0.5).max(2),
    lang: z.string().max(10),
    gender: z.enum(['male', 'female', 'neutral']),
  }),
})

export const personasBodySchema = z.object({
  cv: text(LIMITS.cv).min(50, 'El CV es demasiado corto.'),
  jobDescription: text(LIMITS.jobDescription).min(20, 'La descripción del puesto es demasiado corta.'),
})

export const initBodySchema = z.object({
  cv: text(LIMITS.cv).min(50, 'El CV es demasiado corto.'),
  jobDescription: text(LIMITS.jobDescription).min(20, 'La descripción del puesto es demasiado corta.'),
  targetRole: text(LIMITS.targetRole).optional(),
  personaId: z.enum(PERSONA_IDS as [string, ...string[]]).default('staff-architect'),
  // A generated interviewer takes precedence over personaId.
  persona: customPersonaSchema.optional(),
  totalQuestions: z.coerce
    .number()
    .int()
    .min(LIMITS.minQuestions)
    .max(LIMITS.maxQuestions)
    .default(4),
  intensity: z.enum(['practice', 'realistic', 'demanding']).default('practice'),
})

export const answerBodySchema = z.object({
  token: z.string().min(20).max(LIMITS.maxTokenChars),
  answer: text(LIMITS.answer).min(1, 'La respuesta está vacía.'),
})

export const finalizeBodySchema = z.object({
  token: z.string().min(20).max(LIMITS.maxTokenChars),
})

// ─── LLM output ───────────────────────────────────────────────────────────────

const starLevel = z.enum(['present', 'partial', 'missing']).catch('partial')

export const openingSchema = z.object({
  openingQuestion: z.string().trim().min(10).max(1_000),
})

export const turnEvaluationSchema = z.object({
  score,
  starAssessment: z
    .object({ situation: starLevel, task: starLevel, action: starLevel, result: starLevel })
    .default({ situation: 'partial', task: 'partial', action: 'partial', result: 'partial' }),
  strengths: textList,
  gaps: textList,
  quickFeedback: z.string().trim().max(600).default('Respuesta registrada.'),
  // The model sometimes answers the string "null" on the last round.
  nextQuestion: z
    .string()
    .nullable()
    .optional()
    .transform((q) => {
      const v = q?.trim()
      return v && v.toLowerCase() !== 'null' ? v.slice(0, 1_000) : null
    }),
  nextQuestionRationale: z.string().trim().max(600).default(''),
})

export const scorecardSchema = z.object({
  overallScore: score,
  hiringDecision: z.enum(['STRONG_HIRE', 'HIRE', 'LEAN_NO', 'NO_HIRE']),
  verdictOneLiner: z.string().trim().min(1).max(400),
  summary: z.string().trim().min(1).max(4_000),
  radarScores: z.object({
    technicalAccuracy: score,
    starMethodology: score,
    problemSolving: score,
    communicationClarity: score,
    leadershipOwnership: score,
  }),
  topStrengths: textList,
  criticalGaps: textList,
  recommendedActions: textList,
  cvAdjustments: z
    .array(z.object({ section: z.string().trim().max(200), suggestedFix: z.string().trim().max(800) }))
    .max(10)
    .default([]),
})
