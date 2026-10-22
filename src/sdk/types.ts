/**
 * AI Interviewer SDK - Core Types
 * Open source & reusable multi-agent interview engine
 */

export type InterviewerDifficulty = 'junior' | 'mid' | 'senior' | 'staff'

export type HiringDecision = 'STRONG_HIRE' | 'HIRE' | 'LEAN_NO' | 'NO_HIRE'

export interface CandidateInput {
  cv: string
  jobDescription: string
  targetRole?: string
  yearsExperience?: number
}

export interface InterviewerPersona {
  id: string
  name: string
  role: string
  company: string
  bias: string
  tone: string
  difficulty: InterviewerDifficulty
  focusAreas: string[]
  /** Where this interviewer opens: keeps the first question distinct per persona. */
  openingAngle?: string
  voiceConfig: {
    pitch: number
    rate: number
    lang: string
    gender: 'male' | 'female' | 'neutral'
  }
}

export interface TurnEvaluation {
  score: number // 0-100
  starAssessment: {
    situation: 'present' | 'partial' | 'missing'
    task: 'present' | 'partial' | 'missing'
    action: 'present' | 'partial' | 'missing'
    result: 'present' | 'partial' | 'missing'
  }
  strengths: string[]
  gaps: string[]
  quickFeedback: string
  nextQuestionRationale: string
}

export interface InterviewTurn {
  turnNumber: number
  question: string
  candidateAnswer?: string
  answeredAt?: string
  latencyMs?: number
  evaluation?: TurnEvaluation
}

export interface RadarScores {
  technicalAccuracy: number // 0-100
  starMethodology: number // 0-100
  problemSolving: number // 0-100
  communicationClarity: number // 0-100
  leadershipOwnership: number // 0-100
}

export interface FinalScorecard {
  overallScore: number // 0-100
  hiringDecision: HiringDecision
  verdictOneLiner: string
  summary: string
  radarScores: RadarScores
  topStrengths: string[]
  criticalGaps: string[]
  recommendedActions: string[]
  cvAdjustments: Array<{
    section: string
    suggestedFix: string
  }>
}

export interface InterviewSession {
  id: string
  createdAt: string
  updatedAt: string
  status: 'created' | 'in_progress' | 'completed' | 'abandoned'
  candidate: CandidateInput
  persona: InterviewerPersona
  totalQuestions: number
  turns: InterviewTurn[]
  currentQuestion: string
  finalScorecard?: FinalScorecard
}

export interface SDKConfig {
  provider?: 'nvidia' | 'groq' | 'auto'
  nvidiaApiKey?: string
  groqApiKey?: string
  nvidiaModel?: string
  groqModel?: string
  supabaseUrl?: string
  supabaseKey?: string
}
