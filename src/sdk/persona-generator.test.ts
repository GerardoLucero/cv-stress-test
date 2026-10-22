import { describe, expect, it } from 'vitest'
import { generatePersonas } from './persona-generator'
import { customPersonaSchema, generatedPersonasSchema } from './schemas'
import { ModelProvider } from './model-provider'

const raw = (over: Record<string, unknown> = {}) => ({
  name: 'Ana Ruiz',
  role: 'Head of Platform',
  company: 'Fintech en etapa de crecimiento',
  avatar: '🛡️',
  difficulty: 'staff',
  bias: 'Evalúa seguridad y confiabilidad con dureza.',
  tone: 'Directa y precisa.',
  focusAreas: ['Seguridad', 'SRE'],
  openingAngle: 'Abre por el incidente más grave que manejaste.',
  gender: 'female',
  pace: 'fast',
  ...over,
})

const fakeModel = (personas: unknown[]) =>
  ({ async generateJson(_o: unknown, schema: { parse: (v: unknown) => unknown }) {
    return { data: schema.parse({ personas }), meta: {} }
  } }) as unknown as ModelProvider

describe('generatePersonas', () => {
  it('assigns server ids and derives the voice from gender and pace', async () => {
    const out = await generatePersonas({ cv: 'cv', jobDescription: 'jd' }, 2, fakeModel([raw(), raw({ gender: 'male', pace: 'slow' })]))

    expect(out.map((p) => p.id)).toEqual(['dyn-1', 'dyn-2'])
    expect(out[0].voiceConfig).toEqual({ pitch: 1.1, rate: 1.15, lang: 'es-MX', gender: 'female' })
    expect(out[1].voiceConfig.pitch).toBe(0.9)
    expect(out[1].voiceConfig.rate).toBe(0.95)
  })

  it('falls back on bad avatar, gender and difficulty instead of failing', () => {
    const parsed = generatedPersonasSchema.parse({
      personas: [raw({ avatar: 'x'.repeat(50), gender: 'robot', difficulty: 'god' }), raw()],
    })
    expect(parsed.personas[0].gender).toBe('neutral')
    expect(parsed.personas[0].difficulty).toBe('senior')
  })

  it('rejects a persona with a missing name or too few focus areas', () => {
    expect(() => generatedPersonasSchema.parse({ personas: [raw({ name: '' }), raw()] })).toThrow()
    expect(() => generatedPersonasSchema.parse({ personas: [raw({ focusAreas: ['uno'] }), raw()] })).toThrow()
  })
})

describe('customPersonaSchema (client-supplied persona)', () => {
  const valid = {
    id: 'dyn-1', name: 'Ana Ruiz', role: 'Head', company: 'Fintech', avatar: '🛡️', difficulty: 'staff',
    bias: 'Evalúa seguridad con dureza.', tone: 'Directa', focusAreas: ['Seguridad', 'SRE'],
    voiceConfig: { pitch: 1, rate: 1, lang: 'es-MX', gender: 'female' },
  }

  it('accepts a persona returned by /personas', () => {
    expect(customPersonaSchema.parse(valid).id).toBe('dyn-1')
  })

  it('rejects ids that are not generated ones, oversized text and absurd voice values', () => {
    expect(() => customPersonaSchema.parse({ ...valid, id: 'staff-architect' })).toThrow()
    expect(() => customPersonaSchema.parse({ ...valid, bias: 'x'.repeat(5000) })).toThrow()
    expect(() => customPersonaSchema.parse({ ...valid, voiceConfig: { ...valid.voiceConfig, rate: 99 } })).toThrow()
  })
})
