# CV Stress Test

Stress-test your CV against N synthetic hiring managers before you send it.

Most candidates send their CV and wonder why they never hear back. CV Stress Test shows you exactly why — before you apply. Paste your CV and the job description, choose how many hiring managers to simulate (5 to 20), and get a detailed report in under two minutes: advance rate, top concerns, top strengths, and the three concrete changes that would move the most managers from no to yes.

---

## What you get

**Advance rate** — the percentage of simulated hiring managers who would move your profile to the next round.

**Top strengths** — what consistently impressed managers across the simulation.

**Top concerns** — the patterns that kept appearing as reasons to pass.

**Key changes** — three specific, actionable edits that would meaningfully increase your advance rate.

**Individual reactions** — expand any manager's card to read their exact reaction, word for word, with their concerns and positives listed explicitly.

**One-liner** — the one sentence a hiring manager would use to describe you to a colleague.

---

## How it works

Three-step pipeline powered by the Anthropic AI SDK:

**Step 1 — Generate managers.** One `claude-haiku-4.5` call generates N distinct, realistic hiring managers for the role you are targeting. Each one has a name, a specific role and company type, years of hiring experience, and a defined evaluation lens. They are varied: different company sizes, different levels of technical depth, different industries.

**Step 2 — Run in parallel.** Each manager reads your CV and the job description independently and reacts as they would in real life. A second structured call extracts whether they would advance you, their specific concerns, and what they found compelling. All managers run concurrently via `Promise.allSettled`.

**Step 3 — Synthesize.** `claude-sonnet-4.6` reads all reactions together and produces the final report: advance rate, sentiment breakdown, recurring patterns, and the three changes with the highest expected impact.

---

## Stack

- Next.js 15 (App Router)
- Anthropic AI SDK (`@ai-sdk/anthropic`)
- Prisma with SQLite (local) or PostgreSQL (production)
- TypeScript

---

## Getting started

### Prerequisites

- Node.js 20+
- Anthropic API key — get one at [console.anthropic.com](https://console.anthropic.com)

### Install

```bash
git clone https://github.com/GerardoLucero/cv-stress-test.git
cd cv-stress-test
npm install
```

### Configure

```bash
cp .env.example .env
```

Add your API key to `.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
DATABASE_URL="file:./dev.db"
```

### Set up the database

```bash
npm run db:generate
npm run db:push
```

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## API

### POST /api/analyze

Run a CV analysis.

**Request body:**

| Field | Type | Default | Description |
|---|---|---|---|
| `cv` | string | required | The full CV text |
| `jobDescription` | string | required | The job description or role you are targeting |
| `n` | number | 10 | Number of hiring managers to simulate (3-20) |

**Response:**

```json
{
  "id": "analysis-1234567890",
  "result": {
    "advanceRate": 65,
    "topStrengths": ["..."],
    "topConcerns": ["..."],
    "keyChanges": ["..."],
    "verdict": "...",
    "oneLiner": "..."
  },
  "totalTokens": 18500,
  "durationMs": 42000
}
```

### GET /api/analyze?id={id}

Retrieve a completed analysis with all individual manager reactions.

### GET /api/analyze

List the 10 most recent analyses.

---

## Cost estimate

At published Anthropic rates, approximate cost per analysis:

| Managers | Tokens (approx.) | Estimated cost |
|---|---|---|
| 5 | ~8,000 | ~$0.008 |
| 10 | ~16,000 | ~$0.016 |
| 20 | ~30,000 | ~$0.030 |

---

## Deployment

### Vercel

```bash
vercel deploy
```

Set `ANTHROPIC_API_KEY` and `DATABASE_URL` in your project's environment variables. For production, use PostgreSQL instead of SQLite — update the `datasource` provider in `prisma/schema.prisma` to `postgresql`.

### Self-hosted

Any Node.js host works: Railway, Render, Fly.io. Requires `ANTHROPIC_API_KEY` and a `DATABASE_URL` pointing to a supported Prisma database.

---

## Project structure

```
cv-stress-test/
├── prisma/
│   └── schema.prisma          Analysis and Reaction models
├── src/
│   ├── app/
│   │   └── api/analyze/
│   │       └── route.ts       POST and GET handlers
│   └── lib/
│       ├── db.ts              Prisma client singleton
│       └── analyzer.ts        Core pipeline (generateManagers, runManager, synthesizeResults)
├── .env.example
└── README.md
```

---

## License

MIT
