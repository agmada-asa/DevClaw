# DevClaw

An AI-powered developer productivity platform that automates the full GitHub PR workflow — and markets itself with CEOClaw, its autonomous founder agent.

---

## What It Does

DevClaw turns a plain-language task description into a merged GitHub PR with no manual coding required:

1. **Describe** — Developer sends a message to the Telegram or WhatsApp bot (e.g. "fix the login bug" or "add dark mode")
2. **Issue** — DevClaw creates a GitHub issue automatically
3. **Plan** — AI generates a full architecture plan (files to change, approach, risk flags)
4. **Approve** — Human reviews and approves the plan via Telegram
5. **Generate** — AI Generator agent writes the code changes
6. **Review** — AI Reviewer agent checks the code for correctness and quality
7. **PR** — A GitHub pull request is opened, ready to merge

---

## Features

### DevClaw (Developer Tool)
- Telegram and WhatsApp bot interface — no app installs for end users
- GitHub issue auto-creation from natural language
- AI architecture planning with risk flags and file-level blueprints
- Human approval gate before any code is written
- Generator + Reviewer agent pair for code quality
- Automatic GitHub PR creation with summary and walkthrough
- Multi-provider LLM routing (Venice, Z.AI, OpenRouter) with automatic fallback
- Redis-backed session memory across conversations
- Supabase persistence for plans, runs, and audit history
- Private inference via Venice.ai — zero code logging
- Dashboard UI for judges/demo — shows agent activity, PR status, MRR

### CEOClaw (Autonomous Founder Agent)
CEOClaw is a self-running business agent that markets and sells DevClaw without human input. It runs a continuous loop across four domains:

- **Product** — Generates product ideas and builds landing page variants
- **Marketing** — Writes SEO blog posts targeting startup CTOs and indie hackers; plans outreach campaigns with message angles and follow-up sequences
- **Sales** — Discovers and qualifies LinkedIn prospects via Playwright browser automation; generates personalised connection messages; sends outreach up to a daily limit
- **Operations** — Analyses business metrics, processes user feedback, and plans the next iteration

CEOClaw wakes up on a configurable interval, asks the AI what to do next, executes that task, records the result in Supabase, and goes back to sleep. Goal: reach $100 MRR autonomously.

All CEOClaw outreach links back to the DevClaw landing page, which funnels signups into the Telegram bot.

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
│   ├── orchestrator/             # Main workflow state machine and policy checks
│   ├── architecture-planner/     # AI-backed plan builder and risk flags
│   ├── openclaw-engine/          # OpenClaw planning engine (plan create/update)
│   ├── agent-runner/             # Generator/Reviewer pair orchestration
│   ├── integration-verifier/     # Cross-service test and validation runner
│   ├── report-generator/         # PR summary, changelog, walkthrough output
│   ├── ceoclaw-founder/          # Autonomous founder loop: sales, marketing, product, ops
│   └── billing-webhooks/         # Stripe events and MRR ledger updates
├── packages/
│   ├── contracts/                # Shared schemas and typed message contracts
│   ├── agent-runtime/            # Agent lifecycle, retries, tool execution policies
│   ├── llm-router/               # Venice + Z.AI provider routing with fallback
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

### CEOClaw env vars

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3050` | HTTP port |
| `CEOCLAW_LOOP_INTERVAL_MS` | `3600000` | Milliseconds between iterations |
| `CEOCLAW_AUTO_START` | `false` | Start loop on boot |
| `CEOCLAW_AGENT_ENGINE` | `openclaw` | `openclaw` (via CLI gateway) or `direct` (llm-router) |
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
