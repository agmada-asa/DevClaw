# agent-runner

## Purpose
Dispatches approved plans to an execution backend.

## Endpoints
- `GET /health`
- `POST /api/execute`

## Backend Selection
- `RUNNER_ENGINE=stub` (default): deterministic local dispatch.
- `RUNNER_ENGINE=openclaw`: forwards execution to OpenClaw.

### OpenClaw Config
- `OPENCLAW_RUNNER_URL` (default: `http://localhost:3040`)
- `OPENCLAW_RUNNER_EXECUTE_PATH` (default: `/api/execute`)
- `ORCHESTRATOR_CALLBACK_URL` (optional)
