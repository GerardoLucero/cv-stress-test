# CV Stress Test

Simulate **N hiring managers** reviewing your CV simultaneously and get brutally honest feedback.

Paste your CV + a job description → 10 independent AI personas evaluate it in parallel → synthesized verdict with advance rate, strengths, concerns, and concrete changes.

## Demo

**[cv-stress-test-gerardoluceros-projects.vercel.app](https://cv-stress-test-gerardoluceros-projects.vercel.app)**

## Deploy your own (free, 5 min)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/GerardoLucero/cv-stress-test)

1. Fork this repo
2. Get a free API key at [console.groq.com](https://console.groq.com) (no credit card)
3. Deploy to Vercel — add `GROQ_API_KEY` as environment variable
4. Share with your team

## Run locally

```bash
git clone https://github.com/GerardoLucero/cv-stress-test
cd cv-stress-test
npm install
cp .env.example .env.local   # add your GROQ_API_KEY
npm run dev
```

## API

```bash
curl -X POST https://your-url.vercel.app/api/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "cv": "Your CV text here",
    "jobDescription": "Job description here",
    "n": 10
  }'
```

## How it works

1. Generates N distinct hiring manager personas (role, company, seniority, bias)
2. Each manager evaluates your CV independently in parallel
3. Synthesizes all reactions into actionable feedback

**Models:** `llama-3.1-8b-instant` (fast evaluations) · `llama-3.3-70b-versatile` (synthesis)  
**Provider:** [Groq](https://groq.com) — free tier, no credit card required

## Tech stack

- Next.js 15 · TypeScript
- Vercel AI SDK + Groq
- Deployed on Vercel
