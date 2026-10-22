import { describe, expect, it } from 'vitest'
import { answerBodySchema, initBodySchema, scorecardSchema, turnEvaluationSchema } from './schemas'

const cv = 'x'.repeat(60)
const jd = 'y'.repeat(30)

describe('request schemas', () => {
  it('applies defaults', () => {
    const r = initBodySchema.parse({ cv, jobDescription: jd })
    expect(r.personaId).toBe('staff-architect')
    expect(r.totalQuestions).toBe(4)
  })

  it('rejects oversized input, unknown personas and absurd question counts', () => {
    expect(initBodySchema.safeParse({ cv: 'x'.repeat(20_001), jobDescription: jd }).success).toBe(false)
    expect(initBodySchema.safeParse({ cv, jobDescription: jd, personaId: 'evil' }).success).toBe(false)
    expect(initBodySchema.safeParse({ cv, jobDescription: jd, totalQuestions: 1000 }).success).toBe(false)
    expect(initBodySchema.safeParse({ cv, jobDescription: jd, totalQuestions: -1 }).success).toBe(false)
  })

  it('allows between 2 and 5 questions', () => {
    for (const n of [2, 3, 4, 5]) expect(initBodySchema.safeParse({ cv, jobDescription: jd, totalQuestions: n }).success).toBe(true)
    for (const n of [0, 1, 6, 8]) expect(initBodySchema.safeParse({ cv, jobDescription: jd, totalQuestions: n }).success).toBe(false)
  })

  it('rejects empty and oversized answers', () => {
    const token = 't'.repeat(40)
    expect(answerBodySchema.safeParse({ token, answer: '   ' }).success).toBe(false)
    expect(answerBodySchema.safeParse({ token, answer: 'a'.repeat(4_001) }).success).toBe(false)
  })
})

describe('LLM output schemas', () => {
  it('rounds and clamps scores, treating 0 as a real score', () => {
    expect(turnEvaluationSchema.parse({ score: 82.6 }).score).toBe(83)
    expect(turnEvaluationSchema.parse({ score: 250 }).score).toBe(100)
    expect(turnEvaluationSchema.parse({ score: 0 }).score).toBe(0)
    expect(turnEvaluationSchema.parse({ score: '71' }).score).toBe(71)
  })

  it('treats the string "null" as no next question', () => {
    expect(turnEvaluationSchema.parse({ score: 50, nextQuestion: 'null' }).nextQuestion).toBeNull()
    expect(turnEvaluationSchema.parse({ score: 50, nextQuestion: null }).nextQuestion).toBeNull()
    expect(turnEvaluationSchema.parse({ score: 50, nextQuestion: ' ¿Y luego? ' }).nextQuestion).toBe('¿Y luego?')
  })

  it('fills the STAR assessment when the model omits it or invents a level', () => {
    const r = turnEvaluationSchema.parse({ score: 50, starAssessment: { situation: 'great', task: 'present' } })
    expect(r.starAssessment).toEqual({ situation: 'partial', task: 'present', action: 'partial', result: 'partial' })
  })

  it('rejects a scorecard with an invalid verdict', () => {
    const base = {
      overallScore: 80,
      verdictOneLiner: 'ok',
      summary: 'ok',
      radarScores: { technicalAccuracy: 1, starMethodology: 1, problemSolving: 1, communicationClarity: 1, leadershipOwnership: 1 },
    }
    expect(scorecardSchema.safeParse({ ...base, hiringDecision: 'MAYBE' }).success).toBe(false)
    expect(scorecardSchema.safeParse({ ...base, hiringDecision: 'HIRE' }).success).toBe(true)
    expect(scorecardSchema.safeParse({ ...base, hiringDecision: 'HIRE', radarScores: undefined }).success).toBe(false)
  })
})
