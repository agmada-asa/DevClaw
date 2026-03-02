import axios from 'axios';
import { ChatRequest, ChatResponse, Provider } from './types';
import { MODEL_CONFIG } from './config';
import { RouterError, ProviderHttpError, ProviderTimeoutError } from './errors';
import { callFlock } from './providers/flock';
import { callVenice } from './providers/venice';
import { callZai } from './providers/zai';

// Internal helper — dispatches to the right provider function and wraps any
// raw axios/network error into a typed RouterError subclass.
async function callProvider(
  provider: Provider,
  modelId: string,
  req: ChatRequest,
): Promise<ChatResponse> {
  const ctx = { role: req.role, provider, model: modelId, requestId: req.requestId };

  try {
    const { messages, temperature, maxTokens } = req;
    switch (provider) {
      case 'flock':  return await callFlock(modelId, messages, temperature, maxTokens);
      case 'venice': return await callVenice(modelId, messages, temperature, maxTokens);
      case 'zai':    return await callZai(modelId, messages, temperature, maxTokens);
      default: {
        const _exhaustive: never = provider;
        throw new Error(`[llm-router] Unknown provider: ${_exhaustive}`);
      }
    }
  } catch (err) {
    // Don't re-wrap errors that are already typed.
    if (err instanceof RouterError) throw err;

    if (axios.isAxiosError(err)) {
      // ECONNABORTED = axios timeout, ERR_CANCELED = AbortController signal.
      if (err.code === 'ECONNABORTED' || err.code === 'ERR_CANCELED') {
        throw new ProviderTimeoutError(ctx);
      }
      if (err.response) {
        throw new ProviderHttpError({
          ...ctx,
          statusCode: err.response.status,
          responseBody: err.response.data,
        });
      }
    }

    // Non-axios error (e.g. missing API key check from provider file).
    throw new RouterError(err instanceof Error ? err.message : String(err), ctx);
  }
}

// The one function every other service in DevClaw calls.
//
// Usage:
//   import { chat } from '@devclaw/llm-router';
//   const reply = await chat({ role: 'generator', messages: [...], requestId: '...' });
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
export { RouterError, ProviderHttpError, ProviderTimeoutError } from './errors';
