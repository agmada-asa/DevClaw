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

// Z.AI GLM models used across all roles.
// Override via env vars to switch between GLM variants without a redeploy.
const ZAI_GENERATOR_MODEL = process.env.GENERATOR_MODEL || 'glm-4.7-flash';
const ZAI_REVIEWER_MODEL  = process.env.REVIEWER_MODEL  || 'glm-4.7-flash';

// Fallback: hit the same GLM model via OpenRouter if Z.AI direct is unavailable.
const ZAI_OPENROUTER_FALLBACK_MODEL = process.env.ZAI_OPENROUTER_MODEL || 'z-ai/glm-4.7-flash';

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

// This is the single source of truth for which model handles which job.
// Z.AI GLM is the core engine for every role. OpenRouter is the fallback
// route to the same GLM models if the Z.AI direct API is unavailable.
export const MODEL_CONFIG: Record<ModelRole, ModelConfig> = {
  // Legacy generator route — Z.AI GLM generates the code patch.
  generator: {
    provider: 'zai',
    modelId: ZAI_GENERATOR_MODEL,
    fallback: { provider: 'openrouter', modelId: ZAI_OPENROUTER_FALLBACK_MODEL },
    policy: GENERATOR_POLICY,
  },

  // Legacy reviewer route — Z.AI GLM reviews the generated patch.
  reviewer: {
    provider: 'zai',
    modelId: ZAI_REVIEWER_MODEL,
    fallback: { provider: 'openrouter', modelId: ZAI_OPENROUTER_FALLBACK_MODEL },
    policy: REVIEWER_POLICY,
  },

  // Frontend generator — Z.AI GLM generates frontend code patches.
  frontend_generator: {
    provider: 'zai',
    modelId: ZAI_GENERATOR_MODEL,
    fallback: { provider: 'openrouter', modelId: ZAI_OPENROUTER_FALLBACK_MODEL },
    policy: GENERATOR_POLICY,
  },

  // Frontend reviewer — Z.AI GLM reviews frontend patches.
  frontend_reviewer: {
    provider: 'zai',
    modelId: ZAI_REVIEWER_MODEL,
    fallback: { provider: 'openrouter', modelId: ZAI_OPENROUTER_FALLBACK_MODEL },
    policy: REVIEWER_POLICY,
  },

  // Backend generator — Z.AI GLM generates backend code patches.
  backend_generator: {
    provider: 'zai',
    modelId: ZAI_GENERATOR_MODEL,
    fallback: { provider: 'openrouter', modelId: ZAI_OPENROUTER_FALLBACK_MODEL },
    policy: GENERATOR_POLICY,
  },

  // Backend reviewer — Z.AI GLM reviews backend patches.
  backend_reviewer: {
    provider: 'zai',
    modelId: ZAI_REVIEWER_MODEL,
    fallback: { provider: 'openrouter', modelId: ZAI_OPENROUTER_FALLBACK_MODEL },
    policy: REVIEWER_POLICY,
  },

  // Orchestrator — Z.AI GLM coordinates the workflow. One retry before giving up.
  orchestrator: {
    provider: 'zai',
    modelId: 'glm-4.7-flash',
    fallback: { provider: 'openrouter', modelId: ZAI_OPENROUTER_FALLBACK_MODEL },
    policy: {
      timeoutMs: 600_000,
      maxRetries: 1,
      fallbackOn: ['timeout', 'http5xx'],
    },
  },

  // Planner — Z.AI GLM produces the architecture plan. One retry before giving up.
  planner: {
    provider: 'zai',
    modelId: 'glm-4.7-flash',
    fallback: { provider: 'openrouter', modelId: ZAI_OPENROUTER_FALLBACK_MODEL },
    policy: {
      timeoutMs: 600_000,
      maxRetries: 1,
      fallbackOn: ['timeout', 'http5xx'],
    },
  },

  // CEOClaw: Qualifies LinkedIn prospects — Z.AI GLM analyzes company fit for DevClaw.
  prospect_qualifier: {
    provider: 'zai',
    modelId: process.env.QUALIFIER_MODEL || 'glm-4.7-flash',
    fallback: { provider: 'openrouter', modelId: ZAI_OPENROUTER_FALLBACK_MODEL },
    policy: {
      timeoutMs: 60_000,
      maxRetries: 2,
      fallbackOn: ['timeout', 'http5xx', 'http429'],
    },
  },

  // CEOClaw: Writes personalized LinkedIn outreach messages — Z.AI GLM generates copy.
  outreach_writer: {
    provider: 'zai',
    modelId: 'glm-4.7-flash',
    fallback: { provider: 'openrouter', modelId: ZAI_OPENROUTER_FALLBACK_MODEL },
    policy: {
      timeoutMs: 60_000,
      maxRetries: 1,
      fallbackOn: ['timeout', 'http5xx', 'http429'],
    },
  },
};
