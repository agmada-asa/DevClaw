# llm-router

## Purpose
Routes planner model calls across providers and normalizes output into `ArchitecturePlan`-compatible fields.

## Current Provider
- `zai_glm` via OpenAI-style chat completions API.

## Export
- `generateArchitecturePlan(input)` from `src/index.ts`
