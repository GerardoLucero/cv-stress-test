/**
 * Validation schemas: request bodies (what the client may send) and LLM output
 * (what the model may answer). A model reply is untrusted input, so it is parsed
 * and clamped here instead of being cast with `as T`.
 */
import { z } from 'zod'
import { PERSONA_IDS } from './personas'

export const LIMITS = {
  cv: 20_000,
  jobDescription: 5_000,
  targetRole: 120,
  answer: 4_000,
  minQuestions: 1,
  maxQuestions: 8,
  maxBodyBytes: 100_000,
  // Session token carries the CV and every turn, so it gets a larger cap.
  maxTokenChars: 160_000,
} as const

const score = z.coerce
  .number()
  .transform((n) => (Number.isFinite(n) ? Math.round(Math.min(100, Math.max(0, n))) : 0))

const text = (max: number) => z.string().trim().max(max)
const textList = z.array(z.string().trim().max(400)).max(10).default([])

// ─── Request bodies ───────────────────────────────────────────────────────────

export const initBodySchema = z.object({
  cv: text(LIMITS.cv).min(50, 'El CV es demasiado corto.'),
  jobDescription: text(LIMITS.jobDescription).min(20, 'La descripción del puesto es demasiado corta.'),
  targetRole: text(LIMITS.targetRole).optional(),
  personaId: z.enum(PERSONA_IDS as [string, ...string[]]).default('staff-architect'),
  totalQuestions: z.coerce
    .number()
    .int()
    .min(LIMITS.minQuestions)
    .max(LIMITS.maxQuestions)
    .default(4),
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
