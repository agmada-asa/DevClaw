# orchestrator

## Purpose
Owns workflow state transitions, approval gating, and dispatch to planning/execution engines.

## Engine Flags
- `ORCHESTRATION_ENGINE=legacy|openclaw` (global default)
- `PLANNING_ENGINE=legacy|openclaw` (optional override)
- `EXECUTION_ENGINE=legacy|openclaw` (optional override)

Legacy mode calls:
- `ARCHITECTURE_PLANNER_URL` (default `http://localhost:3020`)
- `AGENT_RUNNER_URL` (default `http://localhost:3030`)
