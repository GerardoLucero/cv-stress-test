# AI Interviewer SDK

Multi-agent technical and behavioral interview simulator. Server-side engine plus browser speech helper.

- **Models:** Groq (`llama-3.3-70b-versatile`) first, NVIDIA NIM as fallback (`NVIDIA_MODEL`, default `openai/gpt-oss-20b`). An empty reply or JSON that fails validation counts as a provider failure and is retried on the other one.
- **STAR rubric per answer** and a final scorecard (0-100, `STRONG_HIRE | HIRE | LEAN_NO | NO_HIRE`, 5-dimension radar, CV adjustments).
- **Stateless sessions:** nothing is stored. The whole session travels to the client as an AES-256-GCM sealed token (`session-token.ts`) and comes back on every call. No database, no session ids to enumerate, no CV retention. Tokens expire after 2 hours.
- **Validated I/O:** request bodies and every model reply are parsed with zod (`schemas.ts`); scores are rounded and clamped, unknown enum values are rejected.
- **Prompt-injection hygiene:** candidate text is fenced in `<cv>`, `<job_description>` and `<candidate_answer>` tags and look-alike tags are stripped.
- **Speech:** browser STT/TTS (`speech-helper.ts`), no cost, degrades to text when unsupported.

## Environment

See `.env.example`. Needs `GROQ_API_KEY` and/or `NVIDIA_NIM_API_KEY`, plus `SESSION_SECRET` (min 32 chars) in production.

## Use

```ts
import { AIInterviewer, sealSession, openSession } from '@/sdk'

const interviewer = new AIInterviewer()

let session = await interviewer.startSession({ cv, jobDescription }, 'staff-architect', 4)
let token = sealSession(session) // hand this to the client

// next request: the client sends `token` back
session = openSession(token)! // null if tampered with or expired
const turn = await interviewer.submitAnswer(session, 'En mi rol anterior...')
token = sealSession(turn.session)

if (turn.isFinished) {
  const { scorecard } = await interviewer.finalizeSession(turn.session)
}
```

`submitAnswer` and `finalizeSession` throw `InterviewStateError` when the interview already ended, the question was already answered, or nothing has been answered yet. `finalizeSession` is idempotent.

## Client imports

The barrel `@/sdk` is server-only (it pulls in `node:crypto` and the model client). Browser code imports `@/sdk/personas`, `@/sdk/types` and `@/sdk/speech-helper` directly.

## Limits

Defined in `schemas.ts` (`LIMITS`): CV 20k chars, job description 5k, answer 4k, 1-8 questions. API routes also cap requests per IP (`rate-limit.ts`). That limiter is per server instance, so on serverless it blunts abuse but is not a global quota; enforce a real one with Upstash or the Vercel Firewall.
