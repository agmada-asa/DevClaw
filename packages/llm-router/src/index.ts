import { ChatRequest, ChatResponse, Provider } from './types';
import { MODEL_CONFIG } from './config';
import { callFlock } from './providers/flock';
import { callVenice } from './providers/venice';
import { callZai } from './providers/zai';

// Internal helper — dispatches to the right provider function.
async function callProvider(
  provider: Provider,
  modelId: string,
  req: ChatRequest,
): Promise<ChatResponse> {
  const { messages, temperature, maxTokens } = req;
  switch (provider) {
    case 'flock':  return callFlock(modelId, messages, temperature, maxTokens);
    case 'venice': return callVenice(modelId, messages, temperature, maxTokens);
    case 'zai':    return callZai(modelId, messages, temperature, maxTokens);
    default: {
      const _exhaustive: never = provider;
      throw new Error(`[llm-router] Unknown provider: ${_exhaustive}`);
    }
  }
}

// The one function every other service in DevClaw calls.
//
// Usage:
//   import { chat } from '@devclaw/llm-router';
//   const reply = await chat({ role: 'generator', messages: [...] });
//
// If the primary provider fails and a fallback is configured (e.g. generator
// falls back from FLock to Venice), it retries automatically.
export async function chat(req: ChatRequest): Promise<ChatResponse> {
  const config = MODEL_CONFIG[req.role];
  if (!config) {
    throw new Error(`[llm-router] No model config for role: ${req.role}`);
  }

  try {
    return await callProvider(config.provider, config.modelId, req);
  } catch (primaryErr: unknown) {
    if (!config.fallback) throw primaryErr;

    const errMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
    console.warn(
      `[llm-router] Primary provider "${config.provider}" failed for role "${req.role}" — ` +
      `falling back to "${config.fallback.provider}". Reason: ${errMsg}`,
    );

    return await callProvider(config.fallback.provider, config.fallback.modelId, req);
  }
}

// Re-export types so callers don't need to import from internal paths.
export type { ChatRequest, ChatResponse, ChatMessage, ModelRole, Provider } from './types';
