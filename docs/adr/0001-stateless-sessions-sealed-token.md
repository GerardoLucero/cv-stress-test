# ADR 0001: Stateless interview sessions with a sealed token

Status: accepted (documented retrospectively, October 2026)

## Context
The Interview Arena is a multi-turn conversation: init, one call per answer, finalize. It runs as serverless functions on Vercel, where consecutive requests can land on different instances and nothing in memory survives. The product handles CVs, which are personal data, and it is a free demo with no budget for a database.

## Decision
The full session travels to the browser inside a token sealed with AES-256-GCM (`SESSION_SECRET`, 2 hour TTL). Every response returns an updated token and the client sends it back on the next call. The server keeps no state.

## Alternatives considered
- **Database or Redis.** Gives revocation and server-side control, but adds a service to run, a place where CVs would be stored and a retention problem to solve.
- **Signed but not encrypted token (JWT).** Simpler, but the client could read the interviewer's notes and prior scores.
- **Sticky instances.** Not available on serverless.

## Consequences
- No CV is stored server side, which keeps the privacy story simple and the deployment free.
- Any instance can serve any request.
- A token cannot be revoked before it expires, and a client can resend an earlier token. Replay is limited by the rate limit, not eliminated. A turn counter inside the token is the planned mitigation.
- The sealed session is bounded by the request size, which is why CV and job description have hard character limits (`src/sdk/limits.ts`).
