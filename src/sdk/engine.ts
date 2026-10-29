import { randomUUID } from 'node:crypto'
import {
  CandidateInput,
  InterviewerPersona,
  EvaluationIntensity,
  FinalScorecard,
  HiringDecision,
  InterviewSession,
  InterviewTurn,
  TurnEvaluation,
} from './types'
import { getPersona } from './personas'
import { ModelProvider } from './model-provider'
import { openingSchema, scorecardSchema, turnEvaluationSchema } from './schemas'

/** A rule of the interview was broken (wrong state, nothing to evaluate). Routes map it to HTTP 409. */
export class InterviewStateError extends Error {}

/** Candidate text goes between tags; strip look-alike tags so it cannot close them early. */
export function fence(tag: 'cv' | 'job_description' | 'candidate_answer', value: string, max: number): string {
  const safe = value.slice(0, max).replace(/<\/?(cv|job_description|candidate_answer)\s*>/gi, '')
  return `<${tag}>\n${safe}\n</${tag}>`
}

/** Written anchors so a given score means the same thing on every run and in every mode. */
const SCORE_BANDS = `Anclas de puntaje (úsalas siempre):
- 0-19: sin respuesta, vacía o sin relación con la pregunta. No des crédito parcial.
- 20-39: respuesta evasiva o con errores importantes.
- 40-59: genérica, sin ejemplos propios ni detalle verificable.
- 60-74: sólida, con huecos (falta cifra, alternativa descartada o resultado).
- 75-89: buena, con ejemplos propios, decisiones justificadas y resultado.
- 90-100: sobresaliente, con evidencia concreta y trade-offs explícitos.`

const INTENSITY_GUIDE: Record<EvaluationIntensity, string> = {
  practice:
    'Modo práctica: actúa como mentor. Reconoce primero lo que está bien y después los huecos. Penaliza solo ausencias claras de contenido. El estilo o el idioma no restan si la sustancia es correcta.',
  realistic:
    'Modo realista: nivel de una entrevista real, equilibrado. Reconoce lo logrado y señala con claridad lo que faltó.',
  demanding:
    'Modo exigente: mantén la barra alta, cuestiona cada decisión y puntúa con rigor. Aun así, sé específico y justo.',
}

/** The decision follows the score, so score, radar and label cannot contradict each other. */
export function decisionFromScore(score: number): HiringDecision {
  if (score >= 85) return 'STRONG_HIRE'
  if (score >= 70) return 'HIRE'
  if (score >= 50) return 'LEAN_NO'
  return 'NO_HIRE'
}

/**
 * Stateless engine: every call takes the session and returns the updated one.
 * Persistence, if any, belongs to the caller (see session-token.ts).
 */
export class AIInterviewer {
  private model: ModelProvider

  constructor(options?: { modelProvider?: ModelProvider }) {
    this.model = options?.modelProvider ?? new ModelProvider()
  }

  /**
   * Initializes a new interview session, analyzing the CV and crafting the opening question.
   */
  async startSession(
    candidate: CandidateInput,
    personaOrId: string | InterviewerPersona = 'staff-architect',
    totalQuestions: number = 4,
    intensity: EvaluationIntensity = 'practice'
  ): Promise<InterviewSession> {
    const persona = typeof personaOrId === 'string' ? getPersona(personaOrId) : personaOrId
    const sessionId = randomUUID()

    const systemPrompt = `Eres ${persona.name}, ${persona.role} en ${persona.company}.
Dificultad de entrevista: ${persona.difficulty.toUpperCase()}.
Tu sesgo y enfoque: ${persona.bias}.
Tu tono de voz: ${persona.tone}.
Áreas clave de evaluación: ${persona.focusAreas.join(', ')}.${persona.openingAngle ? `\nÁngulo de apertura (obligatorio): ${persona.openingAngle}` : ''}

Misión:
Estás realizando una entrevista técnica/conductual real en vivo. No eres un chatbot genérico; actúas con rigor profesional.
Vas a evaluar el CV del candidato contra la descripción del puesto (Job Description) y le harás preguntas desafiantes una a una.
La primera pregunta debe basarse en algo específico que el candidato menciona en su CV y seguir tu ángulo de apertura, para verificar autenticidad y profundidad. No repitas la pregunta típica sobre el proyecto más llamativo si tu ángulo apunta a otra cosa.

Devuelve estrictamente un JSON con esta estructura:
{
  "openingQuestion": "La pregunta inicial que le harás al candidato en español",
  "openingRationale": "Por qué decidiste empezar con esta pregunta en particular",
  "detectedStrengths": ["fortaleza 1", "fortaleza 2"],
  "initialSuspicionOrRisk": "Qué punto del CV parece sospechoso, vago o riesgoso"
}`

    const userPrompt = `CANDIDATO CV:
${fence('cv', candidate.cv, 3000)}

JOB DESCRIPTION / ROL OBJETIVO:
${fence('job_description', candidate.jobDescription, 1000)}

Formula la primera pregunta de la entrevista.`

    const { data } = await this.model.generateJson(
      { systemPrompt, messages: [{ role: 'user', content: userPrompt }], temperature: 0.2 },
      openingSchema
    )

    const initialTurn: InterviewTurn = {
      turnNumber: 1,
      question: data.openingQuestion,
    }

    const session: InterviewSession = {
      id: sessionId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'in_progress',
      candidate,
      persona,
      totalQuestions,
      intensity,
      turns: [initialTurn],
      currentQuestion: data.openingQuestion,
    }

    return session
  }

  /**
   * Processes the candidate's answer, scores it in real time, and produces either the next question or finishes the interview.
   */
  async submitAnswer(
    session: InterviewSession,
    candidateAnswer: string
  ): Promise<{
    session: InterviewSession
    turnEvaluation: TurnEvaluation
    nextQuestion?: string
    isFinished: boolean
  }> {
    if (session.status !== 'in_progress') {
      throw new InterviewStateError('La entrevista ya terminó.')
    }
    const currentTurn = session.turns[session.turns.length - 1]
    if (!currentTurn || currentTurn.candidateAnswer !== undefined) {
      throw new InterviewStateError('Esta pregunta ya fue respondida.')
    }
    const persona = session.persona

    const intensity = session.intensity ?? 'practice'
    const systemPrompt = `Eres ${persona.name}, ${persona.role}.
Tu rol es evaluar con criterio justo y equilibrado la respuesta del candidato a la pregunta que le hiciste.
${INTENSITY_GUIDE[intensity]}
Usa la metodología STAR (Situación, Tarea, Acción, Resultado) solo si la pregunta es de comportamiento. Si es técnica o de diseño, evalúa precisión, trade-offs y claridad, y deja los campos de starAssessment en "partial".
Empieza por las fortalezas reales y después señala los huecos. En quickFeedback incluye qué faltó y cómo mejorarlo con un ejemplo breve.
${SCORE_BANDS}

Devuelve estrictamente un JSON con:
{
  "score": 0 a 100 número entero,
  "starAssessment": {
    "situation": "present" | "partial" | "missing",
    "task": "present" | "partial" | "missing",
    "action": "present" | "partial" | "missing",
    "result": "present" | "partial" | "missing"
  },
  "strengths": ["punto fuerte 1", "punto fuerte 2"],
  "gaps": ["debilidad o ambigüedad 1"],
  "quickFeedback": "Feedback constructivo inmediato en 1 o 2 oraciones directas",
  "nextQuestion": "La siguiente pregunta, relevante para el puesto; si la respuesta quedó incompleta, invita a completarla con un ejemplo (o null si es la última)",
  "nextQuestionRationale": "Por qué elegiste esta siguiente pregunta"
}`

    const userPrompt = `PREGUNTA REALIZADA:
"${currentTurn.question}"

RESPUESTA DEL CANDIDATO:
${fence('candidate_answer', candidateAnswer, 3000)}

CONTEXTO CV:
${fence('cv', session.candidate.cv, 1500)}

RONDA ACTUAL: Pregunta ${currentTurn.turnNumber} de ${session.totalQuestions}.
Si la ronda actual ya es ${session.totalQuestions}, pon "nextQuestion": null.`

    const { data } = await this.model.generateJson(
      { systemPrompt, messages: [{ role: 'user', content: userPrompt }], temperature: 0.2 },
      turnEvaluationSchema
    )

    const evaluation: TurnEvaluation = {
      score: data.score,
      starAssessment: data.starAssessment,
      strengths: data.strengths,
      gaps: data.gaps,
      quickFeedback: data.quickFeedback,
      nextQuestionRationale: data.nextQuestionRationale,
    }

    currentTurn.candidateAnswer = candidateAnswer
    currentTurn.answeredAt = new Date().toISOString()
    currentTurn.evaluation = evaluation

    const isFinished = session.turns.length >= session.totalQuestions || !data.nextQuestion

    if (!isFinished && data.nextQuestion) {
      const nextTurn: InterviewTurn = {
        turnNumber: session.turns.length + 1,
        question: data.nextQuestion,
      }
      session.turns.push(nextTurn)
      session.currentQuestion = data.nextQuestion
    } else {
      session.status = 'completed'
    }

    session.updatedAt = new Date().toISOString()

    return {
      session,
      turnEvaluation: evaluation,
      nextQuestion: isFinished ? undefined : data.nextQuestion ?? undefined,
      isFinished,
    }
  }

  /**
   * Finalizes the session and computes the comprehensive scorecard and hiring verdict.
   */
  async finalizeSession(
    session: InterviewSession
  ): Promise<{ session: InterviewSession; scorecard: FinalScorecard }> {
    // Idempotent: asking again returns the scorecard already produced.
    if (session.finalScorecard) return { session, scorecard: session.finalScorecard }
    if (!session.turns.some((t) => t.candidateAnswer !== undefined)) {
      throw new InterviewStateError('Responde al menos una pregunta antes de terminar.')
    }
    const persona = session.persona

    const systemPrompt = `Eres un Comité de Contratación presidido por ${persona.name} (${persona.role}). Evalúas con criterio justo y equilibrado.\n${INTENSITY_GUIDE[session.intensity ?? 'practice']}\n${SCORE_BANDS}
Han concluido una entrevista técnica de ${session.turns.length} preguntas.
Analiza la transcripción completa de la entrevista y emite un veredicto formal de contratación y scorecard detallado.

Devuelve estrictamente un JSON con:
{
  "overallScore": 0 a 100 número entero, promedio de tus puntajes por pregunta ajustado por las anclas,
  "hiringDecision": "STRONG_HIRE" | "HIRE" | "LEAN_NO" | "NO_HIRE",
  "verdictOneLiner": "Una sola frase clara y respetuosa resumiendo el resultado de la entrevista",
  "summary": "Resumen ejecutivo de 2 a 3 párrafos del desempeño del candidato",
  "radarScores": {
    "technicalAccuracy": 0 a 100,
    "starMethodology": 0 a 100,
    "problemSolving": 0 a 100,
    "communicationClarity": 0 a 100,
    "leadershipOwnership": 0 a 100
  },
  "topStrengths": ["fortaleza 1", "fortaleza 2", "fortaleza 3"],
  "criticalGaps": ["brecha crítica 1", "brecha crítica 2"],
  "recommendedActions": ["acción de estudio o práctica 1", "acción 2"],
  "cvAdjustments": [
    {
      "section": "ej. Experiencia en Empresa X",
      "suggestedFix": "Cómo modificar el CV para que refleje mejor lo que se discutió o corrija la debilidad"
    }
  ]
}`

    const interviewHistory = session.turns
      .map(
        (t) =>
          `[PREGUNTA ${t.turnNumber}]: ${t.question}\n[RESPUESTA]: ${t.candidateAnswer ? fence('candidate_answer', t.candidateAnswer, 3000) : 'Sin respuesta'}\n[SCORE RONDA]: ${t.evaluation?.score ?? 'N/A'}`
      )
      .join('\n\n')

    const userPrompt = `TRANSCRIPCIÓN COMPLETA DE LA ENTREVISTA:
${interviewHistory}

CV ORIGINAL:
${fence('cv', session.candidate.cv, 2000)}

Genera el Scorecard final.`

    const { data } = await this.model.generateJson(
      { systemPrompt, messages: [{ role: 'user', content: userPrompt }], temperature: 0.1, maxTokens: 4000, timeoutMs: 40000 },
      scorecardSchema
    )

    data.hiringDecision = decisionFromScore(data.overallScore)
    session.status = 'completed'
    session.finalScorecard = data
    session.updatedAt = new Date().toISOString()
    return { session, scorecard: data }
  }
}
