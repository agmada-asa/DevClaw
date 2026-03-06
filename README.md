# DevClaw

An AI-powered developer productivity platform that automates the full GitHub PR workflow — and markets itself with CEOClaw, its autonomous founder agent.

Both agents run entirely on **Z.AI's GLM model family** — `glm-4.7-flash`, `glm-z1-flash`, and `glm-4-long`. GLM models are accessed either directly via the Z.AI API or via OpenRouter's `z-ai/` gateway; all AI intelligence stays within the GLM family.

---

## Powered by Z.AI GLM

DevClaw uses **three Z.AI GLM models**, each matched to the cognitive demand of its role and routed via the best available path:

| Agent Role | GLM Model | Path | Why this model |
|---|---|---|---|
| Architecture Planner | `glm-4-long` | OpenRouter | 128k context window — reads entire codebases |
| Orchestrator | `glm-z1-flash` | OpenRouter | Dedicated deep-reasoning model for workflow decisions |
| Code Generator | `glm-4.7-flash` | Direct Z.AI API | Fast, high-quality code generation with native CoT |
| Code Reviewer | `glm-4.7-flash` | Direct Z.AI API | Rapid patch review and quality checks |
| Frontend/Backend Agents | `glm-4.7-flash` | Direct Z.AI API | Specialised generation per stack layer |
| Prospect Qualifier (CEOClaw) | `glm-z1-flash` | OpenRouter | Nuanced company-fit scoring via deep reasoning |
| Outreach Writer (CEOClaw) | `glm-4.7-flash` | Direct Z.AI API | Personalised LinkedIn message generation |

**Routing strategy:** `glm-4.7-flash` is called directly via the Z.AI API (`open.bigmodel.cn`). For `glm-z1-flash` and `glm-4-long`, OpenRouter is used as the **primary** provider (via `z-ai/` namespace). If OpenRouter is unavailable for any role, the fallback drops back to `glm-4.7-flash` on the direct Z.AI API — so the system always stays within the GLM family.

All Z.AI calls go through a typed LLM router (`packages/llm-router/`) that handles streaming SSE parsing (including the two-phase `reasoning_content` → `content` format for reasoning models), retries, and provider fallback.

---

## What It Does

DevClaw is two products sharing one GLM backbone:

### DevClaw — Autonomous PR Agent
Turns a plain-language task description into a merged GitHub PR with no manual coding:

1. **Describe** — Developer sends a message to the Telegram or WhatsApp bot (e.g. "fix the login bug" or "add dark mode")
2. **Issue** — DevClaw creates a GitHub issue automatically
3. **Plan** — `glm-4-long` generates a full architecture plan (files to change, approach, risk flags) with its 128k context window
4. **Approve** — Human reviews and approves the plan via Telegram
5. **Generate** — `glm-4.7-flash` Generator agent writes the code changes
6. **Review** — `glm-4.7-flash` Reviewer agent checks for correctness and quality
7. **PR** — A GitHub pull request is opened, ready to merge

### CEOClaw — Autonomous Founder Agent
CEOClaw is a self-running business agent that markets and sells DevClaw without human input. It runs a continuous loop across four domains, orchestrated by `glm-z1-flash`:

- **Product** — Generates product ideas and builds landing page variants
- **Marketing** — Writes SEO blog posts targeting startup CTOs and indie hackers; plans outreach campaigns with message angles and follow-up sequences
- **Sales** — `glm-z1-flash` qualifies LinkedIn prospects by reasoning deeply over company profiles; `glm-4.7-flash` writes personalised connection messages; Playwright sends outreach up to a daily limit
- **Operations** — Analyses business metrics, processes user feedback, and plans the next iteration

CEOClaw wakes up on a configurable interval, asks GLM what to do next, executes that task, records the result in Supabase, and goes back to sleep. Goal: reach $100 MRR autonomously.

All CEOClaw outreach links back to the DevClaw landing page, which funnels signups into the Telegram bot.

---

## Features

### DevClaw (Developer Tool)
- Telegram and WhatsApp bot interface — no app installs for end users
- GitHub issue auto-creation from natural language
- `glm-4-long` (via OpenRouter) — 128k context architecture planning with risk flags and file-level blueprints
- Human approval gate before any code is written
- `glm-4.7-flash` (direct Z.AI) — Generator + Reviewer agent pair for code writing and quality checks
- `glm-z1-flash` (via OpenRouter) — deep chain-of-thought orchestration across the full PR workflow
- Automatic GitHub PR creation with summary and walkthrough
- Redis-backed session memory across conversations
- Supabase persistence for plans, runs, and audit history
- Dashboard UI — shows live agent activity, GLM model map, MRR progress

### CEOClaw (Autonomous Founder Agent)
- Fully autonomous business loop — product, marketing, sales, operations
- `glm-z1-flash` (via OpenRouter) — deep reasoning for strategic task routing and prospect qualification
- `glm-4.7-flash` (direct Z.AI) — content generation and personalised outreach copy
- LinkedIn browser automation via Playwright for prospect discovery and messaging
- Configurable daily limits, fit scoring thresholds, and campaign management
- Full REST API for monitoring and demo triggers

---

## Architecture

```text
.
├── apps/
│   ├── dashboard/                # Judge/demo UI: agent activity, PR status, MRR
│   ├── landing-page/             # Marketing site (React + Vite + Tailwind, deployable to Vercel)
│   └── telegram-bot/             # Bot command handlers and chat UX
├── services/
│   ├── openclaw-gateway/         # Interface adapter and session routing
│   ├── orchestrator/             # GLM-Z1-Flash workflow state machine and policy checks
│   ├── architecture-planner/     # GLM-4-Long plan builder — full codebase context
│   ├── openclaw-engine/          # OpenClaw planning engine (plan create/update)
│   ├── agent-runner/             # GLM-4.7-Flash Generator/Reviewer pair orchestration
│   ├── integration-verifier/     # Cross-service test and validation runner
│   ├── report-generator/         # PR summary, changelog, walkthrough output
│   ├── ceoclaw-founder/          # Autonomous founder loop: sales, marketing, product, ops
│   └── billing-webhooks/         # Stripe events and MRR ledger updates
├── packages/
│   ├── contracts/                # Shared schemas and typed message contracts
│   ├── agent-runtime/            # Agent lifecycle, retries, tool execution policies
│   ├── llm-router/               # Z.AI GLM routing with per-role model selection + fallback
│   │                             #   glm-z1-flash  → orchestrator, prospect_qualifier
│   │                             #   glm-4-long    → planner
│   │                             #   glm-4.7-flash → generator, reviewer, outreach_writer
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

## CEOClaw — Autonomous Founder Loop

CEOClaw runs as a separate service (`services/ceoclaw-founder/`) on port `3050`.

### How it works

```
Every CEOCLAW_LOOP_INTERVAL_MS (default: 1 hour):
  1. Load business state (MRR, signups, traffic, phase) from Supabase
  2. Ask AI: what is the highest-impact task right now?
  3. Execute that task (product / marketing / sales / operations)
  4. Record result in Supabase task log
  5. Update business state
  6. Sleep until next interval
```

### Business phases

| Phase | Trigger | Focus |
|-------|---------|-------|
| `pre-launch` | Default | Build landing page, generate ideas |
| `launched` | Landing page built | SEO content, outreach campaigns |
| `growth` | 10+ signups, MRR > 0 | More sales, prospect discovery |
| `scaling` | MRR ≥ $100 | Operations, iteration planning |

### Task types

| Task | Domain | What it does |
|------|--------|-------------|
| `product.generate_idea` | Product | AI generates a product improvement idea |
| `product.build_landing_page` | Product | Generates landing page HTML |
| `marketing.write_seo_content` | Marketing | Writes an 800–1200 word SEO post, saves to `ceoclaw-output/content/` |
| `marketing.plan_campaign` | Marketing | Plans a LinkedIn/email outreach campaign |
| `sales.find_prospects` | Sales | Scrapes LinkedIn, qualifies prospects, generates messages |
| `sales.send_outreach` | Sales | Sends queued messages (respects daily limit) |
| `operations.analyze_metrics` | Operations | Summarises MRR/traffic trends and recommends actions |
| `operations.process_feedback` | Operations | Responds to user feedback with product implications |
| `operations.plan_iteration` | Operations | Plans next product iteration |

### REST API

```
GET  /health                        Service health check
GET  /api/loop/status               Loop running state, MRR progress, last task
POST /api/loop/start                Start the autonomous loop
POST /api/loop/stop                 Stop the loop
POST /api/loop/tick                 Manually trigger one iteration (demos)
GET  /api/loop/history?limit=50     Full task execution log

GET  /api/state                     Current business state (MRR, signups, phase)
PATCH /api/state                    Feed in real metrics from Stripe / analytics

POST /api/campaign                  Create a LinkedIn outreach campaign
GET  /api/campaign                  List all campaigns
GET  /api/campaign/:id              Get a campaign by ID
POST /api/campaign/:id/run          Run full campaign (discover → qualify → message → send)
POST /api/campaign/:id/resume       Resume sending on a paused campaign
POST /api/campaign/:id/pause        Pause a running campaign
GET  /api/campaign/:id/prospects    List prospects and status counts for a campaign
```

### Z.AI GLM env vars (required for all AI features)

| Variable | Default | Description |
|----------|---------|-------------|
| `ZAI_API_KEY` | — | Z.AI API key — obtain at open.bigmodel.cn |
| `ZAI_BASE_URL` | `https://open.bigmodel.cn/api/paas/v4` | Z.AI API base URL |
| `REASONING_MODEL` | `glm-z1-flash` | GLM model for reasoning roles (orchestrator, qualifier) |
| `GENERATOR_MODEL` | `glm-4.7-flash` | GLM model for code/content generation roles |
| `REVIEWER_MODEL` | `glm-4.7-flash` | GLM model for code review roles |
| `LONGCTX_MODEL` | `glm-4-long` | GLM model for long-context planning (128k) |
| `ZAI_OPENROUTER_MODEL` | `z-ai/glm-4.7-flash` | Fallback: GLM via OpenRouter if Z.AI direct is down |
| `ZAI_OPENROUTER_REASONING_MODEL` | `z-ai/glm-z1-flash` | Fallback: GLM reasoning via OpenRouter |

### CEOClaw env vars

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3050` | HTTP port |
| `CEOCLAW_LOOP_INTERVAL_MS` | `3600000` | Milliseconds between iterations |
| `CEOCLAW_AUTO_START` | `false` | Start loop on boot |
| `CEOCLAW_AGENT_ENGINE` | `direct` | `direct` (Z.AI GLM via llm-router — default), `openclaw` (CLI gateway), `heuristic` (no AI) |
| `CEOCLAW_LANDING_PAGE_URL` | `https://devclaw.ai` | Landing page URL injected into all generated content |
| `CEOCLAW_OUTPUT_DIR` | `./ceoclaw-output` | Directory for SEO posts and campaign plans |
| `CEOCLAW_DAILY_MESSAGE_LIMIT` | `20` | Max LinkedIn messages per day |
| `CEOCLAW_MAX_PROSPECTS_PER_CAMPAIGN` | `20` | Max prospects to discover per campaign |
| `CEOCLAW_MIN_FIT_SCORE` | `65` | Minimum AI fit score (0–100) to qualify a prospect |
| `CEOCLAW_DEFAULT_SEARCH_QUERY` | `CTO startup software` | LinkedIn search query |
| `LINKEDIN_EMAIL` | — | LinkedIn account email |
| `LINKEDIN_PASSWORD` | — | LinkedIn account password |
| `LINKEDIN_SESSION_PATH` | `./linkedin-session.json` | Saved browser session path |
| `SUPABASE_URL` | — | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Supabase service role key |

### Run CEOClaw

```bash
cd services/ceoclaw-founder
npm install
npm run dev

# Trigger one iteration manually
curl -X POST http://localhost:3050/api/loop/tick

# Check status
curl http://localhost:3050/api/loop/status

# Feed in real MRR from Stripe
curl -X PATCH http://localhost:3050/api/state \
  -H "Content-Type: application/json" \
  -d '{"mrr": 29, "totalSignups": 3}'
```

### Supabase tables required

Run this SQL in your Supabase project to create the required tables:

```sql
create table if not exists ceoclaw_business_state (
  id text primary key default 'singleton',
  mrr numeric default 0,
  total_signups integer default 0,
  active_users integer default 0,
  traffic_last_30d integer default 0,
  landing_page_url text,
  latest_idea text,
  latest_content_title text,
  tasks_completed_today integer default 0,
  tasks_completed_total integer default 0,
  loop_enabled boolean default false,
  phase text default 'pre-launch',
  updated_at timestamptz default now()
);

create table if not exists ceoclaw_task_log (
  task_id text primary key,
  task_type text not null,
  domain text not null,
  status text not null,
  reason text,
  priority text,
  input jsonb,
  output jsonb,
  error text,
  mrr_at_time numeric default 0,
  started_at timestamptz default now(),
  completed_at timestamptz
);

create table if not exists ceoclaw_campaigns (
  campaign_id text primary key,
  name text not null,
  status text default 'pending',
  search_query text,
  target_industries text[],
  target_company_sizes text[],
  target_titles text[],
  max_prospects integer default 20,
  min_fit_score integer default 65,
  prospects_discovered integer default 0,
  prospects_qualified integer default 0,
  messages_generated integer default 0,
  messages_sent integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists ceoclaw_prospects (
  prospect_id text primary key,
  campaign_id text references ceoclaw_campaigns(campaign_id),
  first_name text,
  last_name text,
  title text,
  company_name text,
  industry text,
  company_size text,
  location text,
  linkedin_url text,
  status text default 'discovered',
  fit_score integer,
  fit_reason text,
  decision_reason text,
  generated_message text,
  message_subject text,
  discovered_at timestamptz default now(),
  qualified_at timestamptz,
  messaged_at timestamptz
);
```

---

## Quick Start

### Prerequisites
- Node.js 22+
- Z.AI API key (`ZAI_API_KEY`) — get one at [open.bigmodel.cn](https://open.bigmodel.cn)
- Redis (for session memory)
- Supabase project (for persistence)
- Telegram bot token
- GitHub token

### Run full stack
```bash
npm install
docker compose -f infra/docker/docker-compose.yml up
```

### Deploy landing page to Vercel
```bash
# Option A: set root directory to apps/landing-page in Vercel dashboard
# Option B: vercel.json at repo root is already configured
git push origin main  # triggers Vercel deploy automatically
```

---

## Workspace Commands

```bash
npm install          # Install all dependencies
npm run dev          # Start all services in dev mode
npm run build        # Build all packages and services
npm run test         # Run all tests
```
