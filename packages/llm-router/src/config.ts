import { ModelRole, Provider } from './types';

// Which error types are considered transient and worth retrying / falling back on.
// 'any'     — always retry/fallback (original behaviour)
// 'timeout' — only on ProviderTimeoutError
// 'http5xx' — only on ProviderHttpError with statusCode >= 500
// 'http429' — only on ProviderHttpError with statusCode 429 (rate limit)
export type FallbackTrigger = 'any' | 'timeout' | 'http5xx' | 'http429';

export interface RolePolicy {
  timeoutMs: number;              // per-call axios timeout
  maxRetries: number;             // retries on primary before giving up / falling back
  fallbackOn: FallbackTrigger[];  // error types that are eligible for retry + fallback
}

// For each role, defines which provider + model to call,
// an optional fallback, and the runtime policy for that role.
export interface ModelConfig {
  provider: Provider;
  modelId: string;
  fallback?: {
    provider: Provider;
    modelId: string;
  };
  policy: RolePolicy;
}

// ─── Z.AI GLM model selection ─────────────────────────────────────────────────
//
// Different GLM variants are chosen based on the cognitive demand of each role:
//
//   glm-z1-flash   — Z.AI's reasoning model (chain-of-thought). Used for roles
//                    that require deep analysis: planning, orchestration.
//   glm-4.7-flash  — Z.AI's fast generation model. Used for high-throughput
//                    roles: code generation, review, prospect scoring, copy.
//   glm-4-long     — Z.AI's 128k-context model. Used for roles that process
//                    large codebases or long architecture documents.
//
// Every value can be overridden via env var to switch GLM variants without a redeploy.

// Reasoning roles — needs chain-of-thought, not raw speed.
const ZAI_REASONING_MODEL = process.env.REASONING_MODEL || 'glm-z1-flash';

// Generation roles — optimised for fast, high-quality code output.
const ZAI_GENERATOR_MODEL = process.env.GENERATOR_MODEL || 'glm-4.7-flash';
const ZAI_REVIEWER_MODEL  = process.env.REVIEWER_MODEL  || 'glm-4.7-flash';

// Long-context roles — architecture plans and large file reviews.
const ZAI_LONGCTX_MODEL = process.env.LONGCTX_MODEL || 'glm-4-long';

// Fallback: reach the same GLM family via OpenRouter if Z.AI direct is down.
const ZAI_OPENROUTER_FALLBACK_MODEL = process.env.ZAI_OPENROUTER_MODEL || 'z-ai/glm-4.7-flash';
const ZAI_OPENROUTER_REASONING_FALLBACK = process.env.ZAI_OPENROUTER_REASONING_MODEL || 'z-ai/glm-z1-flash';

const GENERATOR_POLICY: RolePolicy = {
  timeoutMs: 1200_000,
  maxRetries: 2,
  fallbackOn: ['timeout', 'http5xx', 'http429'],
};

const REVIEWER_POLICY: RolePolicy = {
  timeoutMs: 600_000,
  maxRetries: 2,
  fallbackOn: ['timeout', 'http5xx', 'http429'],
};

const REASONING_POLICY: RolePolicy = {
  // Reasoning models take longer — allow extra time for chain-of-thought.
  timeoutMs: 900_000,
  maxRetries: 1,
  fallbackOn: ['timeout', 'http5xx'],
};

// ─── Model config ─────────────────────────────────────────────────────────────
//
// Z.AI GLM is the sole AI engine powering DevClaw. Every role maps to a GLM
// variant tuned for that role's cognitive profile. OpenRouter is the emergency
// fallback route to the same GLM family — never a different model family.
export const MODEL_CONFIG: Record<ModelRole, ModelConfig> = {

  // ── DevClaw: code generation ────────────────────────────────────────────────

  // generator — GLM-4.7-Flash writes the code patch from the approved plan.
  generator: {
    provider: 'zai',
    modelId: ZAI_GENERATOR_MODEL,
    fallback: { provider: 'openrouter', modelId: ZAI_OPENROUTER_FALLBACK_MODEL },
    policy: GENERATOR_POLICY,
  },

  // reviewer — GLM-4.7-Flash checks the generated patch for correctness.
  reviewer: {
    provider: 'zai',
    modelId: ZAI_REVIEWER_MODEL,
    fallback: { provider: 'openrouter', modelId: ZAI_OPENROUTER_FALLBACK_MODEL },
    policy: REVIEWER_POLICY,
  },

  // frontend_generator — GLM-4.7-Flash generates frontend code patches.
  frontend_generator: {
    provider: 'zai',
    modelId: ZAI_GENERATOR_MODEL,
    fallback: { provider: 'openrouter', modelId: ZAI_OPENROUTER_FALLBACK_MODEL },
    policy: GENERATOR_POLICY,
  },

  // frontend_reviewer — GLM-4.7-Flash reviews frontend patches.
  frontend_reviewer: {
    provider: 'zai',
    modelId: ZAI_REVIEWER_MODEL,
    fallback: { provider: 'openrouter', modelId: ZAI_OPENROUTER_FALLBACK_MODEL },
    policy: REVIEWER_POLICY,
  },

  // backend_generator — GLM-4.7-Flash generates backend code patches.
  backend_generator: {
    provider: 'zai',
    modelId: ZAI_GENERATOR_MODEL,
    fallback: { provider: 'openrouter', modelId: ZAI_OPENROUTER_FALLBACK_MODEL },
    policy: GENERATOR_POLICY,
  },

  // backend_reviewer — GLM-4.7-Flash reviews backend patches.
  backend_reviewer: {
    provider: 'zai',
    modelId: ZAI_REVIEWER_MODEL,
    fallback: { provider: 'openrouter', modelId: ZAI_OPENROUTER_FALLBACK_MODEL },
    policy: REVIEWER_POLICY,
  },

  // ── DevClaw: reasoning & orchestration ─────────────────────────────────────

  // orchestrator — GLM-Z1-Flash reasons over the workflow state and decides
  // the next step. Chain-of-thought is essential here; speed is secondary.
  orchestrator: {
    provider: 'zai',
    modelId: ZAI_REASONING_MODEL,
    fallback: { provider: 'openrouter', modelId: ZAI_OPENROUTER_REASONING_FALLBACK },
    policy: REASONING_POLICY,
  },

  // planner — GLM-4-Long produces the architecture plan from natural language.
  // Uses the long-context model so it can reason over entire codebases.
  planner: {
    provider: 'zai',
    modelId: ZAI_LONGCTX_MODEL,
    fallback: { provider: 'openrouter', modelId: ZAI_OPENROUTER_FALLBACK_MODEL },
    policy: {
      timeoutMs: 900_000,
      maxRetries: 1,
      fallbackOn: ['timeout', 'http5xx'],
    },
  },

  // ── CEOClaw: autonomous founder agent ──────────────────────────────────────

  // prospect_qualifier — GLM-Z1-Flash analyses company profiles and scores fit.
  // Reasoning model ensures nuanced qualification, not keyword matching.
  prospect_qualifier: {
    provider: 'zai',
    modelId: process.env.QUALIFIER_MODEL || ZAI_REASONING_MODEL,
    fallback: { provider: 'openrouter', modelId: ZAI_OPENROUTER_REASONING_FALLBACK },
    policy: {
      timeoutMs: 90_000,
      maxRetries: 2,
      fallbackOn: ['timeout', 'http5xx', 'http429'],
    },
  },

  // outreach_writer — GLM-4.7-Flash generates personalised LinkedIn messages.
  outreach_writer: {
    provider: 'zai',
    modelId: ZAI_GENERATOR_MODEL,
    fallback: { provider: 'openrouter', modelId: ZAI_OPENROUTER_FALLBACK_MODEL },
    policy: {
      timeoutMs: 60_000,
      maxRetries: 1,
      fallbackOn: ['timeout', 'http5xx', 'http429'],
    },
  },
};
