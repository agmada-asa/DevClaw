# DevClaw

An AI-powered developer productivity platform that automates the full GitHub PR workflow.

---

## What It Does

DevClaw turns a plain-language task description into a merged GitHub PR with no manual coding required:

1. **Describe** — Developer sends a message to the Telegram bot (e.g. "fix the login bug" or "add dark mode")
2. **Issue** — DevClaw creates a GitHub issue automatically
3. **Plan** — AI generates a full architecture plan (files to change, approach, risk flags)
4. **Approve** — Human reviews and approves the plan via Telegram
5. **Generate** — AI Generator agent writes the code changes
6. **Review** — AI Reviewer agent checks the code for correctness and quality
7. **PR** — A GitHub pull request is opened, ready to merge

---

## Features

- Telegram bot interface — no app installs for end users
- GitHub issue auto-creation from natural language
- AI architecture planning with risk flags and file-level blueprints
- Human approval gate before any code is written
- Generator + Reviewer agent pair for code quality
- Automatic GitHub PR creation with summary and walkthrough
- Multi-provider LLM routing (FLock, Venice, Z.AI, OpenRouter) with automatic fallback
- Redis-backed session memory across conversations
- Supabase persistence for plans, runs, and audit history
- Dashboard UI for judges/demo — shows agent activity, PR status, MRR

---

## Architecture

```text
.
├── apps/
│   ├── dashboard/                # Judge/demo UI: agent activity, PR status, MRR
│   ├── landing-page/             # Marketing site
│   └── telegram-bot/             # Bot command handlers and chat UX
├── services/
│   ├── openclaw-gateway/         # Interface adapter and session routing
│   ├── orchestrator/             # Main workflow state machine and policy checks
│   ├── architecture-planner/     # GLM-backed plan builder and risk flags
│   ├── openclaw-engine/          # OpenClaw planning engine (plan create/update)
│   ├── agent-runner/             # Generator/Reviewer pair orchestration
│   ├── integration-verifier/     # Cross-service test and validation runner
│   ├── report-generator/         # PR summary, changelog, walkthrough output
│   ├── ceoclaw-founder/          # Autonomous founder loop: sales, marketing, product, ops
│   └── billing-webhooks/         # Stripe events and MRR ledger updates
├── packages/
│   ├── contracts/                # Shared schemas and typed message contracts
│   ├── agent-runtime/            # Agent lifecycle, retries, tool execution policies
│   ├── llm-router/               # FLock + Venice + Z.AI provider routing with fallback
│   ├── memory/                   # Session memory abstraction (Redis + encrypted store)
│   ├── github-client/            # GitHub issue, branch, PR orchestration
│   ├── observability/            # Trace helpers and SDK wrappers
│   ├── config/                   # Env loading, feature flags, runtime config
│   ├── ui/                       # Shared UI primitives for dashboard + landing page
│   ├── utils/                    # Common utility helpers
│   └── test-harness/             # Integration test fixtures and mocks
├── infra/
│   ├── docker/                   # Local compose and service Dockerfiles
│   ├── github/                   # CI workflow templates and action scripts
│   ├── scripts/                  # Infra bootstrap scripts
│   └── secrets/                  # Secret templates (no real credentials committed)
└── docs/
    ├── architecture/             # System architecture and flow specs
    ├── decisions/                # Lightweight ADRs
    └── runbooks/                 # Demo and incident runbooks
```

---

## Quick Start

### Prerequisites
- Node.js 22+
- Redis (for session memory)
- Supabase project (for persistence)
- Telegram bot token
- GitHub token

### Run full stack
```bash
npm install
docker compose -f infra/docker/docker-compose.yml up
```

---

## Workspace Commands

```bash
npm install          # Install all dependencies
npm run dev          # Start all services in dev mode
npm run build        # Build all packages and services
npm run test         # Run all tests
```
