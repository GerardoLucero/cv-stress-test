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

export interface AnalysisResult {
  advanceRate: number
  sentimentBreakdown: { strong_yes: number; lean_yes: number; lean_no: number; strong_no: number }
  topStrengths: string[]
  topConcerns: string[]
  keyChanges: string[]
  verdict: string
  oneLiner: string
}

// ─── Step 1: Generate N hiring managers ────────────────────────────────────

export async function generateManagers(n: number, role: string): Promise<HiringManagerProfile[]> {
  const { text } = await generateText({
    model: groq('llama-3.1-8b-instant'),
    system: 'You are a persona generation engine. Return only valid JSON arrays, no markdown.',
    prompt: `Generate exactly ${n} distinct hiring managers who would evaluate a candidate for this role: "${role}"

Rules:
- Mix of company sizes: startups, scale-ups, enterprise
- Mix of technical depth: some ex-engineers, some pure managers
- Mix of seniority levels: engineering managers, senior managers, directors
- International diversity in names and company backgrounds
- Include both open-minded and skeptical hiring managers

Return JSON array of exactly ${n} objects (no markdown):
[{
  "name": "Full Name",
  "role": "e.g. Engineering Manager at Series B startup",
  "company": "Type and stage, e.g. 'B2B SaaS Series B'",
  "yearsHiring": 5,
  "bias": "One sentence — their known lens when reviewing candidates"
}]`,
    maxOutputTokens: 2000,
  })

  try {
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    return (JSON.parse(clean) as HiringManagerProfile[]).slice(0, n)
  } catch {
    return Array.from({ length: n }, (_, i) => ({
      name: `Hiring Manager ${i + 1}`,
      role: 'Engineering Manager',
      company: 'Tech company',
      yearsHiring: 5,
      bias: 'Evaluates candidates based on impact and technical depth',
    }))
  }
}

// ─── Step 2: Run a single manager's evaluation ────────────────────────────

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
You have been hiring engineers for ${manager.yearsHiring} years.
Your evaluation lens: ${manager.bias}

You are reviewing a CV for this role. Be direct and honest — you see dozens of CVs per week.
Respond in first person. 3-5 sentences. Do not be generic. Name specific things you see.`,
      prompt: `ROLE WE ARE HIRING FOR:\n${jobDescription}\n\nCANDIDATE CV:\n${cv}\n\nWhat is your honest reaction? Would you advance this candidate?`,
      maxOutputTokens: 400,
    })

    const tokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)

    const { text: structured } = await generateText({
      model: groq('llama-3.1-8b-instant'),
      system: 'Extract structured data from a hiring manager reaction. Return only valid JSON, no markdown.',
      prompt: `From this hiring manager reaction, extract:
1. wouldAdvance: true/false — would they move this candidate forward?
2. concerns: array of 2-3 specific concerns they raised (or implied)
3. positives: array of 2-3 specific positives they mentioned (or implied)

Reaction: "${rawReaction}"

Return JSON only: {"wouldAdvance": true, "concerns": ["..."], "positives": ["..."]}`,
      maxOutputTokens: 200,
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
    system: 'You are a senior career coach synthesizing hiring manager feedback. Return only valid JSON, no markdown.',
    prompt: `Synthesize ${successful.length} hiring manager reactions to this CV.

ROLE: ${jobDescription.slice(0, 300)}
ADVANCE RATE: ${advanceRate}% (${advanceCount} of ${successful.length} would advance)

SAMPLE REACTIONS:
${sampleReactions}

ALL CONCERNS RAISED: ${allConcerns.join(' | ')}
ALL POSITIVES NOTED: ${allPositives.join(' | ')}

Return JSON only:
{
  "topStrengths": ["top 3 things that consistently impressed managers"],
  "topConcerns": ["top 3 concerns that appeared most frequently"],
  "keyChanges": ["top 3 concrete, specific changes that would increase the advance rate"],
  "verdict": "2-3 sentence honest verdict on this CV for this role",
  "oneLiner": "One sentence summary a manager would use to describe this candidate to a colleague"
}`,
    maxOutputTokens: 600,
  })

  const sentimentBreakdown = {
    strong_yes: Math.round(advanceRate * 0.6),
    lean_yes: Math.round(advanceRate * 0.4),
    lean_no: Math.round((100 - advanceRate) * 0.5),
    strong_no: Math.round((100 - advanceRate) * 0.5),
  }

  try {
    const parsed = JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
    return { advanceRate, sentimentBreakdown, topStrengths: parsed.topStrengths ?? [], topConcerns: parsed.topConcerns ?? [], keyChanges: parsed.keyChanges ?? [], verdict: parsed.verdict ?? '', oneLiner: parsed.oneLiner ?? '' }
  } catch {
    return { advanceRate, sentimentBreakdown, topStrengths: [], topConcerns: [], keyChanges: ['Review and strengthen your CV based on the job requirements'], verdict: `${advanceRate}% of hiring managers would advance this candidate.`, oneLiner: 'A candidate with relevant experience.' }
  }
}
