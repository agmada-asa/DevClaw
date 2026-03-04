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

const DEEPSEEK_V32_MODEL = process.env.FLOCK_DEEPSEEK_V32_MODEL || 'deepseek-v3.2';
const ZAI_REVIEWER_MODEL = process.env.ZAI_GLM_REVIEWER_MODEL || 'glm-4.7-flash';

const GENERATOR_POLICY: RolePolicy = {
  timeoutMs: 1200_000,
  maxRetries: 1,
  fallbackOn: ['timeout', 'http5xx', 'http429'],
};

const REVIEWER_POLICY: RolePolicy = {
  timeoutMs: 600_000,
  maxRetries: 2,
  fallbackOn: ['timeout', 'http5xx', 'http429'],
};

// This is the single source of truth for which model handles which job.
// To swap a model, provider, or policy for a role, change it here.
export const MODEL_CONFIG: Record<ModelRole, ModelConfig> = {
  // Legacy generator route, aligned with paired frontend/backend generators.
  generator: {
    provider: 'flock',
    modelId: DEEPSEEK_V32_MODEL,
    policy: GENERATOR_POLICY,
  },

  // Legacy reviewer route, aligned with paired frontend/backend reviewers.
  reviewer: {
    provider: 'zai',
    modelId: ZAI_REVIEWER_MODEL,
    fallback: {
      provider: 'flock',
      modelId: DEEPSEEK_V32_MODEL,
    },
    policy: REVIEWER_POLICY,
  },

  // Frontend generator is pinned to FLock DeepSeek V3.2.
  frontend_generator: {
    provider: 'flock',
    modelId: DEEPSEEK_V32_MODEL,
    policy: GENERATOR_POLICY,
  },

  // Frontend reviewer is pinned to Z.AI GLM.
  frontend_reviewer: {
    provider: 'zai',
    modelId: ZAI_REVIEWER_MODEL,
    fallback: {
      provider: 'flock',
      modelId: DEEPSEEK_V32_MODEL,
    },
    policy: REVIEWER_POLICY,
  },

  // Backend generator is pinned to FLock DeepSeek V3.2.
  backend_generator: {
    provider: 'flock',
    modelId: DEEPSEEK_V32_MODEL,
    policy: GENERATOR_POLICY,
  },

  // Backend reviewer is pinned to Z.AI GLM.
  backend_reviewer: {
    provider: 'zai',
    modelId: ZAI_REVIEWER_MODEL,
    fallback: {
      provider: 'flock',
      modelId: DEEPSEEK_V32_MODEL,
    },
    policy: REVIEWER_POLICY,
  },

  // Coordinates workflow — needs faster responses, one retry is enough.
  orchestrator: {
    provider: 'flock',
    modelId: 'deepseek-v3.2',
    policy: {
      timeoutMs: 600_000,
      maxRetries: 1,
      fallbackOn: ['timeout', 'http5xx'],
    },
  },

  // Produces the architecture plan on Z.AI. One retry before giving up.
  planner: {
    provider: 'zai',
    modelId: 'glm-4.7-flash',
    policy: {
      timeoutMs: 600_000,
      maxRetries: 1,
      fallbackOn: ['timeout', 'http5xx'],
    },
  },
};
