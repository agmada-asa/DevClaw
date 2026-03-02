# architecture-planner

## Purpose
Generates `ArchitecturePlan` payloads for incoming task requests.

## Endpoints
- `GET /health`
- `POST /api/plan`

## Z.ai GLM Configuration
- `LLM_PROVIDER=zai_glm` (default)
- `ZAI_API_KEY=<required for live model calls>`
- `ZAI_BASE_URL` (default: `https://api.z.ai/api/paas/v4`)
- `ZAI_GLM_MODEL` (default: `glm-4.7`)

If `ZAI_API_KEY` is missing or a provider call fails, the service returns a deterministic fallback plan.
