# Security policy

If you find a vulnerability, please do not open a public issue. Email luceroriosg@gmail.com with the details and steps to reproduce. You will get a reply within a few days.

Scope: the code in this repository and the demo at https://cv-stress-test.vercel.app.

## Data handling

- The server stores nothing: no database, no files. CV and job description text is held only for the duration of a request.
- That text is sent to the configured model providers (Groq, NVIDIA NIM) to produce the evaluation. Do not paste data you are not allowed to share.
- Interview state lives in a sealed token on the client (see [ADR 0001](docs/adr/0001-stateless-sessions-sealed-token.md)).
- A usage notification may record an approximate city and country, never the CV, the job description or the IP address.

## Controls in place

- Sessions sealed with AES-256-GCM, 2 hour expiry. `SESSION_SECRET` is required in production and must be at least 32 characters.
- Request bodies validated with zod, with hard size limits.
- Candidate text fenced inside tags in prompts; model replies parsed against schemas and clamped; the hiring decision is derived from the score.
- Model output rendered as text, never as HTML.
- Provider error text is never returned to clients.
- Rate limiting per IP on every model-backed route.
- Dependabot for npm and GitHub Actions; `npm audit` is clean; the CI blocks on type check and build.
- Secrets live in the hosting provider's environment and are never committed.

## Known limits

- Rate limiting is best effort and kept per instance, so it is not a global quota.
- A sealed token cannot be revoked before it expires.
- Prompt-injection mitigations reduce the risk but do not remove it; a hostile CV can try to influence the score of its own session.

Threat modeling notes and the reasoning behind these choices are in [docs/adr](docs/adr).
