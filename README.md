# DevClaw Monorepo

Hackathon monorepo for DevClaw (product layer) + CEOClaw (founder layer).

## Goals for This Structure
- Ship the end-to-end dev loop quickly: Telegram -> triage -> approval gate -> generator/reviewer loop -> GitHub PR.
- Keep founder automation isolated so growth experiments do not block core coding flow.
- Enable 3-4 parallel contributors with clear service ownership boundaries.

## Repository Layout

```text
.
├── apps/
│   ├── dashboard/                # Judge/demo UI: agent activity, PR status, MRR
│   ├── landing-page/             # CEOClaw-generated marketing site
│   └── telegram-bot/             # Bot command handlers and chat UX
├── services/
│   ├── openclaw-gateway/         # Interface adapter and session routing
│   ├── orchestrator/             # Main workflow state machine and policy checks
│   ├── architecture-planner/     # GLM-backed plan builder and risk flags
│   ├── agent-runner/             # Generator/Reviewer pair orchestration
│   ├── integration-verifier/     # Cross-service test and validation runner
│   ├── report-generator/         # PR summary, changelog, walkthrough output
│   ├── ceoclaw-founder/          # Prospecting, outreach, landing updates
│   └── billing-webhooks/         # Stripe events and MRR ledger updates
├── packages/
│   ├── contracts/                # Shared schemas and typed message contracts
│   ├── agent-runtime/            # Agent lifecycle, retries, tool execution policies
│   ├── llm-router/               # FLock + Venice + Z.AI provider routing
│   ├── memory/                   # Session memory abstraction (Redis + encrypted store)
│   ├── github-client/            # GitHub issue, branch, PR orchestration
│   ├── observability/            # Anyway SDK wrappers and trace helpers
│   ├── config/                   # Env loading, feature flags, runtime config
│   ├── ui/                       # Shared UI primitives for dashboard + landing page
│   ├── utils/                    # Common utility helpers
│   └── test-harness/             # Integration test fixtures and mocks
├── infra/
│   ├── docker/                   # Local compose and service Dockerfiles
│   ├── github/                   # CI workflow templates and action scripts
│   ├── scripts/                  # Infra bootstrap scripts
│   └── secrets/                  # Secret templates (no real credentials committed)
├── docs/
│   ├── architecture/             # System architecture and flow specs
│   ├── decisions/                # Lightweight ADRs
│   └── runbooks/                 # Demo and incident runbooks
├── tools/
│   ├── dev/                      # Local developer tooling
│   └── ci/                       # CI helper scripts
├── package.json
└── turbo.json
```

## Priority Build Order
1. `services/openclaw-gateway` + `apps/telegram-bot`
2. `services/orchestrator` + `services/architecture-planner`
3. `services/agent-runner` + `services/report-generator`
4. `services/integration-verifier`
5. `services/ceoclaw-founder` + `services/billing-webhooks`

## Workspace Commands
- `npm install`
- `npm run dev`
- `npm run build`
- `npm run test`

## Architecture Docs
- `docs/architecture/system-architecture.md`
- `docs/architecture/hackathon-scope.md`
- `docs/architecture/contracts.md`
- `docs/decisions/0001-monorepo-boundaries.md`
- `docs/testing-bots.md` (Ingress Interface Testing Guide)
