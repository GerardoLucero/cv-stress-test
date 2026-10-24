import { createGroq } from '@ai-sdk/groq'
import { generateText } from 'ai'
import { z } from 'zod'

// Groq free tier: no credit card required. Plain JSON prompts, validated with zod below.
import { getGroqModel, GROQ_PROVIDER_OPTIONS } from './groq-model'
const groq = createGroq({ apiKey: process.env.GROQ_API_KEY })

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

function parseJson(text: string): unknown {
  return JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
}

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
}

// ─── Step 1: Generate N industry-specific hiring managers ─────────────────────

export async function generateManagers(n: number, role: string): Promise<HiringManagerProfile[]> {
  const positiveCount = Math.round(n * 0.45)
  try {
    const { text } = await generateText({
      model: groq(await getGroqModel()),
      system: 'You are a persona generation engine. Return only valid JSON arrays, no markdown.',
      prompt: `Generate exactly ${n} distinct hiring managers for: "${role.slice(0, 300)}"

Match managers to the industry and function of the role:
- Marketing → CMOs, brand managers, growth leads
- Engineering → EMs, CTOs, tech leads, VPs Engineering
- Data/AI → data science leads, ML platform managers
- Design → design directors, product design managers
- Finance → CFOs, finance directors, controllers
- Sales → sales directors, VPs Sales, revenue managers
- Product → CPOs, product directors, heads of product

Balance: ${positiveCount} growth-minded · rest traditional. Mix company sizes. International names.

Return JSON array of exactly ${n} objects:
[{"name":"Full Name","role":"Specific title","company":"Industry and stage","yearsHiring":6,"bias":"One sentence evaluation lens"}]`,
      maxOutputTokens: 2500,
      providerOptions: GROQ_PROVIDER_OPTIONS,
    })
    const parsed = HiringManagerSchema.array().parse(parseJson(text))
    return parsed.slice(0, n)
  } catch {
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
    const { text, usage } = await generateText({
      model: groq(await getGroqModel()),
      system: `You are ${manager.name}, ${manager.role} at ${manager.company}.
${manager.yearsHiring} years hiring. Lens: ${manager.bias}
Be direct — reference actual CV content. 3-5 sentences first person. At least one concrete positive.
Return ONLY a valid JSON object, no markdown, no extra text.`,
      prompt: `ROLE: ${jdTrunc}\n\nCV: ${cvTrunc}\n\nReturn JSON only:
{"reaction":"3-5 sentence honest reaction","wouldAdvance":true,"concerns":["specific concern 1","specific concern 2"],"positives":["specific positive 1","specific positive 2"]}`,
      maxOutputTokens: 2000,
      providerOptions: GROQ_PROVIDER_OPTIONS,
    })

    const parsed = ManagerReactionSchema.parse(parseJson(text))
    return {
      index, profile: manager,
      wouldAdvance: parsed.wouldAdvance,
      reaction: parsed.reaction,
      concerns: parsed.concerns,
      positives: parsed.positives,
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
    const { text } = await generateText({
      model: groq(await getGroqModel()),
      system: 'You are a senior career coach with 15 years of experience. Return only valid JSON, no markdown.',
      prompt: `Synthesize feedback from ${successful.length} hiring managers.

ROLE: ${jobDescription.slice(0, JD_MAX_CHARS)}
ADVANCE RATE: ${advanceRate}% (${advanceCount}/${successful.length})
CONCERNS: ${concernSummary}
POSITIVES: ${positiveSummary}

REACTIONS:
${sampleReactions}

CV: ${cv.slice(0, SYNTH_CV_CHARS)}

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
For cvAdjustments: 5 specific adjustments.`,
      maxOutputTokens: 3500,
      providerOptions: GROQ_PROVIDER_OPTIONS,
    })

    const parsed = AnalysisResultSchema.parse(parseJson(text))
    return { advanceRate, sentimentBreakdown, ...parsed }
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
