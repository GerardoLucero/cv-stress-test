import { z } from 'zod'
import { ModelProvider } from '@/sdk/model-provider'
import { fence } from '@/sdk/engine'

// Same cascade as the interview arena: Groq first, NVIDIA NIM as fallback, models from
// models.json. Replies are validated with zod and retried once on the other provider.
const model = new ModelProvider()

// ─── Token budget — Groq free tier TPM limits ──────────────────────────────────
const CV_MAX_CHARS = 2800
const JD_MAX_CHARS = 700
const SYNTH_CV_CHARS = 900
const SYNTH_REACTION_CHARS = 250

// ─── Zod schemas — used for post-parse validation only ───────────────────────

const HiringManagerSchema = z.object({
  name: z.string(),
  role: z.string(),
  company: z.string(),
  yearsHiring: z.number(),
  bias: z.string(),
})

const ManagerReactionSchema = z.object({
  reaction: z.string(),
  wouldAdvance: z.boolean(),
  concerns: z.array(z.string()),
  positives: z.array(z.string()),
})

const AnalysisResultSchema = z.object({
  topStrengths: z.array(z.string()),
  topConcerns: z.array(z.string()),
  keyChanges: z.array(z.string()),
  suggestedRoles: z.array(z.object({ role: z.string(), fit: z.number(), reason: z.string() })),
  cvAdjustments: z.array(z.object({ section: z.string(), action: z.string() })),
  courseRecommendations: z.array(z.object({
    skill: z.string(), platform: z.string(), course: z.string(),
    why: z.string(), priority: z.enum(['high', 'medium', 'low']),
  })),
  verdict: z.string(),
  oneLiner: z.string(),
})

// ─── Exported interfaces ──────────────────────────────────────────────────────

export interface HiringManagerProfile {
  name: string; role: string; company: string; yearsHiring: number; bias: string
}

export interface ManagerReaction {
  index: number; profile: HiringManagerProfile; wouldAdvance: boolean
  reaction: string; concerns: string[]; positives: string[]
  tokens: number; durationMs: number; error?: string
}

export interface SuggestedRole { role: string; fit: number; reason: string }

export interface CourseRecommendation {
  skill: string; platform: string; course: string; why: string
  priority: 'high' | 'medium' | 'low'
}

export interface AnalysisResult {
  advanceRate: number
  sentimentBreakdown: { strong_yes: number; lean_yes: number; lean_no: number; strong_no: number }
  topStrengths: string[]; topConcerns: string[]; keyChanges: string[]
  suggestedRoles: SuggestedRole[]
  cvAdjustments: Array<{ section: string; action: string }>
  courseRecommendations: CourseRecommendation[]
  verdict: string; oneLiner: string
  /** True when the synthesis step failed and only the advance rate is real. */
  degraded?: boolean
  synthesisTokens?: number
}

// ─── Step 0: pre-flight validation ────────────────────────────────────────────
// One cheap call validates the inputs and extracts role/industry, so garbage input
// does not burn the N manager calls. If every provider is down the check is skipped
// (the manager calls will then fail visibly instead).

const ValidationSchema = z.object({
  isValid: z.boolean(),
  role: z.string().max(200),
  industry: z.string().max(200),
  reason: z.string().max(300).optional(),
})

export async function validateAndExtract(cv: string, jd: string): Promise<{
  isValid: boolean; role: string; industry: string; reason?: string
}> {
  try {
    const { data } = await model.generateJson({
      systemPrompt: 'You are a pre-flight validator.',
      messages: [{ role: 'user', content: `Validate these inputs and extract role/industry.

${fence('cv', cv, 400)}
${fence('job_description', jd, 200)}

isValid: false ONLY if the CV is empty/lorem ipsum OR the job description is not a job description.
Real CVs with any work experience → isValid: true.

Return JSON only: {"isValid":true,"role":"Detected role","industry":"Detected industry","reason":"If invalid, why"}` }],
      maxTokens: 1000,
    }, ValidationSchema)
    return data
  } catch (err) {
    console.warn('[analyzer] pre-flight skipped:', err instanceof Error ? err.message.slice(0, 120) : 'error')
    return { isValid: true, role: 'Professional', industry: 'General' }
  }
}

// ─── Step 1: Generate N industry-specific hiring managers ─────────────────────

export async function generateManagers(n: number, role: string): Promise<HiringManagerProfile[]> {
  const positiveCount = Math.round(n * 0.45)
  try {
    const { data } = await model.generateJson({
      systemPrompt: 'You are a persona generation engine.',
      messages: [{ role: 'user', content: `Generate exactly ${n} distinct hiring managers for: "${role.slice(0, 300).replace(/["<>]/g, '')}"

Match managers to the industry and function of the role:
- Marketing → CMOs, brand managers, growth leads
- Engineering → EMs, CTOs, tech leads, VPs Engineering
- Data/AI → data science leads, ML platform managers
- Design → design directors, product design managers
- Finance → CFOs, finance directors, controllers
- Sales → sales directors, VPs Sales, revenue managers
- Product → CPOs, product directors, heads of product

Balance: ${positiveCount} growth-minded · rest traditional. Mix company sizes. International names.

Return a JSON object {"managers": [...]} with exactly ${n} items shaped like:
{"name":"Full Name","role":"Specific title","company":"Industry and stage","yearsHiring":6,"bias":"One sentence evaluation lens"}` }],
      maxTokens: 2500,
    }, z.object({ managers: HiringManagerSchema.array().min(1) }))
    return data.managers.slice(0, n)
  } catch (err) {
    console.warn('[analyzer] persona generation failed, using generic managers:', err instanceof Error ? err.message.slice(0, 120) : 'error')
    return Array.from({ length: n }, (_, i) => ({
      name: `Hiring Manager ${i + 1}`, role: 'Director of Talent',
      company: 'Tech company', yearsHiring: 5,
      bias: 'Evaluates candidates based on impact and growth potential',
    }))
  }
}

// ─── Step 2: Single evaluation per manager ────────────────────────────────────

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
    const { data: parsed, meta } = await model.generateJson({
      systemPrompt: `You are ${manager.name.slice(0, 80)}, ${manager.role.slice(0, 80)} at ${manager.company.slice(0, 80)}.
${manager.yearsHiring} years hiring. Lens: ${manager.bias.slice(0, 200)}
Be direct — reference actual CV content. 3-5 sentences first person. At least one concrete positive.`,
      messages: [{ role: 'user', content: `${fence('job_description', jdTrunc, JD_MAX_CHARS)}\n\n${fence('cv', cvTrunc, CV_MAX_CHARS)}\n\nReturn JSON only:
{"reaction":"3-5 sentence honest reaction","wouldAdvance":true,"concerns":["specific concern 1","specific concern 2"],"positives":["specific positive 1","specific positive 2"]}` }],
      maxTokens: 2000,
    }, ManagerReactionSchema)
    return {
      index, profile: manager,
      wouldAdvance: parsed.wouldAdvance,
      reaction: parsed.reaction,
      concerns: parsed.concerns,
      positives: parsed.positives,
      tokens: meta.tokens,
      durationMs: Date.now() - start,
    }
  } catch (err) {
    // Provider and parser errors can quote the CV, so only a short generic label leaves the server.
    console.warn(`[analyzer] manager ${index} failed:`, err instanceof Error ? err.message.slice(0, 120) : 'error')
    return {
      index, profile: manager, wouldAdvance: false,
      reaction: '', concerns: [], positives: [],
      tokens: 0, durationMs: Date.now() - start,
      error: 'model unavailable',
    }
  }
}

// ─── Step 3: Synthesize ───────────────────────────────────────────────────────

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

  const concernSummary = Object.entries(concernFreq)
    .sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, n]) => `${c} (x${n})`).join(' | ')
  const positiveSummary = Object.entries(positiveFreq)
    .sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p, n]) => `${p} (x${n})`).join(' | ')

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
    const { data: parsed, meta } = await model.generateJson({
      systemPrompt: 'You are a senior career coach with 15 years of experience.',
      messages: [{ role: 'user', content: `Synthesize feedback from ${successful.length} hiring managers.

ROLE: ${fence('job_description', jobDescription, JD_MAX_CHARS)}
ADVANCE RATE: ${advanceRate}% (${advanceCount}/${successful.length})
CONCERNS: ${concernSummary}
POSITIVES: ${positiveSummary}

REACTIONS:
${sampleReactions}

CV: ${fence('cv', cv, SYNTH_CV_CHARS)}

Return JSON only:
{
  "topStrengths": ["3 concrete strengths from this specific CV"],
  "topConcerns": ["3 most frequent concerns — specific"],
  "keyChanges": ["3 highest-impact concrete changes"],
  "suggestedRoles": [{"role":"Specific job title","fit":85,"reason":"Why based on actual experience"}],
  "cvAdjustments": [{"section":"Work Experience","action":"Specific action"}],
  "courseRecommendations": [{"skill":"Gap skill","platform":"Coursera","course":"Exact course name","why":"How it improves candidacy","priority":"high"}],
  "verdict": "2-3 honest sentences. Explain the real gap if advance rate is low.",
  "oneLiner": "One sentence a recruiter would say to describe this candidate"
}

For suggestedRoles: 5 roles this candidate can apply to NOW.
For courseRecommendations: 4 courses targeting exact gaps. priority: high/medium/low.
For cvAdjustments: 5 specific adjustments.` }],
      maxTokens: 3500,
    }, AnalysisResultSchema)

    return { advanceRate, sentimentBreakdown, ...parsed, synthesisTokens: meta.tokens }
  } catch (err) {
    console.warn('[analyzer] synthesis failed:', err instanceof Error ? err.message.slice(0, 120) : 'error')
    return {
      degraded: true,
      advanceRate, sentimentBreakdown,
      topStrengths: [], topConcerns: [], keyChanges: [],
      suggestedRoles: [], cvAdjustments: [], courseRecommendations: [],
      verdict: `${advanceRate}% of hiring managers would advance this candidate.`,
      oneLiner: 'A candidate with relevant experience.',
    }
  }
}
