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

CRITICAL: The managers must be specific to the industry and function of this role.
- If the role is in marketing → generate marketing directors, CMOs, brand managers, growth leads
- If the role is in engineering → generate engineering managers, CTOs, tech leads, VPs of Engineering
- If the role is in data/AI → generate data science leads, ML platform managers, analytics directors
- If the role is in design → generate design directors, product design managers, creative directors
- If the role is in finance → generate CFOs, finance directors, controllers, VP Finance
- If the role is in sales → generate sales directors, VPs of Sales, revenue managers
- If the role is in product → generate CPOs, product directors, senior PMs, heads of product
- Match manager seniority to the seniority implied in the role
- Mix company sizes: startups, scale-ups, enterprise, agencies
- International name diversity

Balance (strictly follow):
- ${positiveCount} managers should be growth-minded: value potential, trajectory, coachability
- The rest should be traditional: value exact experience match and proven track record

Return JSON array of exactly ${n} objects (no markdown):
[{
  "name": "Full Name",
  "role": "Specific title at specific company type",
  "company": "Industry and stage",
  "yearsHiring": 6,
  "bias": "One sentence — their specific evaluation lens for this type of role"
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
      bias: 'Evaluates candidates based on impact, growth potential, and culture fit',
    }))
  }
}

// ─── Step 2: Run a single manager’s evaluation ────────────────────────────

export async function runManager(
  manager: HiringManagerProfile,
  index: number,
  cv: string,
  jobDescription: string
): Promise<ManagerReaction> {
  const start = Date.now()

  try {
    const { text: rawReaction, usage } = await generateText({
      model: groq('llama-3.1-8b-instant'),
      system: `You are ${manager.name}, ${manager.role} at ${manager.company}.
You have been hiring for ${manager.yearsHiring} years in this industry.
Your evaluation lens: ${manager.bias}

Review the CV for this specific role. Be direct — reference actual things you see.
Respond in first person. 3-5 sentences. Always mention at least one concrete positive.`,
      prompt: `ROLE WE ARE HIRING FOR:\n${jobDescription}\n\nCANDIDATE CV:\n${cv}\n\nWhat is your honest reaction? Would you advance this candidate?`,
      maxTokens: 400,
    })

    const tokens = (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0)

    const { text: structured } = await generateText({
      model: groq('llama-3.1-8b-instant'),
      system: 'Extract structured data from a hiring manager reaction. Return only valid JSON, no markdown.',
      prompt: `From this reaction extract:
1. wouldAdvance: true/false
2. concerns: 2-3 specific concerns (empty array if advancing enthusiastically)
3. positives: 2-3 specific positives

Reaction: "${rawReaction}"

Return JSON only: {"wouldAdvance": true, "concerns": ["..."], "positives": ["..."]}`,
      maxTokens: 200,
    })

    let wouldAdvance = false
    let concerns: string[] = []
    let positives: string[] = []

    try {
      const parsed = JSON.parse(structured.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
      wouldAdvance = parsed.wouldAdvance ?? false
      concerns = parsed.concerns ?? []
      positives = parsed.positives ?? []
    } catch { /* use defaults */ }

    return { index, profile: manager, wouldAdvance, reaction: rawReaction, concerns, positives, tokens, durationMs: Date.now() - start }
  } catch (err) {
    return { index, profile: manager, wouldAdvance: false, reaction: '', concerns: [], positives: [], tokens: 0, durationMs: Date.now() - start, error: String(err) }
  }
}

// ─── Step 3: Synthesize all reactions ─────────────────────────────────────

export async function synthesizeResults(
  cv: string,
  jobDescription: string,
  results: ManagerReaction[]
): Promise<AnalysisResult> {
  const successful = results.filter(r => !r.error && r.reaction)
  const advanceCount = successful.filter(r => r.wouldAdvance).length
  const advanceRate = Math.round((advanceCount / (successful.length || 1)) * 100)

  const allConcerns = successful.flatMap(r => r.concerns)
  const allPositives = successful.flatMap(r => r.positives)

  const sampleReactions = successful.slice(0, 12).map(r =>
    `[${r.profile.role} — ${r.wouldAdvance ? 'ADVANCE' : 'PASS'}]\n${r.reaction}`
  ).join('\n\n---\n\n')

  const { text } = await generateText({
    model: groq('llama-3.3-70b-versatile'),
    system: 'You are a senior career coach and recruiter with 15 years of experience across multiple industries. Return only valid JSON, no markdown.',
    prompt: `Synthesize ${successful.length} hiring manager reactions to this CV.

TARGET ROLE: ${jobDescription.slice(0, 300)}
ADVANCE RATE: ${advanceRate}% (${advanceCount} of ${successful.length} would advance)

SAMPLE REACTIONS:
${sampleReactions}

ALL CONCERNS: ${allConcerns.join(' | ')}
ALL POSITIVES: ${allPositives.join(' | ')}

FULL CV:
${cv.slice(0, 1500)}

Return JSON only:
{
  "topStrengths": ["3 concrete strengths from this specific CV"],
  "topConcerns": ["3 recurring concerns — specific to what this CV shows or lacks"],
  "keyChanges": ["3 highest-impact changes to increase the advance rate"],
  "suggestedRoles": [
    { "role": "Specific job title", "fit": 85, "reason": "Why this candidate fits based on their actual experience" }
  ],
  "cvAdjustments": [
    { "section": "e.g. Work Experience", "action": "Specific thing to add, rewrite, or remove" },
    { "section": "...", "action": "..." },
    { "section": "...", "action": "..." },
    { "section": "...", "action": "..." },
    { "section": "...", "action": "..." }
  ],
  "courseRecommendations": [
    {
      "skill": "The specific skill gap this course addresses",
      "platform": "Coursera | Udemy | LinkedIn Learning | YouTube | edX | freeCodeCamp",
      "course": "Exact course or resource name",
      "why": "One sentence: how completing this directly improves their candidacy for the target role",
      "priority": "high"
    }
  ],
  "verdict": "2-3 honest sentences. If advance rate is low, explain the real gap.",
  "oneLiner": "One sentence a recruiter would say to describe this candidate"
}

For suggestedRoles: 5 specific job titles this candidate can realistically apply to NOW. Include fit score 0-100.
For courseRecommendations: 4-5 courses targeting the exact gaps identified. Match platform to the type of skill (technical → Coursera/Udemy, soft skills → LinkedIn Learning, etc). priority: high = blocks advancement, medium = would help, low = nice to have.`,
    maxTokens: 1200,
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
