# OpenClaw Engine Service

## Purpose
The OpenClaw Engine service (`http://localhost:3040`) is the dedicated architecture planner for DevClaw. 

It receives tasks routed by the Orchestrator and leverages the local OpenClaw CLI to:
- Create initial architecture plans (`/api/plan`)
- Iteratively update existing plans based on feedback (`/api/plan/:planId/update`)
- Persist plan revisions and blueprints for subsequent execution stages

## Endpoints
- `GET /health`: Service status and capabilities
- `POST /api/plan`: Create a new plan from a task description
- `GET /api/plan/:planId`: Retrieve an existing plan by ID
- `POST /api/plan/:planId/update`: Modify a plan with a new change request
- `POST /api/execute`: (Currently returns `501 Not Implemented`; reserved for future OpenClaw native execution)

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
