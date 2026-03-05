# OpenClaw Engine Service

## Purpose

The OpenClaw Engine service (`http://localhost:3040`) is the dedicated architecture planner for DevClaw.

It receives tasks routed by the Orchestrator and leverages the local OpenClaw CLI to:

- Create initial architecture plans (`/api/plan`)
- Iteratively update existing plans based on feedback (`/api/plan/:planId/update`)
- Execute approved plans directly in the isolated workspace (`/api/execute`)
- Persist plan revisions and blueprints for subsequent execution stages

## Endpoints

- `GET /health`: Service status and capabilities
- `POST /api/plan`: Create a new plan from a task description
- `GET /api/plan/:planId`: Retrieve an existing plan by ID
- `POST /api/plan/:planId/update`: Modify a plan with a new change request
- `POST /api/execute`: Run implementation directly inside the isolated workspace and return patch/branch metadata

### Execution Runtime Configuration

- `OPENCLAW_EXECUTION_TIMEOUT_MS` (default: `14400000`)
- `OPENCLAW_EXECUTION_GIT_PUSH_ENABLED=true|false` (default: `true`)
- `OPENCLAW_GIT_AUTHOR_NAME` (default: `OpenClaw`)
- `OPENCLAW_GIT_AUTHOR_EMAIL` (default: `openclaw@local.dev`)

Execution always runs with local OpenClaw CLI mode from the isolated workspace path provided by orchestrator (`isolatedEnvironmentPath`).
No HTTP execution proxying to `agent-runner` is performed by this service.

## OpenClaw Runtime Configuration

- `OPENCLAW_CLI_BIN` (default: `openclaw`)
- `OPENCLAW_CLI_MODE=agent-local` (default: `agent-local`)
- `OPENCLAW_CLI_TIMEOUT_MS` (default: `1200000`)
- `OPENCLAW_LOCAL_TO` (default: `+15555550123`)

Planner and execution always invoke local mode:

- `openclaw agent --local --json --to <OPENCLAW_LOCAL_TO>`

There is no internal fallback planner in this service now; if OpenClaw CLI is unavailable, planning returns an error.

## Planning Blueprint Fields

Each plan response includes:

- `blueprint.branch` (proposed branch strategy + name)
- `blueprint.isolationProvider` (default `isolated-docker-workspace`)
- `blueprint.agentQueue` (generator/reviewer assignments)
- `blueprint.phases` (planning through delivery stages)
