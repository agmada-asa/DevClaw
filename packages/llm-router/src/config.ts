import { ModelRole, Provider } from './types';

// For each role, defines which provider + model to call,
// and optionally a fallback if the primary provider fails.
export interface ModelConfig {
  provider: Provider;
  modelId: string;
  fallback?: {
    provider: Provider;
    modelId: string;
  };
}

// This is the single source of truth for which model handles which job.
// To swap a model or provider, change it here — nothing else needs to change.
export const MODEL_CONFIG: Record<ModelRole, ModelConfig> = {
  // Writes the actual code changes. Venice.ai is the fallback because it
  // explicitly does not log codebase content — important for customer IP.
  generator: {
    provider: 'flock',
    modelId: 'Qwen/Qwen2.5-Coder-32B-Instruct',
    fallback: {
      provider: 'venice',
      modelId: 'qwen-2.5-coder-32b',
    },
  },

  // Reviews the generated code and either approves it or returns rewrite notes.
  reviewer: {
    provider: 'flock',
    modelId: 'deepseek-ai/DeepSeek-R1',
  },

  // The orchestrator agent that coordinates the overall workflow.
  orchestrator: {
    provider: 'flock',
    modelId: 'meta-llama/Llama-3.3-70B-Instruct',
  },

  // Produces the architecture plan (affected files, risks, agent assignments).
  planner: {
    provider: 'zai',
    modelId: 'glm-4',
  },
};
