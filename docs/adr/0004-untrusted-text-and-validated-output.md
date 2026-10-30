# ADR 0004: Treat CV text as untrusted input and model output as untrusted data

Status: accepted (documented retrospectively, October 2026)

## Context
A CV, a job description and a candidate answer are written by the user and end up inside prompts. Model replies are rendered in the UI and drive scores. Both directions can be manipulated.

## Decision
- Candidate text is placed between tags (`fence`), and look-alike closing tags are stripped before it is inserted into a prompt.
- Every model reply is parsed with a zod schema. Numbers are clamped, enums have fallbacks and the final hiring decision is derived from the score instead of trusting the model's label.
- The UI renders model output as plain text, never as HTML.
- Provider error text is never returned to the client.

## Alternatives considered
- **Trust the model to ignore instructions inside the CV.** Not a control.
- **Rely on a moderation endpoint.** Adds a dependency and a cost per request, and it does not address structure.

## Consequences
- A hostile CV can still try to steer the score of its own interview; the blast radius is that one session, since there is no shared state.
- Fencing by tag is a mitigation, not a guarantee. Hardening it (nonce delimiters, escaping every angle bracket) is tracked as an open item.
