# ADR 0003: Model list in `models.json`, changed without a deploy

Status: accepted (documented retrospectively, October 2026)

## Context
Model retirements happen on the providers' schedule, not on ours. Changing a model through an environment variable requires a redeploy and a person watching.

## Decision
The ordered model list lives in `models.json` on `main`. The app reads it from GitHub with a 5 minute cache and falls back to the copy bundled in the build. `GROQ_MODEL` and `NVIDIA_MODEL` remain as an emergency override. A scheduled workflow probes every listed model daily and sends a push notification when one stops answering.

## Alternatives considered
- **Environment variables only.** Needs a redeploy for every change.
- **A feature-flag service.** Overkill for one list of strings.
- **Hard-coded models.** The cause of the August outage.

## Consequences
- Fixing a retired model is a one-line commit that takes effect within minutes.
- Production depends on GitHub being reachable to get the latest list; the bundled copy covers that case.
- Anyone with write access to `main` can change which models receive user data, so the file is covered by the same review rules as code.
