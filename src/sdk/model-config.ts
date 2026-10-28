/**
 * Lista de modelos por proveedor, editable sin redesplegar.
 *
 * Fuente, en orden: `models.json` de la rama main en GitHub (cache de 5 min) y, si no
 * responde o no es valido, la copia empaquetada en el build. Cada proveedor lleva una
 * lista ordenada: si un modelo falla (por ejemplo 404 o 410 al retirarlo) se prueba el siguiente.
 * GROQ_MODEL / NVIDIA_MODEL se anteponen como anulacion de emergencia.
 */

import { z } from 'zod'
import bundled from '../../models.json'

const configSchema = z.object({
  groq: z.array(z.string().min(1).max(120)).min(1).max(5),
  nim: z.array(z.string().min(1).max(120)).min(1).max(5),
})

export type ModelConfig = z.infer<typeof configSchema>

const REMOTE_URL =
  process.env.MODEL_CONFIG_URL || 'https://raw.githubusercontent.com/GerardoLucero/cv-stress-test/main/models.json'
const TTL_MS = 5 * 60 * 1000
const FETCH_TIMEOUT_MS = 2000

let cache: { at: number; value: ModelConfig } | null = null

export function resetModelConfigCache(): void {
  cache = null
}

function bundledConfig(): ModelConfig {
  return configSchema.parse(bundled)
}

function withOverrides(base: ModelConfig): ModelConfig {
  const groq = process.env.GROQ_MODEL
  const nim = process.env.NVIDIA_MODEL
  return {
    groq: groq ? [groq, ...base.groq.filter((m) => m !== groq)] : base.groq,
    nim: nim ? [nim, ...base.nim.filter((m) => m !== nim)] : base.nim,
  }
}

export async function getModelConfig(fetchImpl: typeof fetch = fetch, now: () => number = Date.now): Promise<ModelConfig> {
  if (cache && now() - cache.at < TTL_MS) return withOverrides(cache.value)

  // En tests y con MODEL_CONFIG_URL=off solo se usa la copia empaquetada.
  if (process.env.NODE_ENV === 'test' || REMOTE_URL === 'off') return withOverrides(bundledConfig())

  try {
    const res = await fetchImpl(REMOTE_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const value = configSchema.parse(await res.json())
    cache = { at: now(), value }
    return withOverrides(value)
  } catch (err) {
    console.warn('[model-config] usando copia empaquetada:', err instanceof Error ? err.message.slice(0, 120) : 'error')
    // Se guarda la copia empaquetada un rato para no reintentar el fetch en cada request.
    cache = { at: now(), value: bundledConfig() }
    return withOverrides(cache.value)
  }
}
