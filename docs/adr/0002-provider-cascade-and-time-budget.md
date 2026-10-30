# ADR 0002: Provider cascade with a shared time budget

Status: accepted (documented retrospectively, October 2026)

## Context
In August 2026 Groq retired two models (HTTP 404). The stress test broke completely and the fallback to NVIDIA NIM exceeded the function timeout. A single provider is a single point of failure, and serverless functions have a hard time limit.

## Decision
Requests go to Groq first and to NVIDIA NIM as fallback. Inside each provider, models are tried in the order given by `models.json`; a retired model (404 or 410) falls through to the next one. One time budget per request (55 s by default, `MODEL_BUDGET_MS`) is shared across providers and retries, with a per-call timeout (25 s). A reply that fails zod validation is retried once on the other provider.

## Alternatives considered
- **A single provider with retries.** Does not survive a provider or model retirement.
- **A gateway service in front of the models.** More moving parts than a demo justifies.
- **Independent timeouts per call.** Easy to write, but the sum of retries can exceed the route limit and the user sees a platform error instead of a clean one.

## Consequences
- A retired model no longer takes the product down.
- Worst-case latency is bounded and predictable for the interview routes.
- The batch route `/api/analyze` chains several calls and does not yet share one budget end to end; this is a known gap.
- Failures are logged but not classified (a revoked key and a rate limit look the same). A health probe that calls the provider is the planned follow-up.
