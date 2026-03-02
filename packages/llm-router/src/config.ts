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

// This is the single source of truth for which model handles which job.
// To swap a model, provider, or policy for a role, change it here.
export const MODEL_CONFIG: Record<ModelRole, ModelConfig> = {
  // Writes the actual code changes. Venice.ai is the fallback because it
  // explicitly does not log codebase content — important for customer IP.
  // One retry before Venice because FLock can have transient spikes.
  generator: {
    provider: 'flock',
    modelId: 'Qwen/Qwen2.5-Coder-32B-Instruct',
    fallback: {
      provider: 'venice',
      modelId: 'qwen-2.5-coder-32b',
    },
    policy: {
      timeoutMs: 30_000,
      maxRetries: 1,
      fallbackOn: ['timeout', 'http5xx', 'http429'],
    },
  },

  // Reviews the generated code. No fallback, but two retries so a transient
  // hiccup doesn't force the generator to loop unnecessarily.
  reviewer: {
    provider: 'flock',
    modelId: 'deepseek-ai/DeepSeek-R1',
    policy: {
      timeoutMs: 30_000,
      maxRetries: 2,
      fallbackOn: ['timeout', 'http5xx'],
    },
  },

  // Coordinates workflow — needs faster responses, one retry is enough.
  orchestrator: {
    provider: 'flock',
    modelId: 'meta-llama/Llama-3.3-70B-Instruct',
    policy: {
      timeoutMs: 15_000,
      maxRetries: 1,
      fallbackOn: ['timeout', 'http5xx'],
    },
  },

  // Produces the architecture plan on Z.AI. One retry before giving up.
  planner: {
    provider: 'zai',
    modelId: 'glm-4',
    policy: {
      timeoutMs: 20_000,
      maxRetries: 1,
      fallbackOn: ['timeout', 'http5xx'],
    },
  },
};
