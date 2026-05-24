# CV Stress Test

Simulate **N hiring managers** reading your CV. See what they think.

Paste your CV + a job description → N independent AI personas evaluate it in parallel → synthesized verdict with advance rate, suggested roles with fit score, strengths, concerns, CV adjustments, and course recommendations.

## Demo

**[cv-stress-test.vercel.app](https://cv-stress-test.vercel.app)**

## Support this project

This tool is free and open source. If it helped your job search:

[![Ko-fi](https://img.shields.io/badge/Ko--fi-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/gerardolucero)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/lucerorios0)
[![GitHub Stars](https://img.shields.io/github/stars/GerardoLucero/cv-stress-test?style=for-the-badge)](https://github.com/GerardoLucero/cv-stress-test/stargazers)

## Deploy your own (free, 5 min)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/GerardoLucero/cv-stress-test)

1. Fork this repo
2. Get a free API key at [console.groq.com](https://console.groq.com) (no credit card)
3. Deploy to Vercel — add `GROQ_API_KEY` as environment variable
4. Share with your community

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
curl -X POST https://cv-stress-test.vercel.app/api/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "cv": "Your CV text here",
    "jobDescription": "Job description here",
    "n": 5
  }'
```

## How it works

1. Generates N industry-specific hiring manager personas matched to the role
2. Each manager evaluates your CV independently (concurrency pool, respects Groq limits)
3. Synthesizes all reactions into actionable feedback:
   - **Advance rate** — % of managers who would move you forward
   - **Suggested roles** with fit score — what you can apply to now
   - **CV adjustments** — section-by-section specific actions
   - **Course recommendations** — targeted courses to close skill gaps
   - **PDF report** — downloadable via browser print

## Tech stack

- Next.js 15 · TypeScript
- Vercel AI SDK + Groq (LLaMA 3)
- Stateless — no database required
- Deployed on Vercel

**Models:** `llama-3.1-8b-instant` (evaluations) · `llama-3.3-70b-versatile` (synthesis)  
**Provider:** [Groq](https://groq.com) — free tier, no credit card required

## License

MIT
