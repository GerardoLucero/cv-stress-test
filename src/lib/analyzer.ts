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
  suggestedRoles: string[]
  cvAdjustments: Array<{ section: string; action: string }>
  verdict: string
  oneLiner: string
}

// ─── Step 1: Generate N hiring managers ────────────────────────────────────

export async function generateManagers(n: number, role: string): Promise<HiringManagerProfile[]> {
  const positiveCount = Math.round(n * 0.45)
  const { text } = await generateText({
    model: groq('llama-3.1-8b-instant'),
    system: 'You are a persona generation engine. Return only valid JSON arrays, no markdown.',
    prompt: `Generate exactly ${n} distinct hiring managers who would evaluate a candidate for: "${role}"

Balance rules (strictly follow):
- ${positiveCount} of them should be growth-minded: value potential, coachability, and trajectory over perfect credentials
- The rest are traditional: value years of experience, exact skill match, proven track record
- Mix of company sizes: startups, scale-ups, enterprise
- Mix of technical depth: ex-engineers, product managers, pure people managers
- Mix of seniority: engineering managers, senior managers, directors
- International name diversity

Return JSON array of exactly ${n} objects (no markdown):
[{
  "name": "Full Name",
  "role": "e.g. Engineering Manager at Series B startup",
  "company": "Type and stage, e.g. 'B2B SaaS Series B'",
  "yearsHiring": 5,
  "bias": "One sentence — their specific evaluation lens"
}]`,
    maxTokens: 2000,
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
      bias: 'Evaluates candidates based on impact and growth potential',
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

You are reviewing a CV for a specific role. Be direct and specific — reference actual things you see in the CV.
Respond in first person. 3-5 sentences. Always mention at least one concrete positive from the CV.`,
      prompt: `ROLE WE ARE HIRING FOR:\n${jobDescription}\n\nCANDIDATE CV:\n${cv}\n\nWhat is your honest reaction? Would you advance this candidate?`,
      maxTokens: 400,
    })

    const tokens = (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0)

    const { text: structured } = await generateText({
      model: groq('llama-3.1-8b-instant'),
      system: 'Extract structured data from a hiring manager reaction. Return only valid JSON, no markdown.',
      prompt: `From this hiring manager reaction, extract:
1. wouldAdvance: true/false
2. concerns: 2-3 specific concerns raised (empty array if they would advance enthusiastically)
3. positives: 2-3 specific positives mentioned

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
    system: 'You are a senior career coach and recruiter with 15 years of experience. Return only valid JSON, no markdown.',
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
  "topStrengths": ["3 concrete strengths from the CV that impressed managers"],
  "topConcerns": ["3 recurring concerns — be specific, not generic"],
  "keyChanges": ["3 highest-impact changes to increase the advance rate — concrete, not vague"],
  "suggestedRoles": ["5 specific job titles this candidate is genuinely well-suited for based on their actual experience and skills — be realistic and encouraging"],
  "cvAdjustments": [
    {"section": "e.g. Work Experience", "action": "Specific thing to add, rewrite, or remove"},
    {"section": "...", "action": "..."},
    {"section": "...", "action": "..."},
    {"section": "...", "action": "..."},
    {"section": "...", "action": "..."}
  ],
  "verdict": "2-3 honest sentences about this CV for this role. If advance rate is low, explain why and what the real gap is.",
  "oneLiner": "One sentence a recruiter would say to describe this candidate"
}`,
    maxTokens: 900,
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
      advanceRate,
      sentimentBreakdown,
      topStrengths: parsed.topStrengths ?? [],
      topConcerns: parsed.topConcerns ?? [],
      keyChanges: parsed.keyChanges ?? [],
      suggestedRoles: parsed.suggestedRoles ?? [],
      cvAdjustments: parsed.cvAdjustments ?? [],
      verdict: parsed.verdict ?? '',
      oneLiner: parsed.oneLiner ?? '',
    }
  } catch {
    return {
      advanceRate,
      sentimentBreakdown,
      topStrengths: [],
      topConcerns: [],
      keyChanges: [],
      suggestedRoles: [],
      cvAdjustments: [],
      verdict: `${advanceRate}% of hiring managers would advance this candidate.`,
      oneLiner: 'A candidate with relevant experience.',
    }
  }
}
