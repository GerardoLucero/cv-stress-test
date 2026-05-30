import { generateText, Output } from 'ai'
import { z } from 'zod'

// AI Gateway routes this string automatically — no provider setup needed
// Vercel OIDC token is auto-provisioned on deployment (vercel env pull for local dev)
const MODEL = 'meta/llama-3.3-70b'

// ─── Token budget — monitor via AI Gateway dashboard ─────────────────────────
// Each manager call: ~550 prompt + 450 completion ≈ 1000 tokens
// N=5 parallel ≈ 5000 tokens
// Synthesis: ~1500 prompt + 900 completion ≈ 2400 tokens
const CV_MAX_CHARS = 2800        // ≈700 tokens — truncate before sending
const JD_MAX_CHARS = 700         // ≈175 tokens
const SYNTH_CV_CHARS = 900       // shorter CV excerpt in synthesis
const SYNTH_REACTION_CHARS = 250 // per-reaction snippet to keep synthesis prompt compact

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const HiringManagerSchema = z.object({
  name: z.string(),
  role: z.string(),
  company: z.string(),
  yearsHiring: z.number(),
  bias: z.string(),
})

const ManagerReactionSchema = z.object({
  reaction: z.string().describe('3-5 sentences in first person'),
  wouldAdvance: z.boolean(),
  concerns: z.array(z.string()).max(3),
  positives: z.array(z.string()).max(3),
})

const AnalysisResultSchema = z.object({
  topStrengths: z.array(z.string()).length(3),
  topConcerns: z.array(z.string()).length(3),
  keyChanges: z.array(z.string()).length(3),
  suggestedRoles: z.array(z.object({
    role: z.string(),
    fit: z.number().min(0).max(100),
    reason: z.string(),
  })).length(5),
  cvAdjustments: z.array(z.object({
    section: z.string(),
    action: z.string(),
  })).length(5),
  courseRecommendations: z.array(z.object({
    skill: z.string(),
    platform: z.string(),
    course: z.string(),
    why: z.string(),
    priority: z.enum(['high', 'medium', 'low']),
  })).length(4),
  verdict: z.string(),
  oneLiner: z.string(),
})

// ─── Exported interfaces (unchanged for API compatibility) ────────────────────

export interface HiringManagerProfile {
  name: string
  role: string
  company: string
  yearsHiring: number
  bias: string
}

export interface ManagerReaction {
  index: number
  profile: HiringManagerProfile
  wouldAdvance: boolean
  reaction: string
  concerns: string[]
  positives: string[]
  tokens: number
  durationMs: number
  error?: string
}

export interface SuggestedRole {
  role: string
  fit: number
  reason: string
}

export interface CourseRecommendation {
  skill: string
  platform: string
  course: string
  why: string
  priority: 'high' | 'medium' | 'low'
}

export interface AnalysisResult {
  advanceRate: number
  sentimentBreakdown: { strong_yes: number; lean_yes: number; lean_no: number; strong_no: number }
  topStrengths: string[]
  topConcerns: string[]
  keyChanges: string[]
  suggestedRoles: SuggestedRole[]
  cvAdjustments: Array<{ section: string; action: string }>
  courseRecommendations: CourseRecommendation[]
  verdict: string
  oneLiner: string
}

// ─── Step 1: Generate N industry-specific hiring managers ─────────────────────

export async function generateManagers(n: number, role: string): Promise<HiringManagerProfile[]> {
  const positiveCount = Math.round(n * 0.45)
  try {
    const { output } = await generateText({
      model: MODEL,
      output: Output.object({
        schema: z.object({ managers: z.array(HiringManagerSchema) }),
      }),
      system: 'You are a persona generation engine.',
      prompt: `Generate exactly ${n} distinct hiring managers for: "${role.slice(0, 300)}"

Match managers to the industry and function of the role:
- Marketing → CMOs, brand managers, growth leads, marketing directors
- Engineering → EMs, CTOs, tech leads, VPs Engineering
- Data/AI → data science leads, ML platform managers, analytics directors
- Design → design directors, product design managers, creative directors
- Finance → CFOs, finance directors, controllers, VP Finance
- Sales → sales directors, VPs Sales, revenue managers
- Product → CPOs, product directors, heads of product

Balance: ${positiveCount} growth-minded · rest traditional. Mix company sizes. International names.`,
      maxOutputTokens: 800,
    })
    return output.managers.slice(0, n)
  } catch {
    return Array.from({ length: n }, (_, i) => ({
      name: `Hiring Manager ${i + 1}`,
      role: 'Director of Talent',
      company: 'Tech company',
      yearsHiring: 5,
      bias: 'Evaluates candidates based on impact and growth potential',
    }))
  }
}

// ─── Step 2: Single structured evaluation per manager ────────────────────────
// CV/JD truncated to budget before prompt construction

export async function runManager(
  manager: HiringManagerProfile,
  index: number,
  cv: string,
  jobDescription: string
): Promise<ManagerReaction> {
  const start = Date.now()
  const cvTrunc = cv.slice(0, CV_MAX_CHARS)
  const jdTrunc = jobDescription.slice(0, JD_MAX_CHARS)

  try {
    const { output, usage } = await generateText({
      model: MODEL,
      output: Output.object({ schema: ManagerReactionSchema }),
      system: `You are ${manager.name}, ${manager.role} at ${manager.company}.
${manager.yearsHiring} years hiring. Lens: ${manager.bias}
Be direct — reference actual CV content. 3-5 sentences first person. At least one concrete positive.`,
      prompt: `ROLE: ${jdTrunc}\n\nCV: ${cvTrunc}`,
      maxOutputTokens: 450,
    })

    return {
      index,
      profile: manager,
      wouldAdvance: output.wouldAdvance,
      reaction: output.reaction,
      concerns: output.concerns,
      positives: output.positives,
      tokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      index, profile: manager, wouldAdvance: false,
      reaction: '', concerns: [], positives: [],
      tokens: 0, durationMs: Date.now() - start,
      error: String(err),
    }
  }
}

// ─── Step 3: Synthesize — frequency maps keep prompt compact ─────────────────

export async function synthesizeResults(
  cv: string,
  jobDescription: string,
  results: ManagerReaction[]
): Promise<AnalysisResult> {
  const successful = results.filter(r => !r.error && r.reaction)
  const advanceCount = successful.filter(r => r.wouldAdvance).length
  const advanceRate = Math.round((advanceCount / (successful.length || 1)) * 100)

  const concernFreq: Record<string, number> = {}
  const positiveFreq: Record<string, number> = {}
  successful.forEach(r => {
    r.concerns.forEach(c => { concernFreq[c] = (concernFreq[c] ?? 0) + 1 })
    r.positives.forEach(p => { positiveFreq[p] = (positiveFreq[p] ?? 0) + 1 })
  })

  // Frequency strings are cheaper than sending full reaction text
  const concernSummary = Object.entries(concernFreq)
    .sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([c, n]) => `${c} (x${n})`).join(' | ')
  const positiveSummary = Object.entries(positiveFreq)
    .sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([p, n]) => `${p} (x${n})`).join(' | ')

  const sampleReactions = successful.slice(0, 5).map(r =>
    `[${r.profile.role} — ${r.wouldAdvance ? 'ADVANCE' : 'PASS'}] ${r.reaction.slice(0, SYNTH_REACTION_CHARS)}`
  ).join('\n')

  const sentimentBreakdown = {
    strong_yes: Math.round(advanceRate * 0.6),
    lean_yes: Math.round(advanceRate * 0.4),
    lean_no: Math.round((100 - advanceRate) * 0.5),
    strong_no: Math.round((100 - advanceRate) * 0.5),
  }

  try {
    const { output } = await generateText({
      model: MODEL,
      output: Output.object({ schema: AnalysisResultSchema }),
      system: 'You are a senior career coach with 15 years of experience.',
      prompt: `Synthesize feedback from ${successful.length} hiring managers.

ROLE: ${jobDescription.slice(0, JD_MAX_CHARS)}
ADVANCE RATE: ${advanceRate}% (${advanceCount}/${successful.length})
CONCERNS: ${concernSummary}
POSITIVES: ${positiveSummary}

REACTIONS:
${sampleReactions}

CV: ${cv.slice(0, SYNTH_CV_CHARS)}

suggestedRoles: 5 roles to apply NOW, fit score 0 to 100
courseRecommendations: 4 courses targeting exact gaps (priority: high/medium/low)
cvAdjustments: 5 items (sections: Work Experience / Skills / Summary / Achievements / Format)
verdict: 2-3 honest sentences about the real gap if advance rate is low
oneLiner: one sentence a recruiter would say`,
      maxOutputTokens: 900,
    })

    return { advanceRate, sentimentBreakdown, ...output }
  } catch {
    return {
      advanceRate, sentimentBreakdown,
      topStrengths: [], topConcerns: [], keyChanges: [],
      suggestedRoles: [], cvAdjustments: [], courseRecommendations: [],
      verdict: `${advanceRate}% of hiring managers would advance this candidate.`,
      oneLiner: 'A candidate with relevant experience.',
    }
  }
}
