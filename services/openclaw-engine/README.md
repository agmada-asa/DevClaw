# openclaw-engine

## Purpose
OpenClaw planning engine at `http://localhost:3040` for:
- creating architecture plans,
- updating existing plans,
- producing a planning blueprint for later isolated branch + agent execution.
- using the real local OpenClaw CLI runtime for planning turns.

## Endpoints
- `GET /health`
- `POST /api/plan`
- `GET /api/plan/:planId`
- `POST /api/plan/:planId/update`
- `POST /api/execute` (currently returns `501 planning_only`)

## OpenClaw Runtime Configuration
- `OPENCLAW_CLI_BIN` (default: `openclaw`)
- `OPENCLAW_CLI_MODE=gateway|agent-local` (default: `gateway`)
- `OPENCLAW_CLI_TIMEOUT_MS` (default: `120000`)

Gateway mode (`OPENCLAW_CLI_MODE=gateway`) invokes:
- `openclaw gateway call agent --expect-final --json --params '{...}'`

Optional gateway auth/target:
- `OPENCLAW_GATEWAY_URL`
- `OPENCLAW_GATEWAY_TOKEN`
- `OPENCLAW_GATEWAY_TO` (planner recipient/session anchor, default: `OPENCLAW_LOCAL_TO` or `+15555550123`)

Local mode (`OPENCLAW_CLI_MODE=agent-local`) invokes:
- `openclaw agent --local --json --to <OPENCLAW_LOCAL_TO>`
- `OPENCLAW_LOCAL_TO` defaults to `+15555550123`

There is no internal fallback planner in this service now; if OpenClaw CLI is unavailable, planning returns an error.

## Planning Blueprint Fields
Each plan response includes:
- `blueprint.branch` (proposed branch strategy + name)
- `blueprint.isolationProvider` (default `venice.ai`)
- `blueprint.agentQueue` (generator/reviewer assignments)
- `blueprint.phases` (planning through delivery stages)
