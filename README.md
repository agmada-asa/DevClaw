# DevClaw

> **Turn a Telegram or WhatsApp message into a merged GitHub pull request — no IDE, no manual steps, no waiting.**

DevClaw is a production-ready multi-agent AI system powered entirely by **Z.AI's GLM model family**. Developers describe a task in plain English, approve an architecture plan, and DevClaw writes, reviews, and ships the code.

---

## Z.AI GLM — Powered Throughout

Every agent in DevClaw runs on Z.AI's GLM ecosystem. Each model is matched to the cognitive complexity of its role:

| Agent Role | GLM Model | Path | Why |
|---|---|---|---|
| Architecture Planner | `glm-4-long` | OpenRouter | 128k context — reads full codebases |
| Workflow Orchestrator | `glm-4.7` | OpenRouter | Complex reasoning over multi-step workflows |
| Code Generator | `glm-4.7-flash` | Direct Z.AI API | Fast, high-quality code with native CoT |
| Code Reviewer | `glm-4.7-flash` | Direct Z.AI API | Independent quality gate per iteration |
| Frontend Generator | `glm-4.7-flash` | Direct Z.AI API | Specialised UI/React/CSS generation |
| Backend Generator | `glm-4.7-flash` | Direct Z.AI API | Specialised API/DB/service generation |

**Fallback strategy:** if OpenRouter is unavailable, all roles fall back to `glm-4.7-flash` via the direct Z.AI API. The system never leaves the GLM family.

All Z.AI calls go through a typed LLM router (`packages/llm-router/`) that handles streaming SSE parsing, retries, provider fallback, and the two-phase `reasoning_content → content` format used by reasoning models.

---

## How It Works

```
User (Telegram / WhatsApp)
  │
  ↓  plain-language task description
Orchestrator (port 3010)
  │  create GitHub issue
  ↓
Planner — glm-4-long (128k ctx)
  │  architecture plan: files, approach, risk flags
  ↓
User approves plan  ←→  Telegram / WhatsApp
  │
  ↓  approved
Agent Runner (port 3030)
  │
  for each sub-task (frontend / backend):
    Generator — glm-4.7-flash  →  code patch
    Reviewer  — glm-4.7-flash  →  APPROVED or REWRITE
    if REWRITE → Generator again (up to 3 iterations)
  │
  ↓  all sub-tasks approved
GitHub Client  →  branch push  →  PR opened
  │
  ↓  pull request URL
User (Telegram / WhatsApp)  — "Your PR is ready"
```

### The Agentic Retry Loop

The Generator → Reviewer loop is the core of DevClaw's quality guarantee. If the Reviewer rejects a code patch, the rejection notes are fed back to the Generator as context for the next attempt. This repeats up to **3 iterations per sub-task** before the system moves forward. No human intervention required.

---

## Key Features

- **Natural language intake** via Telegram and WhatsApp bots
- **Full repo context** — `glm-4-long` reads your entire repository tree before planning
- **Architecture plan approval** — human-in-the-loop gate before any code is written
- **Agentic retry loop** — Generator rewrites on Reviewer rejection, up to 3×
- **Domain-split agents** — separate frontend and backend generator/reviewer pairs
- **Real GitHub PRs** — actual branch pushes and pull requests on your repositories
- **Multi-provider routing** — direct Z.AI API primary, OpenRouter fallback, all within the GLM family

---

## Architecture

```
apps/
  landing-page/       React + Vite + Tailwind — marketing site
  telegram-bot/       Telegram bot (intake + approval notifications)
  whatsapp-bot/       WhatsApp bot (intake + approval notifications)

services/
  orchestrator/       Intake → issue creation → planning → approval flow
  agent-runner/       Code generation + review loop (agentLoopManager)
  openclaw-gateway/   Internal API gateway for plan/execute routing
  openclaw-engine/    Planning engine (architecture plan generation)

packages/
  llm-router/         Z.AI GLM routing — streaming, retries, fallback
  contracts/          Shared TypeScript interfaces
  github-client/      GitHub API wrapper (issues, branches, PRs)
  config/             Shared configuration
```

---

## Quick Start

### Prerequisites

- Node.js 20+
- npm 10+
- GitHub personal access token (repo scope)
- Z.AI API key (`open.bigmodel.cn`)
- OpenRouter API key (for `glm-4-long` / `glm-4.7`)
- Telegram bot token (from @BotFather)
- Supabase project (for state persistence)

### Install

```bash
git clone https://github.com/agmada-asa/devclaw
cd devclaw
npm install
```

### Configure

Copy `.env.example` to `.env` in each service and fill in credentials:

```bash
cp services/orchestrator/.env.example services/orchestrator/.env
cp services/agent-runner/.env.example services/agent-runner/.env
cp apps/telegram-bot/.env.example apps/telegram-bot/.env
cp apps/whatsapp-bot/.env.example apps/whatsapp-bot/.env
```

Key variables:

```env
# Z.AI (required)
ZAI_API_KEY=your_zai_key

# OpenRouter (required for planner + orchestrator roles)
OPENROUTER_API_KEY=your_openrouter_key

# GitHub
GITHUB_TOKEN=your_github_pat

# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_key
```

### Run

```bash
# All services + landing page
npm run dev

# Core services only (no landing page)
npm run dev:servers
```

---

## LLM Router

`packages/llm-router/` is the Z.AI integration layer. It handles:

- **Provider routing** — selects Z.AI direct API or OpenRouter per model role
- **Streaming SSE parsing** — handles both standard `content` and `reasoning_content` streams
- **Automatic retries** — configurable per role (timeout, HTTP 5xx, 429, 4xx)
- **Graceful fallback** — on any eligible error, falls back to the next provider in the chain
- **Typed API** — `chat(role, messages)` returns a typed `ChatResponse`

```typescript
import { chat } from '@devclaw/llm-router';

const response = await chat({
  role: 'generator',          // selects glm-4.7-flash via Z.AI direct
  messages: [{ role: 'user', content: 'Write a React hook for...' }],
  requestId: 'run-abc-123',
});
console.log(response.content); // generated code
```

---

## Agent Loop Configuration

```env
# Max review iterations before accepting the current generation
RUNNER_AGENT_LOOP_MAX_ITERATIONS=3   # default: 3

# Disable the loop entirely (single generate+review pass)
RUNNER_AGENT_LOOP_ENABLED=true       # default: true
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| AI models | Z.AI GLM (glm-4.7-flash, glm-4.7, glm-4-long) |
| AI routing | Custom LLM router with SSE streaming |
| Messaging | Telegram Bot API, WhatsApp (Baileys) |
| GitHub | Octokit REST API |
| Backend | Node.js + Express + TypeScript |
| Frontend | React + Vite + Tailwind CSS |
| Database | Supabase (PostgreSQL) |
| Monorepo | Turborepo + npm workspaces |

---

## Z.AI Hackathon — Production-Ready AI Agents

DevClaw demonstrates meaningful, production-grade usage of the Z.AI GLM model ecosystem:

- **Six distinct GLM roles** — each model matched to cognitive complexity
- **Streaming inference** — real-time SSE parsing with reasoning_content support
- **Multi-model orchestration** — Planner, Orchestrator, Generator, Reviewer all coordinate
- **Agentic loops** — self-correcting generate/review cycles, not just one-shot calls
- **Resilient routing** — automatic fallback stays within the GLM family
- **Live production use** — real GitHub PRs on real repositories, not simulated output
