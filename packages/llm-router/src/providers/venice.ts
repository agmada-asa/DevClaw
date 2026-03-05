import { ChatMessage, ChatResponse } from '../types';
import { callOpenAiCompatible, resolveBoundedMaxTokens } from './openaiCompatible';

// Venice.ai is the fallback for the generator — chosen because it explicitly
// does not log or train on input content, protecting customer codebase IP.
const BASE_URL = process.env.VENICE_BASE_URL ?? 'https://api.venice.ai/api/v1';
const VENICE_DEFAULT_MAX_TOKENS = 16_384;
const VENICE_MAX_TOKENS_CAP = 65_536;

export async function callVenice(
  modelId: string,
  messages: ChatMessage[],
  temperature = 0.2,
  callerMaxTokens?: number,
  timeoutMs?: number,
): Promise<ChatResponse> {
  const apiKey = process.env.VENICE_API_KEY;
  if (!apiKey) throw new Error('[llm-router] VENICE_API_KEY is not set');

  const maxTokens = resolveBoundedMaxTokens(
    callerMaxTokens,
    VENICE_DEFAULT_MAX_TOKENS,
    VENICE_MAX_TOKENS_CAP,
  );

  const result = await callOpenAiCompatible({
    provider: 'venice',
    baseUrl: BASE_URL,
    apiKey,
    modelId,
    messages,
    temperature,
    maxTokens,
    timeoutMs,
    streamModeEnvKey: 'VENICE_STREAMING_MODE',
  });

  return {
    content: result.content,
    model: modelId,
    provider: 'venice',
  };
}
