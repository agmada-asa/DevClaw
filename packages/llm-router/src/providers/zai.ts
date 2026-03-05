import { ChatMessage, ChatResponse } from '../types';
import { callOpenAiCompatible, resolveBoundedMaxTokens } from './openaiCompatible';

// Z.AI (Zhipu AI) hosts GLM-4, used for the architecture planner role.
// Their API is OpenAI-compatible.
const BASE_URL = process.env.ZAI_BASE_URL ?? 'https://open.bigmodel.cn/api/paas/v4';
const ZAI_DEFAULT_MAX_TOKENS = 16_384;
const ZAI_MAX_TOKENS_CAP = 65_536;

export async function callZai(
  modelId: string,
  messages: ChatMessage[],
  temperature = 0.2,
  callerMaxTokens?: number,
  timeoutMs?: number,
): Promise<ChatResponse> {
  const apiKey = process.env.ZAI_API_KEY;
  if (!apiKey) throw new Error('[llm-router] ZAI_API_KEY is not set');

  const maxTokens = resolveBoundedMaxTokens(
    callerMaxTokens,
    ZAI_DEFAULT_MAX_TOKENS,
    ZAI_MAX_TOKENS_CAP,
  );

  const result = await callOpenAiCompatible({
    provider: 'zai',
    baseUrl: BASE_URL,
    apiKey,
    modelId,
    messages,
    temperature,
    maxTokens,
    timeoutMs,
    streamModeEnvKey: 'ZAI_STREAMING_MODE',
  });

  return {
    content: result.content,
    model: modelId,
    provider: 'zai',
  };
}
