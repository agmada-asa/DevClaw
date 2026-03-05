import { ChatMessage, ChatResponse } from '../types';
import { callOpenAiCompatible, resolveBoundedMaxTokens } from './openaiCompatible';

// FLock uses an OpenAI-compatible API format.
// Override the base URL via env var if their endpoint changes.
const BASE_URL = process.env.FLOCK_BASE_URL ?? 'https://api.flock.io/v1';

const FLOCK_DEFAULT_MAX_TOKENS = 16_384;
const FLOCK_MAX_TOKENS_CAP = 65_536;

export async function callFlock(
  modelId: string,
  messages: ChatMessage[],
  temperature = 0.2,
  callerMaxTokens?: number,
  timeoutMs?: number,
): Promise<ChatResponse> {
  const apiKey = process.env.FLOCK_API_KEY;
  if (!apiKey) throw new Error('[llm-router] FLOCK_API_KEY is not set');

  const maxTokens = resolveBoundedMaxTokens(
    callerMaxTokens,
    FLOCK_DEFAULT_MAX_TOKENS,
    FLOCK_MAX_TOKENS_CAP,
  );

  const result = await callOpenAiCompatible({
    provider: 'flock',
    baseUrl: BASE_URL,
    apiKey,
    modelId,
    messages,
    temperature,
    maxTokens,
    timeoutMs,
    streamModeEnvKey: 'FLOCK_STREAMING_MODE',
  });

  return {
    content: result.content,
    model: modelId,
    provider: 'flock',
  };
}
