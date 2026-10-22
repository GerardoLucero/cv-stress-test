import { CandidateInput, InterviewerPersona } from './types'
import { ModelProvider } from './model-provider'
import { AVATARS, generatedPersonasSchema, toPersona } from './schemas'
import { fence } from './engine'

/**
 * Proposes interviewers tailored to the role instead of the fixed presets: who would
 * really sit across the table for this job, each with a different angle of attack.
 */
export async function generatePersonas(
  candidate: CandidateInput,
  count = 3,
  model: ModelProvider = new ModelProvider()
): Promise<InterviewerPersona[]> {
  const systemPrompt = `Diseñas entrevistadores realistas para una entrevista de trabajo en español.
Dado un puesto y un CV, propón ${count} entrevistadores distintos que de verdad participarían en el proceso de contratación de ese puesto, en esa industria.

Reglas:
- Cada uno con una función distinta (por ejemplo: líder técnico, líder de área, persona de talento, par del equipo, responsable de seguridad o de producto según el puesto).
- Nombres variados y verosímiles. Empresas descritas por industria y etapa, sin marcas reales.
- "bias": lo que evalúa con más dureza. "tone": cómo habla. "difficulty": junior, mid, senior o staff según el nivel del puesto.
- "openingAngle": el ángulo por el que abre la entrevista; debe ser DISTINTO en cada entrevistador (arquitectura, liderazgo, velocidad, narrativa del CV, seguridad, negocio...).
- "avatar": un emoji de esta lista: ${AVATARS.join(' ')}
- "gender": male, female o neutral. "pace": slow, normal o fast.
- "focusAreas": 2 a 5 temas cortos.

Devuelve ÚNICAMENTE JSON:
{"personas":[{"name":"","role":"","company":"","avatar":"","difficulty":"senior","bias":"","tone":"","focusAreas":[""],"openingAngle":"","gender":"female","pace":"normal"}]}`

  const userPrompt = `${fence('job_description', candidate.jobDescription, 1500)}

${fence('cv', candidate.cv, 2000)}

Propón los ${count} entrevistadores.`

  const { data } = await model.generateJson(
    { systemPrompt, messages: [{ role: 'user', content: userPrompt }], temperature: 0.7, maxTokens: 3500, timeoutMs: 40000 },
    generatedPersonasSchema
  )

  return data.personas.slice(0, count).map((p, i) => toPersona(p, `dyn-${i + 1}`))
}
