import { createGroq } from '@ai-sdk/groq'
import { generateText } from 'ai'

const groq = createGroq({ apiKey: process.env.GROQ_API_KEY })

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

// ─── Step 1: Generate N industry-specific hiring managers ─────────────────

export async function generateManagers(n: number, role: string): Promise<HiringManagerProfile[]> {
  const positiveCount = Math.round(n * 0.45)
  const { text } = await generateText({
    model: groq('llama-3.1-8b-instant'),
    system: 'You are a persona generation engine. Return only valid JSON arrays, no markdown.',
    prompt: `Generate exactly ${n} distinct hiring managers who would realistically evaluate a candidate for: "${role}"

CRITICAL: Match managers to the industry and function of the role.
- Marketing role → CMOs, brand managers, growth leads, marketing directors
- Engineering role → engineering managers, CTOs, tech leads, VPs Engineering
- Data/AI role → data science leads, ML platform managers, analytics directors
- Design role → design directors, product design managers, creative directors
- Finance role → CFOs, finance directors, controllers, VP Finance
- Sales role → sales directors, VPs of Sales, revenue managers
- Product role → CPOs, product directors, heads of product

Balance:
- ${positiveCount} managers: growth-minded, value potential and trajectory
- Rest: traditional, value exact experience match and track record
- Mix company sizes: startups, scale-ups, enterprise
- International name diversity

Return JSON array of exactly ${n} objects:
[{
  "name": "Full Name",
  "role": "Specific title at company type",
  "company": "Industry and stage",
  "yearsHiring": 6,
  "bias": "One sentence evaluation lens"
}]`,
    maxTokens: 2000,
  })

  try {
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    return (JSON.parse(clean) as HiringManagerProfile[]).slice(0, n)
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

// ─── Step 2: Single-call evaluation per manager ───────────────────────────
// One LLM call returns reaction + structured data together (halves token usage)

export async function runManager(
  manager: HiringManagerProfile,
  index: number,
  cv: string,
  jobDescription: string
): Promise<ManagerReaction> {
  const start = Date.now()

  try {
    const { text, usage } = await generateText({
      model: groq('llama-3.1-8b-instant'),
      system: `You are ${manager.name}, ${manager.role} at ${manager.company}.
You have been hiring for ${manager.yearsHiring} years in this industry.
Your evaluation lens: ${manager.bias}

Review this CV for the specific role. Be direct — reference actual things you see in the CV.
Your reaction must be 3-5 sentences in first person. Always mention at least one concrete positive.
Return ONLY a valid JSON object, no markdown, no extra text.`,
      prompt: `ROLE: ${jobDescription}\n\nCV: ${cv}\n\nReturn JSON only:
{"reaction": "3-5 sentence honest reaction", "wouldAdvance": true, "concerns": ["specific concern 1", "specific concern 2"], "positives": ["specific positive 1", "specific positive 2"]}`,
      maxTokens: 500,
    })

    const tokens = (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0)

    try {
      const parsed = JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
      return {
        index, profile: manager,
        wouldAdvance: parsed.wouldAdvance ?? false,
        reaction: parsed.reaction ?? '',
        concerns: parsed.concerns ?? [],
        positives: parsed.positives ?? [],
        tokens, durationMs: Date.now() - start,
      }
    } catch {
      return {
        index, profile: manager, wouldAdvance: false,
        reaction: text.slice(0, 600), concerns: [], positives: [],
        tokens, durationMs: Date.now() - start,
      }
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

// ─── Step 3: Synthesize ──────────────���───────────────────────────────────���

export async function synthesizeResults(
  cv: string,
  jobDescription: string,
  results: ManagerReaction[]
): Promise<AnalysisResult> {
  const successful = results.filter(r => !r.error && r.reaction)
  const advanceCount = successful.filter(r => r.wouldAdvance).length
  const advanceRate = Math.round((advanceCount / (successful.length || 1)) * 100)

  // Frequency maps — much cheaper than sending full reaction text
  const concernFreq: Record<string, number> = {}
  const positiveFreq: Record<string, number> = {}
  successful.forEach(r => {
    r.concerns.forEach(c => { concernFreq[c] = (concernFreq[c] ?? 0) + 1 })
    r.positives.forEach(p => { positiveFreq[p] = (positiveFreq[p] ?? 0) + 1 })
  })
  const topConcernsSummary = Object.entries(concernFreq)
    .sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([c, n]) => `${c} (x${n})`).join(' | ')
  const topPositivesSummary = Object.entries(positiveFreq)
    .sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([p, n]) => `${p} (x${n})`).join(' | ')

  // Sample reactions for qualitative context
  const sampleReactions = successful.slice(0, 6).map(r =>
    `[${r.profile.role} — ${r.wouldAdvance ? 'ADVANCE' : 'PASS'}] ${r.reaction}`
  ).join('\n\n')

  const { text } = await generateText({
    model: groq('llama-3.1-8b-instant'),
    system: 'You are a senior career coach with 15 years of experience. Return only valid JSON, no markdown.',
    prompt: `Synthesize feedback from ${successful.length} hiring managers.

ROLE: ${jobDescription.slice(0, 300)}
ADVANCE RATE: ${advanceRate}% (${advanceCount}/${successful.length})

TOP CONCERNS (by frequency): ${topConcernsSummary}
TOP POSITIVES (by frequency): ${topPositivesSummary}

SAMPLE REACTIONS:
${sampleReactions}

CV SUMMARY:
${cv.slice(0, 1000)}

Return JSON only:
{
  "topStrengths": ["3 concrete strengths from this specific CV"],
  "topConcerns": ["3 most frequent concerns — specific"],
  "keyChanges": ["3 highest-impact concrete changes"],
  "suggestedRoles": [
    { "role": "Specific job title", "fit": 85, "reason": "Why based on their actual experience" }
  ],
  "cvAdjustments": [
    { "section": "Work Experience", "action": "Specific action" },
    { "section": "Skills", "action": "Specific action" },
    { "section": "Summary", "action": "Specific action" },
    { "section": "Achievements", "action": "Specific action" },
    { "section": "Format", "action": "Specific action" }
  ],
  "courseRecommendations": [
    { "skill": "Gap skill", "platform": "Coursera", "course": "Exact course name", "why": "How it improves candidacy", "priority": "high" }
  ],
  "verdict": "2-3 honest sentences. Explain the real gap if advance rate is low.",
  "oneLiner": "One sentence a recruiter would say to describe this candidate"
}

For suggestedRoles: 5 roles this candidate can apply to NOW. Include fit 0-100.
For courseRecommendations: 4 courses targeting exact gaps. priority: high/medium/low.`,
    maxTokens: 1000,
  })

  const sentimentBreakdown = {
    strong_yes: Math.round(advanceRate * 0.6),
    lean_yes: Math.round(advanceRate * 0.4),
    lean_no: Math.round((100 - advanceRate) * 0.5),
    strong_no: Math.round((100 - advanceRate) * 0.5),
  }

  try {
    const parsed = JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
    return {
      advanceRate, sentimentBreakdown,
      topStrengths: parsed.topStrengths ?? [],
      topConcerns: parsed.topConcerns ?? [],
      keyChanges: parsed.keyChanges ?? [],
      suggestedRoles: parsed.suggestedRoles ?? [],
      cvAdjustments: parsed.cvAdjustments ?? [],
      courseRecommendations: parsed.courseRecommendations ?? [],
      verdict: parsed.verdict ?? '',
      oneLiner: parsed.oneLiner ?? '',
    }
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
