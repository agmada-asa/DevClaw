import axios from 'axios';
import { ChatRequest, ChatResponse, Provider } from './types';
import { MODEL_CONFIG, FallbackTrigger } from './config';
import { RouterError, ProviderHttpError, ProviderTimeoutError } from './errors';
import { callFlock } from './providers/flock';
import { callVenice } from './providers/venice';
import { callZai } from './providers/zai';

// Returns true if this error is in the role's fallbackOn list, meaning it is
// safe to retry or fall back. Permanent errors like 401/403 are never in the
// list so they surface immediately without wasting a fallback attempt.
function shouldFallback(err: unknown, triggers: FallbackTrigger[]): boolean {
  if (triggers.includes('any')) return true;
  if (triggers.includes('timeout') && err instanceof ProviderTimeoutError) return true;
  if (err instanceof ProviderHttpError) {
    if (triggers.includes('http5xx') && err.statusCode >= 500) return true;
    if (triggers.includes('http429') && err.statusCode === 429) return true;
  }
  return false;
}

// Internal helper — dispatches to the right provider function and wraps any
// raw axios/network error into a typed RouterError subclass.
async function callProvider(
  provider: Provider,
  modelId: string,
  req: ChatRequest,
  timeoutMs?: number,
): Promise<ChatResponse> {
  const ctx = { role: req.role, provider, model: modelId, requestId: req.requestId };

  try {
    const { messages, temperature, maxTokens } = req;
    switch (provider) {
      case 'flock':  return await callFlock(modelId, messages, temperature, maxTokens, timeoutMs);
      case 'venice': return await callVenice(modelId, messages, temperature, maxTokens, timeoutMs);
      case 'zai':    return await callZai(modelId, messages, temperature, maxTokens, timeoutMs);
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
// Flow: try primary up to (1 + maxRetries) times, then try fallback if eligible.
export async function chat(req: ChatRequest): Promise<ChatResponse> {
  const config = MODEL_CONFIG[req.role];
  if (!config) {
    throw new Error(`[llm-router] No model config for role: ${req.role}`);
  }

  const { timeoutMs, maxRetries, fallbackOn } = config.policy;
  const maxAttempts = 1 + maxRetries;
  let lastErr: unknown;

  // Retry loop — keeps trying the primary provider while:
  //   (a) the error is listed in fallbackOn (i.e. transient, worth retrying), and
  //   (b) we still have attempts remaining.
  // Permanent errors (e.g. 401) break out immediately on the first failure.
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await callProvider(config.provider, config.modelId, req, timeoutMs);
    } catch (err) {
      lastErr = err;
      const retryable = shouldFallback(err, fallbackOn);
      if (!retryable || attempt === maxAttempts) break;
      console.warn(
        `[llm-router] Attempt ${attempt}/${maxAttempts} failed for role "${req.role}" on ` +
        `"${config.provider}" — retrying.`,
      );
    }
  }

  // After exhausting retries, try the fallback provider if configured and eligible.
  if (config.fallback && shouldFallback(lastErr, fallbackOn)) {
    const errMsg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    console.warn(
      `[llm-router] Primary "${config.provider}" exhausted for role "${req.role}" — ` +
      `falling back to "${config.fallback.provider}". Reason: ${errMsg}`,
    );
    return await callProvider(config.fallback.provider, config.fallback.modelId, req, timeoutMs);
  }

  throw lastErr;
}

// Re-export types so callers don't need to import from internal paths.
export type { ChatRequest, ChatResponse, ChatMessage, ModelRole, Provider } from './types';
export { RouterError, ProviderHttpError, ProviderTimeoutError } from './errors';
